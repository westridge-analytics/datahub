import type { Filing } from '@/types'

// Row 90: total expenses / 12
export function calcMonthlyOpex(f: Filing): number | null {
  if (f.total_expenses === null) return null
  return f.total_expenses / 12
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
  if (!f.total_expenses) return null
  const personnel =
    (f.comp_officers ?? 0) +
    (f.comp_other_salaries ?? 0) +
    (f.pension_contributions ?? 0) +
    (f.employee_benefits ?? 0) +
    (f.payroll_taxes ?? 0)
  return personnel / f.total_expenses
}

// Row 104: sum of revenue lines labeled "Earned"
// Includes program revenue, royalties, net rental, net gaming income
// (net inventory sales not stored separately in DB)
export function calcEarned(f: Filing): number | null {
  if (f.program_revenue === null) return null
  return (
    (f.program_revenue ?? 0) +
    (f.royalties_income ?? 0) +
    (f.net_rental_income ?? 0) +
    (f.net_gaming_income ?? 0)
  )
}

// Row 106: sum of revenue lines labeled "Contributed"
export function calcContributed(f: Filing): number | null {
  if (f.contributions === null) return null
  return (f.contributions ?? 0) + (f.net_fundraising_income ?? 0)
}

// Row 108: current year temp restricted net assets minus prior year
export function calcYoYRestrictionChange(current: Filing, prev: Filing | null): number | null {
  if (current.temp_restricted_net_assets === null) return null
  if (prev === null || prev.temp_restricted_net_assets === null) return null
  return current.temp_restricted_net_assets - prev.temp_restricted_net_assets
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
