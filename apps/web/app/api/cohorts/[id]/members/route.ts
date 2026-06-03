import { type NextRequest } from 'next/server'
import { sql } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params
  const cohortId = parseInt(idStr, 10)
  if (isNaN(cohortId)) {
    return Response.json({ error: 'Invalid cohort id' }, { status: 400 })
  }

  let body: { ein?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { ein } = body
  if (!ein || typeof ein !== 'string' || ein.trim() === '') {
    return Response.json({ error: 'ein is required' }, { status: 400 })
  }

  try {
    // Verify cohort exists
    const cohortRows = await sql`SELECT id FROM cohorts WHERE id = ${cohortId}`
    if ((cohortRows as unknown[]).length === 0) {
      return Response.json({ error: 'Cohort not found' }, { status: 404 })
    }

    // Verify org exists
    const orgRows = await sql`SELECT ein FROM organizations WHERE ein = ${ein.trim()}`
    if ((orgRows as unknown[]).length === 0) {
      return Response.json({ error: 'Organization not found' }, { status: 404 })
    }

    await sql`
      INSERT INTO cohort_members (cohort_id, ein)
      VALUES (${cohortId}, ${ein.trim()})
      ON CONFLICT DO NOTHING
    `

    return Response.json({ added: true }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/cohorts/[id]/members]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params
  const cohortId = parseInt(idStr, 10)
  if (isNaN(cohortId)) {
    return Response.json({ error: 'Invalid cohort id' }, { status: 400 })
  }

  let body: { ein?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { ein } = body
  if (!ein || typeof ein !== 'string' || ein.trim() === '') {
    return Response.json({ error: 'ein is required' }, { status: 400 })
  }

  try {
    const rows = await sql`
      DELETE FROM cohort_members
      WHERE cohort_id = ${cohortId} AND ein = ${ein.trim()}
      RETURNING ein
    `
    if ((rows as unknown[]).length === 0) {
      return Response.json({ error: 'Member not found in cohort' }, { status: 404 })
    }
    return Response.json({ removed: true })
  } catch (err) {
    console.error('[DELETE /api/cohorts/[id]/members]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
