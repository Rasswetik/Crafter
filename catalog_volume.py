"""Actual last-24h Crafter marketplace sales volume by collection, in GRAM."""
import json
import re
import time
import unicodedata
from decimal import Decimal,InvalidOperation
from flask import g


def slug(value):
    text=unicodedata.normalize('NFKC',str(value or '')).casefold()
    return re.sub(r'[^\w]','',text)


def install_collection_volume(app,db,auth):
    @app.get('/api/catalog/collection-volume')
    @auth()
    def collection_volume():
        cutoff=int(time.time())-86400
        totals={}
        rows=db().execute("""SELECT payload FROM history
                             WHERE kind='sale' AND created >= ?""",(cutoff,))
        for row in rows:
            try:
                payload=json.loads(row['payload'])
                gift=payload.get('gift') or {}
                name=gift.get('name') or payload.get('collection') or payload.get('collection_name')
                key=slug(name)
                amount=Decimal(str(payload.get('price') or payload.get('amount') or '0'))
                if not key or not amount.is_finite() or amount<=0:
                    continue
                if str(payload.get('price_unit') or gift.get('price_unit') or 'GRAM').upper()!='GRAM':
                    continue
                totals[key]=totals.get(key,Decimal('0'))+amount
            except (ValueError,TypeError,InvalidOperation,KeyError):
                continue
        response=app.json.response({'volume_by_collection':{
            key:format(value.quantize(Decimal('0.01')),'f')
            for key,value in totals.items()},'unit':'GRAM','period_hours':24})
        response.headers['Cache-Control']='private,max-age=60'
        return response
