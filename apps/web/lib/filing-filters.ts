import { SECTOR_TO_NTEE_LETTERS } from '@/lib/ntee'

export const ALLOWED_SORT_COLUMNS = new Set([
  'total_revenue',
  'total_expenses',
  'net_income',
  'total_assets',
  'total_net_assets',
  'fiscal_year',
  'name',
])

export const BOOL_COLS = [
  'has_lobbying', 'has_political_activity', 'has_unrelated_business_income',
  'has_foreign_office', 'has_foreign_grants', 'operates_hospital', 'operates_school', 'has_related_orgs',
] as const

// Numeric range filter — allowlisted filing columns only
export const NUMERIC_COLS_API = new Set([
  'total_revenue', 'total_expenses', 'total_assets', 'total_liabilities', 'total_net_assets',
  'contributions', 'program_revenue', 'investment_income', 'other_revenue',
  'royalties_income', 'net_rental_income', 'net_asset_sale_gains', 'net_fundraising_income', 'net_gaming_income',
  'program_expenses', 'ga_expenses', 'fundraising_expenses',
  'comp_officers', 'comp_other_salaries', 'comp_total_reported', 'comp_related_orgs',
  'pension_contributions', 'employee_benefits', 'payroll_taxes',
  'management_fees', 'legal_fees', 'accounting_fees', 'professional_fundraising_fees',
  'occupancy', 'travel', 'it_expenses', 'depreciation', 'insurance',
  'grants_to_govts', 'grants_to_individuals', 'grants_to_foreign',
  'unrestr_net_assets', 'restr_net_assets', 'temp_restricted_net_assets', 'perm_restricted_net_assets',
  'pledges_receivable', 'accounts_payable', 'tax_exempt_bonds_liability',
  'cash_equiv', 'st_investments', 'lt_investments',
  'investments_publicly_traded', 'investments_other', 'investments_program_related', 'ppe',
  'num_employees', 'num_highly_compensated', 'num_contractors_100k',
])

export interface ParsedFilingFilters {
  clauses: string[]
  params: unknown[]
  hasOrgFilters: boolean
  cohortId: number | null
  yearMin: number | null
  yearMax: number | null
}

/**
 * Builds WHERE clauses + params from the same query-string contract used by
 * GET /api/filings. Keeping one implementation means the Main Data table and
 * its Export button can never drift on what "the filtered set" means.
 */
export function parseFilingFilters(sp: URLSearchParams): ParsedFilingFilters {
  const stateVals        = sp.get('state')?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  const nteeCatVals      = sp.get('ntee_category')?.split(',').filter(Boolean) ?? []
  const formTypeVals     = sp.get('form_type')?.split(',').filter(Boolean) ?? []
  const filingMethodVals = sp.get('filing_method')?.split(',').filter(Boolean) ?? []

  const cohortIdRaw = sp.get('cohort_id')
  const cohortId = cohortIdRaw ? parseInt(cohortIdRaw, 10) : null
  const yearMinRaw = sp.get('year_min')
  const yearMin = yearMinRaw ? parseInt(yearMinRaw, 10) : null
  const yearMaxRaw = sp.get('year_max')
  const yearMax = yearMaxRaw ? parseInt(yearMaxRaw, 10) : null

  const params: unknown[] = []
  const clauses: string[] = []
  function p(value: unknown): string {
    params.push(value)
    return `$${params.length}`
  }

  let hasOrgFilters = false

  if (stateVals.length > 0) {
    clauses.push(`o.state = ANY(${p(stateVals)})`); hasOrgFilters = true
  }
  if (nteeCatVals.length > 0) {
    if (nteeCatVals.includes('Other')) {
      const otherLetters = nteeCatVals.filter(c => c !== 'Other').flatMap(c => SECTOR_TO_NTEE_LETTERS[c] ?? [])
      if (otherLetters.length > 0) {
        clauses.push(`(LEFT(o.ntee_code, 1) = ANY(${p(otherLetters)}) OR o.ntee_code IS NULL OR o.ntee_code = '' OR LEFT(o.ntee_code, 1) = 'Z')`)
      } else {
        clauses.push(`(o.ntee_code IS NULL OR o.ntee_code = '' OR LEFT(o.ntee_code, 1) = 'Z')`)
      }
    } else {
      const letters = nteeCatVals.flatMap(c => SECTOR_TO_NTEE_LETTERS[c] ?? [])
      if (letters.length > 0) clauses.push(`LEFT(o.ntee_code, 1) = ANY(${p(letters)})`)
    }
    hasOrgFilters = true
  }

  if (formTypeVals.length > 0)     clauses.push(`f.form_type = ANY(${p(formTypeVals)})`)
  if (filingMethodVals.length > 0) clauses.push(`f.filing_method = ANY(${p(filingMethodVals)})`)

  if (yearMin !== null) clauses.push(`f.fiscal_year >= ${p(yearMin)}`)
  if (yearMax !== null) clauses.push(`f.fiscal_year <= ${p(yearMax)}`)

  for (const col of BOOL_COLS) {
    const val = sp.get(col)
    if (val === 'true' || val === 'false') clauses.push(`f.${col} = ${p(val === 'true')}`)
  }

  for (const col of NUMERIC_COLS_API) {
    const minRaw = sp.get(`${col}_min`), maxRaw = sp.get(`${col}_max`)
    const min = minRaw !== null ? Number(minRaw) : NaN
    const max = maxRaw !== null ? Number(maxRaw) : NaN
    if (!isNaN(min) && minRaw !== null) clauses.push(`f.${col} >= ${p(min)}`)
    if (!isNaN(max) && maxRaw !== null) clauses.push(`f.${col} <= ${p(max)}`)
  }
  const niMinRaw = sp.get('net_income_min'), niMaxRaw = sp.get('net_income_max')
  if (niMinRaw !== null && !isNaN(Number(niMinRaw))) clauses.push(`(f.total_revenue - f.total_expenses) >= ${p(Number(niMinRaw))}`)
  if (niMaxRaw !== null && !isNaN(Number(niMaxRaw))) clauses.push(`(f.total_revenue - f.total_expenses) <= ${p(Number(niMaxRaw))}`)

  return { clauses, params, hasOrgFilters, cohortId, yearMin, yearMax }
}
