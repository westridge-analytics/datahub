#!/usr/bin/env python3
"""
IRS SOI 990 data ingestion pipeline.

Reads space-delimited (.dat) and CSV source files from the IRS Statistics of
Income division, normalises financial fields, and upserts into a Postgres
database (Neon / Vercel Postgres).

Usage:
    python ingest.py [--data-dir PATH] [--eobmf PATH] [--dry-run]
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path
from typing import Optional, Tuple

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Space-delimited files (py12–py14, 15eo–17eo) — all rows are Form 990.
# Note: 15eo–17eo have an `elf` column but we still include all rows because
# the IRS extract for these years contains only Form 990 filers.
SPACE_DELIM_PATTERNS = {
    "py12_990.dat",
    "py13_990.dat",
    "py14_990.dat",
    "15eofinextract990.dat",
    "16eofinextract990.dat",
    "17eofinextract990.dat",
}

# CSV files (18eo–24eo) — filter to elf == 'E' for full Form 990.
CSV_PATTERNS_PREFIX = "eoextract990.csv"  # filenames like 18eoextract990.csv

NTEE_SECTOR_MAP = {
    "A": "Arts, Culture & Humanities",
    "B": "Education",
    "C": "Environment & Animals",
    "D": "Environment & Animals",
    "E": "Health",
    "F": "Health",
    "G": "Health",
    "H": "Health",
    "I": "Human Services",
    "J": "Human Services",
    "K": "Human Services",
    "L": "Human Services",
    "M": "Human Services",
    "N": "Human Services",
    "O": "Human Services",
    "P": "Human Services",
    "Q": "International & Foreign Affairs",
    "R": "Public & Societal Benefit",
    "S": "Public & Societal Benefit",
    "T": "Public & Societal Benefit",
    "U": "Public & Societal Benefit",
    "V": "Public & Societal Benefit",
    "W": "Public & Societal Benefit",
    "X": "Religion",
    "Y": "Mutual & Membership Benefit",
    "Z": "Unknown",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def fmt_ein(raw: str) -> str | None:
    """Return EIN in XX-XXXXXXX format, or None if invalid."""
    digits = "".join(c for c in str(raw).strip() if c.isdigit())
    if not digits:
        return None
    digits = digits.zfill(9)
    if len(digits) != 9:
        return None
    return f"{digits[:2]}-{digits[2:]}"


def parse_int(value) -> int | None:
    """Cast value to int; return None for empty / non-numeric."""
    if value is None:
        return None
    s = str(value).strip()
    if s == "" or s == "." or s.lower() in ("nan", "null", "none"):
        return None
    try:
        return int(float(s))
    except (ValueError, OverflowError):
        return None


def tax_period_to_date(raw) -> tuple[str | None, int | None]:
    """
    Convert a YYYYMM string to (YYYY-MM-01, YYYY).
    Returns (None, None) on failure.
    """
    s = str(raw).strip()
    if len(s) != 6 or not s.isdigit():
        return None, None
    yyyy, mm = s[:4], s[4:]
    if not (1 <= int(mm) <= 12):
        return None, None
    return f"{yyyy}-{mm}-01", int(yyyy)


def sum_fields(row: dict, *field_names) -> int | None:
    """Sum multiple fields from a row dict, returning None if all are absent."""
    total = None
    for name in field_names:
        val = parse_int(row.get(name))
        if val is not None:
            total = (total or 0) + val
    return total


def derive_other_revenue(
    total_revenue: int | None,
    contributions: int | None,
    program_revenue: int | None,
    investment_income: int | None,
) -> int | None:
    if total_revenue is None:
        return None
    return total_revenue - (contributions or 0) - (program_revenue or 0) - (investment_income or 0)


# ---------------------------------------------------------------------------
# Row normalisation
# ---------------------------------------------------------------------------


def normalise_space_delimited(row: dict, source_file: str) -> dict | None:
    """
    Normalise a row from a space-delimited file.
    The `row` dict uses lowercase keys (header is normalised on read).
    Returns None if the row should be skipped.

    Form-type filtering:
    - py12–14: no elf column; all rows are Form 990.
    - 15eo: elf = E (Form 990) or P (990-PF/EZ); filter to E.
    - 16eo–17eo: elf = Y/N (electronic filing indicator, not form type);
                 the file extract is 990-only so include all rows.
    """
    elf = row.get("elf", "").strip().upper()
    # If elf is present and in E/P encoding, filter to E only
    if elf in ("P",):
        return None

    # EIN
    ein = fmt_ein(row.get("ein", ""))
    if ein is None:
        return None

    # Tax period — field is tax_prd in py12–15 files, tax_pd in 16eo–17eo files
    tax_period_raw = row.get("tax_prd") or row.get("tax_pd") or ""
    tax_period, fiscal_year = tax_period_to_date(tax_period_raw)
    if tax_period is None:
        return None

    # Financial fields
    total_revenue = parse_int(row.get("totrevenue"))
    contributions = parse_int(row.get("totcntrbgfts"))
    program_revenue = parse_int(row.get("totprgmrevnue"))
    investment_income = parse_int(row.get("invstmntinc"))
    total_expenses = parse_int(row.get("totfuncexpns"))
    total_assets = parse_int(row.get("totassetsend"))
    total_liabilities = parse_int(row.get("totliabend"))
    total_net_assets = parse_int(row.get("totnetassetend"))

    # Expense breakdown — py12–py14 files do not have these columns
    program_expenses = parse_int(row.get("totprgmrvnueexpns"))  # absent in space-del
    ga_expenses = parse_int(row.get("totgeneralexpns"))          # absent in space-del
    fundraising_expenses = parse_int(row.get("totfundrsng"))     # absent in space-del

    # Balance sheet
    cash_equiv = parse_int(row.get("cashnonsaved") or row.get("nonintcashend"))
    st_investments = parse_int(row.get("svngstempinvst") or row.get("svngstempinvend"))
    lt_investments = sum_fields(row, "invstmntspublicly", "invstmntsothrsec")
    if lt_investments is None:
        lt_investments = sum_fields(row, "invstmntsend", "invstmntsothrend")
    ppe = parse_int(row.get("lndbldgsequip") or row.get("lndbldgsequipend"))
    unrestr_net_assets = parse_int(
        row.get("unrstrctdnetasstsend") or row.get("unrstrctnetasstsend")
    )
    restr_net_assets = sum_fields(
        row, "temprstrctdnetasstsend", "permrstrctdnetasstsend"
    )
    if restr_net_assets is None:
        restr_net_assets = sum_fields(
            row, "temprstrctnetasstsend", "permrstrctnetasstsend"
        )

    other_revenue = derive_other_revenue(
        total_revenue, contributions, program_revenue, investment_income
    )

    return {
        "ein": ein,
        "tax_period": tax_period,
        "fiscal_year": fiscal_year,
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_net_assets": total_net_assets,
        "contributions": contributions,
        "program_revenue": program_revenue,
        "investment_income": investment_income,
        "other_revenue": other_revenue,
        "program_expenses": program_expenses,
        "ga_expenses": ga_expenses,
        "fundraising_expenses": fundraising_expenses,
        "cash_equiv": cash_equiv,
        "st_investments": st_investments,
        "lt_investments": lt_investments,
        "ppe": ppe,
        "unrestr_net_assets": unrestr_net_assets,
        "restr_net_assets": restr_net_assets,
        "source_file": source_file,
    }


def normalise_csv(row: dict, source_file: str) -> dict | None:
    """
    Normalise a row from a CSV file (18eo–24eo).
    Returns None if the row should be skipped (not full Form 990).
    """
    # Filter to full Form 990.
    # 18eo/19eo use column name 'elf'; 20eo+ use 'efile'.  Both use 'E' for
    # electronic Form 990 and 'P' for 990-PF / 990-EZ.
    elf = (row.get("elf") or row.get("efile") or "").strip().upper()
    if elf != "E":
        return None

    # EIN — CSV header uses 'ein' (lowercase after BOM strip)
    ein = fmt_ein(row.get("ein", ""))
    if ein is None:
        return None

    # Tax period — field is tax_pd in CSV files
    tax_period_raw = row.get("tax_pd", "")
    tax_period, fiscal_year = tax_period_to_date(tax_period_raw)
    if tax_period is None:
        return None

    # Financial fields
    total_revenue = parse_int(row.get("totrevenue"))
    contributions = parse_int(row.get("totcntrbgfts"))
    program_revenue = parse_int(row.get("totprgmrevnue"))
    investment_income = parse_int(row.get("invstmntinc"))
    total_expenses = parse_int(row.get("totfuncexpns"))
    total_assets = parse_int(row.get("totassetsend"))
    total_liabilities = parse_int(row.get("totliabend"))
    total_net_assets = parse_int(row.get("totnetassetend"))

    # Expense breakdown
    program_expenses = parse_int(row.get("totprgmrvnueexpns"))
    ga_expenses = parse_int(row.get("totgeneralexpns"))
    fundraising_expenses = parse_int(row.get("totfundrsng"))

    # Balance sheet — CSV field names
    cash_equiv = parse_int(row.get("nonintcashend"))
    st_investments = parse_int(row.get("svngstempinvend"))
    lt_investments = sum_fields(row, "invstmntsend", "invstmntsothrend")
    ppe = parse_int(row.get("lndbldgsequipend"))
    unrestr_net_assets = parse_int(row.get("unrstrctnetasstsend"))
    restr_net_assets = sum_fields(
        row, "temprstrctnetasstsend", "permrstrctnetasstsend"
    )

    other_revenue = derive_other_revenue(
        total_revenue, contributions, program_revenue, investment_income
    )

    return {
        "ein": ein,
        "tax_period": tax_period,
        "fiscal_year": fiscal_year,
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_net_assets": total_net_assets,
        "contributions": contributions,
        "program_revenue": program_revenue,
        "investment_income": investment_income,
        "other_revenue": other_revenue,
        "program_expenses": program_expenses,
        "ga_expenses": ga_expenses,
        "fundraising_expenses": fundraising_expenses,
        "cash_equiv": cash_equiv,
        "st_investments": st_investments,
        "lt_investments": lt_investments,
        "ppe": ppe,
        "unrestr_net_assets": unrestr_net_assets,
        "restr_net_assets": restr_net_assets,
        "source_file": source_file,
    }


# ---------------------------------------------------------------------------
# File reading
# ---------------------------------------------------------------------------


def is_space_delimited(filename: str) -> bool:
    return filename in SPACE_DELIM_PATTERNS


def _normalise_row(row: dict) -> dict:
    """Return a new dict with all keys lowercased and stripped."""
    return {k.lower().strip(): v for k, v in row.items()}


def read_space_delimited(filepath: Path) -> list[dict]:
    """Read a space-delimited .dat file; normalise header keys to lowercase."""
    rows = []
    with open(filepath, encoding="utf-8", errors="replace") as fh:
        reader = csv.DictReader(fh, delimiter=" ")
        for row in reader:
            rows.append(_normalise_row(row))
    return rows


def read_csv(filepath: Path) -> list[dict]:
    """Read a CSV file; handle BOM and normalise header keys to lowercase."""
    rows = []
    with open(filepath, encoding="utf-8-sig", errors="replace") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append(_normalise_row(row))
    return rows


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

UPSERT_FILING_SQL = """
INSERT INTO filings (
    ein, tax_period, fiscal_year,
    total_revenue, total_expenses, total_assets, total_liabilities, total_net_assets,
    contributions, program_revenue, investment_income, other_revenue,
    program_expenses, ga_expenses, fundraising_expenses,
    cash_equiv, st_investments, lt_investments, ppe,
    unrestr_net_assets, restr_net_assets, source_file
) VALUES (
    %(ein)s, %(tax_period)s, %(fiscal_year)s,
    %(total_revenue)s, %(total_expenses)s, %(total_assets)s, %(total_liabilities)s, %(total_net_assets)s,
    %(contributions)s, %(program_revenue)s, %(investment_income)s, %(other_revenue)s,
    %(program_expenses)s, %(ga_expenses)s, %(fundraising_expenses)s,
    %(cash_equiv)s, %(st_investments)s, %(lt_investments)s, %(ppe)s,
    %(unrestr_net_assets)s, %(restr_net_assets)s, %(source_file)s
)
ON CONFLICT (ein, tax_period) DO UPDATE SET
    fiscal_year          = EXCLUDED.fiscal_year,
    total_revenue        = EXCLUDED.total_revenue,
    total_expenses       = EXCLUDED.total_expenses,
    total_assets         = EXCLUDED.total_assets,
    total_liabilities    = EXCLUDED.total_liabilities,
    total_net_assets     = EXCLUDED.total_net_assets,
    contributions        = EXCLUDED.contributions,
    program_revenue      = EXCLUDED.program_revenue,
    investment_income    = EXCLUDED.investment_income,
    other_revenue        = EXCLUDED.other_revenue,
    program_expenses     = EXCLUDED.program_expenses,
    ga_expenses          = EXCLUDED.ga_expenses,
    fundraising_expenses = EXCLUDED.fundraising_expenses,
    cash_equiv           = EXCLUDED.cash_equiv,
    st_investments       = EXCLUDED.st_investments,
    lt_investments       = EXCLUDED.lt_investments,
    ppe                  = EXCLUDED.ppe,
    unrestr_net_assets   = EXCLUDED.unrestr_net_assets,
    restr_net_assets     = EXCLUDED.restr_net_assets,
    source_file          = EXCLUDED.source_file
"""


def upsert_filings(conn, records: list[dict], dry_run: bool) -> int:
    """Upsert a list of filing dicts. Returns number of rows processed."""
    if not records:
        return 0
    if dry_run:
        return len(records)
    with conn.cursor() as cur:
        psycopg2.extras.execute_many(cur, UPSERT_FILING_SQL, records)
    conn.commit()
    return len(records)


# ---------------------------------------------------------------------------
# EO BMF ingestion
# ---------------------------------------------------------------------------

UPSERT_ORG_SQL = """
INSERT INTO organizations (ein, name, state, ntee_code, sector, subseccd)
VALUES (%(ein)s, %(name)s, %(state)s, %(ntee_code)s, %(sector)s, %(subseccd)s)
ON CONFLICT (ein) DO UPDATE SET
    name      = EXCLUDED.name,
    state     = EXCLUDED.state,
    ntee_code = EXCLUDED.ntee_code,
    sector    = EXCLUDED.sector,
    subseccd  = EXCLUDED.subseccd
"""


def decode_sector(ntee_code: str | None) -> str:
    if not ntee_code:
        return "Unknown"
    first = ntee_code.strip().upper()[:1]
    return NTEE_SECTOR_MAP.get(first, "Unknown")


def ingest_eobmf(filepath: str | Path, conn, dry_run: bool = False) -> None:
    """
    Read the IRS EO BMF CSV file and upsert into the organizations table.

    The BMF file uses uppercase column names; common fields:
        EIN, NAME, STATE, NTEE_CD, SUBSECCD
    """
    filepath = Path(filepath)
    print(f"\n[EO BMF] Reading {filepath.name} ...")

    records = []
    skipped = 0

    with open(filepath, encoding="utf-8-sig", errors="replace") as fh:
        reader = csv.DictReader(fh)
        # Normalise keys to lowercase
        if reader.fieldnames:
            reader.fieldnames = [f.lower().strip() for f in reader.fieldnames]

        for raw in reader:
            row = {k.lower().strip(): v for k, v in raw.items()}

            ein = fmt_ein(row.get("ein", ""))
            if ein is None:
                skipped += 1
                continue

            name = str(row.get("name", "") or "").strip()
            if not name:
                name = str(row.get("organization_name", "") or "").strip()

            state = str(row.get("state", "") or row.get("st", "") or "").strip() or None
            ntee_code = str(row.get("ntee_cd", "") or row.get("nteecc", "") or "").strip() or None
            sector = decode_sector(ntee_code)
            subseccd = parse_int(row.get("subseccd"))

            records.append(
                {
                    "ein": ein,
                    "name": name,
                    "state": state,
                    "ntee_code": ntee_code,
                    "sector": sector,
                    "subseccd": subseccd,
                }
            )

    print(f"[EO BMF] Read {len(records) + skipped} rows — {skipped} skipped (bad EIN)")

    if dry_run:
        print(f"[EO BMF] DRY RUN — would upsert {len(records)} organizations")
        return

    batch_size = 5000
    total_upserted = 0
    with conn.cursor() as cur:
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            psycopg2.extras.execute_many(cur, UPSERT_ORG_SQL, batch)
            conn.commit()
            total_upserted += len(batch)

    print(f"[EO BMF] Upserted {total_upserted} organizations")


# ---------------------------------------------------------------------------
# Per-file ingestion
# ---------------------------------------------------------------------------


def ingest_file(filepath: Path, conn, dry_run: bool) -> None:
    filename = filepath.name
    print(f"\n[{filename}] Reading ...", flush=True)

    space_delim = is_space_delimited(filename)

    if space_delim:
        raw_rows = read_space_delimited(filepath)
    else:
        raw_rows = read_csv(filepath)

    print(f"[{filename}] {len(raw_rows)} rows read", flush=True)

    records: list[dict] = []
    skipped = 0

    # Deduplication within this file: last row for (ein, tax_period) wins.
    # We use a dict keyed by (ein, tax_period).
    dedup: dict[tuple, dict] = {}

    for raw in raw_rows:
        if space_delim:
            rec = normalise_space_delimited(raw, filename)
        else:
            rec = normalise_csv(raw, filename)

        if rec is None:
            skipped += 1
            continue

        key = (rec["ein"], rec["tax_period"])
        dedup[key] = rec  # later rows overwrite earlier ones

    records = list(dedup.values())

    print(
        f"[{filename}] {len(records)} records to upsert, "
        f"{skipped} skipped (filtered/invalid)",
        flush=True,
    )

    if not records:
        return

    # Upsert in batches
    batch_size = 2000
    total_upserted = 0

    if dry_run:
        print(f"[{filename}] DRY RUN — would upsert {len(records)} records")
        return

    with conn.cursor() as cur:
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            psycopg2.extras.execute_many(cur, UPSERT_FILING_SQL, batch)
            conn.commit()
            total_upserted += len(batch)

    print(f"[{filename}] Upserted {total_upserted} records", flush=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _file_sort_key(f: Path) -> int:
    """
    Return a numeric sort key so files process in chronological order.
    py12 → 12, py13 → 13, ..., 15eofinextract990 → 15, 18eoextract990 → 18, etc.
    """
    name = f.name
    # py12_990.dat  → extract leading digits after 'py'
    if name.startswith("py") and name[2:4].isdigit():
        return int(name[2:4])
    # 15eofinextract990.dat / 18eoextract990.csv → leading two digits
    if name[:2].isdigit():
        return int(name[:2])
    return 99


def discover_files(data_dir: Path) -> list[Path]:
    """Return all recognised 990 source files sorted oldest-to-newest."""
    result = []
    for f in data_dir.iterdir():
        name = f.name
        if name in SPACE_DELIM_PATTERNS:
            result.append(f)
        elif name.endswith(CSV_PATTERNS_PREFIX) and name[:2].isdigit():
            result.append(f)
    return sorted(result, key=_file_sort_key)


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Ingest IRS SOI 990 data into Postgres")
    parser.add_argument(
        "--data-dir",
        default="../docs/990_data/file_data",
        help="Path to directory containing .dat and .csv source files",
    )
    parser.add_argument(
        "--eobmf",
        default=None,
        help="Path to IRS EO BMF CSV file (optional)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse files and report counts without writing to the database",
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir).expanduser().resolve()
    if not data_dir.is_dir():
        print(f"ERROR: data directory not found: {data_dir}", file=sys.stderr)
        sys.exit(1)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url and not args.dry_run:
        print(
            "ERROR: DATABASE_URL environment variable is not set. "
            "Set it or pass --dry-run.",
            file=sys.stderr,
        )
        sys.exit(1)

    conn = None
    if not args.dry_run:
        print(f"Connecting to database ...")
        conn = psycopg2.connect(database_url)
        print("Connected.")

    # EO BMF first so that organizations exist before filings reference them.
    # (The schema has a FK; if you want to load filings without org records,
    #  temporarily drop the FK or load BMF first.)
    if args.eobmf:
        eobmf_path = Path(args.eobmf).expanduser().resolve()
        if not eobmf_path.is_file():
            print(f"ERROR: EO BMF file not found: {eobmf_path}", file=sys.stderr)
            sys.exit(1)
        ingest_eobmf(eobmf_path, conn, dry_run=args.dry_run)

    files = discover_files(data_dir)
    if not files:
        print(f"No recognised source files found in {data_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"\nFound {len(files)} source files in {data_dir}")
    for f in files:
        print(f"  {f.name}")

    for filepath in files:
        ingest_file(filepath, conn, dry_run=args.dry_run)

    if conn:
        conn.close()

    print("\nDone.")


if __name__ == "__main__":
    main()
