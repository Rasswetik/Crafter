"""Remove demo/test data so only real Portals-backed data remains.

Dry run by default. Nothing is deleted unless you pass --apply. SQLite files are
copied to <db>.bak-<timestamp> first; for PostgreSQL take a pg_dump yourself.

  python scripts/reset_demo_data.py                       # report only
  python scripts/reset_demo_data.py --apply               # delete demo gifts + their history
  python scripts/reset_demo_data.py --apply --local-purchases   # also gifts bought via local imitation
  python scripts/reset_demo_data.py --apply --balances    # also set every GRAM balance to 0 (DESTRUCTIVE)
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
import time

DEMO_ORIGINS = {'demo-craft', 'market-test'}


def is_demo(payload, include_local):
    try:
        gift = json.loads(payload)
    except (TypeError, ValueError):
        return False
    origin = gift.get('origin')
    return bool(gift.get('test_only') or origin in DEMO_ORIGINS
                or str(gift.get('id', '')).startswith('demo-')
                or (include_local and origin == 'local-purchase'))


def connect():
    url = os.getenv('DATABASE_URL', '')
    if url:
        import psycopg
        return psycopg.connect(url), '%s', None
    path = os.getenv('DATABASE', 'instance/app.sqlite3')
    return sqlite3.connect(path), '?', path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--local-purchases', action='store_true')
    ap.add_argument('--balances', action='store_true')
    args = ap.parse_args()
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    conn, ph, path = connect()
    cur = conn.cursor()
    cur.execute('SELECT user_id, nft_id, payload FROM inventory')
    doomed = [(u, n) for u, n, p in cur.fetchall() if is_demo(p, args.local_purchases)]
    cur.execute("SELECT count(*) FROM history WHERE payload LIKE '%\"test_only\": true%'")
    history = cur.fetchone()[0]
    print(f'demo gifts: {len(doomed)}; demo history rows: {history}; reset balances: {args.balances}')
    if not args.apply:
        print('Dry run. Re-run with --apply to delete.')
        return 0
    if path:
        backup = f'{path}.bak-{int(time.time())}'
        shutil.copy2(path, backup)
        print('backup:', backup)
    for user, nft in doomed:
        cur.execute(f'DELETE FROM inventory WHERE user_id={ph} AND nft_id={ph}', (user, nft))
    cur.execute("DELETE FROM history WHERE payload LIKE '%\"test_only\": true%'")
    cur.execute("DELETE FROM cache WHERE key LIKE 'demo%'")
    if args.balances:
        cur.execute("UPDATE demo_accounts SET balance='0'")
    conn.commit()
    print('done')
    return 0


if __name__ == '__main__':
    sys.exit(main())
