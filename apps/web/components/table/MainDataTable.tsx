'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FilingWithOrg, Cohort } from '@/types'
import { formatCurrency, formatEIN, formatYear } from '@/lib/format'
import FilterChip from './FilterChip'
import FilterPanel, { type Filters, buildFilterParams } from './FilterPanel'
import ColumnPicker, { COLUMN_GROUPS, DEFAULT_VISIBLE_COLUMNS } from './ColumnPicker'

interface ApiResponse {
  data: (FilingWithOrg & { net_income?: number | null })[]
  total: number
  page: number
  page_size: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildParams(opts: {
  search: string
  filters: Filters
  sortBy: string
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}): string {
  const p = new URLSearchParams()
  if (opts.search) p.set('search', opts.search)
  for (const [k, v] of Object.entries(buildFilterParams(opts.filters))) p.set(k, v)
  p.set('sort_by', opts.sortBy)
  p.set('sort_dir', opts.sortDir)
  p.set('page', String(opts.page))
  p.set('page_size', String(opts.pageSize))
  return p.toString()
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span style={{ opacity: 0.3, fontSize: '10px', marginLeft: '4px' }}>⇅</span>
  return (
    <span style={{ fontSize: '10px', marginLeft: '4px', color: '#6F99CC' }}>
      {dir === 'asc' ? '▲' : '▼'}
    </span>
  )
}

// ─── Column definitions ───────────────────────────────────────────────────────

const ALL_COL_LABELS: Record<string, string> = {
  // Identity
  ein: 'EIN',
  name: 'Organization',
  fiscal_year: 'Year',
  form_type: 'Form Type',
  filing_method: 'Filing Method',
  ntee_category: 'NTEE Category',
  ntee_code: 'NTEE Code',
  subsection_code: 'IRC Subsection',
  state: 'State',
  sector: 'Sector',
  cohort_name: 'Cohort',
  // Revenue
  total_revenue: 'Total Revenue',
  contributions: 'Contributions',
  program_revenue: 'Program Revenue',
  investment_income: 'Investment Income',
  other_revenue: 'Other Revenue',
  // Revenue components
  royalties_income: 'Royalties Income',
  net_rental_income: 'Net Rental Income',
  net_asset_sale_gains: 'Net Asset Sale Gains',
  net_fundraising_income: 'Net Fundraising Income',
  net_gaming_income: 'Net Gaming Income',
  // Expenses
  total_expenses: 'Total Expenses',
  program_expenses: 'Program Expenses',
  ga_expenses: 'G&A Expenses',
  fundraising_expenses: 'Fundraising Expenses',
  // Compensation & payroll
  comp_officers: 'Officer Compensation',
  comp_other_salaries: 'Other Salaries',
  comp_total_reported: 'Total Comp Reported',
  comp_related_orgs: 'Comp via Related Orgs',
  pension_contributions: 'Pension Contributions',
  employee_benefits: 'Employee Benefits',
  payroll_taxes: 'Payroll Taxes',
  // Fees
  management_fees: 'Management Fees',
  legal_fees: 'Legal Fees',
  accounting_fees: 'Accounting Fees',
  professional_fundraising_fees: 'Professional Fundraising Fees',
  // Operating
  occupancy: 'Occupancy',
  travel: 'Travel',
  it_expenses: 'IT Expenses',
  depreciation: 'Depreciation',
  insurance: 'Insurance',
  // Grants paid
  grants_to_govts: 'Grants to Govts',
  grants_to_individuals: 'Grants to Individuals',
  grants_to_foreign: 'Grants to Foreign',
  // Bottom line
  net_income: 'Net Income',
  // Balance sheet
  total_assets: 'Total Assets',
  total_liabilities: 'Total Liabilities',
  total_net_assets: 'Total Net Assets',
  unrestr_net_assets: 'Unrestricted Net Assets',
  restr_net_assets: 'Restricted Net Assets',
  temp_restricted_net_assets: 'Temp Restricted Net Assets',
  perm_restricted_net_assets: 'Perm Restricted Net Assets',
  pledges_receivable: 'Pledges Receivable',
  accounts_payable: 'Accounts Payable',
  tax_exempt_bonds_liability: 'Tax-Exempt Bonds',
  // Investments
  cash_equiv: 'Cash & Equivalents',
  st_investments: 'ST Investments',
  lt_investments: 'LT Investments',
  investments_publicly_traded: 'Publicly Traded Securities',
  investments_other: 'Other Investments',
  investments_program_related: 'Program-Related Investments',
  ppe: 'PP&E',
  // Headcount
  num_employees: 'Employees',
  num_highly_compensated: 'Individuals >$100K',
  num_contractors_100k: 'Contractors >$100K',
  // Governance
  has_lobbying: 'Lobbying Activity',
  has_political_activity: 'Political Activity',
  has_unrelated_business_income: 'Unrelated Business Income',
  has_foreign_office: 'Foreign Office',
  has_foreign_grants: 'Foreign Grants',
  operates_hospital: 'Operates Hospital',
  operates_school: 'Operates School',
  has_related_orgs: 'Related Organizations',
}

const SORTABLE = new Set(['total_revenue', 'total_expenses', 'net_income', 'total_assets', 'total_net_assets', 'fiscal_year', 'name'])

const NUMERIC_COLS = new Set([
  'total_revenue', 'contributions', 'program_revenue', 'investment_income', 'other_revenue',
  'royalties_income', 'net_rental_income', 'net_asset_sale_gains', 'net_fundraising_income', 'net_gaming_income',
  'total_expenses', 'program_expenses', 'ga_expenses', 'fundraising_expenses',
  'comp_officers', 'comp_other_salaries', 'comp_total_reported', 'comp_related_orgs',
  'pension_contributions', 'employee_benefits', 'payroll_taxes',
  'management_fees', 'legal_fees', 'accounting_fees', 'professional_fundraising_fees',
  'occupancy', 'travel', 'it_expenses', 'depreciation', 'insurance',
  'grants_to_govts', 'grants_to_individuals', 'grants_to_foreign',
  'net_income',
  'total_assets', 'total_liabilities', 'total_net_assets',
  'unrestr_net_assets', 'restr_net_assets', 'temp_restricted_net_assets', 'perm_restricted_net_assets',
  'pledges_receivable', 'accounts_payable', 'tax_exempt_bonds_liability',
  'cash_equiv', 'st_investments', 'lt_investments',
  'investments_publicly_traded', 'investments_other', 'investments_program_related',
  'ppe',
  'num_employees', 'num_highly_compensated', 'num_contractors_100k',
])

const BOOLEAN_COLS = new Set([
  'has_lobbying', 'has_political_activity', 'has_unrelated_business_income',
  'has_foreign_office', 'has_foreign_grants', 'operates_hospital',
  'operates_school', 'has_related_orgs',
])

function cellValue(
  col: string,
  row: FilingWithOrg & { net_income?: number | null }
): React.ReactNode {
  switch (col) {
    case 'ein': return <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{formatEIN(row.ein)}</span>
    case 'name': return <span style={{ fontWeight: 500 }}>{row.name}</span>
    case 'fiscal_year': return formatYear(row.tax_period)
    case 'state': return row.state ?? '—'
    case 'sector': return <span style={{ fontSize: '12px' }}>{row.sector ?? '—'}</span>
    case 'cohort_name': {
      if (!row.cohort_names) return <span style={{ color: '#7A9AA4' }}>—</span>
      const pairs = row.cohort_names.split(',').map(e => { const [s, ...rest] = e.split('|'); return { short: s, full: rest.join('|') } })
      const visible = pairs.slice(0, 3)
      const overflow = pairs.length - 3
      return (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
          {visible.map(({ short, full }) => (
            <span key={full} title={full}
              style={{ color: '#6F99CC', fontWeight: 600, fontSize: '11px',
                backgroundColor: '#EEF5FB', borderRadius: '3px', padding: '1px 5px',
                whiteSpace: 'nowrap', fontFamily: 'monospace', letterSpacing: '0.01em' }}>
              {short}
            </span>
          ))}
          {overflow > 0 && (
            <span title={pairs.slice(3).map(p => p.full).join(', ')}
              style={{ fontSize: '10px', color: '#7A9AA4', whiteSpace: 'nowrap' }}>
              +{overflow}
            </span>
          )}
        </span>
      )
    }
    case 'total_revenue': return formatCurrency(row.total_revenue, true)
    case 'total_expenses': return formatCurrency(row.total_expenses, true)
    case 'net_income': {
      const val = row.net_income ?? null
      const formatted = formatCurrency(val, true)
      return (
        <span style={{ color: val !== null && val < 0 ? '#B83228' : 'inherit' }}>
          {formatted}
        </span>
      )
    }
    case 'ntee_category': return <span style={{ fontSize: '12px' }}>{row.ntee_category ?? '—'}</span>
    case 'ntee_code': return row.ntee_code ? <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{row.ntee_code}</span> : <span style={{ color: '#7A9AA4' }}>—</span>
    case 'form_type':       return row.form_type ? <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{row.form_type}</span> : <span style={{ color: '#7A9AA4' }}>—</span>
    case 'filing_method':  return (row as any).filing_method ?? <span style={{ color: '#7A9AA4' }}>—</span>
    case 'subsection_code': {
      const sc = (row as any).subsection_code
      return sc ? <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{sc}</span> : <span style={{ color: '#7A9AA4' }}>—</span>
    }
    // Revenue
    case 'contributions':     return formatCurrency((row as any).contributions, true)
    case 'program_revenue':   return formatCurrency((row as any).program_revenue, true)
    case 'investment_income': return formatCurrency((row as any).investment_income, true)
    case 'other_revenue':     return formatCurrency((row as any).other_revenue, true)
    case 'royalties_income':       return formatCurrency((row as any).royalties_income, true)
    case 'net_rental_income':      return formatCurrency((row as any).net_rental_income, true)
    case 'net_asset_sale_gains':   return formatCurrency((row as any).net_asset_sale_gains, true)
    case 'net_fundraising_income': return formatCurrency((row as any).net_fundraising_income, true)
    case 'net_gaming_income':      return formatCurrency((row as any).net_gaming_income, true)
    // Expenses
    case 'program_expenses':     return formatCurrency((row as any).program_expenses, true)
    case 'ga_expenses':          return formatCurrency((row as any).ga_expenses, true)
    case 'fundraising_expenses': return formatCurrency((row as any).fundraising_expenses, true)
    // Compensation
    case 'comp_officers':       return formatCurrency((row as any).comp_officers, true)
    case 'comp_other_salaries': return formatCurrency((row as any).comp_other_salaries, true)
    case 'comp_total_reported': return formatCurrency((row as any).comp_total_reported, true)
    case 'comp_related_orgs':   return formatCurrency((row as any).comp_related_orgs, true)
    case 'pension_contributions': return formatCurrency((row as any).pension_contributions, true)
    case 'employee_benefits':   return formatCurrency((row as any).employee_benefits, true)
    case 'payroll_taxes':       return formatCurrency((row as any).payroll_taxes, true)
    // Fees
    case 'management_fees':              return formatCurrency((row as any).management_fees, true)
    case 'legal_fees':                   return formatCurrency((row as any).legal_fees, true)
    case 'accounting_fees':              return formatCurrency((row as any).accounting_fees, true)
    case 'professional_fundraising_fees': return formatCurrency((row as any).professional_fundraising_fees, true)
    // Operating
    case 'occupancy':    return formatCurrency((row as any).occupancy, true)
    case 'travel':       return formatCurrency((row as any).travel, true)
    case 'it_expenses':  return formatCurrency((row as any).it_expenses, true)
    case 'depreciation': return formatCurrency((row as any).depreciation, true)
    case 'insurance':    return formatCurrency((row as any).insurance, true)
    // Grants paid
    case 'grants_to_govts':       return formatCurrency((row as any).grants_to_govts, true)
    case 'grants_to_individuals': return formatCurrency((row as any).grants_to_individuals, true)
    case 'grants_to_foreign':     return formatCurrency((row as any).grants_to_foreign, true)
    // Balance sheet
    case 'total_assets':       return formatCurrency(row.total_assets, true)
    case 'total_net_assets':   return formatCurrency(row.total_net_assets, true)
    case 'total_liabilities':  return formatCurrency(row.total_liabilities, true)
    case 'unrestr_net_assets': return formatCurrency((row as any).unrestr_net_assets, true)
    case 'restr_net_assets':   return formatCurrency((row as any).restr_net_assets, true)
    case 'temp_restricted_net_assets': return formatCurrency((row as any).temp_restricted_net_assets, true)
    case 'perm_restricted_net_assets': return formatCurrency((row as any).perm_restricted_net_assets, true)
    case 'pledges_receivable':         return formatCurrency((row as any).pledges_receivable, true)
    case 'accounts_payable':           return formatCurrency((row as any).accounts_payable, true)
    case 'tax_exempt_bonds_liability': return formatCurrency((row as any).tax_exempt_bonds_liability, true)
    // Investments
    case 'cash_equiv':     return formatCurrency(row.cash_equiv, true)
    case 'st_investments': return formatCurrency(row.st_investments, true)
    case 'lt_investments': return formatCurrency((row as any).lt_investments, true)
    case 'investments_publicly_traded':  return formatCurrency((row as any).investments_publicly_traded, true)
    case 'investments_other':            return formatCurrency((row as any).investments_other, true)
    case 'investments_program_related':  return formatCurrency((row as any).investments_program_related, true)
    case 'ppe':            return formatCurrency((row as any).ppe, true)
    // Headcount
    case 'num_employees':          return (row as any).num_employees != null ? ((row as any).num_employees as number).toLocaleString() : <span style={{ color: '#7A9AA4' }}>—</span>
    case 'num_highly_compensated': return (row as any).num_highly_compensated != null ? ((row as any).num_highly_compensated as number).toLocaleString() : <span style={{ color: '#7A9AA4' }}>—</span>
    case 'num_contractors_100k':   return (row as any).num_contractors_100k != null ? ((row as any).num_contractors_100k as number).toLocaleString() : <span style={{ color: '#7A9AA4' }}>—</span>
    // Governance booleans
    default: {
      if (BOOLEAN_COLS.has(col)) {
        const val = (row as any)[col]
        if (val === true)  return <span style={{ color: '#2D7A4F', fontWeight: 600, fontSize: '11px' }}>Yes</span>
        if (val === false) return <span style={{ color: '#7A9AA4', fontSize: '11px' }}>No</span>
        return <span style={{ color: '#7A9AA4' }}>—</span>
      }
      return <span style={{ color: '#7A9AA4' }}>—</span>
    }
  }
}

// ─── URL state helpers ────────────────────────────────────────────────────────

const NUMERIC_COLS_API = new Set([
  'total_revenue','total_expenses','total_assets','total_liabilities','total_net_assets',
  'contributions','program_revenue','investment_income','other_revenue',
  'royalties_income','net_rental_income','net_asset_sale_gains','net_fundraising_income','net_gaming_income',
  'program_expenses','ga_expenses','fundraising_expenses',
  'comp_officers','comp_other_salaries','comp_total_reported','comp_related_orgs',
  'pension_contributions','employee_benefits','payroll_taxes',
  'management_fees','legal_fees','accounting_fees','professional_fundraising_fees',
  'occupancy','travel','it_expenses','depreciation','insurance',
  'grants_to_govts','grants_to_individuals','grants_to_foreign',
  'unrestr_net_assets','restr_net_assets','temp_restricted_net_assets','perm_restricted_net_assets',
  'pledges_receivable','accounts_payable','tax_exempt_bonds_liability',
  'cash_equiv','st_investments','lt_investments',
  'investments_publicly_traded','investments_other','investments_program_related','ppe',
  'num_employees','num_highly_compensated','num_contractors_100k',
])

const BOOL_GOV_COLS_SET = new Set([
  'has_lobbying','has_political_activity','has_unrelated_business_income',
  'has_foreign_office','has_foreign_grants','operates_hospital','operates_school','has_related_orgs',
])

function paramsToFilters(sp: URLSearchParams): Filters {
  const f: Filters = {}
  const state = sp.get('state')
  if (state) f.state = state.split(',').filter(Boolean)
  const ntee = sp.get('ntee_category')
  if (ntee) f.ntee_category = ntee.split(',').filter(Boolean)
  const ft = sp.get('form_type')
  if (ft) f.form_type = ft.split(',').filter(Boolean)
  const fm = sp.get('filing_method')
  if (fm) f.filing_method = fm.split(',').filter(Boolean)
  const cohort = sp.get('cohort_id')
  if (cohort) f.cohort_id = parseInt(cohort, 10)
  const yrMin = sp.get('year_min')
  if (yrMin) f.year_min = parseInt(yrMin, 10)
  const yrMax = sp.get('year_max')
  if (yrMax) f.year_max = parseInt(yrMax, 10)
  for (const k of BOOL_GOV_COLS_SET) {
    const v = sp.get(k)
    if (v !== null) (f as Record<string, unknown>)[k] = v === 'true'
  }
  const ranges: Record<string, { min?: number; max?: number }> = {}
  for (const col of NUMERIC_COLS_API) {
    const minVal = sp.get(`${col}_min`)
    const maxVal = sp.get(`${col}_max`)
    if (minVal !== null || maxVal !== null) {
      ranges[col] = {}
      if (minVal !== null) ranges[col].min = parseFloat(minVal)
      if (maxVal !== null) ranges[col].max = parseFloat(maxVal)
    }
  }
  if (Object.keys(ranges).length) f.ranges = ranges
  return f
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MainDataTable() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Initialize state from URL on first render
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('q') ?? '')
  const [filters, setFilters] = useState<Filters>(() => paramsToFilters(searchParams))
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort_by') ?? 'total_revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (searchParams.get('sort_dir') === 'asc' ? 'asc' : 'desc'))
  const [page, setPage] = useState(() => {
    const p = searchParams.get('page')
    return p ? Math.max(1, parseInt(p, 10)) : 1
  })
  const pageSize = 100

  const [rows, setRows] = useState<(FilingWithOrg & { net_income?: number | null })[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const [selectedEins, setSelectedEins] = useState<Set<string>>(new Set())
  const [allFilteredSelected, setAllFilteredSelected] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const cols = searchParams.get('cols')
    return cols ? cols.split(',').filter(Boolean) : DEFAULT_VISIBLE_COLUMNS
  })

  // Track whether the component has mounted so we don't push URL on first render
  const mounted = useRef(false)

  // Dropdowns
  const [filterOpen, setFilterOpen] = useState(false)
  const [columnPickerOpen, setColumnPickerOpen] = useState(false)
  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [cohorts, setCohorts] = useState<Cohort[]>([])

  const filterRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  // Sync state to URL — runs after every relevant state change, but skips the initial render
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const p = new URLSearchParams()
    if (debouncedSearch) p.set('q', debouncedSearch)
    if (sortBy !== 'total_revenue') p.set('sort_by', sortBy)
    if (sortDir !== 'desc') p.set('sort_dir', sortDir)
    if (page !== 1) p.set('page', String(page))
    const colsDefault = JSON.stringify([...DEFAULT_VISIBLE_COLUMNS].sort())
    const colsCurrent = JSON.stringify([...visibleColumns].sort())
    if (colsCurrent !== colsDefault) p.set('cols', visibleColumns.join(','))
    for (const [k, v] of Object.entries(buildFilterParams(filters))) p.set(k, v)
    const qs = p.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }, [debouncedSearch, filters, sortBy, sortDir, page, visibleColumns])

  // Fetch data — AbortController cancels in-flight requests on re-trigger.
  // Guard: don't call setLoading(false) if this fetch was aborted (a newer one took over).
  useEffect(() => {
    const controller = new AbortController()
    const params = buildParams({ search: debouncedSearch, filters, sortBy, sortDir, page, pageSize })
    setLoading(true)
    fetch(`/api/filings?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json: ApiResponse) => {
        setRows(json.data ?? [])
        setTotal(json.total ?? 0)
      })
      .catch((err) => { if (err.name !== 'AbortError') console.error(err) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [debouncedSearch, filters, sortBy, sortDir, page])

  // Fetch cohorts for tag modal
  useEffect(() => {
    fetch('/api/cohorts')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setCohorts(data))
      .catch(console.error)
  }, [])

  // Close filter dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false)
      }
    }
    if (filterOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  // Sort handler
  function handleSort(col: string) {
    if (!SORTABLE.has(col)) return
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
    setPage(1)
  }

  function applyFilters(f: Filters) { setFilters(f); setPage(1); setAllFilteredSelected(false) }

  // Selection
  function toggleSelectAll() {
    if (rows.every((r) => selectedEins.has(r.ein))) {
      const next = new Set(selectedEins)
      rows.forEach((r) => next.delete(r.ein))
      setSelectedEins(next)
      setAllFilteredSelected(false)
    } else {
      const next = new Set(selectedEins)
      rows.forEach((r) => next.add(r.ein))
      setSelectedEins(next)
    }
  }

  async function selectAllFiltered() {
    setSelectingAll(true)
    try {
      const p = buildParams({ search, sortBy, sortDir, page: 1, filters, pageSize: 10000 })
      const res = await fetch(`/api/filings?${p.toString()}`)
      const json = await res.json()
      const eins = new Set<string>((json.data as { ein: string }[]).map(r => r.ein))
      setSelectedEins(eins)
      setAllFilteredSelected(true)
    } finally {
      setSelectingAll(false)
    }
  }

  function clearSelection() {
    setSelectedEins(new Set())
    setAllFilteredSelected(false)
  }

  function toggleRow(ein: string) {
    const next = new Set(selectedEins)
    if (next.has(ein)) next.delete(ein)
    else next.add(ein)
    setSelectedEins(next)
  }

  // Export
  async function handleExport() {
    const body = { search: debouncedSearch, filters, sortBy, sortDir }
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const cd = res.headers.get('content-disposition') ?? ''
    const match = cd.match(/filename="?([^"]+)"?/)
    a.download = match ? match[1] : 'export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Cohort tagging
  const [tagCohortId, setTagCohortId] = useState<string>('')
  const [newCohortName, setNewCohortName] = useState('')
  const [tagLoading, setTagLoading] = useState(false)

  async function handleTag() {
    setTagLoading(true)
    try {
      let cohortId = tagCohortId
      if (tagCohortId === '__new__') {
        const res = await fetch('/api/cohorts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newCohortName }),
        })
        const created: Cohort = await res.json()
        cohortId = String(created.id)
        setCohorts((prev) => [...prev, created])
      }
      await Promise.all(
        Array.from(selectedEins).map((ein) =>
          fetch(`/api/cohorts/${cohortId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ein }),
          })
        )
      )
      setTagModalOpen(false)
      setTagCohortId('')
      setNewCohortName('')
      // Re-fetch to update cohort_name
      const params = buildParams({ search: debouncedSearch, filters, sortBy, sortDir, page, pageSize })
      const json: ApiResponse = await fetch(`/api/filings?${params}`).then((r) => r.json())
      setRows(json.data ?? [])
      setTotal(json.total ?? 0)
    } catch (err) {
      console.error(err)
    } finally {
      setTagLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selectedEins.has(r.ein))
  const selectedRowCount = rows.filter((r) => selectedEins.has(r.ein)).length

  // Active filter chips — one chip per active filter group
  const activeFilterChips: { label: string; value: string; onRemove: () => void }[] = []
  const removeKey = (key: keyof Filters) => { setFilters(f => { const n = { ...f }; delete n[key]; return n }); setPage(1) }
  if (filters.state?.length)        activeFilterChips.push({ label: 'State', value: filters.state.join(', '), onRemove: () => removeKey('state') })
  if (filters.ntee_category?.length) activeFilterChips.push({ label: 'NTEE Category', value: filters.ntee_category.join(', '), onRemove: () => removeKey('ntee_category') })
  if (filters.form_type?.length)    activeFilterChips.push({ label: 'Form Type', value: filters.form_type.join(', '), onRemove: () => removeKey('form_type') })
  if (filters.filing_method?.length) activeFilterChips.push({ label: 'Filing Method', value: filters.filing_method.join(', '), onRemove: () => removeKey('filing_method') })
  if (filters.cohort_id) {
    const c = cohorts.find(c => c.id === filters.cohort_id)
    activeFilterChips.push({ label: 'Cohort', value: c?.name ?? String(filters.cohort_id), onRemove: () => removeKey('cohort_id') })
  }
  if (filters.year_min) activeFilterChips.push({ label: 'Year ≥', value: String(filters.year_min), onRemove: () => removeKey('year_min') })
  if (filters.year_max) activeFilterChips.push({ label: 'Year ≤', value: String(filters.year_max), onRemove: () => removeKey('year_max') })
  const GOV_CHIP_LABELS: Record<string, string> = {
    has_lobbying: 'Lobbying', has_political_activity: 'Political Activity',
    has_unrelated_business_income: 'UBI', has_foreign_office: 'Foreign Office',
    has_foreign_grants: 'Foreign Grants', operates_hospital: 'Hospital',
    operates_school: 'School', has_related_orgs: 'Related Orgs',
  }
  for (const k of Object.keys(GOV_CHIP_LABELS)) {
    const v = (filters as Record<string, unknown>)[k]
    if (v !== undefined) activeFilterChips.push({ label: GOV_CHIP_LABELS[k], value: v ? 'Yes' : 'No',
      onRemove: () => { setFilters(f => { const n = { ...f }; delete (n as Record<string,unknown>)[k]; return n }); setPage(1) } })
  }
  if (filters.ranges) {
    const allCols = COLUMN_GROUPS.flatMap(g => g.columns)
    for (const [col, { min, max }] of Object.entries(filters.ranges)) {
      const colLabel = allCols.find(c => c.key === col)?.label ?? col
      const rangeStr = [min !== undefined ? `≥ ${min.toLocaleString()}` : '', max !== undefined ? `≤ ${max.toLocaleString()}` : ''].filter(Boolean).join(' ')
      activeFilterChips.push({ label: colLabel, value: rangeStr,
        onRemove: () => { setFilters(f => { const nr = { ...f.ranges }; delete nr[col]; return { ...f, ranges: Object.keys(nr).length ? nr : undefined } }); setPage(1) } })
    }
  }

  // Ordered visible columns
  const columnOrder = COLUMN_GROUPS.flatMap((g) => g.columns.map((c) => c.key))
  const orderedVisible = columnOrder.filter((c) => visibleColumns.includes(c))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, backgroundColor: '#F2F4F1' }}>
      {/* ── Toolbar ── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #BDD3DC',
          padding: '10px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* Row 1: title + search + buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Title */}
          <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#10232B', whiteSpace: 'nowrap' }}>
            Main Data
          </h1>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: '#D7E8EE',
              color: '#3D5A63',
              borderRadius: '9999px',
              padding: '1px 8px',
            }}
          >
            {total.toLocaleString()} rows
          </span>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: '9px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#7A9AA4',
                fontSize: '13px',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Search by name or EIN…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              style={{
                paddingLeft: '30px',
                paddingRight: search ? '26px' : '10px',
                paddingTop: '5px',
                paddingBottom: '5px',
                border: `1px solid ${(loading || search !== debouncedSearch) && search ? '#6F99CC' : '#BDD3DC'}`,
                borderRadius: '5px',
                fontSize: '13px',
                width: '220px',
                backgroundColor: '#F2F4F1',
                color: '#10232B',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
            />
            {search && !loading && search === debouncedSearch && (
              <button
                onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(1) }}
                style={{
                  position: 'absolute',
                  right: '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#7A9AA4',
                  fontSize: '14px',
                  lineHeight: 1,
                  padding: '0 2px',
                }}
                title="Clear search"
              >
                ×
              </button>
            )}
            {(loading || search !== debouncedSearch) && (
              <span
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '12px',
                  height: '12px',
                  border: '2px solid #BDD3DC',
                  borderTopColor: '#6F99CC',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            )}
          </div>
          {/* Loading label — appears between search and filter button */}
          {(loading || search !== debouncedSearch) && (
            <span style={{ fontSize: '11px', color: '#6F99CC', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {search ? 'Searching…' : 'Loading…'}
            </span>
          )}

          {/* Add Filter */}
          <div style={{ position: 'relative' }} ref={filterRef}>
            <button onClick={() => setFilterOpen((o) => !o)} style={btnStyle}>
              {activeFilterChips.length > 0
                ? `Filters (${activeFilterChips.length}) ▾`
                : '+ Add Filter'}
            </button>
            {filterOpen && (
              <FilterPanel
                filters={filters}
                cohorts={cohorts}
                onChange={(f) => { applyFilters(f) }}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>

          {/* Columns */}
          <div style={{ position: 'relative' }} ref={columnRef}>
            <button
              onClick={() => setColumnPickerOpen((o) => !o)}
              style={btnStyle}
            >
              Columns ▾
            </button>
            {columnPickerOpen && (
              <ColumnPicker
                visibleColumns={visibleColumns}
                onChange={setVisibleColumns}
                onClose={() => setColumnPickerOpen(false)}
              />
            )}
          </div>

          {/* Export */}
          <button onClick={handleExport} style={btnStyle}>
            Export ↓
          </button>

          {/* Tag selected */}
          {selectedEins.size > 0 && (
            <button
              onClick={() => setTagModalOpen(true)}
              style={{
                ...btnStylePrimary,
                whiteSpace: 'nowrap',
              }}
            >
              Tag {selectedEins.size} org{selectedEins.size !== 1 ? 's' : ''} →
            </button>
          )}
        </div>

        {/* Row 2: active filter chips */}
        {activeFilterChips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#7A9AA4', marginRight: '2px' }}>Active filters:</span>
            {activeFilterChips.map((chip, i) => (
              <FilterChip
                key={i}
                label={chip.label}
                value={chip.value}
                onRemove={chip.onRemove}
              />
            ))}
            <button
              onClick={() => { setFilters({}); setPage(1) }}
              style={{
                fontSize: '11px',
                color: '#7A9AA4',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0 4px',
              }}
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0 }}>
        <table
          style={{
            width: 'max-content',
            minWidth: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
            color: '#10232B',
          }}
        >
          <thead>
            <tr style={{ backgroundColor: '#203E46', color: '#FFFFFF', fontSize: '12px' }}>
              {/* Checkbox */}
              <th style={{ ...thStyle, width: '36px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer', accentColor: '#6F99CC' }}
                />
              </th>
              {orderedVisible.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  style={{
                    ...thStyle,
                    textAlign: NUMERIC_COLS.has(col) ? 'right' : 'left',
                    cursor: SORTABLE.has(col) ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                  }}
                >
                  {ALL_COL_LABELS[col] ?? col}
                  {SORTABLE.has(col) && <SortIcon active={sortBy === col} dir={sortDir} />}
                </th>
              ))}
              {/* Analyze action */}
              <th style={{ ...thStyle, width: '90px' }} />
            </tr>
          </thead>
          {/* Select-all-filtered banner */}
          {allOnPageSelected && !allFilteredSelected && total > rows.length && (
            <tbody>
              <tr>
                <td colSpan={orderedVisible.length + 2} style={{
                  backgroundColor: '#EEF5FB', textAlign: 'center',
                  padding: '7px 16px', fontSize: '12px', color: '#10232B',
                  borderBottom: '1px solid #BDD3DC',
                }}>
                  All {rows.length} rows on this page are selected.{' '}
                  <button onClick={selectingAll ? undefined : selectAllFiltered}
                    style={{ color: '#3A6FA0', fontWeight: 600, background: 'none', border: 'none',
                      cursor: selectingAll ? 'default' : 'pointer', padding: 0, fontSize: '12px' }}>
                    {selectingAll ? 'Loading…' : `Select all ${total.toLocaleString()} matching rows`}
                  </button>
                </td>
              </tr>
            </tbody>
          )}
          {allFilteredSelected && (
            <tbody>
              <tr>
                <td colSpan={orderedVisible.length + 2} style={{
                  backgroundColor: '#EEF5FB', textAlign: 'center',
                  padding: '7px 16px', fontSize: '12px', color: '#10232B',
                  borderBottom: '1px solid #BDD3DC',
                }}>
                  All {selectedEins.size.toLocaleString()} matching rows are selected.{' '}
                  <button onClick={clearSelection}
                    style={{ color: '#3A6FA0', fontWeight: 600, background: 'none', border: 'none',
                      cursor: 'pointer', padding: 0, fontSize: '12px' }}>
                    Clear selection
                  </button>
                </td>
              </tr>
            </tbody>
          )}
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={orderedVisible.length + 2}
                  style={{ textAlign: 'center', padding: '48px', color: '#7A9AA4', fontSize: '14px' }}
                >
                  No results found.
                </td>
              </tr>
            )}
            {rows.map((row, i) => {
              const selected = selectedEins.has(row.ein)
              return (
                <tr
                  key={`${row.ein}-${row.fiscal_year}-${i}`}
                  onClick={() => toggleRow(row.ein)}
                  style={{
                    backgroundColor: selected
                      ? '#E4EEF8'
                      : i % 2 === 0
                      ? '#FFFFFF'
                      : '#F8FAFB',
                    cursor: 'pointer',
                    borderBottom: '1px solid #E8EFF2',
                    transition: 'background-color 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!selected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F0F7FB'
                  }}
                  onMouseLeave={(e) => {
                    if (!selected) {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                        i % 2 === 0 ? '#FFFFFF' : '#F8FAFB'
                    }
                  }}
                >
                  <td style={{ ...tdStyle, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleRow(row.ein)}
                      style={{ cursor: 'pointer', accentColor: '#6F99CC' }}
                    />
                  </td>
                  {orderedVisible.map((col) => (
                    <td
                      key={col}
                      style={{
                        ...tdStyle,
                        textAlign: NUMERIC_COLS.has(col) ? 'right' : 'left',
                        fontVariantNumeric: NUMERIC_COLS.has(col) ? 'tabular-nums' : 'normal',
                      }}
                    >
                      {cellValue(col, row)}
                    </td>
                  ))}
                  <td
                    style={{ ...tdStyle, textAlign: 'center' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => router.push(`/institution/${row.ein}`)}
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#6F99CC',
                        background: 'none',
                        border: '1px solid #AECAE0',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Analyze →
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          backgroundColor: '#FFFFFF',
          borderTop: '1px solid #BDD3DC',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: '#3D5A63',
          zIndex: 20,
        }}
      >
        <span>
          {total.toLocaleString()} rows
          {selectedEins.size > 0 && (
            <span style={{ color: '#6F99CC', fontWeight: 600 }}>
              {' '}· {selectedRowCount} row{selectedRowCount !== 1 ? 's' : ''} selected ({selectedEins.size} org{selectedEins.size !== 1 ? 's' : ''})
            </span>
          )}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#7A9AA4', fontSize: '11px' }}>IRS SOI FY 2010–2023</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={pageBtn}
            >
              ‹ Prev
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={pageBtn}
            >
              Next ›
            </button>
          </div>
        </div>
      </div>

      {/* ── Tag Modal ── */}
      {tagModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.35)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setTagModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '8px',
              padding: '24px',
              width: '360px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
          >
            <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: '#10232B' }}>
              Tag {selectedEins.size} organization{selectedEins.size !== 1 ? 's' : ''}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ ...fieldLabel, display: 'block', marginBottom: '4px' }}>Cohort</label>
                <select
                  value={tagCohortId}
                  onChange={(e) => setTagCohortId(e.target.value)}
                  style={{ ...filterInput, width: '100%' }}
                >
                  <option value="">Select a cohort…</option>
                  {cohorts.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                  <option value="__new__">+ Create new cohort</option>
                </select>
              </div>
              {tagCohortId === '__new__' && (
                <div>
                  <label style={{ ...fieldLabel, display: 'block', marginBottom: '4px' }}>New cohort name</label>
                  <input
                    type="text"
                    placeholder="Cohort name"
                    value={newCohortName}
                    onChange={(e) => setNewCohortName(e.target.value)}
                    style={{ ...filterInput, width: '100%' }}
                  />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
              <button onClick={() => setTagModalOpen(false)} style={btnStyleSecondary}>Cancel</button>
              <button
                onClick={handleTag}
                disabled={tagLoading || !tagCohortId || (tagCohortId === '__new__' && !newCohortName.trim())}
                style={{
                  ...btnStylePrimary,
                  opacity: tagLoading || !tagCohortId || (tagCohortId === '__new__' && !newCohortName.trim()) ? 0.5 : 1,
                }}
              >
                {tagLoading ? 'Saving…' : 'Apply Tag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Shared style objects ─────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: '12px',
  borderRight: '1px solid rgba(255,255,255,0.1)',
  position: 'sticky',
  top: 0,
  backgroundColor: '#203E46',
}

const tdStyle: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: '13px',
  verticalAlign: 'middle',
  maxWidth: '240px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const btnStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#3D5A63',
  backgroundColor: '#FFFFFF',
  border: '1px solid #BDD3DC',
  borderRadius: '5px',
  padding: '5px 12px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const btnStylePrimary: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#FFFFFF',
  backgroundColor: '#203E46',
  border: '1px solid #203E46',
  borderRadius: '5px',
  padding: '5px 12px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const btnStyleSecondary: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#3D5A63',
  backgroundColor: '#FFFFFF',
  border: '1px solid #BDD3DC',
  borderRadius: '5px',
  padding: '5px 12px',
  cursor: 'pointer',
}

const fieldRow: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
}

const fieldLabel: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#7A9AA4',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const filterInput: React.CSSProperties = {
  fontSize: '13px',
  padding: '5px 8px',
  border: '1px solid #BDD3DC',
  borderRadius: '4px',
  color: '#10232B',
  backgroundColor: '#F2F4F1',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const pageBtn: React.CSSProperties = {
  fontSize: '12px',
  color: '#3D5A63',
  backgroundColor: 'transparent',
  border: '1px solid #BDD3DC',
  borderRadius: '4px',
  padding: '3px 9px',
  cursor: 'pointer',
}
