'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts'
import { formatCurrency } from '@/lib/format'

const CHART_PALETTE = ['#203E46', '#6F99CC', '#A78B70', '#4A8A6A', '#8A5A8A']

interface VolatilityMember {
  ein: string
  name: string
  cv: number
  avg_revenue: number
}

interface VolatilityCohortData {
  label: string
  cv_min: number
  cv_max: number | null
  members: VolatilityMember[]
}

interface Props {
  yearMin: number
  yearMax: number
}

interface BarCountLabelProps {
  data: { count: number }[]
  x?: number
  y?: number
  width?: number
  index?: number
}

function BarCountLabel({ data, x = 0, y = 0, width = 0, index = 0 }: BarCountLabelProps) {
  const count = data[index]?.count ?? 0
  return (
    <text x={x + width / 2} y={y - 4} textAnchor="middle" fontSize={11} fill="#7A9AA4">
      {`n=${count}`}
    </text>
  )
}

export default function VolatilityChart({ yearMin, yearMax }: Props) {
  const [cohorts, setCohorts] = useState<VolatilityCohortData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelectedCohort(null)
    try {
      const params = new URLSearchParams({
        type: 'volatility',
        year_min: String(yearMin),
        year_max: String(yearMax),
      })
      const res = await fetch(`/api/visualization/cohorts?${params}`)
      if (!res.ok) {
        setError('Failed to load data')
        return
      }
      const data: { cohorts: VolatilityCohortData[] } = await res.json()
      setCohorts(data.cohorts)
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
      ['Organization', 'EIN', 'CV', 'Avg Revenue'],
      ...cohort.members.map((m) => [m.name, m.ein, m.cv.toFixed(4), String(Math.round(m.avg_revenue))]),
    ]
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `volatility-${selectedCohort?.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const chartData = cohorts.map((c, i) => ({
    label: c.label,
    avgCv: c.members.length > 0 ? c.members.reduce((sum, m) => sum + m.cv, 0) / c.members.length : 0,
    count: c.members.length,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }))

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
        {error ?? 'Insufficient data for selected period (requires ≥3 years per organization)'}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E4EEF8" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: '#3D5A63' }}
              tickLine={false}
              axisLine={{ stroke: '#BDD3DC' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#7A9AA4' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              label={{ value: 'Avg CV', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11, fill: '#7A9AA4' } }}
            />
            <Tooltip
              formatter={(value) => [`${typeof value === 'number' ? (value * 100).toFixed(1) : value}%`, 'Avg CV']}
              contentStyle={{ fontSize: 12, border: '1px solid #BDD3DC', borderRadius: 6 }}
            />
            <Bar
              dataKey="avgCv"
              cursor="pointer"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(data: any) => {
                const lbl = data.label as string
                setSelectedCohort(lbl === selectedCohort ? null : lbl)
              }}
              radius={[3, 3, 0, 0]}
              label={<BarCountLabel data={chartData} />}
            >
              {chartData.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={entry.color}
                  opacity={selectedCohort === null || selectedCohort === entry.label ? 1 : 0.35}
                  stroke={selectedCohort === entry.label ? '#10232B' : 'none'}
                  strokeWidth={selectedCohort === entry.label ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {selectedCohort && (
        <div style={{ marginTop: 0, borderTop: '1px solid #BDD3DC' }}>
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
                  <th style={{ padding: '8px 16px', textAlign: 'right', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC' }}>CV</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC' }}>Avg Revenue</th>
                </tr>
              </thead>
              <tbody>
                {selectedMembers
                  .slice()
                  .sort((a, b) => a.cv - b.cv)
                  .map((m) => (
                    <tr key={m.ein} style={{ borderBottom: '1px solid #F2F4F1' }}>
                      <td style={{ padding: '7px 16px', color: '#10232B' }}>{m.name}</td>
                      <td style={{ padding: '7px 16px', textAlign: 'right', color: '#3D5A63' }}>{(m.cv * 100).toFixed(1)}%</td>
                      <td style={{ padding: '7px 16px', textAlign: 'right', color: '#3D5A63' }}>{formatCurrency(m.avg_revenue, true)}</td>
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
