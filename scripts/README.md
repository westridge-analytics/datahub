# 990 Research App — Data Ingestion

This directory contains the Python pipeline that reads IRS Statistics of Income
(SOI) 990 extract files and upserts them into the Postgres database (Neon /
Vercel Postgres).

---

## Prerequisites

- Python 3.11+
- A Postgres database (Neon / Vercel Postgres) with the schema already applied
  (`schema.sql`)

---

## Setup

```bash
cd scripts
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in the `scripts/` directory (or in the repo root):

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

`DATABASE_URL` is the only required environment variable.  When using Vercel
Postgres / Neon, copy the connection string from the Vercel dashboard
(**Storage → your database → .env.local**).

---

## Source data files

The pipeline expects files in `../docs/990_data/file_data/` by default.  Two
formats are supported:

| Files | Format | Form type |
|---|---|---|
| `py12_990.dat`, `py13_990.dat`, `py14_990.dat` | Space-delimited, header row 1 | All rows are Form 990 |
| `15eofinextract990.dat` – `17eofinextract990.dat` | Space-delimited, header row 1 | All rows are Form 990 |
| `18eoextract990.csv` – `24eoextract990.csv` | Comma-separated, header row 1 | Filtered to `elf = E` (full Form 990) |

---

## Downloading the EO BMF file

The IRS Exempt Organizations Business Master File (EO BMF) is a separate CSV
that provides organisation names, states, and NTEE codes.

1. Go to: https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf
2. Download one of the regional CSV files (e.g. `eo1.csv` for the Northeast,
   or download all four and concatenate them).
3. Pass the path to `--eobmf` when running the script.

The BMF must be loaded **before** (or at the same time as) the filings data,
because the `filings` table has a foreign key to `organizations`.

---

## Running the ingestion

### Full run (BMF + filings)

```bash
python ingest.py --eobmf /path/to/eo1.csv
```

### Filings only (if organisations are already loaded)

```bash
python ingest.py
```

### Custom data directory

```bash
python ingest.py --data-dir /absolute/path/to/file_data --eobmf /path/to/eo.csv
```

### Dry run (no database writes)

```bash
python ingest.py --dry-run
python ingest.py --dry-run --eobmf /path/to/eo.csv
```

A dry run parses every file and prints row counts without touching the database.
`DATABASE_URL` is not required in dry-run mode.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes (except dry-run) | Postgres connection string, e.g. `postgresql://user:pass@host/db?sslmode=require` |

---

## Progress output

The script prints one progress block per file:

```
[18eoextract990.csv] Reading ...
[18eoextract990.csv] 342187 rows read
[18eoextract990.csv] 285004 records to upsert, 57183 skipped (filtered/invalid)
[18eoextract990.csv] Upserted 285004 records
```

Skipped rows are those filtered out (e.g. non-Form-990 rows in CSV files) or
rows with an unparseable EIN or tax period.  "Upserted" counts include both
inserts and updates; when an `(ein, tax_period)` pair already exists the row is
updated in place.

---

## Deduplication logic

Within each source file, the last row for a given `(ein, tax_period)` pair
wins (amended returns appear later in the file).  Across files, later files
(higher year numbers) also overwrite earlier ones via the `ON CONFLICT DO
UPDATE` upsert.
