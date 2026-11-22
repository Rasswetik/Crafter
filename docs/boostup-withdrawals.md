# Crafter × BoostUp: вывод подарков игрокам

Инструкция для разработчиков BoostUp. Как выдать подарок игроку двумя способами и как правильно читать ответы Crafter, чтобы вывод не «зависал».

- API: `https://craftertg.site/api/partner/v1` (ключ `CRT/…` аккаунта BoostUp в Crafter)
- Полное описание Partner API: `https://craftertg.site/partner-api`
- Пополнение подарками (webhook): `https://craftertg.site/boostup-api`
- Поддержка: https://t.me/crafter_support

---

## 1. Два способа вывода

| | Способ A: на Telegram игрока | Способ B: в инвентарь игрока в Crafter |
|---|---|---|
| Что получает игрок | Настоящий подарок в Telegram. | Подарок в приложении Crafter (в «Мои подарки»). |
| Запрос | `POST /withdraw` | `POST /transfer` |
| Нужен ли игроку Crafter | Нет. Но если его нет в Crafter, укажите `username`. | Да: игрок хотя бы раз открыл Crafter и у него есть @username. |
| Комиссия | 0,4 GRAM с баланса аккаунта BoostUp. | Бесплатно. |
| Скорость | Минуты (релейер отправляет подарок в Telegram). | Мгновенно. |

### Способ A: на Telegram игрока

```
POST /withdraw
Idempotency-Key: <уникальный, 16–80 символов>
{"gift_id": "<gift_id подарка в инвентаре BoostUp>", "telegram_id": "123456789", "username": "player_name"}
```

- `telegram_id` — Telegram ID игрока (число, строкой).
- `username` — обязателен, если игрока нет в Crafter (иначе Telegram не найдёт аккаунт): латиница, цифры и `_`, от 5 до 32 символов, можно с `@`. Если игрок есть в Crafter, имя берётся оттуда.
- Без `telegram_id` подарок уйдёт на Telegram самого аккаунта BoostUp.
- Ответ: `status: "queued"`, `withdrawal_id`. С баланса списывается `0.4` GRAM, подарок уходит из инвентаря BoostUp.
- Итог: `GET /withdrawals`. `queued` → `confirmed` (подарок у игрока) или `failed` (подарок вернулся в инвентарь BoostUp, комиссия возвращена, причина в `reason`).

Вариант A2 (если игрок есть в Crafter и у него есть @username): `POST /transfer` с `"pay_withdraw_fee": true`. Подарок сначала приходит к игроку, затем сразу выводится ему в Telegram; если вывод не удался, подарок остаётся у игрока в Crafter.

### Способ B: в инвентарь игрока в Crafter

```
POST /transfer
Idempotency-Key: <уникальный>
{"gift_id": "<gift_id>", "telegram_id": "123456789"}
```

Ошибки: `recipient_not_found` (игрок ни разу не открывал Crafter), `recipient_no_username` (у игрока нет @username).

---

## 2. Если подарка в инвентаре BoostUp нет: сначала купите его

Подарки из каталога (`GET /lots`) принадлежат маркету, а не BoostUp. Чтобы выдать такой подарок, его сначала покупают, и только потом выводят.

1. `GET /lots?collection=<id>&source=market` (или без `collection` для всех коллекций) → выберите лот, возьмите `lot_id` и `price`.
2. `POST /buy` с `Idempotency-Key` и телом `{"lot_id": "…", "max_price": "<цена с запасом>"}`.
3. Ответ:
   - **200 `done`** — куплено. В `result.gift.gift_id` номер подарка, он уже в инвентаре BoostUp. Переходите к выводу (способ A или B).
   - **202 `processing`** — покупка идёт дольше 20 секунд. **Не повторяйте запрос.** Спрашивайте `GET /operations/<Idempotency-Key>` каждые 2–3 секунды, пока `status` не станет `done` или `failed` (обычно до минуты).
   - **409 `failed`** — ничего не куплено, деньги не списаны: `price_changed` (лот перепродан или изменил цену: возьмите другой лот), `lot_not_found`, `insufficient_balance`, `market_unavailable` и др. Повторяйте с **новым** `Idempotency-Key` и другим лотом.
   - **503 `review`** — результат неизвестен. **Новую покупку не создавайте.** Спросите `GET /operations/<тот же ключ>`; если через 10 минут итога нет, пишите в поддержку.

Лот, купленный где-то ещё, пропадает из каталога примерно за минуту. Если вы успели его выбрать, покупка вернёт `409 price_changed` — это нормальный сценарий, возьмите другой лот.

---

## 3. Как читать ответы (чтобы вывод не «зависал»)

Каждый POST возвращает один из статусов в поле `status`:

| `status` (HTTP) | Значит | Что делать |
|---|---|---|
| `done` (200) | Выполнено. | Идти дальше. |
| `processing` (202) | Выполняется. | **Опрашивать** `GET /operations/<Idempotency-Key>`, пока не `done`/`failed`. Не создавать новую операцию. |
| `failed` (4xx) | Отклонено, ничего не произошло. | Исправить запрос или взять другой лот; повторять с **новым** ключом. |
| `review` (503) | Результат неизвестен. | Не повторять с новым ключом. Опрашивать `GET /operations/<тот же ключ>`; при отсутствии итога 10 минут писать в поддержку. |

Правила:

- Один и тот же `Idempotency-Key` с тем же телом всегда возвращает сохранённый результат и ничего не делает второй раз. Поэтому после обрыва связи повторите запрос с тем же ключом или спросите `/operations/<ключ>`.
- Лимит: **30 запросов за 10 секунд** на ключ. При `429` ждите `Retry-After` (10 секунд). Опрашивайте не чаще раза в 2 секунды.
- Состояние «Выдаём подарок» в вашем интерфейсе должно заканчиваться только на `done`, `failed` или `review` (а `processing` продолжает опрос с лимитом по времени).

---

## 4. Примерная последовательность вывода

```python
def give_gift(player, lot_or_gift):
    gift_id = lot_or_gift.gift_id
    if not gift_id:                                   # подарка нет у BoostUp: купить
        op = new_key()
        r = post("/buy", op, {"lot_id": lot_or_gift.lot_id, "max_price": lot_or_gift.price_with_margin})
        r = wait_for_operation(r, op)                 # если 202: опрашивать /operations/{op}
        if r.status != "done":
            return fail(r)                            # failed: другой лот; review: ждать и опрашивать
        gift_id = r.result["gift"]["gift_id"]
    op = new_key()
    if player_is_in_crafter:                          # способ B
        r = post("/transfer", op, {"gift_id": gift_id, "telegram_id": player.telegram_id})
    else:                                             # способ A
        r = post("/withdraw", op, {"gift_id": gift_id, "telegram_id": player.telegram_id, "username": player.username})
    return wait_for_operation(r, op)

def wait_for_operation(r, op, limit=90):
    started = time.time()
    while r.status == "processing" and time.time() - started < limit:
        time.sleep(2.5)
        r = get(f"/operations/{op}")
    return r
```

После способа A итог вывода в Telegram смотрите через `GET /withdrawals` (статусы `queued` → `confirmed`/`failed`).

---

## 5. Что исправлено на стороне Crafter

- Покупка лота маркета больше не заставляет ждать до 40 секунд: если она идёт дольше 20 секунд, API сразу отвечает `202 processing`, а итог читается из `/operations/{id}`.
- Неудачная проверка лота раньше возвращалась как `503 review` («результат неизвестен») и при повторе с тем же ключом отвечала так же. Теперь это обычный отказ `409` (ничего не куплено), после которого можно повторить с новым ключом.
- При временном отказе Thermos «Gift price mismatch» покупка один раз повторяется автоматически.
- Вывод `/withdraw` теперь умеет отправлять подарок на любой Telegram-аккаунт (поля `telegram_id`, `username`), а не только на аккаунт BoostUp.
- Лоты, которых уже нет на релейере или которые куплены в другом месте, пропадают из каталога.
