'use client'

import { useState, useEffect, useRef } from 'react'
import { NTEE_SECTORS, SECTOR_TO_NTEE_LETTERS } from '@/lib/ntee'
import { COLUMN_GROUPS } from './ColumnPicker'
import type { Cohort } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Filters {
  cohort_id?: number
  year_min?: number
  year_max?: number
  state?: string[]
  ntee_category?: string[]
  form_type?: string[]
  filing_method?: string[]
  has_lobbying?: boolean
  has_political_activity?: boolean
  has_unrelated_business_income?: boolean
  has_foreign_office?: boolean
  has_foreign_grants?: boolean
  operates_hospital?: boolean
  operates_school?: boolean
  has_related_orgs?: boolean
  ranges?: Record<string, { min?: number; max?: number }>
}

export function buildFilterParams(filters: Filters): Record<string, string> {
  const p: Record<string, string> = {}
  if (filters.state?.length)         p.state          = filters.state.join(',')
  if (filters.ntee_category?.length) p.ntee_category  = filters.ntee_category.join(',')
  if (filters.form_type?.length)     p.form_type      = filters.form_type.join(',')
  if (filters.filing_method?.length) p.filing_method  = filters.filing_method.join(',')
  if (filters.cohort_id)             p.cohort_id      = String(filters.cohort_id)
  if (filters.year_min)              p.year_min       = String(filters.year_min)
  if (filters.year_max)              p.year_max       = String(filters.year_max)
  for (const k of BOOL_GOV_COLS) {
    const v = filters[k as keyof Filters]
    if (v !== undefined) p[k] = String(v)
  }
  if (filters.ranges) {
    for (const [col, { min, max }] of Object.entries(filters.ranges)) {
      if (min !== undefined) p[`${col}_min`] = String(min)
      if (max !== undefined) p[`${col}_max`] = String(max)
    }
  }
  return p
}

// ── Constants ────────────────────────────────────────────────────────────────

const BOOL_GOV_COLS = [
  'has_lobbying', 'has_political_activity', 'has_unrelated_business_income',
  'has_foreign_office', 'has_foreign_grants', 'operates_hospital',
  'operates_school', 'has_related_orgs',
] as const

const GOV_LABELS: Record<string, string> = {
  has_lobbying: 'Lobbying Activity',
  has_political_activity: 'Political Activity',
  has_unrelated_business_income: 'Unrelated Business Income',
  has_foreign_office: 'Foreign Office',
  has_foreign_grants: 'Foreign Grants',
  operates_hospital: 'Operates Hospital',
  operates_school: 'Operates School',
  has_related_orgs: 'Related Organizations',
}

// Numeric groups from COLUMN_GROUPS (exclude Required, Identity, Governance)
const CATEGORICAL_GROUP_LABELS = new Set(['Required', 'Identity', 'Governance'])
const NUMERIC_GROUPS = COLUMN_GROUPS.filter(g => !CATEGORICAL_GROUP_LABELS.has(g.label))

// ── Draft helpers ─────────────────────────────────────────────────────────────

interface Draft {
  year_min: string
  year_max: string
  cohort_id: string
  state: string[]
  ntee_category: string[]
  form_type: string[]
  filing_method: string[]
  gov: Record<string, '' | 'true' | 'false'>
  ranges: Record<string, { min: string; max: string }>
}

function filtersToDraft(f: Filters): Draft {
  const gov: Record<string, '' | 'true' | 'false'> = {}
  for (const k of BOOL_GOV_COLS) {
    const v = f[k as keyof Filters]
    gov[k] = v === undefined ? '' : v ? 'true' : 'false'
  }
  const ranges: Record<string, { min: string; max: string }> = {}
  if (f.ranges) {
    for (const [col, { min, max }] of Object.entries(f.ranges)) {
      ranges[col] = { min: min !== undefined ? String(min) : '', max: max !== undefined ? String(max) : '' }
    }
  }
  return {
    year_min: f.year_min !== undefined ? String(f.year_min) : '',
    year_max: f.year_max !== undefined ? String(f.year_max) : '',
    cohort_id: f.cohort_id !== undefined ? String(f.cohort_id) : '',
    state: f.state ?? [],
    ntee_category: f.ntee_category ?? [],
    form_type: f.form_type ?? [],
    filing_method: f.filing_method ?? [],
    gov,
    ranges,
  }
}

function draftToFilters(d: Draft): Filters {
  const f: Filters = {}
  if (d.state.length)          f.state          = d.state
  if (d.ntee_category.length)  f.ntee_category  = d.ntee_category
  if (d.form_type.length)      f.form_type      = d.form_type
  if (d.filing_method.length)  f.filing_method  = d.filing_method
  if (d.cohort_id)             f.cohort_id      = parseInt(d.cohort_id, 10)
  if (d.year_min)              f.year_min       = parseInt(d.year_min, 10)
  if (d.year_max)              f.year_max       = parseInt(d.year_max, 10)
  for (const k of BOOL_GOV_COLS) {
    if (d.gov[k] === 'true')  (f as Record<string, unknown>)[k] = true
    if (d.gov[k] === 'false') (f as Record<string, unknown>)[k] = false
  }
  const ranges: Filters['ranges'] = {}
  for (const [col, { min, max }] of Object.entries(d.ranges)) {
    const entry: { min?: number; max?: number } = {}
    if (min !== '') entry.min = Number(min)
    if (max !== '') entry.max = Number(max)
    if (Object.keys(entry).length > 0) ranges[col] = entry
  }
  if (Object.keys(ranges).length > 0) f.ranges = ranges
  return f
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
      color: '#7A9AA4', textTransform: 'uppercase', marginBottom: '8px' }}>
      {children}
    </div>
  )
}

function MultiSelect({ label, values, selected, onChange, searchable = false }:
  { label: string; values: string[]; selected: string[]; onChange: (v: string[]) => void; searchable?: boolean }) {
  const [q, setQ] = useState('')
  const filtered = searchable && q ? values.filter(v => v.toLowerCase().includes(q.toLowerCase())) : values
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <SectionLabel>{label}</SectionLabel>
        {selected.length > 0 && (
          <button onClick={() => onChange([])}
            style={{ fontSize: '10px', color: '#7A9AA4', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Clear
          </button>
        )}
      </div>
      {searchable && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
          style={{ width: '100%', fontSize: '12px', padding: '4px 7px', border: '1px solid #BDD3DC',
            borderRadius: '4px', marginBottom: '6px', boxSizing: 'border-box', color: '#10232B' }} />
      )}
      <div style={{ maxHeight: '130px', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {filtered.map(v => {
          const active = selected.includes(v)
          return (
            <button key={v} onClick={() => toggle(v)}
              style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', cursor: 'pointer',
                border: `1px solid ${active ? '#203E46' : '#BDD3DC'}`,
                backgroundColor: active ? '#203E46' : '#FFFFFF',
                color: active ? '#FFFFFF' : '#3D5A63', whiteSpace: 'nowrap' }}>
              {v}
            </button>
          )
        })}
        {filtered.length === 0 && <span style={{ fontSize: '11px', color: '#7A9AA4' }}>No results</span>}
      </div>
    </div>
  )
}

function BoolToggle({ label, value, onChange }:
  { label: string; value: '' | 'true' | 'false'; onChange: (v: '' | 'true' | 'false') => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
      <span style={{ fontSize: '12px', color: '#10232B' }}>{label}</span>
      <div style={{ display: 'flex', gap: '2px' }}>
        {(['', 'true', 'false'] as const).map((opt) => (
          <button key={opt} onClick={() => onChange(opt)}
            style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
              border: `1px solid ${value === opt ? '#203E46' : '#BDD3DC'}`,
              backgroundColor: value === opt ? '#203E46' : '#FFFFFF',
              color: value === opt ? '#FFFFFF' : '#3D5A63' }}>
            {opt === '' ? 'Any' : opt === 'true' ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface FilterPanelProps {
  filters: Filters
  cohorts: Cohort[]
  onChange: (f: Filters) => void
  onClose: () => void
}

export default function FilterPanel({ filters, cohorts, onChange, onClose }: FilterPanelProps) {
  const [draft, setDraft] = useState<Draft>(() => filtersToDraft(filters))
  const [stateOptions, setStateOptions]   = useState<string[]>([])
  const [ftOptions, setFtOptions]         = useState<string[]>([])
  const [fmOptions, setFmOptions]         = useState<string[]>([])
  const [numPickerOpen, setNumPickerOpen] = useState(false)
  const numPickerRef = useRef<HTMLDivElement>(null)
  const numBtnRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [numPickerPos, setNumPickerPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    fetch('/api/filter-options?column=state').then(r => r.json()).then(d => setStateOptions(d.values ?? []))
    fetch('/api/filter-options?column=form_type').then(r => r.json()).then(d => setFtOptions(d.values ?? []))
    fetch('/api/filter-options?column=filing_method').then(r => r.json()).then(d => setFmOptions(d.values ?? []))
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (numPickerRef.current && !numPickerRef.current.contains(e.target as Node)) setNumPickerOpen(false)
    }
    if (numPickerOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [numPickerOpen])

  function setDraftField<K extends keyof Draft>(key: K, val: Draft[K]) {
    setDraft(d => ({ ...d, [key]: val }))
  }

  function addRange(colKey: string) {
    if (draft.ranges[colKey]) return
    setDraft(d => ({ ...d, ranges: { ...d.ranges, [colKey]: { min: '', max: '' } } }))
    setNumPickerOpen(false)
    setTimeout(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }) }, 0)
  }

  function removeRange(colKey: string) {
    setDraft(d => { const r = { ...d.ranges }; delete r[colKey]; return { ...d, ranges: r } })
  }

  function apply() { onChange(draftToFilters(draft)); onClose() }

  function clearAll() {
    const empty: Draft = {
      year_min: '', year_max: '', cohort_id: '',
      state: [], ntee_category: [], form_type: [], filing_method: [],
      gov: Object.fromEntries(BOOL_GOV_COLS.map(k => [k, ''])),
      ranges: {},
    }
    setDraft(empty)
    onChange({})
    onClose()
  }

  // Flatten all numeric columns for the "add filter" picker
  const addedRangeKeys = new Set(Object.keys(draft.ranges))
  const availableNumericCols = NUMERIC_GROUPS.flatMap(g =>
    g.columns.map(c => ({ ...c, group: g.label })).filter(c => !addedRangeKeys.has(c.key))
  )

  const inputStyle: React.CSSProperties = {
    fontSize: '12px', padding: '5px 8px', border: '1px solid #BDD3DC',
    borderRadius: '4px', color: '#10232B', backgroundColor: '#F8FAFB',
    boxSizing: 'border-box', width: '100%',
  }
  const rangeInputStyle: React.CSSProperties = { ...inputStyle, width: '90px' }
  const sectionStyle: React.CSSProperties = {
    padding: '12px 16px', borderBottom: '1px solid #E8EFF2',
  }

  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, marginTop: '4px',
      width: '360px', maxHeight: '580px',
      backgroundColor: '#FFFFFF', border: '1px solid #BDD3DC',
      borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
      zIndex: 50, display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #E8EFF2',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#10232B' }}>Filters</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '16px', color: '#7A9AA4', lineHeight: 1, padding: '0 2px' }}>×</button>
      </div>

      {/* Body */}
      <div ref={bodyRef} style={{ overflowY: 'auto', flex: 1 }}>

        {/* Year */}
        <div style={sectionStyle}>
          <SectionLabel>Year Range</SectionLabel>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="number" placeholder="From" value={draft.year_min}
              onChange={e => setDraftField('year_min', e.target.value)}
              style={{ ...rangeInputStyle }} />
            <span style={{ color: '#7A9AA4', fontSize: '12px' }}>–</span>
            <input type="number" placeholder="To" value={draft.year_max}
              onChange={e => setDraftField('year_max', e.target.value)}
              style={{ ...rangeInputStyle }} />
          </div>
        </div>

        {/* Cohort */}
        {cohorts.length > 0 && (
          <div style={sectionStyle}>
            <SectionLabel>Cohort</SectionLabel>
            <select value={draft.cohort_id} onChange={e => setDraftField('cohort_id', e.target.value)}
              style={inputStyle}>
              <option value="">All</option>
              {cohorts.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </div>
        )}

        {/* State */}
        <div style={sectionStyle}>
          <MultiSelect label="State" values={stateOptions}
            selected={draft.state} onChange={v => setDraftField('state', v)} searchable />
        </div>

        {/* NTEE Category */}
        <div style={sectionStyle}>
          <MultiSelect label="NTEE Category" values={NTEE_SECTORS}
            selected={draft.ntee_category} onChange={v => setDraftField('ntee_category', v)} />
        </div>

        {/* Form Type */}
        {ftOptions.length > 0 && (
          <div style={sectionStyle}>
            <MultiSelect label="Form Type" values={ftOptions}
              selected={draft.form_type} onChange={v => setDraftField('form_type', v)} />
          </div>
        )}

        {/* Filing Method */}
        {fmOptions.length > 0 && (
          <div style={sectionStyle}>
            <MultiSelect label="Filing Method" values={fmOptions}
              selected={draft.filing_method} onChange={v => setDraftField('filing_method', v)} />
          </div>
        )}

        {/* Governance */}
        <div style={sectionStyle}>
          <SectionLabel>Governance</SectionLabel>
          {BOOL_GOV_COLS.map(k => (
            <BoolToggle key={k} label={GOV_LABELS[k]}
              value={draft.gov[k] as '' | 'true' | 'false'}
              onChange={v => setDraft(d => ({ ...d, gov: { ...d.gov, [k]: v } }))} />
          ))}
        </div>

        {/* Numeric ranges */}
        <div style={sectionStyle}>
          <SectionLabel>Numeric Filters</SectionLabel>

          {/* Added range filters */}
          {Object.entries(draft.ranges).map(([col, { min, max }]) => {
            const meta = NUMERIC_GROUPS.flatMap(g => g.columns).find(c => c.key === col)
            return (
              <div key={col} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#3D5A63', fontWeight: 600 }}>{meta?.label ?? col}</span>
                  <button onClick={() => removeRange(col)}
                    style={{ fontSize: '10px', color: '#7A9AA4', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Remove
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="number" placeholder="Min" value={min}
                    onChange={e => setDraft(d => ({ ...d, ranges: { ...d.ranges, [col]: { ...d.ranges[col], min: e.target.value } } }))}
                    style={rangeInputStyle} />
                  <span style={{ color: '#7A9AA4', fontSize: '12px' }}>–</span>
                  <input type="number" placeholder="Max" value={max}
                    onChange={e => setDraft(d => ({ ...d, ranges: { ...d.ranges, [col]: { ...d.ranges[col], max: e.target.value } } }))}
                    style={rangeInputStyle} />
                </div>
              </div>
            )
          })}

          {/* Add numeric filter picker */}
          {availableNumericCols.length > 0 && (
            <div ref={numPickerRef}>
              <button
                ref={numBtnRef}
                onClick={() => {
                  if (!numPickerOpen && numBtnRef.current) {
                    const r = numBtnRef.current.getBoundingClientRect()
                    setNumPickerPos({ top: r.top, left: r.left })
                  }
                  setNumPickerOpen(o => !o)
                }}
                style={{ fontSize: '11px', color: '#6F99CC', background: 'none', border: '1px dashed #BDD3DC',
                  borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                + Add numeric filter
              </button>
              {numPickerOpen && numPickerPos && (
                <div style={{ position: 'fixed',
                  top: numPickerPos.top - 4,
                  left: numPickerPos.left,
                  transform: 'translateY(-100%)',
                  backgroundColor: '#FFFFFF', border: '1px solid #BDD3DC', borderRadius: '6px',
                  boxShadow: '0 -4px 12px rgba(0,0,0,0.1)', zIndex: 200,
                  maxHeight: '220px', overflowY: 'auto', minWidth: '220px' }}>
                  {NUMERIC_GROUPS.map(g => {
                    const available = g.columns.filter(c => !addedRangeKeys.has(c.key))
                    if (available.length === 0) return null
                    return (
                      <div key={g.label}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#7A9AA4', letterSpacing: '0.06em',
                          padding: '6px 10px 2px', textTransform: 'uppercase' }}>{g.label}</div>
                        {available.map(c => (
                          <button key={c.key} onClick={() => addRange(c.key)}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px',
                              fontSize: '12px', color: '#10232B', background: 'none', border: 'none',
                              cursor: 'pointer' }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F2F4F1')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #E8EFF2', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={clearAll}
          style={{ fontSize: '11px', color: '#7A9AA4', background: 'none', border: 'none', cursor: 'pointer' }}>
          Clear all
        </button>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={onClose}
            style={{ fontSize: '12px', padding: '5px 14px', border: '1px solid #BDD3DC',
              borderRadius: '5px', background: '#FFFFFF', color: '#3D5A63', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={apply}
            style={{ fontSize: '12px', padding: '5px 14px', border: '1px solid #203E46',
              borderRadius: '5px', background: '#203E46', color: '#FFFFFF', cursor: 'pointer', fontWeight: 600 }}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
