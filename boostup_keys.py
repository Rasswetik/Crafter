"""Prints the personal key BUP/... of BoostUp and the signing secret of its webhook (valid now). Run on the server, as the service user:

    sudo -u crafter /opt/crafter/.venv/bin/python /opt/crafter/boostup_keys.py

The keys are derived from the secret of the server (its .env is read like the service does), so they can only be read there.
Nothing is changed in the database (the tables of the app are only created when missing, as on every start).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)
try:
    for line in open(os.getenv('CRAFTER_ENV_FILE', os.path.join(HERE, '.env')), encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, _, value = line.removeprefix('export ').partition('=')
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        os.environ.setdefault(name.strip(), value)
except OSError:
    pass
os.environ.setdefault('TELEGRAM_DEPOSIT_POLL', '0')
from app import create_app          # noqa: E402

app = create_app({'TESTING': True})  # no background workers
with app.app_context():
    keys = app.extensions['crafter_boostup_keys']()
print('BOOSTUP_KEY=' + keys['token'])
print('BOOSTUP_SIGNING_SECRET=' + keys['signing_secret'])
print('VERSION=' + str(keys['version']))
