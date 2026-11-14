"""Season pass («Пасс»): a road of levels with a free and a paid reward on every level, XP from quests, quests of several kinds.

- A season has a number, a title, a banner, colours and a pattern of the background, two tickets (free / plus), the price of Pass Plus and the price of one level.
- Level N costs `xp` points (they are summed): the player's level is the number of levels whose summed cost is covered by his XP.
- Every level has a reward on the free road and on the plus road (a list of prizes: GRAM, balls, packs, chests, drops, gifts, NFT).
- XP comes from quests. A quest counts events that the game already writes to the history (an upgrade, a craft, a purchase, a deposit...) in its window:
  the day (quests of the day), the week (quests of the week), or the whole season / a given period (special, season quests, mega quests).
  Mega quests are a chain: the next one opens after the previous one is taken.
- Pass Plus is bought once (any currency of the event wallet), a level can be bought for the price of the level.
Everything is configured in the admin section «Пасс»; the player's page is the section «Сезон»."""
import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from flask import abort, g, request

MSK = timezone(timedelta(hours=3))
KINDS = ('GRAM', 'BALL', 'PACK', 'STAR', 'CHEST', 'DROP', 'NFT')
QUEST_KINDS = ('mega', 'daily', 'weekly', 'special', 'season')
CURRENCIES = {'BALL': ('balls', 'Шары'), 'DONATE': ('donate', 'Донат')}
LIMIT = 10 ** 9
# what a quest can count: key -> (title, kinds of the history, the numeric field to sum (None = count the events))
METRICS = {
    'upgrade': ('Апгрейды', ('upgrade',), None),
    'craft': ('Крафты', ('craft',), None),
    'shop_buy': ('Покупки акций в магазине', ('shop_item_buy',), None),
    'balls_spent': ('Шаров потрачено в магазине', ('shop_item_buy',), 'price_balls'),
    'pack_buy': ('Покупки паков', ('pack_buy',), None),
    'pack_open': ('Открытия паков', ('pack_open',), None),
    'deposit': ('Пополнения баланса (количество)', ('deposit',), None),
    'deposit_gram': ('Пополнено GRAM (сумма)', ('deposit',), 'gram'),
    'arena': ('Раунды на арене', ('arena_result',), None),
    'market_buy': ('Покупки на маркете', ('buy',), None),
    'market_sale': ('Продажи на маркете', ('sale',), None),
    'chain': ('Шаги цепочек акций', ('chain_claim',), None),
    'freebie': ('Бесплатные награды', ('freebie_claim',), None),
    'promo': ('Активации промокодов', ('promo_redeem',), None),
    'stake': ('Операции стейкинга', ('stake_deposit', 'stake_claim'), None),
}
ICONS = ('upgrade', 'craft', 'cart', 'pack', 'wallet', 'swords', 'chain', 'gift', 'trophy', 'heart', 'star', 'bolt')


def msk_now(now):
    return datetime.fromtimestamp(now, MSK)


def day_start(now):
    d = msk_now(now).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(d.timestamp())


def week_start(now):
    d = msk_now(now).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((d - timedelta(days=d.weekday())).timestamp())


def parse_msk(value):
    value = str(value or '').strip()
    if not value:
        return None
    m = re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)', value)
    if not m:
        abort(400, description='Время: дата и часы по Москве')
    try:
        return int(datetime(*[int(x) for x in m.groups()], tzinfo=MSK).timestamp())
    except ValueError:
        abort(400, description='Время: такой даты нет')


def to_msk(epoch):
    return datetime.fromtimestamp(int(epoch), MSK).strftime('%Y-%m-%dT%H:%M') if epoch else ''


def install_season_pass(app, db, auth, audit, record):
    from shop_items import plain

    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS pass_seasons (
                id TEXT PRIMARY KEY, number BIGINT NOT NULL DEFAULT 1, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', banner TEXT NOT NULL DEFAULT '',
                theme TEXT NOT NULL DEFAULT '{}', free_ticket TEXT NOT NULL DEFAULT '', plus_ticket TEXT NOT NULL DEFAULT '',
                plus_price BIGINT NOT NULL DEFAULT 0, plus_currency TEXT NOT NULL DEFAULT 'BALL', level_price BIGINT NOT NULL DEFAULT 0, level_currency TEXT NOT NULL DEFAULT 'BALL',
                starts_at BIGINT, ends_at BIGINT, enabled BIGINT NOT NULL DEFAULT 1, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pass_levels (
                season_id TEXT NOT NULL, level BIGINT NOT NULL, xp BIGINT NOT NULL DEFAULT 100, free_reward TEXT NOT NULL DEFAULT '[]', plus_reward TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY (season_id, level)
            );
            CREATE TABLE IF NOT EXISTS pass_quests (
                id TEXT PRIMARY KEY, season_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'star', metric TEXT NOT NULL, target BIGINT NOT NULL DEFAULT 1,
                xp BIGINT NOT NULL DEFAULT 100, reward TEXT NOT NULL DEFAULT '[]', plus_only BIGINT NOT NULL DEFAULT 0, position BIGINT NOT NULL DEFAULT 0,
                starts_at BIGINT, ends_at BIGINT, enabled BIGINT NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS pass_users (
                user_id BIGINT NOT NULL, season_id TEXT NOT NULL, xp BIGINT NOT NULL DEFAULT 0, plus BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, season_id)
            );
            CREATE TABLE IF NOT EXISTS pass_claims (
                user_id BIGINT NOT NULL, season_id TEXT NOT NULL, level BIGINT NOT NULL, track TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY (user_id, season_id, level, track)
            );
            CREATE TABLE IF NOT EXISTS pass_quest_claims (
                user_id BIGINT NOT NULL, quest_id TEXT NOT NULL, period TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY (user_id, quest_id, period)
            );
            CREATE INDEX IF NOT EXISTS idx_pass_quests_season ON pass_quests(season_id, position);
        """)

    # ------------------------------------------------------------------ prizes
    def describe(r):
        kind, amount, count = r['kind'], str(r['amount']), int(r.get('count') or 1)
        ext = app.extensions
        if kind == 'GRAM':
            return {'kind': kind, 'amount': amount, 'count': 1, 'title': amount + ' GRAM', 'image': '/static/assets/gram.svg'}
        if kind == 'BALL':
            return {'kind': kind, 'amount': amount, 'count': 1, 'title': amount + ' шаров', 'image': '/static/assets/new-year-ornament.svg'}
        if kind == 'PACK':
            p = ext['crafter_pack_short'](amount) or {}
            return {'kind': kind, 'amount': amount, 'count': count, 'title': p.get('title') or 'Пак', 'image': p.get('image') or ''}
        if kind == 'STAR':
            s = ext['crafter_star_gift_short'](amount) or {}
            return {'kind': kind, 'amount': amount, 'count': count, 'title': s.get('name') or s.get('title') or 'Подарок', 'image': s.get('image') or ''}
        if kind == 'CHEST':
            c = ext['crafter_chest_short'](amount) or {}
            return {'kind': kind, 'amount': amount, 'count': count, 'title': c.get('title') or 'Ящик', 'image': c.get('image') or ''}
        if kind == 'DROP':
            d = ext['crafter_drop_short'](amount) or {}
            return {'kind': kind, 'amount': amount, 'count': count, 'title': d.get('title') or 'Дроп', 'image': d.get('image') or ''}
        cid, _, model = amount.partition(':')
        n = ext['crafter_nft_short'](cid, model) or {}
        return {'kind': 'NFT', 'amount': amount, 'count': 1, 'title': n.get('model') or 'NFT', 'image': n.get('image') or '', 'collection': n.get('collection') or ''}

    def clean_rewards(raw):
        """A list of prizes from the admin form: validated, amounts as text."""
        if not isinstance(raw, list):
            return []
        out = []
        for x in raw[:12]:
            kind = str((x or {}).get('kind') or '')
            amount = str((x or {}).get('amount') or '').strip()
            if kind not in KINDS:
                abort(400, description='Награда: GRAM, шары, пак, подарок, ящик, дроп или NFT')
            try:
                count = int(str((x or {}).get('count') or 1))
            except ValueError:
                abort(400, description='Количество награды — целое число')
            if not 1 <= count <= 50:
                abort(400, description='Количество награды: от 1 до 50')
            ext = app.extensions
            if kind == 'GRAM':
                try:
                    v = Decimal(amount.replace(',', '.'))
                except Exception:
                    abort(400, description='GRAM: число')
                if v <= 0 or v > 1000000:
                    abort(400, description='GRAM: от 0 до 1 000 000')
                amount, count = plain(v), 1
            elif kind == 'BALL':
                if not amount.isdigit() or not 1 <= int(amount) <= LIMIT:
                    abort(400, description='Шары: целое число')
                count = 1
            elif kind == 'PACK' and not ext['crafter_pack_exists'](amount):
                abort(400, description='Выберите существующий пак')
            elif kind == 'STAR' and not ext['crafter_star_gift_exists'](amount):
                abort(400, description='Выберите подарок Telegram')
            elif kind == 'CHEST' and not ext['crafter_chest_exists'](amount):
                abort(400, description='Выберите существующий ящик')
            elif kind == 'DROP' and not ext['crafter_drop_exists'](amount):
                abort(400, description='Выберите существующий дроп')
            elif kind == 'NFT':
                cid, _, model = amount.partition(':')
                if not ext['crafter_nft_short'](cid, model):
                    abort(400, description='Выберите коллекцию и модель подарка из каталога')
                count = 1
            out.append({'kind': kind, 'amount': amount, 'count': count})
        return out

    def rewards_of(text):
        try:
            data = json.loads(text or '[]')
        except ValueError:
            return []
        return [x for x in data if isinstance(x, dict) and x.get('kind') in KINDS]

    def give(uid, rewards, src):
        """Give the prizes. Chests and drops open at once on the screen of the player: the answer carries them."""
        ext = app.extensions
        items, opens, drops = [], [], 0
        drop_id = ''
        for r in rewards:
            kind, amount, count = r['kind'], str(r['amount']), int(r.get('count') or 1)
            if kind in ('GRAM', 'BALL'):
                items.append(ext['crafter_loot_item'](kind, amount, 1))
            elif kind == 'PACK':
                items.append(ext['crafter_loot_item']('PACK', amount, count))
            elif kind == 'NFT':
                items.append(ext['crafter_loot_item']('NFT', amount, 1))
            elif kind == 'STAR':
                s = ext['crafter_star_gift_short'](amount) or {}
                items.append({'kind': 'STAR', 'amount': amount, 'count': count, 'title': s.get('name') or 'Подарок', 'image': s.get('image') or ''})
            elif kind == 'CHEST':
                opens += [ext['crafter_open_chest'](uid, amount, src) for _ in range(count)]
            elif kind == 'DROP':
                ext['crafter_start_drops'](uid, amount, count, src)
                drops += count
                drop_id = amount
        if items:
            ext['crafter_grant_loot'](uid, items, src)
        out = {'items': [{'kind': i['kind'], 'title': i['title'], 'image': i['image'], 'count': i.get('count', 1), 'amount': i.get('amount')} for i in items]}
        if opens:
            out['chest_opens'] = opens
        if drops:
            out['drop_granted'] = {'drop': ext['crafter_drop_short'](drop_id), 'qty': drops}
        return out

    # ------------------------------------------------------------------ seasons
    def season_row(sid):
        return db().execute("SELECT * FROM pass_seasons WHERE id=?", (sid,)).fetchone()

    def current_season(now):
        rows = db().execute("SELECT * FROM pass_seasons WHERE enabled=1 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) ORDER BY number DESC, created DESC", (now, now)).fetchall()
        return rows[0] if rows else None

    def levels_of(sid):
        return db().execute("SELECT * FROM pass_levels WHERE season_id=? ORDER BY level", (sid,)).fetchall()

    def level_for(levels, xp):
        total, reached = 0, 0
        for lv in levels:
            total += int(lv['xp'])
            if xp >= total:
                reached = int(lv['level'])
            else:
                break
        return reached

    def cumulative(levels):
        total, out = 0, {}
        for lv in levels:
            total += int(lv['xp'])
            out[int(lv['level'])] = total
        return out

    def theme_of(row):
        try:
            t = json.loads(row['theme'] or '{}')
        except ValueError:
            t = {}
        return {'c1': str(t.get('c1') or '#5b2cff')[:20], 'c2': str(t.get('c2') or '#c24fd8')[:20], 'c3': str(t.get('c3') or '#2a1170')[:20],
                'pattern': t.get('pattern') if t.get('pattern') in ('snow', 'stars', 'dots', 'diamonds', 'none') else 'snow', 'image': str(t.get('image') or '')[:200]}

    def pic(v):
        v = str(v or '').strip()
        return v if re.fullmatch(r'/media/shop/[0-9a-f]{32}|/static/assets/[A-Za-z0-9_./-]+', v) else ''

    def season_view(row, now):
        return {'id': row['id'], 'number': int(row['number']), 'title': row['title'], 'subtitle': row['subtitle'], 'banner': row['banner'], 'theme': theme_of(row),
                'free_ticket': row['free_ticket'] or '/static/assets/pass/ticket-free.svg', 'plus_ticket': row['plus_ticket'] or '/static/assets/pass/ticket-plus.svg',
                'plus_price': int(row['plus_price']), 'plus_currency': row['plus_currency'], 'level_price': int(row['level_price']), 'level_currency': row['level_currency'],
                'starts_at': int(row['starts_at']) if row['starts_at'] else None, 'ends_at': int(row['ends_at']) if row['ends_at'] else None, 'enabled': bool(row['enabled']), 'now': now}

    def wallet(uid):
        row = db().execute("SELECT balls,donate FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return {'balls': int(row['balls']) if row else 0, 'donate': int(row['donate']) if row else 0}

    def gram_text(uid):
        row = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
        return str(row['balance']) if row else '0'

    def pay(uid, currency, amount):
        if amount <= 0:
            return
        col = CURRENCIES[currency][0]
        have = wallet(uid)[col]
        if have < amount:
            abort(409, description='Недостаточно: %s' % CURRENCIES[currency][1].lower())
        db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
        db().execute("UPDATE new_year_wallets SET %s=? WHERE user_id=?" % col, (have - amount, uid))

    def user_row(uid, sid):
        row = db().execute("SELECT * FROM pass_users WHERE user_id=? AND season_id=?", (uid, sid)).fetchone()
        if not row:
            db().execute("INSERT INTO pass_users(user_id,season_id) VALUES(?,?) ON CONFLICT DO NOTHING", (uid, sid))
            row = db().execute("SELECT * FROM pass_users WHERE user_id=? AND season_id=?", (uid, sid)).fetchone()
        return row

    # ------------------------------------------------------------------ quests
    def window_of(q, season, now):
        kind = q['kind']
        if kind == 'daily':
            s = day_start(now)
            return s, s + 86400, 'd:' + msk_now(now).strftime('%Y-%m-%d')
        if kind == 'weekly':
            s = week_start(now)
            return s, s + 7 * 86400, 'w:' + msk_now(now).strftime('%G-W%V')
        start = int(q['starts_at']) if q['starts_at'] else (int(season['starts_at']) if season['starts_at'] else 0)
        end = int(q['ends_at']) if q['ends_at'] else (int(season['ends_at']) if season['ends_at'] else None)
        return start, end, 'once'

    def progress_of(uid, q, start, now):
        title, kinds, field = METRICS.get(q['metric'], (None, (), None))
        if not kinds:
            return 0
        marks = ','.join('?' * len(kinds))
        if field is None:
            row = db().execute("SELECT COUNT(*) AS n FROM history WHERE user_id=? AND kind IN (%s) AND created>=? AND created<=?" % marks, (uid, *kinds, start, now)).fetchone()
            return int(row['n'])
        total = Decimal('0')
        for r in db().execute("SELECT payload FROM history WHERE user_id=? AND kind IN (%s) AND created>=? AND created<=? LIMIT 5000" % marks, (uid, *kinds, start, now)).fetchall():
            try:
                v = json.loads(r['payload']).get(field)
                total += Decimal(str(v)) if v not in (None, '') else 0
            except Exception:
                continue
        return int(total)

    def quests_state(uid, season, plus, now):
        claims = {(r['quest_id'], r['period']) for r in db().execute("SELECT quest_id,period FROM pass_quest_claims WHERE user_id=?", (uid,)).fetchall()}
        out = {k: [] for k in QUEST_KINDS}
        rows = db().execute("SELECT * FROM pass_quests WHERE season_id=? AND enabled=1 ORDER BY position, id", (season['id'],)).fetchall()
        prev_done = True
        for q in rows:
            start, end, period = window_of(q, season, now)
            if end is not None and end <= now and q['kind'] not in ('daily', 'weekly'):
                continue                                                # a finished special quest disappears
            if start and start > now and q['kind'] not in ('daily', 'weekly'):
                state_locked = True
            else:
                state_locked = False
            target = max(1, int(q['target']))
            progress = min(target, progress_of(uid, q, start, now)) if not state_locked else 0
            claimed = (q['id'], period) in claims
            locked = state_locked
            if q['kind'] == 'mega':                                      # a chain: the next opens after the previous one is taken
                locked = locked or not prev_done
                prev_done = claimed
            view = {'id': q['id'], 'kind': q['kind'], 'title': q['title'], 'icon': q['icon'], 'metric': q['metric'], 'target': target, 'progress': progress, 'xp': int(q['xp']),
                    'reward': [describe(r) for r in rewards_of(q['reward'])], 'plus_only': bool(q['plus_only']), 'claimed': claimed, 'locked': locked,
                    'done': progress >= target and not locked, 'ends_in': (end - now) if end else None, 'opens_in': (start - now) if start and start > now else None}
            if q['plus_only'] and not plus:
                view['need_plus'] = True
            out[q['kind']].append(view)
        return out

    # ------------------------------------------------------------------ the state of the player
    def state_for(uid, now):
        season = current_season(now)
        if not season:
            return {'season': None, 'now': now}
        levels = levels_of(season['id'])
        urow = user_row(uid, season['id'])
        xp, plus = int(urow['xp']), bool(urow['plus'])
        claimed = {(int(r['level']), r['track']) for r in db().execute("SELECT level,track FROM pass_claims WHERE user_id=? AND season_id=?", (uid, season['id'])).fetchall()}
        cum = cumulative(levels)
        reached = level_for(levels, xp)
        view_levels = []
        for lv in levels:
            n = int(lv['level'])
            view_levels.append({'level': n, 'xp': int(lv['xp']), 'need': cum[n],
                                'free': {'rewards': [describe(r) for r in rewards_of(lv['free_reward'])], 'claimed': (n, 'free') in claimed},
                                'plus': {'rewards': [describe(r) for r in rewards_of(lv['plus_reward'])], 'claimed': (n, 'plus') in claimed}})
        nxt = next((lv for lv in levels if int(lv['level']) == reached + 1), None)
        base = cum.get(reached, 0)
        me = {'xp': xp, 'level': reached, 'plus': plus, 'max_level': len(levels), 'xp_in_level': xp - base if nxt else (int(levels[-1]['xp']) if levels else 0),
              'xp_for_next': int(nxt['xp']) if nxt else 0, 'balance': wallet(uid), 'gram': gram_text(uid)}
        return {'season': season_view(season, now), 'levels': view_levels, 'me': me, 'quests': quests_state(uid, season, plus, now),
                'refresh': {'daily_in': day_start(now) + 86400 - now, 'weekly_in': week_start(now) + 7 * 86400 - now}, 'now': now}

    @app.get('/api/pass')
    @auth()
    def pass_state():
        with db():
            return state_for(g.user['id'], int(time.time()))

    def add_xp(uid, season, amount):
        urow = user_row(uid, season['id'])
        before = level_for(levels_of(season['id']), int(urow['xp']))
        db().execute("UPDATE pass_users SET xp=xp+? WHERE user_id=? AND season_id=?", (int(amount), uid, season['id']))
        after = level_for(levels_of(season['id']), int(urow['xp']) + int(amount))
        return before, after

    @app.post('/api/pass/quest/claim')
    @auth()
    def pass_quest_claim():
        uid, now = g.user['id'], int(time.time())
        qid = str((request.get_json(silent=True) or {}).get('quest_id') or '')
        gave = None
        with db():
            db().execute('BEGIN IMMEDIATE')
            season = current_season(now)
            q = db().execute("SELECT * FROM pass_quests WHERE id=? AND enabled=1", (qid,)).fetchone()
            if not season or not q or q['season_id'] != season['id']:
                abort(404, description='Квест не найден')
            urow = user_row(uid, season['id'])
            if q['plus_only'] and not urow['plus']:
                abort(409, description='Квест только для Pass Plus')
            state = next((x for x in quests_state(uid, season, bool(urow['plus']), now)[q['kind']] if x['id'] == qid), None)
            if not state or state['locked']:
                abort(409, description='Квест пока закрыт')
            if state['claimed']:
                abort(409, description='Награда уже получена')
            if not state['done']:
                abort(409, description='Квест ещё не выполнен')
            _, _, period = window_of(q, season, now)
            db().execute("INSERT INTO pass_quest_claims(user_id,quest_id,period,created) VALUES(?,?,?,?)", (uid, qid, period, now))
            before, after = add_xp(uid, season, int(q['xp']))
            rewards = rewards_of(q['reward'])
            gave = give(uid, rewards, 'pass-quest:' + qid) if rewards else None
            result = {'ok': True, 'xp': int(q['xp']), 'level_before': before, 'level_after': after, 'given': gave}
        return result

    @app.post('/api/pass/claim')
    @auth()
    def pass_claim():
        """Take the reward of a level (track free / plus) or everything that is open ('all')."""
        uid, now = g.user['id'], int(time.time())
        body = request.get_json(silent=True) or {}
        track = str(body.get('track') or 'all')
        if track not in ('free', 'plus', 'all'):
            abort(400, description='Неверный запрос')
        with db():
            db().execute('BEGIN IMMEDIATE')
            season = current_season(now)
            if not season:
                abort(404, description='Сезона сейчас нет')
            levels = levels_of(season['id'])
            urow = user_row(uid, season['id'])
            reached = level_for(levels, int(urow['xp']))
            taken = {(int(r['level']), r['track']) for r in db().execute("SELECT level,track FROM pass_claims WHERE user_id=? AND season_id=?", (uid, season['id'])).fetchall()}
            wanted = []
            if track == 'all':
                for lv in levels:
                    n = int(lv['level'])
                    if n <= reached:
                        wanted += [(n, 'free')] + ([(n, 'plus')] if urow['plus'] else [])
            else:
                try:
                    n = int(body.get('level'))
                except (TypeError, ValueError):
                    abort(400, description='Уровень: число')
                if n > reached:
                    abort(409, description='Этот уровень ещё не достигнут')
                if track == 'plus' and not urow['plus']:
                    abort(409, description='Награда Pass Plus: сначала откройте Pass Plus')
                wanted = [(n, track)]
            rewards, given_levels = [], []
            by = {int(lv['level']): lv for lv in levels}
            for n, tr in wanted:
                if (n, tr) in taken or n not in by:
                    continue
                rs = rewards_of(by[n]['free_reward' if tr == 'free' else 'plus_reward'])
                db().execute("INSERT INTO pass_claims(user_id,season_id,level,track,created) VALUES(?,?,?,?,?)", (uid, season['id'], n, tr, now))
                given_levels.append({'level': n, 'track': tr})
                rewards += rs
            if not given_levels:
                abort(409, description='Нет наград, которые можно забрать')
            gave = give(uid, rewards, 'pass-level') if rewards else {'items': []}
            result = {'ok': True, 'taken': given_levels, 'given': gave, 'balance': wallet(uid)}
        return result

    @app.post('/api/pass/buy-plus')
    @auth()
    def pass_buy_plus():
        uid, now = g.user['id'], int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            season = current_season(now)
            if not season:
                abort(404, description='Сезона сейчас нет')
            urow = user_row(uid, season['id'])
            if urow['plus']:
                return {'ok': True, 'plus': True, 'again': True, 'balance': wallet(uid)}
            pay(uid, season['plus_currency'], int(season['plus_price']))
            db().execute("UPDATE pass_users SET plus=1 WHERE user_id=? AND season_id=?", (uid, season['id']))
            record('pass_plus_buy', {'season': season['id'], 'price': int(season['plus_price']), 'currency': season['plus_currency']}, uid=uid)
            result = {'ok': True, 'plus': True, 'balance': wallet(uid)}
        return result

    @app.post('/api/pass/buy-level')
    @auth()
    def pass_buy_level():
        uid, now = g.user['id'], int(time.time())
        try:
            count = int((request.get_json(silent=True) or {}).get('count') or 1)
        except (TypeError, ValueError):
            abort(400, description='Сколько уровней: число')
        if not 1 <= count <= 100:
            abort(400, description='Уровней за раз: от 1 до 100')
        with db():
            db().execute('BEGIN IMMEDIATE')
            season = current_season(now)
            if not season:
                abort(404, description='Сезона сейчас нет')
            levels = levels_of(season['id'])
            urow = user_row(uid, season['id'])
            reached = level_for(levels, int(urow['xp']))
            if reached >= len(levels):
                abort(409, description='Все уровни уже открыты')
            count = min(count, len(levels) - reached)
            price = int(season['level_price']) * count
            if int(season['level_price']) <= 0:
                abort(409, description='Покупка уровней отключена')
            pay(uid, season['level_currency'], price)
            target_xp = cumulative(levels)[reached + count]
            db().execute("UPDATE pass_users SET xp=? WHERE user_id=? AND season_id=?", (max(int(urow['xp']), target_xp), uid, season['id']))
            record('pass_level_buy', {'season': season['id'], 'levels': count, 'price': price, 'currency': season['level_currency']}, uid=uid)
            result = {'ok': True, 'bought': count, 'level': reached + count, 'balance': wallet(uid)}
        return result

    # ------------------------------------------------------------------ administration
    def admin_season_view(row):
        levels = levels_of(row['id'])
        base = season_view(row, int(time.time()))
        base.update({'starts_at_msk': to_msk(row['starts_at']), 'ends_at_msk': to_msk(row['ends_at']),
                     'levels': [{'level': int(lv['level']), 'xp': int(lv['xp']), 'free': rewards_of(lv['free_reward']), 'plus': rewards_of(lv['plus_reward'])} for lv in levels],
                     'quests': [{'id': q['id'], 'kind': q['kind'], 'title': q['title'], 'icon': q['icon'], 'metric': q['metric'], 'target': int(q['target']), 'xp': int(q['xp']), 'reward': rewards_of(q['reward']),
                                 'plus_only': bool(q['plus_only']), 'enabled': bool(q['enabled']), 'starts_at_msk': to_msk(q['starts_at']), 'ends_at_msk': to_msk(q['ends_at'])}
                                for q in db().execute("SELECT * FROM pass_quests WHERE season_id=? ORDER BY position, id", (row['id'],)).fetchall()],
                     'players': int(db().execute("SELECT COUNT(*) AS n FROM pass_users WHERE season_id=?", (row['id'],)).fetchone()['n']),
                     'plus_players': int(db().execute("SELECT COUNT(*) AS n FROM pass_users WHERE season_id=? AND plus=1", (row['id'],)).fetchone()['n'])})
        return base

    @app.get('/api/admin/pass')
    @auth(admin=True)
    def admin_pass():
        rows = db().execute("SELECT * FROM pass_seasons ORDER BY number DESC, created DESC").fetchall()
        return {'seasons': [admin_season_view(r) for r in rows], 'metrics': [{'key': k, 'title': v[0], 'sum': bool(v[2])} for k, v in METRICS.items()], 'icons': list(ICONS),
                'currencies': [{'key': k, 'title': v[1]} for k, v in CURRENCIES.items()], 'kinds': list(QUEST_KINDS)}

    def whole(v, lo, hi, what):
        try:
            n = int(str(v).strip() or 0)
        except ValueError:
            abort(400, description='%s: целое число' % what)
        if not lo <= n <= hi:
            abort(400, description='%s: от %d до %d' % (what, lo, hi))
        return n

    @app.post('/api/admin/pass/season')
    @auth(admin=True)
    def admin_pass_season_save():
        body = request.get_json(silent=True) or {}
        title = ' '.join(str(body.get('title') or '').split())[:80]
        if not title:
            abort(400, description='Введите название сезона')
        number = whole(body.get('number') or 1, 1, 9999, 'Номер сезона')
        theme = body.get('theme') if isinstance(body.get('theme'), dict) else {}
        color = lambda v, d: v if isinstance(v, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', v) else d
        theme = {'c1': color(theme.get('c1'), '#5b2cff'), 'c2': color(theme.get('c2'), '#c24fd8'), 'c3': color(theme.get('c3'), '#2a1170'),
                 'pattern': theme.get('pattern') if theme.get('pattern') in ('snow', 'stars', 'dots', 'diamonds', 'none') else 'snow', 'image': pic(theme.get('image'))}
        plus_cur, lvl_cur = str(body.get('plus_currency') or 'BALL'), str(body.get('level_currency') or 'BALL')
        if plus_cur not in CURRENCIES or lvl_cur not in CURRENCIES:
            abort(400, description='Валюта: шары или донат')
        plus_price = whole(body.get('plus_price') or 0, 0, LIMIT, 'Цена Pass Plus')
        level_price = whole(body.get('level_price') or 0, 0, LIMIT, 'Цена уровня')
        starts, ends = parse_msk(body.get('starts_at_msk')), parse_msk(body.get('ends_at_msk'))
        if starts and ends and ends <= starts:
            abort(400, description='Конец сезона должен быть позже начала')
        levels_in = body.get('levels') if isinstance(body.get('levels'), list) else []
        if len(levels_in) > 200:
            abort(400, description='Уровней не больше 200')
        levels = []
        for i, lv in enumerate(levels_in, 1):
            levels.append((i, whole((lv or {}).get('xp') or 0, 1, 10 ** 7, 'XP уровня %d' % i), json.dumps(clean_rewards((lv or {}).get('free')), ensure_ascii=False), json.dumps(clean_rewards((lv or {}).get('plus')), ensure_ascii=False)))
        sid = str(body.get('id') or '')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if sid:
                if not season_row(sid):
                    abort(404, description='Сезон не найден')
                db().execute("UPDATE pass_seasons SET number=?,title=?,subtitle=?,banner=?,theme=?,free_ticket=?,plus_ticket=?,plus_price=?,plus_currency=?,level_price=?,level_currency=?,starts_at=?,ends_at=?,enabled=? WHERE id=?",
                             (number, title, ' '.join(str(body.get('subtitle') or '').split())[:120], pic(body.get('banner')), json.dumps(theme), pic(body.get('free_ticket')), pic(body.get('plus_ticket')),
                              plus_price, plus_cur, level_price, lvl_cur, starts, ends, 1 if body.get('enabled') else 0, sid))
            else:
                sid = uuid.uuid4().hex
                db().execute("INSERT INTO pass_seasons(id,number,title,subtitle,banner,theme,free_ticket,plus_ticket,plus_price,plus_currency,level_price,level_currency,starts_at,ends_at,enabled,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                             (sid, number, title, ' '.join(str(body.get('subtitle') or '').split())[:120], pic(body.get('banner')), json.dumps(theme), pic(body.get('free_ticket')), pic(body.get('plus_ticket')),
                              plus_price, plus_cur, level_price, lvl_cur, starts, ends, 1 if body.get('enabled') else 0, int(time.time())))
            db().execute("DELETE FROM pass_levels WHERE season_id=?", (sid,))
            for n, xp, free, plus in levels:
                db().execute("INSERT INTO pass_levels(season_id,level,xp,free_reward,plus_reward) VALUES(?,?,?,?,?)", (sid, n, xp, free, plus))
        audit('Pass season saved: %s' % title)
        return {'ok': True, 'id': sid}

    @app.post('/api/admin/pass/season/<sid>/delete')
    @auth(admin=True)
    def admin_pass_season_delete(sid):
        with db():
            if not db().execute("DELETE FROM pass_seasons WHERE id=?", (sid,)).rowcount:
                abort(404, description='Сезон не найден')
            for table in ('pass_levels', 'pass_quests', 'pass_users', 'pass_claims'):
                db().execute("DELETE FROM %s WHERE season_id=?" % table, (sid,))
        audit('Pass season deleted %s' % sid)
        return {'ok': True}

    @app.post('/api/admin/pass/quests')
    @auth(admin=True)
    def admin_pass_quests_save():
        """The whole list of quests of a season in the order of the screen (ids that are kept keep the claims of the players)."""
        body = request.get_json(silent=True) or {}
        sid = str(body.get('season_id') or '')
        quests = body.get('quests') if isinstance(body.get('quests'), list) else []
        if len(quests) > 200:
            abort(400, description='Квестов не больше 200')
        clean = []
        for i, q in enumerate(quests):
            kind, metric = str((q or {}).get('kind') or ''), str((q or {}).get('metric') or '')
            if kind not in QUEST_KINDS:
                abort(400, description='Тип квеста: мега, дня, недели, особый или сезона')
            if metric not in METRICS:
                abort(400, description='Выберите, что считает квест')
            title = ' '.join(str((q or {}).get('title') or '').split())[:90]
            if not title:
                abort(400, description='У квеста %d нет названия' % (i + 1))
            icon = pic((q or {}).get('icon'))
            qid = str((q or {}).get('id') or '')
            clean.append((qid if re.fullmatch(r'[0-9a-f]{32}', qid) else uuid.uuid4().hex, kind, title, icon, metric, whole((q or {}).get('target') or 1, 1, 10 ** 9, 'Сколько нужно сделать'),
                          whole((q or {}).get('xp') or 0, 0, 10 ** 7, 'XP квеста'), json.dumps(clean_rewards((q or {}).get('reward')), ensure_ascii=False), 1 if (q or {}).get('plus_only') else 0, i,
                          parse_msk((q or {}).get('starts_at_msk')), parse_msk((q or {}).get('ends_at_msk')), 0 if (q or {}).get('enabled') is False else 1))
        with db():
            db().execute('BEGIN IMMEDIATE')
            if not season_row(sid):
                abort(404, description='Сезон не найден')
            keep = [c[0] for c in clean]
            old = [r['id'] for r in db().execute("SELECT id FROM pass_quests WHERE season_id=?", (sid,)).fetchall()]
            for qid in old:
                if qid not in keep:
                    db().execute("DELETE FROM pass_quests WHERE id=?", (qid,))
            for c in clean:
                if c[0] in old:
                    db().execute("UPDATE pass_quests SET kind=?,title=?,icon=?,metric=?,target=?,xp=?,reward=?,plus_only=?,position=?,starts_at=?,ends_at=?,enabled=? WHERE id=?", (*c[1:], c[0]))
                else:
                    db().execute("INSERT INTO pass_quests(id,season_id,kind,title,icon,metric,target,xp,reward,plus_only,position,starts_at,ends_at,enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (c[0], sid, *c[1:]))
        audit('Pass quests saved: %d' % len(clean))
        return {'ok': True, 'ids': [c[0] for c in clean]}

    @app.post('/api/admin/pass/grant-xp')
    @auth(admin=True)
    def admin_pass_grant_xp():
        body = request.get_json(silent=True) or {}
        try:
            uid = int(body.get('user_id'))
        except (TypeError, ValueError):
            abort(400, description='Укажите числовой номер пользователя')
        amount = whole(body.get('xp') or 0, -10 ** 7, 10 ** 7, 'XP')
        with db():
            season = current_season(int(time.time()))
            if not season:
                abort(404, description='Сезона сейчас нет')
            user_row(uid, season['id'])
            db().execute("UPDATE pass_users SET xp=CASE WHEN xp+?<0 THEN 0 ELSE xp+? END WHERE user_id=? AND season_id=?", (amount, amount, uid, season['id']))
        audit('Pass xp %s to %s' % (amount, uid))
        return {'ok': True}
