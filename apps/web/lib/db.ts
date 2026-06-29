import { neon, types, type NeonQueryFunction } from '@neondatabase/serverless'

// Neon (like node-postgres) returns BIGINT/int8 as strings to preserve precision
// beyond 2^53. All 990 financial values fit comfortably in a JS number, and
// returning strings caused silent bugs (`number + "205730"` concatenated, charts
// couldn't plot). Parse int8 as Number globally so every query path is safe.
// int8 OID = 20. COUNT(*) also returns int8 and is parsed here too.
types.setTypeParser(types.builtins.INT8, (val: string | null) =>
  val === null ? null : Number(val),
)

// sql is a tagged template function; resolved lazily so the module is safe to import at build time.
export function getSql(): NeonQueryFunction<false, false> {
  return neon(process.env.DATABASE_URL!)
}

export const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  getSql()(strings, ...values)

/**
 * Typed query helper. Wraps the neon sql tag and returns rows as T[].
 * Usage: const rows = await query<MyType>`SELECT * FROM my_table WHERE id = ${id}`
 */
export async function query<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const rows = await getSql()(strings, ...values)
  return rows as T[]
}

// For dynamic queries built as strings with $N placeholders.
export async function rawQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await getSql().query(text, params as Parameters<NeonQueryFunction<false,false>['query']>[1])
  return rows as T[]
}
