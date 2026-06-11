# Westridge 990 Research App

## Stack
- **Frontend/API**: Next.js (App Router) in `apps/web/`
- **Database**: Neon Postgres (serverless) — connection string in `apps/web/.env.local`
- **Ingestion**: Python scripts in `scripts/` (psycopg2, execute_values for bulk upserts)
- **Deploy**: Vercel — push to `main` triggers deploy; `rootDirectory` is set to `apps/web` in Vercel project settings (not in `vercel.json`)

## Testing

**Always run tests before calling a change done.**

The API smoke test suite is at `scripts/test-api.mjs`. It covers default load, search, sorting, filters, and pagination against a running dev server.

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
