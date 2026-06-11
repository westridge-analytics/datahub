import { type NextRequest } from 'next/server'
import { auth } from '@/auth'
import { query, sql } from '@/lib/db'
import bcrypt from 'bcryptjs'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as any)?.role !== 'admin') return null
  return session
}

export async function GET() {
  if (!await requireAdmin()) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const users = await query`
    SELECT id, email, name, role, created_at
    FROM users
    ORDER BY created_at ASC
  `
  return Response.json(users)
}

export async function POST(request: NextRequest) {
  if (!await requireAdmin()) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { email, name, password, role = 'user' } = body

  if (!email || !password) {
    return Response.json({ error: 'email and password are required' }, { status: 400 })
  }
  if (!['user', 'admin'].includes(role)) {
    return Response.json({ error: 'role must be user or admin' }, { status: 400 })
  }

  const hash = await bcrypt.hash(password, 12)
  try {
    const rows = await query`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${email}, ${name ?? null}, ${hash}, ${role})
      RETURNING id, email, name, role, created_at
    `
    return Response.json(rows[0], { status: 201 })
  } catch (err: any) {
    if (err?.message?.includes('unique')) {
      return Response.json({ error: 'A user with that email already exists' }, { status: 409 })
    }
    throw err
  }
}
