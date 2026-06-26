-- Expand filings table with research-grade fields and create filings_raw
-- Idempotent: all ADD COLUMN statements use IF NOT EXISTS

-- ── Headcount ────────────────────────────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS num_employees            INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS num_highly_compensated   INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS num_contractors_100k     INTEGER;

-- ── Compensation summary (Part VII) ──────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS comp_total_reported      INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS comp_related_orgs        INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS comp_estimated_other     INTEGER;

-- ── Compensation / payroll detail (Part IX) ───────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS comp_officers            INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS comp_disqualified        INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS comp_other_salaries      INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS pension_contributions    INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS employee_benefits        INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS payroll_taxes            INTEGER;

-- ── Professional fees (Part IX) ───────────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS management_fees              INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS legal_fees                   INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS accounting_fees              INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS professional_fundraising_fees INTEGER;

-- ── Operating expenses (Part IX) ─────────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS occupancy                INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS travel                   INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS it_expenses              INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS depreciation             INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS insurance                INTEGER;

-- ── Grants paid (Part IX) ────────────────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS grants_to_govts          INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS grants_to_individuals    INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS grants_to_foreign        INTEGER;

-- ── Revenue components (Part VIII) ───────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS royalties_income         INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS net_rental_income        INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS net_asset_sale_gains     INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS net_fundraising_income   INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS net_gaming_income        INTEGER;

-- ── Balance sheet detail (Part X) ────────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS pledges_receivable            INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS accounts_payable              INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS tax_exempt_bonds_liability    INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS investments_publicly_traded   INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS investments_other             INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS investments_program_related   INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS temp_restricted_net_assets    INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS perm_restricted_net_assets    INTEGER;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS secured_mortgages             BIGINT;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS unsecured_notes               BIGINT;

-- ── Filing / org classification ───────────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS subsection_code          TEXT;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS filing_method            TEXT;

-- ── Governance flags ─────────────────────────────────────────────────────────
ALTER TABLE filings ADD COLUMN IF NOT EXISTS has_lobbying                     BOOLEAN;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS has_political_activity           BOOLEAN;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS has_unrelated_business_income    BOOLEAN;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS has_foreign_office               BOOLEAN;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS has_foreign_grants               BOOLEAN;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS operates_hospital                BOOLEAN;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS operates_school                  BOOLEAN;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS has_related_orgs                 BOOLEAN;

-- ── filings_raw: preserve everything not promoted to main table ───────────────
CREATE TABLE IF NOT EXISTS filings_raw (
    ein         TEXT    NOT NULL,
    tax_period  DATE    NOT NULL,
    form_type   TEXT    NOT NULL DEFAULT '990',
    source_file TEXT,
    raw_data    JSONB   NOT NULL DEFAULT '{}',
    PRIMARY KEY (ein, tax_period)
);

CREATE INDEX IF NOT EXISTS idx_filings_raw_ein ON filings_raw (ein);
CREATE INDEX IF NOT EXISTS idx_filings_raw_data ON filings_raw USING gin (raw_data);
