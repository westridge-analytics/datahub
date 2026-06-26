import type { Filing } from '@/types'

// Low estimate: unrestricted net assets less illiquid fixed assets
export function calcM1(filing: Filing): number | null {
  if (filing.unrestr_net_assets === null || filing.ppe === null) return null
  return Math.round(filing.unrestr_net_assets - filing.ppe)
}

// High estimate: Low + deferred revenue + tax-exempt bonds liability
// (secured/unsecured notes not currently stored in DB)
export function calcM3(filing: Filing): number | null {
  const low = calcM1(filing)
  if (low === null) return null
  const deferred = filing.deferred_revenue ?? 0
  const bonds = filing.tax_exempt_bonds_liability ?? filing.tax_exempt_bonds ?? 0
  return Math.round(low + deferred + bonds)
}

// Midpoint: average of Low and High
export function calcM2(filing: Filing): number | null {
  const low = calcM1(filing)
  const high = calcM3(filing)
  if (low === null || high === null) return null
  return Math.round((low + high) / 2)
}

export function getMethodConfidence(method: 'M1' | 'M2' | 'M3'): 'Low' | 'Midpoint' | 'High' {
  return { M1: 'Low', M2: 'Midpoint', M3: 'High' }[method] as 'Low' | 'Midpoint' | 'High'
}

export function calcAllMethods(filing: Filing) {
  return { m1: calcM1(filing), m2: calcM2(filing), m3: calcM3(filing) }
}
