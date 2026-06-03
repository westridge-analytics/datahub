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

  let body: { name?: string; color?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, color } = body
  if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
    return Response.json({ error: 'name must be a non-empty string' }, { status: 400 })
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
