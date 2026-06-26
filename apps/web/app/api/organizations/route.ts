import { type NextRequest } from 'next/server'
import { rawQuery } from '@/lib/db'
import type { Organization } from '@/types'

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()

  if (q.length < 2) {
    return Response.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
  }

  try {
    // Mirror the search approach from /api/filings:
    // FTS on name_vec (handles apostrophes, word order, stop words) unioned with EIN match.
    // Fall back to ILIKE when websearch_to_tsquery produces no results (e.g. very short tokens).
    const rows = await rawQuery<Organization>(`
      WITH fts AS (
        SELECT ein FROM organizations
        WHERE name_vec @@ websearch_to_tsquery('english', $1)
        UNION
        SELECT ein FROM organizations WHERE ein ILIKE $2
      )
      SELECT o.*
      FROM organizations o
      JOIN fts ON fts.ein = o.ein
      ORDER BY o.name ASC
      LIMIT 20
    `, [q, `%${q}%`])

    // If FTS returned nothing (e.g. single stop-word token), fall back to plain ILIKE
    if (rows.length === 0) {
      const fallback = await rawQuery<Organization>(
        `SELECT * FROM organizations WHERE name ILIKE $1 OR ein ILIKE $2 ORDER BY name ASC LIMIT 20`,
        [`%${q}%`, `%${q}%`]
      )
      return Response.json(fallback)
    }

    return Response.json(rows)
  } catch (err) {
    console.error('[GET /api/organizations]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
