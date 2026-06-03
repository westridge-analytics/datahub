-- 990 Research App — Database Schema
-- Run once against Vercel Postgres (Neon) to initialize the database.

CREATE TABLE IF NOT EXISTS organizations (
  ein         TEXT PRIMARY KEY,   -- XX-XXXXXXX format
  name        TEXT NOT NULL,
  state       TEXT,
  ntee_code   TEXT,
  sector      TEXT,               -- decoded from ntee_code major group
  subseccd    INTEGER
);

CREATE TABLE IF NOT EXISTS filings (
  id                   SERIAL PRIMARY KEY,
  ein                  TEXT NOT NULL REFERENCES organizations(ein),
  tax_period           DATE NOT NULL,    -- YYYYMM from source → stored as YYYY-MM-01
  fiscal_year          INTEGER NOT NULL, -- YYYY of tax_period
  total_revenue        BIGINT,
  total_expenses       BIGINT,
  total_assets         BIGINT,
  total_liabilities    BIGINT,
  total_net_assets     BIGINT,
  contributions        BIGINT,
  program_revenue      BIGINT,
  investment_income    BIGINT,
  other_revenue        BIGINT,           -- derived: total_revenue - contributions - program_revenue - investment_income
  program_expenses     BIGINT,
  ga_expenses          BIGINT,
  fundraising_expenses BIGINT,
  cash_equiv           BIGINT,
  st_investments       BIGINT,
  lt_investments       BIGINT,
  ppe                  BIGINT,
  unrestr_net_assets   BIGINT,
  restr_net_assets     BIGINT,
  source_file          TEXT,
  UNIQUE (ein, tax_period)
);

CREATE INDEX IF NOT EXISTS idx_filings_ein         ON filings(ein);
CREATE INDEX IF NOT EXISTS idx_filings_fiscal_year ON filings(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_filings_ein_year    ON filings(ein, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_filings_revenue     ON filings(total_revenue);
CREATE INDEX IF NOT EXISTS idx_org_state           ON organizations(state);
CREATE INDEX IF NOT EXISTS idx_org_sector          ON organizations(sector);
CREATE INDEX IF NOT EXISTS idx_org_name_trgm       ON organizations USING gin(to_tsvector('english', name));

CREATE TABLE IF NOT EXISTS cohorts (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id  INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  ein        TEXT    NOT NULL REFERENCES organizations(ein) ON DELETE CASCADE,
  PRIMARY KEY (cohort_id, ein)
);
