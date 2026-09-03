/**
 * The ingestion write contract: which columns /api/ingest/batch writes, the
 * source-precedence rules that decide conflicts, and the SQL builders for both.
 *
 * Kept in one module deliberately. The builders and the column list must agree
 * exactly, and the predicates are meaningless apart from the columns they
 * compare — splitting them invited a cross-file import that Node's TypeScript
 * stripping cannot resolve without extensionless-import guesswork.
 *
 * Everything here is pure: no database handle, no `@/` alias. That is what lets
 * conflict.test.ts execute the exact production SQL against a scratch schema.
 */

export type PgType = 'text' | 'date' | 'int' | 'bigint' | 'boolean'

export interface UpsertColumn {
  name: string
  type: PgType
  /** Key columns are matched on, never updated. */
  key?: true
}

export const UPSERT_COLUMNS: UpsertColumn[] = [
  { name: 'ein', type: 'text', key: true },
  { name: 'tax_period', type: 'date', key: true },
  { name: 'fiscal_year', type: 'int' },

  { name: 'total_revenue', type: 'bigint' },
  { name: 'total_expenses', type: 'bigint' },
  { name: 'total_assets', type: 'bigint' },
  { name: 'total_liabilities', type: 'bigint' },
  { name: 'total_net_assets', type: 'bigint' },
  { name: 'contributions', type: 'bigint' },
  { name: 'program_revenue', type: 'bigint' },
  { name: 'investment_income', type: 'bigint' },
  { name: 'other_revenue', type: 'bigint' },
  { name: 'program_expenses', type: 'bigint' },
  { name: 'ga_expenses', type: 'bigint' },
  { name: 'fundraising_expenses', type: 'bigint' },
  { name: 'cash_equiv', type: 'bigint' },
  { name: 'st_investments', type: 'bigint' },
  { name: 'lt_investments', type: 'bigint' },
  { name: 'ppe', type: 'bigint' },
  { name: 'unrestr_net_assets', type: 'bigint' },
  { name: 'restr_net_assets', type: 'bigint' },

  { name: 'source_file', type: 'text' },
  { name: 'form_type', type: 'text' },

  // provenance — migrate_efile_provenance.sql
  { name: 'data_source', type: 'text' },
  { name: 'object_id', type: 'text' },
  { name: 'dln', type: 'text' },
  { name: 'submission_date', type: 'date' },
  { name: 'is_amended', type: 'boolean' },
]

export const DATA_SOURCES = ['soi_extract', 'efile_xml'] as const
export type DataSource = (typeof DATA_SOURCES)[number]

export const CONFLICT_MODES = ['skip', 'overwrite'] as const
export type ConflictMode = (typeof CONFLICT_MODES)[number]

/**
 * Whether an incoming row beats the row already stored.
 *
 * Two distinct rules, and the distinction matters:
 *
 *  - **e-file over e-file** is a resubmission, not a conflict. The later
 *    SUB_DATE wins automatically; the operator is never asked. (Decision 3.)
 *  - **everything else** is a genuine cross-source conflict and is governed by
 *    the operator's skip/overwrite choice for this load. (Decision 2.)
 *
 * `incoming` and `existing` are SQL aliases: `EXCLUDED` / `filings` inside an
 * ON CONFLICT clause, or CTE aliases elsewhere. `modeParam` is the $N
 * placeholder holding 'skip' | 'overwrite'.
 */
export function incomingWinsSql(
  incoming: string,
  existing: string,
  modeParam: string,
): string {
  const bothEfile =
    `${incoming}.data_source = 'efile_xml' AND ${existing}.data_source = 'efile_xml'`
  return `(
    (${bothEfile}
       AND ${incoming}.submission_date IS NOT NULL
       AND (${existing}.submission_date IS NULL
            OR ${incoming}.submission_date >= ${existing}.submission_date))
    OR
    (NOT (${bothEfile}) AND ${modeParam} = 'overwrite')
  )`
}

/**
 * What to record in ingest_audit for a row that hit an existing row.
 * Mirrors incomingWinsSql — a supersession is an e-file resubmission that won;
 * anything else that won is an overwrite; anything that lost was skipped.
 */
export function auditActionSql(
  incoming: string,
  existing: string,
  modeParam: string,
): string {
  const bothEfile =
    `${incoming}.data_source = 'efile_xml' AND ${existing}.data_source = 'efile_xml'`
  const wins = incomingWinsSql(incoming, existing, modeParam)
  return `CASE
    WHEN NOT ${wins} THEN 'skipped'
    WHEN ${bothEfile} THEN 'superseded'
    ELSE 'overwritten'
  END`
}

export interface BuildOptions {
  /** Qualify table names, e.g. 'ingest_test'. Defaults to unqualified (public). */
  schema?: string
}

export interface BuiltQuery {
  sql: string
  params: unknown[]
}

function table(name: string, opts?: BuildOptions): string {
  return opts?.schema ? `"${opts.schema}".${name}` : name
}

/**
 * Upsert organization names — for rows that actually carry one.
 *
 * Returns null when no row has a name, which is the normal case for the SOI
 * annual extracts: they carry no organization name column at all. Names come
 * from the IRS EO BMF (scripts/ingest.py --eobmf), which is authoritative, so a
 * filing load must never rename an existing organization and must never invent
 * a name for a new one.
 *
 * `organizations.name` is NOT NULL. Sending an explicit NULL here fails the
 * entire batch — exactly what broke all 684 batches once the uploader started
 * parsing rows successfully for the first time.
 */
export function buildOrganizationsUpsert(
  rows: Record<string, unknown>[],
  opts?: BuildOptions,
): BuiltQuery | null {
  const named = new Map<string, string>()
  for (const r of rows) {
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (name !== '' && !named.has(String(r.ein))) named.set(String(r.ein), name)
  }
  if (named.size === 0) return null

  const params: unknown[] = []
  const values = [...named.entries()].map(([ein, name]) => {
    params.push(ein, name)
    return `($${params.length - 1}, $${params.length})`
  })

  return {
    sql: `INSERT INTO ${table('organizations', opts)} (ein, name)
          VALUES ${values.join(', ')}
          ON CONFLICT (ein) DO UPDATE
            SET name = EXCLUDED.name
            WHERE ${table('organizations', opts)}.name IS NULL`,
    params,
  }
}

/**
 * Which of these EINs have no organizations row.
 *
 * filings.ein is a foreign key, so a filing for an unknown EIN cannot be
 * stored. Since the extracts carry no name and organizations.name is NOT NULL,
 * such an organization cannot be conjured either — so those filings are skipped
 * and reported, with the fix being to load a current BMF. A nameless
 * placeholder organization would be unsearchable and would render blank in the
 * table, which is worse than a reported skip.
 */
export function buildMissingEinsQuery(
  eins: string[],
  opts?: BuildOptions,
): BuiltQuery {
  return {
    sql: `SELECT e AS ein FROM unnest($1::text[]) e
          WHERE NOT EXISTS (
            SELECT 1 FROM ${table('organizations', opts)} o WHERE o.ein = e
          )`,
    params: [eins],
  }
}

/**
 * Upsert filings with source precedence, logging every conflict resolution to
 * ingest_audit — in one statement, returning one `action` row per conflict.
 *
 * The single-statement shape is what makes this correct rather than merely
 * convenient. Every CTE in a statement sees the same snapshot, so `prior`
 * observes the pre-upsert state even though `upserted` is rewriting those exact
 * rows. Read-then-write across two statements would open a window where a
 * concurrent load changes what gets audited, and would need a real transaction
 * the Neon HTTP driver does not provide.
 */
export function buildFilingsUpsert(
  rows: Record<string, unknown>[],
  dataSource: DataSource,
  mode: ConflictMode,
  sourceFile: string,
  opts?: BuildOptions,
): BuiltQuery {
  const params: unknown[] = [mode]
  const MODE = '$1'

  // The first tuple carries explicit casts so Postgres can infer column types
  // for the whole VALUES list; later tuples inherit them.
  const tuples = rows.map((row, rowIndex) => {
    const placeholders = UPSERT_COLUMNS.map((col) => {
      const value =
        col.name === 'data_source'
          ? dataSource
          : col.name === 'source_file'
            ? (row.source_file ?? sourceFile ?? null)
            : col.name === 'form_type'
              ? (row.form_type ?? '990')
              : (row[col.name] ?? null)
      params.push(value)
      const p = `$${params.length}`
      const pgType = col.type === 'int' ? 'integer' : col.type
      return rowIndex === 0 ? `${p}::${pgType}` : p
    })
    return `(${placeholders.join(',')})`
  })

  const colNames = UPSERT_COLUMNS.map((c) => c.name)
  const updatable = UPSERT_COLUMNS.filter((c) => !c.key)
  const filings = table('filings', opts)

  // A winning row sets each column to COALESCE(incoming, existing): it may add
  // information but never blank a value already there. A losing row leaves
  // every column exactly as it was.
  const wins = incomingWinsSql('EXCLUDED', filings, MODE)
  const setClause = updatable
    .map(
      (c) =>
        `${c.name} = CASE WHEN ${wins} THEN COALESCE(EXCLUDED.${c.name}, ${filings}.${c.name}) ELSE ${filings}.${c.name} END`,
    )
    .join(',\n        ')

  // Same predicate over the CTE aliases instead of EXCLUDED/filings.
  const winsAudit = incomingWinsSql('i', 'p', MODE)
  const action = auditActionSql('i', 'p', MODE)
  const loser = (col: string) => `CASE WHEN ${winsAudit} THEN p.${col} ELSE i.${col} END`
  const winner = (col: string) => `CASE WHEN ${winsAudit} THEN i.${col} ELSE p.${col} END`

  const sql = `
    WITH incoming (${colNames.join(', ')}) AS (
      VALUES ${tuples.join(', ')}
    ),
    prior AS (
      SELECT f.ein, f.tax_period, f.form_type, f.data_source, f.object_id, f.submission_date
      FROM ${filings} f
      JOIN incoming i ON f.ein = i.ein AND f.tax_period = i.tax_period
    ),
    upserted AS (
      INSERT INTO ${filings} (${colNames.join(', ')})
      SELECT ${colNames.join(', ')} FROM incoming
      ON CONFLICT (ein, tax_period) DO UPDATE SET
        ${setClause}
      RETURNING 1
    )
    INSERT INTO ${table('ingest_audit', opts)} (
      ein, tax_period, form_type, action,
      losing_source, losing_object_id, losing_submission_date,
      winning_source, winning_object_id, winning_submission_date,
      source_file
    )
    SELECT
      p.ein, p.tax_period, COALESCE(i.form_type, p.form_type),
      ${action} AS action,
      ${loser('data_source')},
      ${loser('object_id')},
      ${loser('submission_date')},
      ${winner('data_source')},
      ${winner('object_id')},
      ${winner('submission_date')},
      i.source_file
    FROM prior p
    JOIN incoming i ON i.ein = p.ein AND i.tax_period = p.tax_period
    RETURNING action
  `

  return { sql, params }
}

/** Which of the supplied keys already exist, and where each row came from. */
export function buildPreflightQuery(
  keys: { ein: string; tax_period: string }[],
  opts?: BuildOptions,
): BuiltQuery {
  const params: unknown[] = []
  const tuples = keys.map((k, i) => {
    params.push(k.ein, k.tax_period)
    const a = `$${params.length - 1}`
    const b = `$${params.length}`
    return i === 0 ? `(${a}::text, ${b}::date)` : `(${a}, ${b})`
  })

  return {
    sql: `WITH wanted (ein, tax_period) AS (VALUES ${tuples.join(', ')})
          SELECT f.ein,
                 to_char(f.tax_period, 'YYYY-MM-DD') AS tax_period,
                 f.data_source,
                 f.source_file,
                 f.form_type,
                 to_char(f.submission_date, 'YYYY-MM-DD') AS submission_date
          FROM ${table('filings', opts)} f
          JOIN wanted w ON f.ein = w.ein AND f.tax_period = w.tax_period`,
    params,
  }
}
