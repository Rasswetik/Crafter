# Автовывод TON на кошелёк игрока — настройка на Timeweb (VPS)

Вместо Render Cron используется `systemd timer`: раз в 2 минуты запускается `auto_payout_worker.py`.
Секретная фраза горячего кошелька лежит **только** в `/etc/crafter/payout.env` и недоступна веб-сервису.

## Что нужно заранее
- PostgreSQL (локальный на VPS или управляемый Timeweb). Автовыплаты **отказываются** работать без `DATABASE_URL`.
- Веб-сервис Crafter уже запущен (`docs/DEPLOY.md`), TON Connect настроен: раздел «TON Connect» в админке
  (сеть, адрес приёма, курс GRAM/TON, лимиты, включённый вывод).
- **Новый** кошелёк V4R2 только для выплат (не личный). Создайте его сами, сид-фразу никому не отправляйте.

## Шаги
1. Сеть testnet. Пополните горячий кошелёк тестовыми TON (бот Testgiver).
2. На сервере:
   ```bash
   sudo mkdir -p /etc/crafter && sudo cp /opt/crafter/deploy/payout.env.example /etc/crafter/payout.env
   sudo chown crafter:crafter /etc/crafter/payout.env && sudo chmod 600 /etc/crafter/payout.env
   sudo nano /etc/crafter/payout.env     # впишите 24 слова, адрес 0:..., CRAFTER_PAYOUT_NETWORK=testnet
   ```
   `DATABASE_URL` берётся из `/opt/crafter/.env`, он должен быть тем же, что у веб-сервиса.
3. Включите таймер:
   ```bash
   sudo cp /opt/crafter/deploy/crafter-payout.service /opt/crafter/deploy/crafter-payout.timer /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now crafter-payout.timer
   systemctl list-timers | grep crafter
   ```
4. Админка → «TON Connect» → автоматический вывод: впишите адрес выплатного кошелька, включите обработку,
   лимиты оставьте консервативными (0.25 TON за перевод, 1 TON в сутки, резерв 0.5 TON).
5. Создайте маленькую тестовую заявку на вывод и проверьте перевод в Testnet Tonscan. Логи:
   `journalctl -u crafter-payout.service -n 50`.
6. Mainnet: смените сеть в TON Connect админке и в `payout.env` на `mainnet`, добавьте
   `CRAFTER_PAYOUT_MAINNET_UNLOCK=YES_I_ACCEPT_REAL_PAYOUTS`, пополните кошелёк небольшим резервом.

## Безопасность
- Подписанный перевод сохраняется до отправки. При неясном результате сети новый перевод **не создаётся**:
  заявка получает статус `review`, юнит завершается кодом 2 (будет «failed» в `systemctl`). Сверьте блокчейн вручную.
- Держите в горячем кошельке только операционный запас. Сид не хранится в базе и не вводится в браузере.
