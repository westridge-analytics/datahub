import { type NextRequest } from 'next/server'
import { rawQuery } from '@/lib/db'
import {
  DATA_SOURCES,
  CONFLICT_MODES,
  buildFilingsUpsert,
  buildMissingEinsQuery,
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
      skipped_unknown_ein: 0, unknown_eins: [],
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
    // Names, only where the incoming rows actually carry one. The SOI extracts
    // do not; the e-file archives do. Returns null when there is nothing to do.
    const orgs = buildOrganizationsUpsert(rows)
    if (orgs) await rawQuery(orgs.sql, orgs.params)

    // filings.ein is a foreign key. An EIN with no organization row cannot be
    // stored, and cannot be created either without a name, so skip those rows
    // and report them rather than failing the whole batch.
    const eins = [...new Set(rows.map((r) => String(r.ein)))]
    const missingQ = buildMissingEinsQuery(eins)
    const missing = await rawQuery<{ ein: string }>(missingQ.sql, missingQ.params)
    const unknown = new Set(missing.map((m) => m.ein))

    const loadable = unknown.size === 0 ? rows : rows.filter((r) => !unknown.has(String(r.ein)))
    const skippedUnknown = rows.length - loadable.length

    const counts = { inserted: 0, overwritten: 0, superseded: 0, skipped: 0 }
    let deduped = 0
    if (loadable.length > 0) {
      const upsert = buildFilingsUpsert(loadable, dataSource, mode, body.source_file)
      const audited = await rawQuery<{ action: string }>(upsert.sql, upsert.params)
      // rowCount is post-dedupe: one archive can carry two returns for the same
      // period, and Postgres will not let one statement touch a row twice.
      const written = upsert.rowCount ?? loadable.length
      deduped = loadable.length - written
      for (const a of audited) {
        if (a.action === 'overwritten') counts.overwritten++
        else if (a.action === 'superseded') counts.superseded++
        else counts.skipped++
      }
      counts.inserted = written - audited.length
    }

    return Response.json({
      processed: rows.length,
      ...counts,
      skipped_unknown_ein: skippedUnknown,
      deduped,
      // A sample, so the operator can look one up without the response bloating.
      unknown_eins: [...unknown].slice(0, 5),
    })
  } catch (err) {
    console.error('[POST /api/ingest/batch]', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
