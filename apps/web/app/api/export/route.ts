import { type NextRequest } from 'next/server'
import { rawQuery } from '@/lib/db'
import * as XLSX from 'xlsx'
import { ALLOWED_SORT_COLUMNS, parseFilingFilters } from '@/lib/filing-filters'
import { buildSelectList, exportCell, resolveExportColumns } from '@/lib/export-columns'

// Accepts the exact same query-string contract as GET /api/filings (plus
// `format` and `cols`), so "export" always means "export what's on screen
// right now" — the same rows AND the same columns. `cols` is the Main Data
// table's visible-column list; without it the export falls back to the
// original eleven columns, which is what the Institution page's link sends.
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

  // Column keys are matched against the table's catalogue, never interpolated
  // from the request — cohortId is the only value inlined, and it is an integer
  // by the check above.
  const columns = resolveExportColumns(sp.get('cols'), cohortId)

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

    const queryText = `
      SELECT
        ${buildSelectList(columns)}
      ${fromClause}
      ${cohortJoin}
      WHERE TRUE ${whereExtra}
      ORDER BY ${orderExpr} ${sortDir} NULLS LAST
      LIMIT 50000
    `

    const rows = await rawQuery<Record<string, unknown>>(queryText, queryParams)
    const einSlug = ein?.replace(/[^0-9-]/g, '')
    const filenameBase = einSlug ? `990-export-${einSlug}` : '990-export'

    const header = columns.map(c => c.label)
    const body = rows.map(row => columns.map(col => exportCell(col, row)))

    if (format === 'csv') {
      function csvCell(v: unknown): string {
        if (v == null) return ''
        const str = String(v)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      const lines: string[] = [header.map(csvCell).join(',')]
      for (const row of body) lines.push(row.map(csvCell).join(','))

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
      const ws = XLSX.utils.aoa_to_sheet([header, ...body])
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
