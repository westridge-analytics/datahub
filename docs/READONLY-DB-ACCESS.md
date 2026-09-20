# Read-only database access for an outside analyst

For someone who needs to *query* the 990 data and does not need to change the tool. They need
no GitHub access, no Vercel access, and no copy of this repository — one connection string is
the whole grant.

## Creating the role

Run this in the Neon SQL editor (Vercel dashboard → Storage → the database → Open in Neon).
Use the SQL editor, **not** Neon's *Roles → Add role* button: roles created through that UI are
granted `neon_superuser`, which is the opposite of the intent here.

```sql
-- 1. generate a password and copy the result
SELECT replace(gen_random_uuid()::text, '-', '') AS password;

-- 2. create the role with it
CREATE ROLE datahub_readonly WITH LOGIN PASSWORD 'PASTE-IT-HERE';
GRANT CONNECT ON DATABASE neondb TO datahub_readonly;
GRANT USAGE ON SCHEMA public TO datahub_readonly;
GRANT SELECT ON organizations, filings, cohorts, cohort_members, ingest_audit TO datahub_readonly;
```

`users` is left out deliberately — it holds email addresses and bcrypt password hashes for
everyone with app access. There is no `ALTER DEFAULT PRIVILEGES` either, so a table added later
is not silently exposed; the cost is that a new table needs an explicit grant.

Verify before handing anything over. The second command should fail:

```bash
psql "$RO_URL" -c "SELECT count(*) FROM organizations;"
psql "$RO_URL" -c "SELECT * FROM users LIMIT 1;"     # expect: permission denied for table users
```

## The connection string

```
postgresql://datahub_readonly:PASSWORD@HOST/neondb?sslmode=require
```

`HOST` is the `PGHOST` value in `apps/web/.env.local` (the `-pooler` one). For long analytical
queries, `PGHOST_UNPOOLED` is the same hostname without `-pooler`. Send it through a password
manager — not chat, not email. The password cannot be read back out of Postgres; reset it with
`ALTER ROLE datahub_readonly WITH PASSWORD '...'` if it goes astray, and revoke the whole grant
with `DROP OWNED BY datahub_readonly; DROP ROLE datahub_readonly;`.

## Briefing their Claude

The prompt below gets a fresh Claude Code session productive without this repository. Paste the
real connection string in place of the placeholder before sending it.

```
I have read-only access to a Postgres database of IRS Form 990 data (nonprofit
tax filings). Please help me answer research questions with SQL.

CONNECTION
  postgresql://datahub_readonly:PASSWORD@HOST/neondb?sslmode=require

Use psql. If it isn't installed: brew install libpq (macOS). Start by connecting
and running a couple of small queries to confirm it works.

WHAT'S IN IT
  organizations  — 2.0M nonprofits, one row per EIN
  filings        — 8.28M annual filings, fiscal years 1976-2026, 79 columns
  cohorts / cohort_members — saved groupings of EINs made in the web app
  ingest_audit   — provenance log; ignore unless I ask about data lineage

KEY COLUMNS
  organizations: ein, name, state, ntee_code, sector, subseccd, name_vec
  filings: ein, tax_period, fiscal_year, form_type, data_source, submission_date,
    is_amended, plus ~70 financial columns — total_revenue, total_expenses,
    total_assets, total_liabilities, total_net_assets, contributions,
    program_revenue, investment_income, program_expenses, ga_expenses,
    fundraising_expenses, cash_equiv, st_investments, lt_investments, ppe,
    unrestr_net_assets, restr_net_assets, compensation detail (comp_officers,
    comp_total_reported, num_employees, num_highly_compensated), fee detail
    (legal_fees, accounting_fees, management_fees), grants (grants_to_govts,
    grants_to_individuals, grants_to_foreign), and governance booleans
    (has_lobbying, operates_hospital, operates_school, has_related_orgs, ...).
  Run \d filings for the full list rather than guessing at a column name.

THINGS THAT WILL TRIP YOU UP
  - EINs are TEXT and hyphenated: '57-0442620', not 570442620. An unhyphenated
    literal silently returns zero rows.
  - All money columns are bigint, in whole dollars, and are frequently NULL.
    Use NULLIF / FILTER rather than assuming zero, or averages will be wrong.
  - tax_period is a DATE always set to the first of the month; it encodes a
    period, not a day. (ein, tax_period) is the unique key — one row per filing,
    so there is no cross-source double counting.
  - fiscal_year is the convenient column for year filtering, and it is indexed.
  - data_source is either 'soi_extract' (7.2M rows, IRS annual extracts,
    authoritative but lagging) or 'efile_xml' (1.1M rows, monthly e-file
    archives, near real-time, raw as filed). Recent years skew e-file. Mention
    the mix if it could affect an answer.
  - Not every organization has filings, and coverage thins out in older years.

PERFORMANCE — this matters
  filings is 7.3 GB and shares compute with a live web app, so avoid unfiltered
  scans. Indexed paths: ein, fiscal_year, (ein, fiscal_year), and DESC NULLS
  LAST indexes on total_revenue, total_expenses, total_assets, total_net_assets
  (so "largest by revenue" queries are cheap). For organization name search use
  the full-text index rather than ILIKE:
    WHERE name_vec @@ websearch_to_tsquery('english', 'stanford university')
  Trigram GIN indexes also exist on organizations.name and filings.ein for fuzzy
  matching. Add LIMIT while exploring, and tell me before running anything you
  expect to take more than a few seconds.

GROUND RULES
  Access is SELECT-only on organizations, filings, cohorts, cohort_members and
  ingest_audit. Writes and DDL will be refused by the server, so don't attempt
  them. This is a production database, not a sandbox.

Show me the SQL you run, not just the answer, and say so plainly when a result
looks like a data-quality artifact rather than a real finding.
```

Their queries run on the same Neon compute as the live site, so a careless scan can slow the
app for everyone. If that becomes a problem, a Neon read replica gives them a separate compute
endpoint against the same data, at the cost of extra compute hours.
