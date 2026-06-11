import { type NextRequest } from 'next/server'
import { rawQuery } from '@/lib/db'

const ALLOWED: Record<string, { table: string; col: string }> = {
  state:           { table: 'organizations', col: 'state' },
  form_type:       { table: 'filings',       col: 'form_type' },
  filing_method:   { table: 'filings',       col: 'filing_method' },
  subsection_code: { table: 'filings',       col: 'subsection_code' },
}

export async function GET(request: NextRequest) {
  const col = request.nextUrl.searchParams.get('column') ?? ''
  if (!(col in ALLOWED)) {
    return Response.json({ error: 'Invalid column' }, { status: 400 })
  }
  const { table, col: colName } = ALLOWED[col]
  const rows = await rawQuery(
    `SELECT DISTINCT ${colName} AS value FROM ${table}
     WHERE ${colName} IS NOT NULL AND ${colName} != ''
     ORDER BY 1 LIMIT 300`,
    []
  )
  return Response.json({ values: (rows as { value: string }[]).map(r => r.value) })
}
