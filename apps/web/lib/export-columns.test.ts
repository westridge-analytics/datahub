/**
 * Column-selection tests for /api/export.
 *
 *   cd apps/web && npm run test:unit
 *
 * The bug these exist for: the export wrote a hard-coded eleven columns, so
 * every column the picker had gained since — revenue components, compensation,
 * fees, grants, governance flags — was visible in the table and missing from
 * the download. The conformance test below fails the moment a picker column
 * stops being exportable.
 *
 * The live test runs the *generated* SELECT against the real database (read
 * only, LIMIT 1), which is the only way to catch a catalogue key that no longer
 * matches a column name. Skips itself with a clear message if DATABASE_URL is
 * absent.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { ALL_COLUMN_KEYS, COLUMN_LABELS, DEFAULT_VISIBLE_COLUMNS } from './table-columns.ts'
import {
  LEGACY_EXPORT_COLUMNS,
  buildSelectList,
  exportCell,
  resolveExportColumns,
} from './export-columns.ts'

function keys(colsParam: string | null, cohortId: number | null = null): string[] {
  return resolveExportColumns(colsParam, cohortId).map(c => c.key)
}

describe('export column resolution', () => {
  test('every column the picker offers is exportable', () => {
    // The regression guard. A key in COLUMN_GROUPS that resolveExportColumns
    // drops is a column you can see and cannot download.
    const resolved = keys(ALL_COLUMN_KEYS.join(','))
    assert.deepEqual(resolved, ALL_COLUMN_KEYS,
      'a picker column did not survive export resolution')
  })

  test('every resolved column carries a label and a SELECT expression', () => {
    for (const col of resolveExportColumns(ALL_COLUMN_KEYS.join(','))) {
      assert.equal(col.label, COLUMN_LABELS[col.key], `${col.key} label drifted from the table's`)
      assert.match(col.select, new RegExp(`\\bAS ${col.key}$`), `${col.key} is not aliased to its key`)
    }
  })

  test('the default visible columns export as shown', () => {
    const resolved = keys(DEFAULT_VISIBLE_COLUMNS.join(','))
    assert.deepEqual(new Set(resolved), new Set(DEFAULT_VISIBLE_COLUMNS))
  })

  test('no cols parameter falls back to the original eleven', () => {
    // The Institution page's export link sends no cols; it must not change.
    assert.deepEqual(new Set(keys(null)), new Set(LEGACY_EXPORT_COLUMNS))
    assert.deepEqual(new Set(keys('')), new Set(LEGACY_EXPORT_COLUMNS))
  })

  test('columns come back in the table\'s order, not the URL\'s', () => {
    const resolved = keys('total_revenue,ein,has_lobbying,name')
    assert.deepEqual(resolved, ['ein', 'name', 'total_revenue', 'has_lobbying'])
  })

  test('unknown and duplicated keys are dropped, not fatal', () => {
    assert.deepEqual(keys('ein,name,not_a_column,ein'), ['ein', 'name'])
  })

  test('a cols list of nothing but junk falls back rather than selecting nothing', () => {
    // An empty SELECT list is a 500; a stale bookmark should still download.
    assert.deepEqual(new Set(keys('bogus,also_bogus')), new Set(LEGACY_EXPORT_COLUMNS))
  })

  test('injection attempts resolve to no columns of their own', () => {
    // 'name); DROP…' is one comma-separated token and matches no key, so it
    // is dropped whole — the SELECT list only ever holds catalogue expressions.
    const resolved = resolveExportColumns("ein,name); DROP TABLE filings;--")
    assert.deepEqual(resolved.map(c => c.key), ['ein'])
    assert.ok(!buildSelectList(resolved).includes('DROP'))
  })
})

describe('export column SQL', () => {
  function selectFor(key: string, cohortId: number | null = null): string {
    return resolveExportColumns(key === 'ein' ? key : `ein,${key}`, cohortId)
      .find(c => c.key === key)!.select
  }

  test('organization columns read from o, filing columns from f', () => {
    assert.match(selectFor('name'), /^o\.name AS name$/)
    assert.match(selectFor('state'), /^o\.state AS state$/)
    assert.match(selectFor('ntee_code'), /^o\.ntee_code AS ntee_code$/)
    assert.match(selectFor('legal_fees'), /^f\.legal_fees AS legal_fees$/)
    assert.match(selectFor('num_employees'), /^f\.num_employees AS num_employees$/)
  })

  test('net income is computed, matching the table and the sort expression', () => {
    assert.match(selectFor('net_income'), /f\.total_revenue - f\.total_expenses/)
  })

  test('NTEE category is labelled, not the raw letter', () => {
    const sql = selectFor('ntee_category')
    assert.match(sql, /CASE LEFT\(o\.ntee_code, 1\)/)
    assert.match(sql, /Human Services/)
  })

  test('cohort names are full names, and a cohort filter names that cohort', () => {
    assert.match(selectFor('cohort_name'), /string_agg\(c\.name/)
    assert.match(selectFor('cohort_name', 7), /WHERE id = 7\)/)
  })
})

describe('export cell values', () => {
  const [boolCol] = resolveExportColumns('has_lobbying')
    .filter(c => c.key === 'has_lobbying')
  const [numCol] = resolveExportColumns('total_revenue').filter(c => c.key === 'total_revenue')
  const [textCol] = resolveExportColumns('name').filter(c => c.key === 'name')

  test('governance flags read Yes/No, as they do on screen', () => {
    assert.equal(exportCell(boolCol, { has_lobbying: true }), 'Yes')
    assert.equal(exportCell(boolCol, { has_lobbying: false }), 'No')
    assert.equal(exportCell(boolCol, { has_lobbying: null }), '')
  })

  test('money stays a number so a spreadsheet can sum it', () => {
    assert.equal(exportCell(numCol, { total_revenue: 1234 }), 1234)
    assert.equal(typeof exportCell(numCol, { total_revenue: 1234 }), 'number')
    // BIGINT arriving as a string (if the int8 parser ever regressed) must not
    // land in the sheet as text.
    assert.equal(exportCell(numCol, { total_revenue: '1234' }), 1234)
  })

  test('nulls are blank, not the table\'s em dash', () => {
    assert.equal(exportCell(numCol, { total_revenue: null }), '')
    assert.equal(exportCell(textCol, {}), '')
  })
})

// ── live check: the generated SQL is valid against the real schema ────────────

function databaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    return m ? m[1].replace(/^["']|["']$/g, '') : null
  } catch {
    return null
  }
}

const url = databaseUrl()
const sql = url ? neon(url) : null

describe('export SQL runs against the real schema', () => {
  test('selecting every column returns one row with every key populated', async (t) => {
    if (!sql) {
      t.skip('DATABASE_URL not set — skipping live SQL check')
      return
    }
    const columns = resolveExportColumns(ALL_COLUMN_KEYS.join(','))
    const text = `
      SELECT ${buildSelectList(columns)}
      FROM filings f
      JOIN organizations o ON o.ein = f.ein
      ORDER BY f.total_revenue DESC NULLS LAST
      LIMIT 1
    `
    const rows = await sql.query(text)
    assert.equal(rows.length, 1, 'the export query returned no rows')
    for (const col of columns) {
      assert.ok(col.key in rows[0], `${col.key} missing from the result — alias or column name wrong`)
    }
  })
})
