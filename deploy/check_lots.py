"""Checks, on the server, the step of a purchase «is this lot still listed on Thermos»: the same call that thermos_market.still_listed makes,
for a dozen lots of the cached market pages. One line per lot; an exception is printed with its type and message (no secrets are printed).

    sudo -u crafter /opt/crafter/.venv/bin/python /opt/crafter/deploy/check_lots.py
"""
import os
import sys
import time
import traceback
from decimal import Decimal

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(HERE)
sys.path.insert(0, HERE)
try:
    for line in open(os.path.join(HERE, '.env'), encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            name, _, value = line.removeprefix('export ').partition('=')
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
                value = value[1:-1]
            os.environ.setdefault(name.strip(), value)
except OSError:
    pass
os.environ.setdefault('TELEGRAM_DEPOSIT_POLL', '0')

import thermos                      # noqa: E402
from app import create_app          # noqa: E402

app = create_app({'TESTING': True})
with app.app_context():
    ctx = app.extensions['crafter_pack_ctx']
    start = time.time()
    try:
        thermos.request('collections')
        print('proxy.thermos.gifts answers in %.1fs' % (time.time() - start))
    except Exception as error:
        print('proxy.thermos.gifts FAILED %s %r after %.1fs' % (type(error).__name__, error, time.time() - start))
    catalog = ctx['public_catalog']()
    print('catalogue: %d collections; backend: %s' % (len(catalog), app.extensions['crafter_market_backend']()))
    seen = shown = 0
    for collection in catalog:
        for gift, price in list(ctx['market_candidates'](collection, 1800))[:2]:
            seen += 1
            params = {'collection_id': str(gift.get('collection_id') or ''), 'search': str(gift.get('number') or ''),
                      'sort_by': 'price asc', 'markets': str(gift.get('marketplace') or 'PORTALS').upper()}
            began = time.time()
            try:
                live = thermos.gifts(params, catalog)['gifts']
                found = [x for x in live if x['id'] == gift['id']]
                same = any(Decimal(str(x['price'])) == Decimal(str(gift['price'])) for x in found)
                print('%-16s %-7s #%-7s collection_id=%s in_live=%s price_same=%s live_n=%d %.1fs' % (
                    str(gift.get('name'))[:16], params['markets'], gift.get('number'), params['collection_id'][:8] or '-', bool(found), same, len(live), time.time() - began))
            except Exception as error:
                print('%-16s %-7s #%-7s collection_id=%s CHECK RAISED %s: %s' % (
                    str(gift.get('name'))[:16], params['markets'], gift.get('number'), params['collection_id'][:8] or '-', type(error).__name__, str(error)[:120]))
                if shown < 2:
                    shown += 1
                    print(''.join(traceback.format_exc().splitlines(True)[-6:]))
            if seen >= 14:
                break
        if seen >= 14:
            break
    print('checked %d lots from the cached pages' % seen)
