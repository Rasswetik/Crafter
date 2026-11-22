#!/bin/bash
# Read-only diagnostics of withdrawals, Thermos purchases and API operations. No secrets are printed.
# Run on the server:  bash /opt/crafter/deploy/diag.sh
q() { sudo -u postgres psql -d crafter -P pager=off -c "$1" 2>&1 | head -40; }

echo "== Partner API operations (last 14: what BoostUp got)"
q "select user_id, method, status, http, left(result,170) result, to_timestamp(created) at from partner_ops order by created desc limit 14"
echo "== Partner API operations still 'processing'"
q "select user_id, method, op_id, to_timestamp(created) at from partner_ops where status='processing' order by created desc limit 8"
echo "== NFT withdrawal requests (last 8)"
q "select left(id,14) id, user_id, status, left(note,90) note, to_timestamp(updated) updated from gift_withdrawals order by created desc limit 8"
echo "== automatic NFT withdrawals (last 8)"
q "select left(withdrawal_id,14) id, user_id, source, stage, left(note,90) note, to_timestamp(updated) updated from auto_nft_jobs order by created desc limit 8"
echo "== Thermos shop orders (last 6)"
q "select left(id,8) id, user_id, status, left(response,120) answer, to_timestamp(created) at from thermos_orders order by created desc limit 6"
echo "== BoostUp deposits (last 6)"
q "select left(id,10) id, user_id, status, attempts, left(note,70) note, to_timestamp(created) at from boostup_deposits where status<>'offered' order by created desc limit 6"
echo "== errors of API operations and lot checks in the journal (last 12 hours)"
journalctl -u crafter --since '12 hours ago' --no-pager | grep -E -A12 'Partner operation failed|Thermos lot check failed|price mismatch' | tail -70
echo "== Thermos refusals in the journal (last 6)"
journalctl -u crafter --since '12 hours ago' --no-pager | grep 'Thermos refused' | tail -6
