#!/usr/bin/env python3
"""Run a SQL migration file against the Neon database.

Usage:
    python scripts/run_migration.py                            # migrate_expand_filings.sql
    python scripts/run_migration.py migrate_efile_provenance.sql
    python scripts/run_migration.py /abs/path/to/migration.sql

A bare filename is resolved relative to this scripts/ directory. Migrations are
expected to manage their own transaction (BEGIN / COMMIT); psycopg2 wraps the
whole file in one anyway, so a failure part-way leaves nothing applied.
"""
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path(__file__).parent.parent / "apps/web/.env.local", override=True)

database_url = os.environ.get("DATABASE_URL")
if not database_url:
    print("ERROR: DATABASE_URL not set", file=sys.stderr)
    sys.exit(1)

arg = sys.argv[1] if len(sys.argv) > 1 else "migrate_expand_filings.sql"
sql_file = Path(arg)
if not sql_file.is_absolute():
    sql_file = Path(__file__).parent / arg

if not sql_file.exists():
    print(f"ERROR: migration file not found: {sql_file}", file=sys.stderr)
    sys.exit(1)

sql = sql_file.read_text()

host = database_url.split("@")[-1].split("/")[0] if "@" in database_url else "?"
print(f"Applying {sql_file.name} to {host} ...")
conn = psycopg2.connect(database_url)
try:
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    print(f"Migration complete: {sql_file.name}")
finally:
    conn.close()
