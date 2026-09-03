#!/usr/bin/env python3
"""
Bulk loader for IRS e-file XML archives.

Reads BOTH shared contracts rather than holding its own copy of either:
  apps/web/lib/ingest/efile-concordance.json  — which XML path feeds which column
  apps/web/lib/ingest/write-contract.json     — the columns, and the precedence rule

That matters most for precedence. The rule decides what overwrites production
data; a second implementation would be a second chance to get it wrong, and only
one of them would be the one under test.

Usage:
    # local archive
    python scripts/efile_ingest.py --zip docs/990_data/archives/2026_TEOS_XML_01A.zip

    # straight from the IRS, nothing written to disk
    python scripts/efile_ingest.py --url \\
      https://apps.irs.gov/pub/epostcard/990/xml/2026/2026_TEOS_XML_01A.zip

    # the whole backfill, unattended
    python scripts/efile_ingest.py --year 2025 --year 2026

Options:
    --on-conflict skip|overwrite   cross-source conflicts (default: skip)
    --dry-run                      map and report, write nothing
    --limit N                      stop after N returns (smoke tests)
    --schema NAME                  write to a scratch schema instead of public

Use DATABASE_URL_UNPOOLED for long runs.
"""

from __future__ import annotations

import argparse
import io
import struct
import json
import os
import re
import sys
import time
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterator

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

try:                                    # optional: only needed for Deflate64
    import inflate64
except ImportError:                     # pragma: no cover
    inflate64 = None

ROOT = Path(__file__).resolve().parent.parent
CONTRACT_DIR = ROOT / "apps/web/lib/ingest"
ARCHIVE_BASE = "https://apps.irs.gov/pub/epostcard/990/xml"

BATCH_SIZE = 1000
DOWNLOAD_CHUNK = 1 << 20


# ---------------------------------------------------------------------------
# Shared contracts
# ---------------------------------------------------------------------------

def load_contracts() -> tuple[dict, dict]:
    concordance = json.loads((CONTRACT_DIR / "efile-concordance.json").read_text())
    contract = json.loads((CONTRACT_DIR / "write-contract.json").read_text())
    return concordance, contract


CONCORDANCE, CONTRACT = load_contracts()
NS = "{" + CONCORDANCE["namespace"] + "}"
COLUMNS = [c["name"] for c in CONTRACT["columns"]]
KEY_COLUMNS = [c["name"] for c in CONTRACT["columns"] if c.get("key")]


def fill(template: str, **vars: str) -> str:
    """Substitute {placeholders}, leaving unknown ones alone."""
    return re.sub(r"\{(\w+)\}", lambda m: vars.get(m.group(1), m.group(0)), template)


def incoming_wins_sql(incoming: str, existing: str, mode_param: str) -> str:
    p = CONTRACT["precedence"]
    both = fill(p["both_efile"], incoming=incoming, existing=existing)
    return fill(p["incoming_wins"], incoming=incoming, existing=existing,
                mode=mode_param, both_efile=both)


def audit_action_sql(incoming: str, existing: str, mode_param: str) -> str:
    p = CONTRACT["precedence"]
    both = fill(p["both_efile"], incoming=incoming, existing=existing)
    return fill(p["audit_action"],
                incoming_wins=incoming_wins_sql(incoming, existing, mode_param),
                both_efile=both)


# ---------------------------------------------------------------------------
# XML → row, driven by the concordance
# ---------------------------------------------------------------------------

import xml.etree.ElementTree as ET  # noqa: E402  (after the constants above)


def read_path(node, path: str) -> str | None:
    for seg in path.split("/"):
        if node is None:
            return None
        node = node.find(NS + seg)
    text = (node.text or "").strip() if node is not None else ""
    return text or None


def path_exists(node, path: str) -> bool:
    for seg in path.split("/"):
        if node is None:
            return False
        node = node.find(NS + seg)
    return node is not None


def parse_amount(raw: str | None) -> int | None:
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def normalise_ein(raw: str) -> str:
    digits = re.sub(r"\D", "", raw).zfill(9)
    return f"{digits[:2]}-{digits[2:]}"


def tax_period_from_end_date(raw: str | None) -> str | None:
    """Collapse TaxPeriodEndDt to first-of-month, matching the SOI key format.

    Getting this wrong does not error — it silently stops matching stored rows,
    so every row looks new and the conflict report is meaningless.
    """
    if not raw:
        return None
    m = re.match(r"^(\d{4})-(\d{2})", raw.strip())
    if not m or not 1 <= int(m.group(2)) <= 12:
        return None
    return f"{m.group(1)}-{m.group(2)}-01"


def submission_date_from_ts(raw: str | None) -> str | None:
    if not raw:
        return None
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", raw.strip())
    return m.group(1) if m else None


def object_id_from_entry(entry: str) -> str | None:
    m = re.search(r"(\d{12,})_public\.xml$", entry)
    return m.group(1) if m else None


def map_return(raw: bytes, entry: str, source_file: str) -> tuple[dict | None, str | None]:
    """Returns (row, skip_reason). Mirrors mapEfileReturn in efile-map.ts."""
    if raw[:3] == b"\xef\xbb\xbf":       # 1,997 of 2,000 entries carry a BOM
        raw = raw[3:]
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None, "malformed"
    if not root.tag.endswith("Return"):
        return None, "malformed"

    h = CONCORDANCE["header"]
    return_type = read_path(root, h["return_type"])
    form = CONCORDANCE["forms"].get(return_type or "")
    if form is None:
        return None, f"unsupported:{return_type}"

    raw_ein = read_path(root, h["ein"])
    if not raw_ein:
        return None, "missing_ein"
    tax_period = tax_period_from_end_date(read_path(root, h["tax_period_end"]))
    if not tax_period:
        return None, "bad_tax_period"

    form_root = root
    for seg in form["root"].split("/"):
        form_root = form_root.find(NS + seg) if form_root is not None else None

    row: dict[str, Any] = {
        "ein": normalise_ein(raw_ein),
        "tax_period": tax_period,
        "fiscal_year": int(tax_period[:4]),
        "form_type": return_type,
        "data_source": "efile_xml",
        "object_id": object_id_from_entry(entry),
        "dln": None,
        "submission_date": submission_date_from_ts(read_path(root, h["submission_ts"])),
        "is_amended": path_exists(form_root, form["amended_flag"]),
        "source_file": source_file,
        # not a filings column; used for the organizations upsert
        "_name": read_path(root, h["name"]),
        "_state": read_path(root, h["state"]),
    }
    for column, path in form["columns"].items():
        row[column] = parse_amount(read_path(form_root, path))

    for rule in CONCORDANCE["derived"]:
        if return_type in rule["applies_to"] and rule["rule"] == "revenue_residual":
            total = row.get("total_revenue")
            row[rule["column"]] = None if total is None else (
                total - (row.get("contributions") or 0)
                - (row.get("program_revenue") or 0)
                - (row.get("investment_income") or 0)
            )
    return row, None


# ---------------------------------------------------------------------------
# Archive streaming
# ---------------------------------------------------------------------------

def open_archive(path: str | None, url: str | None) -> tuple[zipfile.ZipFile, str]:
    """A ZipFile plus the name to record as source_file.

    A URL is buffered in memory rather than written to disk: the largest archive
    is 521 MB, which is cheaper to hold than to leave lying around, and it keeps
    an unattended run from filling the disk over 24 archives.
    """
    if path:
        return zipfile.ZipFile(path), os.path.basename(path)
    assert url
    name = url.rsplit("/", 1)[-1]
    print(f"[{name}] downloading ...", flush=True)
    buf = io.BytesIO()
    req = urllib.request.Request(url, headers={"User-Agent": "westridge-datahub/1.0"})
    with urllib.request.urlopen(req) as resp:  # noqa: S310 — fixed IRS host
        total = int(resp.headers.get("Content-Length") or 0)
        got = 0
        while True:
            chunk = resp.read(DOWNLOAD_CHUNK)
            if not chunk:
                break
            buf.write(chunk)
            got += len(chunk)
            if total:
                print(f"\r[{name}] {got/1048576:.0f}/{total/1048576:.0f} MB", end="", flush=True)
        print(flush=True)
    buf.seek(0)
    return zipfile.ZipFile(buf), name


DEFLATE64 = 9


def read_entry(zf: zipfile.ZipFile, entry: str) -> bytes:
    """Read one entry, falling back to a Deflate64 decoder when needed.

    Five of the 24 published archives use Deflate64 (method 9) — including the
    largest, 2026_05A at 168,344 returns — and Python's zipfile implements only
    stored, deflate, bzip2 and lzma. It is not an exotic edge case here, so the
    fallback reads the raw compressed bytes straight out of the local header and
    inflates them with `inflate64`.

    Note this affects the browser uploader too: fflate does not implement
    Deflate64 either, so those five archives must be loaded with this CLI.
    """
    info = zf.getinfo(entry)
    if info.compress_type != DEFLATE64:
        return zf.read(entry)
    if inflate64 is None:
        raise NotImplementedError(
            f"{entry} uses Deflate64 and the `inflate64` package is not installed "
            "(pip install inflate64)"
        )
    fp = zf.fp
    assert fp is not None
    fp.seek(info.header_offset)
    head = fp.read(30)
    name_len, extra_len = struct.unpack("<HH", head[26:30])
    fp.seek(info.header_offset + 30 + name_len + extra_len)
    out = inflate64.Inflater().inflate(fp.read(info.compress_size))
    if len(out) != info.file_size:
        raise zipfile.BadZipFile(
            f"{entry}: Deflate64 produced {len(out)} bytes, expected {info.file_size}"
        )
    return out


def iter_returns(zf: zipfile.ZipFile, source_file: str, limit: int | None,
                 skips: Counter) -> Iterator[dict]:
    seen = 0
    for entry in zf.namelist():
        if not entry.endswith(".xml"):
            continue
        try:
            raw = read_entry(zf, entry)
        except (zipfile.BadZipFile, OSError) as exc:
            skips[f"unreadable_entry:{type(exc).__name__}"] += 1
            continue
        row, reason = map_return(raw, entry, source_file)
        if row is None:
            skips[reason] += 1
            continue
        yield row
        seen += 1
        if limit and seen >= limit:
            return


# ---------------------------------------------------------------------------
# Writing, with the shared precedence rule
# ---------------------------------------------------------------------------

def qualify(table: str, schema: str | None) -> str:
    return f'"{schema}".{table}' if schema else table


def build_upsert(n_rows: int, mode_param: str, schema: str | None) -> str:
    """The same statement shape as buildFilingsUpsert in upsert-sql.ts.

    One statement: sibling CTEs share a snapshot, so `prior` sees the pre-upsert
    state while `upserted` rewrites those same rows. Splitting it would open a
    window where a concurrent load changes what gets audited.
    """
    filings = qualify("filings", schema)
    cols = ", ".join(COLUMNS)

    # The first tuple carries explicit casts so Postgres can infer column types
    # for the whole VALUES list. Without them a batch in which some column is
    # NULL in every row fails type inference outright.
    # Named placeholders, not positional. The precedence rule interpolates the
    # mode placeholder once per column, and psycopg2 substitutes %s
    # positionally — so a reused positional placeholder runs out of parameters
    # ("IndexError: list index out of range"). TypeScript reuses $1 for the
    # same job; %(mode)s is the psycopg2 equivalent.
    pg_type = {"int": "integer"}
    tuples = []
    for r in range(n_rows):
        cells = []
        for i, c in enumerate(CONTRACT["columns"]):
            ph = f"%(v{r}_{i})s"
            cells.append(f'{ph}::{pg_type.get(c["type"], c["type"])}' if r == 0 else ph)
        tuples.append("(" + ",".join(cells) + ")")
    values = ", ".join(tuples)

    wins = incoming_wins_sql("EXCLUDED", filings, mode_param)
    set_clause = ",\n        ".join(
        f"{c} = CASE WHEN {wins} THEN COALESCE(EXCLUDED.{c}, {filings}.{c}) "
        f"ELSE {filings}.{c} END"
        for c in COLUMNS if c not in KEY_COLUMNS
    )
    wins_audit = incoming_wins_sql("i", "p", mode_param)
    action = audit_action_sql("i", "p", mode_param)
    loser = lambda c: f"CASE WHEN {wins_audit} THEN p.{c} ELSE i.{c} END"      # noqa: E731
    winner = lambda c: f"CASE WHEN {wins_audit} THEN i.{c} ELSE p.{c} END"     # noqa: E731

    return f"""
    WITH incoming ({cols}) AS (VALUES {values}),
    prior AS (
      SELECT f.ein, f.tax_period, f.form_type, f.data_source, f.object_id, f.submission_date
      FROM {filings} f
      JOIN incoming i ON f.ein = i.ein AND f.tax_period = i.tax_period
    ),
    upserted AS (
      INSERT INTO {filings} ({cols})
      SELECT {cols} FROM incoming
      ON CONFLICT (ein, tax_period) DO UPDATE SET
        {set_clause}
      RETURNING 1
    )
    INSERT INTO {qualify('ingest_audit', schema)} (
      ein, tax_period, form_type, action,
      losing_source, losing_object_id, losing_submission_date,
      winning_source, winning_object_id, winning_submission_date, source_file
    )
    SELECT p.ein, p.tax_period, COALESCE(i.form_type, p.form_type), {action} AS action,
           {loser('data_source')}, {loser('object_id')}, {loser('submission_date')},
           {winner('data_source')}, {winner('object_id')}, {winner('submission_date')},
           i.source_file
    FROM prior p JOIN incoming i ON i.ein = p.ein AND i.tax_period = p.tax_period
    RETURNING action
    """


def dedupe_batch(rows: list[dict]) -> tuple[list[dict], int]:
    """Collapse duplicate (ein, tax_period) keys, later submission wins.

    Postgres refuses to let one ON CONFLICT DO UPDATE touch the same row twice
    ("cannot affect row a second time"), and a single archive really does
    contain two returns for the same key when an organisation amended within
    the month. Cross-batch duplicates are fine — the second batch takes the
    normal conflict path — so this only has to hold within one statement.

    The winner is chosen by the same rule the SQL applies: later
    submission_date wins, a missing date sorting earliest.
    """
    best: dict[tuple[str, str], dict] = {}
    for r in rows:
        k = (r["ein"], r["tax_period"])
        cur = best.get(k)
        if cur is None or (r.get("submission_date") or "") >= (cur.get("submission_date") or ""):
            best[k] = r
    return list(best.values()), len(rows) - len(best)


def upsert_batch(conn, rows: list[dict], mode: str, schema: str | None) -> Counter:
    """Organizations first (the FK), then filings with precedence."""
    counts = Counter()
    rows, collapsed = dedupe_batch(rows)
    counts["deduped"] = collapsed
    named = {}
    for r in rows:
        if r.get("_name") and r["ein"] not in named:
            named[r["ein"]] = (r["_name"], r.get("_state"))

    with conn.cursor() as cur:
        if named:
            # The e-file XML carries names and states, unlike the SOI extracts,
            # so this path can create organizations the BMF has not caught up
            # with. The BMF stays authoritative: only fill what is NULL.
            org_sql = f"""
                INSERT INTO {qualify('organizations', schema)} (ein, name, state)
                VALUES %s
                ON CONFLICT (ein) DO UPDATE SET
                  name  = COALESCE({qualify('organizations', schema)}.name, EXCLUDED.name),
                  state = COALESCE({qualify('organizations', schema)}.state, EXCLUDED.state)
            """
            psycopg2.extras.execute_values(
                cur, org_sql, [(e, n, s) for e, (n, s) in named.items()],
                page_size=len(named),
            )
            counts["orgs_touched"] = len(named)

        params: dict[str, Any] = {"mode": mode}
        for r_i, r in enumerate(rows):
            for c_i, col in enumerate(COLUMNS):
                params[f"v{r_i}_{c_i}"] = r.get(col)
        cur.execute(build_upsert(len(rows), "%(mode)s", schema), params)
        for (action,) in cur.fetchall():
            counts[action] += 1
    conn.commit()
    counts["inserted"] = len(rows) - (
        counts["skipped"] + counts["overwritten"] + counts["superseded"]
    )
    return counts


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def year_archive_urls(year: int) -> list[str]:
    """Archive URLs for a year, discovered from the IRS downloads page."""
    page = urllib.request.urlopen(urllib.request.Request(  # noqa: S310
        "https://www.irs.gov/charities-non-profits/form-990-series-downloads",
        headers={"User-Agent": "westridge-datahub/1.0"},
    )).read().decode("utf8", "replace")
    found = re.findall(rf'href="({ARCHIVE_BASE}/{year}/[^"]+\.zip)"', page)
    return sorted(set(found))


def ingest_archive(conn, zf: zipfile.ZipFile, name: str, args) -> None:
    skips: Counter = Counter()
    totals: Counter = Counter()
    batch: list[dict] = []
    started = time.time()
    n = 0

    def flush() -> None:
        nonlocal batch
        if not batch:
            return
        if not args.dry_run:
            totals.update(upsert_batch(conn, batch, args.on_conflict, args.schema))
        batch = []

    for row in iter_returns(zf, name, args.limit, skips):
        batch.append(row)
        n += 1
        if len(batch) >= BATCH_SIZE:
            flush()
            print(f"\r[{name}] {n:,} returns ...", end="", flush=True)
    flush()
    print(f"\r[{name}] {n:,} returns mapped in {time.time()-started:.0f}s", flush=True)

    if skips:
        parts = [f"{v:,} {k}" for k, v in skips.most_common()]
        print(f"[{name}] skipped: " + ", ".join(parts), flush=True)
    if args.dry_run:
        print(f"[{name}] DRY RUN — nothing written", flush=True)
    else:
        print(f"[{name}] inserted {totals['inserted']:,} · "
              f"overwritten {totals['overwritten']:,} · "
              f"superseded {totals['superseded']:,} · "
              f"skipped {totals['skipped']:,} · "
              f"orgs touched {totals['orgs_touched']:,}"
              + (f" · {totals['deduped']:,} same-period duplicates collapsed"
                 if totals['deduped'] else ""), flush=True)


def main() -> None:
    load_dotenv()
    load_dotenv(ROOT / "apps/web/.env.local", override=True)

    ap = argparse.ArgumentParser(description="Bulk-load IRS e-file XML archives")
    src = ap.add_argument_group("source (at least one)")
    src.add_argument("--zip", action="append", default=[], metavar="PATH",
                     help="local archive; repeatable")
    src.add_argument("--url", action="append", default=[], metavar="URL",
                     help="archive URL, streamed without touching disk; repeatable")
    src.add_argument("--year", action="append", type=int, default=[], metavar="YYYY",
                     help="every archive published for this year; repeatable")
    ap.add_argument("--on-conflict", choices=CONTRACT["conflict_modes"], default="skip",
                    help="cross-source conflicts (default: skip). e-file resubmissions "
                         "are always resolved by submission date regardless")
    ap.add_argument("--dry-run", action="store_true", help="map and report, write nothing")
    ap.add_argument("--limit", type=int, default=None, help="stop after N returns per archive")
    ap.add_argument("--schema", default=None,
                    help="write to this schema instead of public (for testing)")
    args = ap.parse_args()

    if not (args.zip or args.url or args.year):
        ap.error("give at least one of --zip, --url or --year")

    urls = list(args.url)
    for year in args.year:
        found = year_archive_urls(year)
        print(f"[{year}] {len(found)} archives published", flush=True)
        urls.extend(found)

    conn = None
    if not args.dry_run:
        database_url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
        if not database_url:
            print("ERROR: DATABASE_URL not set", file=sys.stderr)
            sys.exit(1)
        conn = psycopg2.connect(database_url)

    failed: list[tuple[str, str]] = []

    def run(path: str | None, url: str | None) -> None:
        name = os.path.basename(path) if path else url.rsplit("/", 1)[-1]  # type: ignore[union-attr]
        try:
            zf, name = open_archive(path, url)
            ingest_archive(conn, zf, name, args)
        except NotImplementedError:
            # An unsupported compression method must cost one archive, not the
            # whole run. The first backfill lost 19 good archives to one bad one.
            failed.append((name, "Deflate64 — unsupported by Python's zipfile"))
            print(f"[{name}] SKIPPED: compression method not supported "
                  f"(Deflate64). See scripts/README.md", flush=True)
        except Exception as exc:                              # noqa: BLE001
            failed.append((name, f"{type(exc).__name__}: {exc}"))
            print(f"[{name}] FAILED: {type(exc).__name__}: {exc}", flush=True)

    try:
        for path in args.zip:
            run(path, None)
        for url in urls:
            run(None, url)
    finally:
        if conn:
            conn.close()
    if failed:
        print(f"\n{len(failed)} archive(s) not loaded:")
        for name, why in failed:
            print(f"  {name}: {why}")
        print("\nEverything else loaded. Re-run with just those once resolved.")
    print("\nDone.")


if __name__ == "__main__":
    main()
