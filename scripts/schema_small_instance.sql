-- Westridge 990 Research App — schema bootstrap for the small ("light") instance.
--
-- Mirrors the live production schema for the tables the app actually reads —
-- organizations, filings, cohorts, cohort_members, users — but deliberately
-- omits filings_raw and the vestigial auth tables (session/account/member/
-- organization/invitation/verification/jwks), none of which apps/web queries.
-- Skipping filings_raw alone is worth ~1.5GB/year of Form 990 data in TOAST
-- storage for zero functional loss.
--
-- Run once against the new (empty) Neon database before ingestion:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/schema_small_instance.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organizations (
  ein       TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  state     TEXT,
  ntee_code TEXT,
  sector    TEXT,
  subseccd  INTEGER,
  name_vec  TSVECTOR GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(name, ''::text))) STORED
);

CREATE INDEX idx_org_name_fts      ON organizations USING gin (name_vec);
CREATE INDEX idx_org_name_trgm     ON organizations USING gin (to_tsvector('english'::regconfig, name));
CREATE INDEX idx_org_name_trgm_gin ON organizations USING gin (name gin_trgm_ops);
CREATE INDEX idx_org_sector        ON organizations (sector);
CREATE INDEX idx_org_state         ON organizations (state);

CREATE TABLE filings (
  id                             SERIAL PRIMARY KEY,
  ein                            TEXT NOT NULL REFERENCES organizations(ein),
  tax_period                     DATE NOT NULL,
  fiscal_year                    INTEGER NOT NULL,
  total_revenue                  BIGINT,
  total_expenses                 BIGINT,
  total_assets                   BIGINT,
  total_liabilities              BIGINT,
  total_net_assets               BIGINT,
  contributions                  BIGINT,
  program_revenue                BIGINT,
  investment_income              BIGINT,
  other_revenue                  BIGINT,
  program_expenses               BIGINT,
  ga_expenses                    BIGINT,
  fundraising_expenses           BIGINT,
  cash_equiv                     BIGINT,
  st_investments                 BIGINT,
  lt_investments                 BIGINT,
  ppe                            BIGINT,
  unrestr_net_assets             BIGINT,
  restr_net_assets               BIGINT,
  source_file                    TEXT,
  form_type                      TEXT DEFAULT '990',
  num_employees                  INTEGER,
  num_highly_compensated         INTEGER,
  num_contractors_100k           INTEGER,
  comp_total_reported            BIGINT,
  comp_related_orgs              BIGINT,
  comp_estimated_other           BIGINT,
  comp_officers                  BIGINT,
  comp_disqualified              BIGINT,
  comp_other_salaries            BIGINT,
  pension_contributions          BIGINT,
  employee_benefits              BIGINT,
  payroll_taxes                  BIGINT,
  management_fees                BIGINT,
  legal_fees                     BIGINT,
  accounting_fees                BIGINT,
  professional_fundraising_fees  BIGINT,
  occupancy                      BIGINT,
  travel                         BIGINT,
  it_expenses                    BIGINT,
  depreciation                   BIGINT,
  insurance                      BIGINT,
  grants_to_govts                BIGINT,
  grants_to_individuals          BIGINT,
  grants_to_foreign              BIGINT,
  royalties_income                BIGINT,
  net_rental_income               BIGINT,
  net_asset_sale_gains            BIGINT,
  net_fundraising_income          BIGINT,
  net_gaming_income               BIGINT,
  pledges_receivable               BIGINT,
  accounts_payable                 BIGINT,
  tax_exempt_bonds_liability       BIGINT,
  investments_publicly_traded      BIGINT,
  investments_other                BIGINT,
  investments_program_related      BIGINT,
  temp_restricted_net_assets       BIGINT,
  perm_restricted_net_assets       BIGINT,
  subsection_code                  TEXT,
  filing_method                    TEXT,
  has_lobbying                     BOOLEAN,
  has_political_activity           BOOLEAN,
  has_unrelated_business_income    BOOLEAN,
  has_foreign_office               BOOLEAN,
  has_foreign_grants               BOOLEAN,
  operates_hospital                BOOLEAN,
  operates_school                  BOOLEAN,
  has_related_orgs                 BOOLEAN,
  secured_mortgages                BIGINT,
  unsecured_notes                  BIGINT,
  deferred_revenue                 BIGINT,
  UNIQUE (ein, tax_period)
);

CREATE TABLE cohorts (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  short_name  VARCHAR(6),
  description TEXT
);

CREATE TABLE cohort_members (
  cohort_id INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  ein       TEXT    NOT NULL REFERENCES organizations(ein) ON DELETE CASCADE,
  PRIMARY KEY (cohort_id, ein)
);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
