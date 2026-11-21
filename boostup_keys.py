"""Prints the personal key BUP/... of BoostUp and the signing secret of its webhook (valid now). Run on the server, as the service user:

    sudo -u crafter bash -c 'set -a; . /opt/crafter/.env; set +a; cd /opt/crafter && .venv/bin/python boostup_keys.py'

The keys are derived from the secret of the server, so they can only be read where the server's .env is. Nothing is changed in the database
(the tables of the app are only created when missing, as on every start).
"""
import os

os.environ.setdefault('TELEGRAM_DEPOSIT_POLL', '0')
from app import create_app          # noqa: E402

app = create_app({'TESTING': True})  # no background workers
with app.app_context():
    keys = app.extensions['crafter_boostup_keys']()
print('BOOSTUP_KEY=' + keys['token'])
print('BOOSTUP_SIGNING_SECRET=' + keys['signing_secret'])
print('VERSION=' + str(keys['version']))
