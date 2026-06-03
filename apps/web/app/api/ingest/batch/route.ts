import { type NextRequest } from 'next/server'
import { rawQuery } from '@/lib/db'

interface IngestRow {
  ein: string
  name?: string
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

interface BatchRequestBody {
  rows: IngestRow[]
  source_file: string
}

export async function POST(request: NextRequest) {
  let body: BatchRequestBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { rows } = body

  if (!Array.isArray(rows)) {
    return Response.json({ error: '`rows` must be an array' }, { status: 400 })
  }

  if (rows.length === 0) {
    return Response.json({ processed: 0 })
  }

  if (rows.length > 1000) {
    return Response.json(
      { error: `Batch too large: ${rows.length} rows (max 1000)` },
      { status: 400 },
    )
  }

  try {
    // Step 1: upsert organizations (only sets name if org doesn't already have one)
    const orgsWithName = rows.filter((r) => r.name && r.name.trim() !== '')
    if (orgsWithName.length > 0) {
      const orgParams: unknown[] = []
      const orgValueClauses = orgsWithName.map((r) => {
        const base = orgParams.length
        orgParams.push(r.ein, r.name ?? null)
        return `($${base + 1}, $${base + 2})`
      })
      await rawQuery(
        `INSERT INTO organizations (ein, name)
         VALUES ${orgValueClauses.join(', ')}
         ON CONFLICT (ein) DO UPDATE
           SET name = EXCLUDED.name
           WHERE organizations.name IS NULL`,
        orgParams,
      )
    }

    // Also ensure rows without a name have an org row (no-op if exists)
    const orgsWithoutName = rows.filter((r) => !r.name || r.name.trim() === '')
    if (orgsWithoutName.length > 0) {
      const einParams: unknown[] = []
      const einValueClauses = orgsWithoutName.map((r) => {
        einParams.push(r.ein)
        return `($${einParams.length})`
      })
      await rawQuery(
        `INSERT INTO organizations (ein)
         VALUES ${einValueClauses.join(', ')}
         ON CONFLICT (ein) DO NOTHING`,
        einParams,
      )
    }

    // Step 2: bulk upsert filings
    const params: unknown[] = []
    const valueClauses = rows.map((r) => {
      const base = params.length
      params.push(
        r.ein,
        r.tax_period,
        r.fiscal_year,
        r.total_revenue,
        r.total_expenses,
        r.total_assets,
        r.total_liabilities,
        r.total_net_assets,
        r.contributions,
        r.program_revenue,
        r.investment_income,
        r.other_revenue,
        r.program_expenses,
        r.ga_expenses,
        r.fundraising_expenses,
        r.cash_equiv,
        r.st_investments,
        r.lt_investments,
        r.ppe,
        r.unrestr_net_assets,
        r.restr_net_assets,
        r.source_file,
      )
      const i = base + 1
      return (
        `($${i},$${i+1},$${i+2},$${i+3},$${i+4},$${i+5},$${i+6},$${i+7},` +
        `$${i+8},$${i+9},$${i+10},$${i+11},$${i+12},$${i+13},$${i+14},` +
        `$${i+15},$${i+16},$${i+17},$${i+18},$${i+19},$${i+20},$${i+21})`
      )
    })

    await rawQuery(
      `INSERT INTO filings (
        ein, tax_period, fiscal_year,
        total_revenue, total_expenses, total_assets, total_liabilities, total_net_assets,
        contributions, program_revenue, investment_income, other_revenue,
        program_expenses, ga_expenses, fundraising_expenses,
        cash_equiv, st_investments, lt_investments, ppe,
        unrestr_net_assets, restr_net_assets, source_file
      ) VALUES ${valueClauses.join(', ')}
      ON CONFLICT (ein, tax_period) DO UPDATE SET
        fiscal_year = EXCLUDED.fiscal_year,
        total_revenue = EXCLUDED.total_revenue,
        total_expenses = EXCLUDED.total_expenses,
        total_assets = EXCLUDED.total_assets,
        total_liabilities = EXCLUDED.total_liabilities,
        total_net_assets = EXCLUDED.total_net_assets,
        contributions = EXCLUDED.contributions,
        program_revenue = EXCLUDED.program_revenue,
        investment_income = EXCLUDED.investment_income,
        other_revenue = EXCLUDED.other_revenue,
        program_expenses = EXCLUDED.program_expenses,
        ga_expenses = EXCLUDED.ga_expenses,
        fundraising_expenses = EXCLUDED.fundraising_expenses,
        cash_equiv = EXCLUDED.cash_equiv,
        st_investments = EXCLUDED.st_investments,
        lt_investments = EXCLUDED.lt_investments,
        ppe = EXCLUDED.ppe,
        unrestr_net_assets = EXCLUDED.unrestr_net_assets,
        restr_net_assets = EXCLUDED.restr_net_assets,
        source_file = EXCLUDED.source_file`,
      params,
    )

    return Response.json({ processed: rows.length })
  } catch (err) {
    console.error('[POST /api/ingest/batch]', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
