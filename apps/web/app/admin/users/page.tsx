'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'

interface User {
  id: number
  email: string
  name: string | null
  role: string
  created_at: string
}

export default function UsersPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const currentUserId = (session?.user as any)?.id

  const [users, setUsers]         = useState<User[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  // Add user form
  const [addOpen, setAddOpen]     = useState(false)
  const [addEmail, setAddEmail]   = useState('')
  const [addName, setAddName]     = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addRole, setAddRole]     = useState('user')
  const [addError, setAddError]   = useState('')
  const [addLoading, setAddLoading] = useState(false)

  // Change password
  const [pwUserId, setPwUserId]   = useState<number | null>(null)
  const [pwValue, setPwValue]     = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError]     = useState('')

  async function handleSignOut() {
    await signOut({ redirect: false })
    router.push('/login')
    router.refresh()
  }

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    if (res.status === 403) { router.push('/'); return }
    const data = await res.json()
    setUsers(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    setAddLoading(true)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: addEmail, name: addName || undefined, password: addPassword, role: addRole }),
    })
    setAddLoading(false)
    if (!res.ok) {
      const j = await res.json()
      setAddError(j.error ?? 'Failed to create user')
      return
    }
    setAddOpen(false)
    setAddEmail(''); setAddName(''); setAddPassword(''); setAddRole('user')
    load()
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this user?')) return
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json()
      setError(j.error ?? 'Delete failed')
      return
    }
    setError('')
    load()
  }

  async function handleChangeRole(id: number, role: string) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) {
      const j = await res.json()
      setError(j.error ?? 'Update failed')
      return
    }
    setError('')
    load()
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault()
    if (!pwUserId || !pwValue) return
    setPwError('')
    setPwLoading(true)
    const res = await fetch(`/api/admin/users/${pwUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwValue }),
    })
    setPwLoading(false)
    if (!res.ok) {
      const j = await res.json()
      setPwError(j.error ?? 'Failed')
      return
    }
    setPwUserId(null)
    setPwValue('')
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '760px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px', gap: '12px' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#10232B' }}>
          User Management
        </h1>
        <div style={{ flex: 1 }} />
        <button onClick={handleSignOut} style={btnSecondary}>
          Sign out
        </button>
        <button onClick={() => { setAddOpen(true); setAddError(''); setAddEmail(''); setAddName(''); setAddPassword(''); setAddRole('user') }} style={btnPrimary}>
          + Add User
        </button>
      </div>

      {error && (
        <div style={{ color: '#B83228', backgroundColor: '#FDF2F1', border: '1px solid #F0C4C0',
          borderRadius: '4px', padding: '8px 12px', marginBottom: '16px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Users table */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #BDD3DC', borderRadius: '6px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#203E46', color: '#FFFFFF' }}>
              <th style={th}>Email</th>
              <th style={th}>Name</th>
              <th style={th}>Role</th>
              <th style={th}>Added</th>
              <th style={{ ...th, width: '140px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#7A9AA4' }}>Loading…</td></tr>
            )}
            {!loading && users.map((u, i) => (
              <tr key={u.id} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F8FAFB', borderBottom: '1px solid #E8EFF2' }}>
                <td style={td}>
                  {u.email}
                  {String(u.id) === String(currentUserId) && (
                    <span style={{ marginLeft: '6px', fontSize: '10px', color: '#6F99CC', fontWeight: 600 }}>you</span>
                  )}
                </td>
                <td style={td}>{u.name ?? <span style={{ color: '#7A9AA4' }}>—</span>}</td>
                <td style={td}>
                  <select
                    value={u.role}
                    onChange={(e) => handleChangeRole(u.id, e.target.value)}
                    style={{ fontSize: '12px', padding: '2px 6px', border: '1px solid #BDD3DC',
                      borderRadius: '3px', backgroundColor: '#F2F4F1', color: '#10232B' }}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td style={{ ...td, color: '#7A9AA4', fontSize: '12px' }}>
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { setPwUserId(u.id); setPwValue(''); setPwError('') }}
                      style={btnSmall}
                    >
                      Change pw
                    </button>
                    <button
                      onClick={() => handleDelete(u.id)}
                      style={{ ...btnSmall, color: '#B83228', borderColor: '#F0C4C0' }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add user modal */}
      {addOpen && (
        <Modal title="Add User" onClose={() => setAddOpen(false)}>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Field label="Email">
              <input type="email" required value={addEmail} onChange={(e) => setAddEmail(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Name (optional)">
              <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Password">
              <input type="password" required value={addPassword} onChange={(e) => setAddPassword(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Role">
              <select value={addRole} onChange={(e) => setAddRole(e.target.value)} style={inputStyle}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </Field>
            {addError && <div style={{ color: '#B83228', fontSize: '13px' }}>{addError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button type="button" onClick={() => setAddOpen(false)} style={btnSecondary}>Cancel</button>
              <button type="submit" disabled={addLoading} style={btnPrimary}>
                {addLoading ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Change password modal */}
      {pwUserId !== null && (
        <Modal title={`Change Password — ${users.find(u => u.id === pwUserId)?.email ?? ''}`} onClose={() => setPwUserId(null)}>
          <form onSubmit={handleChangePw} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Field label="New Password">
              <input type="password" required value={pwValue} onChange={(e) => setPwValue(e.target.value)} autoFocus style={inputStyle} />
            </Field>
            {pwError && <div style={{ color: '#B83228', fontSize: '13px' }}>{pwError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button type="button" onClick={() => setPwUserId(null)} style={btnSecondary}>Cancel</button>
              <button type="submit" disabled={pwLoading} style={btnPrimary}>
                {pwLoading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', padding: '24px', width: '380px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: '#10232B' }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', fontWeight: 600, color: '#7A9AA4', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 600, fontSize: '11px', textAlign: 'left' }
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' }
const inputStyle: React.CSSProperties = { fontSize: '13px', padding: '7px 9px', border: '1px solid #BDD3DC',
  borderRadius: '4px', color: '#10232B', backgroundColor: '#F2F4F1', outline: 'none', width: '100%', boxSizing: 'border-box' }
const btnPrimary: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#203E46',
  border: '1px solid #203E46', borderRadius: '5px', padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }
const btnSecondary: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#3D5A63', backgroundColor: '#FFFFFF',
  border: '1px solid #BDD3DC', borderRadius: '5px', padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }
const btnSmall: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#3D5A63', backgroundColor: 'transparent',
  border: '1px solid #BDD3DC', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer' }
