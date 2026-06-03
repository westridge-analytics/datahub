'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { formatCurrency, formatPercent } from '@/lib/format'

const CHART_PALETTE = ['#203E46', '#6F99CC', '#A78B70', '#4A8A6A', '#8A5A8A']
const GROWTH_COHORTS = ['Shrinking', 'Flat', 'Slow Growth', 'Moderate Growth', 'High Growth']

interface GrowthMember {
  ein: string
  name: string
  cagr: number
  start_revenue: number
  end_revenue: number
}

interface GrowthCohortData {
  label: string
  members: GrowthMember[]
}

interface Props {
  yearMin: number
  yearMax: number
}

// For each cohort, compute avg indexed revenue per year across its members
interface RawMemberData {
  ein: string
  label: string
  years: { fiscal_year: number; revenue: number }[]
}

export default function GrowthChart({ yearMin, yearMax }: Props) {
  const [cohorts, setCohorts] = useState<GrowthCohortData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [indexedData, setIndexedData] = useState<Record<string, number | string>[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelectedCohort(null)
    try {
      const params = new URLSearchParams({
        type: 'growth',
        year_min: String(yearMin),
        year_max: String(yearMax),
      })
      const res = await fetch(`/api/visualization/cohorts?${params}`)
      if (!res.ok) {
        setError('Failed to load data')
        return
      }
      const data: { cohorts: GrowthCohortData[] } = await res.json()
      setCohorts(data.cohorts)

      // Build indexed chart: for each cohort with members, fetch trend data and index to 100
      const allEins = data.cohorts.flatMap((c) => c.members.map((m) => m.ein))
      if (allEins.length === 0) {
        setIndexedData([])
        return
      }

      // Fetch trend data for all orgs at once (in batches of 10)
      const batches: string[][] = []
      for (let i = 0; i < allEins.length; i += 10) {
        batches.push(allEins.slice(i, i + 10))
      }

      const memberDataMap = new Map<string, { fiscal_year: number; value: number }[]>()
      for (const batch of batches) {
        const trendParams = new URLSearchParams({
          eins: batch.join(','),
          metric: 'total_revenue',
          year_min: String(yearMin),
          year_max: String(yearMax),
        })
        const trendRes = await fetch(`/api/visualization/trend?${trendParams}`)
        if (trendRes.ok) {
          const trendData: { series: { ein: string; name: string; data: { fiscal_year: number; value: number }[] }[] } = await trendRes.json()
          for (const s of trendData.series) {
            memberDataMap.set(s.ein, s.data)
          }
        }
      }

      // Build raw member data with cohort labels
      const rawMembers: RawMemberData[] = []
      for (const cohort of data.cohorts) {
        for (const member of cohort.members) {
          const rawYears = memberDataMap.get(member.ein) ?? []
          const years = rawYears.map((y) => ({ fiscal_year: y.fiscal_year, revenue: y.value }))
          if (years.length > 0) {
            rawMembers.push({ ein: member.ein, label: cohort.label, years })
          }
        }
      }

      // Compute per-cohort average indexed revenue per year
      const allYears = Array.from(new Set(rawMembers.flatMap((m) => m.years.map((y) => y.fiscal_year)))).sort((a, b) => a - b)

      // For each cohort, compute avg indexed revenue per year
      const cohortIndexed: Record<string, number[]> = {}
      for (const label of GROWTH_COHORTS) {
        const membersForCohort = rawMembers.filter((m) => m.label === label)
        if (membersForCohort.length === 0) continue

        // For each member, find base (yearMin) revenue and compute index
        const memberIndexedByYear: number[][] = []
        for (const member of membersForCohort) {
          const baseEntry = member.years.find((y) => y.fiscal_year === yearMin)
          const base = baseEntry?.revenue
          if (!base || base === 0) continue
          const indexed = allYears.map((year) => {
            const entry = member.years.find((y) => y.fiscal_year === year)
            return entry ? (entry.revenue / base) * 100 : NaN
          })
          memberIndexedByYear.push(indexed)
        }

        if (memberIndexedByYear.length === 0) continue

        // Average across members for each year (ignore NaN)
        cohortIndexed[label] = allYears.map((_, yi) => {
          const vals = memberIndexedByYear.map((m) => m[yi]).filter((v) => !isNaN(v))
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
        })
      }

      // Build chart rows
      const rows = allYears.map((year, yi) => {
        const row: Record<string, number | string> = { fiscal_year: year }
        for (const [label, values] of Object.entries(cohortIndexed)) {
          if (!isNaN(values[yi])) row[label] = Math.round(values[yi] * 10) / 10
        }
        return row
      })

      setIndexedData(rows)
    } catch {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [yearMin, yearMax])

  useEffect(() => { fetchData() }, [fetchData])

  function exportCsv() {
    const cohort = cohorts.find((c) => c.label === selectedCohort)
    if (!cohort) return
    const rows = [
      ['Organization', 'EIN', 'CAGR', 'Start Revenue', 'End Revenue'],
      ...cohort.members.map((m) => [
        m.name,
        m.ein,
        formatPercent(m.cagr),
        String(Math.round(m.start_revenue)),
        String(Math.round(m.end_revenue)),
      ]),
    ]
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `growth-${selectedCohort?.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasData = cohorts.some((c) => c.members.length > 0)
  const selectedMembers = cohorts.find((c) => c.label === selectedCohort)?.members ?? []

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, color: '#7A9AA4', fontSize: 14 }}>
        Loading…
      </div>
    )
  }

  if (error || !hasData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, color: '#7A9AA4', fontSize: 14, textAlign: 'center', padding: 24 }}>
        {error ?? 'Insufficient data for selected period (requires ≥2 years per organization)'}
      </div>
    )
  }

  const activeCohortLabels = GROWTH_COHORTS.filter((label) =>
    cohorts.find((c) => c.label === label && c.members.length > 0)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={indexedData} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
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
              label={{ value: 'Index (100 = base year)', angle: -90, position: 'insideLeft', offset: 14, style: { fontSize: 10, fill: '#7A9AA4' } }}
              width={80}
            />
            <Tooltip
              formatter={(value) => [`${typeof value === 'number' ? value.toFixed(1) : value}`, 'Index']}
              contentStyle={{ fontSize: 12, border: '1px solid #BDD3DC', borderRadius: 6 }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              onClick={(e) => {
                const label = e.value as string
                setSelectedCohort(selectedCohort === label ? null : label)
              }}
            />
            {activeCohortLabels.map((label, idx) => (
              <Line
                key={label}
                type="monotone"
                dataKey={label}
                stroke={CHART_PALETTE[idx % CHART_PALETTE.length]}
                strokeWidth={selectedCohort === null || selectedCohort === label ? 2.5 : 1}
                opacity={selectedCohort === null || selectedCohort === label ? 1 : 0.3}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {selectedCohort && (
        <div style={{ borderTop: '1px solid #BDD3DC' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              backgroundColor: '#D7E8EE',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: '#10232B' }}>
              {selectedCohort} — {selectedMembers.length} organizations
            </span>
            <button
              onClick={exportCsv}
              style={{
                padding: '5px 12px',
                fontSize: 12,
                border: '1px solid #AECAE0',
                borderRadius: 5,
                backgroundColor: '#FFFFFF',
                color: '#3D5A63',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Export CSV
            </button>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ backgroundColor: '#F2F4F1', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '8px 16px', textAlign: 'left', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC' }}>Organization</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC' }}>CAGR</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC' }}>Start Revenue</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC' }}>End Revenue</th>
                </tr>
              </thead>
              <tbody>
                {selectedMembers
                  .slice()
                  .sort((a, b) => b.cagr - a.cagr)
                  .map((m) => (
                    <tr key={m.ein} style={{ borderBottom: '1px solid #F2F4F1' }}>
                      <td style={{ padding: '7px 16px', color: '#10232B' }}>{m.name}</td>
                      <td style={{ padding: '7px 16px', textAlign: 'right', color: '#3D5A63' }}>{formatPercent(m.cagr)}</td>
                      <td style={{ padding: '7px 16px', textAlign: 'right', color: '#3D5A63' }}>{formatCurrency(m.start_revenue, true)}</td>
                      <td style={{ padding: '7px 16px', textAlign: 'right', color: '#3D5A63' }}>{formatCurrency(m.end_revenue, true)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
