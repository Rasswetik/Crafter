#!/bin/bash
# What BoostUp got in the last hour: the answers of the Partner API and the errors behind them. No secrets are printed.
q() { sudo -u postgres psql -d crafter -P pager=off -c "$1" 2>&1 | head -60; }
echo "== Partner API operations (last 14), full answer"
q "select user_id, method, status, http, left(result,260) result, to_timestamp(created) at from partner_ops order by created desc limit 14"
echo "== POST requests of the Partner API in the journal (last 60 minutes)"
journalctl -u crafter --since '60 minutes ago' --no-pager | grep -E 'POST /api/partner/v1' | tail -25
echo "== warnings of Thermos and of the operations (last 60 minutes)"
journalctl -u crafter --since '60 minutes ago' --no-pager | grep -E 'Thermos|Partner operation|price mismatch' | tail -25
echo "== does the public Thermos proxy answer this server now?"
sudo -u crafter /opt/crafter/.venv/bin/python - <<'PYEOF'
import sys, time
sys.path.insert(0, '/opt/crafter')
import thermos
start = time.time()
try:
    thermos.request('collections')
    print('proxy.thermos.gifts answers in %.1fs' % (time.time() - start))
except Exception as error:
    print('proxy.thermos.gifts: %s %r' % (type(error).__name__, error))
PYEOF
