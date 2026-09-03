/**
 * Conformance tests across the seams between ingestion modules.
 *
 *   cd apps/web && npm run test:unit
 *
 * Every module here is well tested in isolation, and that is exactly the
 * problem this file exists for: the mapper produces column names, the writer
 * consumes them *by name*, and a name present on one side but absent on the
 * other does not error. The value is silently dropped.
 *
 * That is not hypothetical. Six columns — num_employees, legal_fees,
 * accounting_fees, occupancy, depreciation, grants_to_govts — were extracted
 * from the XML by the concordance and then discarded by the write path, because
 * UPSERT_COLUMNS had never been extended to match. Every unit test on both
 * sides passed throughout.
 *
 * Pure: no database, no network.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOMParser } from '@xmldom/xmldom'
import { UPSERT_COLUMNS, DATA_SOURCES, CONFLICT_MODES, buildFilingsUpsert } from './upsert-sql.ts'
import contract from './write-contract.json' with { type: 'json' }
import { mapEfileReturn, stripXmlBom } from './efile-map.ts'
import concordance from './efile-concordance.json' with { type: 'json' }

const writable = new Set(UPSERT_COLUMNS.map((c) => c.name))

function loadFixture(name: string): Document {
  const xml = stripXmlBom(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'))
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
}

describe('concordance ↔ write path conformance', () => {
  for (const [form, spec] of Object.entries(concordance.forms)) {
    test(`every ${form} column the concordance maps can actually be written`, () => {
      const missing = Object.keys(spec.columns).filter((c) => !writable.has(c))
      assert.deepEqual(
        missing, [],
        `these ${form} columns are extracted from the XML and then silently dropped by ` +
        `/api/ingest/batch. Add them to UPSERT_COLUMNS (and confirm they exist in filings).`,
      )
    })
  }

  test('every derived column can be written', () => {
    const missing = concordance.derived.map((d) => d.column).filter((c) => !writable.has(c))
    assert.deepEqual(missing, [])
  })

  test('the TypeScript literals still match the shared contract the CLI reads', () => {
    assert.deepEqual([...DATA_SOURCES], contract.data_sources)
    assert.deepEqual([...CONFLICT_MODES], contract.conflict_modes)
    assert.deepEqual(UPSERT_COLUMNS, contract.columns,
      'UPSERT_COLUMNS must come from write-contract.json, not a second hand-written list')
  })

  test('the identity columns the writer keys on are the ones the mapper emits', () => {
    const keys = UPSERT_COLUMNS.filter((c) => c.key).map((c) => c.name)
    assert.deepEqual(keys, ['ein', 'tax_period'],
      'the conflict target, the preflight lookup and the mapper must agree on the key')
  })
})

describe('a mapped e-file row survives the write path intact', () => {
  for (const [fixture, form] of [
    ['efile-990.xml', '990'],
    ['efile-990ez.xml', '990EZ'],
    ['efile-990pf.xml', '990PF'],
  ] as const) {
    test(`${form}: every populated field reaches the generated SQL`, () => {
      const res = mapEfileReturn(loadFixture(fixture), {
        sourceFile: 'archive.zip',
        objectId: '202503609349300405',
      })
      assert.ok(res.ok, 'fixture must map')

      const built = buildFilingsUpsert([res.row], 'efile_xml', 'skip', 'archive.zip')

      // Anything the mapper populated but the writer does not carry is a value
      // lost between modules — the exact failure this file guards.
      const dropped = Object.entries(res.row)
        .filter(([k, v]) => v !== null && v !== undefined && !writable.has(k))
        // `name` and `state` go to organizations, not filings, by design.
        .filter(([k]) => k !== 'name' && k !== 'state')
        .map(([k]) => k)
      assert.deepEqual(dropped, [],
        'mapped values must either be written to filings or be a known non-filings field')

      // The parameter list must actually contain the row's values, not just
      // have the right shape.
      assert.equal(built.params[0], 'skip', 'the conflict mode is $1')
      assert.ok(built.params.includes(res.row.ein), 'the EIN must be bound')
      assert.ok(built.params.includes(res.row.tax_period), 'the tax period must be bound')
      assert.ok(built.params.includes('efile_xml'), 'data_source must be bound')
      const revenue = res.row.total_revenue
      if (typeof revenue === 'number') {
        assert.ok(built.params.includes(revenue), 'total_revenue must be bound')
      }
    })
  }

  test('provenance columns are bound, not quietly lost', () => {
    const res = mapEfileReturn(loadFixture('efile-990.xml'), {
      sourceFile: 'archive.zip',
      objectId: '202503609349300405',
      dln: '93492013018736',
    })
    assert.ok(res.ok)
    const built = buildFilingsUpsert([res.row], 'efile_xml', 'skip', 'archive.zip')
    assert.ok(built.params.includes('202503609349300405'), 'object_id')
    assert.ok(built.params.includes('93492013018736'), 'dln')
    assert.ok(built.params.includes(res.row.submission_date), 'submission_date')
  })

  test('a null-heavy row binds nulls rather than dropping the column', () => {
    // A 990-EZ leaves several columns unmapped entirely; the generated SQL must
    // still name every write-path column, or COALESCE precedence would compare
    // against a column that was never in the statement.
    const res = mapEfileReturn(loadFixture('efile-990ez.xml'), { sourceFile: 'a.zip' })
    assert.ok(res.ok)
    const built = buildFilingsUpsert([res.row], 'efile_xml', 'skip', 'a.zip')
    for (const col of UPSERT_COLUMNS) {
      assert.match(built.sql, new RegExp(`\\b${col.name}\\b`),
        `${col.name} must appear in the statement even when the row has no value for it`)
    }
    // mode + one parameter per column
    assert.equal(built.params.length, 1 + UPSERT_COLUMNS.length)
  })
})

describe('SOI and e-file rows are interchangeable at the write path', () => {
  test('both sources bind the same column count for a single row', () => {
    const soi = buildFilingsUpsert(
      [{ ein: '12-3456789', tax_period: '2024-12-01', fiscal_year: 2024, total_revenue: 1 }],
      'soi_extract', 'skip', 'x.csv',
    )
    const res = mapEfileReturn(loadFixture('efile-990.xml'), { sourceFile: 'a.zip' })
    assert.ok(res.ok)
    const efile = buildFilingsUpsert([res.row], 'efile_xml', 'skip', 'a.zip')
    assert.equal(soi.params.length, efile.params.length,
      'the write contract must not depend on which source produced the row')
  })
})
