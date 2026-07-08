'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import type { Organization, Filing } from '@/types'
import { formatCurrency, formatEIN, formatPercent } from '@/lib/format'
import { calcAllMethods, getMethodConfidence } from '@/lib/metrics/unrestricted-cash'
import {
  calcMonthlyOpex,
  calcReserveCoverage,
  calcPersonnelPct,
  calcEarned,
  calcContributed,
  calcYoYRestrictionChange,
  calcEstUnrestrictedContrib,
  calcUnrestrictedOpIncome,
  calcEarnedPct,
  calcContribPct,
} from '@/lib/metrics/custom-metrics'

// ─── Color tokens ────────────────────────────────────────────────────────────
const C = {
  canvas: '#F2F4F1',
  surface: '#FFFFFF',
  textPrimary: '#10232B',
  textSecondary: '#3D5A63',
  textTertiary: '#7A9AA4',
  accent: '#6F99CC',
  accentLight: '#E4EEF8',
  accentBorder: '#AECAE0',
  border: '#BDD3DC',
  sectionHeaderBg: '#D7E8EE',
  warning: '#7A5C3A',
  warningLight: '#F3EAE0',
  warningBorder: '#C4A882',
  error: '#B83228',
  errorLight: '#FAEBE9',
  chartPalette: ['#203E46', '#6F99CC', '#A78B70', '#4A8A6A', '#8A5A8A'],
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface FilingWithReconciliation extends Filing {
  reconciliation_status?: 'reconciled' | 'exception' | null
  has_exception?: boolean
  pdf_url?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function confidenceColor(conf: 'Low' | 'Midpoint' | 'High') {
  if (conf === 'High') return { bg: '#D4ECD9', text: '#1A5C2A', border: '#8FCB9B' }
  if (conf === 'Midpoint') return { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B' }
  return { bg: '#F3F4F6', text: '#4B5563', border: '#D1D5DB' }
}

function formatCompact(v: number | null): string {
  return formatCurrency(v, true)
}

// ─── OrgSearch ───────────────────────────────────────────────────────────────
function OrgSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Organization[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/organizations?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(Array.isArray(data) ? data : [])
          setOpen(true)
        }
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  function select(org: Organization) {
    setOpen(false)
    setQuery('')
    router.push(`/institution/${org.ein}`)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '280px' }}>
      <input
        value={query}
        onChange={handleInput}
        placeholder="Search organizations…"
        style={{
          width: '100%',
          padding: '7px 12px',
          border: `1px solid ${C.accentBorder}`,
          borderRadius: '6px',
          fontSize: '13px',
          backgroundColor: C.surface,
          color: C.textPrimary,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {open && results.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '2px',
            backgroundColor: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(16,35,43,0.12)',
            zIndex: 100,
            maxHeight: '240px',
            overflowY: 'auto',
          }}
        >
          {results.map((org) => (
            <button
              key={org.ein}
              onClick={() => select(org)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                color: C.textPrimary,
                borderBottom: `1px solid ${C.canvas}`,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.accentLight }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
            >
              <div style={{ fontWeight: 500 }}>{org.name}</div>
              <div style={{ fontSize: '11px', color: C.textTertiary }}>{formatEIN(org.ein)} · {org.state}</div>
            </button>
          ))}
        </div>
      )}
      {loading && (
        <div style={{ position: 'absolute', right: '10px', top: '8px', color: C.textTertiary, fontSize: '12px' }}>
          …
        </div>
      )}
    </div>
  )
}

// ─── FinancialRow ─────────────────────────────────────────────────────────────
function FinRow({
  label,
  ref: refLabel,
  value,
  formatted: formattedOverride,
  isTotal,
  isNegativeRed,
}: {
  label: string
  ref?: string
  value: number | null
  formatted?: string
  isTotal?: boolean
  isNegativeRed?: boolean
}) {
  const formatted = formattedOverride ?? (value === null ? '—' : formatCurrency(value))
  const negative = isNegativeRed && value !== null && value < 0

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: isTotal ? '6px 0 4px' : '3px 0',
        borderTop: isTotal ? `1px solid ${C.border}` : 'none',
        marginTop: isTotal ? '4px' : 0,
        fontWeight: isTotal ? 600 : 400,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '13px', color: isTotal ? C.textPrimary : C.textPrimary }}>
          {label}
        </span>
        {refLabel && (
          <span style={{ fontSize: '11px', color: C.textTertiary }}>{refLabel}</span>
        )}
      </div>
      <span
        style={{
          fontSize: '13px',
          fontVariantNumeric: 'tabular-nums',
          color: negative ? C.error : C.textPrimary,
        }}
      >
        {formatted}
      </span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function InstitutionView({
  organization,
  filings,
}: {
  organization: Organization
  filings: Filing[]
}) {
  const sortedFilings = [...filings].sort((a, b) => a.fiscal_year - b.fiscal_year)
  const latestYear = sortedFilings.length > 0 ? sortedFilings[sortedFilings.length - 1].fiscal_year : 0
  const [selectedYear, setSelectedYear] = useState<number>(latestYear)

  const selectedFiling = (sortedFilings.find(f => f.fiscal_year === selectedYear) ?? sortedFilings[sortedFilings.length - 1]) as FilingWithReconciliation | undefined
  const hasException = selectedFiling?.has_exception === true
  const reconciliationStatus = selectedFiling?.reconciliation_status ?? null
  const isReconciled = reconciliationStatus !== 'exception'

  // Chart: up to last 5 years centered on selected, or all if <=5
  const chartFilings = (() => {
    const idx = sortedFilings.findIndex(f => f.fiscal_year === selectedYear)
    if (idx === -1 || sortedFilings.length <= 5) {
      return sortedFilings.slice(-5)
    }
    const start = Math.max(0, idx - 2)
    const end = Math.min(sortedFilings.length, start + 5)
    return sortedFilings.slice(Math.max(0, end - 5), end)
  })()

  // Neon returns BIGINT as strings; Recharts needs numbers to plot
  const toNum = (v: number | string | null): number | null => {
    if (v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const chartData = chartFilings.map(f => ({
    year: f.fiscal_year,
    revenue: toNum(f.total_revenue),
    expenses: toNum(f.total_expenses),
  }))

  // Method cards
  const methods = selectedFiling
    ? calcAllMethods(selectedFiling)
    : { m1: null, m2: null, m3: null }

  const methodDefs = [
    { key: 'M1' as const, label: 'Low', formula: 'Unrestricted NA − PP&E', value: methods.m1 },
    { key: 'M2' as const, label: 'Midpoint', formula: 'Avg(Low, High)', value: methods.m2 },
    { key: 'M3' as const, label: 'High', formula: 'Low + Deferred Rev + Bonds + Mortgages + Notes', value: methods.m3 },
  ]

  const prevFiling = selectedFiling
    ? (sortedFilings[sortedFilings.findIndex(f => f.fiscal_year === selectedFiling.fiscal_year) - 1] ?? null)
    : null

  const customMetrics = selectedFiling ? {
    monthlyOpex: calcMonthlyOpex(selectedFiling),
    reserveCoverage: calcReserveCoverage(methods.m2, selectedFiling),
    personnelPct: calcPersonnelPct(selectedFiling),
    earned: calcEarned(selectedFiling),
    contributed: calcContributed(selectedFiling),
    yoyRestrictionChange: calcYoYRestrictionChange(selectedFiling, prevFiling),
    estUnrestrictedContrib: calcEstUnrestrictedContrib(selectedFiling, prevFiling),
    unrestrictedOpIncome: calcUnrestrictedOpIncome(selectedFiling, prevFiling),
    earnedPct: calcEarnedPct(selectedFiling, prevFiling),
    contribPct: calcContribPct(selectedFiling, prevFiling),
  } : null

  const exportHref = `/api/export?ein=${encodeURIComponent(organization.ein)}&format=csv&sort_by=fiscal_year&sort_dir=desc`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* ── Page Header ── */}
      <div
        style={{
          backgroundColor: C.sectionHeaderBg,
          borderBottom: `1px solid ${C.border}`,
          padding: '16px 24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: C.textPrimary, lineHeight: 1.2 }}>
              {organization.name}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                EIN {formatEIN(organization.ein)}
              </span>
              {/* Reconciliation badge */}
              {isReconciled ? (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: '#D4ECD9',
                    color: '#1A5C2A',
                    border: '1px solid #8FCB9B',
                  }}
                >
                  ✓ Reconciled
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: C.warningLight,
                    color: C.warning,
                    border: `1px solid ${C.warningBorder}`,
                  }}
                >
                  ⚠ Exception
                </span>
              )}
            </div>
          </div>

          {/* Header actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <OrgSearch />
            <a
              href={exportHref}
              style={{
                padding: '7px 14px',
                backgroundColor: C.accent,
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Export ↓
            </a>
            <span
              title="Source PDF not yet available"
              style={{
                padding: '7px 14px',
                backgroundColor: C.canvas,
                color: C.textTertiary,
                border: `1px solid ${C.border}`,
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >
              Source 990 ↗
            </span>
          </div>
        </div>
      </div>

      {/* ── Exception Banner ── */}
      {hasException && (
        <div
          style={{
            backgroundColor: C.warningLight,
            borderBottom: `1px solid ${C.warningBorder}`,
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: C.warning,
            fontWeight: 500,
          }}
        >
          <span>⚠</span>
          <span>Reconciliation exception — review required.</span>
          <span
            style={{
              marginLeft: '4px',
              color: C.textTertiary,
              cursor: 'not-allowed',
              textDecoration: 'underline',
            }}
          >
            View Source 990 ↗
          </span>
        </div>
      )}

      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, overflowY: 'auto' }}>

        {/* ── Year Strip ── */}
        <div
          style={{
            backgroundColor: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            padding: '12px 16px',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textTertiary, marginBottom: '10px' }}>
            Fiscal Year
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {sortedFilings.map((f) => {
              const selected = f.fiscal_year === selectedYear
              return (
                <button
                  key={f.fiscal_year}
                  onClick={() => setSelectedYear(f.fiscal_year)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: `1px solid ${selected ? C.accent : C.border}`,
                    backgroundColor: selected ? C.accent : C.surface,
                    color: selected ? '#fff' : C.textPrimary,
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: selected ? 600 : 400,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                    minWidth: '72px',
                  }}
                >
                  <span>FY {f.fiscal_year}</span>
                  <span style={{ fontSize: '11px', opacity: 0.85 }}>{formatCompact(f.total_revenue)}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 5-Year Trend Chart ── */}
        <div
          style={{
            backgroundColor: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              backgroundColor: C.sectionHeaderBg,
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600, color: C.textPrimary }}>
              Revenue vs Expenses Trend
            </span>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '12px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: C.textSecondary }}>
                <span style={{ display: 'inline-block', width: '20px', height: '2px', backgroundColor: '#6F99CC' }} />
                Revenue
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: C.textSecondary }}>
                <span style={{ display: 'inline-block', width: '20px', height: '2px', backgroundColor: '#203E46', borderTop: '2px dashed #203E46' }} />
                Expenses
              </span>
            </div>
          </div>
          <div style={{ padding: '16px', height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                onClick={(e: unknown) => {
                  const ev = e as { activePayload?: Array<{ payload?: { year?: number } }> } | null
                  const year = ev?.activePayload?.[0]?.payload?.year
                  if (year) setSelectedYear(year)
                }}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 12, fill: C.textTertiary }}
                  tickFormatter={(v) => `FY ${v}`}
                  axisLine={{ stroke: C.border }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: C.textTertiary }}
                  tickFormatter={(v) => formatCompact(v)}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={(val, name) => [formatCurrency(val as number), name]}
                  labelFormatter={(v) => `FY ${v}`}
                  contentStyle={{
                    border: `1px solid ${C.border}`,
                    borderRadius: '6px',
                    fontSize: '12px',
                    backgroundColor: C.surface,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#6F99CC"
                  strokeWidth={2}
                  dot={{ r: 4, fill: '#6F99CC' }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="expenses"
                  name="Expenses"
                  stroke="#203E46"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={{ r: 4, fill: '#203E46' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Unrestricted Cash — 3 Method Cards ── */}
        <div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: C.textTertiary,
              marginBottom: '10px',
            }}
          >
            Unrestricted Cash Estimate — FY {selectedYear}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {methodDefs.map(({ key, label, formula, value }) => {
              const conf = getMethodConfidence(key)
              const confStyle = confidenceColor(conf)
              return (
                <div
                  key={key}
                  style={{
                    backgroundColor: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: C.textPrimary,
                        backgroundColor: C.accentLight,
                        border: `1px solid ${C.accentBorder}`,
                        borderRadius: '4px',
                        padding: '2px 8px',
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: confStyle.bg,
                        color: confStyle.text,
                        border: `1px solid ${confStyle.border}`,
                      }}
                    >
                      {conf}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: C.textTertiary }}>{formula}</div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: value !== null ? C.textPrimary : C.textTertiary,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {value !== null ? formatCurrency(value) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Financial Statements ── */}
        {selectedFiling && (
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: C.textTertiary,
                marginBottom: '10px',
              }}
            >
              Financial Statements — FY {selectedYear}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

              {/* Left: Income Statement */}
              <div
                style={{
                  backgroundColor: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    backgroundColor: C.sectionHeaderBg,
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: C.textPrimary,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  Income Statement
                </div>
                <div style={{ padding: '12px 16px' }}>
                  <FinRow label="Contributions" ref="Pt VIII L1h" value={selectedFiling.contributions} />
                  <FinRow label="Program Revenue" ref="Pt VIII L2g" value={selectedFiling.program_revenue} />
                  <FinRow label="Investment Income" ref="Pt VIII L3" value={selectedFiling.investment_income} />
                  <FinRow label="Other Revenue" ref="Pt VIII L11e" value={selectedFiling.other_revenue} />
                  <FinRow label="Total Revenue" value={selectedFiling.total_revenue} isTotal />

                  <div style={{ height: '16px' }} />

                  <FinRow label="Program Expenses" ref="Pt IX L25a" value={selectedFiling.program_expenses} />
                  <FinRow label="G&A" ref="Pt IX L25c" value={selectedFiling.ga_expenses} />
                  <FinRow label="Fundraising" ref="Pt IX L25d" value={selectedFiling.fundraising_expenses} />
                  <FinRow label="Total Expenses" value={selectedFiling.total_expenses} isTotal />

                  <div style={{ height: '16px' }} />

                  <FinRow
                    label="Net Income"
                    value={
                      selectedFiling.total_revenue !== null && selectedFiling.total_expenses !== null
                        ? selectedFiling.total_revenue - selectedFiling.total_expenses
                        : null
                    }
                    isTotal
                    isNegativeRed
                  />
                </div>
              </div>

              {/* Right: Balance Sheet */}
              <div
                style={{
                  backgroundColor: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    backgroundColor: C.sectionHeaderBg,
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: C.textPrimary,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  Balance Sheet
                </div>
                <div style={{ padding: '12px 16px' }}>
                  <FinRow label="Cash & Equiv." ref="Pt X L1" value={selectedFiling.cash_equiv} />
                  <FinRow label="ST Investments" ref="Pt X L2" value={selectedFiling.st_investments} />
                  <FinRow label="LT Investments" ref="Pt X L5+6" value={selectedFiling.lt_investments} />
                  <FinRow label="PP&E" ref="Pt X L10c" value={selectedFiling.ppe} />
                  <FinRow label="Total Assets" ref="Pt X L16" value={selectedFiling.total_assets} isTotal />

                  <div style={{ height: '16px' }} />

                  <FinRow label="Total Liabilities" ref="Pt X L26" value={selectedFiling.total_liabilities} isTotal />

                  <div style={{ height: '16px' }} />

                  <FinRow label="Unrestricted NA" ref="Pt X L27" value={selectedFiling.unrestr_net_assets} />
                  <FinRow
                    label="Restricted NA"
                    ref="Pt X L28+29"
                    value={
                      selectedFiling.total_net_assets !== null && selectedFiling.unrestr_net_assets !== null
                        ? selectedFiling.total_net_assets - selectedFiling.unrestr_net_assets
                        : selectedFiling.restr_net_assets
                    }
                  />
                  <FinRow label="Total Net Assets" ref="Pt X L33" value={selectedFiling.total_net_assets} isTotal />
                </div>
              </div>
            </div>

            {/* ── Custom Metrics ── */}
            {customMetrics && (
              <div style={{ marginTop: '16px' }}>
                <div
                  style={{
                    backgroundColor: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: C.sectionHeaderBg,
                      padding: '8px 16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: C.textPrimary,
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    Custom Metrics — FY {selectedYear}
                  </div>
                  <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
                    <div>
                      <FinRow label="Monthly Opex" value={customMetrics.monthlyOpex} />
                      <FinRow
                        label="Reserve Coverage"
                        value={null}
                        formatted={customMetrics.reserveCoverage !== null ? `${customMetrics.reserveCoverage.toFixed(1)}x` : '—'}
                      />
                      <FinRow
                        label="Personnel as % of Annual"
                        value={null}
                        formatted={customMetrics.personnelPct !== null ? `${(customMetrics.personnelPct * 100).toFixed(1)}%` : '—'}
                      />
                    </div>
                    <div>
                      <FinRow label="Unrestricted Operating Income Est" value={customMetrics.unrestrictedOpIncome} isTotal />
                      <div style={{ height: '8px' }} />
                      <FinRow label="Earned" value={customMetrics.earned} />
                      <FinRow
                        label="Earned as % of Income"
                        value={null}
                        formatted={customMetrics.earnedPct !== null ? `${(customMetrics.earnedPct * 100).toFixed(1)}%` : '—'}
                      />
                      <div style={{ height: '8px' }} />
                      <FinRow label="Est. Unrestricted Contrib" value={customMetrics.estUnrestrictedContrib} />
                      <FinRow
                        label="Contributed as % of Income"
                        value={null}
                        formatted={customMetrics.contribPct !== null ? `${(customMetrics.contribPct * 100).toFixed(1)}%` : '—'}
                      />
                      <div style={{ height: '8px' }} />
                      <FinRow label="Contributed (gross)" value={customMetrics.contributed} />
                      <FinRow label="YoY Restriction Change" value={customMetrics.yoyRestrictionChange} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
