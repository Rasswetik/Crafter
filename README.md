# Crafter

Flask-проект Telegram Mini App: маркет, мои подарки, крафт и профиль. Интерфейс воссоздан по предоставленным скриншотам Portal, анимация крафта — по пользовательскому видео с вращающимся кубом. Прямое подключение к официальному Portals Partner API выполняется на сервере.

## Запуск

Python 3.11+:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Windows: `.venv\Scripts\activate`. Адрес для локальной проверки: http://127.0.0.1:5000.

В `.env.example` указан admin ID **5257227756**. Права выдаются только после проверки подписи Telegram. В обычном браузере DEMO_MODE=1 использует тестового пользователя с ID 1; для локальной проверки админки можно временно добавить 1 в ADMIN_IDS. Не используйте этот режим на публичном production-сервере.

## Telegram

В `.env` задайте BOT_TOKEN, BOT_USERNAME без @ и ADMIN_IDS. Разверните приложение за HTTPS-прокси и укажите его HTTPS URL как Main Mini App / Menu Button в BotFather. Для production установите DEMO_MODE=0.

```bash
gunicorn -w 1 -b 127.0.0.1:5000 app:app
```

Используется серверная проверка HMAC Telegram initData, ограничение срока подписи и проверка роли на каждом административном запросе. Неподписанные ID из браузера не дают права администратора. Секреты и SQLite-база исключены из Git.

## Portal API

Получите ключ в Portals → профиль → Partner API. Задайте PORTALS_API_KEY в серверном `.env` и перезапустите приложение. Далее профиль администратора → Админ-панель → Проверить подключение → Обновить цены и каталог.

Подключены официальные read-only методы:

- `GET /partners/market/config` — проверка соединения.
- `GET /partners/collections/preview` — полный список коллекций, превью и цены.
- `GET /partners/collections/attribute-floors` — модели, фоны, символы и минимальные цены.
- `GET /partners/nfts/search` — предложения, изображения и атрибуты; поиск, фильтры и пагинация.

Авторизация: `Authorization: partners <key>`. Ключ не передаётся клиенту. Каталог и модели сохраняются в SQLite. В админке можно отметить модели каждой коллекции и сохранить конфигурацию будущего реального крафта.

В рабочем режиме витрина читает публичные предложения Portals и при необходимости использует Thermos. Обычная загрузка витрины не расходует лимит Partner API. В DEMO_MODE без ключа показываются тестовые карточки, а с ключом можно проверять Partner API отдельно от рабочего режима.

Лимит одного процесса: не более одного исходящего запроса за 1.05 секунды; используется один worker. Для нескольких процессов нужен общий распределённый лимитер. Официальный контракт: https://docs.portals.tg/ru/developers/api/

## Тестовые операции

При первом входе в DEMO_MODE выдаются четыре тестовых подарка и 100 тестовых GRAM. Данные сохраняются по пользователям в SQLite. Доступны тестовые покупка, выставление, снятие с продажи, отправка, вывод, история и крафт. Отправка и вывод удаляют подарок только из тестового инвентаря, реальных NFT-переводов нет. Офферы отображают пустое состояние, реальные офферы не подключены.

Крафт принимает до четырёх невыставленных подарков. Тестовый шанс: 20% за подарок, максимум 80%, независимо от рыночной стоимости. Он не воспроизводит экономику Telegram. При запуске исходные тестовые подарки атомарно списываются, при успехе результат зачисляется в инвентарь. `request_id` защищает от повторного списания при повторе запроса. На экране подарки сходятся в центр, вращается объёмный куб с подарками и наковальнями, затем раскрывается результат.

Реальные покупка, депозит NFT, вывод, платежи и крафт выключены. Для них нужны правила крафта, платёжный провайдер и система хранения/учёта NFT. Инвентарь владельца Partner API-ключа не выдаётся за личный инвентарь посетителей приложения. В production личный инвентарь остаётся пустым до подключения зачисления.

## Проверки

```bash
pip install pytest
python -m pytest tests -q
```

Семь тестов: авторизация и роли, подделанная/просроченная подпись, запрет реального крафта, сохранение выбора моделей, тестовый крафт, операции инвентаря и повтор запроса крафта. Синтаксис JavaScript проверяется `node --check static/app.js` и `node --check static/screens.js`.

Живой Portal API не проверен без пользовательского ключа. Точная анимация реконструирована средствами CSS/JS; видео не используется как фон приложения. Два демонстрационных изображения извлечены из предоставленного референса. Подключённый API использует изображения из ответов Portal.

## HTML-превью

`python build_preview.py` создаёт `Crafter_Preview.html` для просмотра без Flask. В нём локальный тестовый инвентарь сохраняется в localStorage. Админ-панель в HTML демонстрационная; реального подключения к Portals и Telegram нет. Сгенерированные HTML-файлы не включены в репозиторий, создаются из исходников.

### Исправление отображения куба и фильтров

Куб рисуется в Canvas через проекцию шести граней, отсечение невидимых граней, текстуры подарков и освещение. CSS preserve-3d не требуется. Разметка фильтров исправлена: обработчик кнопки вынесен в отдельную функцию, все пять элементов строки имеют явные размеры. Геометрия проверяется командой `node tests/test_cube.cjs`.

## Администратор: пользователи и каталог

В админке два раздела: **Пользователи** и **Portal Market**. Пользователи появляются после первого входа. Поиск по ID, имени и username; баланс сохраняется сервером, подарки выдаются по выбранным коллекции и модели из каталога. Выдача создаёт запись в инвентаре Crafter и не означает перевод внешнего NFT. Действия администратора журналируются.

Встроен начальный каталог RasswetGifts из используемого HatDrop источника: 114 коллекций и 7297 моделей, снимок от 22 мая 2026. Оценки снимка выражены в TON; это не текущие цены Portal. Обновление Portal использует /api/collections?limit=5000 и /api/collections/filters?short_names=… без обязательного Partner API-ключа. Обновление идёт в фоне, сохраняет предыдущие данные при ошибке. /preview — изолированный просмотр оформления; данные посетителей туда не передаются. Карта файлов: docs/FILES.md.

## Админ-панель 2.0 · Liquid Glass

Адрес: `/admin`. Вход в API админки доступен только владельцам
`ADMIN_IDS` с действительной подписанной Telegram WebApp-сессией.
Для отдельного пользователя открывается страница `/admin/user/<Telegram ID>`.

- **Финансы**: подтверждённые депозиты/выводы и графики GRAM/TON за день,
  7/30 дней, весь период или выбранные даты. Разница — **денежный поток**,
  не бухгалтерская прибыль. Чистая прибыль пока недоступна без сводного
  учёта комиссий, расходов и себестоимости.
- **Технические работы**: администратор вручную включает/выключает режим;
  обычным посетителям показывается полноэкранная стеклянная заглушка с
  шестерёнкой и кнопкой повторной проверки. Интерактивные API обычных
  посетителей отвечают 503; подписанный администратор сохраняет доступ.
  Статус хранится в таблице `settings`, изменение записывается в аудит.
  Публичные HTML/статические ресурсы и `/health` остаются доступны.
  Фоновые процессы вывода это **не останавливает** — для них существует
  отдельное управление в разделе TON.
- **Пользователи**: детальная статистика, график, инвентарь, операции,
  административные корректировки и блокировка.
- **Выводы NFT**: ручная очередь с обязательным подтверждением реального
  Telegram-перевода. **Выводы TON** и **Автовывод TON** используют уже
  существующие проверяемые процессы; новые механизмы подписи ключей и
  отправки средств не добавляются.
- **Режимы**: серверные переключатели Craft, Arena, Staking (всё включено
  по умолчанию); выключенный режим недоступен обычным пользователям.
- Управление крафтами, баннерами, Relayer, событиями, аудиторией, ботом
  и каталогом остаётся внутри общей мобильной панели.

Тесты: `pytest tests/test_admin_console.py` и
`node tests/test_maintenance_ui.cjs`. Настройка технических работ
поставляется **выключенной**; включение требует подтверждения администратора.


## Desktop interface and winter maintenance (2026-11-08)

- Desktop (>=1024px): true fixed left navigation from existing Crafter routes
  (profile/avatar, Market, gifts, Hub, Craft, Arena, Staking, settings and admin),
  while mobile keeps its existing bottom bar.
- On wider monitors (>=1400px) market and staked NFT gifts use an 11-column grid;
  no fake NFT renders are introduced. Loading placeholders follow those columns.
- The existing Christmas canopy repeats naturally over the full desktop header.
  The splash adapts its original artwork/sprites to 4:3, 16:9, ultrawide and
  short browser windows.
- Maintenance overlay uses dark graphite Liquid Glass and independently
  animated snow with the existing holiday garland. Snow is restored once,
  then remains under the normal on/off control in the admin console.
- Admin section navigation retains the sidebar scroll position and no longer
  forces the browser back to the top.

### Admin rights

Only the primary administrator may open **Админка → Управление админами**.
They can grant full access or choose individual sections, and revoke grants.
The backend verifies permissions on every privileged request, including
financial and withdrawal endpoints. Separate read-only TON and NFT queues
avoid leaking the other queue to a single-section admin.

Primary admin is the **sole preconfigured Telegram ID in ADMIN_IDS**. If
ADMIN_IDS lists more than one person, set PRIMARY_ADMIN_ID to the verified
numeric Telegram user ID of the main IT administrator; we deliberately do not
promote an account based on a mutable username. All grants and revocations
are recorded in the audit log.

Referral levels follow 10 invited accounts per level, capped at level 3.
A planned 10%/5%/10% tier schedule is exposed as reference metadata only:
real percentage payments are not activated without a defined verified fee source
and accounting flow.
