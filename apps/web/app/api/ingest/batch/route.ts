import { type NextRequest } from 'next/server'
import { rawQuery } from '@/lib/db'
import {
  DATA_SOURCES,
  CONFLICT_MODES,
  buildFilingsUpsert,
  buildOrganizationsUpsert,
  type ConflictMode,
  type DataSource,
} from '@/lib/ingest/upsert-sql'

const MAX_ROWS = 1000

interface BatchRequestBody {
  rows: Record<string, unknown>[]
  source_file: string
  /** Where these rows came from. Defaults to the SOI extracts for back-compat. */
  data_source?: DataSource
  /**
   * What to do when a row already exists from a *different* source.
   * 'skip' (default) preserves what is stored; 'overwrite' lets the incoming
   * row win field by field. e-file resubmissions are resolved by submission
   * date regardless of this setting.
   */
  on_conflict?: ConflictMode
}

export async function POST(request: NextRequest) {
  let body: BatchRequestBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { rows } = body
  const dataSource: DataSource = body.data_source ?? 'soi_extract'
  const mode: ConflictMode = body.on_conflict ?? 'skip'

  if (!Array.isArray(rows)) {
    return Response.json({ error: '`rows` must be an array' }, { status: 400 })
  }
  if (!DATA_SOURCES.includes(dataSource)) {
    return Response.json(
      { error: `data_source must be one of: ${DATA_SOURCES.join(', ')}` },
      { status: 400 },
    )
  }
  if (!CONFLICT_MODES.includes(mode)) {
    return Response.json(
      { error: `on_conflict must be one of: ${CONFLICT_MODES.join(', ')}` },
      { status: 400 },
    )
  }
  if (rows.length === 0) {
    return Response.json({
      processed: 0, inserted: 0, overwritten: 0, superseded: 0, skipped: 0,
    })
  }
  if (rows.length > MAX_ROWS) {
    return Response.json(
      { error: `Batch too large: ${rows.length} rows (max ${MAX_ROWS})` },
      { status: 400 },
    )
  }
  if (rows.some((r) => !r.ein || !r.tax_period)) {
    return Response.json(
      { error: 'Every row requires `ein` and `tax_period`' },
      { status: 400 },
    )
  }

  try {
    const orgs = buildOrganizationsUpsert(rows)
    await rawQuery(orgs.sql, orgs.params)

    const upsert = buildFilingsUpsert(rows, dataSource, mode, body.source_file)
    const audited = await rawQuery<{ action: string }>(upsert.sql, upsert.params)

    const counts = { inserted: 0, overwritten: 0, superseded: 0, skipped: 0 }
    for (const a of audited) {
      if (a.action === 'overwritten') counts.overwritten++
      else if (a.action === 'superseded') counts.superseded++
      else counts.skipped++
    }
    counts.inserted = rows.length - audited.length

    return Response.json({ processed: rows.length, ...counts })
  } catch (err) {
    console.error('[POST /api/ingest/batch]', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
