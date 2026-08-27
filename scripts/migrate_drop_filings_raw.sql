-- DESTRUCTIVE — drops the filings_raw table and its ~10 GB of JSONB payloads.
--
--   python scripts/run_migration.py migrate_drop_filings_raw.sql
--
-- Run this ONLY after scripts/ingest.py has stopped populating the table
-- (raw capture is now opt-in via --with-raw, which errors if the table is
-- absent). Nothing in apps/web has ever read filings_raw.
--
-- Context: schema_small_instance.sql states filings_raw was deliberately
-- omitted from the light instance to save "~1.5GB/year ... for zero functional
-- loss". It was present anyway, at 10 GB across 3.49M rows — roughly 60% of a
-- 17 GB database, for a table no query path touches.
--
-- Recoverable? Not from the database, but the contents are reproducible: every
-- raw_data payload was derived from the source files in
-- docs/990_data/file_data/ and can be rebuilt with
-- `python scripts/ingest.py --with-raw` after re-creating the table from
-- migrate_expand_filings.sql. Neon point-in-time restore is the faster route if
-- this turns out to be a mistake.

BEGIN;

DROP TABLE IF EXISTS filings_raw;

COMMIT;
