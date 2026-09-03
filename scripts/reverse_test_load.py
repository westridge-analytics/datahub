#!/usr/bin/env python3
"""Undo the Phase 4 browser smoke-test load.

Reverses exactly what that load wrote, using the snapshot taken beforehand:
  - the 25 filings rows, matched on key AND data_source AND source_file
  - only the organizations rows the load itself created (the snapshot records
    which EINs already existed, and those are left alone)
  - the ingest_audit rows for that source_file

    python scripts/reverse_test_load.py --dry-run
    python scripts/reverse_test_load.py
"""
import argparse, json, os, sys
from pathlib import Path
import psycopg2
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "apps/web/.env.local")

ap = argparse.ArgumentParser()
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--snapshot", default=str(ROOT / ".reversal-snapshot.json"))
args = ap.parse_args()

snap = json.loads(Path(args.snapshot).read_text())
archive, keys = snap["archive"], snap["keys"]
eins, pre_existing = snap["eins"], set(snap["orgs_existing_before"])
ours = [e for e in eins if e not in pre_existing]

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
e_list = [k[0] for k in keys]
p_list = [k[1] for k in keys]

cur.execute("""SELECT count(*) FROM filings f
               JOIN (SELECT * FROM unnest(%s::text[], %s::date[]) AS t(ein,tp)) k
                 ON f.ein=k.ein AND f.tax_period=k.tp
               WHERE f.data_source='efile_xml' AND f.source_file=%s""",
            (e_list, p_list, archive))
n_filings = cur.fetchone()[0]
cur.execute("SELECT count(*) FROM ingest_audit WHERE source_file=%s", (archive,))
n_audit = cur.fetchone()[0]
cur.execute("SELECT count(*) FROM organizations WHERE ein = ANY(%s)", (ours,))
n_orgs = cur.fetchone()[0]

print(f"would remove:")
print(f"  filings       {n_filings}  (data_source='efile_xml', source_file='{archive}')")
print(f"  ingest_audit  {n_audit}")
print(f"  organizations {n_orgs}  (only EINs this load created; {len(pre_existing)} pre-existing left alone)")

if args.dry_run:
    print("\nDRY RUN — nothing deleted")
    sys.exit(0)

cur.execute("""DELETE FROM filings f
               USING (SELECT * FROM unnest(%s::text[], %s::date[]) AS t(ein,tp)) k
               WHERE f.ein=k.ein AND f.tax_period=k.tp
                 AND f.data_source='efile_xml' AND f.source_file=%s""",
            (e_list, p_list, archive))
d_filings = cur.rowcount
cur.execute("DELETE FROM ingest_audit WHERE source_file=%s", (archive,))
d_audit = cur.rowcount
# organizations last: filings references it
d_orgs = 0
if ours:
    cur.execute("DELETE FROM organizations WHERE ein = ANY(%s)", (ours,))
    d_orgs = cur.rowcount
conn.commit()
print(f"\ndeleted: {d_filings} filings, {d_audit} audit rows, {d_orgs} organizations")
conn.close()
