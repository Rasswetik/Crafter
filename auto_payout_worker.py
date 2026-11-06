"""Single-run payouts from Render Cron. No HTTP endpoint accepts a signing key.

Configure a dedicated Render Cron job with DATABASE_URL, CRAFTER_PAYOUT_*
and TONCENTER_API_KEY. Cron jobs must share the same durable PostgreSQL
as Crafter, otherwise this command refuses to transfer funds.
"""
import json
import logging
import sys

from app import app


def main():
    with app.app_context():
        result = app.extensions["crafter_auto_payout"]()
    # Never print raw signing keys, seed phrases, signed BOCs or user addresses.
    print(json.dumps(result, ensure_ascii=False))
    # "review" requires operator investigation. Stop instead of retrying.
    if result.get("status") in ("review", "needs_review"):
        return 2
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    sys.exit(main())
