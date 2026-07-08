import { type NextRequest } from 'next/server'
import { rawQuery } from '@/lib/db'
import * as XLSX from 'xlsx'
import { ALLOWED_SORT_COLUMNS, parseFilingFilters } from '@/lib/filing-filters'

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

// Accepts the exact same query-string contract as GET /api/filings (plus
// `format`), so "export" always means "export what's on screen right now."
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const format = sp.get('format')
  if (format !== 'xlsx' && format !== 'csv') {
    return Response.json({ error: 'format must be "xlsx" or "csv"' }, { status: 400 })
  }

  const search = sp.get('search') ?? ''
  const sortBy = sp.get('sort_by') ?? 'total_revenue'
  const sortDir = sp.get('sort_dir') === 'asc' ? 'ASC' : 'DESC'

  if (!ALLOWED_SORT_COLUMNS.has(sortBy)) {
    return Response.json({ error: `Invalid sort_by column: ${sortBy}` }, { status: 400 })
  }

  const { clauses, params, cohortId } = parseFilingFilters(sp)
  if (sp.get('cohort_id') && cohortId !== null && isNaN(cohortId)) {
    return Response.json({ error: 'cohort_id must be an integer' }, { status: 400 })
  }

  // Institution page exports a single org's full filing history by EIN.
  const ein = sp.get('ein')
  if (ein) {
    params.push(ein)
    clauses.push(`f.ein = $${params.length}`)
  }

  try {
    const orderExpr =
      sortBy === 'net_income'
        ? '(f.total_revenue - f.total_expenses)'
        : sortBy === 'name'
        ? 'o.name'
        : `f.${sortBy}`

    let whereExtra = ''
    let fromClause = 'FROM filings f\n      JOIN organizations o ON o.ein = f.ein'
    let queryParams = params

    if (search) {
      const trimmed = search.trim()
      // Search params must occupy $1/$2 (matched_eins CTE); shift filter clauses
      // built above (which reference $1..$N against `params`) up by 2.
      const shiftedClauses = clauses.map(c => c.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n, 10) + 2}`))
      queryParams = [trimmed, `%${trimmed}%`, ...params]
      fromClause = `FROM filings f
      JOIN (
        SELECT ein FROM organizations WHERE name_vec @@ websearch_to_tsquery('english', $1)
        UNION
        SELECT ein FROM filings WHERE ein ILIKE $2
      ) m ON m.ein = f.ein
      JOIN organizations o ON o.ein = f.ein`
      whereExtra = shiftedClauses.length > 0 ? `AND ${shiftedClauses.join(' AND ')}` : ''
    } else {
      whereExtra = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : ''
    }

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
      ${fromClause}
      ${cohortJoin}
      WHERE TRUE ${whereExtra}
      ORDER BY ${orderExpr} ${sortDir} NULLS LAST
      LIMIT 50000
    `

    const rows = (await rawQuery(queryText, queryParams)) as ExportRow[]
    const einSlug = ein?.replace(/[^0-9-]/g, '')
    const filenameBase = einSlug ? `990-export-${einSlug}` : '990-export'

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
          'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
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
          'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
        },
      })
    }
  } catch (err) {
    console.error('[GET /api/export]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
