"""New Year reward ledger for settled Crafter marketplace activity.

10 winter balls per 1 TON of confirmed buying/selling volume.
Internal GRAM amounts are converted using the TON Connect gram_per_ton
rate *at the time of settlement*, not treated as TON by default.
"""
import json
import time
from decimal import Decimal, InvalidOperation, ROUND_DOWN

BALLS_PER_TON = Decimal('10')
SUPPORTED = {'buy': {'crafter', 'portals-partner'},
             'sale': {'crafter'}}
MAX_PRICE = Decimal('10000000000')
MAX_WALLET = 10**9


def install_new_year_trade_rewards(app, db, audit=None):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS new_year_trade_rewards(
            history_id TEXT PRIMARY KEY, user_id BIGINT NOT NULL,
            kind TEXT NOT NULL, scope TEXT NOT NULL,
            volume_gram TEXT NOT NULL, rate_gram_per_ton TEXT NOT NULL,
            balls_delta BIGINT NOT NULL, created BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS new_year_trade_remainders(
            user_id BIGINT PRIMARY KEY, fraction TEXT NOT NULL DEFAULT '0'
        );
        """)

    def conversion():
        settings=db().execute("SELECT payload FROM settings WHERE key='tonconnect'").fetchone()
        try:
            config=json.loads(settings[0]) if settings else {}
            value=Decimal(str(config.get('gram_per_ton','1')))
            if value.is_finite() and value>0 and value<MAX_PRICE:
                return value
        except (ValueError,TypeError,InvalidOperation,OverflowError):
            pass
        return Decimal('1')

    def accrue(uid, history_id, kind, payload):
        if kind not in SUPPORTED or payload.get('scope') not in SUPPORTED[kind]:
            return 0
        gift=payload.get('gift') or {}
        if gift.get('test_only') or gift.get('catalog_only') or gift.get('origin') in (
                'market-test','new-year-test','local-purchase','admin-grant'):
            return 0
        flag=db().execute("SELECT payload FROM settings WHERE key='new_year_enabled_v1'").fetchone()
        if not flag or flag[0]!='true':
            return 0
        if db().execute("SELECT 1 FROM new_year_trade_rewards WHERE history_id=?",
                        (history_id,)).fetchone():
            return 0
        try:
            amount=Decimal(str(payload.get('price','0')))
            if not amount.is_finite() or not 0<amount<=MAX_PRICE:
                return 0
        except (TypeError,ValueError,InvalidOperation):
            return 0
        rate=conversion()
        earned=(amount/rate)*BALLS_PER_TON
        current=db().execute(
            "SELECT balls FROM new_year_wallets WHERE user_id=?",(uid,)).fetchone()
        previous=db().execute(
            "SELECT fraction FROM new_year_trade_remainders WHERE user_id=?",(uid,)).fetchone()
        fraction=Decimal(str(previous['fraction'])) if previous else Decimal(0)
        combined=fraction+earned
        whole=int(combined.to_integral_value(rounding=ROUND_DOWN))
        remainder=combined-Decimal(whole)
        if (int(current['balls']) if current else 0)+whole>MAX_WALLET:
            # Do not break a legitimate settled purchase because of a full event wallet.
            return 0
        created=int(time.time())
        inserted=db().execute(
            "INSERT INTO new_year_trade_rewards(history_id,user_id,kind,scope,volume_gram,rate_gram_per_ton,balls_delta,created) "
            "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
            (history_id,uid,kind,payload['scope'],str(amount),str(rate),whole,created))
        if not inserted.rowcount:
            return 0
        db().execute(
            "INSERT INTO new_year_trade_remainders(user_id,fraction) VALUES(?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET fraction=excluded.fraction",
            (uid,str(remainder)))
        if whole:
            db().execute("INSERT INTO new_year_wallets(user_id,balls) VALUES(?,?) "
                         "ON CONFLICT(user_id) DO UPDATE SET balls=new_year_wallets.balls+excluded.balls",
                         (uid,whole))
        return whole

    return accrue,conversion
