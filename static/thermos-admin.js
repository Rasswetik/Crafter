/* Admin → «Термос»: everything the operator has to enter or check for the Thermos market. */
async function renderThermosAdmin(content) {
    const [th, relayer, buy] = await Promise.all([
        api('admin/thermos'),
        api('admin/auto-nft').catch(() => null),
        api('admin/purchase-mode').catch(() => null),
    ]);
    if (!content.isConnected) return;
    const yes = ok => `<span class="th-dot ${ok ? 'is-ok' : 'is-no'}">${ok ? 'есть' : 'нет'}</span>`;
    const live = th.backend === 'thermos';
    content.innerHTML = `<section class="admin-glass-panel th-card">
        <h3>Thermos — единый маркет</h3>
        <p>Thermos объединяет Portals, Tonnel и MRKT: цены, покупка и вывод подарков в TON. После включения каталог, покупки и проверки в играх идут через него.</p>
        <ol class="th-steps">
            <li>В Telegram откройте бота <b>@thermos</b> и отправьте <code>/api</code>. Лучше делать это с аккаунта, который подключён как Relayer.</li>
            <li>Вставьте полученный токен ниже и нажмите «Сохранить». Токен хранится зашифрованным и больше не показывается.</li>
            <li>Нажмите «Проверить»: появится баланс и адрес для пополнения. Переведите TON на этот адрес с указанным memo.</li>
            <li>Включите источник «Thermos». Для реальных покупок переключите режим покупок на РАБОТА.</li>
        </ol>
        <div class="th-status">
            <div>Токен ${yes(th.token_configured)}</div>
            <div>Шифрование (CRAFTER_PORTALS_FERNET_KEY) ${yes(th.encryption_ready)}</div>
            <div>Relayer подключён ${relayer ? yes(relayer.relayer_connected) : '<span class="th-dot">—</span>'}</div>
            <div>Режим покупок <b>${buy ? (buy.mode === 'work' ? 'РАБОТА' : 'ТЕСТ') : '—'}</b></div>
            <div>Источник маркета <b>${live ? 'THERMOS' : 'Portals'}</b></div>
        </div>
        <label class="th-field"><span>Токен Thermos</span>
            <input id="thermos-token" type="password" autocomplete="off" placeholder="Вставьте токен из @thermos"></label>
        <div class="th-actions">
            <button type="button" onclick="thermosAdmin('token')">Сохранить токен</button>
            <button type="button" onclick="thermosAdmin('check')">Проверить подключение и баланс</button>
            <button type="button" class="${live ? 'is-active' : ''}" onclick="thermosAdmin('${live ? 'portals' : 'thermos'}')">
                ${live ? 'Вернуть Portals' : 'Включить Thermos'}</button>
        </div>
        <div id="thermos-info" class="th-info" role="status"></div>
        <p class="th-note">Комиссии Thermos: покупка 0,1 TON (0,2 TON при выводе на релейер), вывод подарка 0,1 TON. Лимит API — 2 запроса в секунду.</p>
    </section>`;
}

async function thermosAdmin(action) {
    const box = document.querySelector('#thermos-info');
    try {
        if (action === 'token') {
            const input = document.querySelector('#thermos-token');
            await api('admin/thermos/token', {token: input.value.trim()});
            input.value = '';
            toast('Токен сохранён');
        } else if (action === 'check') {
            box.textContent = 'Проверяем…';
            const r = await api('admin/thermos/check', {});
            box.innerHTML = `Подключено. Баланс: <b>${esc(r.balance_ton)} TON</b><br>Адрес пополнения: <code>${esc(r.deposit_address)}</code><br>Memo: <code>${esc(r.deposit_memo)}</code>`;
            return;
        } else {
            if (!confirm(action === 'thermos' ? 'Включить Thermos как источник маркета?' : 'Вернуть Portals?')) return;
            await api('admin/thermos/backend', {backend: action, confirm: 'SET_MARKET_BACKEND'});
            toast('Источник маркета изменён');
        }
        await renderAdmin();
    } catch (error) {
        if (box) box.textContent = error.message;
        toast(error.message);
    }
}
