"""Crafter gift staking: transactional escrow in the existing inventory database.

GRAM rewards here are internal Crafter balance, NOT blockchain transfers.
Each full 24h period creates one immutable daily reward at the snapshotted APR.
"""
import json
import os
import threading
import time
import uuid
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP
from flask import request, abort, g

DAY = 86400
AMOUNT = Decimal('0.000001')
DEFAULTS = {'enabled': True, 'apr_bps': 4300, 'lock_days': 7, 'limit_gram': '50.00'}
MINT_CAP_DAYS = 365
CLAIM_MINIMUM = Decimal('1.00')


def decimal_amount(value):
    try:
        result = Decimal(str(value))
    except (TypeError, InvalidOperation, ValueError):
        return None
    if not result.is_finite():
        return None
    return result


def install_staking(app, db, auth, record, audit, staking_catalog, canonical_name, demo_prices):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS staking_accounts (
                user_id INTEGER PRIMARY KEY, activated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS staking_entries (
                id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
                nft_id TEXT NOT NULL, gift_json TEXT NOT NULL,
                value_gram TEXT NOT NULL, apr_bps INTEGER NOT NULL,
                locked_at INTEGER NOT NULL, unlock_at INTEGER NOT NULL,
                locked_days INTEGER NOT NULL, settled_days INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL, withdrawn_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS staking_rewards (
                entry_id TEXT NOT NULL, day_no INTEGER NOT NULL, user_id INTEGER NOT NULL,
                amount TEXT NOT NULL, credited_at INTEGER NOT NULL,
                claimed INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (entry_id,day_no)
            );
        """)

    def settings():
        row = db().execute("SELECT payload FROM settings WHERE key='staking_config'").fetchone()
        value = json.loads(row['payload']) if row else {}
        return {**DEFAULTS, **value}

    def money(value):
        return format(value.quantize(AMOUNT, rounding=ROUND_DOWN), 'f')

    def total_gifts(uid):
        rows = db().execute(
            "SELECT value_gram FROM staking_entries WHERE user_id=? AND status='active'", (uid,))
        return sum((Decimal(r['value_gram']) for r in rows), Decimal('0'))

    def gift_value(gift, floors):
        # Never use a user-edited listing amount to calculate rewards.
        # Catalog floors are the application valuation; fallback only to purchase/grant
        # snapshots for gifts with no currently known collection floor.
        collection = str(gift.get('collection_id') or '').lower()
        name = canonical_name(gift.get('name') or '')
        price = floors.get(collection) or floors.get(name) or decimal_amount(demo_prices.get(gift.get('id')))
        if price is None and gift.get('origin') in ('admin-grant', 'application-craft', 'local-purchase'):
            price = decimal_amount(gift.get('source_price') or gift.get('floor_price') or gift.get('price'))
        if price is None or price <= 0 or price > 100000:
            return None
        return price.quantize(Decimal('0.000001'), rounding=ROUND_DOWN)

    def floors_map():
        result = {}
        for item in staking_catalog():
            price = decimal_amount(item.get('floor_price'))
            if price is None or price <= 0 or price > 100000:
                continue
            if item.get('id'):
                result[str(item['id']).lower()] = price
            name = canonical_name(item.get('name') or '')
            if name:
                result[name] = price
        return result

    def settle_locked(now=None, uid=None):
        # Ledger is idempotent across Gunicorn workers and concurrent requests.
        now = int(time.time()) if now is None else int(now)
        with db():
            db().execute('BEGIN IMMEDIATE')
            if uid is None:
                rows = db().execute(
                    "SELECT * FROM staking_entries WHERE status='active' AND locked_at <= ?",
                    (now - DAY,)).fetchall()
            else:
                rows = db().execute(
                    "SELECT * FROM staking_entries WHERE user_id=? AND status='active'",
                    (uid,)).fetchall()
            rewards_created = 0
            for entry in rows:
                completed = min(
                    max(0, (now - int(entry['locked_at'])) // DAY),
                    int(entry['locked_days']),
                    MINT_CAP_DAYS,
                )
                start = int(entry['settled_days'])
                if completed <= start:
                    continue
                daily = (Decimal(entry['value_gram']) * Decimal(int(entry['apr_bps']))
                         / Decimal(10000 * 365)).quantize(AMOUNT, rounding=ROUND_DOWN)
                for day in range(start + 1, completed + 1):
                    changed = db().execute("""
                        INSERT INTO staking_rewards(entry_id,day_no,user_id,amount,credited_at,claimed)
                        VALUES(?,?,?,?,?,0)
                        ON CONFLICT(entry_id,day_no) DO NOTHING
                    """, (entry['id'], day, entry['user_id'], money(daily), now)).rowcount
                    if changed:
                        rewards_created += 1
                        if daily:
                            record('stake_reward', {'entry_id': entry['id'],
                                                   'gift_id': entry['nft_id'],
                                                   'amount': money(daily), 'day': day},
                                   uid=int(entry['user_id']))
                db().execute("UPDATE staking_entries SET settled_days=? WHERE id=? AND settled_days<?",
                             (completed, entry['id'], completed))
            return rewards_created

    def balance_summary(uid):
        rows = db().execute("""
            SELECT amount,claimed FROM staking_rewards WHERE user_id=?
        """, (uid,)).fetchall()
        pending = sum((Decimal(r['amount']) for r in rows if not r['claimed']), Decimal('0'))
        claimed = sum((Decimal(r['amount']) for r in rows if r['claimed']), Decimal('0'))
        return pending, claimed

    def snapshot(uid):
        settle_locked(uid=uid)
        s = settings()
        account = db().execute('SELECT activated_at FROM staking_accounts WHERE user_id=?', (uid,)).fetchone()
        rows = db().execute("SELECT * FROM staking_entries WHERE user_id=? AND status='active' ORDER BY locked_at DESC,id", (uid,)).fetchall()
        gifts = []
        rewards_by_entry = {}
        for reward in db().execute(
                'SELECT entry_id,amount FROM staking_rewards WHERE user_id=?', (uid,)):
            eid = reward['entry_id']
            rewards_by_entry[eid] = rewards_by_entry.get(eid, Decimal('0')) + Decimal(reward['amount'])
        total = Decimal('0')
        daily = Decimal('0')
        now = int(time.time())
        for entry in rows:
            value = Decimal(entry['value_gram'])
            total += value
            if now < int(entry['unlock_at']):
                daily += value * Decimal(entry['apr_bps']) / Decimal(10000 * 365)
            gifts.append({
                'id': entry['id'], 'gift': json.loads(entry['gift_json']),
                'value_gram': entry['value_gram'],
                'apr_percent': str(Decimal(entry['apr_bps']) / 100),
                'locked_at': entry['locked_at'], 'unlock_at': entry['unlock_at'],
                'can_unstake': now >= int(entry['unlock_at']),
                'settled_days': int(entry['settled_days']),
                'earned_gram': money(rewards_by_entry.get(entry['id'], Decimal('0'))),
            })
        pending, claimed = balance_summary(uid)
        return {
            'enabled': s['enabled'],
            'activated': bool(account),
            'settings': {
                'apr_percent': str(Decimal(s['apr_bps']) / 100),
                'lock_days': s['lock_days'],
                'limit_gram': s['limit_gram'],
                'claim_minimum_gram': str(CLAIM_MINIMUM),
            },
            'server_time': now,
            'total_staked_gram': money(total),
            'estimated_daily_gram': money(daily),
            'earned_pending_gram': money(pending),
            'earned_claimed_gram': money(claimed),
            'gifts': gifts,
        }

    @app.get('/api/staking')
    @auth()
    def staking_status():
        return snapshot(int(g.user['id']))

    @app.post('/api/staking/activate')
    @auth()
    def staking_activate():
        if not settings()['enabled']:
            abort(409, description='Стейкинг временно отключён')
        uid = int(g.user['id'])
        with db():
            db().execute("INSERT INTO staking_accounts(user_id,activated_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING",
                         (uid, int(time.time())))
        return snapshot(uid)

    @app.post('/api/staking/deposit')
    @auth()
    def staking_deposit():
        if not settings()['enabled']:
            abort(409, description='Стейкинг временно отключён')
        data = request.get_json(silent=True)
        ids = data.get('gift_ids') if isinstance(data, dict) else None
        if not isinstance(ids, list) or not 1 <= len(ids) <= 30 or any(
                not isinstance(i, str) or not 1 <= len(i) <= 200 for i in ids
        ) or len(set(ids)) != len(ids):
            abort(400, description='Выберите от 1 до 30 различных подарков')
        uid = int(g.user['id'])
        if not db().execute("SELECT 1 FROM staking_accounts WHERE user_id=?", (uid,)).fetchone():
            abort(409, description='Сначала активируйте стейкинг')
        # Get floor valuation outside the write transaction to reduce lock contention.
        floors = floors_map()
        now = int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            s = settings()
            if not s['enabled']:
                abort(409, description='Стейкинг временно отключён')
            qmarks = ','.join('?' for _ in ids)
            rows = db().execute(
                f"SELECT nft_id,payload,status FROM inventory WHERE user_id=? AND nft_id IN ({qmarks})",
                [uid, *ids]).fetchall()
            gifts = {r['nft_id']: r for r in rows}
            if len(gifts) != len(ids) or any(gifts[i]['status'] != 'unlisted' for i in ids):
                abort(409, description='Подарок недоступен для стейкинга')
            valued = []
            for i in ids:
                item = json.loads(gifts[i]['payload'])
                if item.get('catalog_only') or item.get('pack_item'):
                    abort(409, description='Нельзя заморозить каталоговую модель')
                value = gift_value(item, floors)
                if value is None:
                    abort(409, description='Нет оценки для стейкинга: ' + str(item.get('name') or 'подарок'))
                valued.append((i, item, value))
            incoming = sum((value for _,_,value in valued), Decimal('0'))
            if incoming + total_gifts(uid) > Decimal(s['limit_gram']):
                abort(409, description='Превышен лимит стейкинга ' + s['limit_gram'] + ' GRAM')
            days = int(s['lock_days'])
            for nft_id, item, value in valued:
                updated = db().execute(
                    "UPDATE inventory SET status='staked' WHERE user_id=? AND nft_id=? AND status='unlisted'",
                    (uid, nft_id)).rowcount
                if updated != 1:
                    abort(409, description='Подарок уже недоступен')
                db().execute("""
                    INSERT INTO staking_entries
                    (id,user_id,nft_id,gift_json,value_gram,apr_bps,locked_at,unlock_at,
                     locked_days,settled_days,status,withdrawn_at)
                    VALUES(?,?,?,?,?,?,?,?,?,0,'active',NULL)
                """, (uuid.uuid4().hex, uid, nft_id, json.dumps(item), money(value),
                      s['apr_bps'], now, now + days*DAY, days))
            record('stake_deposit', {'gift_ids': ids, 'value_gram': money(incoming), 'lock_days': days})
        return snapshot(uid)

    @app.post('/api/staking/withdraw')
    @auth()
    def staking_withdraw():
        data = request.get_json(silent=True)
        entry_id = data.get('entry_id') if isinstance(data, dict) else None
        if not isinstance(entry_id, str) or len(entry_id) != 32 or any(
                c not in '0123456789abcdef' for c in entry_id):
            abort(400, description='Некорректный подарок')
        uid = int(g.user['id'])
        now = int(time.time())
        settle_locked(now, uid)
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute(
                "SELECT * FROM staking_entries WHERE id=? AND user_id=? AND status='active'",
                (entry_id, uid)).fetchone()
            if not row:
                abort(404, description='Подарок не найден в стейкинге')
            if now < int(row['unlock_at']):
                abort(409, description='Срок блокировки ещё не закончился')
            updated = db().execute(
                "UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=? AND status='staked'",
                (uid, row['nft_id'])).rowcount
            if updated != 1:
                abort(409, description='Не удалось вернуть подарок в инвентарь')
            db().execute(
                "UPDATE staking_entries SET status='withdrawn',withdrawn_at=? WHERE id=?",
                (now, entry_id))
            record('stake_withdraw', {'gift_id': row['nft_id'], 'entry_id': entry_id})
        return snapshot(uid)

    @app.post('/api/staking/claim')
    @auth()
    def staking_claim():
        uid = int(g.user['id'])
        settle_locked(uid=uid)
        with db():
            db().execute('BEGIN IMMEDIATE')
            pending, _ = balance_summary(uid)
            if pending < CLAIM_MINIMUM:
                abort(409, description='Минимальная сумма получения — 1 GRAM')
            updated = db().execute(
                'UPDATE staking_rewards SET claimed=1 WHERE user_id=? AND claimed=0', (uid,)).rowcount
            if not updated:
                abort(409, description='Нечего получать')
            row = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
            existing = Decimal(row['balance']) if row else Decimal('0')
            # Credits only in the app ledger, never as an on-chain promise/transfer.
            db().execute("""INSERT INTO demo_accounts(user_id,balance) VALUES(?,?)
                ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance""",
                         (uid, money(existing + pending)))
            record('stake_claim', {'amount_gram': money(pending), 'reward_days': updated})
        return snapshot(uid)

    @app.get('/api/admin/staking')
    @auth(admin=True)
    def staking_admin_settings():
        s = settings()
        count = db().execute("SELECT count(*) active FROM staking_entries WHERE status='active'").fetchone()
        return {'enabled': bool(s['enabled']), 'apr_percent': str(Decimal(s['apr_bps']) / 100),
                'limit_gram': s['limit_gram'], 'lock_days': s['lock_days'],
                'active_gifts': int(count['active'])}

    @app.post('/api/admin/staking')
    @auth(admin=True)
    def staking_admin_save():
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or type(data.get('enabled')) is not bool:
            abort(400, description='Укажите настройки стейкинга')
        apr = decimal_amount(data.get('apr_percent'))
        limit = decimal_amount(data.get('limit_gram'))
        days = data.get('lock_days')
        if apr is None or not 0 <= apr <= 500:
            abort(400, description='APR: от 0 до 500% годовых')
        if limit is None or not Decimal('0.01') <= limit <= Decimal('1000000'):
            abort(400, description='Лимит: от 0.01 до 1 000 000 GRAM')
        if type(days) is not int or not 1 <= days <= 365:
            abort(400, description='Срок блокировки: от 1 до 365 дней')
        apr_bps = int((apr * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        update = {
            'enabled': data['enabled'], 'apr_bps': apr_bps,
            'lock_days': days, 'limit_gram': money(limit),
        }
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('staking_config',?) "
                         "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (json.dumps(update),))
        audit('Staking APR and limits updated')
        return {'ok': True, 'settings': update}

    def sweep():
        # Requests settle lazily as a fallback if a Free instance sleeps.
        while True:
            try:
                with app.app_context():
                    settle_locked()
            except Exception as exc:
                app.logger.warning('Staking daily settlement failed (%s)', type(exc).__name__)
            time.sleep(90)

    if not app.config.get('TESTING') and os.getenv('STAKING_SETTLEMENT_POLL','1') == '1':
        threading.Thread(target=sweep, daemon=True, name='staking-settlement').start()
