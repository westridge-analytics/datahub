import { type NextRequest } from 'next/server'
import { sql, rawQuery } from '@/lib/db'
import type { FilingWithOrg } from '@/types'
import { ALLOWED_SORT_COLUMNS, parseFilingFilters } from '@/lib/filing-filters'

// Derives a readable sector label from ntee_code in SQL.
// 'Other' catches null, empty, and unknown codes.
const nteeExpr = (alias: string) => `
  CASE LEFT(${alias}.ntee_code, 1)
    WHEN 'A' THEN 'Arts, Culture & Humanities'
    WHEN 'B' THEN 'Education'
    WHEN 'C' THEN 'Environment & Animals'
    WHEN 'D' THEN 'Environment & Animals'
    WHEN 'E' THEN 'Health'
    WHEN 'F' THEN 'Health'
    WHEN 'G' THEN 'Health'
    WHEN 'H' THEN 'Health'
    WHEN 'I' THEN 'Human Services'
    WHEN 'J' THEN 'Human Services'
    WHEN 'K' THEN 'Human Services'
    WHEN 'L' THEN 'Human Services'
    WHEN 'M' THEN 'Human Services'
    WHEN 'N' THEN 'Human Services'
    WHEN 'O' THEN 'Human Services'
    WHEN 'P' THEN 'Human Services'
    WHEN 'Q' THEN 'International & Foreign Affairs'
    WHEN 'R' THEN 'Public & Societal Benefit'
    WHEN 'S' THEN 'Public & Societal Benefit'
    WHEN 'T' THEN 'Public & Societal Benefit'
    WHEN 'U' THEN 'Public & Societal Benefit'
    WHEN 'V' THEN 'Public & Societal Benefit'
    WHEN 'W' THEN 'Public & Societal Benefit'
    WHEN 'X' THEN 'Religion'
    WHEN 'Y' THEN 'Mutual & Membership Benefit'
    ELSE 'Other'
  END AS ntee_category,
  ${alias}.ntee_code`

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const search = sp.get('search') ?? ''

  const { clauses, params, hasOrgFilters, cohortId } = parseFilingFilters(sp)

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

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

    // cohortId already validated as integer — safe to inline
    // Returns all cohort names for an EIN as a comma-separated string, or NULL if none.
    // Each entry is "short|full" so the renderer can show short_name with a full-name tooltip.
    // short = COALESCE(short_name, LEFT(name,6))
    const cohortNamesExpr = (einExpr: string) => cohortId !== null
      ? `(SELECT COALESCE(short_name, LEFT(name,6)) || '|' || name FROM cohorts WHERE id = ${cohortId}) AS cohort_names`
      : `(SELECT string_agg(COALESCE(c.short_name, LEFT(c.name,6)) || '|' || c.name, ',' ORDER BY c.name)
           FROM cohort_members cm2
           JOIN cohorts c ON c.id = cm2.cohort_id
           WHERE cm2.ein = ${einExpr}) AS cohort_names`

    // cohortJoin only needed for the filter path (Path C) when cohortId is set
    const cohortJoin = cohortId !== null
      ? `JOIN cohort_members cm ON cm.ein = f.ein AND cm.cohort_id = ${cohortId}`
      : ''

    const offset = (page - 1) * pageSize
    const hasFilters = !!search || clauses.length > 0 || cohortId !== null

    // ── Query path selection ──────────────────────────────────────────────────
    //
    // Path A (search): resolve matching EINs from organizations first using
    //   FTS + trigram indexes, then join filings against that small set.
    //   Avoids pushing name conditions into a 6M-row filings scan.
    //
    // Path B (no search, no org filters): sort filings by index first in a
    //   materialized CTE, then join orgs. Avoids full hash join.
    //
    // Path C (org filters like state/sector): standard join with WHERE.

    let queryText: string
    let searchParams: unknown[] = []  // separate param array for search path (reused by count)

    if (search) {
      const trimmed = search.trim()
      // $1 = search term, $2 = %ein-pattern%. Filter clauses were built against `params`
      // ($1, $2, …) so we shift their indices by +2 and append params to searchParams
      // so all filter values are actually passed to the query.
      const extraClauses = clauses
        .filter(c => !c.includes('o.name') && !c.includes('f.ein'))
        .map(c => c.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n, 10) + 2}`))
      searchParams = [trimmed, `%${trimmed}%`, ...params]
      const extraWhere = extraClauses.length > 0 ? `AND ${extraClauses.join(' AND ')}` : ''

      const matchedEinsCTE = `
        WITH matched_eins AS MATERIALIZED (
          SELECT ein FROM organizations
          WHERE name_vec @@ websearch_to_tsquery('english', $1)
          UNION
          SELECT ein FROM filings WHERE ein ILIKE $2
        )`

      queryText = `
        ${matchedEinsCTE}
        SELECT
          f.*,
          o.name,
          o.state,
          o.sector,
          ${nteeExpr('o')},
          (f.total_revenue - f.total_expenses) AS net_income,
          ${cohortNamesExpr('f.ein')}
        FROM filings f
        JOIN matched_eins m ON m.ein = f.ein
        JOIN organizations o ON o.ein = f.ein
        ${cohortJoin}
        WHERE TRUE ${extraWhere}
        ORDER BY ${orderExpr} ${sortDir} NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `
    } else if (!hasOrgFilters && sortBy !== 'name' && cohortId === null) {
      // Path B: sort-then-join via materialized CTE (fast index scan)
      const filingsClauses = clauses.filter(c => !c.includes('o.'))
      queryText = `
        WITH ranked AS MATERIALIZED (
          SELECT * FROM filings f
          WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.ein = f.ein)
          ${filingsClauses.length > 0 ? `AND ${filingsClauses.join(' AND ')}` : ''}
          ORDER BY ${orderExprCTE} ${sortDir} NULLS LAST
          LIMIT ${pageSize} OFFSET ${offset}
        )
        SELECT
          r.*,
          o.name,
          o.state,
          o.sector,
          ${nteeExpr('o')},
          (r.total_revenue - r.total_expenses) AS net_income,
          ${cohortNamesExpr('r.ein')}
        FROM ranked r
        JOIN organizations o ON o.ein = r.ein
      `
    } else {
      // Path C: standard join
      queryText = `
        SELECT
          f.*,
          o.name,
          o.state,
          o.sector,
          ${nteeExpr('o')},
          (f.total_revenue - f.total_expenses) AS net_income,
          ${cohortNamesExpr('f.ein')}
        FROM filings f
        JOIN organizations o ON o.ein = f.ein
        ${cohortJoin}
        ${whereClause}
        ORDER BY ${orderExpr} ${sortDir} NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `
    }

    // Use fast stats estimate when no filters; for search use matched_eins CTE; else exact count.
    let countText: string
    if (!hasFilters) {
      countText = `SELECT reltuples::bigint AS total FROM pg_class WHERE relname = 'filings'`
    } else if (search) {
      // searchParams is already [term, %term%, ...params] — shift filter clause indices by +2
      const extraClauses2 = clauses
        .filter(c => !c.includes('o.name') && !c.includes('f.ein'))
        .map(c => c.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n, 10) + 2}`))
      const extraWhere2 = extraClauses2.length > 0 ? `AND ${extraClauses2.join(' AND ')}` : ''
      countText = `
        WITH matched_eins AS MATERIALIZED (
          SELECT ein FROM organizations
          WHERE name_vec @@ websearch_to_tsquery('english', $1)
          UNION
          SELECT ein FROM filings WHERE ein ILIKE $2
        )
        SELECT COUNT(*) AS total
        FROM filings f
        JOIN matched_eins m ON m.ein = f.ein
        JOIN organizations o ON o.ein = f.ein
        WHERE TRUE ${extraWhere2}
      `
    } else {
      countText = `SELECT COUNT(*) AS total
         FROM filings f
         JOIN organizations o ON o.ein = f.ein
         ${cohortId !== null ? `JOIN cohort_members cm ON cm.ein = f.ein AND cm.cohort_id = ${cohortId}` : ''}
         ${whereClause}`
    }

    // searchParams is isolated: count query uses same $1,$2,$3 as main query.
    // Other paths share the same params array throughout.
    const queryParams = search ? searchParams : params
    const [rows, countRows] = await Promise.all([
      rawQuery(queryText, queryParams),
      rawQuery(countText, hasFilters ? queryParams : []),
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
