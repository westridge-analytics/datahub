import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcM1, calcM2, calcM3 } from './unrestricted-cash.ts'
import { calcEarned, calcContributed, calcPersonnelPct } from './custom-metrics.ts'

// Neon's serverless driver returns BIGINT columns as STRINGS. These tests feed
// string-valued fields (as the live API does) to guard against the string-
// concatenation bug where `number + "205730"` produced trillions.

// The Building For Kids FY2023 — values verified against source spreadsheet.
const buildingForKids = {
  unrestr_net_assets: '1660547',
  ppe: '1163697',
  deferred_revenue: '205730',
  tax_exempt_bonds_liability: '0',
  secured_mortgages: '0',
  unsecured_notes: '44615',
  program_revenue: '1062097',
  contributions: '1020675',
  total_expenses: '2008071',
  comp_officers: '96885',
  comp_other_salaries: '639336',
  pension_contributions: '14145',
  employee_benefits: '81549',
  payroll_taxes: '57868',
} as never

describe('unrestricted-cash (BIGINT-as-string safe)', () => {
  test('Low = unrestr_net_assets − ppe', () => {
    assert.equal(calcM1(buildingForKids), 496850)
  })
  test('High sums components numerically, not by string concat', () => {
    assert.equal(calcM3(buildingForKids), 747195)
  })
  test('Midpoint = avg(Low, High)', () => {
    assert.equal(calcM2(buildingForKids), 622023) // rounded from 622022.5
  })
  test('High never balloons into the trillions', () => {
    const high = calcM3(buildingForKids)!
    assert.ok(Math.abs(high) < 1e12, `High was ${high}`)
  })
})

describe('custom-metrics (BIGINT-as-string safe)', () => {
  test('Earned sums revenue lines numerically', () => {
    // program_revenue only (others absent) → 1062097
    assert.equal(calcEarned(buildingForKids), 1062097)
  })
  test('Contributed is numeric', () => {
    assert.equal(calcContributed(buildingForKids), 1020675)
  })
  test('Personnel % is a fraction, not concatenated garbage', () => {
    const pct = calcPersonnelPct(buildingForKids)!
    // (96885+639336+14145+81549+57868)/2008071 ≈ 0.443
    assert.ok(pct > 0.4 && pct < 0.5, `pct was ${pct}`)
  })
})
