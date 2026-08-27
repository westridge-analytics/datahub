#!/usr/bin/env node
/**
 * API smoke tests for the 990 Research App.
 *
 * Usage:
 *   node scripts/test-api.mjs                  # tests http://localhost:3000
 *   node scripts/test-api.mjs https://your-app.vercel.app
 *
 * Run the dev server first: cd apps/web && npm run dev
 *
 * Exits 0 if all tests pass, 1 if any fail.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

const BASE = process.argv[2] ?? 'http://localhost:3000'

// ── helpers ───────────────────────────────────────────────────────────────────

async function get(path) {
  const url = `${BASE}${path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} on GET ${path}`)
  return res.json()
}

async function filings(params = {}) {
  const qs = new URLSearchParams({
    sort_by: 'total_revenue',
    sort_dir: 'desc',
    page: '1',
    page_size: '100',
    ...params,
  })
  return get(`/api/filings?${qs}`)
}

// ── test suites ───────────────────────────────────────────────────────────────

describe('Default load', () => {
  test('returns 100 rows with no filters', async () => {
    const json = await filings()
    assert.ok(Array.isArray(json.data), 'data should be an array')
    assert.equal(json.data.length, 100, `expected 100 rows, got ${json.data.length}`)
  })

  test('total row count is in the millions', async () => {
    const json = await filings()
    assert.ok(json.total > 1_000_000, `total should be >1M, got ${json.total}`)
  })

  test('each row has required fields', async () => {
    const json = await filings()
    const row = json.data[0]
    for (const field of ['ein', 'name', 'total_revenue', 'fiscal_year', 'state']) {
      assert.ok(field in row, `row missing field: ${field}`)
    }
  })
})

describe('Search', () => {
  test('exact multi-word name search returns results', async () => {
    const json = await filings({ search: 'madison childrens museum' })
    assert.ok(json.data.length > 0, 'expected results for "madison childrens museum"')
    const names = json.data.map(r => r.name)
    assert.ok(
      names.some(n => n.toUpperCase().includes('MADISON') && n.toUpperCase().includes('CHILDREN')),
      `expected a madison children match in: ${names.slice(0, 3).join(', ')}`
    )
  })

  test('word-order-independent search works', async () => {
    const json = await filings({ search: 'children madison museum' })
    assert.ok(json.data.length > 0, 'word-order search returned nothing')
  })

  test('art institute chicago is found (was missing from original BMF)', async () => {
    const json = await filings({ search: 'art institute chicago' })
    assert.ok(json.data.length > 0, 'no results for art institute chicago')
    const names = json.data.map(r => r.name.toUpperCase())
    assert.ok(
      names.some(n => n.includes('ART INSTITUTE') && n.includes('CHICAGO')),
      `Art Institute of Chicago not in results: ${names.slice(0, 5).join(', ')}`
    )
  })

  test('EIN search returns that org', async () => {
    const json = await filings({ search: '39-1383497' })
    assert.ok(json.data.length > 0, 'EIN search returned nothing')
    assert.ok(
      json.data.some(r => r.ein === '39-1383497'),
      'EIN not found in results'
    )
  })

  test('environment and culture partners is found (was missing — eo3/eo4 BMF files never ingested)', async () => {
    const json = await filings({ search: '87-1213015' })
    assert.ok(json.data.length > 0, 'no results for EIN 87-1213015')
    assert.ok(
      json.data.some(r => r.ein === '87-1213015' && r.name.toUpperCase().includes('ENVIRONMENT AND CULTURE PARTNERS')),
      'Environment And Culture Partners not in results'
    )
  })

  test('search does not return 500', async () => {
    // Previously broken — Postgres param count mismatch
    const json = await filings({ search: 'madison children' })
    assert.ok(!json.error, `API returned error: ${json.error}`)
  })

  test('search result count is reasonable (not thousands for a specific name)', async () => {
    const json = await filings({ search: 'madison childrens museum' })
    // Before FTS fix this returned 1441 results
    assert.ok(json.total < 50, `too many results (${json.total}) — search too broad`)
  })
})

describe('Sorting', () => {
  test('revenue sort descending puts highest revenue first', async () => {
    const json = await filings({ sort_by: 'total_revenue', sort_dir: 'desc' })
    // Neon returns NUMERIC as strings; parse to float before comparing
    const revenues = json.data.map(r => r.total_revenue == null ? null : parseFloat(r.total_revenue)).filter(v => v != null)
    for (let i = 1; i < revenues.length; i++) {
      assert.ok(revenues[i - 1] >= revenues[i], `revenue not sorted desc at index ${i}: ${revenues[i-1]} < ${revenues[i]}`)
    }
  })

  test('sort by fiscal_year works', async () => {
    const json = await filings({ sort_by: 'fiscal_year', sort_dir: 'desc' })
    assert.equal(json.data.length, 100)
    assert.ok(json.data[0].fiscal_year != null)
  })
})

describe('Filters', () => {
  test('state filter returns only that state', async () => {
    const json = await filings({ state: 'WI' })
    assert.ok(json.data.length > 0, 'no WI results')
    assert.ok(json.data.every(r => r.state === 'WI'), 'non-WI row in state filter results')
  })

  test('multi-value state filter (comma-separated) returns only those states', async () => {
    const json = await filings({ state: 'WI,MN' })
    assert.ok(json.data.length > 0, 'no WI/MN results')
    assert.ok(json.data.every(r => r.state === 'WI' || r.state === 'MN'), 'row outside WI/MN in multi-state filter results')
  })

  test('sector filter returns only matching NTEE category', async () => {
    const json = await filings({ ntee_category: 'Education' })
    assert.ok(json.data.length > 0, 'no Education results')
    assert.ok(json.data.every(r => r.ntee_category === 'Education'), 'non-Education row in sector filter results')
  })

  test('ntee_category is always a known NTEE value', async () => {
    const json = await filings({})
    const knownNtee = ['Arts, Culture & Humanities','Education','Environment & Animals','Health',
      'Human Services','International & Foreign Affairs','Public & Societal Benefit',
      'Religion','Mutual & Membership Benefit','Other']
    const bad = json.data.filter(r => r.ntee_category && !knownNtee.includes(r.ntee_category))
    assert.equal(bad.length, 0, `unexpected ntee_category values: ${[...new Set(bad.map(r => r.ntee_category))].join(', ')}`)
  })

  test('year_min filter works', async () => {
    const json = await filings({ year_min: '2022' })
    assert.ok(json.data.every(r => r.fiscal_year >= 2022), 'row before year_min found')
  })

  test('search + ntee_category filter both apply (not silently ignored)', async () => {
    const json = await filings({ search: 'children', ntee_category: 'Health' })
    assert.ok(json.data.length > 0, 'no results for search+filter combo')
    assert.ok(json.data.every(r => r.ntee_category === 'Health'), 'non-Health row returned when filter active with search')
  })
})

describe('Pagination', () => {
  test('page 2 returns different rows than page 1', async () => {
    const [p1, p2] = await Promise.all([filings({ page: '1' }), filings({ page: '2' })])
    const eins1 = new Set(p1.data.map(r => r.ein + r.fiscal_year))
    const overlap = p2.data.filter(r => eins1.has(r.ein + r.fiscal_year))
    assert.equal(overlap.length, 0, `${overlap.length} rows appear on both pages`)
  })
})

describe('Export', () => {
  // /api/export requires a logged-in session, so this suite can't drive the
  // full authenticated download. It guards the specific regression that
  // shipped previously: the route only exported POST, so GET (and, before
  // the frontend/backend contract was fixed, any mismatched request) came
  // back as 405 Method Not Allowed instead of reaching the auth check.
  test('GET with filters is routed (not 405) — auth redirect, not method-not-allowed', async () => {
    const qs = new URLSearchParams({ format: 'csv', state: 'WI', sort_by: 'total_revenue', sort_dir: 'desc' })
    const res = await fetch(`${BASE}/api/export?${qs}`, { redirect: 'manual' })
    assert.notEqual(res.status, 405, 'export route rejected GET — frontend/backend method mismatch has regressed')
    assert.ok([302, 307, 200].includes(res.status), `expected an auth redirect or success, got ${res.status}`)
  })

  // The Institution page's Export link (`/api/export?ein=...`) predates the
  // format/sort_by params and was broken the same way (GET on a POST-only
  // route). Same auth-gated assertion, just via the ein-scoped path.
  test('GET with ein param is routed (not 405)', async () => {
    const qs = new URLSearchParams({ format: 'csv', ein: '53-0196605', sort_by: 'fiscal_year', sort_dir: 'desc' })
    const res = await fetch(`${BASE}/api/export?${qs}`, { redirect: 'manual' })
    assert.notEqual(res.status, 405, 'ein-scoped export rejected GET')
    assert.ok([302, 307, 200].includes(res.status), `expected an auth redirect or success, got ${res.status}`)
  })
})

describe('BIGINT-as-number contract', () => {
  // Neon returns int8/BIGINT as strings by default; lib/db.ts installs a global
  // parser so financial columns come back as JS numbers. If that regresses,
  // arithmetic silently concatenates ("number" + "205730") and charts break.
  // /api/filings is public, so this exercises the parser end-to-end through the
  // shared DB layer that every route (incl. the auth-gated visualization
  // endpoints) relies on.
  test('filings: financial fields are numbers, not strings', async () => {
    const json = await filings()
    const row = json.data.find(r => r.total_revenue != null)
    assert.equal(typeof row.total_revenue, 'number', 'total_revenue should be a number')
    assert.ok(json.total > 1_000_000 && typeof json.total === 'number', 'count total should be a number')
  })
})
