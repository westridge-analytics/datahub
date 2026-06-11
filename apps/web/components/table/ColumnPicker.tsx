'use client'

import { useEffect, useRef, useState } from 'react'

export const COLUMN_GROUPS = [
  {
    label: 'Identity',
    columns: [
      { key: 'ein',            label: 'EIN' },
      { key: 'name',           label: 'Organization' },
      { key: 'fiscal_year',    label: 'Year' },
      { key: 'form_type',      label: 'Form Type' },
      { key: 'filing_method',  label: 'Filing Method' },
      { key: 'subsection_code', label: 'IRC Subsection' },
      { key: 'state',          label: 'State' },
      { key: 'sector',         label: 'Sector' },
      { key: 'cohort_name',    label: 'Cohort' },
    ],
    alwaysVisible: true,
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
  'ein', 'name', 'fiscal_year', 'state', 'sector', 'cohort_name',
  'total_revenue', 'total_expenses', 'net_income',
  'total_assets', 'total_net_assets',
]

interface ColumnPickerProps {
  visibleColumns: string[]
  onChange: (cols: string[]) => void
  onClose: () => void
}

export default function ColumnPicker({ visibleColumns, onChange, onClose }: ColumnPickerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [colSearch, setColSearch] = useState('')

  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    window.addEventListener('blur', onClose)
    return () => window.removeEventListener('blur', onClose)
  }, [onClose])

  function toggle(key: string, alwaysVisible: boolean) {
    if (alwaysVisible) return
    if (visibleColumns.includes(key)) {
      onChange(visibleColumns.filter((c) => c !== key))
    } else {
      onChange([...visibleColumns, key])
    }
  }

  const q = colSearch.trim().toLowerCase()
  const filteredGroups = COLUMN_GROUPS.map((group) => ({
    ...group,
    columns: q
      ? group.columns.filter((c) => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q))
      : group.columns,
  })).filter((group) => group.columns.length > 0)

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onMouseDown={onClose} />
      <div
        ref={ref}
        style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '4px',
          backgroundColor: '#FFFFFF',
          border: '1px solid #BDD3DC',
          borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          zIndex: 50,
          width: '280px',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '520px',
        }}
      >
        {/* Search */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #E8EFF2', flexShrink: 0 }}>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search columns…"
            value={colSearch}
            onChange={(e) => setColSearch(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              fontSize: '12px',
              padding: '5px 8px',
              border: '1px solid #BDD3DC',
              borderRadius: '4px',
              backgroundColor: '#F2F4F1',
              color: '#10232B',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Column list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filteredGroups.length === 0 && (
            <div style={{ padding: '16px 14px', fontSize: '12px', color: '#7A9AA4', textAlign: 'center' }}>
              No columns match
            </div>
          )}
          {filteredGroups.map((group) => (
            <div key={group.label}>
              <div style={{
                padding: '5px 14px 3px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase' as const,
                color: '#7A9AA4',
                backgroundColor: '#D7E8EE',
                position: 'sticky' as const,
                top: 0,
              }}>
                {group.label}
              </div>
              {group.columns.map((col) => {
                const checked = visibleColumns.includes(col.key)
                const disabled = group.alwaysVisible
                return (
                  <label
                    key={col.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '5px 14px',
                      fontSize: '13px',
                      color: disabled ? '#7A9AA4' : '#10232B',
                      cursor: disabled ? 'default' : 'pointer',
                      userSelect: 'none' as const,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(col.key, group.alwaysVisible)}
                      style={{ accentColor: '#6F99CC', flexShrink: 0 }}
                    />
                    {col.label}
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
