import { type NextRequest } from 'next/server'
import { sql, rawQuery } from '@/lib/db'

const ALLOWED_METRICS = new Set([
  'total_revenue',
  'total_expenses',
  'total_assets',
  'total_net_assets',
  'contributions',
  'program_revenue',
  'investment_income',
  'net_income',
])

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const einsParam = sp.get('eins') ?? ''
  const metric = sp.get('metric') ?? 'total_revenue'
  const yearMinRaw = sp.get('year_min')
  const yearMaxRaw = sp.get('year_max')
  const yearMin = yearMinRaw ? parseInt(yearMinRaw, 10) : null
  const yearMax = yearMaxRaw ? parseInt(yearMaxRaw, 10) : null

  if (!einsParam) {
    return Response.json({ error: 'eins parameter is required' }, { status: 400 })
  }

  if (!ALLOWED_METRICS.has(metric)) {
    return Response.json({ error: `Invalid metric: ${metric}` }, { status: 400 })
  }

  const eins = einsParam.split(',').map((e) => e.trim()).filter(Boolean).slice(0, 10)
  if (eins.length === 0) {
    return Response.json({ error: 'At least one EIN is required' }, { status: 400 })
  }

  try {
    // Allowlisted metric expression
    const metricExpr = metric === 'net_income'
      ? '(f.total_revenue - f.total_expenses)'
      : `f.${metric}`

    const params: unknown[] = [eins]
    const yearClauses: string[] = []
    if (yearMin !== null) {
      params.push(yearMin)
      yearClauses.push(`f.fiscal_year >= $${params.length}`)
    }
    if (yearMax !== null) {
      params.push(yearMax)
      yearClauses.push(`f.fiscal_year <= $${params.length}`)
    }

    const yearWhere = yearClauses.length > 0 ? `AND ${yearClauses.join(' AND ')}` : ''

    const queryText = `
      SELECT
        f.ein,
        o.name,
        f.fiscal_year,
        ${metricExpr} AS value
      FROM filings f
      JOIN organizations o ON o.ein = f.ein
      WHERE f.ein = ANY($1)
      ${yearWhere}
      ORDER BY f.ein, f.fiscal_year ASC
    `

    const rows = await rawQuery(queryText, params)

    // Group into series
    const seriesMap = new Map<string, { ein: string; name: string; data: { fiscal_year: number; value: number }[] }>()

    for (const row of rows as Array<{ ein: string; name: string; fiscal_year: number; value: number | null }>) {
      if (!seriesMap.has(row.ein)) {
        seriesMap.set(row.ein, { ein: row.ein, name: row.name, data: [] })
      }
      seriesMap.get(row.ein)!.data.push({
        fiscal_year: Number(row.fiscal_year),
        value: row.value ?? 0,
      })
    }

    return Response.json({ series: Array.from(seriesMap.values()) })
  } catch (err) {
    console.error('[GET /api/visualization/trend]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
