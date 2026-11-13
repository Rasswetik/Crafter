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
