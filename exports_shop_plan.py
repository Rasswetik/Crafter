"""Everything to put into the shop for the chests: value of every chest (Monte Carlo over the real drop tables), prices, offers, bundles, chains, sections.
Run: python exports_shop_plan.py  ->  exports/shop-plan-full.xlsx"""
import gzip
import json
import os
import sys
import tempfile
from collections import defaultdict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('BOT_TOKEN', 'x')
from app import create_app  # noqa: E402

RATE = 100            # assumption: 1 GRAM = 100 balls
MARKUP = 10           # % on top of the value
DISC = 15             # % for the biggest pack
COUNTS = (1, 3, 5, 10)
N = 2000
PACK_GUESS = 300      # price of a pack inside the bundles, balls
app = create_app({'DATABASE': os.path.join(tempfile.mkdtemp(), 'x.db'), 'BOT_TOKEN': 'x', 'ADMIN_IDS': {1}, 'DEMO_MODE': True})
c = app.test_client()
c.get('/api/me')
os.makedirs('exports', exist_ok=True)
cat = {x['id']: x for x in json.loads(gzip.decompress(open('data/catalog_seed.json.gz', 'rb').read()))['collections']}
packs = {p['id']: p for p in c.get('/api/admin/new-year/packs').get_json()['packs']}
chests = c.get('/api/admin/new-year/chests').get_json()['chests']


def nft_price(key):
    col, _, model = key.partition(':')
    x = cat.get(col)
    if not x:
        return 0.0
    for m in x['models']:
        if m['name'] == model:
            return float(m.get('price') or x.get('floor_price') or 0)
    return float(x.get('floor_price') or 0)


def pack_ev(pid):
    p = packs.get(pid)
    if not p:
        return 0.0
    cw = p['card_weights']
    cw = json.loads(cw) if isinstance(cw, str) and cw.startswith('{"') else cw
    if isinstance(cw, str):
        import ast
        cw = ast.literal_eval(cw)
    cw = {int(k): float(v) for k, v in cw.items()}
    cards = sum(k * w for k, w in cw.items()) / sum(cw.values())
    prizes = p['prizes']
    if isinstance(prizes, str):
        import ast
        prizes = ast.literal_eval(prizes)
    tw = sum(float(x['weight']) for x in prizes) or 1
    return cards * sum(float(x['weight']) * float(x.get('value') or 0) for x in prizes) / tw


PACK_EV = {pid: pack_ev(pid) for pid in packs}
ANCHOR_PACK, ANCHOR_PRICE = 'honey', 450                    # the cheapest pack of the shop costs 450 balls: the price of everything else follows from it
RATE = int(round(ANCHOR_PRICE / PACK_EV[ANCHOR_PACK]))         # balls per 1 GRAM of average content

from drops import DROPS, final_chances  # noqa: E402
cfg = DROPS['snowman_drop']
dist, rew = final_chances(cfg)


def spec_value(spec):
    k, a_ = spec
    if k == 'GRAM':
        return float(a_)
    if k == 'BALL':
        return float(a_) / RATE
    if k == 'PACK':
        return PACK_EV.get(a_, 0)
    return nft_price(a_)


drop_ev = sum(p * spec_value(cfg['rewards'][k][i]) for (k, i), p in rew.items())
rows = []
for ch in chests:
    cid = ch['chest']['id']
    tot = defaultdict(float)
    n_rewards = 0
    for _ in range(N):
        items = c.post('/api/admin/new-year/chests/%s/preview' % cid, json={}).get_json()['items']
        n_rewards += len(items)
        for it in items:
            k = it['kind']
            q = int(it.get('count') or 1)
            if k == 'GRAM':
                tot['GRAM'] += float(it['amount']) * q
            elif k == 'BALL':
                tot['BALL'] += float(it['amount']) * q / RATE
            elif k == 'PACK':
                tot['PACK'] += PACK_EV.get(it['amount'], 0) * q
            elif k == 'NFT':
                tot['NFT'] += nft_price(it['amount']) * q
    avg = {k: v / N for k, v in tot.items()}
    ev = sum(avg.values())
    rows.append({'id': cid, 'title': ch['chest']['title'], 'n': n_rewards / N, 'avg': avg, 'ev': ev, 'bg': (ch['chest'].get('bg_collection') or '').split('/')[-1]})
    print(cid, round(ev, 3), {k: round(v, 3) for k, v in avg.items()}, flush=True)

HEAD = PatternFill('solid', fgColor='2F3B52')
GOOD = PatternFill('solid', fgColor='DFF3E3')


def style(ws, widths):
    for cell in ws[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = HEAD
        cell.alignment = Alignment(wrap_text=True, vertical='center')
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'


def r10(x, step=10):
    return max(step, int(round(x / step)) * step)


for r in rows:
    r['balls'] = r['ev'] * RATE
    r['base'] = r10(r['balls'])                       # for «Цена за 1 ящик» of the auto-creation window (the window adds the markup itself)
    r['sell'] = r10(r['base'] * (1 + MARKUP / 100))

wb = Workbook()
ws = wb.active
ws.title = 'Читать сначала'
for line in [
    ['Что в файле'],
    ['1. «Ценность ящиков»: сколько в среднем стоит содержимое каждого ящика (в GRAM и в шарах) и какую цену ставить.'],
    ['2. «Акции к созданию»: готовый список лотов 1/3/5/10 ящиков каждого вида: цена, зачёркнутая цена, скидка, размер плитки, раздел, фон, срок, лимит.'],
    ['3. «Наборы»: комплекты (все ящики, ящик + пак + шары) с ценой.'],
    ['4. «Цепочки»: готовые цепочки акций по шагам с ценами.'],
    ['5. «Разделы»: какие разделы создать и какой фон поставить.'],
    ['6. «Как создавать»: по шагам в админке, включая окно «Автосоздание акций».'],
    ['7. Листы с названиями ящиков: вся таблица шансов с ценностью каждой награды.'],
    [''],
    ['Как считали'],
    ['Ценность = средняя стоимость %d открытий каждого ящика по его реальной таблице шансов (число наград, гарантированные и бонусные).' % N],
    ['GRAM как есть. Шары по курсу 1 GRAM = %d шаров (поменяйте, если у вас другой курс: цены растут пропорционально, в листе ценности есть колонки для курсов 50 и 200). Пак: среднее содержимое по его призам и весам. NFT: цена модели из каталога.' % RATE],
    ['Цена за 1 ящик = ценность + %d%% наценки. Скидка растёт до %d%% на пачке из 10 ящиков (на 3 штуках около 3%%, на 5 штуках около 7%%).' % (MARKUP, DISC)],
    ['Если пак внутри ящика у вас продаётся дешевле своей средней ценности, игроки будут выкупать паки через ящики: сверяйте колонку «Паки внутри».'],
    ['Цены паков считаются от самого дешёвого: Honey Holidays = %d шаров, остальные пропорционально средней ценности содержимого (курс получается 1 GRAM = %d шаров). Если у вас у паков другие цены, впишите их в листе «Акции - паки».' % (ANCHOR_PRICE, RATE)],
]:
    ws.append(line)
ws.column_dimensions['A'].width = 150
ws['A1'].font = Font(bold=True, size=14)
ws['A10'].font = Font(bold=True, size=14)

vs = wb.create_sheet('Ценность ящиков')
vs.append(['Ящик', 'Наград в среднем', 'GRAM внутри (в GRAM)', 'Шары внутри (в GRAM)', 'Паки внутри (в GRAM)', 'NFT внутри (в GRAM)', 'ЦЕННОСТЬ, GRAM', 'ЦЕННОСТЬ, шаров',
           'Цена за 1 ящик для окна «Автосоздание» (без наценки)', 'Цена 1 ящика в магазине (+%d%%)' % MARKUP, 'Цена при курсе 50 шаров за GRAM', 'Цена при курсе 200 шаров за GRAM'])
for r in rows:
    a = r['avg']
    vs.append([r['title'], round(r['n'], 2), round(a.get('GRAM', 0), 3), round(a.get('BALL', 0), 3), round(a.get('PACK', 0), 3), round(a.get('NFT', 0), 3), round(r['ev'], 3), round(r['balls']),
               r['base'], r['sell'], r10(r['ev'] * 50 * (1 + MARKUP / 100)), r10(r['ev'] * 200 * (1 + MARKUP / 100))])
style(vs, [24, 12, 14, 14, 14, 14, 14, 14, 28, 22, 22, 22])
for row in vs.iter_rows(min_row=2, min_col=9, max_col=10):
    for cell in row:
        cell.fill = GOOD
        cell.font = Font(bold=True)

HEADER = ['№', 'Название акции', 'Ящик или дроп', 'Штук', 'Цена, шаров', 'Зачёркнутая цена', 'Скидка %', 'Размер плитки', 'Редкость', 'Плашка', 'Раздел', 'Фон акции (файл ящика)', 'Срок', 'Лимит на игрока', 'Всего штук']
WIDTHS = [5, 30, 44, 8, 13, 16, 10, 15, 13, 11, 14, 34, 18, 14, 12]
counter = [0]


def row_of(title, target, n, price, full, d, size, rar, badge, section, bg='', term='без срока', per='', stock=''):
    counter[0] += 1
    return [counter[0], title, target, n, price, full if full and d else '', round(d), size, rar, badge, section, bg, term, per, stock]


def disc(n, top=COUNTS[-1]):
    return DISC * (n - 1) / (top - 1) if top > 1 else 0


# ---- 1. chests and the drop
ls = wb.create_sheet('Акции - ящики и дроп')
ls.append(HEADER)
for r in rows:
    for n in COUNTS:
        d = disc(n)
        full = round(r['base'] * (1 + MARKUP / 100) * n)
        ls.append(row_of('%s ×%d' % (r['title'], n), r['title'], n, round(full * (1 - d / 100)), full, d, 'Большая' if n == 10 else 'Широкая' if n in (3, 5) else 'Обычная',
                         'Эпическая' if n == 10 else 'Редкая' if n > 1 else 'Авто', 'ХИТ' if n == 10 else 'НОВИНКА' if n == 1 else '', 'Акции', r['bg'], 'без срока' if n < 10 else '168 часов', '' if n < 10 else 3))
drop_base = r10(drop_ev * RATE)
for n in COUNTS:
    d = disc(n)
    full = round(drop_base * (1 + MARKUP / 100) * n)
    ls.append(row_of('Snowman Drop ×%d' % n, 'Snowman Drop', n, round(full * (1 - d / 100)), full, d, 'Большая' if n == 10 else 'Широкая' if n in (3, 5) else 'Обычная',
                     'Эпическая' if n == 10 else 'Редкая' if n > 1 else 'Авто', 'ХИТ' if n == 10 else 'НОВИНКА' if n == 1 else '', 'Акции', '', 'без срока' if n < 10 else '168 часов', '' if n < 10 else 3))
style(ls, WIDTHS)

# ---- 2. packs (every pack: 1, 3, 5, 10 pieces); the price is the average content of a pack + markup, bigger piles are cheaper
pk = wb.create_sheet('Акции - паки')
pk.append(HEADER)
COLLAB = ('gifton', 'goshan', 'nikolay')
for pid, pack in packs.items():
    ev = PACK_EV.get(pid, 0)
    base = max(ANCHOR_PRICE, r10(ev * RATE, 10))
    for n in (1, 3, 5, 10):
        d = disc(n)
        full = base * n
        pk.append(row_of('%s ×%d' % (pack['title'], n), pack['title'], n, max(1, round(full * (1 - d / 100))), full, d, 'Широкая' if n in (5, 10) else 'Обычная', 'Редкая' if n >= 5 else 'Авто', 'ХИТ' if n == 10 else '',
                         'Коллаборации' if pid in COLLAB else 'Паки', '', 'без срока', '', ''))
style(pk, WIDTHS)

# ---- 3. resources: GRAM and balls (a player pays balls; the house keeps ~15%)
rs = wb.create_sheet('Акции - ресурсы')
rs.append(HEADER)
for g_ in (0.5, 1, 2, 5, 10):
    price = r10(g_ * RATE * 1.15, 5)
    rs.append(row_of('%s GRAM' % ('%g' % g_), '%g GRAM' % g_, 1, price, 0, 0, 'Обычная', 'Авто', '', 'Ресурсы', '', 'без срока', 3 if g_ >= 5 else '', ''))
for b_ in (100, 500, 1000):
    rs.append(row_of('%d шаров' % b_, '%d шаров' % b_, 1, 0, 0, 0, 'Обычная', 'Авто', 'БЕСПЛАТНО', 'Ресурсы', '', '24 часа', 1, ''))
style(rs, WIDTHS)

# ---- 4. bundles (the «target» is a sum of parts with «+»: it is imported as a bundle)
bs = wb.create_sheet('Акции - наборы')
bs.append(HEADER)
pack_price = {pid: max(ANCHOR_PRICE, r10(PACK_EV.get(pid, 0) * RATE, 10)) for pid in packs}
by_id = {r['id']: r for r in rows}
sets = [
    ('Стартовый набор', ['%s ×1' % rows[0]['title'], 'Snowman Drop ×1', 'New Year ×1', '200 шаров'], rows[0]['sell'] + r10(drop_ev * RATE * 1.1) + pack_price.get('newyear', 100) + 200 // 1, 15, 'Широкая', 'Редкая', 'НОВИНКА', '', ''),
    ('Праздничный набор', ['%s ×3' % rows[1]['title'], 'Snowman Drop ×2', 'Snowman ×2', '500 шаров'], rows[1]['sell'] * 3 + 2 * r10(drop_ev * RATE * 1.1) + 2 * pack_price.get('snowman', 100) + 500, 18, 'Большая', 'Эпическая', 'ХИТ', '168 часов', 3),
    ('Коллекция ящиков', [('%s ×1' % r['title']) for r in rows], sum(r['sell'] for r in rows), 15, 'Большая', 'Эпическая', 'КОЛЛЕКЦИЯ', '336 часов', 2),
    ('Зимний пак-набор', ['Winter ×3', 'Christmas Carol ×3', 'Silverfrost ×3'], 3 * (pack_price.get('winter', 100) + pack_price.get('christmas', 100) + pack_price.get('silverfrost', 100)), 12, 'Широкая', 'Редкая', '', 'без срока', ''),
    ('Дроп-сет', ['Snowman Drop ×5', '1 GRAM'], 5 * r10(drop_ev * RATE * 1.1) + 115, 12, 'Широкая', 'Редкая', '', 'без срока', ''),
]
for title, parts, parts_sum, dsc, size, rar, badge, term, per in sets:
    price = r10(parts_sum * (1 - dsc / 100), 5)
    bs.append(row_of(title, ' + '.join(parts), 1, price, parts_sum, dsc, size, rar, badge, 'Наборы', '', term, per, ''))
style(bs, WIDTHS)

# ---- 5. choice / random offers and chains: made by hand (the window of an offer: «Игрок выбирает» / «Случайная награда»; the tab of chains)
cs = wb.create_sheet('Выбор и случайные')
cs.append(['Акция', 'Тип', 'Варианты (добавляются кнопкой «+»)', 'Цена', 'Как'])
base1 = {r['id']: r['sell'] for r in rows}
cs.append(['Выбери ящик', 'Игрок выбирает один вариант', ' | '.join(['%s ×1' % r['title'] for r in rows[:4]]), 'у каждого своя: ' + ', '.join(str(r['sell']) for r in rows[:4]), 'Магазин → Новый товар → «Бандл / выбор / случайный» → «Игрок выбирает один вариант», цену впишите под каждым вариантом'])
cs.append(['Выбери награду', 'Игрок выбирает один вариант', 'Santa Box ×1 | Snowman Drop ×1 | New Year ×2', 'одна для всех: %d' % r10(rows[3]['sell'] * 1.0), 'Цена в общем поле «Цена», под вариантами пусто'])
cs.append(['Загадочный ящик', 'Случайная награда', 'Ginger Box ×1 | Snowman Box ×1 | Reindeer Box ×1 | Santa Box ×1', r10(sum(r['sell'] for r in rows[:4]) / 4 * 0.95), 'Игрок видит чёрный ящик со знаком вопроса и получает случайный из добавленных'])
cs.append(['Дроп или ящик', 'Случайная награда', 'Snowman Drop ×1 | Honey Holidays Box ×1 | Candy Cane Box ×1', r10((r10(drop_ev * RATE * 1.1) + rows[4]['sell'] + rows[5]['sell']) / 3 * 0.95), 'Случайный вариант: дроп, ящик или пак'])
style(cs, [22, 28, 64, 30, 90])

ch = wb.create_sheet('Цепочки')
ch.append(['Цепочка', 'Шаг', 'Награды шага (кнопка «+ награда»)', 'Цена шага, шаров', 'Подпись шага'])
sell = {r['id']: r['sell'] for r in rows}
chains_def = [
    ('Ящичный старт', [(1, 'Ginger Box ×1', 0, 'Подарок за вход'), (2, '100 шаров', 0, 'Бесплатно'), (3, 'Snowman Box ×1', sell['gingerbread'] // 2, 'Скидка 50%'), (4, 'Snowman Drop ×1 + 200 шаров', r10(drop_ev * RATE), 'Финал')]),
    ('Праздничная неделя', [(1, 'Reindeer Box ×1', 0, 'День 1'), (2, 'Santa Box ×1', 0, 'День 2'), (3, 'Honey Holidays Box ×1', 0, 'День 3'), (4, 'Candy Cane Box ×1', 0, 'День 4'), (5, 'Snowman Drop ×2 + Candy Cane Box ×3', r10(sell['candy'] * 3 * 0.85 + r10(drop_ev * RATE) * 2), 'Финал, лимит 1 на игрока')]),
    ('Дропы недели', [(1, 'Snowman Drop ×1', 0, 'Подарок'), (2, '0.5 GRAM', 0, 'Бесплатно'), (3, 'Snowman Drop ×1', r10(drop_ev * RATE * 0.8), 'Скидка 20%'), (4, 'Snowman Drop ×3 + 1 GRAM', r10(drop_ev * RATE * 3 * 0.85), 'Финал')]),
    ('Коллекционер паков', [(1, 'New Year ×1', 0, 'Старт'), (2, 'Snowman ×1', 0, 'Бесплатно'), (3, 'Winter ×2 + 100 шаров', pack_price.get('winter', 100), 'Набор'), (4, 'Gingerbread House ×1 + Snowman Drop ×1', pack_price.get('gingerbread', 100) + r10(drop_ev * RATE * .6), 'Финал')]),
]
for title, steps in chains_def:
    for n, rewards, price, label in steps:
        ch.append([title, n, rewards, price, label])
ch.append([])
ch.append(['Как создать', '', 'Вкладка «Цепочки акций» → «Новая цепочка» → шаги; в шаге кнопка «+ награда» открывает окно: Пак, Ящик, Дроп, GRAM, Шары, Подарок. Первый шаг показывается слева как главный.', '', ''])
style(ch, [24, 8, 70, 18, 26])

ss = wb.create_sheet('Разделы')
ss.append(['Раздел', 'Что в нём', 'Откуда лоты', 'Значок'])
for row in [('Акции', 'Ящики и дроп (листы «Акции - ящики и дроп»)', 'уже есть в магазине', 'звезда'),
            ('Паки', 'Обычные паки (лист «Акции - паки»)', 'уже есть', 'пак'),
            ('Коллаборации', 'GiftTon, Goshan, Nikolay', 'уже есть', 'корона'),
            ('Наборы', 'Комплекты (лист «Акции - наборы»)', 'уже есть', 'набор'),
            ('Ресурсы', 'GRAM и шары (лист «Акции - ресурсы»)', 'уже есть', 'самоцвет'),
            ('Награды', 'Награды сообщества', 'уже есть', 'кубок'),
            ('Ящики (свой раздел, по желанию)', 'Только ящики и дроп: тогда в листе замените «Акции» на «Ящики» в колонке «Раздел»', 'создайте в «Особое оформление»', 'подарок')]:
    ss.append(list(row))
style(ss, [30, 62, 34, 14])

hs = wb.create_sheet('Как создавать')
hs.append(['Шаг', 'Что нажать'])
for row in [
    ('1', 'Админка → Новый год → «Магазин» → «Импорт таблицы» → выберите этот файл.'),
    ('2', 'Выберите лист: «Акции - ящики и дроп», «Акции - паки», «Акции - ресурсы», «Акции - наборы» (листы «Ценность», «Выбор и случайные», «Цепочки» для импорта не годятся).'),
    ('3', 'Отметьте галочками акции, которые нужны, и нажмите «Создать выбранные». Строки, которые уже есть в магазине, не отмечаются сами. Нераспознанные строки заблокированы с причиной.'),
    ('4', 'Выбор/случайные награды и цепочки создаются вручную по подсказкам листов «Выбор и случайные» и «Цепочки».'),
    ('5', 'Цены считаются от ценности награды при курсе 1 GRAM = %d шаров, +%d%% наценки, скидка за пачку растёт до %d%%. Курс другой — посмотрите «Ценность ящиков» (колонки для 50 и 200).' % (RATE, MARKUP, DISC)),
]:
    hs.append(list(row))
style(hs, [8, 150])

# ---- the summary of everything that is to be added
sm = wb.create_sheet('Сводка', 1)
sm.append(['Что', 'Сколько', 'Где в файле'])
for what, ws_ in (('Акции - ящики и дроп', ls), ('Акции - паки', pk), ('Акции - ресурсы', rs), ('Акции - наборы', bs)):
    sm.append([what, ws_.max_row - 1, 'лист «%s» (импорт одной кнопкой)' % what])
sm.append(['Выбор и случайные награды', cs.max_row - 1, 'лист «Выбор и случайные» (вручную)'])
sm.append(['Цепочки акций', len(chains_def), 'лист «Цепочки» (вручную)'])
sm.append([])
sm.append(['ИТОГО акций для импорта', sum(w.max_row - 1 for w in (ls, pk, rs, bs)), ''])
style(sm, [34, 12, 52])

KIND = {'GRAM': 'GRAM', 'BALL': 'Шары', 'PACK': 'Пак', 'NFT': 'NFT', 'STAR': 'Подарок Telegram'}
for ch in chests:
    sh = wb.create_sheet(ch['chest']['title'][:28])
    sh.append(['Тип', 'Награда', 'Шанс внутри типа %', 'Хотя бы раз за ящик %', 'Ценность, GRAM'])
    for x in sorted(ch['loot'], key=lambda x: (list(KIND).index(x['kind']) if x['kind'] in KIND else 9, -x['inside'])):
        if x['kind'] == 'PACK':
            name = packs.get(x['amount'], {}).get('title', x['title'])
            val = PACK_EV.get(x['amount'], 0)
        elif x['kind'] == 'NFT':
            name = x['title'] + ' — ' + x['collection']
            val = nft_price(x['amount'])
        elif x['kind'] == 'BALL':
            name = x['amount'] + ' шаров'
            val = float(x['amount']) / RATE
        else:
            name = x['amount'] + ' GRAM'
            val = float(x['amount'])
        sh.append([KIND.get(x['kind'], x['kind']), name, x['inside'], x['chance'], round(val, 3)])
    style(sh, [12, 44, 18, 22, 16])


ds = wb.create_sheet('Дроп Snowman', 1)
ds.append(['Что', 'Значение'])
ds.append(['Ценность одного дропа, GRAM', round(drop_ev, 3)])
ds.append(['Ценность одного дропа, шаров (курс 1 GRAM = %d)' % RATE, round(drop_ev * RATE)])
ds.append(['Цена 1 дропа в магазине (+%d%%), шаров' % MARKUP, r10(drop_ev * RATE * (1 + MARKUP / 100))])
ds.append(['Цена ×3 (скидка 3%)', r10(drop_ev * RATE * (1 + MARKUP / 100) * 3 * 0.97)])
ds.append(['Цена ×5 (скидка 7%)', r10(drop_ev * RATE * (1 + MARKUP / 100) * 5 * 0.93)])
ds.append(['Цена ×10 (скидка 15%)', r10(drop_ev * RATE * (1 + MARKUP / 100) * 10 * 0.85)])
ds.append([])
ds.append(['Редкость после 4 попыток', 'Шанс %'])
for i, pr in enumerate(dist):
    ds.append([cfg['rarities'][i], round(pr * 100, 3)])
ds.append([])
ds.append(['Как создать', 'Магазин → Новый товар → «Дроп» → Snowman Drop; штук за покупку 1/3/5/10; цена из этого листа; размер «Большая», раздел «Ящики» или «Дропы».'])
ds.append(['Выдать вручную', 'В форме лота «Дроп» снизу: Telegram ID игрока и количество.'])
style(ds, [52, 16])
wb.save('exports/shop-plan-full.xlsx')
print('saved')
for r in rows:
    print(r['title'], 'GRAM', round(r['ev'], 2), 'balls', round(r['balls']), 'base', r['base'], 'sell', r['sell'])
print({k: round(v, 2) for k, v in PACK_EV.items()})
