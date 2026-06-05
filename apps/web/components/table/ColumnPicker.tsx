'use client'

import { useEffect, useRef } from 'react'
import { NTEE_SECTORS } from '@/lib/ntee'

export const COLUMN_GROUPS = [
  {
    label: 'Identity',
    columns: [
      { key: 'ein', label: 'EIN' },
      { key: 'name', label: 'Organization' },
      { key: 'fiscal_year', label: 'Year' },
      { key: 'state', label: 'State' },
      { key: 'sector', label: 'Sector' },
      { key: 'cohort_name', label: 'Cohort' },
    ],
    alwaysVisible: true,
  },
  {
    label: 'Income',
    columns: [
      { key: 'total_revenue', label: 'Revenue' },
      { key: 'total_expenses', label: 'Expenses' },
      { key: 'net_income', label: 'Net Income' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Balance Sheet',
    columns: [
      { key: 'total_assets', label: 'Total Assets' },
      { key: 'total_net_assets', label: 'Net Assets' },
      { key: 'total_liabilities', label: 'Liabilities' },
    ],
    alwaysVisible: false,
  },
  {
    label: 'Cash Methods',
    columns: [
      { key: 'cash_equiv', label: 'Cash & Equiv.' },
      { key: 'st_investments', label: 'ST Investments' },
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

  // Close on window blur (switching apps, clicking outside browser)
  useEffect(() => {
    window.addEventListener('blur', onClose)
    return () => window.removeEventListener('blur', onClose)
  }, [onClose])

  function toggle(key: string) {
    if (visibleColumns.includes(key)) {
      onChange(visibleColumns.filter((c) => c !== key))
    } else {
      onChange([...visibleColumns, key])
    }
  }

  return (
    <>
      {/* Full-screen backdrop — catches all outside clicks */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 49 }}
        onMouseDown={onClose}
      />
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
        minWidth: '220px',
        padding: '8px 0',
      }}
    >
      {COLUMN_GROUPS.map((group) => (
        <div key={group.label}>
          <div
            style={{
              padding: '6px 14px 4px',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#7A9AA4',
              backgroundColor: '#D7E8EE',
            }}
          >
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
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => !disabled && toggle(col.key)}
                  style={{ accentColor: '#6F99CC' }}
                />
                {col.label}
              </label>
            )
          })}
        </div>
      ))}
    </div>
    </>
  )
}
