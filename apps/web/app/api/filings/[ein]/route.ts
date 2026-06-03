import { type NextRequest } from 'next/server'
import { sql } from '@/lib/db'
import type { Organization, Filing } from '@/types'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ein: string }> }
) {
  const { ein } = await params

  if (!ein) {
    return Response.json({ error: 'EIN is required' }, { status: 400 })
  }

  try {
    const [orgRows, filingRows] = await Promise.all([
      sql`SELECT * FROM organizations WHERE ein = ${ein}`,
      sql`SELECT * FROM filings WHERE ein = ${ein} ORDER BY fiscal_year ASC`,
    ])

    if (orgRows.length === 0) {
      return Response.json({ error: 'Organization not found' }, { status: 404 })
    }

    return Response.json({
      organization: orgRows[0] as Organization,
      filings: filingRows as Filing[],
    })
  } catch (err) {
    console.error('[GET /api/filings/[ein]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
