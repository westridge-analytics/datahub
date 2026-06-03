'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import PageHeader from '@/components/layout/PageHeader'

const MultiTrendChart = dynamic(() => import('@/components/visualization/MultiTrendChart'), { ssr: false })
const VolatilityChart = dynamic(() => import('@/components/visualization/VolatilityChart'), { ssr: false })
const GrowthChart = dynamic(() => import('@/components/visualization/GrowthChart'), { ssr: false })

type Tab = 'trend' | 'volatility' | 'growth'

const TABS: { id: Tab; label: string }[] = [
  { id: 'trend', label: 'Multi-Institution Trend' },
  { id: 'volatility', label: 'Revenue Volatility' },
  { id: 'growth', label: 'Revenue Growth' },
]

const YEAR_OPTIONS = Array.from({ length: 14 }, (_, i) => 2010 + i)

export default function VisualizationPage() {
  const [activeTab, setActiveTab] = useState<Tab>('trend')
  const [yearMin, setYearMin] = useState(2015)
  const [yearMax, setYearMax] = useState(2023)

  const periodControls = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: '#3D5A63', whiteSpace: 'nowrap' }}>Start year</span>
        <select
          value={yearMin}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            setYearMin(v)
            if (v > yearMax) setYearMax(v)
          }}
          style={{
            padding: '4px 8px',
            fontSize: 12,
            border: '1px solid #BDD3DC',
            borderRadius: 4,
            backgroundColor: '#FFFFFF',
            color: '#10232B',
            cursor: 'pointer',
          }}
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: '#3D5A63', whiteSpace: 'nowrap' }}>End year</span>
        <select
          value={yearMax}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            setYearMax(v)
            if (v < yearMin) setYearMin(v)
          }}
          style={{
            padding: '4px 8px',
            fontSize: 12,
            border: '1px solid #BDD3DC',
            borderRadius: 4,
            backgroundColor: '#FFFFFF',
            color: '#10232B',
            cursor: 'pointer',
          }}
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <PageHeader
        title="Visualization"
        subtitle="Multi-org trend charts and cohort comparisons"
        actions={periodControls}
      />

      {/* Tab bar */}
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #BDD3DC',
          display: 'flex',
          gap: 0,
          paddingLeft: 20,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? '#10232B' : '#7A9AA4',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #6F99CC' : '2px solid transparent',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              transition: 'color 0.1s',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, backgroundColor: '#FFFFFF', overflow: 'auto' }}>
        {activeTab === 'trend' && <MultiTrendChart yearMin={yearMin} yearMax={yearMax} />}
        {activeTab === 'volatility' && <VolatilityChart yearMin={yearMin} yearMax={yearMax} />}
        {activeTab === 'growth' && <GrowthChart yearMin={yearMin} yearMax={yearMax} />}
      </div>
    </div>
  )
}
