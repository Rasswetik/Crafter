"""Import of offers from a table (xlsx / csv / pasted rows): the administrator uploads the file, picks a sheet, ticks the rows and the offers are created.
The reader of xlsx is written with the standard library only (an xlsx is a zip of xml), so nothing new has to be installed on the server."""
import csv
import io
import re
import zipfile
from xml.etree import ElementTree as ET

from flask import abort, request

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
MAX_BYTES = 6_000_000
MAX_ROWS = 600

FIELDS = {                                  # a header of a column (lower case, without signs) -> the field
    'title': ('название акции', 'название', 'акция', 'лот'),
    'target': ('ящик или дроп', 'ящик', 'дроп', 'что', 'товар', 'позиция'),
    'count': ('штук', 'штук за покупку', 'ящиков', 'количество', 'кол-во', 'колво'),
    'price': ('цена шаров', 'цена', 'цена шары'),
    'old': ('зачёркнутая цена', 'зачеркнутая цена', 'старая цена'),
    'size': ('размер плитки', 'размер'),
    'rarity': ('редкость',),
    'badge': ('плашка', 'бейдж'),
    'section': ('раздел',),
    'bg': ('фон акции файл ящика', 'фон акции', 'фон'),
    'term': ('срок', 'длительность'),
    'per': ('лимит на игрока', 'лимит'),
    'stock': ('всего штук', 'всего', 'сколько всего'),
}
SIZES = {'обычная': 'small', 'маленькая': 'small', 'широкая': 'wide', 'длинная': 'tall', 'большая': 'large', 'баннер': 'banner', 'small': 'small', 'wide': 'wide', 'tall': 'tall', 'large': 'large', 'banner': 'banner'}
RARITIES = {'авто': 'auto', 'auto': 'auto', 'обычная': 'common', 'акция': 'common', 'common': 'common', 'редкая': 'rare', 'rare': 'rare', 'особая': 'special', 'special': 'special',
            'эпическая': 'epic', 'epic': 'epic', 'мифическая': 'mythic', 'mythic': 'mythic', 'легендарная': 'legend', 'legend': 'legend', 'legendary': 'legend'}


def norm(v):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s-]', ' ', str(v or '').lower().replace('ё', 'е'))).strip()


def col_index(ref):
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(data):
    """{sheet name: [[cell, ...], ...]} from the bytes of an xlsx file."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        abort(400, description='Это не файл xlsx. Сохраните таблицу как .xlsx или .csv')
    if sum(i.file_size for i in zf.infolist()) > 60_000_000:
        abort(400, description='Файл слишком большой')
    shared = []
    if 'xl/sharedStrings.xml' in zf.namelist():
        for si in ET.fromstring(zf.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(zf.read('xl/workbook.xml'))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))}
    out = {}
    for sh in wb.find('m:sheets', NS):
        target = rels.get(sh.get('{%s}id' % NS['r'])) or ''
        path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        if path not in zf.namelist():
            continue
        rows = []
        for row in ET.fromstring(zf.read(path)).iter('{%s}row' % NS['m']):
            cells = {}
            for c in row.findall('m:c', NS):
                kind, v = c.get('t'), c.find('m:v', NS)
                if kind == 's' and v is not None:
                    val = shared[int(v.text)] if int(v.text) < len(shared) else ''
                elif kind == 'inlineStr':
                    val = ''.join(t.text or '' for t in c.iter('{%s}t' % NS['m']))
                elif v is not None:
                    val = v.text or ''
                    if kind not in ('str', 'b', 'e'):
                        try:
                            f = float(val)
                            val = str(int(f)) if f == int(f) else repr(f)
                        except ValueError:
                            pass
                else:
                    val = ''
                cells[col_index(c.get('r') or 'A1')] = val
            if cells:
                width = max(cells) + 1
                rows.append([cells.get(i, '') for i in range(width)])
            if len(rows) > MAX_ROWS:
                break
        out[sh.get('name')] = rows
    return out


def read_text(text):
    text = text.lstrip('﻿')
    sample = text[:2000]
    delim = max(('\t', ';', ','), key=lambda d: sample.count(d))
    return list(csv.reader(io.StringIO(text), delimiter=delim))[:MAX_ROWS]


def find_columns(rows):
    """The row of the header and {field: column} - or None when the sheet is not a table of offers."""
    for ri, row in enumerate(rows[:6]):
        cols = {}
        heads = [norm(c) for c in row]
        for field, names in FIELDS.items():
            for n in names:                                    # exact names first, then «starts with»
                hit = next((i for i, h in enumerate(heads) if h == n and i not in cols.values()), None)
                if hit is not None:
                    cols[field] = hit
                    break
        if 'price' in cols and ('target' in cols or 'title' in cols) and 'count' in cols:
            return ri, cols
    return None


def whole(v):
    s = str(v if v is not None else '').strip().replace(' ', '').replace(' ', '')
    if s in ('', '-', '—'):
        return None
    try:
        f = float(s.replace(',', '.'))
    except ValueError:
        return 'bad'
    return int(round(f))


def parse_resource(text):
    """'1 GRAM' / '0.5 грам' -> ('GRAM', '0.5'); '500 шаров' -> ('BALL', '500'); else None."""
    t = norm(text)
    m = re.fullmatch(r'(\d+(?: \d{3})*|\d*\s?\d+(?: \d+)?)\s*(gram|грам\w*)', t)
    m2 = re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*(gram|грам\w*)', str(text or '').lower().replace('ё', 'е').strip())
    if m2:
        return 'GRAM', m2.group(1).replace(',', '.')
    m3 = re.fullmatch(r'(\d[\d ]*)\s*(шар\w*)', t)
    if m3:
        return 'BALL', m3.group(1).replace(' ', '')
    return None


def install_shop_import(app, db, auth, audit):
    def catalogue():
        chests = {norm(r['title']): r['id'] for r in db().execute("SELECT id,title FROM chests").fetchall()}
        chests.update({norm(r['id']): r['id'] for r in db().execute("SELECT id FROM chests").fetchall()})
        packs = {norm(r['title']): r['id'] for r in db().execute("SELECT id,title FROM packs").fetchall()}
        packs.update({norm('pack ' + r['title']): r['id'] for r in db().execute("SELECT id,title FROM packs").fetchall()})
        from drops_seed import DROPS
        drops = {norm(d['title']): k for k, d in DROPS.items()}
        drops.update({norm(k): k for k in DROPS})
        sections = {norm(s['title']): s['id'] for s in app.extensions['crafter_shop_sections'](True) if s.get('kind') != 'exchange' and s['id'] != 'gifts'}
        chest_bg = {r['id']: ((__import__('json').loads(r['settings'] or '{}')).get('bg_collection') or '') for r in db().execute("SELECT id,settings FROM chests").fetchall()}
        return chests, packs, drops, sections, chest_bg

    def convert(rows, hi, cols, cat):
        chests, packs, drops, sections, chest_bg = cat
        existing = {(r['kind'], r['amount'], int(r['bundle'] or 1)) for r in db().execute("SELECT kind,amount,bundle FROM shop_items").fetchall()}
        out = []
        get = lambda row, f: (str(row[cols[f]]).strip() if f in cols and cols[f] < len(row) else '')
        for ri in range(hi + 1, len(rows)):
            row = rows[ri]
            if not any(str(c).strip() for c in row):
                continue
            problems, warns = [], []
            target = get(row, 'target') or get(row, 'title')
            key = norm(target)
            kind = amount = None
            contents = None
            for k, table in (('DROP', drops), ('CHEST', chests), ('PACK', packs)):
                if key in table:
                    kind, amount = k, table[key]
                    break
            if not kind and parse_resource(target):                   # '1 GRAM', '500 шаров'
                kind, amount = parse_resource(target)
            if not kind and '+' in target:                             # a bundle: 'Santa Box ×3 + Snowman ×2 + 500 шаров + 1 GRAM'
                spec = {'packs': {}, 'chests': {}, 'drops': {}, 'gram': '', 'balls': 0}
                bad = None
                for part in [x.strip() for x in target.split('+') if x.strip()]:
                    res = parse_resource(part)
                    if res and res[0] == 'GRAM':
                        spec['gram'] = res[1]
                        continue
                    if res and res[0] == 'BALL':
                        spec['balls'] += int(res[1])
                        continue
                    mm = re.match(r'^(.*?)\s*[×x*]\s*(\d+)$', part)
                    nm, cnt = (mm.group(1), int(mm.group(2))) if mm else (part, 1)
                    hit = next(((bucket, table[norm(nm)]) for bucket, table in (('drops', drops), ('chests', chests), ('packs', packs)) if norm(nm) in table), None)
                    if not hit:
                        bad = nm
                        break
                    spec[hit[0]][hit[1]] = spec[hit[0]].get(hit[1], 0) + cnt
                if bad:
                    problems.append('В наборе не нашёл «%s»' % bad)
                else:
                    kind = 'BUNDLE'
                    contents = {'packs': [{'pack_id': k, 'count': v} for k, v in spec['packs'].items()], 'chests': [{'chest_id': k, 'count': v} for k, v in spec['chests'].items()],
                                'drops': [{'drop_id': k, 'count': v} for k, v in spec['drops'].items()], 'gram': spec['gram'], 'balls': spec['balls'] or ''}
                    amount = ''
            if not kind:                                       # «Snowman Drop ×3» in the title: the name without the count
                key2 = norm(re.sub(r'[×x*]\s*\d+\s*$', '', target))
                for k, table in (('DROP', drops), ('CHEST', chests), ('PACK', packs)):
                    if key2 in table:
                        kind, amount = k, table[key2]
                        break
            if not kind and not problems:
                problems.append('Не нашёл «%s» среди ящиков, дропов, паков, ресурсов и наборов' % target)
            count = whole(get(row, 'count')) if get(row, 'count') else 1
            if count == 'bad' or count is None or not 1 <= count <= 20:
                problems.append('Штук: число от 1 до 20')
                count = 1
            price = whole(get(row, 'price'))
            if price in ('bad', None) or price < 0:
                problems.append('Цена: целое число шаров')
                price = 0
            old = whole(get(row, 'old'))
            if old == 'bad':
                warns.append('Зачёркнутая цена не число: пропущена')
                old = None
            if old is not None and old <= price:
                old = None
            size = SIZES.get(norm(get(row, 'size')), 'small') if get(row, 'size') else 'small'
            rarity = RARITIES.get(norm(get(row, 'rarity')), 'auto') if get(row, 'rarity') else 'auto'
            if get(row, 'rarity') and norm(get(row, 'rarity')) not in RARITIES:
                warns.append('Редкость «%s» не знаю: поставлено «авто»' % get(row, 'rarity'))
            section_id = ''
            if get(row, 'section'):
                section_id = sections.get(norm(get(row, 'section')), '')
                if not section_id:
                    warns.append('Раздела «%s» нет: акция попадёт в «Авто»' % get(row, 'section'))
            bg = ''
            raw_bg = get(row, 'bg')
            if raw_bg:
                m = re.search(r'([A-Za-z0-9_.-]+\.(?:webp|png))', raw_bg)
                if m and re.fullmatch(r'/static/assets/chests/' + re.escape(m.group(1)), '/static/assets/chests/' + m.group(1)):
                    import os
                    if os.path.isfile(os.path.join(app.root_path, 'static', 'assets', 'chests', m.group(1))):
                        bg = 'image:/static/assets/chests/' + m.group(1)
                    else:
                        warns.append('Файла фона «%s» нет: фон ящика по умолчанию' % m.group(1))
            hours = ''
            term = norm(get(row, 'term'))
            if term and not term.startswith('без'):
                m = re.search(r'(\d+)\s*(час|ч\b|д|дн|нед)', term)
                if m:
                    n = int(m.group(1))
                    hours = n * (1 if m.group(2).startswith('ч') else 24 * (7 if m.group(2).startswith('нед') else 1))
                else:
                    warns.append('Срок «%s» не понял: без срока' % get(row, 'term'))
            per, stock = whole(get(row, 'per')), whole(get(row, 'stock'))
            per = '' if per in (None, 'bad') or per < 1 else per
            stock = '' if stock in (None, 'bad') or stock < 1 else stock
            title = get(row, 'title') or ''
            if kind in ('GRAM', 'BALL', 'BUNDLE'):
                count = 1
            payload = {'kind': kind, 'amount': amount, 'bundle': count, 'price_balls': price, 'old_price_balls': old or '', 'size': size, 'rarity': rarity, 'badge': get(row, 'badge')[:14],
                       'section_id': section_id, 'card_bg': bg, 'per_user': per, 'stock': stock, 'title': title[:80]}
            if contents is not None:
                payload['contents'] = contents
            if hours:
                payload['ends_in_hours'] = hours
            dup = bool(kind and kind != 'BUNDLE' and (kind, amount, count) in existing)
            if dup:
                warns.append('Такая акция уже есть в магазине')
            out.append({'row': ri + 1, 'title': title or target, 'target': target, 'kind': kind or '', 'count': count, 'price': price, 'old': old, 'size': size, 'section': get(row, 'section'),
                        'term': get(row, 'term'), 'problems': problems, 'warnings': warns, 'duplicate': dup, 'ok': not problems, 'payload': payload})
        return out

    @app.post('/api/admin/new-year/shop-import/parse')
    @auth(admin=True)
    def admin_shop_import_parse():
        request.max_content_length = MAX_BYTES + 65536                 # the app limits a request to 16 KB, a table is bigger
        sheets = {}
        if request.files.get('file'):
            f = request.files['file']
            data = f.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                abort(413, description='Файл больше 6 МБ')
            name = (f.filename or '').lower()
            if name.endswith('.csv') or name.endswith('.txt') or name.endswith('.tsv'):
                try:
                    sheets['Файл'] = read_text(data.decode('utf-8-sig'))
                except UnicodeDecodeError:
                    sheets['Файл'] = read_text(data.decode('cp1251', errors='replace'))
            else:
                sheets = read_xlsx(data)
        else:
            text = str((request.get_json(silent=True) or {}).get('text') or '')
            if not text.strip():
                abort(400, description='Выберите файл или вставьте строки таблицы')
            sheets['Вставленные строки'] = read_text(text[:MAX_BYTES])
        cat = catalogue()
        result = []
        for name, rows in sheets.items():
            found = find_columns(rows)
            if not found:
                result.append({'name': name, 'supported': False, 'rows': [], 'note': 'Это не таблица акций: нет колонок «Цена», «Штук» и «Ящик или дроп»'})
                continue
            hi, cols = found
            result.append({'name': name, 'supported': True, 'rows': convert(rows, hi, cols, cat), 'note': ''})
        if not any(s['supported'] for s in result):
            result.sort(key=lambda s: s['name'])
        return {'sheets': result}
