"""Read model for the collection offer display."""
import time
from decimal import Decimal

from flask import abort, request


def install_offer_display(app, db, auth, canonical_name):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_offer_quotes (
                id TEXT PRIMARY KEY, collection_key TEXT NOT NULL, model TEXT NOT NULL,
                backdrop TEXT NOT NULL, symbol TEXT NOT NULL, price_gram TEXT NOT NULL,
                quantity INTEGER NOT NULL, expires_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS crafter_offers_collection_idx
                ON crafter_offer_quotes(collection_key);
        """)

    @app.get('/api/market/offers')
    @auth()
    def collection_offers():
        collection = request.args.get('collection', '')
        if not collection or len(collection) > 120 or ',' in collection:
            abort(400, description='Выберите одну коллекцию')
        model = request.args.get('model', '')[:150].casefold()
        backdrop = request.args.get('backdrop', '')[:150].casefold()
        symbol = request.args.get('symbol', '')[:150].casefold()
        general, specific = [], []
        for row in db().execute("""SELECT model,backdrop,symbol,price_gram,quantity
            FROM crafter_offer_quotes WHERE collection_key=? AND quantity>0
            AND (expires_at IS NULL OR expires_at>?)""", (canonical_name(collection), int(time.time()))):
            quote = dict(row)
            keys = ('model', 'backdrop', 'symbol')
            if not any(quote[key] for key in keys):
                general.append(quote)
            elif (not model or quote['model'].casefold() == model) and all(
                not selected or not quote[key] or quote[key].casefold() == selected
                for key, selected in (('backdrop', backdrop), ('symbol', symbol))
            ):
                specific.append(quote)
        for group in (general, specific):
            group.sort(key=lambda offer: Decimal(offer['price_gram']), reverse=True)
        matching = specific if model and specific else general
        return {'best': matching[0] if matching else None, 'general': general[:10],
                'specific': specific[:10], 'count': len(general) + len(specific)}
