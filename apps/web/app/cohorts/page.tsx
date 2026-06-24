'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import type { Cohort, CohortMember, Organization } from '@/types'

const PRESET_COLORS = ['#203E46', '#6F99CC', '#A78B70', '#4A8A6A', '#8A5A8A']

interface CohortWithCount extends Cohort {
  member_count: number
}

interface CohortMemberWithOrg extends CohortMember {
  state?: string
}

function CohortsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialCohortIdParam = searchParams.get('cohort')
  const initialCohortId = useRef<number | null>(initialCohortIdParam ? parseInt(initialCohortIdParam, 10) : null)

  const [cohorts, setCohorts] = useState<CohortWithCount[]>([])
  const [selectedCohort, setSelectedCohort] = useState<CohortWithCount | null>(null)
  const [members, setMembers] = useState<CohortMemberWithOrg[]>([])
  const [loadingCohorts, setLoadingCohorts] = useState(true)
  const [loadingMembers, setLoadingMembers] = useState(false)

  // New cohort form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[1])
  const [savingNew, setSavingNew] = useState(false)

  // Edit cohort name inline
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  // Add member search
  const [memberSearch, setMemberSearch] = useState('')
  const [memberResults, setMemberResults] = useState<Organization[]>([])
  const [showMemberDropdown, setShowMemberDropdown] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const memberSearchRef = useRef<HTMLDivElement>(null)
  const memberSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState('')

  // Short name + description editing
  const [editingShortName, setEditingShortName] = useState(false)
  const [shortNameValue, setShortNameValue] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionValue, setDescriptionValue] = useState('')

  // Load cohorts — auto-select from URL param after load
  useEffect(() => {
    async function load() {
      setLoadingCohorts(true)
      try {
        const res = await fetch('/api/cohorts')
        if (res.ok) {
          const data: CohortWithCount[] = await res.json()
          setCohorts(data)
          if (initialCohortId.current !== null) {
            const match = data.find((c) => c.id === initialCohortId.current)
            if (match) {
              setSelectedCohort(match)
              loadMembers(match.id)
            }
          }
        }
      } finally {
        setLoadingCohorts(false)
      }
    }
    load()
  }, [])

  // Load members when cohort selected
  const loadMembers = useCallback(async (cohortId: number) => {
    setLoadingMembers(true)
    setMembers([])
    try {
      // Fetch all filings for cohort members via the orgs endpoint filtered by cohort
      // Use a dedicated endpoint: GET /api/cohorts/[id]/members — but it doesn't exist,
      // so we fetch org list from the cohort's member list via filings with cohort filter
      // The cohorts route doesn't expose members list directly. We'll derive from the
      // visualization cohorts or query filings with cohort filter.
      // Actually, looking at the schema the cohort_members table has cohort_id and ein.
      // The GET /api/cohorts doesn't return members. We need to call a members endpoint.
      // The members route only has POST and DELETE. We'll build a custom approach:
      // fetch filings?cohort_id=X which should return filing rows with member info.
      // But we don't know that endpoint. Let's try /api/filings?cohort_id=...
      const res = await fetch(`/api/filings?cohort_id=${cohortId}&page_size=500&sort_by=name&sort_dir=asc`)
      if (res.ok) {
        const data: { data: Array<{ ein: string; name: string; state: string }> } = await res.json()
        // filings returns FilingWithOrg[] — deduplicate by EIN
        const seen = new Set<string>()
        const uniqueMembers: CohortMemberWithOrg[] = []
        for (const row of data.data ?? []) {
          if (!seen.has(row.ein)) {
            seen.add(row.ein)
            uniqueMembers.push({
              cohort_id: cohortId,
              ein: row.ein,
              name: row.name ?? row.ein,
              state: row.state ?? '',
            })
          }
        }
        setMembers(uniqueMembers)
      }
    } finally {
      setLoadingMembers(false)
    }
  }, [])

  function selectCohort(cohort: CohortWithCount) {
    setSelectedCohort(cohort)
    setEditingTitle(false)
    setMemberSearch('')
    setShowMemberDropdown(false)
    loadMembers(cohort.id)
    router.replace(`?cohort=${cohort.id}`, { scroll: false })
  }

  // Member search typeahead
  useEffect(() => {
    if (memberSearch.length < 2) {
      setMemberResults([])
      setShowMemberDropdown(false)
      return
    }
    if (memberSearchTimeout.current) clearTimeout(memberSearchTimeout.current)
    memberSearchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/organizations?q=${encodeURIComponent(memberSearch)}`)
        if (res.ok) {
          const data: Organization[] = await res.json()
          const memberEins = new Set(members.map((m) => m.ein))
          setMemberResults(data.filter((o) => !memberEins.has(o.ein)))
          setShowMemberDropdown(true)
        }
      } catch {
        // ignore
      }
    }, 300)
    return () => { if (memberSearchTimeout.current) clearTimeout(memberSearchTimeout.current) }
  }, [memberSearch, members])

  // Close member dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (memberSearchRef.current && !memberSearchRef.current.contains(e.target as Node)) {
        setShowMemberDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function createCohort() {
    if (!newName.trim()) return
    setSavingNew(true)
    try {
      const res = await fetch('/api/cohorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      })
      if (res.ok) {
        const created: Cohort = await res.json()
        const withCount: CohortWithCount = { ...created, member_count: 0 }
        setCohorts((prev) => [...prev, withCount])
        setNewName('')
        setNewColor(PRESET_COLORS[1])
        setShowNewForm(false)
      }
    } finally {
      setSavingNew(false)
    }
  }

  async function updateCohortMeta(id: number, patch: { short_name?: string | null; description?: string | null }) {
    const res = await fetch(`/api/cohorts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) {
      const updated: Cohort = await res.json()
      setCohorts((prev) => prev.map((c) => c.id === id ? { ...c, ...updated } : c))
      if (selectedCohort?.id === id) setSelectedCohort((prev) => prev ? { ...prev, ...updated } : prev)
    }
  }

  async function renameCohort(id: number, name: string) {
    if (!name.trim()) return
    const res = await fetch(`/api/cohorts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    if (res.ok) {
      const updated: Cohort = await res.json()
      setCohorts((prev) => prev.map((c) => c.id === id ? { ...c, ...updated } : c))
      if (selectedCohort?.id === id) {
        setSelectedCohort((prev) => prev ? { ...prev, ...updated } : prev)
      }
    }
    setEditingId(null)
    setEditingTitle(false)
  }

  async function deleteCohort(id: number) {
    const cohort = cohorts.find((c) => c.id === id)
    if (!cohort) return
    if (!confirm(`Delete cohort "${cohort.name}"? This cannot be undone.`)) return
    const res = await fetch(`/api/cohorts/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setCohorts((prev) => prev.filter((c) => c.id !== id))
      if (selectedCohort?.id === id) {
        setSelectedCohort(null)
        setMembers([])
      }
    }
  }

  async function addMember(org: Organization) {
    if (!selectedCohort) return
    setAddingMember(true)
    try {
      const res = await fetch(`/api/cohorts/${selectedCohort.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ein: org.ein }),
      })
      if (res.ok) {
        setMembers((prev) => [...prev, {
          cohort_id: selectedCohort.id,
          ein: org.ein,
          name: org.name,
          state: org.state,
        }])
        setCohorts((prev) => prev.map((c) =>
          c.id === selectedCohort.id ? { ...c, member_count: c.member_count + 1 } : c
        ))
        setSelectedCohort((prev) => prev ? { ...prev, member_count: prev.member_count + 1 } : prev)
        setMemberSearch('')
        setShowMemberDropdown(false)
      }
    } finally {
      setAddingMember(false)
    }
  }

  async function removeMember(ein: string) {
    if (!selectedCohort) return
    const res = await fetch(`/api/cohorts/${selectedCohort.id}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ein }),
    })
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => m.ein !== ein))
      setCohorts((prev) => prev.map((c) =>
        c.id === selectedCohort.id ? { ...c, member_count: Math.max(0, c.member_count - 1) } : c
      ))
      setSelectedCohort((prev) => prev ? { ...prev, member_count: Math.max(0, prev.member_count - 1) } : prev)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <PageHeader
        title="Cohorts"
        subtitle="Build and manage peer groups for benchmarking"
      />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left panel — cohort list */}
        <div
          style={{
            width: 300,
            minWidth: 300,
            borderRight: '1px solid #BDD3DC',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#FFFFFF',
          }}
        >
          {/* Header + new button */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #BDD3DC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: '#3D5A63', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Cohorts
            </span>
            <button
              onClick={() => { setShowNewForm(true); setNewName(''); setNewColor(PRESET_COLORS[1]) }}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                border: '1px solid #AECAE0',
                borderRadius: 4,
                backgroundColor: '#E4EEF8',
                color: '#10232B',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              + New Cohort
            </button>
          </div>

          {/* New cohort form */}
          {showNewForm && (
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid #BDD3DC',
                backgroundColor: '#F2F4F1',
              }}
            >
              <input
                type="text"
                placeholder="Cohort name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') createCohort(); if (e.key === 'Escape') setShowNewForm(false) }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  fontSize: 13,
                  border: '1px solid #BDD3DC',
                  borderRadius: 4,
                  marginBottom: 8,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      backgroundColor: c,
                      border: newColor === c ? '2px solid #10232B' : '2px solid transparent',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                    title={c}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={createCohort}
                  disabled={savingNew || !newName.trim()}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    fontSize: 12,
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: 4,
                    backgroundColor: '#6F99CC',
                    color: '#FFFFFF',
                    cursor: savingNew || !newName.trim() ? 'default' : 'pointer',
                    opacity: savingNew || !newName.trim() ? 0.6 : 1,
                  }}
                >
                  {savingNew ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setShowNewForm(false)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    fontSize: 12,
                    border: '1px solid #BDD3DC',
                    borderRadius: 4,
                    backgroundColor: '#FFFFFF',
                    color: '#3D5A63',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Cohort list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingCohorts ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#7A9AA4', fontSize: 13 }}>Loading…</div>
            ) : cohorts.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#7A9AA4', fontSize: 13 }}>
                No cohorts yet. Create one to get started.
              </div>
            ) : (
              cohorts.map((cohort) => {
                const isSelected = selectedCohort?.id === cohort.id
                const isEditing = editingId === cohort.id
                return (
                  <div
                    key={cohort.id}
                    onClick={() => !isEditing && selectCohort(cohort)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 14px',
                      cursor: isEditing ? 'default' : 'pointer',
                      backgroundColor: isSelected ? '#E4EEF8' : 'transparent',
                      borderLeft: isSelected ? '3px solid #6F99CC' : '3px solid transparent',
                      borderBottom: '1px solid #F2F4F1',
                      transition: 'background-color 0.1s',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#F2F4F1' }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        backgroundColor: cohort.color ?? '#6F99CC',
                        flexShrink: 0,
                      }}
                    />
                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameCohort(cohort.id, editName)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => renameCohort(cohort.id, editName)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          flex: 1,
                          padding: '2px 6px',
                          fontSize: 13,
                          border: '1px solid #6F99CC',
                          borderRadius: 3,
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <span style={{ flex: 1, fontSize: 13, color: '#10232B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cohort.name}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#7A9AA4', flexShrink: 0 }}>{cohort.member_count}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(cohort.id)
                        setEditName(cohort.name)
                      }}
                      title="Rename"
                      style={{
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: '#7A9AA4',
                        padding: '2px 4px',
                        borderRadius: 3,
                        flexShrink: 0,
                        fontSize: 13,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M9 2l2 2-7 7H2v-2L9 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCohort(cohort.id) }}
                      title="Delete"
                      style={{
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: '#7A9AA4',
                        padding: '2px 4px',
                        borderRadius: 3,
                        flexShrink: 0,
                        fontSize: 13,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M2 3h9M5 3V2h3v1M4 3v7a1 1 0 001 1h3a1 1 0 001-1V3" />
                      </svg>
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right panel — cohort detail */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#F2F4F1', overflow: 'auto' }}>
          {!selectedCohort ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A9AA4', fontSize: 14 }}>
              Select a cohort to view its members
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Cohort header */}
              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  borderBottom: '1px solid #BDD3DC',
                  padding: '14px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    backgroundColor: selectedCohort.color ?? '#6F99CC',
                    flexShrink: 0,
                  }}
                />
                {editingTitle ? (
                  <input
                    type="text"
                    value={editTitleValue}
                    autoFocus
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { renameCohort(selectedCohort.id, editTitleValue); setEditingTitle(false) }
                      if (e.key === 'Escape') setEditingTitle(false)
                    }}
                    onBlur={() => { renameCohort(selectedCohort.id, editTitleValue); setEditingTitle(false) }}
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      border: '1px solid #6F99CC',
                      borderRadius: 4,
                      padding: '3px 8px',
                      outline: 'none',
                      color: '#10232B',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#10232B',
                      cursor: 'pointer',
                    }}
                    onClick={() => { setEditingTitle(true); setEditTitleValue(selectedCohort.name) }}
                    title="Click to rename"
                  >
                    {selectedCohort.name}
                  </span>
                )}
                <span style={{ fontSize: 12, color: '#7A9AA4', marginLeft: 4 }}>
                  {selectedCohort.member_count} {selectedCohort.member_count === 1 ? 'organization' : 'organizations'}
                </span>
              </div>

              {/* Short name + description */}
              <div style={{ backgroundColor: '#FAFCFD', borderBottom: '1px solid #BDD3DC', padding: '10px 24px', display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                {/* Short name */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7A9AA4', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Short name <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(max 6 chars, shown in table)</span>
                  </div>
                  {editingShortName ? (
                    <input
                      autoFocus
                      maxLength={6}
                      value={shortNameValue}
                      onChange={e => setShortNameValue(e.target.value.slice(0, 6))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { updateCohortMeta(selectedCohort.id, { short_name: shortNameValue.trim() || null }); setEditingShortName(false) }
                        if (e.key === 'Escape') setEditingShortName(false)
                      }}
                      onBlur={() => { updateCohortMeta(selectedCohort.id, { short_name: shortNameValue.trim() || null }); setEditingShortName(false) }}
                      style={{ fontSize: 13, fontFamily: 'monospace', border: '1px solid #6F99CC', borderRadius: 4, padding: '2px 6px', width: 80, outline: 'none' }}
                    />
                  ) : (
                    <span
                      onClick={() => { setEditingShortName(true); setShortNameValue(selectedCohort.short_name ?? '') }}
                      style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color: selectedCohort.short_name ? '#10232B' : '#7A9AA4', cursor: 'pointer', padding: '2px 4px', borderRadius: 3, border: '1px dashed #BDD3DC' }}
                      title="Click to edit short name"
                    >
                      {selectedCohort.short_name || 'not set'}
                    </span>
                  )}
                </div>
                {/* Description */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7A9AA4', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Description
                  </div>
                  {editingDescription ? (
                    <textarea
                      autoFocus
                      value={descriptionValue}
                      onChange={e => setDescriptionValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') setEditingDescription(false)
                      }}
                      onBlur={() => { updateCohortMeta(selectedCohort.id, { description: descriptionValue.trim() || null }); setEditingDescription(false) }}
                      rows={2}
                      style={{ fontSize: 12, border: '1px solid #6F99CC', borderRadius: 4, padding: '4px 6px', width: '100%', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                  ) : (
                    <span
                      onClick={() => { setEditingDescription(true); setDescriptionValue(selectedCohort.description ?? '') }}
                      style={{ fontSize: 12, color: selectedCohort.description ? '#10232B' : '#7A9AA4', cursor: 'pointer', fontStyle: selectedCohort.description ? 'normal' : 'italic' }}
                      title="Click to edit description"
                    >
                      {selectedCohort.description || 'Add a description…'}
                    </span>
                  )}
                </div>
              </div>

              {/* Add member search */}
              <div style={{ backgroundColor: '#FFFFFF', borderBottom: '1px solid #BDD3DC', padding: '12px 24px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#7A9AA4', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Add Organization
                </div>
                <div ref={memberSearchRef} style={{ position: 'relative', maxWidth: 440 }}>
                  <input
                    type="text"
                    placeholder="Search by name or EIN…"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '7px 10px',
                      fontSize: 13,
                      border: '1px solid #BDD3DC',
                      borderRadius: 5,
                      outline: 'none',
                      color: '#10232B',
                    }}
                  />
                  {showMemberDropdown && memberResults.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #BDD3DC',
                        borderRadius: 5,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        zIndex: 50,
                        maxHeight: 240,
                        overflowY: 'auto',
                      }}
                    >
                      {memberResults.map((org) => (
                        <button
                          key={org.ein}
                          onClick={() => addMember(org)}
                          disabled={addingMember}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 12px',
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            fontSize: 12,
                            color: '#10232B',
                            borderBottom: '1px solid #F2F4F1',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#E4EEF8')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <div style={{ fontWeight: 500 }}>{org.name}</div>
                          <div style={{ color: '#7A9AA4', fontSize: 11 }}>{org.ein} · {org.state}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {showMemberDropdown && memberResults.length === 0 && memberSearch.length >= 2 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #BDD3DC',
                        borderRadius: 5,
                        padding: '10px 12px',
                        fontSize: 12,
                        color: '#7A9AA4',
                        zIndex: 50,
                      }}
                    >
                      No results found
                    </div>
                  )}
                </div>
              </div>

              {/* Member list */}
              <div style={{ flex: 1, padding: '16px 24px' }}>
                {loadingMembers ? (
                  <div style={{ textAlign: 'center', color: '#7A9AA4', fontSize: 13, paddingTop: 40 }}>Loading members…</div>
                ) : members.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#7A9AA4', fontSize: 13, paddingTop: 40 }}>
                    No organizations in this cohort yet
                  </div>
                ) : (
                  <div
                    style={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #BDD3DC',
                      borderRadius: 6,
                      overflow: 'hidden',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#D7E8EE' }}>
                          <th style={{ padding: '9px 16px', textAlign: 'left', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC', fontSize: 12 }}>Organization</th>
                          <th style={{ padding: '9px 16px', textAlign: 'left', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC', fontSize: 12 }}>EIN</th>
                          <th style={{ padding: '9px 16px', textAlign: 'left', color: '#3D5A63', fontWeight: 600, borderBottom: '1px solid #BDD3DC', fontSize: 12 }}>State</th>
                          <th style={{ padding: '9px 16px', width: 40, borderBottom: '1px solid #BDD3DC' }} />
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((member) => (
                          <tr key={member.ein} style={{ borderBottom: '1px solid #F2F4F1' }}>
                            <td style={{ padding: '8px 16px', color: '#10232B' }}>{member.name}</td>
                            <td style={{ padding: '8px 16px', color: '#7A9AA4', fontFamily: 'monospace', fontSize: 12 }}>{member.ein}</td>
                            <td style={{ padding: '8px 16px', color: '#7A9AA4' }}>{member.state ?? '—'}</td>
                            <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                              <button
                                onClick={() => removeMember(member.ein)}
                                title="Remove from cohort"
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  cursor: 'pointer',
                                  color: '#7A9AA4',
                                  fontSize: 16,
                                  lineHeight: 1,
                                  padding: '2px 4px',
                                  borderRadius: 3,
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = '#10232B')}
                                onMouseLeave={(e) => (e.currentTarget.style.color = '#7A9AA4')}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CohortsPage() {
  return (
    <Suspense>
      <CohortsPageInner />
    </Suspense>
  )
}
