import { type NextRequest } from 'next/server'
import { sql, rawQuery } from '@/lib/db'
import type { Cohort } from '@/types'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return Response.json({ error: 'Invalid cohort id' }, { status: 400 })
  }

  let body: { name?: string; short_name?: string | null; description?: string | null; color?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, short_name, description, color } = body
  if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
    return Response.json({ error: 'name must be a non-empty string' }, { status: 400 })
  }
  if (short_name && short_name.length > 6) {
    return Response.json({ error: 'short_name must be 6 characters or fewer' }, { status: 400 })
  }

  try {
    // Build dynamic SET clause
    const setClauses: string[] = []
    const setParams: unknown[] = []

    function p(v: unknown) {
      setParams.push(v)
      return `$${setParams.length}`
    }

    if (name !== undefined) setClauses.push(`name = ${p(name.trim())}`)
    if (short_name !== undefined) setClauses.push(`short_name = ${p(short_name?.trim() ?? null)}`)
    if (description !== undefined) setClauses.push(`description = ${p(description?.trim() ?? null)}`)
    if (color !== undefined) setClauses.push(`color = ${p(color)}`)

    if (setClauses.length === 0) {
      return Response.json({ error: 'Nothing to update' }, { status: 400 })
    }

    setParams.push(id)
    const queryText = `
      UPDATE cohorts
      SET ${setClauses.join(', ')}
      WHERE id = $${setParams.length}
      RETURNING *
    `
    const rows = await rawQuery(queryText, setParams)

    if ((rows as unknown[]).length === 0) {
      return Response.json({ error: 'Cohort not found' }, { status: 404 })
    }

    return Response.json((rows as unknown[])[0] as Cohort)
  } catch (err) {
    console.error('[PUT /api/cohorts/[id]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return Response.json({ error: 'Invalid cohort id' }, { status: 400 })
  }

  try {
    const rows = await sql`DELETE FROM cohorts WHERE id = ${id} RETURNING id`
    if ((rows as unknown[]).length === 0) {
      return Response.json({ error: 'Cohort not found' }, { status: 404 })
    }
    return Response.json({ deleted: true })
  } catch (err) {
    console.error('[DELETE /api/cohorts/[id]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
