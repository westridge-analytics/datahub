import { type NextRequest } from 'next/server'
import { sql, rawQuery } from '@/lib/db'
import * as XLSX from 'xlsx'

const ALLOWED_SORT_COLUMNS = new Set([
  'total_revenue',
  'total_expenses',
  'net_income',
  'total_assets',
  'total_net_assets',
  'fiscal_year',
  'name',
])

interface ExportFilters {
  search?: string
  state?: string
  sector?: string
  cohort_id?: number
  year_min?: number
  year_max?: number
  sort_by?: string
  sort_dir?: string
}

interface ExportRow {
  ein: string
  name: string
  state: string
  sector: string | null
  cohort_name: string | null
  fiscal_year: number
  total_revenue: number | null
  total_expenses: number | null
  net_income: number | null
  total_assets: number | null
  total_net_assets: number | null
}

export async function POST(request: NextRequest) {
  let body: { format?: string; filters?: ExportFilters }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const format = body.format
  if (format !== 'xlsx' && format !== 'csv') {
    return Response.json({ error: 'format must be "xlsx" or "csv"' }, { status: 400 })
  }

  const filters: ExportFilters = body.filters ?? {}
  const sortBy = filters.sort_by ?? 'total_revenue'
  const sortDir = filters.sort_dir === 'asc' ? 'ASC' : 'DESC'

  if (!ALLOWED_SORT_COLUMNS.has(sortBy)) {
    return Response.json({ error: `Invalid sort_by column: ${sortBy}` }, { status: 400 })
  }

  const cohortId = filters.cohort_id != null ? Number(filters.cohort_id) : null
  if (cohortId !== null && isNaN(cohortId)) {
    return Response.json({ error: 'cohort_id must be an integer' }, { status: 400 })
  }

  try {
    const orderExpr =
      sortBy === 'net_income'
        ? '(f.total_revenue - f.total_expenses)'
        : sortBy === 'name'
        ? 'o.name'
        : `f.${sortBy}`

    const params: unknown[] = []
    const clauses: string[] = []

    function p(v: unknown): string {
      params.push(v)
      return `$${params.length}`
    }

    if (filters.search) {
      const ph = p(`%${filters.search}%`)
      clauses.push(`(o.name ILIKE ${ph} OR f.ein ILIKE ${ph})`)
    }
    if (filters.state) clauses.push(`o.state = ${p(filters.state)}`)
    if (filters.sector) clauses.push(`o.sector = ${p(filters.sector)}`)
    if (filters.year_min != null) clauses.push(`f.fiscal_year >= ${p(filters.year_min)}`)
    if (filters.year_max != null) clauses.push(`f.fiscal_year <= ${p(filters.year_max)}`)

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

    const cohortJoin = cohortId !== null
      ? `JOIN cohort_members cm ON cm.ein = f.ein AND cm.cohort_id = ${cohortId}`
      : ''
    const cohortSelect = cohortId !== null
      ? `(SELECT name FROM cohorts WHERE id = ${cohortId}) AS cohort_name`
      : `(SELECT c.name FROM cohort_members cm2 JOIN cohorts c ON c.id = cm2.cohort_id WHERE cm2.ein = f.ein LIMIT 1) AS cohort_name`

    const queryText = `
      SELECT
        f.ein,
        o.name,
        o.state,
        o.sector,
        ${cohortSelect},
        f.fiscal_year,
        f.total_revenue,
        f.total_expenses,
        (f.total_revenue - f.total_expenses) AS net_income,
        f.total_assets,
        f.total_net_assets
      FROM filings f
      JOIN organizations o ON o.ein = f.ein
      ${cohortJoin}
      ${whereClause}
      ORDER BY ${orderExpr} ${sortDir} NULLS LAST
      LIMIT 50000
    `

    const rows = (await rawQuery(queryText, params)) as ExportRow[]

    if (format === 'csv') {
      const header = [
        'EIN', 'Organization', 'State', 'Sector', 'Cohort',
        'Year', 'Revenue', 'Expenses', 'Net Income', 'Total Assets', 'Net Assets',
      ]

      function csvCell(v: unknown): string {
        if (v == null) return ''
        const str = String(v)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      const lines: string[] = [header.map(csvCell).join(',')]
      for (const row of rows) {
        lines.push([
          row.ein,
          row.name,
          row.state,
          row.sector ?? '',
          row.cohort_name ?? '',
          row.fiscal_year,
          row.total_revenue ?? '',
          row.total_expenses ?? '',
          row.net_income ?? '',
          row.total_assets ?? '',
          row.total_net_assets ?? '',
        ].map(csvCell).join(','))
      }

      const csv = lines.join('\r\n')
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="990-export.csv"',
        },
      })
    } else {
      // XLSX
      const wsData = [
        [
          'EIN', 'Organization', 'State', 'Sector', 'Cohort',
          'Year', 'Revenue', 'Expenses', 'Net Income', 'Total Assets', 'Net Assets',
        ],
        ...rows.map((row) => [
          row.ein,
          row.name,
          row.state,
          row.sector ?? '',
          row.cohort_name ?? '',
          row.fiscal_year,
          row.total_revenue ?? '',
          row.total_expenses ?? '',
          row.net_income ?? '',
          row.total_assets ?? '',
          row.total_net_assets ?? '',
        ]),
      ]

      const ws = XLSX.utils.aoa_to_sheet(wsData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '990 Filings')

      const xlsxData = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as number[]
      const buffer = new Uint8Array(xlsxData).buffer

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="990-export.xlsx"',
        },
      })
    }
  } catch (err) {
    console.error('[POST /api/export]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
