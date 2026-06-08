import { type NextRequest } from 'next/server'
import { sql, rawQuery } from '@/lib/db'
import type { FilingWithOrg } from '@/types'

const ALLOWED_SORT_COLUMNS = new Set([
  'total_revenue',
  'total_expenses',
  'net_income',
  'total_assets',
  'total_net_assets',
  'fiscal_year',
  'name',
])

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const search = sp.get('search') ?? ''
  const state = sp.get('state') ?? ''
  const sector = sp.get('sector') ?? ''
  const cohortIdRaw = sp.get('cohort_id')
  const cohortId = cohortIdRaw ? parseInt(cohortIdRaw, 10) : null
  const yearMinRaw = sp.get('year_min')
  const yearMin = yearMinRaw ? parseInt(yearMinRaw, 10) : null
  const yearMaxRaw = sp.get('year_max')
  const yearMax = yearMaxRaw ? parseInt(yearMaxRaw, 10) : null
  const sortBy = sp.get('sort_by') ?? 'total_revenue'
  const sortDir = sp.get('sort_dir') === 'asc' ? 'ASC' : 'DESC'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get('page_size') ?? '100', 10)))

  if (!ALLOWED_SORT_COLUMNS.has(sortBy)) {
    return Response.json({ error: `Invalid sort_by column: ${sortBy}` }, { status: 400 })
  }
  if (cohortId !== null && isNaN(cohortId)) {
    return Response.json({ error: 'cohort_id must be an integer' }, { status: 400 })
  }

  try {
    // Allowlisted ORDER BY expression (sortBy validated above)
    // orderExpr: for queries with f/o aliases; orderExprCTE: for inside the CTE (no alias)
    const orderExpr =
      sortBy === 'net_income'
        ? '(f.total_revenue - f.total_expenses)'
        : sortBy === 'name'
        ? 'o.name'
        : `f.${sortBy}`
    const orderExprCTE =
      sortBy === 'net_income'
        ? '(total_revenue - total_expenses)'
        : `${sortBy}`

    // Collect parameterized filter values
    const params: unknown[] = []
    const clauses: string[] = []

    function p(value: unknown): string {
      params.push(value)
      return `$${params.length}`
    }

    if (search) {
      const ph = p(`%${search}%`)
      clauses.push(`(o.name ILIKE ${ph} OR f.ein ILIKE ${ph})`)
    }
    if (state) clauses.push(`o.state = ${p(state)}`)
    if (sector) clauses.push(`o.sector = ${p(sector)}`)
    if (yearMin !== null) clauses.push(`f.fiscal_year >= ${p(yearMin)}`)
    if (yearMax !== null) clauses.push(`f.fiscal_year <= ${p(yearMax)}`)

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

    // cohortId already validated as integer — safe to inline
    const cohortJoin = cohortId !== null
      ? `JOIN cohort_members cm ON cm.ein = f.ein AND cm.cohort_id = ${cohortId}`
      : `LEFT JOIN cohort_members cm ON cm.ein = f.ein
         LEFT JOIN cohorts coh ON coh.id = cm.cohort_id`

    const cohortSelect = cohortId !== null
      ? `(SELECT name FROM cohorts WHERE id = ${cohortId}) AS cohort_name`
      : `coh.name AS cohort_name`

    const offset = (page - 1) * pageSize
    const hasFilters = clauses.length > 0 || cohortId !== null

    // When filters only touch filings columns (no search/state/sector that need the org
    // join before filtering), sort filings first in a materialized CTE then join orgs.
    // This lets Postgres use the (sort_col, ein) index instead of a full hash join.
    const orgFilterOnly = !search && !state && !sector && sortBy !== 'name' && cohortId === null
    const filingsClauses = clauses.filter(c => !c.includes('o.'))
    const filingsWhere = filingsClauses.length > 0 ? `WHERE ${filingsClauses.join(' AND ')}` : ''

    const queryText = orgFilterOnly
      ? `
        WITH ranked AS MATERIALIZED (
          SELECT * FROM filings
          ${filingsWhere}
          ORDER BY ${orderExprCTE} ${sortDir} NULLS LAST
          LIMIT ${pageSize} OFFSET ${offset}
        )
        SELECT
          r.*,
          o.name,
          o.state,
          o.sector,
          (r.total_revenue - r.total_expenses) AS net_income,
          ${cohortId !== null
            ? `(SELECT name FROM cohorts WHERE id = ${cohortId})`
            : `(SELECT c.name FROM cohort_members cm2 JOIN cohorts c ON c.id = cm2.cohort_id WHERE cm2.ein = r.ein LIMIT 1)`
          } AS cohort_name
        FROM ranked r
        JOIN organizations o ON o.ein = r.ein
      `
      : `
        SELECT
          f.*,
          o.name,
          o.state,
          o.sector,
          (f.total_revenue - f.total_expenses) AS net_income,
          ${cohortSelect}
        FROM filings f
        JOIN organizations o ON o.ein = f.ein
        ${cohortJoin}
        ${whereClause}
        ORDER BY ${orderExpr} ${sortDir} NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `

    // Use fast stats estimate when no filters are applied; exact count otherwise.
    const countText = hasFilters
      ? `SELECT COUNT(*) AS total
         FROM filings f
         JOIN organizations o ON o.ein = f.ein
         ${cohortId !== null ? `JOIN cohort_members cm ON cm.ein = f.ein AND cm.cohort_id = ${cohortId}` : ''}
         ${whereClause}`
      : `SELECT reltuples::bigint AS total
         FROM pg_class WHERE relname = 'filings'`

    const [rows, countRows] = await Promise.all([
      rawQuery(queryText, params),
      rawQuery(countText, hasFilters ? params : []),
    ])

    const total = parseInt((countRows[0] as { total: string }).total, 10)

    return Response.json({
      data: rows as unknown as FilingWithOrg[],
      total,
      page,
      page_size: pageSize,
    })
  } catch (err) {
    console.error('[GET /api/filings]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
