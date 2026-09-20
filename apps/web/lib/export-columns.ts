import { ALL_COLUMN_KEYS, COLUMN_LABELS } from './table-columns.ts'

/**
 * Turns the Main Data table's visible-column list into the SELECT list and
 * header row for /api/export.
 *
 * The export used to carry a hard-coded eleven columns, so every column added
 * through the picker (revenue components, compensation, governance flags …)
 * was on screen but absent from the download. Everything here is derived from
 * the same catalogue the picker renders, so that cannot drift again: a column
 * the table can show is a column the export can write.
 *
 * Pure — no DB handle, no `@/` alias — so it runs under `node --test`.
 */

export type ExportColumnKind = 'text' | 'number' | 'boolean'

export interface ExportColumn {
  key: string
  label: string
  /** SQL expression, already aliased to `key`. Never built from user input. */
  select: string
  kind: ExportColumnKind
}

/** Columns that live on `organizations`, not `filings`. */
const ORG_COLUMNS: Record<string, string> = {
  name: 'o.name',
  state: 'o.state',
  sector: 'o.sector',
  ntee_code: 'o.ntee_code',
}

/** Same CASE ladder /api/filings uses to label an NTEE letter. */
const NTEE_CATEGORY_SQL = `
  CASE LEFT(o.ntee_code, 1)
    WHEN 'A' THEN 'Arts, Culture & Humanities'
    WHEN 'B' THEN 'Education'
    WHEN 'C' THEN 'Environment & Animals'
    WHEN 'D' THEN 'Environment & Animals'
    WHEN 'E' THEN 'Health'
    WHEN 'F' THEN 'Health'
    WHEN 'G' THEN 'Health'
    WHEN 'H' THEN 'Health'
    WHEN 'I' THEN 'Human Services'
    WHEN 'J' THEN 'Human Services'
    WHEN 'K' THEN 'Human Services'
    WHEN 'L' THEN 'Human Services'
    WHEN 'M' THEN 'Human Services'
    WHEN 'N' THEN 'Human Services'
    WHEN 'O' THEN 'Human Services'
    WHEN 'P' THEN 'Human Services'
    WHEN 'Q' THEN 'International & Foreign Affairs'
    WHEN 'R' THEN 'Public & Societal Benefit'
    WHEN 'S' THEN 'Public & Societal Benefit'
    WHEN 'T' THEN 'Public & Societal Benefit'
    WHEN 'U' THEN 'Public & Societal Benefit'
    WHEN 'V' THEN 'Public & Societal Benefit'
    WHEN 'W' THEN 'Public & Societal Benefit'
    WHEN 'X' THEN 'Religion'
    WHEN 'Y' THEN 'Mutual & Membership Benefit'
    ELSE 'Other'
  END`

/**
 * Cohort membership as full names. The table shows abbreviations with the full
 * name on hover; a spreadsheet has no hover, so the export spells them out.
 * cohortId is validated as an integer by the caller before it is inlined.
 */
function cohortNamesSql(cohortId: number | null): string {
  return cohortId !== null
    ? `(SELECT name FROM cohorts WHERE id = ${cohortId})`
    : `(SELECT string_agg(c.name, '; ' ORDER BY c.name)
          FROM cohort_members cm2
          JOIN cohorts c ON c.id = cm2.cohort_id
          WHERE cm2.ein = f.ein)`
}

const BOOLEAN_KEYS = new Set([
  'has_lobbying', 'has_political_activity', 'has_unrelated_business_income',
  'has_foreign_office', 'has_foreign_grants', 'operates_hospital',
  'operates_school', 'has_related_orgs',
])

const TEXT_KEYS = new Set([
  'ein', 'name', 'state', 'sector', 'ntee_code', 'ntee_category',
  'cohort_name', 'form_type', 'filing_method', 'subsection_code',
])

/**
 * The eleven columns the export carried before it learned about the picker.
 * Still the answer when no `cols` are given — the Institution page's export
 * link relies on it.
 */
export const LEGACY_EXPORT_COLUMNS = [
  'ein', 'name', 'state', 'sector', 'cohort_name',
  'fiscal_year', 'total_revenue', 'total_expenses', 'net_income',
  'total_assets', 'total_net_assets',
]

function kindOf(key: string): ExportColumnKind {
  if (BOOLEAN_KEYS.has(key)) return 'boolean'
  if (TEXT_KEYS.has(key)) return 'text'
  return 'number'
}

function selectFor(key: string, cohortId: number | null): string {
  if (key === 'net_income') return '(f.total_revenue - f.total_expenses)'
  if (key === 'ntee_category') return NTEE_CATEGORY_SQL
  if (key === 'cohort_name') return cohortNamesSql(cohortId)
  if (key in ORG_COLUMNS) return ORG_COLUMNS[key]
  return `f.${key}`
}

/**
 * Resolves the `cols` query parameter into export columns.
 *
 * Unknown keys are ignored rather than rejected: a stale bookmark naming a
 * column that has since been renamed should still download the rest, not 400.
 * Order follows the table's own left-to-right order, not the order in the URL.
 */
export function resolveExportColumns(
  colsParam: string | null,
  cohortId: number | null = null,
): ExportColumn[] {
  const requested = colsParam
    ? colsParam.split(',').map(c => c.trim()).filter(Boolean)
    : LEGACY_EXPORT_COLUMNS

  const wanted = new Set(requested.filter(key => key in COLUMN_LABELS))
  const ordered = ALL_COLUMN_KEYS.filter(key => wanted.has(key))
  const keys = ordered.length > 0 ? ordered : LEGACY_EXPORT_COLUMNS

  return keys.map(key => ({
    key,
    label: COLUMN_LABELS[key],
    select: `${selectFor(key, cohortId)} AS ${key}`,
    kind: kindOf(key),
  }))
}

/** Builds the SELECT list for a resolved column set. */
export function buildSelectList(columns: ExportColumn[]): string {
  return columns.map(c => c.select).join(',\n        ')
}

/**
 * One cell's value for CSV/XLSX. Numbers stay numbers so a spreadsheet can sum
 * them; booleans become Yes/No, matching what the table shows; null is blank
 * rather than the table's em dash, which would poison a numeric column.
 */
export function exportCell(column: ExportColumn, row: Record<string, unknown>): string | number {
  const value = row[column.key]
  if (value === null || value === undefined) return ''
  if (column.kind === 'boolean') return value ? 'Yes' : 'No'
  if (column.kind === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : String(value)
  }
  return String(value)
}
