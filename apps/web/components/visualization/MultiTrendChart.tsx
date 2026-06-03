'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { Organization } from '@/types'
import { formatCurrency } from '@/lib/format'

const CHART_PALETTE = ['#203E46', '#6F99CC', '#A78B70', '#4A8A6A', '#8A5A8A']

const METRIC_OPTIONS = [
  { value: 'total_revenue', label: 'Revenue' },
  { value: 'total_expenses', label: 'Expenses' },
  { value: 'net_income', label: 'Net Income' },
  { value: 'total_assets', label: 'Total Assets' },
  { value: 'total_net_assets', label: 'Net Assets' },
]

interface TrendSeries {
  ein: string
  name: string
  data: { fiscal_year: number; value: number }[]
}

interface Props {
  yearMin: number
  yearMax: number
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ color: string; name: string; value: number }>
  label?: number
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #BDD3DC',
        borderRadius: 6,
        padding: '10px 14px',
        fontSize: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#10232B' }}>FY {label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: p.color, flexShrink: 0 }} />
          <span style={{ color: '#3D5A63', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name}
          </span>
          <span style={{ color: '#10232B', fontWeight: 500, marginLeft: 'auto', paddingLeft: 12 }}>
            {formatCurrency(p.value, true)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function MultiTrendChart({ yearMin, yearMax }: Props) {
  const [selectedEins, setSelectedEins] = useState<string[]>([])
  const [selectedOrgs, setSelectedOrgs] = useState<Organization[]>([])
  const [metric, setMetric] = useState('total_revenue')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Organization[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [seriesData, setSeriesData] = useState<TrendSeries[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [loadingChart, setLoadingChart] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Search organizations
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setLoadingSearch(true)
      try {
        const res = await fetch(`/api/organizations?q=${encodeURIComponent(searchQuery)}`)
        if (res.ok) {
          const data: Organization[] = await res.json()
          setSearchResults(data.filter((o) => !selectedEins.includes(o.ein)))
          setShowDropdown(true)
        }
      } finally {
        setLoadingSearch(false)
      }
    }, 300)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) }
  }, [searchQuery, selectedEins])

  // Fetch trend data
  const fetchTrend = useCallback(async () => {
    if (selectedEins.length === 0) {
      setSeriesData([])
      return
    }
    setLoadingChart(true)
    try {
      const params = new URLSearchParams({
        eins: selectedEins.join(','),
        metric,
        year_min: String(yearMin),
        year_max: String(yearMax),
      })
      const res = await fetch(`/api/visualization/trend?${params}`)
      if (res.ok) {
        const data: { series: TrendSeries[] } = await res.json()
        setSeriesData(data.series)
      }
    } finally {
      setLoadingChart(false)
    }
  }, [selectedEins, metric, yearMin, yearMax])

  useEffect(() => { fetchTrend() }, [fetchTrend])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function addOrg(org: Organization) {
    if (selectedEins.length >= 10 || selectedEins.includes(org.ein)) return
    setSelectedEins((prev) => [...prev, org.ein])
    setSelectedOrgs((prev) => [...prev, org])
    setSearchQuery('')
    setShowDropdown(false)
  }

  function removeOrg(ein: string) {
    setSelectedEins((prev) => prev.filter((e) => e !== ein))
    setSelectedOrgs((prev) => prev.filter((o) => o.ein !== ein))
  }

  // Build chart data: array of { fiscal_year, [orgName]: value }
  const allYears = Array.from(
    new Set(seriesData.flatMap((s) => s.data.map((d) => d.fiscal_year)))
  ).sort((a, b) => a - b)

  const chartData = allYears.map((year) => {
    const row: Record<string, number | string> = { fiscal_year: year }
    for (const series of seriesData) {
      const pt = series.data.find((d) => d.fiscal_year === year)
      if (pt !== undefined) row[series.ein] = pt.value
    }
    return row
  })

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 480 }}>
      {/* Left panel */}
      <div
        style={{
          width: 280,
          minWidth: 280,
          borderRight: '1px solid #BDD3DC',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          backgroundColor: '#FFFFFF',
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid #BDD3DC' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#7A9AA4', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Add Organization
          </div>
          <div ref={searchRef} style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search by name or EIN…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={selectedEins.length >= 10}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '7px 10px',
                fontSize: 13,
                border: '1px solid #BDD3DC',
                borderRadius: 5,
                backgroundColor: selectedEins.length >= 10 ? '#F2F4F1' : '#FFFFFF',
                color: '#10232B',
                outline: 'none',
              }}
            />
            {showDropdown && searchResults.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #BDD3DC',
                  borderRadius: 5,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  zIndex: 50,
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {searchResults.map((org) => (
                  <button
                    key={org.ein}
                    onClick={() => addOrg(org)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: '#10232B',
                      borderBottom: '1px solid #F2F4F1',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#E4EEF8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ fontWeight: 500 }}>{org.name}</div>
                    <div style={{ color: '#7A9AA4', fontSize: 11 }}>{org.ein} · {org.state}</div>
                  </button>
                ))}
              </div>
            )}
            {showDropdown && !loadingSearch && searchResults.length === 0 && searchQuery.length >= 2 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #BDD3DC',
                  borderRadius: 5,
                  padding: '10px 12px',
                  fontSize: 12,
                  color: '#7A9AA4',
                  zIndex: 50,
                }}
              >
                No results found
              </div>
            )}
          </div>
          {selectedEins.length >= 10 && (
            <div style={{ fontSize: 11, color: '#7A9AA4', marginTop: 6 }}>Maximum 10 organizations reached</div>
          )}
        </div>

        {/* Selected orgs list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {selectedOrgs.map((org, idx) => {
            const color = CHART_PALETTE[idx % CHART_PALETTE.length]
            return (
              <div
                key={org.ein}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 16px',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: '#10232B',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={org.name}
                >
                  {org.name}
                </span>
                <button
                  onClick={() => removeOrg(org.ein)}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    color: '#7A9AA4',
                    fontSize: 14,
                    lineHeight: 1,
                    padding: '2px 4px',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>

        {/* Metric selector */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #BDD3DC' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#7A9AA4', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Metric
          </div>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 10px',
              fontSize: 13,
              border: '1px solid #BDD3DC',
              borderRadius: 5,
              backgroundColor: '#FFFFFF',
              color: '#10232B',
              cursor: 'pointer',
            }}
          >
            {METRIC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Right panel: chart */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px' }}>
        {selectedEins.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#7A9AA4',
              fontSize: 14,
            }}
          >
            Select up to 10 organizations to compare
          </div>
        ) : loadingChart ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#7A9AA4',
              fontSize: 14,
            }}
          >
            Loading…
          </div>
        ) : (
          <>
            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginBottom: 16 }}>
              {selectedOrgs.map((org, idx) => {
                const color = CHART_PALETTE[idx % CHART_PALETTE.length]
                return (
                  <div key={org.ein} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3D5A63' }}>
                    <span style={{ width: 12, height: 3, backgroundColor: color, borderRadius: 2, display: 'inline-block' }} />
                    {org.name}
                  </div>
                )
              })}
            </div>
            <div style={{ flex: 1, minHeight: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4EEF8" />
                  <XAxis
                    dataKey="fiscal_year"
                    tick={{ fontSize: 11, fill: '#7A9AA4' }}
                    tickLine={false}
                    axisLine={{ stroke: '#BDD3DC' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#7A9AA4' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatCurrency(v, true)}
                    width={70}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {selectedOrgs.map((org, idx) => (
                    <Line
                      key={org.ein}
                      type="monotone"
                      dataKey={org.ein}
                      name={org.name}
                      stroke={CHART_PALETTE[idx % CHART_PALETTE.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
