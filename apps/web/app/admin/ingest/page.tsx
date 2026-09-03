'use client'

import { useRef, useState, useCallback } from 'react'
import Papa from 'papaparse'
import { canonicalHeader, detectFormat, isForm990Row, mapRow, type FileFormat, type MappedRow } from '@/lib/ingest/field-map'

// ── constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500
const MAX_LOG_LINES = 20
const PREFLIGHT_CHUNK = 2000

// Cap on simultaneous requests to the API. Without one, a 340,000-row extract
// fans out to ~170 preflight requests and ~680 batch POSTs all at once. On
// localhost the browser's own HTTP/1.1 six-connection limit hides this; over
// HTTP/2 in production they really do all go in flight, and Neon starts
// refusing connections.
const MAX_INFLIGHT = 5

// Rough bytes-per-row for the pre-check row estimate, calibrated against
// 24eoextract990.csv (236 MB / 341,514 rows = 691). The old value of 200
// overstated a 236 MB file by 3.6x and left the progress bar reading ~28% at
// completion. Only used before the conflict check — after it we know the exact
// count and use that instead.
const BYTES_PER_ROW_ESTIMATE = 690

// This screen loads the IRS SOI annual extracts, which are the authoritative
// source. The e-file XML archive path (data_source 'efile_xml') arrives in a
// later phase and will set this per file.
const DATA_SOURCE = 'soi_extract'

const KNOWN_PATTERNS = [
  'py12_990.dat',
  '15eofinextract990.dat',
  '16eofinextract990.dat',
  '17eofinextract990.dat',
  '18eoextract990.csv',
  '19eoextract990.csv',
  '20eoextract990.csv',
  '21eoextract990.csv',
  '22eoextract990.csv',
  '23eoextract990.csv',
  '24eoextract990.csv',
]

function isKnownFilename(name: string): boolean {
  const lower = name.toLowerCase()
  return KNOWN_PATTERNS.some((p) => lower.includes(p.replace(/^\d+/, ''))) ||
    /^\d{2}eofinextract990\.(dat|csv)$/.test(lower) ||
    /^\d{2}eoextract990\.(dat|csv)$/.test(lower) ||
    lower === 'py12_990.dat'
}

/** Run tasks with at most `limit` in flight, preserving completion effects. */
async function pooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  })
  await Promise.all(workers)
  return results
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}

// ── types ────────────────────────────────────────────────────────────────────

type Status = 'idle' | 'checking' | 'parsing' | 'uploading' | 'done' | 'error'

type ConflictMode = 'skip' | 'overwrite'

interface Progress {
  parsed: number
  total: number
  batched: number
  errors: number
  inserted: number
  overwritten: number
  superseded: number
  skipped: number
}

/** What a load is about to land on, counted before anything is written. */
interface Preflight {
  keys: number
  fresh: number
  existingSoi: number
  existingEfile: number
}

const ZERO_PROGRESS: Progress = {
  parsed: 0, total: 0, batched: 0, errors: 0,
  inserted: 0, overwritten: 0, superseded: 0, skipped: 0,
}

// ── component ────────────────────────────────────────────────────────────────

export default function IngestPage() {
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<FileFormat | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState<Progress>(ZERO_PROGRESS)
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  // Exact row count, known once the conflict check has read the whole file.
  const [rowCount, setRowCount] = useState<number | null>(null)
  const [mode, setMode] = useState<ConflictMode>('skip')
  const [logs, setLogs] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => {
      const next = [...prev, msg]
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
    })
    setTimeout(() => {
      if (logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight
      }
    }, 0)
  }, [])

  function handleFileSelect(selected: File) {
    const fmt = detectFormat(selected.name)
    setFile(selected)
    setFormat(fmt)
    setStatus('idle')
    setProgress(ZERO_PROGRESS)
    setPreflight(null)
    setRowCount(null)
    setMode('skip')
    setLogs([])
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFileSelect(f)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFileSelect(f)
  }

  async function sendBatch(
    batch: MappedRow[],
    batchNum: number,
    totalBatches: number,
    sourceFile: string,
  ): Promise<boolean> {
    const attemptSend = async (): Promise<Response> => {
      return fetch('/api/ingest/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: batch,
          source_file: sourceFile,
          data_source: DATA_SOURCE,
          on_conflict: mode,
        }),
      })
    }

    addLog(`Sending batch ${batchNum}/${totalBatches}...`)

    let res: Response
    try {
      res = await attemptSend()
    } catch (err) {
      addLog(`⚠ Batch ${batchNum} failed: ${String(err)} — retrying in 2s...`)
      await new Promise((r) => setTimeout(r, 2000))
      try {
        res = await attemptSend()
      } catch (err2) {
        addLog(`✗ Batch ${batchNum} failed after retry: ${String(err2)}`)
        setProgress((p) => ({ ...p, errors: p.errors + 1 }))
        return false
      }
    }

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`
      try {
        const body = await res.json()
        if (body.error) errMsg = body.error
      } catch { /* ignore */ }
      addLog(`⚠ Batch ${batchNum} error: ${errMsg} — retrying in 2s...`)
      await new Promise((r) => setTimeout(r, 2000))
      let res2: Response
      try {
        res2 = await attemptSend()
      } catch (err2) {
        addLog(`✗ Batch ${batchNum} failed after retry: ${String(err2)}`)
        setProgress((p) => ({ ...p, errors: p.errors + 1 }))
        return false
      }
      if (!res2.ok) {
        addLog(`✗ Batch ${batchNum} failed after retry: HTTP ${res2.status}`)
        setProgress((p) => ({ ...p, errors: p.errors + 1 }))
        return false
      }
    }

    let counts = { inserted: 0, overwritten: 0, superseded: 0, skipped: 0 }
    try {
      const body = await res.json()
      counts = {
        inserted: body.inserted ?? 0,
        overwritten: body.overwritten ?? 0,
        superseded: body.superseded ?? 0,
        skipped: body.skipped ?? 0,
      }
    } catch { /* counts stay zero; the rows still landed */ }

    const detail = [
      counts.inserted && `${counts.inserted} new`,
      counts.overwritten && `${counts.overwritten} replaced`,
      counts.superseded && `${counts.superseded} superseded`,
      counts.skipped && `${counts.skipped} skipped`,
    ].filter(Boolean).join(', ')
    addLog(`Batch ${batchNum} complete (${batch.length} rows${detail ? ` — ${detail}` : ''})`)

    setProgress((p) => ({
      ...p,
      batched: p.batched + batch.length,
      inserted: p.inserted + counts.inserted,
      overwritten: p.overwritten + counts.overwritten,
      superseded: p.superseded + counts.superseded,
      skipped: p.skipped + counts.skipped,
    }))
    return true
  }

  /**
   * Pass one: read only (ein, tax_period) from the file and ask the API which
   * of those keys already exist, and from which source. Nothing is written.
   *
   * Deliberately a separate pass over the File rather than buffering every
   * mapped row in memory — the operator has to see what a load will collide
   * with before deciding skip or overwrite, and a 340,000-row extract held as
   * JS objects is a far worse trade than parsing the file twice.
   */
  function runPreflight() {
    if (!file || !format) return
    cancelRef.current = false
    setStatus('checking')
    setPreflight(null)
    setRowCount(null)
    setProgress(ZERO_PROGRESS)
    setLogs([])
    addLog('Checking what this file will land on...')

    const tally: Preflight = { keys: 0, fresh: 0, existingSoi: 0, existingEfile: 0 }
    let chunk: { ein: string; tax_period: string }[] = []
    // Chunks are collected during the parse and sent afterwards through a
    // bounded pool. Holding keys is cheap — ~40 bytes each, so ~14MB for a
    // 340,000-row extract — and far cheaper than holding mapped rows.
    const chunks: { ein: string; tax_period: string }[][] = []
    let seen = 0

    const checkChunk = async (keys: { ein: string; tax_period: string }[]) => {
      try {
        const res = await fetch('/api/ingest/preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        tally.keys += body.summary.checked
        tally.fresh += body.summary.new
        tally.existingSoi += body.summary.existing_soi
        tally.existingEfile += body.summary.existing_efile
        setPreflight({ ...tally })
      } catch (err) {
        addLog(`\u26a0 Conflict check chunk failed: ${String(err)}`)
      }
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      transformHeader: canonicalHeader,
      skipEmptyLines: true,
      worker: false,
      step: (result) => {
        if (cancelRef.current) return
        const row = result.data
        if (!isForm990Row(row, format)) return
        const mapped = mapRow(row, format, file.name)
        if (!mapped) return
        seen++
        chunk.push({ ein: mapped.ein, tax_period: mapped.tax_period })
        if (chunk.length >= PREFLIGHT_CHUNK) {
          chunks.push(chunk)
          chunk = []
        }
      },
      complete: async () => {
        if (cancelRef.current) {
          setStatus('idle')
          addLog('Conflict check cancelled.')
          return
        }
        if (chunk.length > 0) chunks.push(chunk)
        chunk = []
        setRowCount(seen)
        setProgress((p) => ({ ...p, total: seen }))
        addLog(`Read ${seen.toLocaleString()} rows — checking ${chunks.length} batches of keys...`)
        await pooled(chunks.map((c) => () => checkChunk(c)), MAX_INFLIGHT)
        setPreflight({ ...tally })
        addLog(
          `\u2713 Checked ${seen.toLocaleString()} rows: ${tally.fresh.toLocaleString()} new, ` +
          `${tally.existingSoi.toLocaleString()} already loaded from an annual extract, ` +
          `${tally.existingEfile.toLocaleString()} already loaded from an e-file archive`,
        )
        setStatus('idle')
      },
      error: (err: Error) => {
        addLog(`\u2717 Parse error during conflict check: ${err.message}`)
        setStatus('error')
      },
    })
  }

  function startIngestion() {
    if (!file || !format) return
    cancelRef.current = false
    setStatus('parsing')
    setProgress(ZERO_PROGRESS)
    setLogs([])

    const sourceFile = file.name
    const startTime = Date.now()
    addLog('Parsing file...')

    // Buffer for accumulating rows before sending
    let buffer: MappedRow[] = []
    // Map for deduplication within buffer: key = `${ein}|${tax_period}`
    const bufferMap = new Map<string, number>() // key → index in buffer
    let parsedCount = 0
    let filteredCount = 0
    let batchNum = 0
    const pendingBatches: Promise<boolean>[] = []

    // Back-pressure: the step callback cannot await, so instead of firing every
    // batch at once we pause the parser while MAX_INFLIGHT requests are open
    // and resume as they settle. Without this a large extract dispatches
    // hundreds of concurrent POSTs.
    let inflight = 0
    let paused = false
    let parserRef: Papa.Parser | null = null

    const dispatch = (batch: MappedRow[], num: number, total: number) => {
      inflight++
      const p = sendBatch(batch, num, total, sourceFile).finally(() => {
        inflight--
        if (paused && inflight < MAX_INFLIGHT) {
          paused = false
          parserRef?.resume()
        }
      })
      pendingBatches.push(p)
      if (inflight >= MAX_INFLIGHT && parserRef && !paused) {
        paused = true
        parserRef.pause()
      }
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      transformHeader: canonicalHeader,
      skipEmptyLines: true,
      worker: false, // worker: true requires bundler config — use main thread streaming via step
      step: (result: Papa.ParseStepResult<Record<string, string>>, parser: Papa.Parser) => {
        parserRef = parser
        if (cancelRef.current) return

        const row = result.data
        if (!isForm990Row(row, format)) {
          filteredCount++
          return
        }

        const mapped = mapRow(row, format, sourceFile)
        if (!mapped) {
          filteredCount++
          return
        }

        parsedCount++
        setProgress((p) => ({ ...p, parsed: parsedCount }))

        const key = `${mapped.ein}|${mapped.tax_period}`
        if (bufferMap.has(key)) {
          // last wins: overwrite existing entry
          const idx = bufferMap.get(key)!
          buffer[idx] = mapped
        } else {
          bufferMap.set(key, buffer.length)
          buffer.push(mapped)
        }

        if (buffer.length >= BATCH_SIZE) {
          const batch = buffer.slice()
          buffer = []
          bufferMap.clear()
          const estimatedTotal = Math.ceil((rowCount ?? file.size / BYTES_PER_ROW_ESTIMATE) / BATCH_SIZE)
          batchNum++
          setStatus('uploading')
          dispatch(batch, batchNum, Math.max(estimatedTotal, batchNum))
        }
      },
      complete: async () => {
        if (cancelRef.current) {
          setStatus('idle')
          addLog('Ingestion cancelled.')
          return
        }

        addLog(`Parsed ${parsedCount.toLocaleString()} rows, ${filteredCount.toLocaleString()} filtered (non-Form-990 or invalid)`)

        // Flush remaining buffer
        if (buffer.length > 0) {
          const batch = buffer.slice()
          buffer = []
          bufferMap.clear()
          batchNum++
          dispatch(batch, batchNum, batchNum)
        }

        // Wait for all pending batches
        await Promise.all(pendingBatches)

        const elapsed = Date.now() - startTime
        setProgress((p) => {
          const final = p
          addLog(
            `✓ Ingestion complete: ${final.batched.toLocaleString()} rows processed in ${formatDuration(elapsed)}` +
              (final.errors > 0 ? ` (${final.errors} batch errors)` : ''),
          )
          return final
        })
        setStatus('done')
      },
      error: (err: Error) => {
        addLog(`✗ Parse error: ${err.message}`)
        setStatus('error')
      },
    })
  }

  function handleCancel() {
    cancelRef.current = true
    setStatus('idle')
    addLog('Cancelling...')
  }

  const estimatedRows = file ? Math.round(file.size / BYTES_PER_ROW_ESTIMATE) : 0
  const progressPct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.batched / progress.total) * 100))
      : estimatedRows > 0 && progress.batched > 0
      ? Math.min(99, Math.round((progress.batched / estimatedRows) * 100))
      : 0

  const isChecking = status === 'checking'
  const isRunning = status === 'parsing' || status === 'uploading'
  const isBusy = isChecking || isRunning

  return (
    // The app shell is fixed-viewport — globals.css sets `html, body {
    // overflow: hidden }` and <main> is height:100vh with overflow:hidden — so
    // every page owns its own scrolling. Without this scroll container the
    // lower steps are simply unreachable on a short window. Same pattern as
    // the cohorts and visualization pages. `minHeight: 0` is what lets a flex
    // child shrink below its content height so the overflow can engage.
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div
        style={{
          padding: '32px 40px',
          maxWidth: '860px',
          margin: '0 auto',
          fontFamily: "'Avenir Next LT Pro', system-ui, sans-serif",
        }}
      >
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1
          style={{
            margin: 0,
            fontSize: '22px',
            fontWeight: 600,
            color: '#10232B',
            letterSpacing: '-0.01em',
          }}
        >
          Data Ingestion
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: '14px', color: '#3D5A63' }}>
          Upload IRS SOI annual extract files to update the database.
        </p>
      </div>

      {/* Step 1 — File selection */}
      <section style={{ marginBottom: '24px' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#3D5A63',
            backgroundColor: '#D7E8EE',
            padding: '6px 14px',
            borderRadius: '4px 4px 0 0',
            borderBottom: '1px solid #BDD3DC',
          }}
        >
          Step 1 — Select File
        </div>
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #BDD3DC',
            borderTop: 'none',
            borderRadius: '0 0 6px 6px',
            padding: '24px',
          }}
        >
          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? '#6F99CC' : '#BDD3DC'}`,
              borderRadius: '6px',
              backgroundColor: isDragging ? '#E4EEF8' : '#F2F4F1',
              padding: '40px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'background-color 0.15s, border-color 0.15s',
            }}
          >
            <div style={{ marginBottom: '12px' }}>
              <svg
                width="36"
                height="36"
                viewBox="0 0 36 36"
                fill="none"
                style={{ display: 'inline-block', color: '#6F99CC' }}
              >
                <path
                  d="M18 4L10 14h5v10h6V14h5L18 4z"
                  fill="currentColor"
                  opacity="0.8"
                />
                <path
                  d="M6 28h24v4H6v-4z"
                  fill="currentColor"
                  opacity="0.4"
                />
              </svg>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#10232B', fontWeight: 500 }}>
              Drag &amp; drop a file here
            </p>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#3D5A63' }}>
              or click to browse
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation()
                fileInputRef.current?.click()
              }}
              style={{
                backgroundColor: '#6F99CC',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 20px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Browse
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".dat,.csv,.txt"
              style={{ display: 'none' }}
              onChange={handleInputChange}
            />
          </div>

          {/* File info */}
          {file && (
            <div style={{ marginTop: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  backgroundColor: '#E4EEF8',
                  borderRadius: '4px',
                  border: '1px solid #BDD3DC',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#6F99CC">
                  <path d="M3 1h7l3 3v11H3V1zm7 0v3h3" />
                </svg>
                <span style={{ fontSize: '13px', color: '#10232B', fontWeight: 500, flex: 1 }}>
                  {file.name}
                </span>
                <span style={{ fontSize: '12px', color: '#3D5A63' }}>{formatBytes(file.size)}</span>
                {format && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '3px',
                      backgroundColor: '#6F99CC',
                      color: '#FFFFFF',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {format === 'dat' ? 'Space-delimited DAT' : 'Comma-separated CSV'}
                  </span>
                )}
              </div>

              {/* Unknown filename warning */}
              {file && !isKnownFilename(file.name) && (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '10px 14px',
                    backgroundColor: '#F3EAE0',
                    border: '1px solid #7A5C3A',
                    borderRadius: '4px',
                    fontSize: '13px',
                    color: '#7A5C3A',
                  }}
                >
                  ⚠ Unrecognized filename format — verify this is an IRS SOI 990 extract file.
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Step 2 — Preview / confirm */}
      <section style={{ marginBottom: '24px' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#3D5A63',
            backgroundColor: '#D7E8EE',
            padding: '6px 14px',
            borderRadius: '4px 4px 0 0',
            borderBottom: '1px solid #BDD3DC',
          }}
        >
          Step 2 — Preview &amp; Confirm
        </div>
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #BDD3DC',
            borderTop: 'none',
            borderRadius: '0 0 6px 6px',
            padding: '24px',
          }}
        >
          {file ? (
            <>
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content 1fr',
                  gap: '6px 24px',
                  margin: '0 0 20px',
                  fontSize: '13px',
                }}
              >
                <dt style={{ color: '#3D5A63', fontWeight: 500 }}>File name</dt>
                <dd style={{ margin: 0, color: '#10232B' }}>{file.name}</dd>
                <dt style={{ color: '#3D5A63', fontWeight: 500 }}>File size</dt>
                <dd style={{ margin: 0, color: '#10232B' }}>{formatBytes(file.size)}</dd>
                <dt style={{ color: '#3D5A63', fontWeight: 500 }}>Detected format</dt>
                <dd style={{ margin: 0, color: '#10232B' }}>
                  {format === 'dat' ? 'Space-delimited DAT' : format === 'csv' ? 'Comma-separated CSV' : '—'}
                </dd>
                <dt style={{ color: '#3D5A63', fontWeight: 500 }}>Estimated rows</dt>
                <dd style={{ margin: 0, color: '#10232B' }}>
                  {rowCount !== null
                    ? `${rowCount.toLocaleString()} (exact, counted during the conflict check)`
                    : `~${estimatedRows.toLocaleString()} (rough estimate)`}
                </dd>
              </dl>

              {/* Known patterns info */}
              <div
                style={{
                  padding: '12px 14px',
                  backgroundColor: '#F2F4F1',
                  border: '1px solid #BDD3DC',
                  borderRadius: '4px',
                  marginBottom: '20px',
                }}
              >
                <p
                  style={{
                    margin: '0 0 8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#3D5A63',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Expected filename patterns
                </p>
                <ul
                  style={{
                    margin: 0,
                    padding: '0 0 0 16px',
                    fontSize: '12px',
                    color: '#3D5A63',
                    lineHeight: 1.8,
                  }}
                >
                  {KNOWN_PATTERNS.map((p) => (
                    <li key={p} style={{ fontFamily: 'monospace' }}>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={runPreflight}
                disabled={!file || !format || isBusy}
                style={{
                  backgroundColor: !file || !format || isBusy ? '#BDD3DC' : '#6F99CC',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '5px',
                  padding: '10px 28px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: !file || !format || isBusy ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s',
                }}
              >
                {isChecking ? 'Checking...' : 'Check for Conflicts'}
              </button>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: '#3D5A63' }}>
              Select a file above to see details.
            </p>
          )}
        </div>
      </section>

      {/* Step 3 — Conflicts & load */}
      {preflight && (
        <section style={{ marginBottom: '24px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#3D5A63',
              backgroundColor: '#D7E8EE',
              padding: '6px 14px',
              borderRadius: '4px 4px 0 0',
              borderBottom: '1px solid #BDD3DC',
            }}
          >
            Step 3 — Conflicts &amp; Load
          </div>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #BDD3DC',
              borderTop: 'none',
              borderRadius: '0 0 6px 6px',
              padding: '24px',
            }}
          >
            {/* Counts */}
            <div style={{ display: 'flex', gap: '1px', backgroundColor: '#BDD3DC', border: '1px solid #BDD3DC', borderRadius: '4px', overflow: 'hidden', marginBottom: '20px', flexWrap: 'wrap' }}>
              {[
                { k: 'New records', v: preflight.fresh, note: 'no existing row for this period' },
                { k: 'Already from an annual extract', v: preflight.existingSoi, note: 'authoritative source' },
                { k: 'Already from an e-file archive', v: preflight.existingEfile, note: 'preliminary source' },
              ].map(({ k, v, note }) => (
                <div key={k} style={{ backgroundColor: '#FFFFFF', padding: '12px 16px', flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '20px', fontWeight: 600, color: '#10232B', fontVariantNumeric: 'tabular-nums' }}>
                    {v.toLocaleString()}
                  </span>
                  <span style={{ fontSize: '12px', color: '#10232B', fontWeight: 500 }}>{k}</span>
                  <span style={{ fontSize: '11px', color: '#7A9AA4' }}>{note}</span>
                </div>
              ))}
            </div>

            {preflight.existingSoi + preflight.existingEfile === 0 ? (
              <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#3D5A63' }}>
                Nothing in this file collides with data already loaded. It will be added as new records.
              </p>
            ) : (
              <>
                <p
                  style={{
                    margin: '0 0 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#3D5A63',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  For records that already exist
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                  {([
                    {
                      value: 'skip' as ConflictMode,
                      label: 'Keep what is already stored',
                      detail: 'Existing records are left untouched. Only new records are added.',
                    },
                    {
                      value: 'overwrite' as ConflictMode,
                      label: 'Replace with this file',
                      detail: 'This file wins field by field. Where it has no value, the stored value is kept rather than blanked.',
                    },
                  ]).map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start',
                        padding: '12px 14px',
                        border: `1px solid ${mode === opt.value ? '#6F99CC' : '#BDD3DC'}`,
                        backgroundColor: mode === opt.value ? '#E4EEF8' : '#FFFFFF',
                        borderRadius: '4px',
                        cursor: isRunning ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        name="on_conflict"
                        value={opt.value}
                        checked={mode === opt.value}
                        disabled={isRunning}
                        onChange={() => setMode(opt.value)}
                        style={{ marginTop: '2px', accentColor: '#6F99CC' }}
                      />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#10232B' }}>{opt.label}</span>
                        <span style={{ fontSize: '12px', color: '#3D5A63' }}>{opt.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#F2F4F1',
                    border: '1px solid #BDD3DC',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: '#3D5A63',
                    marginBottom: '20px',
                  }}
                >
                  Amended returns are handled separately: where an organisation filed the same form more
                  than once for a period, the most recent submission is always used, and the change is
                  recorded regardless of the choice above.
                </div>
              </>
            )}

            <button
              onClick={startIngestion}
              disabled={!file || !format || isBusy}
              style={{
                backgroundColor: !file || !format || isBusy ? '#BDD3DC' : '#6F99CC',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '5px',
                padding: '10px 28px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: !file || !format || isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Begin Ingestion
            </button>
          </div>
        </section>
      )}

      {/* Step 3 — Progress */}
      {(isRunning || status === 'done' || status === 'error' || logs.length > 0) && (
        <section>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#3D5A63',
              backgroundColor: '#D7E8EE',
              padding: '6px 14px',
              borderRadius: '4px 4px 0 0',
              borderBottom: '1px solid #BDD3DC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Step 4 — Progress</span>
            {isRunning && (
              <button
                onClick={handleCancel}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid #7A5C3A',
                  borderRadius: '3px',
                  color: '#7A5C3A',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 10px',
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                Cancel
              </button>
            )}
          </div>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #BDD3DC',
              borderTop: 'none',
              borderRadius: '0 0 6px 6px',
              padding: '24px',
            }}
          >
            {/* Progress bar */}
            <div
              style={{
                height: '8px',
                backgroundColor: '#E4EEF8',
                borderRadius: '4px',
                overflow: 'hidden',
                marginBottom: '14px',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  backgroundColor: status === 'error' ? '#B83228' : status === 'done' ? '#4A8A6A' : '#6F99CC',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            {/* Stats */}
            <div
              style={{
                display: 'flex',
                gap: '24px',
                marginBottom: '20px',
                fontSize: '13px',
                color: '#3D5A63',
              }}
            >
              <span>
                <strong style={{ color: '#10232B' }}>{progress.parsed.toLocaleString()}</strong> rows parsed
              </span>
              <span>
                <strong style={{ color: '#10232B' }}>{progress.batched.toLocaleString()}</strong> rows sent
              </span>
              {progress.errors > 0 && (
                <span style={{ color: '#B83228' }}>
                  <strong>{progress.errors}</strong> batch error{progress.errors !== 1 ? 's' : ''}
                </span>
              )}
              {progress.inserted > 0 && (
                <span><strong style={{ color: '#10232B' }}>{progress.inserted.toLocaleString()}</strong> new</span>
              )}
              {progress.overwritten > 0 && (
                <span><strong style={{ color: '#10232B' }}>{progress.overwritten.toLocaleString()}</strong> replaced</span>
              )}
              {progress.superseded > 0 && (
                <span><strong style={{ color: '#10232B' }}>{progress.superseded.toLocaleString()}</strong> superseded</span>
              )}
              {progress.skipped > 0 && (
                <span><strong style={{ color: '#10232B' }}>{progress.skipped.toLocaleString()}</strong> skipped</span>
              )}
              {status === 'done' && (
                <span style={{ color: '#4A8A6A', fontWeight: 600 }}>Complete</span>
              )}
            </div>

            {/* Log panel */}
            <div
              ref={logRef}
              style={{
                backgroundColor: '#10232B',
                borderRadius: '4px',
                padding: '14px 16px',
                height: '200px',
                overflowY: 'auto',
                fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", monospace',
                fontSize: '12px',
                lineHeight: '1.7',
                color: '#BDD3DC',
              }}
            >
              {logs.length === 0 ? (
                <span style={{ color: '#3D5A63' }}>Waiting for output...</span>
              ) : (
                logs.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      color: line.startsWith('✓')
                        ? '#6FCF97'
                        : line.startsWith('✗') || line.startsWith('Parse error')
                        ? '#FAEBE9'
                        : line.startsWith('⚠')
                        ? '#F3EAE0'
                        : '#BDD3DC',
                    }}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}
      </div>
    </div>
  )
}
