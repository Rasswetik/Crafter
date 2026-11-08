"""New Year rewards for real settlements and explicitly marked preview operations.

Every 1 TON of recorded activity earns 10 seasonal balls. Preview gifts
never become real NFT custody or real-balance transactions.
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
        scope=payload.get('scope')
        gift=payload.get('gift') or {}
        origin=gift.get('origin')
        is_preview=False
        amount_key='price'
        if (kind=='market_test_buy' and scope=='preview' and
            payload.get('test_mode') is True and origin=='market-test'):
            is_preview=True
        elif (kind=='market_test_sale' and scope=='preview' and
              payload.get('test_mode') is True and origin in ('market-test','demo-craft')):
            is_preview=True
        elif (kind=='craft' and scope=='application' and payload.get('mode')=='preview' and
              payload.get('test_mode') is True and payload.get('consumed')):
            is_preview=True
            amount_key='input_value'
        elif kind in SUPPORTED and scope in SUPPORTED[kind]:
            if (gift.get('test_only') or gift.get('catalog_only') or
                origin in ('market-test','new-year-test','local-purchase','admin-grant','demo-craft')):
                return 0
        else:
            return 0
        if is_preview and not app.config.get('MARKET_TEST_PURCHASES',False):
            return 0
        flag=db().execute("SELECT payload FROM settings WHERE key='new_year_enabled_v1'").fetchone()
        if not flag or flag[0]!='true':
            return 0
        if db().execute("SELECT 1 FROM new_year_trade_rewards WHERE history_id=?",
                        (history_id,)).fetchone():
            return 0
        try:
            amount=Decimal(str(payload.get(amount_key,'0')))
            if not amount.is_finite() or not 0<amount<=MAX_PRICE:
                return 0
        except (TypeError,ValueError,InvalidOperation):
            return 0
        unit=str(payload.get('price_unit','GRAM'))
        if unit not in ('TON','GRAM'):
            return 0
        rate=conversion()
        gram_volume=amount*rate if unit=='TON' else amount
        earned=(gram_volume/rate)*BALLS_PER_TON
        current=db().execute(
            "SELECT balls FROM new_year_wallets WHERE user_id=?",(uid,)).fetchone()
        previous=db().execute(
            "SELECT fraction FROM new_year_trade_remainders WHERE user_id=?",(uid,)).fetchone()
        fraction=Decimal(str(previous['fraction'])) if previous else Decimal(0)
        combined=fraction+earned
        whole=int(combined.to_integral_value(rounding=ROUND_DOWN))
        remainder=combined-Decimal(whole)
        if (int(current['balls']) if current else 0)+whole>MAX_WALLET:
            return 0
        created=int(time.time())
        inserted=db().execute(
            "INSERT INTO new_year_trade_rewards(history_id,user_id,kind,scope,volume_gram,rate_gram_per_ton,balls_delta,created) "
            "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
            (history_id,uid,kind,scope,str(gram_volume),str(rate),whole,created))
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
