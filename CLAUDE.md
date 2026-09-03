# Westridge 990 Research App

## Stack
- **Frontend/API**: Next.js (App Router) in `apps/web/`
- **Database**: Neon Postgres (serverless) — connection string in `apps/web/.env.local`
- **Ingestion**: Python scripts in `scripts/` (psycopg2, execute_values for bulk upserts)
- **Deploy**: Vercel — push to `main` triggers deploy; `rootDirectory` is set to `apps/web` in Vercel project settings (not in `vercel.json`)

## Testing

**Always run tests before calling a change done.**

The API smoke test suite is at `scripts/test-api.mjs`. It covers default load, search, sorting, filters, and pagination against a running dev server.

`scripts/test-sql-parity.mjs` (via `npm run test:parity`, and part of `npm test`) asserts the API
and the bulk CLI generate **identical** upsert SQL from the shared write contract. Precedence
decides what overwrites production data and the backfill runs through the CLI, so a divergence
there would mean the CLI applying rules nothing else tests.

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

### The e-file XML field map lives in one JSON file
`apps/web/lib/ingest/efile-concordance.json` maps `filings` columns to XML paths for 990, 990-EZ
and 990-PF. **Both readers consume it** — `lib/ingest/efile-map.ts` (browser) and, once Phase 7
lands, `scripts/ingest.py` — so a wrong path is fixed in one place. Add a column there, not in code.

Paths are `/`-separated element names in the `http://www.irs.gov/efile` namespace. Part I is flat
scalars (`CYTotalRevenueAmt`); Parts VIII–X report through `*Grp` containers holding `BOYAmt`/
`EOYAmt` pairs or a functional-expense split — hence paths, not bare tag names. Resolution follows
**direct children only**: names like `OtherRevenueMiscGrp` recur at several depths, so a descendant
search returns the wrong node.

Verified against `2026_TEOS_XML_01A.zip` (12,245 returns, 8 schema versions): no element is renamed
across versions, and 990 revenue components reconcile to `CYTotalRevenueAmt` in **7,180 of 7,180**
returns. Balance sheets reconcile in 99.99% of 990s, 98.9% of PF, 97.9% of EZ.

Two gotchas worth keeping:
- **1,997 of 2,000 archive entries begin with a UTF-8 BOM.** A BOM ahead of `<?xml?>` makes strict
  parsers reject the document; browsers tolerate it. Always `stripXmlBom` first.
- **`tax_period` must be first-of-month**, matching the SOI path's YYYYMM conversion. Getting this
  wrong does not error — it silently stops matching existing rows, so every e-file row looks new
  and the conflict check reports nothing.

The functional-expense split sums to the filer's own Part IX total in only 93.8% of 990s, while
Part IX total matches Part I total in 99.96%. That 6% is source data quality, not a mapping fault —
do not "fix" it.

`mapEfileReturn` returns a discriminated result, never a bare null: `unsupported_form` (990-T),
`missing_ein`, `bad_tax_period`, `malformed`, each with the return type, so the uploader can report
a breakdown instead of a silent zero.

### Five archives use Deflate64, and most tools cannot read them
`2025_05A`, `2025_05B`, `2025_11B`, `2026_05A`, `2026_05B` are compressed with **Deflate64**
(method 9) rather than deflate. They are also among the largest — 2026_05A alone holds 168,344
returns — so this is a large share of the data, not an edge case.

Python's `zipfile` implements only stored/deflate/bzip2/lzma and raises
`NotImplementedError: That compression method is not supported`. Info-ZIP `unzip` cannot read it
either. `scripts/efile_ingest.py` falls back to the `inflate64` package, reading the raw compressed
bytes from the local header (see `read_entry`). Verified byte-exact against the real archives.

**The browser uploader cannot read these five.** `fflate` does not implement Deflate64 either, so
they must go through the CLI. Check `compress_type` before assuming an archive will load in the
browser.

Related: one unsupported archive must never abort a run. The first backfill attempt lost 19 good
archives to one bad one; the CLI now isolates failures per archive and reports them at the end.

### Bulk loading: `scripts/efile_ingest.py`
```bash
python scripts/efile_ingest.py --zip <path>            # local archive
python scripts/efile_ingest.py --url  <archive url>    # streamed, never written to disk
python scripts/efile_ingest.py --year 2025 --year 2026 # the whole 24-archive backfill
python scripts/efile_ingest.py --zip <path> --dry-run --limit 250   # smoke test
```
`--on-conflict skip|overwrite` governs cross-source conflicts; e-file resubmissions are always
resolved by submission date regardless. `--schema NAME` writes to a scratch schema. Use
`DATABASE_URL_UNPOOLED` for long runs.

**It holds no copy of its own rules.** It reads `efile-concordance.json` for the field map and
`write-contract.json` for the columns and the precedence rule, and generates the same statement the
API does — asserted by `npm run test:parity`.

Two things that differ from the TypeScript writer and cannot be copied across:
- **psycopg2 needs named placeholders** (`%(mode)s`), not positional. The precedence rule
  interpolates the mode placeholder once per column, and a reused `%s` runs psycopg2 out of
  parameters — `IndexError: list index out of range`, not a helpful message.
- **The first VALUES tuple carries explicit casts.** Without them a batch where some column is NULL
  in every row fails type inference.

Re-loading an identical archive is idempotent in `filings` but records one `superseded` audit row
per return, because the precedence rule uses `>=` on submission date so a genuine same-day
resubmission still wins. Harmless, but `ingest_audit` grows on repeated re-runs of the same file.

### Reading an e-file archive
`lib/ingest/efile-reader.ts` streams a monthly `.zip` — the largest is 521 MB compressed and ~2.7 GB
expanded across 168,344 returns, so nothing may be held whole.

Two things that are easy to get wrong and were both found by testing at scale rather than on a
fixture:
- **Slice the Blob yourself; do not trust `stream()` chunk sizes.** fflate's `Unzip.push` recurses
  once per entry boundary in the chunk it is handed, and Node passed the entire 68 MB archive as a
  single chunk — ~12,000 frames deep and a stack overflow. `CHUNK_BYTES` is 256 KB, which keeps the
  depth in the tens. Browser chunk sizes are not guaranteed either.
- **The XML parser is injected.** Production passes the browser's native `DOMParser` (C++, and it
  matters over 2.7 GB); tests inject `@xmldom/xmldom` and drive the same streaming code against a
  real ZIP fixture.

Measured on 2026_TEOS_XML_01A.zip: 12,245 entries in **10.9s** at 1,127/sec with the pure-JS parser.
Unzip is only 1.5s of that; parsing dominates. The reader yields to the event loop every 250 entries
instead of using a Web Worker — `new Worker(new URL(...))` bundling is the sort of thing this Next
version changes, and yields were the lower-risk way to keep the tab responsive. If a large archive
feels frozen in practice, a Worker is a contained follow-up.

The TypeScript reader and an independent Python pass over the same archive agree exactly — 11,924
mapped, 321 unsupported 990-T — which is the check that the shared concordance actually works.

`internal relative imports carry the .ts extension` (enabled by `allowImportingTsExtensions`), so
one specifier resolves under `tsc`, Turbopack and `node --test` alike. Without it, production
modules had to be extensionless while tests had to be explicit.

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

**One batch may not contain the same `(ein, tax_period)` twice.** Postgres refuses —
"ON CONFLICT DO UPDATE command cannot affect row a second time" — and a single archive really does
carry two returns for one key when an organisation amended within the month. `dedupeBatch` (TS) and
`dedupe_batch` (Python) collapse them, later `submission_date` winning, which is the same rule the
SQL applies. Duplicates that straddle batches need no special handling: the second batch takes the
normal conflict path and is recorded as a supersession. This aborted the first real backfill attempt
on archive one, having never fired on any fixture.

**A column mapped but not listed in `UPSERT_COLUMNS` is silently dropped**, not rejected. Six were
(`num_employees`, `legal_fees`, `accounting_fees`, `occupancy`, `depreciation`, `grants_to_govts`) —
extracted from the XML, discarded on the way to the database, with every unit test on both sides
passing. `lib/ingest/conformance.test.ts` now asserts that every concordance column is writable and
that a mapped row's populated fields all reach the generated SQL. The scratch schema in
`conflict.test.ts` is generated from `UPSERT_COLUMNS` for the same reason: a hand-written mirror
drifts, and a drifting mirror hides regressions rather than catching them.

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
