"""Chests: a 3D model that cannot be sold or kept. It opens at once when it is bought, found in a freebie box or redeemed by a promo code.

The administrator describes what is inside: how many items a chest gives (1..6, with chances) and a table of loot (New Year balls,
GRAM, card packs, gifts of Telegram) with weights. The server rolls the loot at the moment of opening, gives it to the player and
returns the list; the page plays the animation of the opening and shows the items one after another."""
import json
import random
import re
import time
import uuid
from decimal import ROUND_DOWN, Decimal

from flask import abort, g, request

KINDS = ('BALL', 'GRAM', 'PACK', 'STAR')
LIMIT = 10 ** 9
MAX_MODEL = 9_000_000
DEFAULT_MODEL = '/static/assets/chests/gingerbread.glb'
DEFAULT_MOBILE = '/static/assets/chests/gingerbread.glb'
PATH = re.compile(r'/media/shop/[0-9a-f]{32}|/static/assets/chests/[A-Za-z0-9_.-]+')
BALL_ICON = '/static/assets/new-year-ornament.svg'
GRAM_ICON = '/static/assets/gram.svg'
rng = random.SystemRandom()

# the first chest, as in Ginger_Box_Drop.md: 3..6 rewards; one GRAM, one batch of balls and one pack are always there, the rest is a bonus
DEFAULT_ROLLS = {'3': 50, '4': 30, '5': 15, '6': 5}
DEFAULT_SETTINGS = {'guaranteed': ['GRAM', 'BALL', 'PACK'], 'bonus': {'GRAM': 60, 'BALL': 30, 'PACK': 10}}
DEFAULT_LOOT = (
    [('GRAM', a, 1, 1, w) for a, w in (('0.1', 40), ('0.2', 28), ('0.3', 14), ('0.5', 8), ('0.75', 4), ('1', 3), ('1.5', 1.5), ('2', .8), ('3', .5), ('5', .2))] +
    [('BALL', a, 1, 1, w) for a, w in (('5', 30), ('10', 30), ('15', 18), ('25', 12), ('40', 5), ('60', 3), ('100', 1.5), ('150', .5))] +
    [('PACK', a, 1, 1, w) for a, w in (('newyear', 20), ('snowman', 18), ('winter', 15), ('christmas', 12), ('silverfrost', 10), ('gingerbread', 9), ('honey', 7), ('gifton', 4), ('goshan', 3), ('nikolay', 2))])


def install_chests(app, db, auth, audit, record):
    from shop_items import plain

    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS chests (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', model_mobile TEXT NOT NULL DEFAULT '',
                bg TEXT NOT NULL DEFAULT 'night', rolls TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '', enabled BIGINT NOT NULL DEFAULT 1, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chest_loot (
                id TEXT PRIMARY KEY, chest_id TEXT NOT NULL, position BIGINT NOT NULL DEFAULT 0, kind TEXT NOT NULL, amount TEXT NOT NULL,
                cnt_min BIGINT NOT NULL DEFAULT 1, cnt_max BIGINT NOT NULL DEFAULT 1, weight TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chest_opens (
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, chest_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', result TEXT NOT NULL, created BIGINT NOT NULL
            );
        """)
        db().execute('BEGIN IMMEDIATE')                           # several workers start together: only one of them seeds the first chest
        if not db().execute("SELECT 1 FROM chests LIMIT 1").fetchone():
            now = int(time.time())
            made = db().execute("INSERT INTO chests(id,title,image,model,model_mobile,bg,rolls,settings,enabled,created) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                                ('gingerbread', 'Ginger Box', '/static/assets/chests/gingerbread.png', '', '', 'cozy', json.dumps(DEFAULT_ROLLS), json.dumps(DEFAULT_SETTINGS), 1, now))
            if made.rowcount:
                for i, (kind, amount, cnt_min, cnt_max, weight) in enumerate(DEFAULT_LOOT):
                    db().execute("INSERT INTO chest_loot(id,chest_id,position,kind,amount,cnt_min,cnt_max,weight) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                                 (uuid.uuid4().hex[:12], 'gingerbread', i, kind, amount, cnt_min, cnt_max, str(weight)))

    # ---------- helpers ----------
    def balls_of(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def gram_of(uid):
        row = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
        return Decimal(str(row['balance'])) if row else Decimal('0')

    def view(row):
        if row['image'] == '/static/assets/chests/gingerbread.webp':          # the first picture of the chest was replaced
            row = {**dict(row), 'image': ''}
        return {'id': row['id'], 'title': row['title'], 'image': row['image'] or '/static/assets/chests/gingerbread.png', 'model': row['model'] or DEFAULT_MODEL,
                'model_mobile': row['model_mobile'] or row['model'] or DEFAULT_MOBILE, 'bg': row['bg'] or 'night',
                'bg_open': settings_of(row)['bg_open'], 'bg_reward': settings_of(row)['bg_reward']}

    def rolls_of(row):
        try:
            raw = json.loads(row['rolls'])
        except ValueError:
            raw = DEFAULT_ROLLS
        return {str(k): float(v) for k, v in raw.items() if str(k).isdigit() and 1 <= int(k) <= 6 and float(v) > 0} or {'1': 1.0}

    def loot_rows(cid):
        return db().execute("SELECT * FROM chest_loot WHERE chest_id=? ORDER BY position,id", (cid,)).fetchall()

    def span(text):                                               # '100-250' or '100'
        parts = str(text).split('-')
        try:
            lo = Decimal(parts[0]); hi = Decimal(parts[1]) if len(parts) > 1 else lo
        except Exception:
            abort(400, description='Количество: число или диапазон, например 100-250')
        if lo <= 0 or hi < lo:
            abort(400, description='Диапазон: от меньшего к большему, больше нуля')
        return lo, hi

    def entry_item(row):
        kind, amount = row['kind'], row['amount']
        if kind == 'BALL':
            lo, hi = span(amount)
            n = rng.randint(int(lo), int(hi))
            return {'kind': 'BALL', 'title': 'Шары', 'image': BALL_ICON, 'amount': str(n), 'count': 1}
        if kind == 'GRAM':
            lo, hi = span(amount)
            v = (lo + (hi - lo) * Decimal(str(rng.random()))).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
            v = max(v, Decimal('0.01'))
            return {'kind': 'GRAM', 'title': 'GRAM', 'image': GRAM_ICON, 'amount': plain(v), 'count': 1}
        count = rng.randint(int(row['cnt_min']), int(row['cnt_max']))
        if kind == 'PACK':
            pack = app.extensions['crafter_pack_short'](amount) or {}
            return {'kind': 'PACK', 'title': pack.get('title') or 'Пак', 'image': pack.get('image') or '', 'amount': amount, 'count': count}
        star = app.extensions['crafter_star_gift_short'](amount) or {}
        return {'kind': 'STAR', 'title': star.get('title') or star.get('name') or 'Подарок', 'image': star.get('image') or '', 'amount': amount, 'count': count}

    def settings_of(row):
        try:
            raw = json.loads(row['settings'] or '{}')
        except ValueError:
            raw = {}
        bonus = {k: float(v) for k, v in (raw.get('bonus') or {}).items() if k in KINDS and float(v) > 0}
        guaranteed = [k for k in (raw.get('guaranteed') or []) if k in KINDS]
        pic = lambda v: v if isinstance(v, str) and PATH.fullmatch(v) else ''
        return {'guaranteed': guaranteed, 'bonus': bonus, 'bg_open': pic(raw.get('bg_open')), 'bg_reward': pic(raw.get('bg_reward'))}

    def roll(row):
        """The list of items that one opening gives (nothing is given yet)."""
        loot = loot_rows(row['id'])
        if not loot:
            abort(409, description='В ящике пока ничего нет')
        rolls = rolls_of(row)
        n = int(rng.choices(list(rolls), weights=list(rolls.values()))[0])
        st = settings_of(row)
        by = {}
        for x in loot:
            by.setdefault(x['kind'], []).append(x)
        pick = lambda kind: entry_item(rng.choices(by[kind], weights=[float(x['weight']) for x in by[kind]])[0])
        if not st['bonus'] and not st['guaranteed']:                  # a simple chest: n draws from the whole table
            weights = [float(x['weight']) for x in loot]
            return [entry_item(rng.choices(loot, weights=weights)[0]) for _ in range(n)]
        kinds = [k for k in st['guaranteed'] if k in by][:n]
        pool = {k: w for k, w in st['bonus'].items() if k in by} or {k: 1 for k in by}
        kinds += [rng.choices(list(pool), weights=list(pool.values()))[0] for _ in range(n - len(kinds))]
        return [pick(k) for k in kinds]

    def open_chest(uid, cid, source, preview=False):
        row = db().execute("SELECT * FROM chests WHERE id=?", (cid,)).fetchone()
        if not row or not row['enabled']:
            abort(409, description='Этот ящик сейчас недоступен')
        items = roll(row)
        if not preview:
            balls, gram = 0, Decimal('0')
            for it in items:
                if it['kind'] == 'BALL':
                    balls += int(it['amount'])
                elif it['kind'] == 'GRAM':
                    gram += Decimal(it['amount'])
                elif it['kind'] == 'PACK':
                    it['pack_ids'] = [app.extensions['crafter_grant_pack'](uid, it['amount'], 'chest:' + cid) for _ in range(it['count'])]
                else:
                    it['gift_ids'] = [app.extensions['crafter_grant_star_gift'](uid, it['amount'], 'chest:' + cid) for _ in range(it['count'])]
            if balls:
                new = balls_of(uid) + balls
                if new > LIMIT:
                    abort(409, description='Баланс шаров превысит максимум')
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (new, uid))
            if gram:
                db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(gram_of(uid) + gram)))
            db().execute("INSERT INTO chest_opens(id,user_id,chest_id,source,result,created) VALUES(?,?,?,?,?,?)",
                         (uuid.uuid4().hex, uid, cid, str(source)[:60], json.dumps(items, ensure_ascii=False), int(time.time())))
        return {'chest': view(row), 'items': items, 'preview': preview, 'balance': {'balls': balls_of(uid)}, 'gram_balance': str(gram_of(uid))}

    app.extensions['crafter_open_chest'] = open_chest
    app.extensions['crafter_chest_exists'] = lambda cid: bool(db().execute("SELECT 1 FROM chests WHERE id=?", (cid,)).fetchone())
    app.extensions['crafter_chest_short'] = lambda cid: (lambda r: view(r) if r else None)(db().execute("SELECT * FROM chests WHERE id=?", (cid,)).fetchone())

    # ---------- what is inside (public) ----------
    def info(row):
        loot = loot_rows(row['id'])
        st = settings_of(row)
        rolls = rolls_of(row)
        rt = sum(rolls.values())
        per = {}
        for x in loot:
            per[x['kind']] = per.get(x['kind'], 0) + float(x['weight'])
        bsum = sum(st['bonus'].values())
        total = sum(float(x['weight']) for x in loot) or 1
        out = []
        for x in loot:
            p = float(x['weight']) / (per[x['kind']] or 1)
            if st['bonus'] or st['guaranteed']:
                a = (st['bonus'].get(x['kind'], 0) / bsum) if bsum else 0
                g = 1 if x['kind'] in st['guaranteed'] else 0
                miss = sum(v / rt * (1 - p) ** g * (1 - a * p) ** max(0, int(k) - len(st['guaranteed'])) for k, v in rolls.items())
                once = (1 - miss) * 100
            else:
                once = (1 - sum(v / rt * (1 - float(x['weight']) / total) ** int(k) for k, v in rolls.items())) * 100
            sample = entry_item({**dict(x), 'cnt_min': x['cnt_min'], 'cnt_max': x['cnt_max']}) if x['kind'] in ('PACK', 'STAR') else {'title': 'Шары' if x['kind'] == 'BALL' else 'GRAM', 'image': BALL_ICON if x['kind'] == 'BALL' else GRAM_ICON}
            out.append({'kind': x['kind'], 'title': sample['title'], 'image': sample['image'], 'amount': x['amount'], 'cmin': int(x['cnt_min']), 'cmax': int(x['cnt_max']), 'chance': round(once, 4), 'inside': round(p * 100, 3)})
        return {'chest': view(row), 'settings': st, 'loot': out, 'rolls': [{'count': int(k), 'chance': round(v / rt * 100, 2)} for k, v in sorted(rolls.items(), key=lambda kv: int(kv[0]))]}

    @app.get('/api/chests/<cid>')
    @auth()
    def chest_info(cid):
        row = db().execute("SELECT * FROM chests WHERE id=? AND enabled=1", (cid,)).fetchone()
        if not row:
            abort(404, description='Ящик не найден')
        return info(row)

    # ---------- administration ----------
    @app.get('/api/admin/new-year/chests')
    @auth(admin=True)
    def admin_chests():
        out = []
        for row in db().execute("SELECT * FROM chests ORDER BY created").fetchall():
            d = info(row)
            d['enabled'] = bool(row['enabled'])
            d['rolls_raw'] = rolls_of(row)
            d['settings_raw'] = settings_of(row)
            d['custom'] = {'image': row['image'], 'model': row['model'], 'model_mobile': row['model_mobile']}
            d['loot_raw'] = [{'kind': x['kind'], 'amount': x['amount'], 'cmin': int(x['cnt_min']), 'cmax': int(x['cnt_max']), 'weight': x['weight']} for x in loot_rows(row['id'])]
            out.append(d)
        return {'chests': out}

    def clean_path(value, what):
        value = str(value or '').strip()
        if value and not PATH.fullmatch(value):
            abort(400, description=what + ': загрузите файл')
        return value

    @app.post('/api/admin/new-year/chests')
    @auth(admin=True)
    def admin_chest_save():
        body = request.get_json(silent=True) or {}
        title = ' '.join(str(body.get('title') or '').split())[:40]
        if not title:
            abort(400, description='Введите название ящика')
        image, model, mobile = clean_path(body.get('image'), 'Картинка'), clean_path(body.get('model'), 'Модель'), clean_path(body.get('model_mobile'), 'Облегчённая модель')
        bg = str(body.get('bg') or 'night')[:24]
        rolls = {}
        for k, v in (body.get('rolls') or {}).items():
            try:
                w = float(v)
            except (TypeError, ValueError):
                abort(400, description='Шансы количества предметов: числа')
            if str(k).isdigit() and 1 <= int(k) <= 6 and w > 0:
                rolls[str(k)] = w
        if not rolls:
            abort(400, description='Укажите шанс хотя бы для одного количества предметов')
        loot = []
        for x in body.get('loot') or []:
            kind = str(x.get('kind') or '')
            if kind not in KINDS:
                abort(400, description='Предмет: шары, GRAM, пак или подарок Telegram')
            amount = str(x.get('amount') or '').strip()
            if kind in ('BALL', 'GRAM'):
                lo, hi = span(amount)
                if kind == 'BALL' and (lo != lo.to_integral() or hi != hi.to_integral() or hi > LIMIT):
                    abort(400, description='Шары: целые числа')
                if kind == 'GRAM' and hi > Decimal('100000'):
                    abort(400, description='GRAM: не больше 100000')
            elif kind == 'PACK' and not app.extensions['crafter_pack_exists'](amount):
                abort(400, description='Выберите существующий пак')
            elif kind == 'STAR' and not app.extensions['crafter_star_gift_exists'](amount):
                abort(400, description='Выберите подарок Telegram')
            try:
                cnt_min, cnt_max, weight = int(x.get('cmin') or 1), int(x.get('cmax') or x.get('cmin') or 1), float(x.get('weight'))
            except (TypeError, ValueError):
                abort(400, description='Количество и вес: числа')
            if not (1 <= cnt_min <= cnt_max <= 20) or weight <= 0:
                abort(400, description='Штук от 1 до 20, вес больше нуля')
            loot.append((kind, amount, cnt_min, cnt_max, plain(Decimal(str(weight)))))
        if not loot:
            abort(400, description='Добавьте в ящик хотя бы один предмет')
        enabled = 1 if body.get('enabled') in (True, 1, '1', 'true') else 0
        sraw = body.get('settings') or {}
        try:
            settings = {'guaranteed': [k for k in (sraw.get('guaranteed') or []) if k in KINDS],
                        'bonus': {k: float(v) for k, v in (sraw.get('bonus') or {}).items() if k in KINDS and float(v) > 0},
                        'bg_open': clean_path(sraw.get('bg_open'), 'Фон открытия'), 'bg_reward': clean_path(sraw.get('bg_reward'), 'Фон наград')}
        except (TypeError, ValueError):
            abort(400, description='Шансы бонусных наград: числа')
        cid = body.get('id')
        with db():
            if cid:
                if not db().execute("UPDATE chests SET title=?,image=?,model=?,model_mobile=?,bg=?,rolls=?,settings=?,enabled=? WHERE id=?",
                                    (title, image, model, mobile, bg, json.dumps(rolls), json.dumps(settings), enabled, str(cid))).rowcount:
                    abort(404, description='Ящик не найден')
                db().execute("DELETE FROM chest_loot WHERE chest_id=?", (cid,))
            else:
                cid = uuid.uuid4().hex[:10]
                db().execute("INSERT INTO chests(id,title,image,model,model_mobile,bg,rolls,settings,enabled,created) VALUES(?,?,?,?,?,?,?,?,?,?)", (cid, title, image, model, mobile, bg, json.dumps(rolls), json.dumps(settings), enabled, int(time.time())))
            for i, (kind, amount, cnt_min, cnt_max, weight) in enumerate(loot):
                db().execute("INSERT INTO chest_loot(id,chest_id,position,kind,amount,cnt_min,cnt_max,weight) VALUES(?,?,?,?,?,?,?,?)", (uuid.uuid4().hex[:12], cid, i, kind, amount, cnt_min, cnt_max, weight))
        audit('Chest saved: ' + title)
        return {'ok': True, 'id': cid}

    @app.post('/api/admin/new-year/chests/<cid>/delete')
    @auth(admin=True)
    def admin_chest_delete(cid):
        with db():
            used = db().execute("SELECT 1 FROM shop_items WHERE kind='CHEST' AND amount=? LIMIT 1", (cid,)).fetchone()
            if used:
                abort(409, description='Ящик лежит в магазине: сначала удалите или скройте этот лот')
            if not db().execute("DELETE FROM chests WHERE id=?", (cid,)).rowcount:
                abort(404, description='Ящик не найден')
            db().execute("DELETE FROM chest_loot WHERE chest_id=?", (cid,))
        return {'ok': True}

    @app.post('/api/admin/new-year/chests/<cid>/preview')
    @auth(admin=True)
    def admin_chest_preview(cid):
        """A test opening: the loot is rolled and shown, nothing is given."""
        with db():
            return open_chest(g.user['id'], cid, 'preview', preview=True)

    @app.post('/api/admin/new-year/chest-model')
    @auth(admin=True)
    def admin_chest_model():
        request.max_content_length = MAX_MODEL + 65536
        upload = request.files.get('file')
        if upload is None:
            abort(400, description='Выберите файл .glb')
        body = upload.read(MAX_MODEL + 1)
        if not body or len(body) > MAX_MODEL:
            abort(413, description='Модель должна быть не больше 9 МБ')
        if not body.startswith(b'glTF'):
            abort(415, description='Нужен файл GLB (бинарный glTF)')
        mid = uuid.uuid4().hex
        with db():
            db().execute("INSERT INTO shop_media(id,mime,body,created) VALUES(?,?,?,?)", (mid, 'model/gltf-binary', body, int(time.time())))
        return {'ok': True, 'url': '/media/shop/' + mid}
