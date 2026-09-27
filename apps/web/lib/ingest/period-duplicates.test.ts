/**
 * Same-return-under-two-periods detection, run as the real SQL against a throwaway
 * `dupes_test` schema — the production filings table is never touched.
 *
 *   cd apps/web && npm run test:unit
 *
 * Fixtures mirror the rows a tester reported (20-4718511 FY2015, 56-2043649 FY2012–2013) and the
 * cases that must survive: a genuine short year, and a dormant org repeating itself a year apart.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import {
  buildDuplicatesTableSql,
  buildMoveDuplicatesSql,
  buildPeriodDuplicateQuery,
} from './period-duplicates.ts'

const SCHEMA = 'dupes_test'
const OPTS = { schema: SCHEMA }

function databaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    return m ? m[1].replace(/^["']|["']$/g, '') : null
  } catch {
    return null
  }
}

const url = databaseUrl()
const sql = url ? neon(url) : null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!sql) throw new Error('no database')
  return (await sql.query(text, params)) as T[]
}

interface F {
  ein: string
  tax_period: string
  source_file: string
  data_source?: 'soi_extract' | 'efile_xml'
  form_type?: string
  submission_date?: string | null
  rev?: number
  exp?: number
  assets?: number
}

// Same headline figures unless a case overrides them — the thing being detected.
const SAME = { rev: 1156366, exp: 686304, assets: 24906959 }

async function seed(rows: F[]): Promise<Map<string, number>> {
  await q(`TRUNCATE ${SCHEMA}.filings, ${SCHEMA}.filings_duplicates RESTART IDENTITY`)
  const ids = new Map<string, number>()
  for (const r of rows) {
    const f = { ...SAME, data_source: 'soi_extract', form_type: '990', submission_date: null, ...r }
    const [{ id }] = await q<{ id: number }>(
      `INSERT INTO ${SCHEMA}.filings
         (ein, tax_period, fiscal_year, form_type, data_source, source_file, submission_date,
          total_revenue, total_expenses, total_assets, total_liabilities, total_net_assets)
       VALUES ($1, $2::date, extract(year FROM $2::date), $3, $4, $5, $6, $7, $8, $9, 0, $9)
       RETURNING id`,
      [f.ein, f.tax_period, f.form_type, f.data_source, f.source_file, f.submission_date,
       f.rev, f.exp, f.assets])
    ids.set(`${f.ein} ${f.tax_period}`, id)
  }
  return ids
}

async function drops(): Promise<string[]> {
  const rows = await q<{ k: string }>(
    `SELECT f.ein || ' ' || f.tax_period::text || ' -> ' || k.tax_period::text AS k
     FROM (${buildPeriodDuplicateQuery(OPTS)}) p
     JOIN ${SCHEMA}.filings f ON f.id = p.drop_id
     JOIN ${SCHEMA}.filings k ON k.id = p.keep_id
     ORDER BY 1`)
  return rows.map((r) => r.k)
}

describe('same return stored under two tax periods', { skip: !sql && 'DATABASE_URL not set' }, () => {
  before(async () => {
    await q(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await q(`CREATE SCHEMA ${SCHEMA}`)
    await q(`CREATE TABLE ${SCHEMA}.filings (
      id serial PRIMARY KEY, ein text NOT NULL, tax_period date NOT NULL, fiscal_year int,
      form_type text, data_source text, source_file text, submission_date date,
      total_revenue bigint, total_expenses bigint, total_assets bigint,
      total_liabilities bigint, total_net_assets bigint,
      UNIQUE (ein, tax_period))`)
    for (const s of buildDuplicatesTableSql(OPTS)) await q(s)
  })

  after(async () => {
    await q(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  })

  test('20-4718511: the later extract wins, and the org keeps one FY2015 row', async () => {
    await seed([
      { ein: '20-4718511', tax_period: '2014-12-01', source_file: '15eofinextract990.dat', rev: 2385725 },
      { ein: '20-4718511', tax_period: '2015-06-01', source_file: '17eofinextract990.dat' },
      { ein: '20-4718511', tax_period: '2015-12-01', source_file: '16eofinextract990.dat' },
      { ein: '20-4718511', tax_period: '2016-06-01', source_file: '17eofinextract990.dat', rev: 5345680 },
    ])
    assert.deepEqual(await drops(), ['20-4718511 2015-12-01 -> 2015-06-01'])
  })

  test('56-2043649: every Dec/Mar pair collapses, the genuine 2017 short year survives', async () => {
    await seed([
      { ein: '56-2043649', tax_period: '2011-12-01', source_file: 'py14_990.dat', rev: 549063 },
      { ein: '56-2043649', tax_period: '2012-03-01', source_file: '16eofinextract990.dat', rev: 549063 },
      { ein: '56-2043649', tax_period: '2012-12-01', source_file: 'py13_990.dat', rev: 603054 },
      { ein: '56-2043649', tax_period: '2013-03-01', source_file: '16eofinextract990.dat', rev: 603054 },
      // Mar -> Jun change of fiscal year: a three-month return with its own figures.
      { ein: '56-2043649', tax_period: '2017-03-01', source_file: '17eofinextract990.dat', rev: 643760 },
      { ein: '56-2043649', tax_period: '2017-06-01', source_file: '17eofinextract990.dat', rev: 159177 },
    ])
    assert.deepEqual(await drops(), [
      '56-2043649 2011-12-01 -> 2012-03-01',
      '56-2043649 2012-12-01 -> 2013-03-01',
    ])
  })

  test('identical figures exactly twelve months apart are left alone', async () => {
    await seed([
      { ein: '84-4046676', tax_period: '2024-12-01', source_file: '2025_TEOS_XML_05B.zip' },
      { ein: '84-4046676', tax_period: '2025-12-01', source_file: '2026_TEOS_XML_04A.zip' },
    ])
    assert.deepEqual(await drops(), [])
  })

  test('all-zero filings are never matched', async () => {
    await seed([
      { ein: '11-1111111', tax_period: '2020-06-01', source_file: '21eoextract990.csv', rev: 0, exp: 0 },
      { ein: '11-1111111', tax_period: '2020-12-01', source_file: '21eoextract990.csv', rev: 0, exp: 0 },
    ])
    assert.deepEqual(await drops(), [])
  })

  test('a different form type is a different return', async () => {
    await seed([
      { ein: '22-2222222', tax_period: '2020-06-01', source_file: '21eoextract990.csv' },
      { ein: '22-2222222', tax_period: '2020-12-01', source_file: '21eoextractez.csv', form_type: '990EZ' },
    ])
    assert.deepEqual(await drops(), [])
  })

  test('e-file vs e-file: the later submission wins, as a resubmission would', async () => {
    await seed([
      { ein: '23-7378198', tax_period: '2023-12-01', source_file: '2025_TEOS_XML_05A.zip',
        data_source: 'efile_xml', submission_date: '2025-04-01' },
      { ein: '23-7378198', tax_period: '2024-06-01', source_file: '2025_TEOS_XML_11C.zip',
        data_source: 'efile_xml', submission_date: '2025-10-01' },
    ])
    assert.deepEqual(await drops(), ['23-7378198 2023-12-01 -> 2024-06-01'])
  })

  test('SOI outranks e-file, the same precedence the upsert applies', async () => {
    await seed([
      { ein: '33-3333333', tax_period: '2023-06-01', source_file: '24eoextract990.csv' },
      { ein: '33-3333333', tax_period: '2023-12-01', source_file: '2025_TEOS_XML_01A.zip',
        data_source: 'efile_xml', submission_date: '2025-01-10' },
    ])
    assert.deepEqual(await drops(), ['33-3333333 2023-12-01 -> 2023-06-01'])
  })

  test('same extract: the period matching the usual fiscal year end wins', async () => {
    await seed([
      { ein: '44-4444444', tax_period: '2013-06-01', source_file: 'py14_990.dat', rev: 10 },
      { ein: '44-4444444', tax_period: '2014-06-01', source_file: 'py14_990.dat', rev: 20 },
      { ein: '44-4444444', tax_period: '2015-03-01', source_file: '16eofinextract990.dat' },
      { ein: '44-4444444', tax_period: '2015-06-01', source_file: '16eofinextract990.dat' },
    ])
    assert.deepEqual(await drops(), ['44-4444444 2015-03-01 -> 2015-06-01'])
  })

  test('the move keeps every dropped row, records what it duplicated, and is idempotent', async () => {
    const ids = await seed([
      { ein: '20-4718511', tax_period: '2015-06-01', source_file: '17eofinextract990.dat' },
      { ein: '20-4718511', tax_period: '2015-12-01', source_file: '16eofinextract990.dat' },
    ])
    const [first] = await q<{ moved: number }>(buildMoveDuplicatesSql(OPTS))
    assert.equal(first.moved, 1)

    const left = await q<{ tax_period: string }>(`SELECT tax_period::text FROM ${SCHEMA}.filings`)
    assert.deepEqual(left.map((r) => r.tax_period), ['2015-06-01'])

    const [kept] = await q(`SELECT * FROM ${SCHEMA}.filings_duplicates`)
    assert.equal(kept.id, ids.get('20-4718511 2015-12-01'))
    assert.equal(kept.duplicate_of, ids.get('20-4718511 2015-06-01'))
    assert.equal(kept.source_file, '16eofinextract990.dat')
    assert.equal(Number(kept.total_revenue), SAME.rev)
    assert.ok(kept.moved_at)

    const [again] = await q<{ moved: number }>(buildMoveDuplicatesSql(OPTS))
    assert.equal(again.moved, 0)
  })
})
