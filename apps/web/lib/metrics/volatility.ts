// NOTE: CV ranges and cohort bucket thresholds are TBD — placeholder only.
// When finalized, update ONLY this file.
import type { VolatilityCohort } from '@/types'

export function calcVolatility(revenues: number[]): number | null {
  if (revenues.length < 2) return null
  const mean = revenues.reduce((a, b) => a + b, 0) / revenues.length
  if (mean === 0) return null
  const variance = revenues.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / revenues.length
  return Math.sqrt(variance) / mean
}

// TODO: thresholds TBD
export function getVolatilityCohort(cv: number): VolatilityCohort {
  if (cv < 0.05) return 'Very Stable'
  if (cv < 0.10) return 'Stable'
  if (cv < 0.20) return 'Moderate'
  if (cv < 0.35) return 'Volatile'
  return 'Very Volatile'
}

export const VOLATILITY_COHORTS: VolatilityCohort[] = [
  'Very Stable',
  'Stable',
  'Moderate',
  'Volatile',
  'Very Volatile',
]
