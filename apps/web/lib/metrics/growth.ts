// NOTE: CAGR thresholds are TBD — placeholder only.
// When finalized, update ONLY this file.
import type { GrowthCohort } from '@/types'

export function calcCAGR(
  startRevenue: number,
  endRevenue: number,
  years: number,
): number | null {
  if (startRevenue <= 0 || years <= 0) return null
  return Math.pow(endRevenue / startRevenue, 1 / years) - 1
}

// TODO: thresholds TBD
export function getGrowthCohort(cagr: number): GrowthCohort {
  if (cagr < -0.02) return 'Shrinking'
  if (cagr < 0.02) return 'Flat'
  if (cagr < 0.05) return 'Slow Growth'
  if (cagr < 0.10) return 'Moderate Growth'
  return 'High Growth'
}

export const GROWTH_COHORTS: GrowthCohort[] = [
  'Shrinking',
  'Flat',
  'Slow Growth',
  'Moderate Growth',
  'High Growth',
]
