/**
 * Format a dollar value for display.
 * compact=false → $1,234,567
 * compact=true  → $1.2M / $500K / $1,234
 */
export function formatCurrency(value: number | null, compact = false): string {
  if (value === null || value === undefined) return '—'

  if (!compact) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs >= 1_000_000) {
    const n = abs / 1_000_000
    const decimals = n >= 100 ? 0 : n >= 10 ? 1 : 1
    return `${sign}$${n.toFixed(decimals)}M`
  }
  if (abs >= 1_000) {
    const n = abs / 1_000
    const decimals = n >= 100 ? 0 : 1
    return `${sign}$${n.toFixed(decimals)}K`
  }
  return `${sign}$${abs.toLocaleString('en-US')}`
}

/**
 * Ensure EIN is formatted as XX-XXXXXXX.
 * Strips non-digits and inserts the hyphen after the second digit.
 */
export function formatEIN(ein: string): string {
  const digits = ein.replace(/\D/g, '')
  if (digits.length !== 9) return ein
  return `${digits.slice(0, 2)}-${digits.slice(2)}`
}

/**
 * Convert a tax_period string (YYYY-MM-01 or YYYY-MM-DD) to a fiscal year label.
 * Uses the year from the date directly.
 */
export function formatYear(taxPeriod: string): string {
  if (!taxPeriod) return '—'
  const year = taxPeriod.slice(0, 4)
  if (!/^\d{4}$/.test(year)) return taxPeriod
  return `FY ${year}`
}

/**
 * Format a decimal ratio as a percentage string.
 * 0.123 → '12.3%'
 * null  → '—'
 */
export function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return `${(value * 100).toFixed(1)}%`
}
