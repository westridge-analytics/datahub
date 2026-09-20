'use client'

import { useEffect, useRef, useState } from 'react'

import { COLUMN_GROUPS, DEFAULT_VISIBLE_COLUMNS } from '@/lib/table-columns'

// Re-exported so table components keep importing their column catalogue from
// one place; the definitions themselves live in lib/ so the export route can
// read them server-side.
export { COLUMN_GROUPS, DEFAULT_VISIBLE_COLUMNS }

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
