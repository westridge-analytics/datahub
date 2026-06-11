import { type NextRequest } from 'next/server'
import { sql, rawQuery } from '@/lib/db'
import type { FilingWithOrg } from '@/types'
import { SECTOR_TO_NTEE_LETTERS } from '@/lib/ntee'

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

  // Categorical multi-value filters (comma-separated)
  const stateVals      = sp.get('state')?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  const nteeCatVals    = sp.get('ntee_category')?.split(',').filter(Boolean) ?? []
  const formTypeVals   = sp.get('form_type')?.split(',').filter(Boolean) ?? []
  const filingMethodVals = sp.get('filing_method')?.split(',').filter(Boolean) ?? []

  // Boolean governance filters
  const BOOL_COLS = ['has_lobbying','has_political_activity','has_unrelated_business_income',
    'has_foreign_office','has_foreign_grants','operates_hospital','operates_school','has_related_orgs'] as const

  // Numeric range filter — allowlisted filing columns only
  const NUMERIC_COLS_API = new Set([
    'total_revenue','total_expenses','total_assets','total_liabilities','total_net_assets',
    'contributions','program_revenue','investment_income','other_revenue',
    'royalties_income','net_rental_income','net_asset_sale_gains','net_fundraising_income','net_gaming_income',
    'program_expenses','ga_expenses','fundraising_expenses',
    'comp_officers','comp_other_salaries','comp_total_reported','comp_related_orgs',
    'pension_contributions','employee_benefits','payroll_taxes',
    'management_fees','legal_fees','accounting_fees','professional_fundraising_fees',
    'occupancy','travel','it_expenses','depreciation','insurance',
    'grants_to_govts','grants_to_individuals','grants_to_foreign',
    'unrestr_net_assets','restr_net_assets','temp_restricted_net_assets','perm_restricted_net_assets',
    'pledges_receivable','accounts_payable','tax_exempt_bonds_liability',
    'cash_equiv','st_investments','lt_investments',
    'investments_publicly_traded','investments_other','investments_program_related','ppe',
    'num_employees','num_highly_compensated','num_contractors_100k',
  ])

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

    // ── Filter clauses ──────────────────────────────────────────────────────────
    let hasOrgFilters = false

    // Categorical — org-level
    if (stateVals.length > 0) {
      clauses.push(`o.state = ANY(${p(stateVals)})`); hasOrgFilters = true
    }
    if (nteeCatVals.length > 0) {
      if (nteeCatVals.includes('Other')) {
        const knownLetters = Object.values(SECTOR_TO_NTEE_LETTERS).flat().filter(l => l !== 'Z')
        const otherLetters = nteeCatVals.filter(c => c !== 'Other').flatMap(c => SECTOR_TO_NTEE_LETTERS[c] ?? [])
        if (otherLetters.length > 0) {
          clauses.push(`(LEFT(o.ntee_code, 1) = ANY(${p(otherLetters)}) OR o.ntee_code IS NULL OR o.ntee_code = '' OR LEFT(o.ntee_code, 1) = 'Z')`)
        } else {
          clauses.push(`(o.ntee_code IS NULL OR o.ntee_code = '' OR LEFT(o.ntee_code, 1) = 'Z')`)
        }
      } else {
        const letters = nteeCatVals.flatMap(c => SECTOR_TO_NTEE_LETTERS[c] ?? [])
        if (letters.length > 0) clauses.push(`LEFT(o.ntee_code, 1) = ANY(${p(letters)})`)
      }
      hasOrgFilters = true
    }

    // Categorical — filing-level
    if (formTypeVals.length > 0)    clauses.push(`f.form_type = ANY(${p(formTypeVals)})`)
    if (filingMethodVals.length > 0) clauses.push(`f.filing_method = ANY(${p(filingMethodVals)})`)

    // Year range
    if (yearMin !== null) clauses.push(`f.fiscal_year >= ${p(yearMin)}`)
    if (yearMax !== null) clauses.push(`f.fiscal_year <= ${p(yearMax)}`)

    // Boolean governance filters
    for (const col of BOOL_COLS) {
      const val = sp.get(col)
      if (val === 'true' || val === 'false') clauses.push(`f.${col} = ${p(val === 'true')}`)
    }

    // Numeric range filters (allowlisted columns only)
    for (const col of NUMERIC_COLS_API) {
      const minRaw = sp.get(`${col}_min`), maxRaw = sp.get(`${col}_max`)
      const min = minRaw !== null ? Number(minRaw) : NaN
      const max = maxRaw !== null ? Number(maxRaw) : NaN
      if (!isNaN(min) && minRaw !== null) clauses.push(`f.${col} >= ${p(min)}`)
      if (!isNaN(max) && maxRaw !== null) clauses.push(`f.${col} <= ${p(max)}`)
    }
    // net_income is computed
    const niMinRaw = sp.get('net_income_min'), niMaxRaw = sp.get('net_income_max')
    if (niMinRaw !== null && !isNaN(Number(niMinRaw))) clauses.push(`(f.total_revenue - f.total_expenses) >= ${p(Number(niMinRaw))}`)
    if (niMaxRaw !== null && !isNaN(Number(niMaxRaw))) clauses.push(`(f.total_revenue - f.total_expenses) <= ${p(Number(niMaxRaw))}`)

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
      // Build a separate params array so search + count queries both use $1,$2
      // (passing a shared array with extra elements causes a Postgres bind error)
      searchParams = [trimmed, `%${trimmed}%`]
      const extraClauses = clauses.filter(c => !c.includes('o.name') && !c.includes('f.ein'))
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
      // Same $1,$2,$3 as the main query — searchParams array is passed to both
      const extraClauses2 = clauses.filter(c => !c.includes('o.name') && !c.includes('f.ein'))
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
