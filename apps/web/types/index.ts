export interface Organization {
  ein: string
  name: string
  state: string
  ntee_code: string | null
  sector: string | null
  subseccd: number | null
}

export interface Filing {
  id: number
  ein: string
  tax_period: string
  fiscal_year: number
  total_revenue: number | null
  total_expenses: number | null
  total_assets: number | null
  total_liabilities: number | null
  total_net_assets: number | null
  contributions: number | null
  program_revenue: number | null
  investment_income: number | null
  other_revenue: number | null
  program_expenses: number | null
  ga_expenses: number | null
  fundraising_expenses: number | null
  cash_equiv: number | null
  st_investments: number | null
  lt_investments: number | null
  ppe: number | null
  unrestr_net_assets: number | null
  restr_net_assets: number | null
  source_file: string | null
}

export interface FilingWithOrg extends Filing {
  name: string
  state: string
  sector: string | null
  cohort_name: string | null
}

export interface Cohort {
  id: number
  name: string
  color: string | null
  created_at: string
}

export interface CohortMember {
  cohort_id: number
  ein: string
  name: string
}

export type SortDir = 'asc' | 'desc'

export type VolatilityCohort = 'Very Stable' | 'Stable' | 'Moderate' | 'Volatile' | 'Very Volatile'

export type GrowthCohort = 'Shrinking' | 'Flat' | 'Slow Growth' | 'Moderate Growth' | 'High Growth'

export interface UnrestrictedCash {
  m1: number | null
  m2: number | null
  m3: number | null
}
