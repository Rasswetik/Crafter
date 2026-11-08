"""Automatic NFT withdrawal: Portals partner -> Crafter relayer -> user, or relayer -> user.

State machine per queued gift withdrawal (table auto_nft_jobs). Rules that keep assets safe:
  * OFF by default; an administrator enables it (and can disable it) in the admin panel.
  * Every step that moves an asset first persists a "*_sending" stage. A job found in a
    "sending" stage after a crash/timeout is NEVER repeated: it goes to "review".
  * Only a definite Portals failure (errored/recovered, gift still in partner custody) refunds
    the user; anything uncertain stays in the manual queue (status 'queued') for an operator.
  * Paid transfers (Stars) and unresolved recipients go to "review", never auto-paid.
"""
import asyncio
import json
import threading
import time

from flask import abort, g, request

import relayer_transfer as rt

POLL_SECONDS = 30
PORTAL_WAIT_LIMIT = 6 * 3600
RELAY_WAIT_LIMIT = 3600


def install_auto_nft(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS auto_nft_jobs (
                withdrawal_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, gift_id TEXT NOT NULL,
                source TEXT NOT NULL, stage TEXT NOT NULL, portal_withdrawal_id INTEGER,
                slug TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
                retry_at INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS auto_nft_lease (id INTEGER PRIMARY KEY, until INTEGER NOT NULL);
        """)
        db().execute("INSERT INTO auto_nft_lease VALUES(1,0) ON CONFLICT(id) DO NOTHING")

    def enabled():
        row = db().execute("SELECT payload FROM settings WHERE key='auto_nft_withdraw_v1'").fetchone()
        try:
            return bool(row and json.loads(row[0]).get('enabled'))
        except (ValueError, TypeError, AttributeError):
            return False
    app.extensions['crafter_auto_nft_enabled'] = enabled

    def creds():
        return app.extensions['crafter_relayer_credentials']()

    def set_job(wid, **fields):
        fields['updated'] = int(time.time())
        cols = ','.join(k + '=?' for k in fields)
        with db():
            db().execute('UPDATE auto_nft_jobs SET ' + cols + ' WHERE withdrawal_id=?', (*fields.values(), wid))

    def review(wid, note):
        set_job(wid, stage='review', note=str(note)[:300])

    def finish(wid, decision, note):
        app.extensions['crafter_gift_withdrawal_finalize'](wid, decision, note)
        set_job(wid, stage='done' if decision == 'confirmed' else 'failed', note=note[:300])

    def new_jobs():
        rows = db().execute("""SELECT w.id,w.user_id,w.gift_id,w.payload FROM gift_withdrawals w
            LEFT JOIN auto_nft_jobs j ON j.withdrawal_id=w.id WHERE w.status='queued' AND j.withdrawal_id IS NULL
            ORDER BY w.created LIMIT 20""").fetchall()
        for row in rows:
            gift = json.loads(row['payload']).get('gift', {})
            origin = gift.get('origin')
            if origin == 'telegram-deposit' and gift.get('telegram_slug'):
                source, stage, slug = 'relayer', 'transfer', gift['telegram_slug']
            elif origin == 'portals-partner':
                source, stage, slug = 'portals', 'portal_withdraw', ''
            else:
                continue                      # not automatable: stays in the manual queue
            now = int(time.time())
            with db():
                db().execute("INSERT INTO auto_nft_jobs(withdrawal_id,user_id,gift_id,source,stage,slug,created,updated)"
                             " VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                             (row['id'], row['user_id'], row['gift_id'], source, stage, slug, now, now))

    def step(job):
        wid, stage, now = job['withdrawal_id'], job['stage'], int(time.time())
        w = db().execute('SELECT payload,status FROM gift_withdrawals WHERE id=?', (wid,)).fetchone()
        if not w or w['status'] != 'queued':
            return set_job(wid, stage='done', note='resolved elsewhere')
        payload = json.loads(w['payload'])
        gift = payload.get('gift', {})
        if stage.endswith('_sending'):
            return review(wid, 'Результат отправки неизвестен после сбоя — проверьте вручную, повтор запрещён')
        if job['retry_at'] and job['retry_at'] > now:
            return
        api_id, api_hash, session, account_id = creds()
        age = now - job['created']

        if stage == 'portal_withdraw':
            set_job(wid, stage='portal_sending')
            try:
                resp = app.extensions['crafter_portals_partner'](
                    'POST', 'nfts/withdraw',
                    {'gift_ids': [job['gift_id']], 'recipient_id': account_id, 'unsafe_transfer': False})
                ids = resp.get('withdrawals_ids')
                if not isinstance(ids, list) or len(ids) != 1 or type(ids[0]) is not int:
                    raise ValueError('unexpected response')
            except Exception:
                return review(wid, 'Portals не подтвердил вывод на релейер — проверьте вручную')
            return set_job(wid, stage='portal_wait', portal_withdrawal_id=ids[0])

        if stage == 'portal_wait':
            resp = app.extensions['crafter_portals_partner'](
                'GET', 'nfts/withdrawals/statuses', query={'ids': [job['portal_withdrawal_id']]})
            match = next((x for x in resp.get('statuses', []) if x.get('id') == job['portal_withdrawal_id']), None)
            state = (match or {}).get('status')
            if state == 'completed':
                return set_job(wid, stage='relay_wait')
            if state in ('errored', 'recovered'):
                return finish(wid, 'failed', 'Portals отменил вывод на релейер; подарок остался в хранилище')
            if age > PORTAL_WAIT_LIMIT:
                return review(wid, 'Portals слишком долго не завершает вывод')
            return

        if stage == 'relay_wait':
            slug = asyncio.run(rt.find_on_relayer(api_id, api_hash, session, title=gift.get('name'),
                                                  number=gift.get('number') or gift.get('source_number')))
            if slug:
                return set_job(wid, stage='transfer', slug=slug)
            if age > PORTAL_WAIT_LIMIT + RELAY_WAIT_LIMIT:
                return review(wid, 'Подарок не появился на релейере')
            return

        if stage == 'transfer':
            set_job(wid, stage='transfer_sending')
            try:
                asyncio.run(rt.transfer(api_id, api_hash, session, job['slug'],
                                        payload['receiver_user_id'], payload.get('receiver_username', '')))
            except rt.NotReady as error:
                return set_job(wid, stage='transfer', retry_at=error.retry_at)      # nothing was sent
            except rt.NeedsPayment:
                return review(wid, 'Telegram требует оплату Stars за перевод — оплатите и переведите вручную')
            except rt.GiftNotFound:
                return review(wid, 'Подарок не найден на релейере')
            except rt.TransferRejected as error:
                return review(wid, 'Telegram отклонил перевод: ' + str(error))
            except Exception:
                return review(wid, 'Результат перевода неизвестен — проверьте вручную, повтор запрещён')
            return finish(wid, 'confirmed', 'auto-relayer ' + job['slug'])

    def process():
        """Advance every active job by at most one step. Safe to call repeatedly."""
        if not getattr(g, 'user', None):
            g.user = {'id': 0, 'username': 'auto-nft'}      # actor for audit rows written by the worker
        now = int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            got = db().execute('UPDATE auto_nft_lease SET until=? WHERE id=1 AND until<=?', (now + 120, now)).rowcount
        if not got:
            return {'busy': True}
        done = 0
        try:
            new_jobs()
            jobs = db().execute("SELECT * FROM auto_nft_jobs WHERE stage NOT IN ('done','failed','review') "
                                "ORDER BY created LIMIT 20").fetchall()
            for job in jobs:
                try:
                    step(dict(job))
                    done += 1
                except Exception as error:      # never let one job block the others
                    app.logger.warning('auto NFT step failed: %s', type(error).__name__)
                    if not str(job['stage']).endswith('_sending'):
                        set_job(job['withdrawal_id'], note=('retry: ' + type(error).__name__)[:200])
        finally:
            with db():
                db().execute('UPDATE auto_nft_lease SET until=0 WHERE id=1')
        return {'processed': done}
    app.extensions['crafter_auto_nft_process'] = process

    def overview():
        try:
            creds()
            connected = True
        except Exception:
            connected = False
        jobs = [dict(r) for r in db().execute(
            'SELECT withdrawal_id,user_id,source,stage,note,updated FROM auto_nft_jobs ORDER BY created DESC LIMIT 30')]
        return {'enabled': enabled(), 'relayer_connected': connected, 'jobs': jobs}

    @app.get('/api/admin/auto-nft')
    @auth(admin=True)
    def auto_nft_overview():
        return overview()

    @app.post('/api/admin/auto-nft')
    @auth(admin=True)
    def auto_nft_set():
        body = request.get_json(silent=True) or {}
        if type(body.get('enabled')) is not bool or body.get('confirm') != 'SET_AUTO_NFT':
            abort(400, description='Подтвердите изменение')
        if body['enabled']:
            try:
                creds()
            except Exception:
                abort(409, description='Сначала подключите аккаунт Relayer')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('auto_nft_withdraw_v1',?) "
                         "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (json.dumps({'enabled': body['enabled']}),))
        audit('Auto NFT withdrawal ' + ('enabled' if body['enabled'] else 'disabled'))
        return overview()

    @app.post('/api/admin/auto-nft/run')
    @auth(admin=True)
    def auto_nft_run():
        if not enabled():
            abort(409, description='Автовывод выключен')
        return {**process(), **overview()}

    def background():
        while True:
            try:
                with app.app_context():
                    if enabled():
                        process()
            except Exception:
                app.logger.warning('auto NFT background loop failed')
            time.sleep(POLL_SECONDS)

    if not app.config.get('TESTING'):
        threading.Thread(target=background, daemon=True, name='auto-nft').start()
