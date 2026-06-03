import { type NextRequest } from 'next/server'
import { sql, rawQuery } from '@/lib/db'
import { calcVolatility, getVolatilityCohort, VOLATILITY_COHORTS } from '@/lib/metrics/volatility'
import { calcCAGR, getGrowthCohort, GROWTH_COHORTS } from '@/lib/metrics/growth'
import type { VolatilityCohort, GrowthCohort } from '@/types'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const type = sp.get('type')
  const yearMinRaw = sp.get('year_min')
  const yearMaxRaw = sp.get('year_max')
  const yearMin = yearMinRaw ? parseInt(yearMinRaw, 10) : null
  const yearMax = yearMaxRaw ? parseInt(yearMaxRaw, 10) : null

  if (type !== 'volatility' && type !== 'growth') {
    return Response.json({ error: 'type must be "volatility" or "growth"' }, { status: 400 })
  }

  try {
    const params: unknown[] = []
    const yearClauses: string[] = []
    if (yearMin !== null) {
      params.push(yearMin)
      yearClauses.push(`f.fiscal_year >= $${params.length}`)
    }
    if (yearMax !== null) {
      params.push(yearMax)
      yearClauses.push(`f.fiscal_year <= $${params.length}`)
    }
    const yearWhere = yearClauses.length > 0 ? `WHERE ${yearClauses.join(' AND ')}` : ''

    const queryText = `
      SELECT
        f.ein,
        o.name,
        f.fiscal_year,
        f.total_revenue
      FROM filings f
      JOIN organizations o ON o.ein = f.ein
      ${yearWhere}
      ORDER BY f.ein, f.fiscal_year ASC
    `

    const rows = await rawQuery(queryText, params)

    // Group by EIN
    const orgMap = new Map<string, { name: string; entries: { fiscal_year: number; revenue: number }[] }>()
    for (const row of rows as Array<{ ein: string; name: string; fiscal_year: number; total_revenue: number | null }>) {
      if (!orgMap.has(row.ein)) {
        orgMap.set(row.ein, { name: row.name, entries: [] })
      }
      orgMap.get(row.ein)!.entries.push({
        fiscal_year: Number(row.fiscal_year),
        revenue: row.total_revenue ?? 0,
      })
    }

    if (type === 'volatility') {
      // cohort label -> members
      const cohortMap = new Map<VolatilityCohort, {
        ein: string; name: string; cv: number; avg_revenue: number
      }[]>()
      for (const label of VOLATILITY_COHORTS) cohortMap.set(label, [])

      for (const [ein, { name, entries }] of orgMap.entries()) {
        if (entries.length < 3) continue
        const revenues = entries.map((e) => e.revenue)
        const cv = calcVolatility(revenues)
        if (cv === null) continue
        const avgRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length
        const label = getVolatilityCohort(cv)
        cohortMap.get(label)!.push({ ein, name, cv, avg_revenue: avgRevenue })
      }

      // Build CV range per cohort (approximate from members or use sentinel values)
      const cvBounds: Record<VolatilityCohort, { min: number; max: number }> = {
        'Very Stable': { min: 0,    max: 0.05 },
        'Stable':      { min: 0.05, max: 0.10 },
        'Moderate':    { min: 0.10, max: 0.20 },
        'Volatile':    { min: 0.20, max: 0.35 },
        'Very Volatile': { min: 0.35, max: Infinity },
      }

      const cohorts = VOLATILITY_COHORTS.map((label) => ({
        label,
        cv_min: cvBounds[label].min,
        cv_max: cvBounds[label].max === Infinity ? null : cvBounds[label].max,
        members: cohortMap.get(label) ?? [],
      }))

      return Response.json({ cohorts })
    } else {
      // growth
      const cohortMap = new Map<GrowthCohort, {
        ein: string; name: string; cagr: number; start_revenue: number; end_revenue: number
      }[]>()
      for (const label of GROWTH_COHORTS) cohortMap.set(label, [])

      for (const [ein, { name, entries }] of orgMap.entries()) {
        if (entries.length < 2) continue
        const first = entries[0]
        const last = entries[entries.length - 1]
        const years = last.fiscal_year - first.fiscal_year
        if (years <= 0) continue
        const cagr = calcCAGR(first.revenue, last.revenue, years)
        if (cagr === null) continue
        const label = getGrowthCohort(cagr)
        cohortMap.get(label)!.push({
          ein,
          name,
          cagr,
          start_revenue: first.revenue,
          end_revenue: last.revenue,
        })
      }

      const cagrBounds: Record<GrowthCohort, { min: number; max: number }> = {
        'Shrinking':       { min: -Infinity, max: -0.02 },
        'Flat':            { min: -0.02, max: 0.02 },
        'Slow Growth':     { min: 0.02, max: 0.05 },
        'Moderate Growth': { min: 0.05, max: 0.10 },
        'High Growth':     { min: 0.10, max: Infinity },
      }

      const cohorts = GROWTH_COHORTS.map((label) => ({
        label,
        cagr_min: cagrBounds[label].min === -Infinity ? null : cagrBounds[label].min,
        cagr_max: cagrBounds[label].max === Infinity ? null : cagrBounds[label].max,
        members: cohortMap.get(label) ?? [],
      }))

      return Response.json({ cohorts })
    }
  } catch (err) {
    console.error('[GET /api/visualization/cohorts]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
