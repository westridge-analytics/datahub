/**
 * Labels for an organisation's filings when a fiscal year can hold more than one return.
 *
 * An organisation that changes its fiscal year end files a short-period return: 38-3088234 moved
 * from a September to a December year end and filed Sep 2024 (twelve months) and Dec 2024 (three).
 * Both are real returns and both belong to FY2024, so "FY 2024" alone cannot tell them apart —
 * anything that keys or selects by fiscal year shows one and hides the other.
 *
 * Select by filing id; label with the period-end month wherever a fiscal year repeats.
 */

interface PeriodFiling {
  id: number
  fiscal_year: number
  tax_period: string | Date
}

export interface PeriodLabel {
  /** "FY 2024", or "FY 2024 · Dec" when FY2024 holds more than one return. */
  label: string
  /** Ends less than twelve months after the organisation's previous return. */
  shortYear: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// tax_period is always first-of-month; month arithmetic avoids any timezone reading of the day.
function yearMonth(p: string | Date): [number, number] {
  const iso = typeof p === 'string' ? p : p.toISOString()
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))]
}

export function sortByPeriod<T extends PeriodFiling>(filings: T[]): T[] {
  const key = (f: T) => { const [y, m] = yearMonth(f.tax_period); return y * 12 + m }
  return [...filings].sort((a, b) => key(a) - key(b) || a.id - b.id)
}

export function periodLabels(filings: PeriodFiling[]): Map<number, PeriodLabel> {
  const perYear = new Map<number, number>()
  for (const f of filings) perYear.set(f.fiscal_year, (perYear.get(f.fiscal_year) ?? 0) + 1)

  const out = new Map<number, PeriodLabel>()
  let prev: number | null = null
  for (const f of sortByPeriod(filings)) {
    const [y, m] = yearMonth(f.tax_period)
    const months = y * 12 + m
    const repeated = (perYear.get(f.fiscal_year) ?? 0) > 1
    out.set(f.id, {
      label: repeated ? `FY ${f.fiscal_year} · ${MONTHS[m - 1]}` : `FY ${f.fiscal_year}`,
      shortYear: prev !== null && months - prev < 12,
    })
    prev = months
  }
  return out
}
