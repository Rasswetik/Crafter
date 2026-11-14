"""Everything to put into the shop for the chests: value of every chest (Monte Carlo over the real drop tables), prices, offers, bundles, chains, sections.
Run: python exports_shop_plan.py  ->  exports/chests-shop-plan.xlsx"""
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
N = 3000
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
    ['Цены паков в наборах (лист «Наборы») взяты условно %d шаров за пак: замените на ваши.' % PACK_GUESS],
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

ls = wb.create_sheet('Акции к созданию')
ls.append(['№', 'Название акции', 'Ящик или дроп', 'Штук', 'Цена, шаров', 'Зачёркнутая цена', 'Скидка %', 'Размер плитки', 'Редкость', 'Плашка', 'Раздел', 'Фон акции (файл ящика)', 'Срок', 'Лимит на игрока', 'Всего штук'])
i = 0
for r in rows:
    for n in COUNTS:
        d = DISC * (n - 1) / (COUNTS[-1] - 1)
        full = round(r['base'] * (1 + MARKUP / 100) * n)
        price = round(full * (1 - d / 100))
        i += 1
        ls.append([i, '%s ×%d' % (r['title'], n), r['title'], n, price, full if d else '', round(d), 'Большая' if n == 10 else 'Широкая' if n in (3, 5) else 'Обычная',
                   'Эпическая' if n == 10 else 'Редкая' if n > 1 else 'Авто', 'ХИТ' if n == 10 else 'НОВИНКА' if n == 1 else '', 'Ящики', r['bg'],
                   'без срока' if n < 10 else '168 часов', '' if n < 10 else 3, ''])
drop_base = r10(drop_ev * RATE)
for n in COUNTS:
    d = DISC * (n - 1) / (COUNTS[-1] - 1)
    full = round(drop_base * (1 + MARKUP / 100) * n)
    price = round(full * (1 - d / 100))
    i += 1
    ls.append([i, 'Snowman Drop ×%d' % n, 'Snowman Drop', n, price, full if d else '', round(d), 'Большая' if n == 10 else 'Широкая' if n in (3, 5) else 'Обычная',
               'Эпическая' if n == 10 else 'Редкая' if n > 1 else 'Авто', 'ХИТ' if n == 10 else 'НОВИНКА' if n == 1 else '', 'Ящики', '', 'без срока' if n < 10 else '168 часов', '' if n < 10 else 3, ''])
style(ls, [5, 26, 20, 9, 13, 16, 10, 15, 13, 11, 12, 34, 24, 14, 12])

bs = wb.create_sheet('Наборы')
bs.append(['Набор', 'Что внутри', 'Сумма частей, шаров', 'Цена набора, шаров', 'Скидка %', 'Размер', 'Раздел', 'Срок', 'Лимит'])
allsum = sum(r['sell'] for r in rows)
bs.append(['Коллекция ящиков', 'По 1 ящику всех %d видов' % len(rows), allsum, r10(allsum * 0.85), 15, 'Большая', 'Наборы', '14 дней', 2])
for r in rows[:3]:
    parts = r['sell'] * 3 + PACK_GUESS + 500
    bs.append(['%s + пак + шары' % r['title'], '%s ×3 + любой пак + 500 шаров' % r['title'], parts, r10(parts * 0.88), 12, 'Широкая', 'Наборы', '7 дней', 3])
parts = rows[0]['sell'] + 200
bs.append(['Стартовый', '%s ×1 + 200 шаров' % rows[0]['title'], parts, r10(parts * 0.85), 15, 'Обычная', 'Наборы', 'без срока', 1])
style(bs, [30, 44, 20, 18, 10, 12, 12, 12, 8])

cs = wb.create_sheet('Цепочки')
cs.append(['Цепочка', 'Шаг', 'Награда', 'Что именно', 'Цена шага, шаров', 'Подпись шага'])
a, b, d = rows[0], rows[1], rows[-1]
for row in [
    ('Ящичный старт', 1, 'Ящик', '%s ×1' % a['title'], 0, 'Подарок за вход'),
    ('Ящичный старт', 2, 'Шары', '100', 0, 'Бесплатно'),
    ('Ящичный старт', 3, 'Ящик', '%s ×1' % b['title'], a['sell'] // 2, 'Скидка 50%'),
    ('Ящичный старт', 4, 'Ящик ×3 + шары', '%s ×3 + 200 шаров' % b['title'], r10(b['sell'] * 3 * 0.8), 'Финал'),
    ('Праздничная неделя', 1, 'Ящик', '%s ×1' % rows[2]['title'], 0, 'День 1'),
    ('Праздничная неделя', 2, 'Ящик', '%s ×1' % rows[3]['title'], 0, 'День 2'),
    ('Праздничная неделя', 3, 'Ящик', '%s ×1' % rows[4]['title'], 0, 'День 3'),
    ('Праздничная неделя', 4, 'Ящик', '%s ×1' % rows[5]['title'], 0, 'День 4'),
    ('Праздничная неделя', 5, 'Ящик ×5', '%s ×5' % d['title'], r10(d['sell'] * 5 * 0.88), 'Финал, лимит 1 на игрока'),
]:
    cs.append(list(row))
cs.append([])
cs.append(['Каждый шаг: «+ награда» в окне цепочки (ящик, пак или валюта). Награды первого шага показываются слева как главная, остальные слайдами справа.'])
style(cs, [24, 8, 26, 44, 18, 28])

ss = wb.create_sheet('Разделы')
ss.append(['Раздел', 'Что в нём', 'Фон раздела', 'Значок'])
for row in [('Ящики', 'Все акции ×1/×3/×5/×10', 'любой «Фон ящика» (например santa-bg-collection.webp)', 'подарок'),
            ('Наборы', 'Комплекты из листа «Наборы»', 'спокойный фон', 'звезда'),
            ('Цепочки', 'Цепочки акций', 'фон ящика, который главный в цепочке', 'подарок')]:
    ss.append(list(row))
style(ss, [14, 40, 52, 14])

hs = wb.create_sheet('Как создавать')
hs.append(['Шаг', 'Что нажать'])
for row in [
    ('1', 'Админка → Новый год → «Магазин» → «Автосоздание акций».'),
    ('2', 'Выберите ящик, в «Сколько ящиков» впишите 1, 3, 5, 10.'),
    ('3', '«Цена за 1 ящик» = колонка «для окна Автосоздание» из листа «Ценность ящиков» (у каждого ящика своя). Наценка %d, скидка %d.' % (MARKUP, DISC)),
    ('4', 'Фон: пусто (возьмётся фон ящика) или свой. Раздел «Ящики». Для ×10: срок 168 часов, лимит на игрока 3.'),
    ('5', 'Нажмите «Создать 4 акц.»: акции встанут в раздел сами. Повторите для остальных ящиков.'),
    ('6', 'Наборы: «Новый товар» → Набор, кнопка «+». Цепочки: вкладка «Цепочки».'),
    ('7', 'Проверьте окно лота на телефоне (кнопка «Телефон» в предпросмотре).'),
]:
    hs.append(list(row))
style(hs, [8, 150])

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
wb.save('exports/chests-shop-plan.xlsx')
print('saved')
for r in rows:
    print(r['title'], 'GRAM', round(r['ev'], 2), 'balls', round(r['balls']), 'base', r['base'], 'sell', r['sell'])
print({k: round(v, 2) for k, v in PACK_EV.items()})
