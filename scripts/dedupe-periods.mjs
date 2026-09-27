#!/usr/bin/env node
/**
 * Moves returns stored twice under two different tax periods into `filings_duplicates`.
 * Detection and precedence live in apps/web/lib/ingest/period-duplicates.ts — see there for the
 * rule and apps/web/lib/ingest/period-duplicates.test.ts for the cases it must and must not match.
 *
 *   node scripts/dedupe-periods.mjs            # dry run: counts and a sample, writes nothing
 *   node scripts/dedupe-periods.mjs --apply    # move them (idempotent; safe to re-run after a load)
 *
 * Reverse a move with:
 *   INSERT INTO filings SELECT <filings columns> FROM filings_duplicates WHERE ...;
 */

import { readFileSync } from 'node:fs'
import { neon } from '../apps/web/node_modules/@neondatabase/serverless/index.mjs'
import {
  buildDuplicatesTableSql,
  buildMoveDuplicatesSql,
  buildPeriodDuplicateQuery,
} from '../apps/web/lib/ingest/period-duplicates.ts'

function databaseUrl() {
  if (process.env.DATABASE_URL_UNPOOLED) return process.env.DATABASE_URL_UNPOOLED
  const env = readFileSync(new URL('../apps/web/.env.local', import.meta.url), 'utf8')
  const m = env.match(/^DATABASE_URL_UNPOOLED=(.*)$/m) ?? env.match(/^DATABASE_URL=(.*)$/m)
  return m[1].replace(/^["']|["']$/g, '')
}

const apply = process.argv.includes('--apply')
const sql = neon(databaseUrl())

const rows = await sql.query(`
  WITH p AS (${buildPeriodDuplicateQuery()})
  SELECT d.ein, d.form_type, d.data_source, d.source_file, d.tax_period::text AS dropped,
         k.source_file AS kept_source, k.tax_period::text AS kept
  FROM p JOIN filings d ON d.id = p.drop_id JOIN filings k ON k.id = p.keep_id
  ORDER BY d.ein, d.tax_period`)

const byKind = {}
for (const r of rows) {
  const k = `${r.form_type} ${r.data_source}`
  byKind[k] = (byKind[k] ?? 0) + 1
}
console.log(`${rows.length} duplicate rows across ${new Set(rows.map((r) => r.ein)).size} EINs`)
console.table(byKind)
console.table(rows.slice(0, 15))

if (!apply) {
  console.log('\nDry run — nothing written. Re-run with --apply to move them.')
} else {
  for (const s of buildDuplicatesTableSql()) await sql.query(s)
  const [{ moved }] = await sql.query(buildMoveDuplicatesSql())
  console.log(`\nMoved ${moved} rows into filings_duplicates.`)
}
