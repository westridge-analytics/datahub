/**
 * The Main Data table's column catalogue — keys, labels and grouping.
 *
 * Lives in lib/ rather than in ColumnPicker so the server can read it too:
 * /api/export builds its SELECT list and header row from these same keys, which
 * is what keeps "export what's on screen" honest. A column added here shows up
 * in the picker and in the export without a second edit.
 */

export const COLUMN_GROUPS = [
  {
    label: 'Required',
    columns: [
      { key: 'ein',         label: 'EIN' },
      { key: 'name',        label: 'Organization' },
      { key: 'fiscal_year', label: 'Year' },
    ],
    alwaysVisible: true,
  },
  {
    label: 'Identity',
    columns: [
      { key: 'state',          label: 'State' },
      { key: 'ntee_category',  label: 'NTEE Category' },
      { key: 'ntee_code',      label: 'NTEE Code' },
      { key: 'sector',         label: 'Sector (BMF)' },
      { key: 'cohort_name',    label: 'Cohort' },
      { key: 'form_type',      label: 'Form Type' },
      { key: 'filing_method',  label: 'Filing Method' },
      { key: 'subsection_code', label: 'IRC Subsection' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Revenue',
    columns: [
      { key: 'total_revenue',     label: 'Total Revenue' },
      { key: 'contributions',     label: 'Contributions' },
      { key: 'program_revenue',   label: 'Program Revenue' },
      { key: 'investment_income', label: 'Investment Income' },
      { key: 'other_revenue',     label: 'Other Revenue' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Revenue Components',
    columns: [
      { key: 'royalties_income',       label: 'Royalties Income' },
      { key: 'net_rental_income',      label: 'Net Rental Income' },
      { key: 'net_asset_sale_gains',   label: 'Net Asset Sale Gains' },
      { key: 'net_fundraising_income', label: 'Net Fundraising Income' },
      { key: 'net_gaming_income',      label: 'Net Gaming Income' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Expenses',
    columns: [
      { key: 'total_expenses',       label: 'Total Expenses' },
      { key: 'program_expenses',     label: 'Program Expenses' },
      { key: 'ga_expenses',          label: 'G&A Expenses' },
      { key: 'fundraising_expenses', label: 'Fundraising Expenses' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Compensation & Payroll',
    columns: [
      { key: 'comp_officers',       label: 'Officer Compensation' },
      { key: 'comp_other_salaries', label: 'Other Salaries' },
      { key: 'comp_total_reported', label: 'Total Comp Reported' },
      { key: 'comp_related_orgs',   label: 'Comp via Related Orgs' },
      { key: 'pension_contributions', label: 'Pension Contributions' },
      { key: 'employee_benefits',   label: 'Employee Benefits' },
      { key: 'payroll_taxes',       label: 'Payroll Taxes' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Fees & Services',
    columns: [
      { key: 'management_fees',              label: 'Management Fees' },
      { key: 'legal_fees',                   label: 'Legal Fees' },
      { key: 'accounting_fees',              label: 'Accounting Fees' },
      { key: 'professional_fundraising_fees', label: 'Professional Fundraising Fees' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Operating Expenses',
    columns: [
      { key: 'occupancy',    label: 'Occupancy' },
      { key: 'travel',       label: 'Travel' },
      { key: 'it_expenses',  label: 'IT Expenses' },
      { key: 'depreciation', label: 'Depreciation' },
      { key: 'insurance',    label: 'Insurance' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Grants Paid',
    columns: [
      { key: 'grants_to_govts',       label: 'Grants to Govts' },
      { key: 'grants_to_individuals', label: 'Grants to Individuals' },
      { key: 'grants_to_foreign',     label: 'Grants to Foreign' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Bottom Line',
    columns: [
      { key: 'net_income', label: 'Net Income' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Balance Sheet',
    columns: [
      { key: 'total_assets',       label: 'Total Assets' },
      { key: 'total_liabilities',  label: 'Total Liabilities' },
      { key: 'total_net_assets',   label: 'Total Net Assets' },
      { key: 'unrestr_net_assets', label: 'Unrestricted Net Assets' },
      { key: 'restr_net_assets',   label: 'Restricted Net Assets' },
      { key: 'temp_restricted_net_assets', label: 'Temp Restricted Net Assets' },
      { key: 'perm_restricted_net_assets', label: 'Perm Restricted Net Assets' },
      { key: 'pledges_receivable',         label: 'Pledges Receivable' },
      { key: 'accounts_payable',           label: 'Accounts Payable' },
      { key: 'tax_exempt_bonds_liability', label: 'Tax-Exempt Bonds' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Investments & Property',
    columns: [
      { key: 'cash_equiv',                 label: 'Cash & Equivalents' },
      { key: 'st_investments',             label: 'ST Investments' },
      { key: 'lt_investments',             label: 'LT Investments' },
      { key: 'investments_publicly_traded', label: 'Publicly Traded Securities' },
      { key: 'investments_other',          label: 'Other Investments' },
      { key: 'investments_program_related', label: 'Program-Related Investments' },
      { key: 'ppe',                        label: 'PP&E' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Headcount',
    columns: [
      { key: 'num_employees',          label: 'Employees' },
      { key: 'num_highly_compensated', label: 'Individuals >$100K' },
      { key: 'num_contractors_100k',   label: 'Contractors >$100K' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Governance',
    columns: [
      { key: 'has_lobbying',                  label: 'Lobbying Activity' },
      { key: 'has_political_activity',        label: 'Political Activity' },
      { key: 'has_unrelated_business_income', label: 'Unrelated Business Income' },
      { key: 'has_foreign_office',            label: 'Foreign Office' },
      { key: 'has_foreign_grants',            label: 'Foreign Grants' },
      { key: 'operates_hospital',             label: 'Operates Hospital' },
      { key: 'operates_school',               label: 'Operates School' },
      { key: 'has_related_orgs',              label: 'Related Organizations' },
    ],
    alwaysVisible: false,
  },
]

export const DEFAULT_VISIBLE_COLUMNS = [
  'ein', 'name', 'fiscal_year', 'state', 'ntee_category', 'cohort_name',
  'total_revenue', 'total_expenses', 'net_income',
  'total_assets', 'total_net_assets',
]


/** Every column key, in the canonical left-to-right order of the table. */
export const ALL_COLUMN_KEYS: string[] = COLUMN_GROUPS.flatMap(g => g.columns.map(c => c.key))

/** key → display label, for headers (table and export alike). */
export const COLUMN_LABELS: Record<string, string> = Object.fromEntries(
  COLUMN_GROUPS.flatMap(g => g.columns.map(c => [c.key, c.label])),
)
