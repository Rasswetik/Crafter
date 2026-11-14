"""Chains of offers: a main gift (step 1, a wide card) followed by steps that are taken one after another, free or for New Year balls.

A chain has a title, a short caption, a background and any number of steps. Every step has a picture (any PNG), a caption and a reward
(GRAM, balls, a card pack, a gift of Telegram, a chest or a direct NFT) and a price in balls (0 = a free gift). A player takes the steps in
order: the next one opens when the previous one is taken."""
import calendar
import json
import re
import time
import uuid
from decimal import Decimal

from flask import abort, g, request

KINDS = ('GRAM', 'BALL', 'PACK', 'STAR', 'CHEST', 'DROP', 'NFT')
LIMIT = 10 ** 9
IMAGE = re.compile(r'/media/shop/[0-9a-f]{32}|/static/assets/[A-Za-z0-9_./-]+')
BG_IMAGE = re.compile(r'image:(/media/shop/[0-9a-f]{32}|/static/assets/[A-Za-z0-9_./-]+)')
MAX_STEPS = 24


def install_chains(app, db, auth, audit, record):
    from packs import money
    from shop_items import plain

    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS offer_chains (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', bg TEXT NOT NULL DEFAULT '', section_id TEXT,
                enabled BIGINT NOT NULL DEFAULT 1, position BIGINT NOT NULL DEFAULT 0, starts_at BIGINT, ends_at BIGINT, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS offer_chain_steps (
                id TEXT PRIMARY KEY, chain_id TEXT NOT NULL, position BIGINT NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '',
                image TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, amount TEXT NOT NULL, item_count BIGINT NOT NULL DEFAULT 1, price_balls BIGINT NOT NULL DEFAULT 0, rewards TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS offer_chain_claims (
                user_id BIGINT NOT NULL, step_id TEXT NOT NULL, chain_id TEXT NOT NULL, result TEXT NOT NULL, created BIGINT NOT NULL,
                PRIMARY KEY(user_id, step_id)
            );
        """)

    with app.app_context(), db():                                      # chains made before a step could hold several prizes
        database = db()
        if hasattr(database, 'connection') and database.connection is not None:
            database.execute("ALTER TABLE offer_chain_steps ADD COLUMN IF NOT EXISTS rewards TEXT NOT NULL DEFAULT ''")
        elif 'rewards' not in [r['name'] for r in database.execute("PRAGMA table_info(offer_chain_steps)").fetchall()]:
            database.execute("ALTER TABLE offer_chain_steps ADD COLUMN rewards TEXT NOT NULL DEFAULT ''")

    def msk_time(value):
        m = re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)', str(value or '').strip())
        if not m:
            abort(400, description='Время: дата и часы по Москве')
        try:
            return calendar.timegm(tuple(int(x) for x in m.groups()) + (0,)) - 3 * 3600
        except (ValueError, OverflowError):
            abort(400, description='Время: такой даты нет')

    def balls_of(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def gram_of(uid):
        row = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
        return Decimal(str(row['balance'])) if row else Decimal('0')

    def reward_info(kind, amount, count):
        """Title and picture of a reward."""
        if kind == 'GRAM':
            return plain(Decimal(amount)) + ' GRAM', '/static/assets/gram.svg'
        if kind == 'BALL':
            return format(int(amount), ',').replace(',', ' ') + ' шаров', '/static/assets/new-year-ornament.svg'
        if kind == 'PACK':
            pack = app.extensions['crafter_pack_short'](amount) or {}
            return (pack.get('title') or 'Пак') + (' ×' + str(count) if count > 1 else ''), pack.get('image') or ''
        if kind == 'STAR':
            star = app.extensions['crafter_star_gift_short'](amount) or {}
            return (star.get('name') or star.get('title') or 'Подарок') + (' ×' + str(count) if count > 1 else ''), star.get('image') or ''
        if kind == 'CHEST':
            chest = app.extensions['crafter_chest_short'](amount) or {}
            return chest.get('title') or 'Ящик', chest.get('image') or ''
        if kind == 'DROP':
            drop = app.extensions['crafter_drop_short'](amount) or {}
            return (drop.get('title') or 'Дроп') + (' ×' + str(count) if count > 1 else ''), drop.get('image') or ''
        cid, _, model = str(amount).partition(':')
        info = app.extensions['crafter_nft_short'](cid, model) or {}
        return (info.get('model') or 'NFT') + (' · ' + info['collection'] if info.get('collection') else ''), info.get('image') or ''

    def steps_of(cid):
        return db().execute("SELECT * FROM offer_chain_steps WHERE chain_id=? ORDER BY position,id", (cid,)).fetchall()

    def rewards_of(r):
        """The prizes of a step: a list of {kind, amount, count} (older steps hold a single prize in their own columns)."""
        try:
            found = json.loads(r['rewards']) if r['rewards'] else None
        except ValueError:
            found = None
        return found or [{'kind': r['kind'], 'amount': r['amount'], 'count': int(r['item_count'])}]

    def step_view(r, state=None):
        rw = []
        for x in rewards_of(r):
            title, pic = reward_info(x['kind'], x['amount'], int(x.get('count') or 1))
            rw.append({'kind': x['kind'], 'amount': x['amount'], 'count': int(x.get('count') or 1), 'title': title, 'image': pic})
        return {'id': r['id'], 'position': int(r['position']), 'label': r['label'], 'caption': r['caption'], 'image': r['image'] or (rw[0]['image'] if rw else ''), 'own_image': r['image'],
                'reward_title': ' + '.join(x['title'] for x in rw), 'rewards': rw, 'kind': rw[0]['kind'], 'amount': rw[0]['amount'], 'count': rw[0]['count'],
                'price_balls': int(r['price_balls']), 'state': state}

    def chain_view(row, uid=None, admin=False):
        done = set()
        if uid:
            done = {x['step_id'] for x in db().execute("SELECT step_id FROM offer_chain_claims WHERE user_id=? AND chain_id=?", (uid, row['id'])).fetchall()}
        steps, nxt = [], None
        for r in steps_of(row['id']):
            if r['id'] in done:
                st = 'done'
            elif nxt is None:
                st = 'ready'; nxt = r['id']
            else:
                st = 'locked'
            steps.append(step_view(r, st if uid else None))
        out = {'id': row['id'], 'title': row['title'], 'subtitle': row['subtitle'], 'bg': row['bg'], 'section_id': row['section_id'] or '', 'steps': steps,
               'done': len(done), 'total': len(steps), 'ends_at': int(row['ends_at']) if row['ends_at'] else None}
        if admin:
            out.update(enabled=bool(row['enabled']), starts_at=int(row['starts_at']) if row['starts_at'] else None)
        return out

    @app.get('/api/chains')
    @auth()
    def chains_list():
        now = int(time.time())
        rows = db().execute("SELECT * FROM offer_chains WHERE enabled=1 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) ORDER BY position,created", (now, now)).fetchall()
        hidden = app.extensions['crafter_hidden_sections']()
        rows = [r for r in rows if (r['section_id'] or '') not in hidden]
        return {'now': now, 'chains': [c for c in (chain_view(r, g.user['id']) for r in rows) if c['steps']]}

    @app.post('/api/chains/claim')
    @auth()
    def chains_claim():
        step_id = (request.get_json(silent=True) or {}).get('step_id')
        if not isinstance(step_id, str):
            abort(400, description='Неверный запрос')
        uid, now = g.user['id'], int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            done = db().execute("SELECT result FROM offer_chain_claims WHERE user_id=? AND step_id=?", (uid, step_id)).fetchone()
            if done:
                return {'ok': True, 'result': json.loads(done['result']), 'again': True}
            step = db().execute("SELECT * FROM offer_chain_steps WHERE id=?", (step_id,)).fetchone()
            chain = db().execute("SELECT * FROM offer_chains WHERE id=?", (step['chain_id'],)).fetchone() if step else None
            if not step or not chain or not chain['enabled'] or (chain['section_id'] or '') in app.extensions['crafter_hidden_sections']():
                abort(404, description='Шаг не найден')
            if (chain['starts_at'] and int(chain['starts_at']) > now) or (chain['ends_at'] and int(chain['ends_at']) <= now):
                abort(409, description='Акция сейчас закрыта')
            before = [r for r in steps_of(chain['id']) if int(r['position']) < int(step['position']) or (int(r['position']) == int(step['position']) and r['id'] < step['id'])]
            taken = {x['step_id'] for x in db().execute("SELECT step_id FROM offer_chain_claims WHERE user_id=? AND chain_id=?", (uid, chain['id'])).fetchall()}
            if any(r['id'] not in taken for r in before):
                abort(409, description='Сначала возьмите предыдущие шаги')
            price, balls = int(step['price_balls']), balls_of(uid)
            if balls < price:
                abort(409, description='Недостаточно новогодних шаров')
            if price:
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls - price, uid))
                app.extensions['crafter_author_reward'](uid, 'BALLS', price, 'chain:' + step_id)
            rewards = rewards_of(step)
            out = {'ok': True}
            src = 'chain:' + step_id
            gram_add, ball_add = Decimal('0'), 0
            for x in rewards:
                if x['kind'] == 'GRAM':
                    gram_add += Decimal(x['amount'])
                elif x['kind'] == 'BALL':
                    ball_add += int(x['amount'])
            if gram_add:
                after = gram_of(uid) + gram_add
                db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(after)))
            if ball_add:
                new = balls_of(uid) + ball_add
                if new > LIMIT:
                    abort(409, description='Баланс шаров превысит максимум')
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (new, uid))
            pack_ids, gift_ids, opens, nfts = [], [], [], []
            drops_given, drop_id = 0, ''
            for x in rewards:
                kind, amount, count = x['kind'], x['amount'], int(x.get('count') or 1)
                if kind == 'PACK':
                    pack_ids += [app.extensions['crafter_grant_pack'](uid, amount, src) for _ in range(count)]
                elif kind == 'STAR':
                    gift_ids += [app.extensions['crafter_grant_star_gift'](uid, amount, src) for _ in range(count)]
                elif kind == 'CHEST':
                    opens += [app.extensions['crafter_open_chest'](uid, amount, src) for _ in range(count)]
                elif kind == 'DROP':                                  # a drop opens at once, like a chest
                    app.extensions['crafter_start_drops'](uid, amount, count, src)
                    drops_given += count
                    drop_id = amount
                elif kind == 'NFT':
                    cid, _, model = amount.partition(':')
                    nfts.append(app.extensions['crafter_grant_nft'](uid, cid, model, src))
            if pack_ids:
                out.update(pack_id=pack_ids[0], pack_ids=pack_ids)
            if gift_ids:
                out['gift_ids'] = gift_ids
            if drops_given:
                out['drop_granted'] = {'drop': app.extensions['crafter_drop_short'](drop_id), 'qty': drops_given}
            if opens:
                out.update(chest_open=opens[0], chest_opens=opens)
            if nfts:
                out.update(nft=nfts[0], nfts=nfts)
            view = step_view(step)
            first = rewards[0]
            result = {'title': view['reward_title'], 'image': step['image'] or view['image'], 'kind': first['kind'], 'label': step['label'], 'rewards': [{'kind': r_['kind'], 'title': r_['title'], 'image': r_['image'], 'count': r_['count']} for r_ in view['rewards']]}
            db().execute("INSERT INTO offer_chain_claims(user_id,step_id,chain_id,result,created) VALUES(?,?,?,?,?)", (uid, step_id, chain['id'], json.dumps(result, ensure_ascii=False), now))
            record('chain_claim', {'chain': chain['id'], 'step': step_id, 'kind': rewards[0]['kind'], 'rewards': len(rewards), 'price_balls': price}, uid=uid)
            out.update(result=result, balance={'balls': balls_of(uid)}, gram_balance=str(gram_of(uid)))
            if opens:
                out['balance'] = opens[-1]['balance']; out['gram_balance'] = opens[-1]['gram_balance']
        return out

    # ---------- administration ----------
    @app.get('/api/admin/new-year/chains')
    @auth(admin=True)
    def admin_chains():
        rows = db().execute("SELECT * FROM offer_chains ORDER BY position,created").fetchall()
        taken = {r['chain_id']: int(r['n']) for r in db().execute("SELECT chain_id,COUNT(DISTINCT user_id) AS n FROM offer_chain_claims GROUP BY chain_id").fetchall()}
        out = []
        for r in rows:
            c = chain_view(r, None, True)
            c['players'] = taken.get(r['id'], 0)
            out.append(c)
        return {'chains': out}

    def clean_image(value, what):
        value = str(value or '').strip()
        if value and not IMAGE.fullmatch(value):
            abort(400, description=what + ': загрузите файл')
        return value

    def reward_fields(body):
        kind = str(body.get('kind') or '')
        if kind not in KINDS:
            abort(400, description='Награда: GRAM, шары, пак, подарок Telegram, ящик или NFT')
        count, amount = 1, str(body.get('amount') or '').strip()
        if kind == 'GRAM':
            amount = plain(money(amount, 'награда'))
        elif kind == 'BALL':
            try:
                n = int(amount)
            except ValueError:
                abort(400, description='Шары: целое число')
            if not 1 <= n <= LIMIT:
                abort(400, description='Шары: от 1 до %d' % LIMIT)
            amount = str(n)
        elif kind == 'DROP':
            if not app.extensions['crafter_drop_exists'](amount):
                abort(400, description='Выберите существующий дроп')
            try:
                count = int(str(body.get('count') or 1))
            except ValueError:
                abort(400, description='Сколько дропов: целое число')
            if not 1 <= count <= 20:
                abort(400, description='Дропов в шаге: от 1 до 20')
        elif kind == 'CHEST':
            if not app.extensions['crafter_chest_exists'](amount):
                abort(400, description='Выберите существующий ящик')
            try:
                count = int(str(body.get('count') or 1))
            except ValueError:
                abort(400, description='Сколько ящиков: целое число')
            if not 1 <= count <= 20:
                abort(400, description='Ящиков в шаге: от 1 до 20')
        elif kind == 'NFT':
            cid, _, model = amount.partition(':')
            if not app.extensions['crafter_nft_short'](cid, model):
                abort(400, description='Выберите коллекцию и модель подарка из каталога')
        else:
            if kind == 'PACK' and not app.extensions['crafter_pack_exists'](amount):
                abort(400, description='Выберите существующий пак')
            if kind == 'STAR' and not app.extensions['crafter_star_gift_exists'](amount):
                abort(400, description='Выберите подарок Telegram')
            try:
                count = int(str(body.get('count') or 1))
            except ValueError:
                abort(400, description='Сколько штук: целое число')
            if not 1 <= count <= 20:
                abort(400, description='Штук в шаге: от 1 до 20')
        return kind, amount, count

    @app.post('/api/admin/new-year/chains')
    @auth(admin=True)
    def admin_chain_save():
        body = request.get_json(silent=True) or {}
        title = ' '.join(str(body.get('title') or '').split())[:60]
        if not title:
            abort(400, description='Введите название акции')
        subtitle = ' '.join(str(body.get('subtitle') or '').split())[:80]
        bg = str(body.get('bg') or '').strip()
        if bg and not BG_IMAGE.fullmatch(bg):
            abort(400, description='Фон: загрузите картинку')
        section_id = str(body.get('section_id') or '').strip()
        if section_id and not app.extensions['crafter_shop_section_exists'](section_id):
            abort(400, description='Раздел не найден')
        starts = msk_time(body['starts_at_msk']) if str(body.get('starts_at_msk') or '').strip() else None
        ends = msk_time(body['ends_at_msk']) if str(body.get('ends_at_msk') or '').strip() else None
        if starts and ends and ends <= starts:
            abort(400, description='Конец акции должен быть позже начала')
        steps_in = body.get('steps')
        if not isinstance(steps_in, list) or not 1 <= len(steps_in) <= MAX_STEPS:
            abort(400, description='В цепочке от 1 до %d шагов' % MAX_STEPS)
        steps = []
        for i, x in enumerate(steps_in):
            raw_rewards = x.get('rewards') if isinstance(x.get('rewards'), list) and x.get('rewards') else [x]
            if not 1 <= len(raw_rewards) <= 12:
                abort(400, description='В шаге от 1 до 12 призов')
            rewards = []
            for rw in raw_rewards:
                k_, a_, c_ = reward_fields(rw)
                rewards.append({'kind': k_, 'amount': a_, 'count': c_})
            kind, amount, count = rewards[0]['kind'], rewards[0]['amount'], rewards[0]['count']
            try:
                price = int(str(x.get('price_balls') or 0).strip() or 0)
            except ValueError:
                abort(400, description='Цена шага: целое число шаров')
            if not 0 <= price <= LIMIT:
                abort(400, description='Цена шага: от 0 до %d' % LIMIT)
            steps.append((str(x.get('id') or '') or uuid.uuid4().hex[:12], i, ' '.join(str(x.get('label') or '').split())[:24] or 'Шаг ' + str(i + 1),
                          ' '.join(str(x.get('caption') or '').split())[:40], clean_image(x.get('image'), 'Картинка шага'), kind, amount, count, price, json.dumps(rewards)))
        enabled = 1 if body.get('enabled') in (True, 1, '1', 'true') else 0
        cid = str(body.get('id') or '')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if cid:
                if not db().execute("UPDATE offer_chains SET title=?,subtitle=?,bg=?,section_id=?,enabled=?,starts_at=?,ends_at=? WHERE id=?",
                                    (title, subtitle, bg, section_id or None, enabled, starts, ends, cid)).rowcount:
                    abort(404, description='Акция не найдена')
                keep = [s[0] for s in steps]
                for r in steps_of(cid):
                    if r['id'] not in keep:
                        db().execute("DELETE FROM offer_chain_steps WHERE id=?", (r['id'],))
                        db().execute("DELETE FROM offer_chain_claims WHERE step_id=?", (r['id'],))
            else:
                cid = uuid.uuid4().hex[:10]
                pos = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM offer_chains").fetchone()['n'])
                db().execute("INSERT INTO offer_chains(id,title,subtitle,bg,section_id,enabled,position,starts_at,ends_at,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (cid, title, subtitle, bg, section_id or None, enabled, pos, starts, ends, int(time.time())))
            for sid, pos, label, caption, image, kind, amount, count, price, rewards_json in steps:
                if db().execute("SELECT 1 FROM offer_chain_steps WHERE id=? AND chain_id=?", (sid, cid)).fetchone():
                    db().execute("UPDATE offer_chain_steps SET position=?,label=?,caption=?,image=?,kind=?,amount=?,item_count=?,price_balls=?,rewards=? WHERE id=?", (pos, label, caption, image, kind, amount, count, price, rewards_json, sid))
                else:
                    db().execute("INSERT INTO offer_chain_steps(id,chain_id,position,label,caption,image,kind,amount,item_count,price_balls,rewards) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (sid, cid, pos, label, caption, image, kind, amount, count, price, rewards_json))
        audit('Offer chain saved: ' + title)
        return {'ok': True, 'id': cid}

    @app.post('/api/admin/new-year/chains/<cid>/delete')
    @auth(admin=True)
    def admin_chain_delete(cid):
        with db():
            db().execute('BEGIN IMMEDIATE')
            if not db().execute("DELETE FROM offer_chains WHERE id=?", (cid,)).rowcount:
                abort(404, description='Акция не найдена')
            db().execute("DELETE FROM offer_chain_steps WHERE chain_id=?", (cid,))
            db().execute("DELETE FROM offer_chain_claims WHERE chain_id=?", (cid,))
        return {'ok': True}
