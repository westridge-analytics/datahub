import { type NextRequest } from 'next/server'
import { auth } from '@/auth'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as any)?.role !== 'admin') return null
  return session
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  if (!session) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json()
  const { name, password, role } = body

  // Prevent removing the last admin
  if (role === 'user') {
    const adminCount = await query<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin' AND id != ${parseInt(id, 10)}
    `
    if (parseInt(adminCount[0]?.count ?? '0', 10) === 0) {
      return Response.json({ error: 'Cannot remove the last admin' }, { status: 400 })
    }
  }

  const updates: string[] = []
  const values: unknown[] = []
  let n = 1

  if (name !== undefined) { updates.push(`name = $${n++}`); values.push(name) }
  if (role !== undefined) { updates.push(`role = $${n++}`); values.push(role) }
  if (password) {
    const hash = await bcrypt.hash(password, 12)
    updates.push(`password_hash = $${n++}`)
    values.push(hash)
  }

  if (updates.length === 0) return Response.json({ error: 'Nothing to update' }, { status: 400 })

  values.push(parseInt(id, 10))
  const { rawQuery } = await import('@/lib/db')
  const rows = await rawQuery(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${n} RETURNING id, email, name, role, created_at`,
    values
  )
  if (!rows.length) return Response.json({ error: 'User not found' }, { status: 404 })
  return Response.json(rows[0])
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  if (!session) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const currentUserId = (session.user as any)?.id

  if (String(currentUserId) === id) {
    return Response.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  // Prevent deleting the last admin
  const targetRows = await query<{ role: string }>`SELECT role FROM users WHERE id = ${parseInt(id, 10)}`
  if (!targetRows.length) return Response.json({ error: 'User not found' }, { status: 404 })

  if (targetRows[0].role === 'admin') {
    const adminCount = await query<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin' AND id != ${parseInt(id, 10)}
    `
    if (parseInt(adminCount[0]?.count ?? '0', 10) === 0) {
      return Response.json({ error: 'Cannot delete the last admin' }, { status: 400 })
    }
  }

  await query`DELETE FROM users WHERE id = ${parseInt(id, 10)}`
  return new Response(null, { status: 204 })
}
