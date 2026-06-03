'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Organization } from '@/types'
import { formatEIN } from '@/lib/format'

const C = {
  canvas: '#F2F4F1',
  surface: '#FFFFFF',
  textPrimary: '#10232B',
  textSecondary: '#3D5A63',
  textTertiary: '#7A9AA4',
  accent: '#6F99CC',
  accentLight: '#E4EEF8',
  accentBorder: '#AECAE0',
  border: '#BDD3DC',
}

export default function InstitutionIndexPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Organization[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/organizations?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(Array.isArray(data) ? data : [])
          setOpen(true)
        }
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  function select(org: Organization) {
    setOpen(false)
    setQuery('')
    router.push(`/institution/${org.ein}`)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        backgroundColor: C.canvas,
      }}
    >
      <div
        style={{
          backgroundColor: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          padding: '40px 48px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 2px 12px rgba(16,35,43,0.08)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: C.textPrimary }}>
            Institution Analysis
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: C.textSecondary }}>
            Search for an organization to view deep-dive financial analysis across fiscal years.
          </p>
        </div>

        <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
          <input
            value={query}
            onChange={handleInput}
            placeholder="Search by name or EIN…"
            autoFocus
            style={{
              width: '100%',
              padding: '10px 14px',
              border: `1px solid ${C.accentBorder}`,
              borderRadius: '8px',
              fontSize: '14px',
              backgroundColor: C.surface,
              color: C.textPrimary,
              outline: 'none',
              boxSizing: 'border-box',
              boxShadow: '0 1px 4px rgba(16,35,43,0.06)',
            }}
          />
          {loading && (
            <div
              style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: C.textTertiary,
                fontSize: '12px',
              }}
            >
              Searching…
            </div>
          )}

          {open && results.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: '4px',
                backgroundColor: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                boxShadow: '0 6px 20px rgba(16,35,43,0.12)',
                zIndex: 100,
                maxHeight: '300px',
                overflowY: 'auto',
              }}
            >
              {results.map((org) => (
                <button
                  key={org.ein}
                  onClick={() => select(org)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 14px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${C.canvas}`,
                    gap: '2px',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.accentLight }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 500, color: C.textPrimary }}>
                    {org.name}
                  </span>
                  <span style={{ fontSize: '11px', color: C.textTertiary }}>
                    {formatEIN(org.ein)} · {org.state}
                    {org.sector ? ` · ${org.sector}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          {open && results.length === 0 && !loading && query.length >= 2 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: '4px',
                backgroundColor: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                padding: '16px',
                textAlign: 'center',
                fontSize: '13px',
                color: C.textTertiary,
                boxShadow: '0 6px 20px rgba(16,35,43,0.12)',
                zIndex: 100,
              }}
            >
              No organizations found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        <p style={{ margin: 0, fontSize: '12px', color: C.textTertiary, textAlign: 'center' }}>
          Type at least 2 characters to search. Results limited to 20 matches.
        </p>
      </div>
    </div>
  )
}
