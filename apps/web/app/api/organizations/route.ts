import { type NextRequest } from 'next/server'
import { sql } from '@/lib/db'
import type { Organization } from '@/types'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''

  if (q.length < 2) {
    return Response.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
  }

  try {
    // Return orgs matching name (ilike) or exact EIN
    const rows = await sql`
      SELECT *
      FROM organizations
      WHERE name ILIKE ${'%' + q + '%'} OR ein = ${q}
      ORDER BY name ASC
      LIMIT 20
    `

    return Response.json(rows as Organization[])
  } catch (err) {
    console.error('[GET /api/organizations]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
