'use client'

import { useRef, useState, useCallback } from 'react'
import Papa from 'papaparse'
import { detectFormat, isForm990Row, mapRow, type FileFormat, type MappedRow } from '@/lib/ingest/field-map'

// ── constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500
const MAX_LOG_LINES = 20

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

type Status = 'idle' | 'parsing' | 'uploading' | 'done' | 'error'

interface Progress {
  parsed: number
  total: number
  batched: number
  errors: number
}

// ── component ────────────────────────────────────────────────────────────────

export default function IngestPage() {
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<FileFormat | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState<Progress>({ parsed: 0, total: 0, batched: 0, errors: 0 })
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
    setProgress({ parsed: 0, total: 0, batched: 0, errors: 0 })
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
        body: JSON.stringify({ rows: batch, source_file: sourceFile }),
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

    addLog(`Batch ${batchNum} complete (${batch.length} rows)`)
    setProgress((p) => ({ ...p, batched: p.batched + batch.length }))
    return true
  }

  function startIngestion() {
    if (!file || !format) return
    cancelRef.current = false
    setStatus('parsing')
    setProgress({ parsed: 0, total: 0, batched: 0, errors: 0 })
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

    const flushBuffer = async (isLast: boolean) => {
      if (buffer.length === 0) return
      const batch = buffer.slice()
      buffer = []
      bufferMap.clear()

      const estimatedTotal = Math.ceil((file.size / 200) / BATCH_SIZE)
      batchNum++
      const currentBatch = batchNum
      const p = sendBatch(batch, currentBatch, Math.max(estimatedTotal, currentBatch), sourceFile)
      if (isLast) {
        await p
      } else {
        pendingBatches.push(p)
      }
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      worker: false, // worker: true requires bundler config — use main thread streaming via step
      step: (result: Papa.ParseStepResult<Record<string, string>>) => {
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
          // We can't await inside step, so we fire-and-forget here and track via pendingBatches
          const batch = buffer.slice()
          buffer = []
          bufferMap.clear()
          const estimatedTotal = Math.ceil((file.size / 200) / BATCH_SIZE)
          batchNum++
          const currentBatch = batchNum
          setStatus('uploading')
          pendingBatches.push(sendBatch(batch, currentBatch, Math.max(estimatedTotal, currentBatch), sourceFile))
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
          const estimatedTotal = Math.max(batchNum + 1, batchNum)
          batchNum++
          pendingBatches.push(sendBatch(batch, batchNum, estimatedTotal, sourceFile))
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

  const estimatedRows = file ? Math.round(file.size / 200) : 0
  const progressPct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.batched / progress.total) * 100))
      : estimatedRows > 0 && progress.batched > 0
      ? Math.min(99, Math.round((progress.batched / estimatedRows) * 100))
      : 0

  const isRunning = status === 'parsing' || status === 'uploading'

  return (
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
                  ~{estimatedRows.toLocaleString()} (rough estimate)
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
                onClick={startIngestion}
                disabled={!file || !format || isRunning}
                style={{
                  backgroundColor: !file || !format || isRunning ? '#BDD3DC' : '#6F99CC',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '5px',
                  padding: '10px 28px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: !file || !format || isRunning ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s',
                }}
              >
                Begin Ingestion
              </button>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: '#3D5A63' }}>
              Select a file above to see details.
            </p>
          )}
        </div>
      </section>

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
            <span>Step 3 — Progress</span>
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
  )
}
