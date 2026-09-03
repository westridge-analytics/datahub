#!/usr/bin/env node
/**
 * Cross-language parity for the ingestion write path.
 *
 *   node scripts/test-sql-parity.mjs
 *   (also runs as part of `cd apps/web && npm test`)
 *
 * Two writers touch `filings`: /api/ingest/batch in TypeScript and
 * scripts/efile_ingest.py for bulk loads. Both generate their upsert from
 * apps/web/lib/ingest/write-contract.json, and this asserts they really do
 * produce the same statement.
 *
 * Precedence is the reason this test exists. That rule decides what overwrites
 * production data, so a divergence between the two writers would mean the CLI
 * quietly applying different rules from the ones every unit test covers — and
 * the backfill runs through the CLI.
 *
 * Placeholder syntax legitimately differs ($1 vs %s), as does whitespace, so
 * both are normalised away. Everything else must match exactly.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'apps/web')

/** SQL equivalence, not formatting equivalence. */
function normalise(sql) {
  return sql
    .replace(/\$\d+|%\(\w+\)s|%s/g, '?')  // psycopg2 named params vs neon's $N
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')  // spacing around punctuation
    .trim()
}

function tsUpsert({ rows, dataSource, mode, schema }) {
  const script = `
    import("./lib/ingest/upsert-sql.ts").then((m) => {
      const rows = ${JSON.stringify(rows)}
      process.stdout.write(m.buildFilingsUpsert(
        rows, ${JSON.stringify(dataSource)}, ${JSON.stringify(mode)}, "x.zip",
        ${schema ? JSON.stringify({ schema }) : 'undefined'}).sql)
    })`
  return execFileSync(process.execPath, ['-e', script], { cwd: WEB, encoding: 'utf8' })
}

function pyUpsert({ rows, mode, schema }) {
  const script = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('ei', 'scripts/efile_ingest.py')
ei = importlib.util.module_from_spec(spec); spec.loader.exec_module(ei)
sys.stdout.write(ei.build_upsert(${rows.length}, '%(mode)s', ${schema ? `'${schema}'` : 'None'}))`
  return execFileSync('python3', ['-c', script], { cwd: ROOT, encoding: 'utf8' })
}

describe('write-path parity between the API and the bulk CLI', () => {
  for (const scenario of [
    { name: 'single row, skip, public schema', rows: [{ ein: '11-1111111', tax_period: '2024-12-01' }], mode: 'skip', schema: null },
    { name: 'single row, overwrite', rows: [{ ein: '11-1111111', tax_period: '2024-12-01' }], mode: 'overwrite', schema: null },
    { name: 'multi-row batch', rows: [{ ein: '11-1111111', tax_period: '2024-12-01' }, { ein: '22-2222222', tax_period: '2023-06-01' }, { ein: '33-3333333', tax_period: '2025-03-01' }], mode: 'skip', schema: null },
    { name: 'qualified schema', rows: [{ ein: '11-1111111', tax_period: '2024-12-01' }], mode: 'skip', schema: 'ingest_test' },
  ]) {
    test(`${scenario.name}: identical SQL`, () => {
      const ts = normalise(tsUpsert({ ...scenario, dataSource: 'efile_xml' }))
      const py = normalise(pyUpsert(scenario))
      assert.ok(ts.length > 500, 'the TypeScript builder produced nothing usable')
      assert.equal(py, ts,
        'the CLI and the API generate different SQL — the shared write contract has been ' +
        'bypassed on one side, and the backfill runs through the CLI')
    })
  }

  test('the precedence rule is present, not accidentally normalised away', () => {
    const ts = normalise(tsUpsert({
      rows: [{ ein: '11-1111111', tax_period: '2024-12-01' }],
      dataSource: 'efile_xml', mode: 'skip', schema: null,
    }))
    assert.match(ts, /data_source = 'efile_xml'/,
      'the e-file resubmission branch must appear in the statement')
    assert.match(ts, /submission_date >= /, 'the later-submission-wins comparison must appear')
    assert.match(ts, /COALESCE/, 'field-level precedence must be COALESCE-based')
    assert.match(ts, /'superseded'/, 'the audit action must distinguish a supersession')
  })
})
