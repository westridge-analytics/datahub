import { type NextRequest } from 'next/server'
import { sql } from '@/lib/db'
import type { Cohort } from '@/types'

export async function GET() {
  try {
    const rows = await sql`
      SELECT c.*, COUNT(cm.ein)::int AS member_count
      FROM cohorts c
      LEFT JOIN cohort_members cm ON cm.cohort_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at ASC
    `
    return Response.json(rows)
  } catch (err) {
    console.error('[GET /api/cohorts]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let body: { name?: string; color?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, color } = body
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  try {
    const rows = await sql`
      INSERT INTO cohorts (name, color)
      VALUES (${name.trim()}, ${color ?? null})
      RETURNING *
    `
    return Response.json(rows[0] as Cohort, { status: 201 })
  } catch (err) {
    console.error('[POST /api/cohorts]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
