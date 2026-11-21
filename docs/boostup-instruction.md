# Crafter × BoostUp: пополнение подарками

Инструкция для разработчиков BoostUp. Всё, что нужно, чтобы принимать подарки игроков из Crafter и добавлять их в инвентарь BoostUp.

- Адрес Crafter: `https://craftertg.site`
- API пополнения: `https://craftertg.site/api/boostup/v1`
- Обычный Partner API Crafter: `https://craftertg.site/api/partner/v1` (описание: `https://craftertg.site/partner-api`)
- Эта инструкция в браузере: `https://craftertg.site/boostup-api`
- Поддержка: https://t.me/crafter_support

---

## 1. Суть

Игрок отправляет подарок на релейер Crafter. Бот Crafter спрашивает, куда его отправить. Если игрок выбирает **BoostUp** и подтверждает передачу, **этот же подарок сразу передаётся в инвентарь аккаунта BoostUp внутри Crafter** (аккаунт `@boostup_relayer`). Crafter присылает BoostUp подписанный webhook `deposit.delivered`, и BoostUp добавляет этот NFT в инвентарь игрока.

**На баланс ничего не зачисляется.** BoostUp получает сам подарок. Цена (в TON и GRAM, по флору коллекции) приходит только для информации; игрок видит её в окне подтверждения в GRAM.

### Путь игрока

1. Игрок отправляет подарок на релейер Crafter. Он должен хотя бы раз открыть приложение Crafter: так Crafter узнаёт, чей это подарок.
2. Бот пишет: «Подарок получен. **Куда отправить подарок?**» Кнопки: **«В маркет»** (подарок остаётся в инвентаре Crafter) и **«В BoostUp»**.
3. «В BoostUp» → бот просит подтвердить и даёт кнопку, которая открывает окно Crafter.
4. В окне: большая анимация подарка, название, цена в GRAM. Кнопка **«Подтвердить»** открывает второе окно **«Точно передать подарок в BoostUp?»** с кнопками «Да, передать» и «Назад».
5. После «Да, передать» в одной операции подарок исчезает из инвентаря игрока и появляется в инвентаре аккаунта BoostUp в Crafter. Через Telegram ничего не отправляется: передача мгновенная, без комиссии и без ожидания.
6. Crafter отправляет webhook `deposit.delivered` → BoostUp зачисляет NFT и отвечает `{"ok": true}`.
7. Игроку приходит сообщение бота: «Подарок в инвентаре BoostUp».

Игрок определяется по Telegram ID. Поле `telegram_id` в webhook совпадает с Telegram ID игрока в BoostUp.

---

## 2. Два ключа

| Ключ | Кто получает | Для чего |
|---|---|---|
| **1. Ключ Partner API** `CRT/…` | Все, через бота командой `/api`. У аккаунта BoostUp тоже есть такой. | Обычная работа с аккаунтом Crafter через API: посмотреть полученный подарок, продать, передать, вывести в Telegram. |
| **2. Личный ключ BoostUp** `BUP/…` | Только BoostUp, лично от Crafter. | Подключение именно пополнения: список пополнений, подтверждение зачисления. Только для сервера BoostUp. |

**Ключи нельзя показывать.** Храните их на сервере в переменных окружения, не в репозитории, логах и клиентском коде. Запросы с заголовком `Origin` (из браузера) отклоняются. Если ключ мог утечь, попросите Crafter заменить его: старый перестанет работать сразу. Ключ `BUP/…` не открывает Partner API, а ключ `CRT/…` не открывает API пополнения.

---

## 3. Что нужно настроить

| Что | Кто даёт | Зачем |
|---|---|---|
| **Личный ключ** `BUP/…` | Crafter | API пополнения: проверка и подтверждение зачисления. |
| **Секрет подписи** | Crafter | Проверка, что webhook прислал именно Crafter (HMAC-SHA256). |
| **Аккаунт BoostUp в Crafter** (`@boostup_relayer`) | BoostUp | Crafter-аккаунт, в инвентарь которого передаются подарки. Он должен хотя бы раз открыть Crafter и получить обычный ключ `CRT/…` командой `/api` у бота. |
| **Адрес webhook** (https) | BoostUp | Куда Crafter присылает `deposit.delivered`. Только публичные https-адреса. |

Ключ, секрет, адрес webhook и аккаунт вносит администратор Crafter в админ-панели (раздел «BoostUp»).

---

## 4. Webhook `deposit.delivered`

Crafter отправляет его, когда подарок уже **в инвентаре аккаунта BoostUp**. Это единственное событие, по которому нужно зачислять подарок.

`POST <ваш адрес webhook>`

| Заголовок | Значение |
|---|---|
| `X-Crafter-Event` | `deposit.delivered` (при проверке из админки: `ping`) |
| `X-Crafter-Timestamp` | Время отправки, секунды Unix (UTC) |
| `X-Crafter-Signature` | `sha256=` и HMAC-SHA256 от `timestamp + "." + тело` |
| `Content-Type` | `application/json` |

Тело:

```json
{
  "event": "deposit.delivered",
  "deposit_id": "bu_3f9c1a7b2d4e5f60a1b2c3d4",
  "telegram_id": "123456789",
  "username": "anna_dev",
  "name": "Anna",
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

Поля:

- `deposit_id` — уникальный номер пополнения. По нему зачисление должно быть идемпотентным.
- `telegram_id`, `username`, `name` — игрок. `username` и `name` могут быть пустыми.
- `gift.gift_id` — номер подарка в инвентаре аккаунта BoostUp. По нему подарок находится через Partner API (`GET /gifts/{gift_id}`).
- `gift.slug` и `gift.url` — идентификатор NFT в Telegram.
- `value` — цена для информации. Игрок видит её в GRAM.
- `account` — аккаунт BoostUp в Crafter, в инвентаре которого лежит подарок.
- `created`, `confirmed`, `delivered` — время, секунды Unix: предложение, подтверждение игроком, передача в инвентарь BoostUp.

### Что отвечать

| Ответ BoostUp | Что делает Crafter |
|---|---|
| HTTP 2xx и `{"ok": true}` | Считает подарок зачисленным и пишет игроку «подарок в инвентаре BoostUp». Можно добавить `"external_id"` (ваш номер операции). |
| Любой другой ответ, таймаут, ошибка сети | Повторяет webhook: через 10 сек, 30 сек, 2 мин, 10 мин, 30 мин, затем каждый час, пока не получит ответ. |

Правила:

- **Зачисляйте идемпотентно.** Один и тот же `deposit_id` может прийти несколько раз. Если он уже зачислен, не зачисляйте второй раз и ответьте `{"ok": true}`.
- Проверяйте подпись **до** любых действий, по исходным байтам тела (не по пересобранному JSON).
- Отклоняйте запросы со старым `X-Crafter-Timestamp` (старше 5 минут).
- Отвечайте за 8 секунд: дольше Crafter не ждёт и повторит запрос.

---

## 5. Проверка подписи

Python:

```python
import hashlib, hmac, time

SECRET = "секрет_подписи"

def verify(raw_body: bytes, headers) -> bool:
    stamp = headers.get("X-Crafter-Timestamp", "")
    if not stamp.isdigit() or abs(time.time() - int(stamp)) > 300:
        return False
    expected = hmac.new(SECRET.encode(), stamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + expected, headers.get("X-Crafter-Signature", ""))
```

Node.js (Express, тело как Buffer: `express.raw({type: "application/json"})`):

```js
const crypto = require("crypto");

function verify(raw, headers) {
  const stamp = headers["x-crafter-timestamp"] || "";
  if (!/^\d+$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > 300) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", process.env.CRAFTER_SECRET)
    .update(Buffer.concat([Buffer.from(stamp + "."), raw])).digest("hex");
  const given = headers["x-crafter-signature"] || "";
  return given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

Пример обработчика (Python, Flask):

```python
@app.post("/crafter/webhook")
def crafter_webhook():
    raw = request.get_data()
    if not verify(raw, request.headers):
        return {"ok": False}, 401
    event = request.get_json()
    if event["event"] == "ping":
        return {"ok": True}
    if event["event"] == "deposit.delivered":
        if not already_credited(event["deposit_id"]):                     # идемпотентность
            add_gift_to_inventory(event["telegram_id"], event["gift"])    # ваш код
            mark_credited(event["deposit_id"])
        return {"ok": True}
    return {"ok": True}
```

---

## 6. API пополнения

Авторизация: `Authorization: Bearer BUP/ваш_ключ`. Только с сервера, не из браузера. Лимит: **60 запросов за 10 секунд**, при превышении `429` и заголовок `Retry-After`. Ответы всегда JSON. Ошибка: `{"ok": false, "error": "текст", "code": "код"}`.

| Запрос | Что делает |
|---|---|
| `GET /ping` | Проверка ключа: включена ли интеграция, задан ли webhook, аккаунт BoostUp в Crafter. |
| `GET /deposits` | Список пополнений, новые первыми. Параметры: `status`, `limit` (1–100, по умолчанию 50), `after` (время создания, секунды). |
| `GET /deposits/{deposit_id}` | Одно пополнение: игрок, подарок, цена, статус. |
| `POST /deposits/{deposit_id}/ack` | Подтвердить зачисление: `{"external_id": "ваш_номер"}` (необязательно). Повтор безопасен. |

Пример:

```bash
curl "https://craftertg.site/api/boostup/v1/deposits?status=delivered" \
  -H "Authorization: Bearer BUP/ваш_ключ"
```

```json
{
  "ok": true,
  "deposits": [{
    "deposit_id": "bu_3f9c1a7b2d4e5f60a1b2c3d4",
    "status": "delivered",
    "status_text": "Подарок передан BoostUp, ждём зачисления",
    "telegram_id": "123456789", "username": "anna_dev", "name": "Anna",
    "gift": { "gift_id": "telegram-plushpepe-4102", "name": "Plush Pepe", "number": 4102, "slug": "PlushPepe-4102", "url": "https://t.me/nft/PlushPepe-4102" },
    "value": { "ton": "7094.99", "gram": "41760.05" },
    "account": { "telegram_id": "777000111", "username": "boostup_relayer", "name": "BoostUp" },
    "created": 1790000000, "confirmed": 1790000060, "delivered": 1790000060, "credited": null,
    "attempts": 2, "note": null
  }]
}
```

**Если webhook не доходит.** Раз в несколько минут запрашивайте `GET /deposits?status=delivered`, зачисляйте найденное (идемпотентно по `deposit_id`) и вызывайте `/ack`. Подарок при этом уже лежит в инвентаре аккаунта BoostUp.

---

## 7. Работа с подарком после зачисления

Подарок лежит в обычном инвентаре аккаунта BoostUp в Crafter. Дальше с ним работают обычным ключом Partner API (`Authorization: Bearer CRT/…`, адрес `https://craftertg.site/api/partner/v1`):

| Задача | Запрос |
|---|---|
| Найти подарок | `GET /inventory` или `GET /gifts/{gift_id}`, где `gift_id` из webhook |
| Вывести в Telegram | `POST /withdraw` (комиссия вывода 0,4 GRAM с баланса аккаунта) |
| Передать игроку Crafter | `POST /transfer`, в том числе с `"pay_withdraw_fee": true` |
| Выставить на продажу | `POST /sell` |

Все запросы записи требуют `Idempotency-Key`. Подробности и примеры: `https://craftertg.site/partner-api`.

---

## 8. Статусы пополнения

| `status` | Что значит | Что делать BoostUp |
|---|---|---|
| `delivered` | Подарок уже в инвентаре аккаунта BoostUp. Webhook отправляется. | **Зачислить NFT игроку.** |
| `credited` | BoostUp подтвердил зачисление. | Конец. |
| `returned` | Администратор Crafter вернул подарок игроку (BoostUp не зачислил его). | Ничего не зачислять. |

Пополнения, которые игрок ещё не подтвердил (бот спросил, игрок не ответил), в API не видны.

---

## 9. Ошибки

| HTTP / `code` | Причина |
|---|---|
| 401 `unauthorized` | Ключ не передан, не подходит или заменён. |
| 403 `browser_forbidden` | Запрос с заголовком `Origin`: API работает только с серверов. |
| 403 `disabled` | Интеграция отключена администратором Crafter. |
| 404 `deposit_not_found` | Такого пополнения нет, либо игрок его ещё не подтвердил. |
| 409 `not_delivered` | Это пополнение нельзя подтвердить (например, оно возвращено игроку). |
| 429 `rate_limited` | Слишком много запросов. Ждите `Retry-After` (10 секунд). |

- **Если зачислить подарок нельзя,** ответьте не `ok` и свяжитесь с поддержкой Crafter: администратор вернёт подарок игроку, пока вы его не выставили и не вывели.
- Не выставляйте и не выводите подарок, пока не зачислили его игроку.

---

## 10. Проверка до запуска

1. **Ключ.** `GET /api/boostup/v1/ping` возвращает `"ok": true` и аккаунт BoostUp.
2. **Webhook.** Администратор Crafter нажимает «Отправить тестовый webhook» в разделе «BoostUp». К вам приходит событие `ping`: проверьте подпись и ответьте 2xx.
3. **Настоящее пополнение.** Отправьте недорогой подарок на релейер Crafter с аккаунта, у которого есть и Crafter, и BoostUp. Пройдите кнопки бота и оба окна подтверждения. Убедитесь, что подарок появился в инвентаре аккаунта BoostUp (`GET /inventory` с ключом `CRT/…`) и NFT добавлен игроку в BoostUp.
4. **Повтор.** Проверьте, что повторный `deposit_id` не зачисляется второй раз.

## 11. Чек-лист перед запуском

- [ ] Подпись webhook проверяется, старые запросы отклоняются.
- [ ] Зачисление идемпотентно по `deposit_id`.
- [ ] Адрес webhook отвечает быстрее 8 секунд.
- [ ] Раз в несколько минут BoostUp сверяет `GET /deposits?status=delivered`.
- [ ] Оба ключа и секрет лежат только на сервере.
- [ ] Аккаунт BoostUp в Crafter открывал приложение и имеет ключ `CRT/…`.
