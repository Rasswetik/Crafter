const baseBotAdmin = renderAdmin;
renderAdmin = async function () {
    if (state.adminSection === 'telegram-bot') return renderTelegramBotAdmin();
    await baseBotAdmin();
    if (state.page !== 'admin' || state.adminSection === 'telegram-bot') return;
    document.querySelector('.admin-tabs')?.insertAdjacentHTML('beforeend', telegramBotTab());
};

function telegramBotTab() {
    const selected = state.adminSection === 'telegram-bot';
    return `<button class="${selected ? 'selected' : ''}" onclick="state.adminSection='telegram-bot';renderAdmin()">Telegram-бот</button>`;
}

function botButtonRow(button = {text: '', type: 'web_app', url: ''}) {
    return `<fieldset class="bot-inline-row">
        <label>Подпись<input class="field" name="button-text" maxlength="64" value="${esc(button.text)}" required></label>
        <label>Действие<select class="field" name="button-type">
            <option value="web_app" ${button.type === 'web_app' ? 'selected' : ''}>Открыть Mini App</option>
            <option value="url" ${button.type === 'url' ? 'selected' : ''}>Открыть ссылку</option>
        </select></label>
        <label>HTTPS-ссылка<input class="field" name="button-url" type="url" maxlength="1024" value="${esc(button.url)}" placeholder="Для Mini App можно оставить пустой"></label>
        <button type="button" class="secondary" onclick="this.closest('fieldset').remove()">Удалить кнопку</button>
    </fieldset>`;
}

async function renderTelegramBotAdmin() {
    document.querySelector('#main').innerHTML = `
        <div class="admin-title"><h1>Управление</h1><button onclick="go('profile')">Закрыть</button></div>
        <div class="admin-tabs">
            <button onclick="state.adminSection='users';renderAdmin()">Пользователи</button>
            <button onclick="state.adminSection='portal';renderAdmin()">Portal Market</button>
            <button onclick="state.adminSection='tonconnect';renderAdmin()">TON Connect</button>
            ${telegramBotTab()}
        </div>
        <section class="panel" id="bot-admin-content"><p>Загрузка…</p></section>`;
    const content = document.querySelector('#bot-admin-content');
    try {
        const config = await api('admin/telegram-bot');
        if (!content.isConnected) return;
        content.innerHTML = `<h3>Telegram-бот</h3>
            <p>${config.username ? '@' + esc(config.username) + ' · ' : ''}${config.connected ? 'Webhook подключён' : 'Webhook не подключён'}</p>
            <form id="bot-settings">
                <label class="form-label">Токен BotFather<input name="token" class="field" type="password" maxlength="128"
                    autocomplete="new-password" placeholder="${config.token_configured ? 'Токен задан. Введите новый для замены' : 'Введите токен'}"></label>
                <label class="form-label">Приветствие для /start<textarea name="greeting" class="field" maxlength="4096" rows="4" required>${esc(config.greeting)}</textarea></label>
                <label class="form-label">HTTPS-адрес Mini App<input name="app_url" class="field" type="url" maxlength="1024"
                    value="${esc(config.app_url)}" placeholder="По умолчанию адрес Crafter"></label>
                <h4>Кнопки под приветствием</h4>
                <div class="bot-inline-rows">${config.buttons.map(botButtonRow).join('')}</div>
                <button type="button" class="secondary" onclick="addTelegramBotButton(this.form)">Добавить кнопку</button>
                <label class="form-label">Кнопка меню в чате<input name="menu_text" class="field" maxlength="64"
                    value="${esc(config.menu_text)}" placeholder="Пустое поле возвращает стандартное меню"></label>
                <div class="bot-admin-actions">
                    <button class="primary" type="submit">Сохранить</button>
                    <button class="secondary" type="button" data-bot-action="connect" onclick="submitTelegramBotAction(this)">Подключить webhook</button>
                    <button class="secondary" type="button" data-bot-action="menu" onclick="submitTelegramBotAction(this)">Применить меню</button>
                </div>
                <p class="sub" role="status"></p>
            </form>`;
        const form = content.querySelector('form');
        form.addEventListener('submit', event => {
            event.preventDefault();
            submitTelegramBotAction(event.submitter || form.querySelector('[type=submit]'));
        });
    } catch (error) {
        if (content.isConnected) content.textContent = error.message;
    }
}

function addTelegramBotButton(form) {
    const rows = form.querySelector('.bot-inline-rows');
    if (rows.children.length >= 8) return toast('Можно добавить до 8 кнопок');
    rows.insertAdjacentHTML('beforeend', botButtonRow());
    rows.lastElementChild.querySelector('input').focus();
}

async function submitTelegramBotAction(button) {
    const form = button.form;
    if (!form.reportValidity() || form.dataset.saving) return;
    const data = Object.fromEntries(new FormData(form));
    const buttons = [...form.querySelectorAll('.bot-inline-row')].map(row => ({
        text: row.querySelector('[name=button-text]').value,
        type: row.querySelector('[name=button-type]').value,
        url: row.querySelector('[name=button-url]').value.trim(),
    }));
    const action = button.dataset.botAction;
    const status = form.querySelector('[role=status]');
    form.dataset.saving = 'true';
    button.disabled = true;
    status.textContent = 'Сохранение…';
    try {
        await api('admin/telegram-bot', {
            token: data.token, greeting: data.greeting, app_url: data.app_url, menu_text: data.menu_text, buttons,
        });
        form.elements.token.value = '';
        if (action) await api('admin/telegram-bot/' + action, {});
        toast(action === 'connect' ? 'Webhook подключён' : action === 'menu' ? 'Меню обновлено' : 'Настройки сохранены');
        if (form.isConnected) await renderTelegramBotAdmin();
    } catch (error) {
        status.textContent = error.message;
    } finally {
        delete form.dataset.saving;
        button.disabled = false;
    }
}
