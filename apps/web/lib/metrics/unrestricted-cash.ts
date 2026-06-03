// NOTE: M1/M2/M3 formulas are TBD — these are placeholder implementations.
// When formulas are finalized, update ONLY this file.
import type { Filing } from '@/types'

export function calcM1(filing: Filing): number | null {
  // Placeholder: Cash × (Unrestricted NA / Total NA)
  if (
    !filing.cash_equiv ||
    !filing.unrestr_net_assets ||
    !filing.total_net_assets ||
    filing.total_net_assets === 0
  ) return null
  return Math.round(filing.cash_equiv * (filing.unrestr_net_assets / filing.total_net_assets))
}

export function calcM2(filing: Filing): number | null {
  // Placeholder: M1 + ST investments × unrestricted ratio
  const m1 = calcM1(filing)
  if (
    m1 === null ||
    !filing.st_investments ||
    !filing.unrestr_net_assets ||
    !filing.total_net_assets ||
    filing.total_net_assets === 0
  ) return null
  const ratio = filing.unrestr_net_assets / filing.total_net_assets
  return Math.round(m1 + filing.st_investments * ratio)
}

export function calcM3(filing: Filing): number | null {
  // Placeholder: M2 (M3 logic TBD — board-designated estimate not yet defined)
  return calcM2(filing)
}

export function getMethodConfidence(method: 'M1' | 'M2' | 'M3'): 'High' | 'Medium' | 'Estimated' {
  return { M1: 'High', M2: 'Medium', M3: 'Estimated' }[method] as 'High' | 'Medium' | 'Estimated'
}

export function calcAllMethods(filing: Filing) {
  return { m1: calcM1(filing), m2: calcM2(filing), m3: calcM3(filing) }
}
