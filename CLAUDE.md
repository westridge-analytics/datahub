# Westridge 990 Research App

## Stack
- **Frontend/API**: Next.js (App Router) in `apps/web/`
- **Database**: Neon Postgres (serverless) — connection string in `apps/web/.env.local`
- **Ingestion**: Python scripts in `scripts/` (psycopg2, execute_values for bulk upserts)
- **Deploy**: Vercel — push to `main` triggers deploy; `rootDirectory` is set to `apps/web` in Vercel project settings (not in `vercel.json`)

## Testing

**Always run tests before calling a change done.**

The API smoke test suite is at `scripts/test-api.mjs`. It covers default load, search, sorting, filters, and pagination against a running dev server.

Ingestion conflict/precedence tests are at `apps/web/lib/ingest/conflict.test.ts` and run under
`npm run test:unit`. They execute the real production upsert SQL against a throwaway `ingest_test`
schema they create and drop, so they need `DATABASE_URL` but never touch the `filings` table.

```bash
# Requires dev server already running on :3000
cd apps/web && npm test

# Or: starts dev server, runs tests, shuts it down
cd apps/web && npm run test:ci
```

### When to add tests
Any time you fix a bug or add a feature that touches the API, add at least one test case in `scripts/test-api.mjs` that would have caught the bug. Specifically:
- New query path → test it returns rows (not 500, not 0)
- New filter/param → test the filter actually filters
- Performance fix → test row count and structure are still correct
- Data change (new ingestion) → test an org that should now be findable

### Test structure
Tests use Node's built-in `node:test` runner — no install needed. Each `describe` block covers one feature area. Add new `test()` calls inside the relevant block, or add a new `describe` for new features.

## Key architectural decisions

### Three query paths in `/api/filings`
- **Path A (search active)**: FTS via `websearch_to_tsquery` on `organizations.name_vec` resolves matching EINs first, then joins filings. Fast because name search hits a GIN index on 1M orgs, not a 6M-row filings scan.
- **Path B (no filters, no search)**: Materialized CTE sorts filings by index first, then joins orgs. Avoids full hash join on cold load.
- **Path C (state/sector filters)**: Standard join with WHERE.

### Search params isolation
The search path uses a separate `searchParams` array (`[query, %query%]`) passed to both the data and count queries. Never merge search params into the shared `params` array — Postgres rejects queries when param count doesn't match placeholders.

### Request gating lives in `proxy.ts`, not `middleware.ts`
Next 16 deprecated the `middleware` file convention and renamed it to `proxy` — same
NextRequest/NextResponse API, same matcher semantics. `apps/web/proxy.ts` wraps next-auth's `auth()`
as a default export (the convention accepts that; no function rename needed). Do not recreate
`middleware.ts` — both would be a conflict, and the old name is on a deprecation path.

Under the proxy convention Next buffers each request body in memory so it can be read both in
`proxy.ts` and the route handler, capped at 10MB by default
(`experimental.proxyClientMaxBodySize`). **Over-cap bodies are silently truncated, not rejected.**
The ingestion batches are the only large bodies here: 0.63MB per 1,000 rows today, ~2.3MB once the
e-file field map lands. Raise the config before raising `MAX_ROWS` much beyond that.

### IRS extract headers are not internally consistent
Canonicalise every source header (`canonicalHeader`: strip BOM, trim, lowercase) before mapping.
`24eoextract990.csv` leads with `efile,EIN,tax_pd,...`; the older extracts use `elf` and a
lowercase `ein`. The e-file indicator appears as `efile`, `elf`, or `e-file` — check all three.

This bit once: the browser uploader looked only for `row['elf']` and `row['ein']`, so every row of
the CSV-era extracts failed `isForm990Row` and the uploader silently loaded nothing. `ingest.py`
had always normalised keys, which is why the Python path worked and masked it. Covered now by
`lib/ingest/field-map.test.ts`, whose fixtures use the real header spellings.

**The browser uploader refuses .dat files by design** (`unsupportedReason` in `field-map.ts`),
showing a message that points at `scripts/ingest.py`. It never parsed them correctly: they are
space-delimited, and PapaParse only guesses among `,` `\t` `|` `;` and two control chars — never
space — so the header collapsed to a single column and every row was filtered. Rather than fix a
parser for a dead format, the screen now declines it: all 17 .dat files are already loaded
(3,444,075 rows, FY1976–2017) and the IRS switched to CSV at `18eoextract990.csv`, so no new .dat
will ever be published. If .dat parsing is ever genuinely needed, pass `delimiter: ' '` for that
format — `mapRow` already has a correct dat branch and already handles `tax_prd` vs `tax_pd`.

### Organization names come from the BMF, never from a filing load
`organizations.name` is `NOT NULL`, and the SOI extracts carry **no name column at all** — only the
EO BMF does. So `buildOrganizationsUpsert` returns `null` when no incoming row has a name, and the
batch route skips the write entirely. Sending an explicit `NULL` fails the whole batch; that broke
all 684 batches of a 341,514-row load the first time the uploader parsed rows successfully.

`filings.ein` is a foreign key, so a filing for an EIN with no organization row cannot be stored —
and cannot be conjured either, with no name available. Those rows are **skipped and reported**
(`skipped_unknown_ein`, plus a sample of EINs), not silently dropped and not failed. About 1% of
`24eoextract990.csv` (3,354 of 323,449 EINs); the remedy is loading a current BMF. A nameless
placeholder org would be unsearchable and render blank in the table, which is worse than a
reported skip.

### Ingestion sources and conflict resolution
`filings.data_source` distinguishes `'soi_extract'` (IRS SOI annual extracts — authoritative,
lagging) from `'efile_xml'` (monthly e-file archives — near-real-time, raw as filed). All rows
loaded before 2026-08 are `soi_extract`.

`/api/ingest/batch` accepts `data_source` and `on_conflict` ('skip' | 'overwrite'):
- **SOI outranks e-file**, applied *field by field* — a winning row uses
  `COALESCE(incoming, existing)`, so a load can add information but never blank a populated value.
- **e-file over e-file is a resubmission, not a conflict** — the later `submission_date` wins
  automatically, regardless of `on_conflict`. ~0.5–0.7% of keys.
- Every conflict resolution is logged to `ingest_audit` ('skipped' | 'overwritten' | 'superseded').

The write path is generated from one list in `lib/ingest/upsert-sql.ts` — add a column there, not
in four places in a SQL string. All of it is pure (no DB handle, no `@/` alias) so tests can run
the real production SQL against a scratch schema.

`/api/ingest/preflight` reports which `(ein, tax_period)` keys already exist and from which source,
so the uploader can show the operator what a load will collide with before writing anything. The
uploader makes two passes over the file: keys only for the conflict check, then the real load.

**Do not** reintroduce an unconditional `ON CONFLICT DO UPDATE` here. That was the original
behaviour and it meant re-uploading an older extract silently overwrote newer data.

### Migrations
Run with `python scripts/run_migration.py <filename>` (defaults to `migrate_expand_filings.sql`):
- `migrate_expand_filings.sql` — research-grade columns; also creates `filings_raw` (now dropped)
- `migrate_efile_provenance.sql` — provenance columns + `ingest_audit`. Additive, idempotent.
- `migrate_drop_filings_raw.sql` — **destructive**; dropped the 10 GB `filings_raw` table, which
  nothing in `apps/web` ever read. `ingest.py --with-raw` (off by default) is the only writer.

### BMF data
The IRS EO BMF is split across 4 regional files. All four (eo1–eo4) are loaded into the `organizations` table (~1M orgs). The `name_vec` column is a generated `tsvector` for full-text search. If you re-ingest orgs, the column populates automatically.

## Common commands

```bash
# Dev server
cd apps/web && npm run dev

# Run tests (dev server must be running)
cd apps/web && npm test

# Ingest a specific filing file
cd datahub && python scripts/ingest.py --files docs/990_data/file_data/24eoextract990.csv

# Ingest a BMF file
python scripts/ingest.py --eobmf docs/990_data/file_data/eo2.csv
```
