async function renderTelegramDeposits(content = document.querySelector('#admin-content')) {
    const info = await api('admin/telegram-deposits');
    const history = await api('admin/telegram-deposits/history');
    const labels = {credited:'Зачислен',baseline:'До подключения',anonymous:'Анонимно',
                    unmatched:'Отправитель не зарегистрирован',duplicate:'Дубликат'};
    let html = '<section class="panel"><h3>Приём NFT-подарков Telegram</h3>';
    html += '<p class="sub">Сессия Telegram хранится в зашифрованном виде. Обрабатываются только входящие NFT.</p>';
    html += '<p><b>' + (info.connected ? '● Подключён' : '○ Не подключён') + '</b> ' + esc(info.account_name || '') + '</p>';
    html += '<p class="sub">MTProto: ' + (info.configured ? 'ключи заданы' : 'требуются TELEGRAM_API_ID, TELEGRAM_API_HASH и TELEGRAM_SESSION_KEY в Render') + '</p>';
    html += '<p class="sub">Первая сверка: ' + (info.baseline_done ? 'выполнена' : 'не выполнена') + '</p>';
    html += '<p class="sub">Последняя проверка: ' + (info.last_scan ? new Date(info.last_scan * 1000).toLocaleString('ru-RU') : 'не выполнялась') + '</p>';
    if (info.last_error) html += '<p class="error">' + esc(info.last_error) + '</p>';
    html += '<div class="bot-admin-actions"><button class="secondary" onclick="telegramDepositAction(\'check\')">Проверить подключение</button>';
    html += '<button class="primary" onclick="telegramDepositAction(\'sync\')">Проверить пополнения</button>';
    if (info.connected) html += '<button class="secondary" onclick="telegramDepositAction(\'disconnect\')">Отключить</button>';
    html += '</div>';
    if (!info.connected) {
        html += '<h4>Авторизация аккаунта приёма</h4>';
        html += '<label class="form-label">Номер Telegram<input id="tg-deposit-phone" class="field" type="tel" autocomplete="tel" placeholder="+79990000000"></label>';
        html += '<button class="secondary" onclick="telegramDepositLogin(\'send-code\')">Получить код</button>';
        if (info.phone_pending) {
            html += '<label class="form-label">Код Telegram<input id="tg-deposit-code" class="field" inputmode="numeric" autocomplete="one-time-code"></label>';
            html += '<button class="primary" onclick="telegramDepositLogin(\'verify-code\')">Подтвердить код</button>';
            html += '<label class="form-label">Пароль двухэтапной проверки<input id="tg-deposit-password" class="field" type="password" autocomplete="off"></label>';
            html += '<button class="secondary" onclick="telegramDepositLogin(\'verify-password\')">Подтвердить 2FA</button>';
        }
    }
    html += '<p id="tg-deposit-feedback" class="sub" role="status"></p>';
    html += '<p class="sub">Зачисляем новые NFT зарегистрированным пользователям по Telegram ID отправителя. Анонимные поступления фиксируются отдельно. Старые NFT при первой сверке не зачисляются.</p>';
    html += '</section><section class="panel"><h3>История пополнений</h3>';
    html += '<p class="sub">Зачислено: ' + (info.totals.credited || 0) + ' · Без получателя: ' + ((info.totals.unmatched || 0) + (info.totals.anonymous || 0)) + '</p>';
    html += '<button class="secondary" onclick="renderTelegramDeposits()">Обновить</button>';
    for (const item of history.items) {
        html += '<article style="padding:12px 0;border-bottom:1px solid #ffffff20">';
        html += '<a href="' + esc(item.gift.telegram_url) + '" target="_blank" rel="noopener noreferrer">' + esc(item.gift.name) + ' #' + esc(item.gift.number) + '</a>';
        html += '<p class="sub">' + esc(labels[item.status] || item.status) + ' · Отправитель: ' + (item.sender_id || 'неизвестен') + ' · ' + new Date(item.received * 1000).toLocaleString('ru-RU') + '</p></article>';
    }
    if (!history.items.length) html += '<p class="sub">История пока пуста</p>';
    content.innerHTML = html + '</section>';
}

async function telegramDepositAction(action) {
    if (action === 'disconnect' && !confirm('Отключить аккаунт приёма? История останется.')) return;
    const status = document.querySelector('#tg-deposit-feedback');
    if (status) status.textContent = 'Проверяем…';
    try {
        const result = await api('admin/telegram-deposits/' + action, {});
        if (action === 'check' && !result.connected) throw Error('Сессия недействительна');
        const message = action === 'sync' ? (result.busy ? 'Мониторинг уже выполняется' : 'Проверено: ' + result.scanned + ', зачислено: ' + result.credited) :
             action === 'check' ? 'Telegram подключён' : 'Отключено';
        await renderTelegramDeposits();
        document.querySelector('#tg-deposit-feedback').textContent = message;
        toast(message);
    } catch (error) {
        if (status) status.textContent = error.message;
        toast(error.message);
    }
}

async function telegramDepositLogin(action) {
    const body = action === 'send-code' ? {phone: document.querySelector('#tg-deposit-phone')?.value.trim()} :
                 action === 'verify-code' ? {code: document.querySelector('#tg-deposit-code')?.value.trim()} :
                 {password: document.querySelector('#tg-deposit-password')?.value};
    const status = document.querySelector('#tg-deposit-feedback');
    if (status) status.textContent = 'Подключение…';
    try {
        const result = await api('admin/telegram-deposits/' + action, body);
        const message = result.step === 'password' ? 'Введите пароль 2FA' :
                        result.step === 'code' ? 'Код отправлен в Telegram' : 'Аккаунт подключён';
        await renderTelegramDeposits();
        document.querySelector('#tg-deposit-feedback').textContent = message;
        toast(message);
    } catch (error) {
        if (status) status.textContent = error.message;
        toast(error.message);
    }
}
