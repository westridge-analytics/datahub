import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodLabels, sortByPeriod } from './filing-periods.ts'

// 38-3088234 as stored: a September year end, then a three-month return to move to December.
const FILINGS = [
  { id: 30, fiscal_year: 2024, tax_period: '2024-12-01T06:00:00.000Z' },
  { id: 28, fiscal_year: 2023, tax_period: '2023-09-01T05:00:00.000Z' },
  { id: 29, fiscal_year: 2024, tax_period: '2024-09-01T05:00:00.000Z' },
]

test('two returns in one fiscal year get distinct labels', () => {
  const l = periodLabels(FILINGS)
  assert.equal(l.get(28)!.label, 'FY 2023')
  assert.equal(l.get(29)!.label, 'FY 2024 · Sep')
  assert.equal(l.get(30)!.label, 'FY 2024 · Dec')
})

test('only the return ending under twelve months after the last is a short year', () => {
  const l = periodLabels(FILINGS)
  assert.deepEqual([28, 29, 30].map((id) => l.get(id)!.shortYear), [false, false, true])
})

test('filings sort by period, so the short year follows the full one', () => {
  assert.deepEqual(sortByPeriod(FILINGS).map((f) => f.id), [28, 29, 30])
})

test('Date values from a server component label the same as ISO strings', () => {
  const l = periodLabels(FILINGS.map((f) => ({ ...f, tax_period: new Date(f.tax_period) })))
  assert.equal(l.get(30)!.label, 'FY 2024 · Dec')
})
