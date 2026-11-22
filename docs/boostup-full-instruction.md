# Crafter × BoostUp: полная инструкция

Для разработчиков BoostUp. Один документ: ключи, каталог подарков, покупка, вывод подарка игроку (два способа), пополнение подарками (webhook), ошибки и разбор типичных проблем.

- Адрес Crafter: `https://craftertg.site`
- Partner API: `https://craftertg.site/api/partner/v1` (ключ `CRT/…`)
- API пополнения: `https://craftertg.site/api/boostup/v1` (ключ `BUP/…`)
- Эти же инструкции в браузере: `https://craftertg.site/partner-api` и `https://craftertg.site/boostup-api`
- Поддержка: https://t.me/crafter_support

---

## Часть 1. Ключи и общие правила

| Ключ | Для чего |
|---|---|
| `CRT/…` (Partner API) | Каталог, покупка, вывод, передача, баланс, инвентарь аккаунта BoostUp в Crafter. |
| `BUP/…` (личный ключ BoostUp) | Только пополнение: список пополнений и подтверждение зачисления. |

Правила для обоих:

- Только с сервера, заголовок `Authorization: Bearer <ключ>`. Запросы с заголовком `Origin` (из браузера) отклоняются.
- Ответы всегда JSON. Ошибка: `{"ok": false, "error": "текст", "code": "код"}`.
- Лимит Partner API: **30 запросов за 10 секунд** на ключ (API пополнения: 60). При превышении `429` и заголовок `Retry-After`.
- Деньги: цены в **GRAM** строкой (`"12.5"`) и в нано-единицах строкой (`price_nano`). Не используйте числа с плавающей точкой.
- Каждый запрос записи (`POST`) требует заголовок `Idempotency-Key` (16–80 символов: латиница, цифры, `_`, `-`). Тот же ключ с тем же телом возвращает сохранённый результат и не выполняет действие второй раз.

---

## Часть 2. Каталог: как правильно загружать и обновлять

### 2.1. Откуда берутся подарки

| `source` | Что это | Поле `market` |
|---|---|---|
| `crafter` | Лоты игроков Crafter: подарки, которые игроки выставили на маркет Crafter. Они лежат на релейере Crafter. | `Crafter` |
| `market` | Лоты подключённого маркета (Thermos, за ним Portals/Tonnel/MRKT). | `Thermos`, биржа в поле `marketplace` |

В каталоге **только то, что продаётся сейчас**. Проданные, снятые и перепроданные лоты просто исчезают из выдачи.

### 2.2. Как загружать весь каталог

Все коллекции одним запросом (по 500 лотов на страницу):

```
GET /lots?source=crafter&limit=500&page=1        (лоты игроков Crafter)
GET /lots?source=market&market=thermos&limit=500&page=1   (лоты маркета)
```

Листайте `page`, пока `has_more` равен `true`. В каждом ответе есть `as_of` — время, на которое собраны данные (секунды Unix).

Для одной коллекции: `GET /lots?collection=<id или название>&limit=50`. Список коллекций: `GET /collections`. Лоты игроков показываются и в тех коллекциях, которых нет в каталоге маркета.

### 2.3. Главное правило: каталог заменяется целиком

Не накапливайте лоты. После **полного** обхода (все страницы прочитаны, `has_more` стал `false`) **замените** свой каталог результатом обхода: всё, чего в нём нет, удалите. Иначе у вас останутся «старые» подарки, которых уже нет в продаже.

Обход считайте полным только если прочитаны все страницы и ни один запрос не вернул ошибку. Если обход прервался (ошибка, `429`), старый каталог оставьте как есть и повторите позже.

### 2.4. Как часто обновлять

| Источник | Как часто |
|---|---|
| `crafter` | раз в 30–60 секунд |
| `market` | раз в 60–120 секунд |

Полный обход занимает считанные запросы (лимит 500 лотов на страницу), 30 запросов за 10 секунд вам хватит с запасом. Данные маркета обновляются на стороне Crafter в фоне примерно раз в 2 минуты; лот, купленный в другом месте, исчезает из каталога в течение 3 минут. Чаще опрашивать каталог бессмысленно и приведёт к `429`.

### 2.5. Проверка одного лота: перед показом и перед покупкой

Каталог может отставать на минуты. Поэтому **перед показом лота игроку и перед покупкой** проверяйте его:

```
GET /lots/<lot_id>
```

```json
{ "ok": true, "lot_id": "crafter-9f2c…", "available": false, "reason": "sold_or_unlisted", "live": true, "checked": 1795000000, "lot": null }
```

`available: true` — лот в продаже, в `lot` актуальные данные и цена. Если `false`, в `reason` причина:

| `reason` | Что значит |
|---|---|
| `sold_or_unlisted` | Лот продан или снят с продажи. |
| `not_listed` | Подарок уже не выставлен. |
| `own_lot` | Это лот самого BoostUp. |
| `not_on_relayer` | Подарка уже нет на релейере Crafter, лот недоступен. |
| `not_deliverable` | Подарок нельзя доставить. |
| `not_in_market` | Лота нет на маркете. |
| `sold_or_price_changed` | Лот куплен или изменил цену на маркете. |

`live: true` — проверка сделана прямо сейчас (для лотов маркета — запросом к самому маркету). `live: false` с полем `note` — маркет сейчас не отвечает (лимит запросов), ответ из кэша; покупка всё равно проверит лот на маркете.

### 2.6. Цена

- `price` — в GRAM. У лотов маркета она пересчитана из TON по курсу Crafter, поэтому может немного меняться. В `max_price` при покупке закладывайте запас (например, +3%).
- Лоты, цена которых заметно ниже настоящего флора коллекции (ошибка данных, такие нельзя купить), Crafter скрывает сам.

---

## Часть 3. Покупка лота

```
POST /buy
Idempotency-Key: <уникальный>
{"lot_id": "<lot_id из каталога>", "max_price": "<цена с запасом>"}
```

Возможные ответы:

| HTTP / `status` | Что значит | Что делать |
|---|---|---|
| 200 `done` | Куплено. В `result.gift.gift_id` номер подарка, он уже в инвентаре BoostUp. | Дальше выводите подарок (часть 4). |
| 202 `processing` | Покупка идёт дольше 20 секунд (маркет отвечает не сразу). | **Не повторяйте запрос.** Опрашивайте `GET /operations/<тот же Idempotency-Key>` раз в 2–3 секунды, пока `status` не станет `done` или `failed` (обычно до минуты). |
| 409 `failed`, код `price_changed` | Лот перепродан или изменил цену. Ничего не куплено, деньги не списаны. | Возьмите другой лот; повторяйте с **новым** ключом. |
| 409 `failed`, код `lot_not_found` / `insufficient_balance` / `market_unavailable` / `rejected` | Отказ, ничего не произошло. | Исправьте причину; повторяйте с **новым** ключом. |
| 503 `review` | Итог неизвестен. | **Новую покупку не создавайте.** Опрашивайте `GET /operations/<тот же ключ>`; через 10 минут без итога пишите в поддержку. |

Сверка потерянных ответов: `GET /operations?status=processing` покажет операции, которые ещё идут, `GET /operations` — последние 100 операций ключа. Операция, которая зависла из-за перезапуска сервера, сама получает окончательный статус через ~2,5 минуты: `done` (если покупка прошла), `failed` (если деньги возвращены) или `review`.

---

## Часть 4. Вывод подарка игроку (два способа)

Подарок для вывода должен лежать в инвентаре BoostUp (`GET /inventory`). Если его нет, сначала купите (часть 3).

| | Способ A: на Telegram игрока | Способ B: в инвентарь игрока в Crafter |
|---|---|---|
| Что получает игрок | Настоящий подарок в Telegram. | Подарок в приложении Crafter. |
| Запрос | `POST /withdraw` | `POST /transfer` |
| Нужен ли игроку Crafter | Нет, но если его нет в Crafter, укажите `username`. | Да: игрок открывал Crafter и у него есть @username. |
| Комиссия | 0,4 GRAM с баланса BoostUp. | Бесплатно. |
| Скорость | Минуты. | Мгновенно. |

### Способ A: на Telegram игрока

```
POST /withdraw
Idempotency-Key: <уникальный>
{"gift_id": "<gift_id>", "telegram_id": "123456789", "username": "player_name"}
```

- `telegram_id` — Telegram ID игрока (строкой). Без него подарок уйдёт на Telegram самого аккаунта BoostUp.
- `username` — обязателен, если игрока нет в Crafter (иначе Telegram не найдёт аккаунт): латиница, цифры и `_`, 5–32 символа, можно с `@`. Ошибка без имени: `400 username_required`.
- Ответ: `status: "queued"`, `withdrawal_id`. С баланса списывается `0.4` GRAM, подарок уходит из инвентаря BoostUp.
- Итог: `GET /withdrawals`. `queued` → `confirmed` (у игрока) или `failed` (подарок вернулся в инвентарь BoostUp, комиссия возвращена, причина в `reason`).
- Некоторые подарки Telegram нельзя передавать до даты блокировки: вывод ждёт в `queued`, пока Telegram не разрешит.

Вариант A2 (игрок есть в Crafter и у него есть @username): `POST /transfer` с `"pay_withdraw_fee": true`. Подарок сначала приходит игроку, затем сразу выводится ему в Telegram; если вывод не удался, подарок остаётся у игрока в Crafter.

### Способ B: в инвентарь игрока в Crafter

```
POST /transfer
Idempotency-Key: <уникальный>
{"gift_id": "<gift_id>", "telegram_id": "123456789"}
```

Ошибки: `recipient_not_found` (игрок ни разу не открывал Crafter), `recipient_no_username` (нет @username).

### Рекомендуемая последовательность

```python
def give_gift(player, item):
    gift_id = item.gift_id
    if not gift_id:                                    # подарка нет у BoostUp: проверить лот и купить
        check = get(f"/lots/{item.lot_id}")
        if not check.available:
            return refresh_catalog_and_choose_another()
        op = new_key()
        r = wait(post("/buy", op, {"lot_id": item.lot_id, "max_price": item.price_with_margin}), op)
        if r.status != "done":
            return handle(r)                           # failed: другой лот; review: опрашивать
        gift_id = r.result["gift"]["gift_id"]
    op = new_key()
    if player_is_in_crafter:                           # способ B
        r = post("/transfer", op, {"gift_id": gift_id, "telegram_id": player.telegram_id})
    else:                                              # способ A
        r = post("/withdraw", op, {"gift_id": gift_id, "telegram_id": player.telegram_id, "username": player.username})
    return wait(r, op)

def wait(r, op, limit=90):
    started = time.time()
    while r.status == "processing" and time.time() - started < limit:
        time.sleep(2.5)
        r = get(f"/operations/{op}")
    return r
```

**Состояние «Выдаём подарок» в вашем интерфейсе должно заканчиваться только на `done`, `failed` или `review`.** Пока ответ `processing`, продолжайте опрос (с ограничением по времени). Не показывайте «Выдаём подарок» до того, как отправили запрос в Crafter.

---

## Часть 5. Пополнение: игрок отправляет подарок в BoostUp

Игрок отправляет подарок на релейер Crafter. Бот Crafter спрашивает «Куда отправить подарок?» с кнопками «В маркет» и «В BoostUp». При выборе BoostUp и подтверждении в окне Crafter (два подтверждения) подарок **сразу передаётся в инвентарь аккаунта BoostUp в Crafter**. Затем Crafter присылает BoostUp подписанный webhook `deposit.delivered`; BoostUp добавляет этот NFT игроку у себя и отвечает `{"ok": true}`. На баланс ничего не зачисляется.

Игрок определяется по Telegram ID: `telegram_id` в webhook совпадает с Telegram ID игрока в BoostUp.

### Что нужно настроить

| Что | Кто даёт |
|---|---|
| Личный ключ `BUP/…` | Crafter |
| Секрет подписи webhook | Crafter |
| Адрес webhook (https) | BoostUp |
| Аккаунт BoostUp в Crafter (должен хотя бы раз открыть Crafter) | BoostUp |

### Webhook `deposit.delivered`

`POST <ваш адрес webhook>`, заголовки: `X-Crafter-Event`, `X-Crafter-Timestamp` (секунды Unix), `X-Crafter-Signature` = `sha256=` + HMAC-SHA256 от `timestamp + "." + тело` (секрет подписи), `Content-Type: application/json`.

```json
{
  "event": "deposit.delivered",
  "deposit_id": "bu_3f9c1a7b2d4e5f60a1b2c3d4",
  "telegram_id": "123456789", "username": "anna_dev", "name": "Anna",
  "gift": {
    "gift_id": "telegram-plushpepe-4102",
    "name": "Plush Pepe", "number": 4102, "collection": "Plush Pepe",
    "model": "Vice City", "backdrop": "Black", "symbol": "Star",
    "slug": "PlushPepe-4102", "url": "https://t.me/nft/PlushPepe-4102",
    "image": "https://nft.fragment.com/gift/plushpepe-4102.webp"
  },
  "value": { "ton": "7094.99", "gram": "41760.05", "floor_ton": "7094.99", "percent": "100", "rate_gram_per_ton": "5.886" },
  "account": { "telegram_id": "777000111", "username": "boostup_relayer", "name": "BoostUp" },
  "created": 1790000000, "confirmed": 1790000060, "delivered": 1790000060
}
```

- `gift.gift_id` — номер подарка в инвентаре аккаунта BoostUp (`GET /gifts/{gift_id}` с ключом `CRT/…`). `value` — цена для информации.
- Ответ BoostUp: HTTP 2xx и `{"ok": true}` (можно добавить `"external_id"`). Иначе Crafter повторяет webhook: 10 сек, 30 сек, 2 мин, 10 мин, 30 мин, затем каждый час.
- **Зачисляйте идемпотентно по `deposit_id`**: он может прийти несколько раз.
- Проверяйте подпись по исходным байтам тела и отклоняйте запросы со старым `X-Crafter-Timestamp` (старше 5 минут). Отвечайте за 8 секунд.

Проверка подписи (Python):

```python
import hashlib, hmac, time

def verify(raw_body: bytes, headers, secret: str) -> bool:
    stamp = headers.get("X-Crafter-Timestamp", "")
    if not stamp.isdigit() or abs(time.time() - int(stamp)) > 300:
        return False
    expected = hmac.new(secret.encode(), stamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + expected, headers.get("X-Crafter-Signature", ""))
```

### API пополнения (ключ `BUP/…`)

| Запрос | Что делает |
|---|---|
| `GET /ping` | Проверка ключа: включена ли интеграция, задан ли webhook, аккаунт BoostUp. |
| `GET /deposits?status=delivered` | Список пополнений (параметры `status`, `limit` до 100, `after`). |
| `GET /deposits/{deposit_id}` | Одно пополнение. |
| `POST /deposits/{deposit_id}/ack` | Подтвердить зачисление (`{"external_id": "…"}` необязательно). Повтор безопасен. |

Статусы: `delivered` (подарок уже у BoostUp, нужно зачислить), `credited` (зачислено), `returned` (Crafter вернул подарок игроку, не зачислять). Если webhook не доходит, раз в несколько минут запрашивайте `GET /deposits?status=delivered`, зачисляйте найденное и вызывайте `/ack`.

---

## Часть 6. Ошибки и статусы

Статусы операций Partner API (поле `status`):

| `status` (HTTP) | Значит | Что делать |
|---|---|---|
| `done` (200) | Выполнено. | Идти дальше. |
| `processing` (202) | Выполняется. | Опрашивать `GET /operations/<ключ>`; новую операцию не создавать. |
| `failed` (4xx) | Отклонено, ничего не произошло. | Исправить запрос / взять другой лот; повторять с **новым** ключом. |
| `review` (503) | Итог неизвестен. | Не повторять с новым ключом; опрашивать `GET /operations/<тот же ключ>`; через 10 минут писать в поддержку. |

Частые коды:

| `code` | Причина |
|---|---|
| `unauthorized` / `browser_forbidden` | Нет или неверный ключ / запрос с заголовком `Origin`. |
| `idempotency_required` | В POST нет корректного `Idempotency-Key`. |
| `conflict` | Тот же `Idempotency-Key` с другим телом. |
| `price_changed` | Цена выше `max_price`, либо лот перепродан или изменил цену. |
| `lot_not_found` | Лот уже продан или снят. |
| `insufficient_balance` | Не хватает GRAM (в том числе на комиссию вывода). |
| `gift_not_found` | Подарка нет среди ваших. |
| `recipient_not_found` / `recipient_no_username` | Игрок не открывал Crafter / нет @username (для `/transfer`). |
| `username_required` | Для `/withdraw` не-пользователю Crafter не указан `username`. |
| `rate_limited` (429) | Слишком много запросов: ждите `Retry-After`. |

---

## Часть 7. Типичные проблемы и что делать

**«Выдаём подарок» никогда не заканчивается.** Ваш интерфейс должен опрашивать `GET /operations/<ключ>` при `202 processing` и завершаться на `done`/`failed`/`review`. Сверьте зависшие операции: `GET /operations?status=processing`. Не создавайте вторую операцию на тот же подарок, пока первая не стала `failed`.

**В каталоге есть старые подарки, которых нет в продаже.** Каталог нужно заменять целиком после полного обхода (часть 2.3), а перед показом и покупкой проверять лот через `GET /lots/<lot_id>` (часть 2.5).

**Подарков, которые в продаже, в каталоге нет.** Читайте все страницы (`has_more`), `source=crafter` и `source=market` отдельными обходами, `limit=500`. Лоты игроков Crafter показываются и для коллекций вне каталога маркета. Данные маркета обновляются раз в ~2 минуты.

**Покупка вернула `price_changed`.** Это нормально: лот успели купить или он подорожал. Возьмите другой лот и повторите с новым ключом. В `max_price` закладывайте запас.

**`429` (много запросов).** Лимит 30 запросов за 10 секунд на ключ. Опрашивайте операции не чаще раза в 2 секунды, каталог не чаще раза в 30 секунд. Ждите `Retry-After`.

**Вывод `/withdraw` стоит в `queued`.** Вывод в Telegram занимает минуты, а подарок с блокировкой Telegram ждёт её конца. Следите за `GET /withdrawals`. Если `failed`, подарок вернулся в инвентарь BoostUp, комиссия возвращена.

---

## Часть 8. Чек-лист перед запуском

- [ ] Каталог заменяется целиком после полного обхода, интервалы 30–120 секунд.
- [ ] Перед показом и перед покупкой лот проверяется через `GET /lots/<lot_id>`.
- [ ] `max_price` с запасом; `price_changed` обрабатывается выбором другого лота.
- [ ] При `202 processing` идёт опрос `GET /operations/<ключ>`; интерфейс завершается на `done`/`failed`/`review`.
- [ ] Для каждой операции генерируется уникальный `Idempotency-Key` и сохраняется до отправки; при обрыве запрос повторяется с тем же ключом.
- [ ] Вывод: способ A передаёт `telegram_id` и `username`; способ B только игрокам, которые есть в Crafter с @username.
- [ ] Webhook пополнения: проверка подписи, идемпотентность по `deposit_id`, ответ быстрее 8 секунд, сверка `GET /deposits?status=delivered` раз в несколько минут.
- [ ] Ключи и секрет хранятся только на сервере.
