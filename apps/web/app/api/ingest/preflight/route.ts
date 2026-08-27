import { type NextRequest } from 'next/server'
import { rawQuery } from '@/lib/db'
import { buildPreflightQuery } from '@/lib/ingest/upsert-sql'

const MAX_KEYS = 2000

interface PreflightKey {
  ein: string
  tax_period: string
}

interface PreflightRequestBody {
  keys: PreflightKey[]
}

interface ExistingRow {
  ein: string
  tax_period: string
  data_source: string
  source_file: string | null
  form_type: string | null
  submission_date: string | null
}

/**
 * Report which of the supplied (ein, tax_period) keys already exist, and where
 * each stored row came from — so the uploader can tell the operator what a load
 * is about to collide with *before* writing anything.
 *
 * Read-only. The caller chunks; each request answers up to MAX_KEYS keys.
 */
export async function POST(request: NextRequest) {
  let body: PreflightRequestBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { keys } = body
  if (!Array.isArray(keys)) {
    return Response.json({ error: '`keys` must be an array' }, { status: 400 })
  }
  if (keys.length === 0) {
    return Response.json({ checked: 0, existing: [], summary: emptySummary() })
  }
  if (keys.length > MAX_KEYS) {
    return Response.json(
      { error: `Too many keys: ${keys.length} (max ${MAX_KEYS})` },
      { status: 400 },
    )
  }

  try {
    const q = buildPreflightQuery(keys)
    const existing = await rawQuery<ExistingRow>(q.sql, q.params)

    const summary = emptySummary()
    for (const row of existing) {
      if (row.data_source === 'efile_xml') summary.existing_efile++
      else summary.existing_soi++
    }
    summary.checked = keys.length
    summary.new = keys.length - existing.length

    return Response.json({ checked: keys.length, existing, summary })
  } catch (err) {
    console.error('[POST /api/ingest/preflight]', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

function emptySummary() {
  return { checked: 0, new: 0, existing_soi: 0, existing_efile: 0 }
}
