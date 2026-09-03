/**
 * Maps an IRS e-file XML return onto `filings` columns, driven by
 * efile-concordance.json.
 *
 * Takes a parsed `Document` rather than a string, so production can use the
 * browser's native DOMParser — which matters, because Phase 4 streams ~2.7 GB
 * of XML out of the largest archive — while tests inject a spec-compliant
 * parser and exercise this exact code.
 *
 * No `@/` alias and no DOM globals at module scope, so `node --test` can import
 * it directly.
 */

import concordance from './efile-concordance.json' with { type: 'json' }

export interface EfileRow {
  // identity — must match the SOI path's key format exactly or conflict
  // detection silently stops matching existing rows
  ein: string
  tax_period: string
  fiscal_year: number
  form_type: string

  // organization detail the SOI extracts do not carry
  name: string | null
  state: string | null

  // provenance
  data_source: 'efile_xml'
  object_id: string | null
  dln: string | null
  submission_date: string | null
  is_amended: boolean
  source_file: string

  // financials — every concordance column, null when the filer left it empty
  [column: string]: string | number | boolean | null
}

export type EfileSkipReason =
  | 'unsupported_form'
  | 'missing_ein'
  | 'bad_tax_period'
  | 'malformed'

export type EfileMapResult =
  | { ok: true; row: EfileRow }
  | { ok: false; reason: EfileSkipReason; returnType: string | null }

export const SUPPORTED_FORMS = Object.keys(concordance.forms)

/**
 * Strip a leading UTF-8 BOM before parsing.
 *
 * Not optional: 1,997 of the first 2,000 entries in 2026_TEOS_XML_01A.zip begin
 * with one, and a BOM ahead of the `<?xml?>` declaration makes a strict parser
 * reject the document outright ("xml declaration is only allowed at the start
 * of the document"). Browsers are more forgiving, which is exactly why this
 * needs to be explicit — otherwise it works in the uploader and fails anywhere
 * stricter. A few entries have no BOM, so the strip is conditional.
 */
export function stripXmlBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// ── path resolution ─────────────────────────────────────────────────────────

/**
 * First *direct child* element with this local name.
 *
 * Deliberately not getElementsByTagName: several element names recur at
 * different depths (OtherRevenueMiscGrp, OtherExpensesGrp), and a descendant
 * search would happily return one from the wrong part of the return.
 */
function childByName(parent: Element, name: string): Element | null {
  const kids = parent.childNodes
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i]
    if (n.nodeType === 1 && (n as Element).localName === name) return n as Element
  }
  return null
}

/** Resolve a '/'-separated concordance path to trimmed text, or null. */
export function readPath(root: Element | null, path: string): string | null {
  let node: Element | null = root
  for (const seg of path.split('/')) {
    if (node === null) return null
    node = childByName(node, seg)
  }
  const text = node?.textContent?.trim()
  return text ? text : null
}

/** Whether an element exists at this path (for presence-only flags). */
export function pathExists(root: Element | null, path: string): boolean {
  let node: Element | null = root
  for (const seg of path.split('/')) {
    if (node === null) return false
    node = childByName(node, seg)
  }
  return node !== null
}

// ── value coercion ──────────────────────────────────────────────────────────

/** IRS amounts are whole dollars and may be negative. Blank stays null. */
export function parseAmount(raw: string | null): number | null {
  if (raw === null || raw === '') return null
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? null : n
}

export function normalizeEfileEin(raw: string): string {
  const digits = raw.replace(/\D/g, '').padStart(9, '0')
  return `${digits.slice(0, 2)}-${digits.slice(2)}`
}

/**
 * TaxPeriodEndDt is a full date (2024-12-31); `filings.tax_period` stores the
 * first of that month, exactly as the SOI path converts YYYYMM. Getting this
 * wrong would not error — it would quietly stop matching existing rows, so
 * every e-file row would look new and the conflict check would report nothing.
 */
export function taxPeriodFromEndDate(raw: string | null): string | null {
  if (!raw) return null
  const m = /^(\d{4})-(\d{2})/.exec(raw.trim())
  if (!m) return null
  const month = Number.parseInt(m[2], 10)
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}-01`
}

/** ReturnTs is an ISO timestamp; submission_date is a DATE column. */
export function submissionDateFromTs(raw: string | null): string | null {
  if (!raw) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim())
  return m ? m[1] : null
}

// ── the mapper ──────────────────────────────────────────────────────────────

export interface MapOptions {
  sourceFile: string
  /** From the archive entry name; the XML itself does not carry it. */
  objectId?: string | null
  /** From the archive's index CSV, which the uploader already downloads. */
  dln?: string | null
}

export function mapEfileReturn(doc: Document, opts: MapOptions): EfileMapResult {
  const root = doc.documentElement
  if (!root || root.localName !== 'Return') {
    return { ok: false, reason: 'malformed', returnType: null }
  }

  const h = concordance.header
  const returnType = readPath(root, h.return_type)

  const form = returnType
    ? (concordance.forms as Record<string, FormSpec | undefined>)[returnType]
    : undefined
  if (!form) {
    // 990-T lands here. Excluded by decision: it reports unrelated business
    // income only, and 87% of them share an (ein, tax_period) key with the
    // organisation's real 990, which they would overwrite.
    return { ok: false, reason: 'unsupported_form', returnType }
  }

  const rawEin = readPath(root, h.ein)
  if (!rawEin) return { ok: false, reason: 'missing_ein', returnType }

  const taxPeriod = taxPeriodFromEndDate(readPath(root, h.tax_period_end))
  if (!taxPeriod) return { ok: false, reason: 'bad_tax_period', returnType }

  const formRoot = resolveElement(root, form.root)

  const row: EfileRow = {
    ein: normalizeEfileEin(rawEin),
    tax_period: taxPeriod,
    fiscal_year: Number.parseInt(taxPeriod.slice(0, 4), 10),
    form_type: returnType!,
    name: readPath(root, h.name),
    state: readPath(root, h.state),
    data_source: 'efile_xml',
    object_id: opts.objectId ?? null,
    dln: opts.dln ?? null,
    submission_date: submissionDateFromTs(readPath(root, h.submission_ts)),
    is_amended: pathExists(formRoot, form.amended_flag),
    source_file: opts.sourceFile,
  }

  for (const [column, path] of Object.entries(form.columns)) {
    row[column] = parseAmount(readPath(formRoot, path))
  }

  applyDerived(row, returnType!)
  return { ok: true, row }
}

interface FormSpec {
  root: string
  amended_flag: string
  columns: Record<string, string>
}

function resolveElement(root: Element, path: string): Element | null {
  let node: Element | null = root
  for (const seg of path.split('/')) {
    if (node === null) return null
    node = childByName(node, seg)
  }
  return node
}

/**
 * Derived columns, per the concordance's `derived` block. Kept declarative
 * there so scripts/ingest.py applies the same rules by the same names.
 */
function applyDerived(row: EfileRow, formType: string): void {
  for (const rule of concordance.derived) {
    if (!rule.applies_to.includes(formType)) continue
    if (rule.rule === 'revenue_residual') {
      const total = row.total_revenue
      if (typeof total !== 'number') {
        row[rule.column] = null
        continue
      }
      const num = (v: unknown) => (typeof v === 'number' ? v : 0)
      row[rule.column] =
        total - num(row.contributions) - num(row.program_revenue) - num(row.investment_income)
    }
  }
}

/** The archive names each entry `{OBJECT_ID}_public.xml`. */
export function objectIdFromEntryName(entry: string): string | null {
  const m = /([0-9]{12,})_public\.xml$/.exec(entry)
  return m ? m[1] : null
}
