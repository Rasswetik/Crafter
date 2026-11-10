"""House market: a burned gift is not destroyed, it goes back on sale.

A real gift (one that physically lies on our relayer / in the Thermos inventory) that is burned by a player — staked and
lost or won in an upgrade, used up in a craft — turns into nobody's gift: it is listed on the Crafter market at once, by the
"Crafter relayer" (the house account), at its floor price plus an optional markup. Crafter lots are shown first in
upgrades and crafts, so the next winner is paid with a gift that already sits on the relayer and nothing is bought on
Thermos (no fee, no waiting). Transfers to another player (arena) are not burning and never come here.
"""
import json
import time
import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from flask import abort, request

HOUSE_ID = -1                                   # the "Crafter relayer" seller; never a real Telegram user
REAL_ORIGINS = ('telegram-deposit', 'thermos', 'portals-partner', 'admin-grant')   # gifts that really are on the relayer
SETTINGS_KEY = 'house_market_v1'
CENT = Decimal('0.01')


def install_house_market(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS house_gifts(
            gift_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', number TEXT NOT NULL DEFAULT '', burned_by BIGINT NOT NULL,
            reason TEXT NOT NULL, price TEXT NOT NULL, created BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'listed'
        );
        """)

    def cfg():
        row = db().execute("SELECT payload FROM settings WHERE key=?", (SETTINGS_KEY,)).fetchone()
        base = {'enabled': True, 'markup_percent': 0}
        try:
            return {**base, **json.loads(row['payload'])} if row else base
        except (ValueError, TypeError):
            return base

    def positive(value):
        try:
            d = Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            return None
        return d if d.is_finite() and d > 0 else None

    def relist(gift, burned_by, reason, price_hint=None):
        """Called inside the transaction that burns the gift. True when the gift went on sale."""
        c = cfg()
        if not c['enabled'] or not isinstance(gift, dict) or not gift.get('id'):
            return False
        if (gift.get('origin') not in REAL_ORIGINS or gift.get('test_only') or gift.get('catalog_only') or gift.get('star_gift')
                or gift.get('pack_item')):
            return False
        price = positive(price_hint)
        if price is None and gift.get('price_unit', 'GRAM') == 'GRAM':
            price = positive(gift.get('price'))
        if price is None:
            return False
        price = (price * (Decimal(100) + Decimal(str(c['markup_percent']))) / Decimal(100)).quantize(CENT, rounding=ROUND_HALF_UP)
        if price < CENT:
            price = CENT
        payload = {k: v for k, v in gift.items() if k not in ('status', 'listing_price', 'relayer_pending')}
        payload.update(house=True, price=str(price), price_unit='GRAM')
        placed = db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,'listed') ON CONFLICT DO NOTHING",
                              (HOUSE_ID, gift['id'], json.dumps(payload))).rowcount
        if not placed:
            return False
        db().execute("INSERT INTO crafter_listings(id,seller_id,gift_id,price,listed_at) VALUES(?,?,?,?,?)",
                     ('crafter-' + uuid.uuid4().hex, HOUSE_ID, gift['id'], str(price), int(time.time())))
        db().execute("INSERT INTO house_gifts(gift_id,name,number,burned_by,reason,price,created,status) VALUES(?,?,?,?,?,?,?,'listed') "
                     "ON CONFLICT(gift_id) DO UPDATE SET burned_by=excluded.burned_by,reason=excluded.reason,price=excluded.price,created=excluded.created,status='listed'",
                     (gift['id'], str(gift.get('name') or ''), str(gift.get('number') or ''), int(burned_by), reason, str(price), int(time.time())))
        return True

    def unrelist(gift_id):
        """The burn did not happen after all (e.g. the prize could not be bought): take the gift back off the market.
        False when somebody has already bought it."""
        lot = db().execute("SELECT id FROM crafter_listings WHERE seller_id=? AND gift_id=?", (HOUSE_ID, gift_id)).fetchone()
        if not lot:
            return False
        close = app.extensions.get('crafter_close_lot_offers')
        if close:
            close(lot['id'])
        db().execute("DELETE FROM crafter_listings WHERE id=?", (lot['id'],))
        db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=?", (HOUSE_ID, gift_id))
        db().execute("DELETE FROM house_gifts WHERE gift_id=?", (gift_id,))
        return True

    app.extensions.update(crafter_house_relist=relist, crafter_house_unrelist=unrelist, crafter_house_id=HOUSE_ID,
                          crafter_real_origins=REAL_ORIGINS)

    # ---- administration ----
    def overview():
        rows = db().execute("""SELECT h.gift_id,h.name,h.number,h.burned_by,h.reason,h.created,l.id AS lot_id,l.price AS lot_price
            FROM house_gifts h LEFT JOIN crafter_listings l ON l.seller_id=? AND l.gift_id=h.gift_id ORDER BY h.created DESC LIMIT 300""", (HOUSE_ID,)).fetchall()
        active = [r for r in rows if r['lot_id']]
        account = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (HOUSE_ID,)).fetchone()
        sold = db().execute("SELECT COUNT(*) AS n FROM history WHERE user_id=? AND kind='sale'", (HOUSE_ID,)).fetchone()['n']
        return {'settings': cfg(), 'balance': str(Decimal(str(account['balance'])) if account else Decimal(0)), 'sold': int(sold),
                'active_count': len(active), 'active_value': str(sum((Decimal(r['lot_price']) for r in active), Decimal(0))),
                'lots': [{'gift_id': r['gift_id'], 'name': r['name'], 'number': r['number'], 'burned_by': r['burned_by'], 'reason': r['reason'],
                          'created': r['created'], 'price': r['lot_price'], 'on_sale': bool(r['lot_id'])} for r in rows]}

    @app.get('/api/admin/house-market')
    @auth(admin=True)
    def admin_house():
        return overview()

    @app.post('/api/admin/house-market/settings')
    @auth(admin=True)
    def admin_house_settings():
        b = request.get_json(silent=True) or {}
        try:
            markup = Decimal(str(b.get('markup_percent', 0)))
            if not markup.is_finite() or not Decimal(-50) <= markup <= Decimal(500):
                raise ValueError
        except (InvalidOperation, ValueError):
            abort(400, description='Наценка: от −50 до 500 процентов')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (SETTINGS_KEY, json.dumps({'enabled': bool(b.get('enabled', True)), 'markup_percent': float(markup)})))
        audit('House market settings saved')
        return overview()

    @app.post('/api/admin/house-market/<path:gift_id>/price')
    @auth(admin=True)
    def admin_house_price(gift_id):
        price = positive((request.get_json(silent=True) or {}).get('price'))
        if price is None or price > Decimal(1000000):
            abort(400, description='Укажите цену в GRAM')
        price = price.quantize(CENT, rounding=ROUND_HALF_UP)
        with db():
            if not db().execute("UPDATE crafter_listings SET price=? WHERE seller_id=? AND gift_id=?", (str(price), HOUSE_ID, gift_id)).rowcount:
                abort(404, description='Лот уже продан или снят')
            db().execute("UPDATE house_gifts SET price=? WHERE gift_id=?", (str(price), gift_id))
        audit('House lot price ' + gift_id)
        return overview()

    @app.post('/api/admin/house-market/<path:gift_id>/delist')
    @auth(admin=True)
    def admin_house_delist(gift_id):
        with db():
            db().execute('BEGIN IMMEDIATE')
            lot = db().execute("SELECT id FROM crafter_listings WHERE seller_id=? AND gift_id=?", (HOUSE_ID, gift_id)).fetchone()
            if not lot:
                abort(404, description='Лот уже продан или снят')
            close = app.extensions.get('crafter_close_lot_offers')
            if close:
                close(lot['id'])
            db().execute("DELETE FROM crafter_listings WHERE id=?", (lot['id'],))
            db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=?", (HOUSE_ID, gift_id))
            db().execute("UPDATE house_gifts SET status='held' WHERE gift_id=?", (gift_id,))
        audit('House lot delisted ' + gift_id)
        return overview()
