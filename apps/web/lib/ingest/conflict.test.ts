/**
 * Source-precedence and conflict-resolution tests for the ingestion write path.
 *
 *   cd apps/web && npm run test:unit
 *
 * These run the *exact* SQL that /api/ingest/batch executes in production, but
 * against a throwaway `ingest_test` schema built and dropped by the test — the
 * real filings table is never touched. Table names are parameterised for this
 * purpose (see BuildOptions in upsert-sql.ts).
 *
 * Skips itself with a clear message if DATABASE_URL is absent.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import {
  UPSERT_COLUMNS,
  buildFilingsUpsert,
  buildMissingEinsQuery,
  buildOrganizationsUpsert,
  buildPreflightQuery,
} from './upsert-sql.ts'
import type { ConflictMode, DataSource } from './upsert-sql.ts'

const SCHEMA = 'ingest_test'
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

interface Row {
  ein: string
  tax_period: string
  total_revenue?: number | null
  num_employees?: number | null
  object_id?: string | null
  submission_date?: string | null
  fiscal_year?: number
  [k: string]: unknown
}

function row(over: Partial<Row> & Pick<Row, 'ein' | 'tax_period'>): Row {
  return { fiscal_year: Number(over.tax_period!.slice(0, 4)), ...over } as Row
}

async function load(
  rows: Row[],
  dataSource: DataSource,
  mode: ConflictMode,
  sourceFile = 'test.csv',
): Promise<Record<string, number>> {
  await seedOrgs(rows)
  const built = buildFilingsUpsert(rows, dataSource, mode, sourceFile, OPTS)
  const audited = await q<{ action: string }>(built.sql, built.params)
  const counts = { inserted: rows.length - audited.length, overwritten: 0, superseded: 0, skipped: 0 }
  for (const a of audited) {
    if (a.action === 'overwritten') counts.overwritten++
    else if (a.action === 'superseded') counts.superseded++
    else counts.skipped++
  }
  return counts
}

async function stored(ein: string, taxPeriod: string) {
  const r = await q(
    `SELECT total_revenue, num_employees, data_source, object_id, source_file,
            to_char(submission_date,'YYYY-MM-DD') AS submission_date
     FROM "${SCHEMA}".filings WHERE ein = $1 AND tax_period = $2`,
    [ein, taxPeriod],
  )
  return r[0]
}

async function reset() {
  await q(`TRUNCATE "${SCHEMA}".filings, "${SCHEMA}".ingest_audit, "${SCHEMA}".organizations`)
}

/** The precedence tests care about filings, not the FK; give every EIN an org. */
async function seedOrgs(rows: Row[]) {
  const eins = [...new Set(rows.map((r) => r.ein))]
  const params: unknown[] = []
  const values = eins.map((e) => { params.push(e); return `($${params.length}, 'TEST ORG')` })
  await q(`INSERT INTO "${SCHEMA}".organizations (ein, name) VALUES ${values.join(',')}
           ON CONFLICT (ein) DO NOTHING`, params)
}

describe('Ingestion source precedence', { skip: url ? false : 'DATABASE_URL not set' }, () => {
  before(async () => {
    await q(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
    await q(`CREATE SCHEMA "${SCHEMA}"`)
    // Mirror only the columns the write path touches, plus one (num_employees)
    // that the uploader never sends — that is what proves COALESCE behaviour.
    // name is NOT NULL in production; the scratch schema must match or the
    // regression that broke all 684 batches would not reproduce here.
    await q(`CREATE TABLE "${SCHEMA}".organizations (
      ein TEXT PRIMARY KEY, name TEXT NOT NULL
    )`)
    // Derived from UPSERT_COLUMNS rather than hand-written. A hand-written
    // mirror silently drifts: adding six columns to the write path broke every
    // test here because the scratch table had never heard of them, and an
    // earlier drift (name TEXT vs name TEXT NOT NULL) hid a regression that
    // failed all 684 batches of a real load.
    const PG: Record<string, string> = {
      text: 'TEXT', date: 'DATE', int: 'INTEGER', bigint: 'BIGINT', boolean: 'BOOLEAN',
    }
    const cols = UPSERT_COLUMNS.map((c) => {
      if (c.name === 'ein') return 'ein TEXT NOT NULL'
      if (c.name === 'tax_period') return 'tax_period DATE NOT NULL'
      if (c.name === 'data_source') return "data_source TEXT NOT NULL DEFAULT 'soi_extract'"
      if (c.name === 'form_type') return "form_type TEXT DEFAULT '990'"
      return `${c.name} ${PG[c.type]}`
    })
    await q(`CREATE TABLE "${SCHEMA}".filings (
      id SERIAL PRIMARY KEY,
      ${cols.join(',\n      ')},
      UNIQUE (ein, tax_period)
    )`)

    await q(`CREATE TABLE "${SCHEMA}".ingest_audit (
      id BIGSERIAL PRIMARY KEY, ein TEXT NOT NULL, tax_period DATE NOT NULL,
      form_type TEXT, action TEXT NOT NULL,
      losing_source TEXT, losing_object_id TEXT, losing_submission_date DATE,
      winning_source TEXT, winning_object_id TEXT, winning_submission_date DATE,
      source_file TEXT, loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  })

  after(async () => {
    if (url) await q(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  })

  test('a first load inserts and audits nothing', async () => {
    await reset()
    const c = await load([row({ ein: '11-1111111', tax_period: '2024-12-01', total_revenue: 100 })],
      'efile_xml', 'skip')
    assert.equal(c.inserted, 1)
    assert.equal(c.skipped, 0)
    const audit = await q(`SELECT count(*)::int n FROM "${SCHEMA}".ingest_audit`)
    assert.equal(audit[0].n, 0, 'a plain insert is not a conflict')
  })

  test('SOI over e-file with skip leaves the stored row untouched', async () => {
    await reset()
    await load([row({ ein: '22-2222222', tax_period: '2024-12-01', total_revenue: 500 })],
      'efile_xml', 'skip')
    const c = await load([row({ ein: '22-2222222', tax_period: '2024-12-01', total_revenue: 999 })],
      'soi_extract', 'skip')

    assert.equal(c.skipped, 1)
    assert.equal(c.overwritten, 0)
    const s = await stored('22-2222222', '2024-12-01')
    assert.equal(Number(s.total_revenue), 500, 'e-file value must survive a skipped SOI load')
    assert.equal(s.data_source, 'efile_xml')
  })

  test('SOI over e-file with overwrite replaces the row', async () => {
    await reset()
    await load([row({ ein: '33-3333333', tax_period: '2024-12-01', total_revenue: 500 })],
      'efile_xml', 'skip')
    const c = await load([row({ ein: '33-3333333', tax_period: '2024-12-01', total_revenue: 999 })],
      'soi_extract', 'overwrite')

    assert.equal(c.overwritten, 1)
    const s = await stored('33-3333333', '2024-12-01')
    assert.equal(Number(s.total_revenue), 999)
    assert.equal(s.data_source, 'soi_extract')
  })

  // The regression this whole design exists to prevent.
  test('an overwrite never blanks a populated field the winner has no value for', async () => {
    await reset()
    await q(`INSERT INTO "${SCHEMA}".filings
             (ein, tax_period, fiscal_year, total_revenue, num_employees, data_source)
             VALUES ('44-4444444','2024-12-01',2024, 500, 43, 'efile_xml')`)

    await load([row({ ein: '44-4444444', tax_period: '2024-12-01', total_revenue: 999 })],
      'soi_extract', 'overwrite')

    const s = await stored('44-4444444', '2024-12-01')
    assert.equal(Number(s.total_revenue), 999, 'SOI wins where it has a value')
    assert.equal(Number(s.num_employees), 43, 'and must not blank what it has no value for')
  })

  test('e-file over SOI is skipped by default, even in overwrite it is the operator choice', async () => {
    await reset()
    await load([row({ ein: '55-5555555', tax_period: '2023-12-01', total_revenue: 700 })],
      'soi_extract', 'skip')

    const skipped = await load([row({ ein: '55-5555555', tax_period: '2023-12-01', total_revenue: 111 })],
      'efile_xml', 'skip')
    assert.equal(skipped.skipped, 1)
    assert.equal(Number((await stored('55-5555555', '2023-12-01')).total_revenue), 700)

    const forced = await load([row({ ein: '55-5555555', tax_period: '2023-12-01', total_revenue: 111 })],
      'efile_xml', 'overwrite')
    assert.equal(forced.overwritten, 1)
    assert.equal(Number((await stored('55-5555555', '2023-12-01')).total_revenue), 111)
  })

  test('a later e-file submission supersedes an earlier one without asking', async () => {
    await reset()
    await load([row({
      ein: '66-6666666', tax_period: '2024-12-01', total_revenue: 100,
      object_id: 'OBJ-A', submission_date: '2025-03-01',
    })], 'efile_xml', 'skip')

    // Note mode is 'skip': supersession must happen regardless of the operator's
    // cross-source choice, because a resubmission is not a cross-source conflict.
    const c = await load([row({
      ein: '66-6666666', tax_period: '2024-12-01', total_revenue: 200,
      object_id: 'OBJ-B', submission_date: '2025-09-15',
    })], 'efile_xml', 'skip')

    assert.equal(c.superseded, 1, 'newer submission wins automatically')
    assert.equal(c.skipped, 0)
    const s = await stored('66-6666666', '2024-12-01')
    assert.equal(Number(s.total_revenue), 200)
    assert.equal(s.object_id, 'OBJ-B')

    const audit = await q(`SELECT action, losing_object_id, winning_object_id
                           FROM "${SCHEMA}".ingest_audit WHERE ein = '66-6666666'`)
    assert.equal(audit.length, 1)
    assert.equal(audit[0].action, 'superseded')
    assert.equal(audit[0].losing_object_id, 'OBJ-A', 'audit records which submission lost')
    assert.equal(audit[0].winning_object_id, 'OBJ-B')
  })

  test('an earlier e-file submission does not overwrite a later one', async () => {
    await reset()
    await load([row({
      ein: '77-7777777', tax_period: '2024-12-01', total_revenue: 200,
      object_id: 'OBJ-NEW', submission_date: '2025-09-15',
    })], 'efile_xml', 'skip')

    const c = await load([row({
      ein: '77-7777777', tax_period: '2024-12-01', total_revenue: 100,
      object_id: 'OBJ-OLD', submission_date: '2025-03-01',
    })], 'efile_xml', 'overwrite')

    assert.equal(c.skipped, 1, 'out-of-order archive loads must not regress data')
    const s = await stored('77-7777777', '2024-12-01')
    assert.equal(Number(s.total_revenue), 200)
    assert.equal(s.object_id, 'OBJ-NEW')
  })

  test('re-running the same load is idempotent', async () => {
    await reset()
    const r = [row({
      ein: '88-8888888', tax_period: '2024-12-01', total_revenue: 321,
      object_id: 'OBJ-X', submission_date: '2025-05-01',
    })]
    await load(r, 'efile_xml', 'skip')
    await load(r, 'efile_xml', 'skip')
    const n = await q(`SELECT count(*)::int c FROM "${SCHEMA}".filings WHERE ein='88-8888888'`)
    assert.equal(n[0].c, 1)
    assert.equal(Number((await stored('88-8888888', '2024-12-01')).total_revenue), 321)
  })

  test('preflight reports what each key already holds', async () => {
    await reset()
    await load([row({ ein: '91-1111111', tax_period: '2024-12-01', total_revenue: 1 })],
      'efile_xml', 'skip')
    await load([row({ ein: '92-2222222', tax_period: '2023-12-01', total_revenue: 2 })],
      'soi_extract', 'skip')

    const built = buildPreflightQuery([
      { ein: '91-1111111', tax_period: '2024-12-01' },
      { ein: '92-2222222', tax_period: '2023-12-01' },
      { ein: '99-9999999', tax_period: '2024-12-01' },
    ], OPTS)
    const found = await q(built.sql, built.params)

    assert.equal(found.length, 2, 'only existing keys come back')
    const bySource = Object.fromEntries(found.map((f) => [f.ein, f.data_source]))
    assert.equal(bySource['91-1111111'], 'efile_xml')
    assert.equal(bySource['92-2222222'], 'soi_extract')
    assert.ok(!found.some((f) => f.ein === '99-9999999'), 'unknown key is absent, i.e. new')
  })

  test('mixed batch counts inserts, skips and supersessions separately', async () => {
    await reset()
    await load([
      row({ ein: '81-1111111', tax_period: '2024-12-01', total_revenue: 10, object_id: 'A', submission_date: '2025-01-01' }),
      row({ ein: '82-2222222', tax_period: '2024-12-01', total_revenue: 20 }),
    ], 'efile_xml', 'skip')
    await load([row({ ein: '83-3333333', tax_period: '2024-12-01', total_revenue: 30 })],
      'soi_extract', 'skip')

    const c = await load([
      // supersedes 81 (later submission)
      row({ ein: '81-1111111', tax_period: '2024-12-01', total_revenue: 11, object_id: 'B', submission_date: '2025-06-01' }),
      // loses to SOI-held 83 under skip
      row({ ein: '83-3333333', tax_period: '2024-12-01', total_revenue: 31 }),
      // brand new
      row({ ein: '84-4444444', tax_period: '2024-12-01', total_revenue: 40 }),
    ], 'efile_xml', 'skip')

    assert.deepEqual(
      { inserted: c.inserted, superseded: c.superseded, skipped: c.skipped, overwritten: c.overwritten },
      { inserted: 1, superseded: 1, skipped: 1, overwritten: 0 },
    )
  })
  // ── organizations / foreign key ────────────────────────────────────────────
  // These cover the failure that broke every batch of a real 341,514-row load:
  // organizations.name is NOT NULL, the SOI extracts carry no name column, and
  // the org upsert sent an explicit NULL for all of them.

  test('a nameless load issues no organizations write at all', async () => {
    await reset()
    const rows = [row({ ein: '31-1111111', tax_period: '2024-12-01', total_revenue: 1 })]
    assert.equal(
      buildOrganizationsUpsert(rows, OPTS), null,
      'SOI rows have no name — sending NULL into a NOT NULL column fails the batch',
    )
  })

  test('a load that does carry names writes them, without renaming known orgs', async () => {
    await reset()
    await q(`INSERT INTO "${SCHEMA}".organizations (ein, name) VALUES ('32-2222222','BMF CANONICAL NAME')`)

    const built = buildOrganizationsUpsert([
      { ein: '32-2222222', name: 'E-FILE SUPPLIED NAME' },
      { ein: '33-3333333', name: 'BRAND NEW ORG' },
    ], OPTS)
    assert.ok(built, 'rows with names must produce a write')
    await q(built.sql, built.params)

    const r = await q(`SELECT ein, name FROM "${SCHEMA}".organizations ORDER BY ein`)
    const byEin = Object.fromEntries(r.map((x) => [x.ein, x.name]))
    assert.equal(byEin['32-2222222'], 'BMF CANONICAL NAME', 'the BMF name is authoritative')
    assert.equal(byEin['33-3333333'], 'BRAND NEW ORG', 'a genuinely new org is created')
  })

  test('buildMissingEinsQuery finds exactly the EINs with no organization', async () => {
    await reset()
    await q(`INSERT INTO "${SCHEMA}".organizations (ein, name) VALUES ('34-4444444','KNOWN ORG')`)

    const built = buildMissingEinsQuery(['34-4444444', '35-5555555', '36-6666666'], OPTS)
    const missing = (await q(built.sql, built.params)).map((r) => r.ein).sort()
    assert.deepEqual(missing, ['35-5555555', '36-6666666'])
  })

  test('a filing for a known EIN loads normally', async () => {
    await reset()
    await q(`INSERT INTO "${SCHEMA}".organizations (ein, name) VALUES ('37-7777777','KNOWN ORG')`)
    const c = await load([row({ ein: '37-7777777', tax_period: '2024-12-01', total_revenue: 42 })],
      'soi_extract', 'skip')
    assert.equal(c.inserted, 1)
    assert.equal(Number((await stored('37-7777777', '2024-12-01')).total_revenue), 42)
  })
})
