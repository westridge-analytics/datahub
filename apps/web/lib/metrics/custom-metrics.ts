import type { Filing } from '@/types'

// Neon returns BIGINT columns as strings; coerce to number (null/undefined → null)
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
// Coerce to number, treating null/undefined as 0 (for additive components)
function n0(v: number | string | null | undefined): number {
  return num(v) ?? 0
}

// Row 90: total expenses / 12
export function calcMonthlyOpex(f: Filing): number | null {
  const exp = num(f.total_expenses)
  if (exp === null) return null
  return exp / 12
}

// Row 94: midpoint unrestricted liquidity / monthly opex
export function calcReserveCoverage(midpoint: number | null, f: Filing): number | null {
  const opex = calcMonthlyOpex(f)
  if (midpoint === null || opex === null || opex === 0) return null
  return midpoint / opex
}

// Row 96: personnel costs / total expenses
// Covers officer comp, other salaries, pension, benefits, payroll taxes (Part IX rows 5-10)
export function calcPersonnelPct(f: Filing): number | null {
  const exp = num(f.total_expenses)
  if (!exp) return null
  const personnel =
    n0(f.comp_officers) +
    n0(f.comp_other_salaries) +
    n0(f.pension_contributions) +
    n0(f.employee_benefits) +
    n0(f.payroll_taxes)
  return personnel / exp
}

// Row 104: sum of revenue lines labeled "Earned"
// Includes program revenue, royalties, net rental, net gaming income
// (net inventory sales not stored separately in DB)
export function calcEarned(f: Filing): number | null {
  if (f.program_revenue === null) return null
  return (
    n0(f.program_revenue) +
    n0(f.royalties_income) +
    n0(f.net_rental_income) +
    n0(f.net_gaming_income)
  )
}

// Row 106: sum of revenue lines labeled "Contributed"
export function calcContributed(f: Filing): number | null {
  if (f.contributions === null) return null
  return n0(f.contributions) + n0(f.net_fundraising_income)
}

// Row 108: current year temp restricted net assets minus prior year
export function calcYoYRestrictionChange(current: Filing, prev: Filing | null): number | null {
  const cur = num(current.temp_restricted_net_assets)
  if (cur === null) return null
  if (prev === null) return null
  const p = num(prev.temp_restricted_net_assets)
  if (p === null) return null
  return cur - p
}

// Row 110: if restriction change > $100k, net it out of contributed (new restrictions absorbed donor dollars)
export function calcEstUnrestrictedContrib(f: Filing, prev: Filing | null): number | null {
  const contributed = calcContributed(f)
  if (contributed === null) return null
  const yoy = calcYoYRestrictionChange(f, prev)
  if (yoy !== null && yoy > 100_000) {
    return contributed - yoy
  }
  return contributed
}

// Row 98: total unrestricted operating income estimate
export function calcUnrestrictedOpIncome(f: Filing, prev: Filing | null): number | null {
  const earned = calcEarned(f)
  const contrib = calcEstUnrestrictedContrib(f, prev)
  if (earned === null || contrib === null) return null
  return earned + contrib
}

// Row 100: earned as % of unrestricted op income
export function calcEarnedPct(f: Filing, prev: Filing | null): number | null {
  const earned = calcEarned(f)
  const total = calcUnrestrictedOpIncome(f, prev)
  if (earned === null || total === null || total === 0) return null
  return earned / total
}

// Row 102: contributed as % of unrestricted op income
export function calcContribPct(f: Filing, prev: Filing | null): number | null {
  const contrib = calcEstUnrestrictedContrib(f, prev)
  const total = calcUnrestrictedOpIncome(f, prev)
  if (contrib === null || total === null || total === 0) return null
  return contrib / total
}
