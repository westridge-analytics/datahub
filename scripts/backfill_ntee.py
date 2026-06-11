"""
Backfill missing NTEE codes from the ProPublica Nonprofit Explorer API.
Targets organizations in the DB with no ntee_code.

Usage:
  python scripts/backfill_ntee.py [--limit N] [--workers N] [--dry-run]

ProPublica API: https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json
No API key required. Rate limit: ~3 req/s to be safe.
"""

import os, sys, time, argparse, threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request, urllib.error, json

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / 'apps/web/.env.local', override=True)
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ['DATABASE_URL'].strip().strip('"')
PROPUBLICA_URL = 'https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json'
RATE_LIMIT_SLEEP = 0.35   # ~3 req/s per worker
REQUEST_TIMEOUT  = 8       # seconds

_lock = threading.Lock()
_stats = {'found': 0, 'not_found': 0, 'error': 0, 'done': 0}

def fetch_ntee(ein: str) -> str | None:
    url = PROPUBLICA_URL.format(ein=ein.replace('-', ''))
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'westridge-990-research/1.0'})
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read())
        ntee = data.get('organization', {}).get('ntee_code') or None
        return ntee.strip() if ntee else None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except Exception:
        raise

def process_batch(eins: list[str], dry_run: bool) -> dict:
    results = {}
    conn = psycopg2.connect(DATABASE_URL)
    try:
        for ein in eins:
            try:
                ntee = fetch_ntee(ein)
                time.sleep(RATE_LIMIT_SLEEP)
                if ntee:
                    results[ein] = ntee
                    if not dry_run:
                        with conn.cursor() as cur:
                            cur.execute('UPDATE organizations SET ntee_code = %s WHERE ein = %s', (ntee, ein))
                        conn.commit()
                    with _lock:
                        _stats['found'] += 1
                else:
                    with _lock:
                        _stats['not_found'] += 1
            except Exception:
                with _lock:
                    _stats['error'] += 1
            finally:
                with _lock:
                    _stats['done'] += 1
    finally:
        conn.close()
    return results

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit',   type=int, default=None, help='Max EINs to process (default: all)')
    parser.add_argument('--workers', type=int, default=4,    help='Parallel workers (default: 4)')
    parser.add_argument('--dry-run', action='store_true',    help='Fetch but do not write to DB')
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("""
        SELECT ein FROM organizations
        WHERE ntee_code IS NULL OR ntee_code = ''
        ORDER BY ein
        LIMIT %s
    """, (args.limit,) if args.limit else (None,))
    eins = [r[0] for r in cur.fetchall()]
    conn.close()

    total = len(eins)
    print(f'EINs to backfill: {total:,}  workers: {args.workers}  dry_run: {args.dry_run}')
    if total == 0:
        print('Nothing to do.')
        return

    # Split into per-worker batches
    batch_size = max(1, total // args.workers + 1)
    batches = [eins[i:i + batch_size] for i in range(0, total, batch_size)]

    start = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(process_batch, b, args.dry_run) for b in batches]
        last_report = time.time()
        while any(not f.done() for f in futures):
            time.sleep(5)
            elapsed = time.time() - start
            with _lock:
                done, found = _stats['done'], _stats['found']
            rate = done / elapsed if elapsed > 0 else 0
            eta  = (total - done) / rate if rate > 0 else 0
            print(f'  {done:,}/{total:,}  found={found:,}  {rate:.1f}/s  ETA {eta/60:.0f}m', flush=True)

    elapsed = time.time() - start
    print(f'\nDone in {elapsed/60:.1f}m')
    print(f"  found NTEE:  {_stats['found']:,}")
    print(f"  not found:   {_stats['not_found']:,}")
    print(f"  errors:      {_stats['error']:,}")

if __name__ == '__main__':
    main()
