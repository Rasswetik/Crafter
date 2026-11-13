"""Tables for the administrator: every chest with its chances, and a template for chains of offers. Run: python exports_chests.py"""
import os
import sys
import tempfile

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('BOT_TOKEN', 'x')
from app import create_app  # noqa: E402

app = create_app({'DATABASE': os.path.join(tempfile.mkdtemp(), 'x.db'), 'BOT_TOKEN': 'x', 'ADMIN_IDS': {1}, 'DEMO_MODE': True})
c = app.test_client()
c.get('/api/me')
os.makedirs('exports', exist_ok=True)
HEAD = PatternFill('solid', fgColor='2F3B52')
KIND = {'GRAM': 'GRAM', 'BALL': 'Новогодние шары', 'PACK': 'Закрытый пак', 'NFT': 'Прямой NFT', 'STAR': 'Подарок Telegram'}


def style(ws, widths):
    for cell in ws[1]:
        cell.font = Font(bold=True, color='FFFFFF'); cell.fill = HEAD; cell.alignment = Alignment(wrap_text=True, vertical='center')
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'


chests = c.get('/api/admin/new-year/chests').get_json()['chests']
packs = {p['id']: p['title'] for p in c.get('/api/admin/new-year/packs').get_json()['packs']}
wb = Workbook()
ws = wb.active
ws.title = 'Все ящики'
ws.append(['Ящик', 'Наград за открытие', 'Шанс количества (%)', 'Гарантировано', 'Бонусные награды: шанс типа (%)', 'Строк в таблице', 'Показывается игрокам'])
for ch in chests:
    st = ch['settings']
    rolls = ' · '.join('%d — %s%%' % (r['count'], r['chance']) for r in ch['rolls'])
    sure = ', '.join(KIND.get(k, k) for k in st['guaranteed']) or '—'
    bonus = ', '.join('%s %s%%' % (KIND.get(k, k), round(v, 4)) for k, v in st['bonus'].items()) or '—'
    ws.append([ch['chest']['title'], '%d–%d' % (min(r['count'] for r in ch['rolls']), max(r['count'] for r in ch['rolls'])), rolls, sure, bonus, len(ch['loot']), 'да' if ch['enabled'] else 'нет'])
style(ws, [22, 14, 46, 36, 52, 14, 14])
for ch in chests:
    sheet = wb.create_sheet(ch['chest']['title'][:30])
    sheet.append(['Тип', 'Награда', 'Внутри типа (%)', 'Хотя бы раз за ящик (%)'])
    for x in sorted(ch['loot'], key=lambda x: (list(KIND).index(x['kind']) if x['kind'] in KIND else 9, -x['inside'])):
        name = (packs.get(x['amount'], x['title']) if x['kind'] == 'PACK' else x['title'] + ' — ' + x['collection'] if x['kind'] == 'NFT'
                else (x['amount'] + ' шаров' if x['kind'] == 'BALL' else x['amount'] + ' GRAM' if x['kind'] == 'GRAM' else x['title']))
        sheet.append([KIND.get(x['kind'], x['kind']), name, x['inside'], x['chance']])
    style(sheet, [20, 40, 18, 24])

packs_full = {p['id']: p for p in c.get('/api/admin/new-year/packs').get_json()['packs']}


def value_of(ch):
    """Expected contents of one chest (an estimate): rewards per opening, shares by type, value in balls of balls + packs."""
    rolls = ch['rolls']
    exp_n = sum(r['count'] * r['chance'] / 100 for r in rolls)
    st = ch['settings']
    sure = list(st['guaranteed'])
    bonus = {k: float(v) for k, v in st['bonus'].items() if float(v) > 0}
    free = max(0.0, exp_n - len(sure))
    tot = sum(bonus.values()) or 1
    per = {k: (1 if k in sure else 0) + free * bonus.get(k, 0) / tot for k in KIND}
    if 'NFT' not in bonus and 'PACK' in sure:                    # an NFT shares the slot of a pack
        per['NFT'] = per.get('NFT', 0)
    avg = {}
    for k in KIND:
        items = [x for x in ch['loot'] if x['kind'] == k]
        tw = sum(x['inside'] for x in items) or 1
        if k == 'BALL':
            avg[k] = sum(float(x['amount']) * x['inside'] for x in items) / tw
        elif k == 'GRAM':
            avg[k] = sum(float(x['amount']) * x['inside'] for x in items) / tw
        elif k == 'PACK':
            avg[k] = sum(float((packs_full.get(x['amount']) or {}).get('price_balls') or 100) * x['inside'] for x in items) / tw
        else:
            avg[k] = 0.0
    balls = per['BALL'] * avg['BALL']; gram = per['GRAM'] * avg['GRAM']; packs_v = per['PACK'] * avg['PACK']
    return {'n': exp_n, 'per': per, 'balls': balls, 'gram': gram, 'packs': packs_v, 'value': balls + packs_v}


vs = wb.create_sheet('Ценность ящиков', 1)
vs.append(['Ящик', 'Наград в среднем', 'Шаров в среднем', 'GRAM в среднем', 'Паков в среднем', 'NFT в среднем (шт.)', 'Ценность в шарах (шары + паки по цене пака)', 'Совет: цена за 1 ящик (+10%), шаров'])
vals = {}
for ch in chests:
    v = value_of(ch); vals[ch['chest']['id']] = v
    vs.append([ch['chest']['title'], round(v['n'], 2), round(v['balls']), round(v['gram'], 3), round(v['per']['PACK'], 2), round(v['per']['NFT'], 2), round(v['value']), round(v['value'] * 1.1 / 10) * 10])
style(vs, [22, 14, 14, 14, 14, 16, 30, 28])
vs.append([]); vs.append(['Это оценка по таблице шансов. GRAM и NFT в цену не входят: их ценность зависит от курса, прибавьте её сами. Цену пака берём из раздела «Паки»; если там 0, считаем 100 шаров за пак — поправьте под себя.'])

ps = wb.create_sheet('Какие акции создать', 2)
ps.append(['Ящик', 'Акция', 'Ящиков', 'Цена, шаров', 'Старая цена (зачёркнута)', 'Скидка %', 'Размер плитки', 'Раздел', 'Фон акции', 'Срок', 'Лимит на игрока'])
SZ = {1: 'Обычная', 2: 'Широкая'}
for ch in chests:
    v = vals[ch['chest']['id']]; base = max(10, round(v['value'] * 1.1 / 10) * 10); cid = ch['chest']['id']
    counts = [1, 3, 5, 10]
    for i, n in enumerate(counts):
        d = 15 * (n - 1) / 9
        full = base * n
        ps.append([ch['chest']['title'], ch['chest']['title'] + ' ×%d' % n, n, round(full * (1 - d / 100)), full if d else '', round(d), 'Большая' if n == 10 else 'Широкая' if n in (3, 5) else 'Обычная', 'Ящики (создайте раздел) или «Особое»', '%s-bg-collection.webp (есть у ящика)' % cid, '7 дней для ×10, остальные без срока', '' if n < 10 else '3'])
style(ps, [22, 24, 10, 14, 20, 10, 16, 34, 36, 34, 16])

cs = wb.create_sheet('Цепочки и как настроить', 3)
cs.append(['Что', 'Как сделать'])
for row in [
    ('Автосоздание', 'Магазин → «Автосоздание акций»: выберите ящик, впишите 1, 3, 5, 10, цену за 1 ящик (из листа «Ценность ящиков»), наценку и скидку, фон, раздел, срок и лимит. Акции создадутся и встанут сами.'),
    ('Цепочка «Старт»', 'Шаг 1: Ящик (главная награда, бесплатно). Шаг 2: 100 шаров. Шаг 3: Пак за 150 шаров. Шаг 4: Ящик ×3 за цену из листа «Какие акции создать».'),
    ('Цепочка «Недельная»', 'По одному ящику каждого вида на шагах 1–6, на каждом шаге маленькая награда (шары или GRAM), последний шаг — самый дорогой ящик с лимитом 1.'),
    ('Бандлы', 'Ящик ×3 + пак + 500 шаров по цене чуть ниже суммы частей; плитка «Большая», срок 3–7 дней.'),
    ('Разделы', 'Создайте раздел «Ящики» для всех ящиков, «Бандлы» для комплектов, «Цепочки» для цепочек. Цвет и фон раздела берите из «Фоны ящиков».'),
    ('Цены', 'Цена 1 ящика = ценность в шарах + 10%. Для пачек скидка растёт до 15% на ×10. Ящики с NFT и GRAM поднимайте ещё на 10–20%.'),
]:
    cs.append(list(row))
style(cs, [26, 130])

wb.save('exports/chests-chances.xlsx')

wb = Workbook()
ws = wb.active
ws.title = 'Цепочки акций'
ws.append(['Акция', 'Подпись', 'Шаг', 'Заголовок шага', 'Подпись шага', 'Награда (тип)', 'Что именно', 'Штук', 'Цена в шарах', 'PNG шага', 'PNG фона акции'])
ws.append(['Ранний доступ', 'Ура!', 1, 'Шаг 1', 'Главная награда', 'PACK', 'id пака, например snowman', 1, 0, 'main.png', 'bg.png'])
ws.append(['Ранний доступ', 'Ура!', 2, 'Шаг 2', '', 'GRAM', '0.5', '', 0, '', ''])
ws.append(['Ранний доступ', 'Ура!', 3, 'Шаг 3', 'Скидка', 'BALL', '300', '', 100, '', ''])
ws.append(['Ранний доступ', 'Ура!', 4, 'Шаг 4', '', 'CHEST', 'id ящика: gingerbread или snowman', '', 500, 'chest.png', ''])
ws.append(['Ранний доступ', 'Ура!', 5, 'Шаг 5', '', 'NFT', 'коллекция:модель, например santahat:Warm Winter', '', 0, '', ''])
style(ws, [18, 14, 7, 16, 18, 16, 46, 8, 14, 14, 16])
guide = wb.create_sheet('Как заполнять')
for row in (['Поле', 'Как'], ['Шаг 1', 'Главная награда: показывается большой карточкой слева. Остальные шаги идут за ней со стрелками.'], ['Цена в шарах', '0 — бесплатный шаг, на карточке «ПОДАРОК». Больше нуля — платный.'],
            ['Порядок', 'Следующий шаг открывается, когда игрок взял предыдущий.'], ['Награда', 'GRAM, BALL (шары), PACK (пак), STAR (подарок Telegram), CHEST (ящик), NFT (коллекция:модель).'],
            ['PNG шага', 'Любая картинка; если пусто, берётся картинка самой награды.'], ['Где править', 'Админка → Новый год → «Цепочки акций».']):
    guide.append(row)
style(guide, [20, 100])
wb.save('exports/offer-chains-template.xlsx')
print('ok', [ch['chest']['title'] for ch in chests])
