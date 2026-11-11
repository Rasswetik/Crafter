"""OpenAPI 3 description of the Crafter Partner API (served at /partner-api.openapi.json)."""


def build(base):
    idem = {'name': 'Idempotency-Key', 'in': 'header', 'required': True, 'description': 'Уникальный номер операции, 16–80 символов A–Z a–z 0–9 _ -. Сохраняйте его до получения результата.',
            'schema': {'type': 'string', 'pattern': '^[A-Za-z0-9_-]{16,80}$'}}
    err = {'description': 'Ошибка', 'content': {'application/json': {'schema': {'$ref': '#/components/schemas/Error'}}}}
    ok_op = lambda desc, result: {'description': desc, 'content': {'application/json': {'schema': {'allOf': [{'$ref': '#/components/schemas/Operation'}, {'properties': {'result': result}}]}}}}

    def post(summary, desc, body, result):
        return {'post': {'summary': summary, 'description': desc, 'parameters': [idem],
                         'requestBody': {'required': True, 'content': {'application/json': {'schema': body}}},
                         'responses': {'200': ok_op('Выполнено', result), '202': ok_op('Ещё выполняется: проверьте GET /operations/{id}', {'type': 'object'}),
                                       '400': err, '401': err, '403': err, '404': err, '409': err, '429': err, '503': err}}}

    def get(summary, desc, params=None, schema=None):
        return {'get': {'summary': summary, 'description': desc, 'parameters': params or [],
                        'responses': {'200': {'description': 'Успех', 'content': {'application/json': {'schema': schema or {'type': 'object'}}}}, '401': err, '404': err, '429': err}}}

    q = lambda name, desc, required=False, schema=None: {'name': name, 'in': 'query', 'required': required, 'description': desc, 'schema': schema or {'type': 'string'}}
    money = {'type': 'string', 'example': '12.5', 'description': 'Сумма в GRAM строкой. Вместо неё можно передать <имя>_nano: целое число в нано-единицах (1 GRAM = 1 000 000 000).'}
    return {
        'openapi': '3.0.3',
        'info': {'title': 'Crafter Partner API', 'version': '1.0.0',
                 'description': 'Подключайте свой проект к Crafter: баланс аккаунта, каталог, лоты Crafter и подключённого маркета, покупка, продажа и передача подарков. '
                                'Ключ выдаёт бот командой /api. Карточные паки в API не участвуют.'},
        'servers': [{'url': base}],
        'security': [{'bearerAuth': []}],
        'components': {
            'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'CRT/…', 'description': 'Ключ вида CRT/ и 40 символов. Передаётся только с сервера.'}},
            'schemas': {
                'Error': {'type': 'object', 'properties': {'ok': {'type': 'boolean', 'example': False}, 'error': {'type': 'string'}, 'code': {'type': 'string', 'example': 'price_changed'}}},
                'Operation': {'type': 'object', 'properties': {'ok': {'type': 'boolean'}, 'operation_id': {'type': 'string'}, 'status': {'type': 'string', 'enum': ['done', 'processing', 'failed', 'review']}, 'result': {'type': 'object'}}},
                'Lot': {'type': 'object', 'properties': {'lot_id': {'type': 'string', 'example': 'crafter-9f2c…'}, 'source': {'type': 'string', 'enum': ['crafter', 'market']},
                                                         'market': {'type': 'string', 'example': 'Thermos'}, 'collection': {'type': 'string'}, 'number': {'type': 'integer'}, 'model': {'type': 'string'},
                                                         'backdrop': {'type': 'string'}, 'symbol': {'type': 'string'}, 'image': {'type': 'string'}, 'price': money, 'price_nano': {'type': 'string'}}},
                'Gift': {'type': 'object', 'properties': {'gift_id': {'type': 'string'}, 'name': {'type': 'string'}, 'number': {'type': 'integer'}, 'model': {'type': 'string'},
                                                          'status': {'type': 'string', 'enum': ['unlisted', 'listed']}, 'listing_price': {'type': 'string', 'nullable': True}}},
            },
        },
        'paths': {
            '/account': get('Аккаунт и баланс', 'Баланс в GRAM, права ключа и режим работы (`test` или `work`).'),
            '/collections': get('Коллекции', 'Все коллекции каталога с минимальной ценой (флор) в GRAM.'),
            '/models': get('Модели коллекции', 'Модели с картинками, а также фоны и узоры.', [q('collection', 'ID или название коллекции', True)]),
            '/lots': get('Лоты', 'Лоты Crafter и подключённого маркета вместе, дешёвые первыми. Паки в список не попадают.',
                         [q('collection', 'ID или название коллекции', True), q('model', 'Название модели'), q('number', 'Номер подарка'),
                          q('source', 'all, crafter или market', schema={'type': 'string', 'enum': ['all', 'crafter', 'market']}),
                          q('sort', 'price_asc или price_desc'), q('page', 'Страница, с 1', schema={'type': 'integer'}), q('limit', 'До 50', schema={'type': 'integer'})]),
            '/inventory': get('Ваши подарки', 'До 50 подарков за запрос. Курсор: `before` = последний `gift_id` предыдущей страницы.', [q('before', 'Курсор')]),
            '/gifts/{gift_id}': get('Подарок или лот', 'Ваш подарок либо открытый лот Crafter.', [{'name': 'gift_id', 'in': 'path', 'required': True, 'schema': {'type': 'string'}}]),
            '/operations/{operation_id}': get('Результат операции', 'Сохранённый результат по Idempotency-Key.', [{'name': 'operation_id', 'in': 'path', 'required': True, 'schema': {'type': 'string'}}]),
            '/star-gifts': get('Каталог обычных подарков Telegram', 'Bear, Rose, Cake… Цена в GRAM (100 ★ = 1 GRAM), PNG-картинка и telegram_gift_id — идентификатор подарка в Telegram, по которому его отправляют.'),
            '/star-gifts/inventory': get('Ваши обычные подарки', 'Подарки Telegram на аккаунте. status: available или withdrawing.'),
            '/star-gifts/sell': post('Продать обычный подарок сайту', 'Сайт сразу выкупает подарок и зачисляет его стоимость на баланс.',
                                     {'type': 'object', 'required': ['gift_id'], 'properties': {'gift_id': {'type': 'string'}}}, {'type': 'object'}),
            '/star-gifts/withdraw': post('Вывести обычный подарок в Telegram', 'Релейер Crafter отправляет настоящий подарок владельцу ключа с подписью «Gift from Crafter».',
                                         {'type': 'object', 'required': ['gift_id'], 'properties': {'gift_id': {'type': 'string'}}}, {'type': 'object'}),
            '/star-gifts/transfer': post('Передать обычный подарок игроку Crafter', 'Бесплатно, по Telegram ID получателя (нужен @username).',
                                         {'type': 'object', 'required': ['gift_id', 'telegram_id'], 'properties': {'gift_id': {'type': 'string'}, 'telegram_id': {'type': 'string'}}}, {'type': 'object'}),
            '/history': get('История аккаунта', 'Покупки, продажи, передачи, пополнения и выводы. До 100 записей, параметр `limit`.', [q('limit', 'От 1 до 100', schema={'type': 'integer'})]),
            '/offers': get('Офферы', 'Полученные вами предложения (received), ваши предложения на лоты (placed) и на коллекции (collection_offers).'),
            '/offers/create': post('Сделать оффер', 'Предложение цены на лот (`lot_id`) или на коллекцию (`collection`, необязательно `model`, `backdrop`, `symbol`, `quantity`). Сумма резервируется на балансе. `expiry`: none, day или week.',
                                   {'type': 'object', 'required': ['price'], 'properties': {'lot_id': {'type': 'string'}, 'collection': {'type': 'string'}, 'price': money, 'expiry': {'type': 'string', 'enum': ['none', 'day', 'week']}, 'quantity': {'type': 'integer'}}}, {'type': 'object'}),
            '/offers/respond': post('Ответить на оффер', 'accept — принять полученный оффер, decline — отклонить, withdraw — отозвать свой.',
                                    {'type': 'object', 'required': ['offer_id', 'action'], 'properties': {'offer_id': {'type': 'string'}, 'action': {'type': 'string', 'enum': ['accept', 'decline', 'withdraw']}}}, {'type': 'object'}),
            '/withdraw': post('Вывести NFT в Telegram', 'Заявка на вывод подарка на ваш Telegram. Комиссия указана в ответе. Статус — GET /withdrawals.',
                              {'type': 'object', 'required': ['gift_id'], 'properties': {'gift_id': {'type': 'string'}}}, {'type': 'object'}),
            '/withdrawals': get('Выводы NFT', 'Ваши заявки на вывод подарков: статус, причина отказа и можно ли отменить.'),
            '/withdrawals/cancel': post('Отменить вывод NFT', 'Пока подарок не отправляется, подарок и комиссия возвращаются.',
                                        {'type': 'object', 'required': ['withdrawal_id'], 'properties': {'withdrawal_id': {'type': 'string'}}}, {'type': 'object'}),
            '/buy': post('Купить лот', 'Покупка лота Crafter (`crafter-…`) или лота маркета (`m.<коллекция>.<id>`). Если цена выше max_price, покупка не выполняется.',
                         {'type': 'object', 'required': ['lot_id'], 'properties': {'lot_id': {'type': 'string'}, 'max_price': money}}, {'type': 'object'}),
            '/sell': post('Выставить подарок', 'Выставляет на маркет Crafter или меняет цену уже выставленного.',
                          {'type': 'object', 'required': ['gift_id', 'price'], 'properties': {'gift_id': {'type': 'string'}, 'price': money}}, {'type': 'object'}),
            '/unlist': post('Снять с продажи', 'Снимает свой лот.', {'type': 'object', 'required': ['gift_id'], 'properties': {'gift_id': {'type': 'string'}}}, {'type': 'object'}),
            '/ton/wallet': get('Кошелёк для вывода TON', 'Кошелёк, подключённый в приложении (Профиль → Кошелёк). Вывод идёт только на него: адрес в запросе передать нельзя.'),
            '/ton/withdrawals': get('Мои выводы TON', 'Последние 30 заявок: status (queued, processing, done, cancelled), суммы, адрес и ссылка tx_url на tonscan, когда TON дошёл.'),
            '/ton/withdrawals/{withdrawal_id}': get('Статус вывода TON', 'Одна заявка. Опрашивайте раз в 10–30 секунд, пока status не станет done.', [{'name': 'withdrawal_id', 'in': 'path', 'required': True, 'schema': {'type': 'string'}}]),
            '/ton/withdraw': post('Вывести GRAM в TON', 'Списывает GRAM с баланса и отправляет TON на подключённый кошелёк. Сумма в GRAM с точностью до 0,01. Лимиты и суточный лимит те же, что в приложении.',
                                  {'type': 'object', 'required': ['gram'], 'properties': {'gram': money}}, {'type': 'object'}),
            '/transfer': post('Передать подарок', 'Бесплатно передаёт подарок игроку Crafter по Telegram ID. Получатель должен хотя бы раз открыть Crafter.',
                              {'type': 'object', 'required': ['gift_id', 'telegram_id'], 'properties': {'gift_id': {'type': 'string'}, 'telegram_id': {'type': 'string', 'example': '123456789'}}}, {'type': 'object'}),
        },
    }
