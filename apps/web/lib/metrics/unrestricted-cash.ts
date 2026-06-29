import type { Filing } from '@/types'

// Neon returns BIGINT columns as strings; coerce to number (null/undefined → null)
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Low estimate: unrestricted net assets less illiquid fixed assets
export function calcM1(filing: Filing): number | null {
  const una = num(filing.unrestr_net_assets)
  const ppe = num(filing.ppe)
  if (una === null || ppe === null) return null
  return Math.round(una - ppe)
}

// High estimate: Low + deferred revenue + tax-exempt bonds + secured mortgages + unsecured notes
export function calcM3(filing: Filing): number | null {
  const low = calcM1(filing)
  if (low === null) return null
  const deferred = num(filing.deferred_revenue) ?? 0
  const bonds = num(filing.tax_exempt_bonds_liability) ?? num(filing.tax_exempt_bonds) ?? 0
  const secured = num(filing.secured_mortgages) ?? 0
  const unsecured = num(filing.unsecured_notes) ?? 0
  return Math.round(low + deferred + bonds + secured + unsecured)
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
