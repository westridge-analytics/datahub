-- Phase 2 — provenance + ingest audit, in support of e-file XML ingestion.
--
-- Additive and idempotent. Safe to re-run. Contains no destructive statements;
-- dropping the unused filings_raw table is a separate, explicit migration
-- (migrate_drop_filings_raw.sql).
--
--   python scripts/run_migration.py migrate_efile_provenance.sql
--
-- Why this is cheap on a 7.2M-row table: since Postgres 11, ADD COLUMN with a
-- non-volatile DEFAULT is a catalog-only change — existing rows are not
-- rewritten, and the default is materialised on read. The CHECK constraint is
-- added NOT VALID for the same reason: it is enforced on every future INSERT
-- and UPDATE, but does not scan the 7.2M rows already present.

BEGIN;

-- ── Provenance on filings ────────────────────────────────────────────────────
-- data_source distinguishes the IRS SOI annual extracts (authoritative, lagging)
-- from the monthly e-file XML archives (near-real-time, raw as filed).
ALTER TABLE filings ADD COLUMN IF NOT EXISTS data_source     TEXT NOT NULL DEFAULT 'soi_extract';

-- e-file submission identity. Null for SOI-extract rows, which have no concept
-- of an individual submission. object_id is unique per submission and is what
-- names the XML file inside an archive; dln is the IRS document locator number.
ALTER TABLE filings ADD COLUMN IF NOT EXISTS object_id       TEXT;
ALTER TABLE filings ADD COLUMN IF NOT EXISTS dln             TEXT;

-- SUB_DATE from the archive index. Orders resubmissions: newest wins.
ALTER TABLE filings ADD COLUMN IF NOT EXISTS submission_date DATE;

-- True when this row came from a return the filer marked as amended.
ALTER TABLE filings ADD COLUMN IF NOT EXISTS is_amended      BOOLEAN;

-- Deliberately NOT added: a return_type column. The existing form_type column
-- already carries '990' / '990EZ' / '990PF', which is exactly what the e-file
-- index's RETURN_TYPE resolves to. A second column would be a synonym that
-- could drift out of agreement with the first.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'filings_data_source_check'
  ) THEN
    ALTER TABLE filings
      ADD CONSTRAINT filings_data_source_check
      CHECK (data_source IN ('soi_extract', 'efile_xml')) NOT VALID;
  END IF;
END $$;

-- Deliberately NOT added: an index on (ein, tax_period, data_source). The
-- existing UNIQUE (ein, tax_period) already resolves every preflight lookup;
-- reading data_source is one heap fetch per key, and preflight batches are ~500
-- keys. A second index over 7.2M rows would cost several hundred MB to spare
-- those fetches. Revisit only if preflight measures slow in practice.

-- ── Ingest audit ─────────────────────────────────────────────────────────────
-- One row per conflict resolution, whichever way it went. Covers three cases:
--   'superseded'  a later e-file submission replaced an earlier one
--   'skipped'     an incoming row lost to what was already stored
--   'overwritten' an incoming row replaced what was already stored
-- Small by design: ~6,600 supersessions expected across the full backfill.
CREATE TABLE IF NOT EXISTS ingest_audit (
    id                      BIGSERIAL   PRIMARY KEY,
    ein                     TEXT        NOT NULL,
    tax_period              DATE        NOT NULL,
    form_type               TEXT,
    action                  TEXT        NOT NULL,
    losing_source           TEXT,
    losing_object_id        TEXT,
    losing_submission_date  DATE,
    winning_source          TEXT,
    winning_object_id       TEXT,
    winning_submission_date DATE,
    source_file             TEXT,
    loaded_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ingest_audit_action_check
      CHECK (action IN ('superseded', 'skipped', 'overwritten'))
);

CREATE INDEX IF NOT EXISTS idx_ingest_audit_key       ON ingest_audit (ein, tax_period);
CREATE INDEX IF NOT EXISTS idx_ingest_audit_loaded_at ON ingest_audit (loaded_at DESC);

COMMIT;
