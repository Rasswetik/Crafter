import io

from test_app import client, signed

HEAD = ['№', 'Название акции', 'Ящик или дроп', 'Штук', 'Цена, шаров', 'Зачёркнутая цена', 'Скидка %', 'Размер плитки', 'Редкость', 'Плашка', 'Раздел', 'Фон акции (файл ящика)', 'Срок', 'Лимит на игрока', 'Всего штук']


def workbook(extra=0):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = 'Акции к созданию'
    ws.append(HEAD)
    ws.append([1, 'Santa Box ×1', 'Santa Box', 1, 200, '', 0, 'Обычная', 'Авто', 'НОВИНКА', 'Ящики', 'santa-bg-collection.webp', 'без срока', '', ''])
    ws.append([2, 'Santa Box ×10', 'Santa Box', 10, 1700, 2000, 15, 'Большая', 'Эпическая', 'ХИТ', '', 'santa-bg-collection.webp', '168 часов', 3, ''])
    ws.append([3, 'Snowman Drop ×3', 'Snowman Drop', 3, 300, 330, 3, 'Широкая', 'Редкая', '', '', '', '7 дней', '', ''])
    ws.append([4, 'Неизвестный ящик', 'Ящик которого нет', 1, 100, '', 0, 'Обычная', 'Авто', '', '', '', '', '', ''])
    other = wb.create_sheet('Читать сначала')
    other.append(['Это просто текст'])
    for i in range(extra):
        other.append(['Строка %d' % i, 'x' * 200])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_import_reads_sheets_and_rows(client):
    admin = signed(42)
    client.get('/api/me', headers=admin)
    res = client.post('/api/admin/new-year/shop-import/parse', headers=admin, data={'file': (io.BytesIO(workbook()), 'plan.xlsx')}, content_type='multipart/form-data')
    assert res.status_code == 200, res.get_data(as_text=True)
    sheets = {s['name']: s for s in res.json['sheets']}
    assert sheets['Читать сначала']['supported'] is False and sheets['Акции к созданию']['supported'] is True
    rows = sheets['Акции к созданию']['rows']
    assert [r['ok'] for r in rows] == [True, True, True, False]
    big = rows[1]['payload']
    assert (big['kind'], big['amount'], big['bundle'], big['price_balls'], big['old_price_balls'], big['size'], big['rarity'], big['ends_in_hours'], big['per_user']) == ('CHEST', 'santa', 10, 1700, 2000, 'large', 'epic', 168, 3)
    assert big['card_bg'] == 'image:/static/assets/chests/santa-bg-collection.webp'
    drop = rows[2]['payload']
    assert (drop['kind'], drop['amount'], drop['ends_in_hours']) == ('DROP', 'snowman_drop', 168)
    assert any('Раздела' in w for w in rows[0]['warnings'])                 # there is no section «Ящики» yet
    # the payloads are accepted by the ordinary creation of an offer
    for r in rows[:3]:
        made = client.post('/api/admin/new-year/shop', headers=admin, json=r['payload'])
        assert made.status_code == 200, made.get_data(as_text=True)
    again = client.post('/api/admin/new-year/shop-import/parse', headers=admin, data={'file': (io.BytesIO(workbook()), 'plan.xlsx')}, content_type='multipart/form-data')
    assert all(r['duplicate'] for r in next(s for s in again.json['sheets'] if s['supported'])['rows'][:3])


def test_import_from_pasted_rows_and_csv(client):
    admin = signed(42)
    client.get('/api/me', headers=admin)
    text = '\t'.join(HEAD[1:6]) + '\nSanta ×3\tSanta Box\t3\t550\t600\n'
    res = client.post('/api/admin/new-year/shop-import/parse', headers=admin, json={'text': text})
    assert res.status_code == 200 and res.json['sheets'][0]['rows'][0]['payload']['bundle'] == 3
    csv_data = ('Название акции;Ящик;Штук;Цена\nHoney ×1;Honey Holidays Box;1;190\n').encode('utf-8')
    res = client.post('/api/admin/new-year/shop-import/parse', headers=admin, data={'file': (io.BytesIO(csv_data), 'x.csv')}, content_type='multipart/form-data')
    assert res.json['sheets'][0]['rows'][0]['payload']['amount'] == 'honey'
    assert client.post('/api/admin/new-year/shop-import/parse', headers=signed(53), json={'text': text}).status_code in (401, 403)


def test_import_packs_resources_and_bundles(client):
    admin = signed(42)
    client.get('/api/me', headers=admin)
    text = '\t'.join(['Название акции', 'Ящик или дроп', 'Штук', 'Цена, шаров']) + '\n' + '\n'.join([
        'New Year ×3\tNew Year\t3\t90', '1 GRAM\t1 GRAM\t1\t115', '500 шаров\t500 шаров\t1\t10',
        'Набор\tSanta Box ×3 + Snowman Drop ×2 + New Year ×1 + 500 шаров + 0.5 GRAM\t1\t900', 'Плохой набор\tSanta Box + Что-то\t1\t10'])
    res = client.post('/api/admin/new-year/shop-import/parse', headers=admin, json={'text': text})
    rows = res.json['sheets'][0]['rows']
    assert [r['ok'] for r in rows] == [True, True, True, True, False], [r['problems'] for r in rows]
    assert rows[0]['payload']['kind'] == 'PACK' and rows[0]['payload']['bundle'] == 3
    assert (rows[1]['payload']['kind'], rows[1]['payload']['amount']) == ('GRAM', '1')
    assert (rows[2]['payload']['kind'], rows[2]['payload']['amount']) == ('BALL', '500')
    spec = rows[3]['payload']['contents']
    assert rows[3]['payload']['kind'] == 'BUNDLE' and spec['chests'][0]['count'] == 3 and spec['drops'][0]['count'] == 2 and spec['balls'] == 500 and spec['gram'] == '0.5'
    for r in rows[:4]:
        made = client.post('/api/admin/new-year/shop', headers=admin, json=r['payload'])
        assert made.status_code == 200, (r['title'], made.get_data(as_text=True))


def test_import_accepts_a_file_bigger_than_the_default_request_limit(client):
    admin = signed(42)
    client.get('/api/me', headers=admin)
    big = workbook(extra=1500)
    assert len(big) > 20000                                          # the app limits ordinary requests to 16 KB
    res = client.post('/api/admin/new-year/shop-import/parse', headers=admin, data={'file': (io.BytesIO(big), 'plan.xlsx')}, content_type='multipart/form-data')
    assert res.status_code == 200, res.get_data(as_text=True)
