/**
 * The same return stored twice under two different tax periods.
 *
 * The IRS extracts sometimes carry one return under two periods — a paper return keyed as 201512
 * in one year's extract and 201506 in the next, or an e-filer who resubmitted with a corrected
 * period. `(ein, tax_period)` is the upsert key, so both copies land as separate rows and the
 * institution page shows two "years" with identical figures.
 *
 * A pair is treated as one return when, for the same EIN and form, the headline figures are
 * identical and non-zero AND the periods are less than twelve months apart. The second condition
 * is what makes this safe: two periods that close cannot both be full-year returns, and a short
 * year reporting exactly the full year's revenue, expenses, assets, liabilities and net assets is
 * not a coincidence. Identical figures exactly twelve months apart are left alone — a dormant
 * organisation can genuinely report the same numbers two years running.
 *
 * Which copy survives, in order:
 *   1. soi_extract over efile_xml — the same precedence the upsert applies.
 *   2. Between e-file rows, the later submission_date — the IRS's own resubmission rule.
 *   3. Between SOI rows, the later extract — a later processing year reflects later correction.
 *   4. The period whose month matches the organisation's usual fiscal year end.
 *   5. The later period, then the higher id, so the choice is always deterministic.
 *
 * Losing rows are moved to `filings_duplicates` whole, with the id they duplicate, never simply
 * deleted — so the cleanup can be audited and reversed.
 *
 * Pure: no DB handle, no `@/` alias, so tests run this exact SQL against a scratch schema.
 */

export interface DuplicateOptions {
  schema?: string
}

const IDENT = /^[a-z_][a-z0-9_]*$/

function tables(opts: DuplicateOptions = {}) {
  const schema = opts.schema ?? 'public'
  if (!IDENT.test(schema)) throw new Error(`bad schema name: ${schema}`)
  return { filings: `${schema}.filings`, duplicates: `${schema}.filings_duplicates` }
}

// Publication year of an SOI extract, from its file name: py12_990.dat -> 2012,
// 16eofinextract990.dat -> 2016, 24eoextract990.csv -> 2024. Unknown names rank lowest.
const EXTRACT_YEAR = `COALESCE(substring(source_file from '^(?:py)?(\\d{2})')::int, 0)`

/**
 * One row per filing to remove: `drop_id` duplicates `keep_id`, the highest-ranked copy in its
 * group. A row is dropped only when a better-ranked copy exists within the window, so the top
 * copy of every group always survives.
 */
export function buildPeriodDuplicateQuery(opts: DuplicateOptions = {}): string {
  const { filings } = tables(opts)
  return `
WITH fye AS (
  SELECT ein, extract(month FROM tax_period)::int AS m, count(*) AS n
  FROM ${filings} GROUP BY 1, 2
),
cand AS (
  SELECT f.id, f.ein, f.form_type, f.tax_period, f.total_revenue, f.total_expenses,
         f.total_assets, f.total_liabilities, f.total_net_assets,
         ARRAY[
           CASE WHEN f.data_source = 'soi_extract' THEN 1 ELSE 0 END,
           CASE WHEN f.data_source = 'efile_xml'
                THEN COALESCE(f.submission_date - DATE '1970-01-01', 0) ELSE 0 END,
           CASE WHEN f.data_source = 'soi_extract' THEN ${EXTRACT_YEAR} ELSE 0 END,
           COALESCE(fye.n, 0)::int,
           (f.tax_period - DATE '1970-01-01'),
           f.id
         ] AS rank
  FROM ${filings} f
  LEFT JOIN fye ON fye.ein = f.ein AND fye.m = extract(month FROM f.tax_period)::int
  WHERE f.total_revenue <> 0 AND f.total_expenses <> 0 AND f.total_assets <> 0
)
SELECT DISTINCT ON (a.id) a.id AS drop_id, b.id AS keep_id
FROM cand a
JOIN cand b
  ON  b.ein = a.ein AND b.id <> a.id
  AND b.form_type IS NOT DISTINCT FROM a.form_type
  AND b.total_revenue = a.total_revenue
  AND b.total_expenses = a.total_expenses
  AND b.total_assets = a.total_assets
  AND b.total_liabilities IS NOT DISTINCT FROM a.total_liabilities
  AND b.total_net_assets IS NOT DISTINCT FROM a.total_net_assets
  AND b.tax_period > a.tax_period - interval '12 months'
  AND b.tax_period < a.tax_period + interval '12 months'
  AND b.rank > a.rank
ORDER BY a.id, b.rank DESC`
}

/**
 * Moves every duplicate into `filings_duplicates` and deletes it from `filings`, in one
 * statement, returning what moved. Re-running it finds nothing further to move.
 */
export function buildMoveDuplicatesSql(opts: DuplicateOptions = {}): string {
  const { filings, duplicates } = tables(opts)
  return `
WITH pairs AS (${buildPeriodDuplicateQuery(opts)}),
moved AS (
  DELETE FROM ${filings} f USING pairs p WHERE f.id = p.drop_id
  RETURNING f.*, p.keep_id
),
logged AS (
  INSERT INTO ${duplicates}
  SELECT m.*, now() FROM moved m
  RETURNING id
)
SELECT count(*)::int AS moved FROM logged`
}

/** The audit table: every filings column, plus the id each row duplicated and when it moved. */
export function buildDuplicatesTableSql(opts: DuplicateOptions = {}): string[] {
  const { filings, duplicates } = tables(opts)
  return [
    `CREATE TABLE IF NOT EXISTS ${duplicates} (LIKE ${filings})`,
    `ALTER TABLE ${duplicates} ADD COLUMN IF NOT EXISTS duplicate_of integer`,
    `ALTER TABLE ${duplicates} ADD COLUMN IF NOT EXISTS moved_at timestamptz`,
  ]
}
