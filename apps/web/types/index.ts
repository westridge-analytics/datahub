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
  form_type: string | null
  filing_method: string | null
  subsection_code: string | null
  num_employees: number | null
  num_highly_compensated: number | null
  has_lobbying: boolean | null
  has_political_activity: boolean | null
  has_unrelated_business_income: boolean | null
  has_foreign_office: boolean | null
  has_foreign_grants: boolean | null
  operates_hospital: boolean | null
  operates_school: boolean | null
  has_related_orgs: boolean | null
  govt_grants: number | null
  all_other_contributions: number | null
  noncash_contributions: number | null
  total_contributions: number | null
  membership_dues: number | null
  fundraising_revenue: number | null
  related_org_revenue: number | null
  all_other_revenue: number | null
  comp_officers: number | null
  comp_disqualified: number | null
  comp_employees: number | null
  comp_contractors: number | null
  fees_mgmt: number | null
  fees_legal: number | null
  fees_accounting: number | null
  fees_lobbying: number | null
  fees_professional: number | null
  fees_investment: number | null
  fees_other: number | null
  advertising: number | null
  office_expenses: number | null
  it_expenses: number | null
  royalties: number | null
  occupancy: number | null
  travel: number | null
  entertainment: number | null
  conferences: number | null
  interest: number | null
  depreciation: number | null
  insurance: number | null
  all_other_expenses: number | null
  grants_domestic_orgs: number | null
  grants_domestic_individuals: number | null
  grants_foreign: number | null
  benefits_members: number | null
  savings: number | null
  pledges_receivable: number | null
  accounts_receivable: number | null
  notes_receivable: number | null
  inventories: number | null
  prepaid_expenses: number | null
  ppe_net: number | null
  intangibles: number | null
  other_assets: number | null
  accounts_payable: number | null
  grants_payable: number | null
  deferred_revenue: number | null
  tax_exempt_bonds: number | null
  escrow_liabilities: number | null
  loans_officers: number | null
  other_liabilities: number | null
  capital_stock: number | null
  retained_earnings: number | null
}

export interface FilingWithOrg extends Filing {
  name: string
  state: string
  sector: string | null
  ntee_code: string | null
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
