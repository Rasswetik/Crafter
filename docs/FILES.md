# Карта файлов Crafter

| Файл | Назначение |
|---|---|
| app.py | Flask, авторизация Telegram, пользователи, баланс, инвентарь, загрузка Portal |
| templates/index.html | Основная страница Mini App |
| static/style.css | Оформление экранов и нижней панели выбора |
| static/screens.js | Экраны, выбор подарков, админка «Пользователи / Portal Market» |
| static/cube.js | Геометрия и отрисовка объёмного куба |
| static/app.js | Базовые функции API и навигации |
| data/catalog_seed.json.gz | Сохранённый каталог RasswetGifts: 114 коллекций, 7297 моделей; снимок от 22 мая 2026, оценки TON |
| build_preview.py | Автономный просмотр оформления, без доступа к данным посетителей |
| gunicorn.conf.py | Запуск на Render, порт из PORT |

Обновление Portal запрашивает /api/collections?limit=5000 и /api/collections/filters?short_names=…, как в HatDrop. Текущий источник, ошибки и состояние загрузки должны проверяться отдельно от наличия сохранённого каталога. Сохранённые цены не являются свежими котировками Portal.
