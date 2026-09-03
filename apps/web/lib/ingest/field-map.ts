export type FileFormat = 'dat' | 'csv'

export interface MappedRow {
  ein: string
  tax_period: string
  fiscal_year: number
  total_revenue: number | null
  total_expenses: number | null
  total_assets: number | null
  total_liabilities: number | null
  total_net_assets: number | null
  contributions: number | null
  program_revenue: number | null
  investment_income: number | null
  other_revenue: number | null
  program_expenses: number | null
  ga_expenses: number | null
  fundraising_expenses: number | null
  cash_equiv: number | null
  st_investments: number | null
  lt_investments: number | null
  ppe: number | null
  unrestr_net_assets: number | null
  restr_net_assets: number | null
  source_file: string
}

export function detectFormat(filename: string): FileFormat {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.dat')) return 'dat'
  return 'csv'
}

/**
 * Canonicalise a source header name: strip a UTF-8 BOM, trim, lowercase.
 *
 * The IRS extracts are not internally consistent about case or naming —
 * 24eoextract990.csv leads with `efile,EIN,tax_pd,...` while the older files
 * use `elf` and a lowercase `ein`. Pass this to PapaParse's `transformHeader`
 * so every row arrives with predictable keys. `scripts/ingest.py` has always
 * done the equivalent, which is why the Python path loaded these files
 * correctly while the browser uploader silently filtered every row.
 */
export function canonicalHeader(header: string): string {
  return header.replace(/^\uFEFF/, '').trim().toLowerCase()
}

/**
 * Whether a row is a full Form 990 e-filed return.
 *
 * The e-file indicator is spelled `efile` in the CSV-era extracts (18eo–24eo)
 * and `elf` in the older ones; `e-file` also appears. Checking only one of them
 * filters out the entire file.
 */
export function isForm990Row(row: Record<string, string>, format: FileFormat): boolean {
  if (format === 'dat') return true
  const indicator = row['elf'] ?? row['efile'] ?? row['e-file']
  return indicator?.trim().toUpperCase() === 'E'
}

export function normalizeEin(raw: string): string {
  const digits = raw.replace(/\D/g, '').padStart(9, '0')
  return `${digits.slice(0, 2)}-${digits.slice(2)}`
}

export function taxPeriodToDate(raw: string): string | null {
  if (!raw || raw.length < 6) return null
  const str = raw.trim()
  const year = parseInt(str.slice(0, 4), 10)
  const month = parseInt(str.slice(4, 6), 10)
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null
  const n = parseInt(raw.trim(), 10)
  return isNaN(n) ? null : n
}

export function mapRow(
  row: Record<string, string>,
  format: FileFormat,
  sourceFile: string,
): MappedRow | null {
  const rawEin = row['ein']
  if (!rawEin || rawEin.trim() === '') return null
  const ein = normalizeEin(rawEin)

  const rawTaxPd = row['tax_pd'] ?? row['tax_prd'] ?? ''
  const tax_period = taxPeriodToDate(rawTaxPd)
  if (!tax_period) return null

  const fiscal_year = parseInt(tax_period.slice(0, 4), 10)

  if (format === 'dat') {
    const total_revenue = parseNumber(row['totrevenue'])
    const total_expenses = parseNumber(row['totfuncexpns'])
    const total_assets = parseNumber(row['totassetsend'])
    const total_liabilities = parseNumber(row['totliabend'])
    const total_net_assets = parseNumber(row['totnetassetend'])
    const contributions = parseNumber(row['totcntrbgfts'])
    const program_revenue = parseNumber(row['totprgmrevnue'])
    const investment_income = parseNumber(row['invstmntinc'])
    const program_expenses = parseNumber(row['totprgmrvnueexpns'])
    const ga_expenses = parseNumber(row['totgeneralexpns'])
    const fundraising_expenses = parseNumber(row['totfundrsng'])
    const cash_equiv = parseNumber(row['cashnonsaved'])
    const st_investments = parseNumber(row['svngstempinvst'])
    const invstpublic = parseNumber(row['invstmntspublicly'])
    const invstother = parseNumber(row['invstmntsothrsec'])
    const lt_investments =
      invstpublic !== null || invstother !== null
        ? (invstpublic ?? 0) + (invstother ?? 0)
        : null
    const ppe = parseNumber(row['lndbldgsequip'])
    const unrestr_net_assets = parseNumber(row['unrstrctdnetasstsend'])
    const tempr = parseNumber(row['temprstrctdnetasstsend'])
    const permr = parseNumber(row['permrstrctdnetasstsend'])
    const restr_net_assets =
      tempr !== null || permr !== null ? (tempr ?? 0) + (permr ?? 0) : null

    const other_revenue =
      total_revenue !== null
        ? total_revenue -
          (contributions ?? 0) -
          (program_revenue ?? 0) -
          (investment_income ?? 0)
        : null

    return {
      ein,
      tax_period,
      fiscal_year,
      total_revenue,
      total_expenses,
      total_assets,
      total_liabilities,
      total_net_assets,
      contributions,
      program_revenue,
      investment_income,
      other_revenue,
      program_expenses,
      ga_expenses,
      fundraising_expenses,
      cash_equiv,
      st_investments,
      lt_investments,
      ppe,
      unrestr_net_assets,
      restr_net_assets,
      source_file: sourceFile,
    }
  }

  // csv format
  const total_revenue = parseNumber(row['totrevenue'])
  const total_expenses = parseNumber(row['totfuncexpns'])
  const total_assets = parseNumber(row['totassetsend'])
  const total_liabilities = parseNumber(row['totliabend'])
  const total_net_assets =
    parseNumber(row['totnetassetend']) ?? parseNumber(row['totnetasstsend'])
  const contributions = parseNumber(row['totcntrbgfts'])
  const program_revenue = parseNumber(row['totprgmrevnue'])
  const investment_income = parseNumber(row['invstmntinc'])
  const program_expenses = parseNumber(row['totprgmrvnueexpns'])
  const ga_expenses = parseNumber(row['totgeneralexpns'])
  const fundraising_expenses = parseNumber(row['totfundrsng'])
  const cash_equiv = parseNumber(row['nonintcashend'])
  const st_investments = parseNumber(row['svngstempinvend'])
  const invstend = parseNumber(row['invstmntsend'])
  const invstothrend = parseNumber(row['invstmntsothrend'])
  const lt_investments =
    invstend !== null || invstothrend !== null
      ? (invstend ?? 0) + (invstothrend ?? 0)
      : null
  const ppe = parseNumber(row['lndbldgsequipend'])
  const unrestr_net_assets = parseNumber(row['unrstrctnetasstsend'])
  const tempr = parseNumber(row['temprstrctnetasstsend'])
  const permr = parseNumber(row['permrstrctnetasstsend'])
  const restr_net_assets =
    tempr !== null || permr !== null ? (tempr ?? 0) + (permr ?? 0) : null

  const other_revenue =
    total_revenue !== null
      ? total_revenue -
        (contributions ?? 0) -
        (program_revenue ?? 0) -
        (investment_income ?? 0)
      : null

  return {
    ein,
    tax_period,
    fiscal_year,
    total_revenue,
    total_expenses,
    total_assets,
    total_liabilities,
    total_net_assets,
    contributions,
    program_revenue,
    investment_income,
    other_revenue,
    program_expenses,
    ga_expenses,
    fundraising_expenses,
    cash_equiv,
    st_investments,
    lt_investments,
    ppe,
    unrestr_net_assets,
    restr_net_assets,
    source_file: sourceFile,
  }
}
