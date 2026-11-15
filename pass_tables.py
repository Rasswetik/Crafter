"""The pass as a table: the administrator downloads the table of a season (xlsx), edits it and loads it back, all together or by parts
(season and prices / levels with XP and rewards / quests). The reader of xlsx and csv is the one of the import of offers; the writer is made here
with the standard library only, so nothing new has to be installed on the server.

Sheets: «Сезон» (parameter, value), «Уровни» (level, XP, free reward, Pass Plus reward), «Квесты», «Справочник» (what can be written in the cells).
A reward is written as text, several rewards are separated by «;»:  Шары 100; Пак vicecity ×2; GRAM 0.1; Ящик vicecapsule; Дроп vicecity_drop; Подарок bear; NFT snowglobe:Crimson Cabin"""
import io
import json
import re
import time
import uuid
import zipfile
from xml.sax.saxutils import escape

from flask import abort, request, send_file
from werkzeug.exceptions import HTTPException

from shop_import import norm, read_text, read_xlsx

MAX_BYTES = 4_000_000
TYPE_WORDS = {'BALL': ('шары', 'шар', 'ball', 'balls', 'поинты', 'коины', 'валюта'), 'GRAM': ('gram', 'грам'), 'PACK': ('пак', 'pack', 'паки'),
              'CHEST': ('ящик', 'капсула', 'chest', 'box', 'capsule'), 'DROP': ('дроп', 'drop'), 'STAR': ('подарок', 'star', 'telegram'), 'NFT': ('nft',), 'EMOJI': ('значок', 'эмодзи', 'emoji', 'badge')}
TYPE_LABEL = {'BALL': 'Шары', 'GRAM': 'GRAM', 'PACK': 'Пак', 'CHEST': 'Ящик', 'DROP': 'Дроп', 'STAR': 'Подарок', 'NFT': 'NFT', 'EMOJI': 'Значок'}
KIND_WORDS = {'mega': ('мега', 'мегаквест', 'mega'), 'daily': ('дня', 'день', 'ежедневный', 'daily'), 'weekly': ('недели', 'неделя', 'еженедельный', 'weekly'),
              'special': ('особый', 'special'), 'season': ('сезона', 'сезон', 'season')}
KIND_LABEL = {'mega': 'Мега', 'daily': 'Дня', 'weekly': 'Недели', 'special': 'Особый', 'season': 'Сезона'}
YES = ('да', 'yes', 'y', '1', 'true', 'вкл', '+')
CUR_WORDS = {'BALL': ('шары', 'шар', 'ball', 'поинты', 'коины', 'валюта'), 'DONATE': ('донат', 'donate')}


# ------------------------------------------------------------------ writer of xlsx
def col_name(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def write_xlsx(sheets, widths=None):
    """{name: [[cell, ...], ...]} -> bytes of an xlsx file (numbers stay numbers, the first row is bold)."""
    widths = widths or {}
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        names = list(sheets)
        z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                   ''.join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1) for i in range(len(names))) + '</Types>')
        z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
                   ''.join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(n, {'"': '&quot;'}), i + 1, i + 1) for i, n in enumerate(names)) + '</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                   ''.join('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1) for i in range(len(names))) +
                   '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' % (len(names) + 1))
        z.writestr('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEFF"/></patternFill></fill></fills>'
                   '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>')
        for i, name in enumerate(names):
            rows = []
            for r, row in enumerate(sheets[name]):
                cells = []
                for c, v in enumerate(row):
                    ref, style = '%s%d' % (col_name(c), r + 1), (' s="1"' if r == 0 else '')
                    if isinstance(v, bool):
                        v = 'да' if v else 'нет'
                    if v is None or v == '':
                        continue
                    if isinstance(v, (int, float)):
                        cells.append('<c r="%s"%s><v>%s</v></c>' % (ref, style, v))
                    else:
                        cells.append('<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, style, escape(str(v))))
                rows.append('<row r="%d">%s</row>' % (r + 1, ''.join(cells)))
            cols = ''.join('<col min="%d" max="%d" width="%d" customWidth="1"/>' % (k + 1, k + 1, w) for k, w in enumerate(widths.get(name, [])))
            z.writestr('xl/worksheets/sheet%d.xml' % (i + 1), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                       '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
                       ('<cols>%s</cols>' % cols if cols else '') + '<sheetData>%s</sheetData></worksheet>' % ''.join(rows))
    return out.getvalue()


# ------------------------------------------------------------------ the text of a reward
def reward_text(r):
    kind, amount, count = r['kind'], str(r['amount']), int(r.get('count') or 1)
    return '%s %s%s' % (TYPE_LABEL[kind], amount, (' ×%d' % count) if count > 1 and kind in ('PACK', 'CHEST', 'DROP', 'STAR') else '')


def rewards_text(rewards):
    return '; '.join(reward_text(r) for r in rewards)


def parse_rewards(text, where):
    """«Шары 100; Пак vicecity ×2» -> [{'kind','amount','count'}]; the mistakes name the cell."""
    out = []
    for part in re.split(r'[;\n]+', str(text or '')):
        part = part.strip()
        if not part or part in ('-', '—', '–'):
            continue
        m = re.match(r'^(\S+)\s*(.*)$', part)
        word, rest = norm(m.group(1)), m.group(2).strip()
        kind = next((k for k, words in TYPE_WORDS.items() if word in words), None)
        if not kind:
            raise ValueError('%s: не понял «%s». Начинайте награду со слова: Шары, GRAM, Пак, Ящик, Дроп, Подарок или NFT' % (where, part))
        count = 1
        c = re.search(r'\s*[×xх*]\s*(\d+)\s*$', rest, re.I)
        if c:
            count, rest = int(c.group(1)), rest[:c.start()].strip()
        if not rest:
            raise ValueError('%s: у награды «%s» нет значения' % (where, part))
        out.append({'kind': kind, 'amount': rest.replace(',', '.') if kind == 'GRAM' else rest.replace(' ', '') if kind in ('BALL',) else rest, 'count': count})
    return out


def yes(v, default=True):
    v = norm(v)
    return default if not v else v in YES


def pick(words_map, value):
    v = norm(value)
    for key, words in words_map.items():
        if v == key or v in [norm(w) for w in words]:
            return key
    return None


def whole(v, where, lo=0):
    try:
        n = int(float(str(v).replace(' ', '').replace(',', '.')))
    except ValueError:
        raise ValueError('%s: нужно число' % where)
    if n < lo:
        raise ValueError('%s: не меньше %d' % (where, lo))
    return n


def find_sheet(sheets, *needles):
    for name, rows in sheets.items():
        n = norm(name)
        if any(x in n for x in needles):
            return rows
    return None


def columns(header, wanted):
    """The index of every wanted field by the words of its column header."""
    found = {}
    for i, cell in enumerate(header):
        n = norm(cell)
        for field, words in wanted.items():
            if field not in found and any(w in n for w in words):
                found[field] = i
    return found


def cell(row, i):
    return str(row[i]).strip() if i is not None and i < len(row) and row[i] is not None else ''


# ------------------------------------------------------------------ installation
def install_pass_tables(app, db, auth, audit, h):
    METRICS, ICONS, LIMIT = h['METRICS'], h['ICONS'], h['LIMIT']
    metric_by_title = {norm(v[0]): k for k, v in METRICS.items()}

    def reference():
        rows = [['Что', 'Значение (пишите в ячейку)', 'Название']]
        for kind, label in (('BALL', 'Шары: число, например  Шары 100'), ('GRAM', 'GRAM: число, например  GRAM 0.1')):
            rows.append([label, '', ''])
        try:
            for r in db().execute("SELECT id,title FROM packs ORDER BY title").fetchall():
                rows.append(['Пак', r['id'], r['title']])
        except Exception:
            pass
        try:
            for r in db().execute("SELECT id,title FROM chests ORDER BY title").fetchall():
                rows.append(['Ящик / капсула', r['id'], r['title']])
        except Exception:
            pass
        from drops import DROPS
        for did in DROPS:
            rows.append(['Дроп', did, (app.extensions['crafter_drop_short'](did) or {}).get('title', did)])
        try:
            for r in db().execute("SELECT id,title FROM emoji_defs ORDER BY position").fetchall():
                rows.append(['Значок', r['id'], r['title']])
        except Exception:
            pass
        rows.append(['', '', ''])
        rows.append(['Что считает квест (колонка «Что считает»)', 'Название', ''])
        for k, v in METRICS.items():
            rows.append(['Квест', v[0], k])
        rows.append(['Тип квеста', 'Мега, Дня, Недели, Особый, Сезона', ''])
        rows.append(['Иконка квеста', ', '.join(ICONS), ''])
        rows.append(['Время', 'ГГГГ-ММ-ДД ЧЧ:ММ по Москве', ''])
        rows.append(['Несколько наград', 'через точку с запятой: Шары 100; Пак vicecity ×2', ''])
        return rows

    def season_sheets(sid):
        s = h['season_row'](sid) if sid else None
        v = h['admin_season_view'](s) if s else None
        cur = lambda k: 'Шары' if k == 'BALL' else 'Донат'
        season = [['Параметр', 'Значение', 'Пояснение'],
                  ['Номер сезона', v['number'] if v else 1, 'целое число'],
                  ['Название', v['title'] if v else 'Crafter Vice', ''],
                  ['Подзаголовок', v['subtitle'] if v else 'Сезон 1', ''],
                  ['Цена Pass Plus', v['plus_price'] if v else 5000, 'в валюте ниже'],
                  ['Валюта Pass Plus', cur(v['plus_currency']) if v else 'Шары', 'Шары или Донат'],
                  ['Цена покупки уровня', v['level_price'] if v else 200, 'за один уровень'],
                  ['Валюта покупки уровня', cur(v['level_currency']) if v else 'Шары', 'Шары или Донат'],
                  ['Начало', (v.get('starts_at_msk') or '').replace('T', ' ') if v else '', 'ГГГГ-ММ-ДД ЧЧ:ММ по Москве, пусто — сразу'],
                  ['Конец', (v.get('ends_at_msk') or '').replace('T', ' ') if v else '', 'ГГГГ-ММ-ДД ЧЧ:ММ по Москве, пусто — без конца'],
                  ['Включён', yes_no(v['enabled']) if v else 'да', 'да или нет']]
        levels = [['Уровень', 'XP на этот уровень', 'Бесплатная награда (Free)', 'Награда Pass Plus']]
        quests = [['Тип', 'Название', 'Что считает', 'Сколько нужно', 'XP', 'Награда', 'Только Plus', 'Иконка', 'Начало', 'Конец', 'Включён']]
        if v:
            for lv in v['levels']:
                levels.append([lv['level'], lv['xp'], rewards_text(lv['free']), rewards_text(lv['plus'])])
            for q in v.get('quests') or []:
                if True:
                    quests.append([KIND_LABEL.get(q['kind'], q['kind']), q['title'], METRICS.get(q['metric'], (q['metric'],))[0], q['target'], q['xp'], rewards_text(q.get('reward') or []),
                                   yes_no(q.get('plus_only')), q.get('icon') or '', (q.get('starts_at_msk') or '').replace('T', ' '), (q.get('ends_at_msk') or '').replace('T', ' '), yes_no(q.get('enabled', True))])
        return {'Сезон': season, 'Уровни': levels, 'Квесты': quests, 'Справочник': reference()}

    def yes_no(v):
        return 'да' if v else 'нет'

    @app.get('/api/admin/pass/export')
    @auth(admin=True)
    def admin_pass_export():
        sid = str(request.args.get('season_id') or '')
        if sid and not h['season_row'](sid):
            abort(404, description='Сезон не найден')
        sheets = season_sheets(sid)
        data = write_xlsx(sheets, {'Сезон': [26, 28, 44], 'Уровни': [10, 18, 52, 52], 'Квесты': [10, 44, 34, 14, 10, 40, 12, 12, 18, 18, 10], 'Справочник': [34, 52, 32]})
        return send_file(io.BytesIO(data), mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name='pass-season.xlsx')

    # ---- reading the table into plain data (nothing is written here)
    def read_file():
        request.max_content_length = MAX_BYTES + 65536
        f = request.files.get('file')
        if f:
            data = f.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                abort(413, description='Файл больше 4 МБ')
            name = (f.filename or '').lower()
            if name.endswith(('.csv', '.txt', '.tsv')):
                try:
                    return {'Уровни': read_text(data.decode('utf-8-sig'))}
                except UnicodeDecodeError:
                    return {'Уровни': read_text(data.decode('cp1251', errors='replace'))}
            return read_xlsx(data)
        abort(400, description='Выберите файл таблицы (xlsx)')

    def parse_season(rows, errors):
        fields = {}
        for row in rows[1:]:
            key = norm(cell(row, 0))
            if key:
                fields[key] = cell(row, 1)
        get = lambda *names: next((fields[norm(n)] for n in names if norm(n) in fields), '')
        out = {}
        try:
            out['number'] = whole(get('Номер сезона') or 1, 'Сезон: номер', 1)
            out['title'] = ' '.join(get('Название').split())[:80]
            if not out['title']:
                raise ValueError('Сезон: впишите название')
            out['subtitle'] = ' '.join(get('Подзаголовок').split())[:120]
            out['plus_price'] = whole(get('Цена Pass Plus') or 0, 'Сезон: цена Pass Plus')
            out['level_price'] = whole(get('Цена покупки уровня', 'Цена уровня') or 0, 'Сезон: цена уровня')
            for field, label in (('plus_currency', 'Валюта Pass Plus'), ('level_currency', 'Валюта покупки уровня')):
                raw = get(label) or 'Шары'
                cur = pick(CUR_WORDS, raw)
                if not cur:
                    raise ValueError('Сезон: «%s» — Шары или Донат' % label)
                out[field] = cur
            for field, label in (('starts_at_msk', 'Начало'), ('ends_at_msk', 'Конец')):
                raw = get(label).strip()
                if raw:
                    if not re.fullmatch(r'\d{4}-\d\d-\d\d[T ]\d\d:\d\d', raw):
                        raise ValueError('Сезон: «%s» — ГГГГ-ММ-ДД ЧЧ:ММ' % label)
                    out[field] = raw.replace(' ', 'T')
                else:
                    out[field] = ''
            out['enabled'] = yes(get('Включён'), True)
        except ValueError as err:
            errors.append(str(err))
            return None
        return out

    def parse_levels(rows, errors):
        if not rows:
            return None
        cols = columns(rows[0], {'level': ('уровень',), 'xp': ('xp', 'опыт'), 'free': ('free', 'бесплатн'), 'plus': ('plus', 'плюс')})
        if not {'xp', 'free', 'plus'} <= set(cols):
            errors.append('Уровни: нужны колонки «Уровень», «XP», «Бесплатная награда» и «Награда Pass Plus»')
            return None
        out = []
        for n, row in enumerate(rows[1:], 2):
            if not any(str(c).strip() for c in row):
                continue
            where = 'Уровни, строка %d' % n
            try:
                level = whole(cell(row, cols.get('level')) or len(out) + 1, where + ': уровень', 1)
                if level != len(out) + 1:
                    raise ValueError('%s: уровни идут по порядку 1, 2, 3 … (здесь %d вместо %d)' % (where, level, len(out) + 1))
                xp = whole(cell(row, cols['xp']), where + ': XP', 1)
                out.append({'level': level, 'xp': xp, 'free': parse_rewards(cell(row, cols['free']), where + ' (Free)'), 'plus': parse_rewards(cell(row, cols['plus']), where + ' (Plus)')})
            except ValueError as err:
                errors.append(str(err))
        if len(out) > 200:
            errors.append('Уровней не больше 200')
        return out

    def parse_quests(rows, errors):
        if not rows:
            return None
        cols = columns(rows[0], {'kind': ('тип',), 'title': ('назван',), 'metric': ('что считает', 'считает'), 'target': ('сколько',), 'xp': ('xp', 'опыт'), 'reward': ('наград',),
                                 'plus': ('только plus', 'plus'), 'icon': ('иконк',), 'start': ('начал',), 'end': ('конец',), 'on': ('включ',)})
        if not {'kind', 'title', 'metric'} <= set(cols):
            errors.append('Квесты: нужны колонки «Тип», «Название» и «Что считает»')
            return None
        out = []
        for n, row in enumerate(rows[1:], 2):
            if not any(str(c).strip() for c in row):
                continue
            where = 'Квесты, строка %d' % n
            try:
                kind = pick(KIND_WORDS, cell(row, cols['kind']))
                if not kind:
                    raise ValueError('%s: тип — Мега, Дня, Недели, Особый или Сезона' % where)
                title = ' '.join(cell(row, cols['title']).split())[:90]
                if not title:
                    raise ValueError('%s: нет названия' % where)
                raw = cell(row, cols['metric'])
                metric = raw if raw in METRICS else metric_by_title.get(norm(raw))
                if not metric:
                    raise ValueError('%s: не знаю, что считает «%s» (список — на листе «Справочник»)' % (where, raw))
                icon = cell(row, cols.get('icon')).lower()
                out.append({'kind': kind, 'title': title, 'metric': metric, 'target': whole(cell(row, cols.get('target')) or 1, where + ': сколько нужно', 1),
                            'xp': whole(cell(row, cols.get('xp')) or 0, where + ': XP'), 'reward': parse_rewards(cell(row, cols.get('reward')), where + ' (награда)'),
                            'plus_only': yes(cell(row, cols.get('plus')), False), 'icon': icon if icon in ICONS else '',
                            'starts_at_msk': cell(row, cols.get('start')).replace(' ', 'T'), 'ends_at_msk': cell(row, cols.get('end')).replace(' ', 'T'), 'enabled': yes(cell(row, cols.get('on')), True)})
            except ValueError as err:
                errors.append(str(err))
        if len(out) > 200:
            errors.append('Квестов не больше 200')
        return out

    def check_rewards(items, label, errors):
        """The prizes are checked by the same rules as in the form (a pack must exist, an amount must be right)."""
        for i, it in enumerate(items, 1):
            for key in ('free', 'plus', 'reward'):
                if key in it and it[key]:
                    try:
                        h['clean_rewards'](it[key])
                    except HTTPException as err:
                        errors.append('%s %d (%s): %s' % (label, i, {'free': 'Free', 'plus': 'Plus', 'reward': 'награда'}[key], err.description))

    def parse_all():
        part = str(request.form.get('part') or 'all')
        if part not in ('all', 'season', 'levels', 'quests'):
            abort(400, description='Что загружать: всё, сезон, уровни или квесты')
        sheets = read_file()
        errors, res = [], {'part': part, 'season': None, 'levels': None, 'quests': None}
        if part in ('all', 'season'):
            rows = find_sheet(sheets, 'сезон') if len(sheets) > 1 or 'Сезон' in sheets else None
            if rows is None:
                errors.append('Нет листа «Сезон»')
            else:
                res['season'] = parse_season(rows, errors)
        if part in ('all', 'levels'):
            rows = find_sheet(sheets, 'уров') or (next(iter(sheets.values())) if len(sheets) == 1 else None)
            if rows is None:
                errors.append('Нет листа «Уровни»')
            else:
                res['levels'] = parse_levels(rows, errors)
                check_rewards(res['levels'] or [], 'Уровень', errors)
        if part in ('all', 'quests'):
            rows = find_sheet(sheets, 'квест')
            if rows is None:
                errors.append('Нет листа «Квесты»')
            else:
                res['quests'] = parse_quests(rows, errors)
                check_rewards(res['quests'] or [], 'Квест', errors)
        res['errors'] = errors[:60]
        return res

    def summary(res):
        s = res['season']
        return {'part': res['part'], 'errors': res['errors'],
                'season': s is not None and {k: s[k] for k in ('number', 'title', 'plus_price', 'plus_currency', 'level_price', 'level_currency', 'enabled')},
                'levels': res['levels'] is not None and {'count': len(res['levels']), 'xp_total': sum(x['xp'] for x in res['levels']),
                                             'free': sum(len(x['free']) for x in res['levels']), 'plus': sum(len(x['plus']) for x in res['levels']),
                                             'sample': [{'level': x['level'], 'xp': x['xp'], 'free': rewards_text(x['free']), 'plus': rewards_text(x['plus'])} for x in res['levels'][:6]]},
                'quests': res['quests'] is not None and {'count': len(res['quests']), 'xp_total': sum(x['xp'] for x in res['quests']),
                                             'by_kind': {KIND_LABEL[k]: sum(1 for x in res['quests'] if x['kind'] == k) for k in KIND_LABEL if any(x['kind'] == k for x in res['quests'])}}}

    @app.post('/api/admin/pass/import')
    @auth(admin=True)
    def admin_pass_import():
        res = parse_all()
        apply = str(request.form.get('apply') or '') == '1'
        sid = str(request.form.get('season_id') or '')
        out = summary(res)
        out['applied'] = False
        if not apply:
            return out
        if res['errors']:
            abort(400, description='В таблице есть ошибки — ничего не загружено: ' + '; '.join(res['errors'][:3]))
        if sid and not h['season_row'](sid):
            abort(404, description='Сезон не найден')
        with db():
            db().execute('BEGIN IMMEDIATE')
            s = res['season']
            if s:
                starts, ends = h['parse_msk'](s['starts_at_msk']), h['parse_msk'](s['ends_at_msk'])
                if starts and ends and ends <= starts:
                    abort(400, description='Конец сезона должен быть позже начала')
                if sid:
                    db().execute("UPDATE pass_seasons SET number=?,title=?,subtitle=?,plus_price=?,plus_currency=?,level_price=?,level_currency=?,starts_at=?,ends_at=?,enabled=? WHERE id=?",
                                 (s['number'], s['title'], s['subtitle'], s['plus_price'], s['plus_currency'], s['level_price'], s['level_currency'], starts, ends, 1 if s['enabled'] else 0, sid))
                else:
                    sid = uuid.uuid4().hex
                    db().execute("INSERT INTO pass_seasons(id,number,title,subtitle,banner,theme,free_ticket,plus_ticket,plus_price,plus_currency,level_price,level_currency,starts_at,ends_at,enabled,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                 (sid, s['number'], s['title'], s['subtitle'], '', json.dumps({'c1': '#5b2cff', 'c2': '#c24fd8', 'c3': '#2a1170', 'pattern': 'snow', 'image': ''}), '', '',
                                  s['plus_price'], s['plus_currency'], s['level_price'], s['level_currency'], starts, ends, 1 if s['enabled'] else 0, int(time.time())))
            if not sid:
                abort(400, description='Сначала выберите сезон или загрузите лист «Сезон»')
            if res['levels'] is not None:
                db().execute("DELETE FROM pass_levels WHERE season_id=?", (sid,))
                for lv in res['levels']:
                    db().execute("INSERT INTO pass_levels(season_id,level,xp,free_reward,plus_reward) VALUES(?,?,?,?,?)",
                                 (sid, lv['level'], lv['xp'], json.dumps(h['clean_rewards'](lv['free']), ensure_ascii=False), json.dumps(h['clean_rewards'](lv['plus']), ensure_ascii=False)))
            if res['quests'] is not None:
                old = {(r['kind'], norm(r['title'])): r['id'] for r in db().execute("SELECT id,kind,title FROM pass_quests WHERE season_id=?", (sid,)).fetchall()}
                keep = set()
                for i, q in enumerate(res['quests']):
                    qid = old.get((q['kind'], norm(q['title']))) or uuid.uuid4().hex                # a quest with the same name keeps the claims of the players
                    if qid in keep:
                        qid = uuid.uuid4().hex
                    keep.add(qid)
                    vals = (q['kind'], q['title'], q['icon'], q['metric'], q['target'], q['xp'], json.dumps(h['clean_rewards'](q['reward']), ensure_ascii=False), 1 if q['plus_only'] else 0, i,
                            h['parse_msk'](q['starts_at_msk']), h['parse_msk'](q['ends_at_msk']), 1 if q['enabled'] else 0)
                    if qid in old.values():
                        db().execute("UPDATE pass_quests SET kind=?,title=?,icon=?,metric=?,target=?,xp=?,reward=?,plus_only=?,position=?,starts_at=?,ends_at=?,enabled=? WHERE id=?", (*vals, qid))
                    else:
                        db().execute("INSERT INTO pass_quests(id,season_id,kind,title,icon,metric,target,xp,reward,plus_only,position,starts_at,ends_at,enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (qid, sid, *vals))
                for qid in set(old.values()) - keep:
                    db().execute("DELETE FROM pass_quests WHERE id=?", (qid,))
        audit('Pass table loaded: %s' % res['part'])
        out['applied'] = True
        out['season_id'] = sid
        return out
