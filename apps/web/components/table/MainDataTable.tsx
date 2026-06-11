'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { FilingWithOrg, Cohort } from '@/types'
import { formatCurrency, formatEIN, formatYear } from '@/lib/format'
import { NTEE_SECTORS } from '@/lib/ntee'
import FilterChip from './FilterChip'
import ColumnPicker, { COLUMN_GROUPS, DEFAULT_VISIBLE_COLUMNS } from './ColumnPicker'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Filters {
  state?: string
  sector?: string
  cohort_id?: number
  year_min?: number
  year_max?: number
}

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
  if (opts.filters.state) p.set('state', opts.filters.state)
  if (opts.filters.sector) p.set('sector', opts.filters.sector)
  if (opts.filters.cohort_id) p.set('cohort_id', String(opts.filters.cohort_id))
  if (opts.filters.year_min) p.set('year_min', String(opts.filters.year_min))
  if (opts.filters.year_max) p.set('year_max', String(opts.filters.year_max))
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
  ein: 'EIN',
  name: 'Organization',
  fiscal_year: 'Year',
  state: 'State',
  sector: 'Sector',
  cohort_name: 'Cohort',
  total_revenue: 'Revenue',
  total_expenses: 'Expenses',
  net_income: 'Net Income',
  total_assets: 'Total Assets',
  total_net_assets: 'Net Assets',
  total_liabilities: 'Liabilities',
  cash_equiv: 'Cash & Equiv.',
  st_investments: 'ST Investments',
}

const SORTABLE = new Set(['total_revenue', 'total_expenses', 'net_income', 'total_assets', 'total_net_assets', 'fiscal_year', 'name'])

const NUMERIC_COLS = new Set(['total_revenue', 'total_expenses', 'net_income', 'total_assets', 'total_net_assets', 'total_liabilities', 'cash_equiv', 'st_investments'])

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
    case 'cohort_name':
      return row.cohort_name
        ? <span style={{ color: '#6F99CC', fontWeight: 500, fontSize: '12px' }}>{row.cohort_name}</span>
        : <span style={{ color: '#7A9AA4' }}>—</span>
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
    case 'total_assets': return formatCurrency(row.total_assets, true)
    case 'total_net_assets': return formatCurrency(row.total_net_assets, true)
    case 'total_liabilities': return formatCurrency(row.total_liabilities, true)
    case 'cash_equiv': return formatCurrency(row.cash_equiv, true)
    case 'st_investments': return formatCurrency(row.st_investments, true)
    default: return '—'
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MainDataTable() {
  const router = useRouter()

  // State
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filters, setFilters] = useState<Filters>({})
  const [sortBy, setSortBy] = useState('total_revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 100

  const [rows, setRows] = useState<(FilingWithOrg & { net_income?: number | null })[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const [selectedEins, setSelectedEins] = useState<Set<string>>(new Set())
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS)

  // Dropdowns
  const [filterOpen, setFilterOpen] = useState(false)
  const [columnPickerOpen, setColumnPickerOpen] = useState(false)
  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [cohorts, setCohorts] = useState<Cohort[]>([])

  // Filter form state (inside dropdown)
  const [filterDraft, setFilterDraft] = useState<{
    state: string
    sector: string
    cohort_id: string
    year_min: string
    year_max: string
  }>({ state: '', sector: '', cohort_id: '', year_min: '', year_max: '' })

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

  // Apply filter draft
  function applyFilters() {
    const f: Filters = {}
    if (filterDraft.state.trim()) f.state = filterDraft.state.trim().toUpperCase()
    if (filterDraft.sector) f.sector = filterDraft.sector
    if (filterDraft.cohort_id) f.cohort_id = parseInt(filterDraft.cohort_id, 10)
    if (filterDraft.year_min) f.year_min = parseInt(filterDraft.year_min, 10)
    if (filterDraft.year_max) f.year_max = parseInt(filterDraft.year_max, 10)
    setFilters(f)
    setPage(1)
    setFilterOpen(false)
  }

  // Remove individual filter
  function removeFilter(key: keyof Filters) {
    setFilters((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setFilterDraft((prev) => ({
      ...prev,
      [key]: '',
    }))
    setPage(1)
  }

  // Selection
  function toggleSelectAll() {
    if (rows.every((r) => selectedEins.has(r.ein))) {
      const next = new Set(selectedEins)
      rows.forEach((r) => next.delete(r.ein))
      setSelectedEins(next)
    } else {
      const next = new Set(selectedEins)
      rows.forEach((r) => next.add(r.ein))
      setSelectedEins(next)
    }
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

  // Active filter chips
  const activeFilterChips: { key: keyof Filters; label: string; value: string }[] = []
  if (filters.state) activeFilterChips.push({ key: 'state', label: 'State', value: filters.state })
  if (filters.sector) activeFilterChips.push({ key: 'sector', label: 'Sector', value: filters.sector })
  if (filters.cohort_id) {
    const c = cohorts.find((c) => c.id === filters.cohort_id)
    activeFilterChips.push({ key: 'cohort_id', label: 'Cohort', value: c?.name ?? String(filters.cohort_id) })
  }
  if (filters.year_min) activeFilterChips.push({ key: 'year_min', label: 'Year ≥', value: String(filters.year_min) })
  if (filters.year_max) activeFilterChips.push({ key: 'year_max', label: 'Year ≤', value: String(filters.year_max) })

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
            <button
              onClick={() => setFilterOpen((o) => !o)}
              style={btnStyle}
            >
              + Add Filter
            </button>
            {filterOpen && (
              <div
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
                  padding: '14px',
                  minWidth: '260px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={fieldRow}>
                  <label style={fieldLabel}>State</label>
                  <input
                    type="text"
                    maxLength={2}
                    placeholder="e.g. CA"
                    value={filterDraft.state}
                    onChange={(e) => setFilterDraft((d) => ({ ...d, state: e.target.value }))}
                    style={filterInput}
                  />
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>Sector</label>
                  <select
                    value={filterDraft.sector}
                    onChange={(e) => setFilterDraft((d) => ({ ...d, sector: e.target.value }))}
                    style={filterInput}
                  >
                    <option value="">All</option>
                    {NTEE_SECTORS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>Year Range</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="number"
                      placeholder="Min"
                      value={filterDraft.year_min}
                      onChange={(e) => setFilterDraft((d) => ({ ...d, year_min: e.target.value }))}
                      style={{ ...filterInput, width: '70px' }}
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={filterDraft.year_max}
                      onChange={(e) => setFilterDraft((d) => ({ ...d, year_max: e.target.value }))}
                      style={{ ...filterInput, width: '70px' }}
                    />
                  </div>
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>Cohort</label>
                  <select
                    value={filterDraft.cohort_id}
                    onChange={(e) => setFilterDraft((d) => ({ ...d, cohort_id: e.target.value }))}
                    style={filterInput}
                  >
                    <option value="">All</option>
                    {cohorts.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px' }}>
                  <button onClick={() => setFilterOpen(false)} style={btnStyleSecondary}>Cancel</button>
                  <button onClick={applyFilters} style={btnStylePrimary}>Apply</button>
                </div>
              </div>
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
            {activeFilterChips.map((chip) => (
              <FilterChip
                key={chip.key}
                label={chip.label}
                value={chip.value}
                onRemove={() => removeFilter(chip.key)}
              />
            ))}
            <button
              onClick={() => {
                setFilters({})
                setFilterDraft({ state: '', sector: '', cohort_id: '', year_min: '', year_max: '' })
                setPage(1)
              }}
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
