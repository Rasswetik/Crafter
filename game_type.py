"""Admin: game type (demo -> real) and a complete reset of player data.

The reset wipes everything players accumulated: GRAM balances, inventories, purchase/transaction history,
listings, offers, staking, referral balances, promo claims, arena entries, event awards and balls.
It KEEPS: user accounts, connected wallets, bans, and all admin configuration.
Gifts that really sit on the relayer account are credited back to the player who deposited them.
On-chain deposit records are kept so an old TON transfer can never be credited twice.
"""
import asyncio
import json
import time

from flask import abort, request

# Player data. Tables missing in a given deployment are skipped.
PLAYER_TABLES = (
    'history', 'local_purchases', 'local_sold', 'local_numbers', 'craft_quotes', 'craft_requests',
    'upgrade_quotes', 'upgrade_requests', 'market_test_receipts', 'market_test_sale_receipts',
    'crafter_offers', 'crafter_offer_quotes', 'crafter_listings', 'crafter_sale_receipts',
    'gift_transfers', 'gift_withdrawals', 'nft_withdraw_fee_receipts', 'auto_nft_jobs',
    'staking_entries', 'staking_rewards', 'staking_accounts',
    'referral_balances', 'referral_earnings', 'referral_withdrawals', 'promo_claims',
    'new_year_wallets', 'new_year_receipts', 'new_year_trade_remainders', 'new_year_trade_rewards',
    'arena_stakes', 'arena_rounds', 'arena_private_stakes', 'arena_private_rounds', 'arena_private_members',
    'arena_private_rooms', 'crafter_event_awards', 'crafter_announcement_visits',
    'thermos_orders', 'thermos_order_items', 'portals_partner_orders', 'portals_partner_order_items',
    'portals_partner_withdrawals', 'wallet_balances',
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

    def relayer_slugs():
        """Slugs the relayer holds right now, or None when it cannot be checked."""
        try:
            api_id, api_hash, session, _account = app.extensions['crafter_relayer_credentials']()
            import relayer_transfer
            return asyncio.run(relayer_transfer.held_slugs(api_id, api_hash, session))
        except Exception:
            return None

    def restorable(slugs):
        """Receipts whose gift is still on the relayer -> [(recipient_id, gift_payload)]."""
        out = []
        for row in db().execute("SELECT slug,recipient_id,payload FROM telegram_gift_receipts "
                                "WHERE status='credited' AND recipient_id IS NOT NULL").fetchall():
            if str(row['slug']).lower() in slugs:
                try:
                    out.append((row['recipient_id'], json.loads(row['payload'])))
                except (ValueError, TypeError):
                    pass
        return out

    def overview():
        tables = existing_tables()
        return {'type': 'demo' if app.config['DEMO_MODE'] else 'real',
                'demo_mode': bool(app.config['DEMO_MODE']),
                'purchase_mode': app.extensions['crafter_purchase_mode'](),
                'accounts': db().execute('SELECT count(*) FROM demo_accounts').fetchone()[0],
                'gifts_total': db().execute('SELECT count(*) FROM inventory').fetchone()[0],
                'history_rows': db().execute('SELECT count(*) FROM history').fetchone()[0],
                'wallets_kept': db().execute('SELECT count(*) FROM connected_wallets').fetchone()[0]
                if 'connected_wallets' in tables else 0}

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

    @app.get('/api/admin/data-reset')
    @auth(admin=True)
    def data_reset_preview():
        slugs = relayer_slugs()
        tables = existing_tables()
        restore = len(restorable(slugs)) if slugs is not None and 'telegram_gift_receipts' in tables else None
        return {**overview(), 'relayer_checked': slugs is not None, 'gifts_to_restore': restore}

    def run_reset():
        slugs = relayer_slugs()                     # network call BEFORE the write transaction
        removed = {}
        with db():
            db().execute('BEGIN IMMEDIATE')
            tables = existing_tables()
            gifts = restorable(slugs) if slugs is not None and 'telegram_gift_receipts' in tables else None
            if gifts is not None:
                removed['inventory'] = db().execute('SELECT count(*) FROM inventory').fetchone()[0]
                db().execute('DELETE FROM inventory')
            else:
                # Relayer cannot be checked: never lose deposited gifts; keep them, drop everything else.
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
                db().execute("UPDATE inventory SET status='unlisted'")
                removed['inventory'] = len(doomed)
            for table in PLAYER_TABLES:
                if table in tables:
                    db().execute('DELETE FROM ' + table)
                    removed[table] = True
            db().execute("UPDATE demo_accounts SET balance='0'")
            restored = 0
            for user_id, gift in (gifts or []):
                db().execute('INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,?) '
                             'ON CONFLICT DO NOTHING', (user_id, gift['id'], json.dumps(gift), 'unlisted'))
                restored += 1
        audit('ALL player data reset (wallets kept, relayer gifts restored: %d)' % restored)
        return {'ok': True, 'removed': removed, 'restored_gifts': restored, 'relayer_checked': slugs is not None}

    @app.post('/api/admin/data-reset')
    @auth(admin=True)
    def data_reset():
        if (request.get_json(silent=True) or {}).get('confirm') != 'RESET_ALL_PLAYER_DATA':
            abort(400, description='Подтвердите полный сброс данных')
        return {**run_reset(), **overview()}

    @app.post('/api/admin/game-type/reset')       # alias kept for the first admin card version
    @auth(admin=True)
    def game_type_reset():
        if (request.get_json(silent=True) or {}).get('confirm') != 'RESET_ALL_STATS':
            abort(400, description='Подтвердите полный сброс')
        return {**run_reset(), **overview()}
