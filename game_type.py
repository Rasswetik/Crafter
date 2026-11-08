"""Admin: game type (demo -> real) and a one-shot reset of demo-era inventories, balances and statistics.

Switching to a real balance turns demo mode off at runtime (persisted, survives restarts).
The reset keeps every gift that arrived through a genuine NFT transfer to the relayer
(origin 'telegram-deposit') and keeps the GRAM that users actually funded on-chain
(the verified ledger in wallet_balances); everything else is cleared.
"""
import json
import time
from decimal import Decimal, InvalidOperation

from flask import abort, request

# Tables holding demo-era state. Anything missing in a given deployment is skipped.
CLEAR_TABLES = (
    'history', 'local_purchases', 'local_sold', 'local_numbers', 'craft_quotes', 'craft_requests',
    'upgrade_quotes', 'upgrade_requests', 'market_test_receipts', 'market_test_sale_receipts',
    'crafter_offers', 'crafter_listings', 'crafter_sale_receipts',
    'staking_entries', 'staking_rewards', 'staking_accounts',     # everyone must activate staking again
)


def install_game_type(app, db, auth, audit):
    def setting():
        row = db().execute("SELECT payload FROM settings WHERE key='game_type_v1'").fetchone()
        try:
            return json.loads(row[0]).get('type') if row else None
        except (ValueError, TypeError, AttributeError):
            return None

    with app.app_context():
        if setting() == 'real':
            app.config['DEMO_MODE'] = False           # persisted choice wins over the environment

    def existing_tables():
        if app.config.get('DATABASE_URL'):
            rows = db().execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
        else:
            rows = db().execute("SELECT name FROM sqlite_master WHERE type='table'")
        return {r[0] for r in rows}

    def overview():
        gifts = db().execute('SELECT payload FROM inventory').fetchall()
        kept = sum(1 for r in gifts if json.loads(r['payload']).get('origin') == 'telegram-deposit')
        return {'type': 'demo' if app.config['DEMO_MODE'] else 'real',
                'demo_mode': bool(app.config['DEMO_MODE']),
                'purchase_mode': app.extensions['crafter_purchase_mode'](),
                'accounts': db().execute('SELECT count(*) FROM demo_accounts').fetchone()[0],
                'gifts_total': len(gifts), 'gifts_kept_on_reset': kept}

    @app.get('/api/admin/game-type')
    @auth(admin=True)
    def game_type_overview():
        return overview()

    @app.post('/api/admin/game-type/real')
    @auth(admin=True)
    def game_type_real():
        if (request.get_json(silent=True) or {}).get('confirm') != 'SWITCH_TO_REAL':
            abort(400, description='Подтвердите переход на настоящий баланс')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('game_type_v1',?) "
                         "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (json.dumps({'type': 'real', 'at': int(time.time())}),))
        app.config['DEMO_MODE'] = False
        audit('Game type switched to REAL balance')
        return overview()

    @app.post('/api/admin/game-type/reset')
    @auth(admin=True)
    def game_type_reset():
        if (request.get_json(silent=True) or {}).get('confirm') != 'RESET_ALL_STATS':
            abort(400, description='Подтвердите полный сброс')
        removed = {}
        with db():
            db().execute('BEGIN IMMEDIATE')
            tables = existing_tables()
            # 1) Inventory: keep only gifts that came in via a real NFT transfer to the relayer.
            doomed = []
            for row in db().execute('SELECT user_id,nft_id,payload FROM inventory').fetchall():
                try:
                    origin = json.loads(row['payload']).get('origin')
                except (ValueError, TypeError):
                    origin = None
                if origin != 'telegram-deposit':
                    doomed.append((row['user_id'], row['nft_id']))
            for user_id, nft_id in doomed:
                db().execute('DELETE FROM inventory WHERE user_id=? AND nft_id=?', (user_id, nft_id))
            db().execute("UPDATE inventory SET status='unlisted' WHERE status IN ('listed','withdrawing','staked','arena')")
            removed['inventory'] = len(doomed)
            # 2) Statistics, receipts, listings, offers.
            for table in CLEAR_TABLES:
                if table in tables:
                    db().execute('DELETE FROM ' + table)
                    removed[table] = True
            # 3) Balances: keep only GRAM funded by verified on-chain deposits.
            funded = {}
            if 'wallet_balances' in tables:
                for row in db().execute('SELECT user_id,gram FROM wallet_balances').fetchall():
                    try:
                        funded[row['user_id']] = funded.get(row['user_id'], Decimal(0)) + Decimal(str(row['gram']))
                    except (TypeError, ValueError, InvalidOperation):
                        pass
            accounts = db().execute('SELECT user_id,balance FROM demo_accounts').fetchall()
            for row in accounts:
                try:
                    keep = min(Decimal(str(row['balance'])), funded.get(row['user_id'], Decimal(0)))
                except (TypeError, ValueError, InvalidOperation):
                    keep = Decimal(0)
                db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',
                             (str(max(keep, Decimal(0))), row['user_id']))
            removed['accounts_reset'] = len(accounts)
        audit('Game statistics reset (kept telegram-deposit gifts and verified funds)')
        return {'ok': True, 'removed': removed, **overview()}
