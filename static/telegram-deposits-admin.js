let relayerProfileRefreshAttempted = false;
const relayerFallbackAvatar = '/static/assets/anvil-mark.webp';

function relayerStatusText(item) {
    return ({
        credited: 'Зачислено',
        baseline: 'Был до подключения',
        anonymous: 'Анонимный перевод',
        unmatched: 'Отправитель не зарегистрирован',
        duplicate: 'Уже в инвентаре'
    })[item] || item;
}
function relayerHistoryItem(item) {
    const gift = item.gift || {};
    const photo = imageURL(gift.image) || relayerFallbackAvatar;
    const name = [gift.name, gift.number ? '#' + gift.number : ''].filter(Boolean).join(' ');
    const url = /^https:\/\/(?:t\.me|telegram\.me)\/nft\/[a-zA-Z0-9_-]+$/.test(gift.telegram_url || '')
        ? gift.telegram_url : '';
    const time = new Date((Number(item.received) || 0) * 1000);
    const date = Number.isFinite(time.getTime()) ? time.toLocaleString('ru-RU', {
        day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'
    }) : '';
    const status = relayerStatusText(item.status);
    return `<div class="relayer-history-row">
        <div class="relayer-gift-image"><img src="${esc(photo)}" alt="" loading="lazy" onerror="this.src='/static/assets/anvil-mark.webp';this.onerror=null"></div>
        <div class="relayer-gift-copy">
            <b>${url ? `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${esc(name)}</a>` : esc(name)}</b>
            <small>${esc(status)}${item.sender_id ? ' · ID ' + esc(item.sender_id) : ''}</small>
        </div>
        <time>${esc(date)}</time>
    </div>`;
}
function relayerConfiguration(info) {
    const label = info.api_credentials_source === 'relayer' ? 'Сохранены в Relayer' :
        info.api_credentials_source === 'render' ? 'Заданы на сервере' : 'Не указаны';
    return `<details class="relayer-config" ${info.connected ? '' : 'open'}>
        <summary>
            <span class="relayer-summary-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path d="M12 2v2m0 16v2M4 12H2m20 0h-2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/><circle cx="12" cy="12" r="5"/>
                </svg>
            </span>
            <span><strong>Настройки подключения</strong><small>API, эмодзи и авторизация</small></span>
            <svg class="relayer-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </summary>
        <div class="relayer-config-inner">
            <p class="relayer-config-description">API ID и API Hash: ${esc(label)}. Ключ шифрования сессии: ${info.session_key_configured ? 'настроен' : 'не настроен'}.</p>
            <form id="relayer-settings-form" autocomplete="off" onsubmit="event.preventDefault();saveRelayerSettings()">
                <label class="form-label">API ID<input class="field" id="relayer-api-id" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="16" autocomplete="off" placeholder="Ваш API ID"></label>
                <label class="form-label">API Hash<input class="field" id="relayer-api-hash" type="password" minlength="32" maxlength="32" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="${info.api_credentials_source === 'missing' ? '32 символа' : 'Сохранён — для замены введите заново'}"></label>
                <label class="form-label">Эмодзи уведомления<input class="field" id="relayer-emoji" type="text" maxlength="16" value="${esc(info.notification_emoji || '🎁')}" placeholder="🎁"></label>
                <button class="primary" type="submit">Сохранить настройки</button>
            </form>
            <p class="relayer-config-description">API-ключи хранятся зашифрованно. Для замены ключей сначала отключите аккаунт Relayer. Существующую сессию и пароли здесь не показываем.</p>
            ${!info.connected ? `<div class="relayer-login">
                <h4>Подключить Telegram</h4>
                <label class="form-label">Номер Telegram<input id="tg-deposit-phone" class="field" type="tel" autocomplete="tel" placeholder="+79990000000"></label>
                <button type="button" class="secondary" onclick="telegramDepositLogin('send-code')">Получить код</button>
                ${info.phone_pending ? `<label class="form-label">Код Telegram
                    <input id="tg-deposit-code" class="field" inputmode="numeric" autocomplete="one-time-code">
                </label>
                <button type="button" class="primary" onclick="telegramDepositLogin('verify-code')">Подтвердить код</button>
                <label class="form-label">Пароль 2FA
                    <input id="tg-deposit-password" class="field" type="password" autocomplete="off">
                </label>
                <button type="button" class="secondary" onclick="telegramDepositLogin('verify-password')">Подтвердить 2FA</button>` : ''}
            </div>` : ''}
        </div>
    </details>`;
}
async function renderTelegramDeposits(content = document.querySelector('#admin-content')) {
    if (!content) return;
    let info = await api('admin/telegram-deposits');
    const history = await api('admin/telegram-deposits/history');
    if (!content.isConnected) return;
    // Refresh the verified @username once for sessions connected on older versions.
    if (info.connected && !info.account_username && !relayerProfileRefreshAttempted) {
        relayerProfileRefreshAttempted = true;
        try {
            const checked = await api('admin/telegram-deposits/check', {});
            if (checked.connected) info = {...info, ...checked};
        } catch (_) {}
    }
    const username = String(info.account_username || '').replace(/^@/, '').trim();
    const handle = username ? '@' + username : (info.account_id ? 'ID ' + info.account_id : 'Аккаунт не подключён');
    const credited = Number(info.totals.credited || 0);
    const unmatched = Number(info.totals.unmatched || 0) + Number(info.totals.anonymous || 0);
    const total = credited + unmatched + Number(info.totals.baseline || 0) + Number(info.totals.duplicate || 0);
    const lastCheck = info.last_scan ? new Date(info.last_scan * 1000).toLocaleString('ru-RU', {
        day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'
    }) : 'Ещё не проверялось';
    const connected = Boolean(info.connected);
    const avatar = relayerFallbackAvatar;
    content.innerHTML = `<div class="relayer-dashboard">
        <section class="relayer-hero">
            <div class="relayer-overline">
                <span>CRAFTER <span class="relayer-overline-sep">/</span> RELAYER</span>
                <span class="relayer-state ${connected ? 'is-online' : 'is-offline'}">
                    <span></span> ${connected ? 'Активен' : 'Не подключён'}
                </span>
            </div>
            <div class="relayer-account">
                <div class="relayer-avatar">
                    <img src="${avatar}" alt="Аватар Crafter" width="92" height="92">
                    ${connected ? '<span class="relayer-avatar-online" aria-hidden="true"></span>' : ''}
                </div>
                <h3>Crafter Relayer</h3>
                <p class="relayer-username">${esc(handle)}</p>
                <div class="relayer-account-status">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5"/>
                    </svg>
                    <span>${connected ? 'Telegram подключён' : 'Подключите Telegram, чтобы принимать подарки'}</span>
                </div>
            </div>
            <div class="relayer-hero-bottom">
                <span class="relayer-detail-label">СТАТУС МОНИТОРИНГА</span>
                <strong>${connected ? (info.baseline_done ? 'Мониторинг включён' : 'Ожидает первую синхронизацию') : 'Нет подключения'}</strong>
                <small>${connected ? 'Отслеживаем новые коллекционные NFT-подарки' : 'История сохраняется после подключения'}</small>
            </div>
        </section>

        <section class="relayer-overview" aria-label="Статистика Relayer">
            <div><strong>${credited}</strong><span>Зачислено</span></div>
            <div><strong>${unmatched}</strong><span>Без получателя</span></div>
            <div><strong>${total}</strong><span>Всего записей</span></div>
        </section>

        <div class="relayer-actions">
            <button class="primary relayer-check-deposits" type="button" onclick="telegramDepositAction('sync')" ${connected ? '' : 'disabled'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6M20 4v7h-7"/></svg>
                Проверить пополнения
            </button>
            <button class="relayer-check-connect" type="button" onclick="telegramDepositAction('check')" ${connected ? '' : 'disabled'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                Проверить связь
            </button>
        </div>
        <p class="relayer-checked">Последняя проверка: ${esc(lastCheck)}.</p>
        ${info.last_error ? `<p class="relayer-issue">${esc(info.last_error)}</p>` : ''}
        <p id="tg-deposit-feedback" class="relayer-feedback" role="status"></p>

        <section class="relayer-history">
            <div class="relayer-history-head">
                <div><h3>История пополнений</h3><span>Все принятые NFT-подарки</span></div>
                <button type="button" class="relayer-refresh-history" aria-label="Обновить историю" title="Обновить" onclick="renderTelegramDeposits()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6M20 4v7h-7"/></svg>
                </button>
            </div>
            <div class="relayer-history-list">
                ${history.items.length ? history.items.map(relayerHistoryItem).join('') :
                    `<div class="relayer-empty">
                        <span class="relayer-empty-gift">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M2 9h20M12 9v12M12 9C4 9 6 3 10 5c1 .5 2 3 2 4Zm0 0c8 0 6-6 2-4-1 .5-2 3-2 4Z"/></svg>
                        </span>
                        <b>Подарков пока нет</b>
                        <span>Новые пополнения появятся здесь автоматически</span>
                    </div>`}
            </div>
        </section>
        ${relayerConfiguration(info)}
        ${connected ? `<button type="button" class="relayer-disconnect" onclick="telegramDepositAction('disconnect')">Отключить Relayer</button>` : ''}
        <p class="relayer-footnote">Подарки зачисляются только зарегистрированным отправителям с подтверждённым Telegram ID. Анонимные поступления сохраняются в истории для проверки.</p>
    </div>`;
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
        if (status) status.textContent = relayerErrorText(error);
        toast(relayerErrorText(error));
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
        if (status) status.textContent = relayerErrorText(error);
        toast(relayerErrorText(error));
    }
}

function relayerErrorText(error) {
    if (error.status === 401) return 'Авторизация админки Telegram истекла. Заново откройте Crafter через Telegram и перейдите в админ-панель.';
    return error.message || 'Не удалось выполнить запрос';
}

async function saveRelayerSettings() {
    const form = document.querySelector('#relayer-settings-form');
    if (!form || !form.reportValidity()) return;
    const id = document.querySelector('#relayer-api-id').value.trim();
    const hash = document.querySelector('#relayer-api-hash').value.trim();
    const emoji = document.querySelector('#relayer-emoji').value.trim();
    if (!!id !== !!hash) {
        toast('Введите API ID и API Hash вместе или оставьте оба поля пустыми.');
        return;
    }
    if (id && (!/^[1-9][0-9]{0,15}$/.test(id) || !/^[a-fA-F0-9]{32}$/.test(hash))) {
        toast('API ID должен быть числом, а API Hash — 32 шестнадцатеричных символа.');
        return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        await api('admin/telegram-deposits/credentials', {api_id: id, api_hash: hash, emoji});
        toast('Настройки Relayer сохранены');
        await renderTelegramDeposits();
    } catch (error) {
        toast(relayerErrorText(error));
        const status = document.querySelector('#tg-deposit-feedback');
        if (status) status.textContent = relayerErrorText(error);
    } finally {
        if (button.isConnected) button.disabled = false;
    }
}
