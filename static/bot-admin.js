function botButtonRow(button = {text: '', type: 'web_app', url: ''}) {
    return `<fieldset class="bot-inline-row">
        <label>Подпись<input class="field" name="button-text" maxlength="64" value="${esc(button.text)}" required></label>
        <label>Действие<select class="field" name="button-type">
            <option value="web_app" ${button.type === 'web_app' ? 'selected' : ''}>Открыть Mini App</option>
            <option value="url" ${button.type === 'url' ? 'selected' : ''}>Открыть ссылку</option>
        </select></label>
        <label>Цвет кнопки<select class="field" name="button-style">
            ${[['','По умолчанию'],['primary','Синий'],['success','Зелёный'],['danger','Красный']].map(([value,label]) =>
                `<option value="${value}" ${(button.style || '') === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label>Премиум-эмодзи на кнопке<input class="field" name="button-emoji" inputmode="numeric" pattern="[0-9]{1,25}"
            value="${esc(button.icon_custom_emoji_id || '')}" placeholder="ID эмодзи"></label>
        <button type="button" class="secondary" onclick="openBotEmojiPicker(this.previousElementSibling.querySelector('input'))">Выбрать эмодзи</button>
        <label>HTTPS-ссылка<input class="field" name="button-url" type="url" maxlength="1024" value="${esc(button.url)}" placeholder="Для Mini App можно оставить пустой"></label>
        <button type="button" class="secondary" onclick="this.closest('fieldset').remove()">Удалить кнопку</button>
    </fieldset>`;
}

async function renderTelegramBotAdmin(content = document.querySelector('#admin-content')) {
    content.innerHTML = '<section class="panel" id="bot-admin-content"><p>Загрузка…</p></section>';
    content = content.firstElementChild;
    try {
        const config = await api('admin/telegram-bot');
        if (!content.isConnected) return;
        botEmojiLibrary = config.emoji_library || [];
        content.innerHTML = `<h3>Telegram-бот</h3>
            <p>${config.username ? '@' + esc(config.username) + ' · ' : ''}${config.connected ? 'Webhook подключён' : 'Webhook не подключён'}</p>
            <form id="bot-settings">
                <label class="form-label">Токен BotFather<input name="token" class="field" type="password" maxlength="128"
                    autocomplete="new-password" placeholder="${config.token_configured ? 'Токен задан. Введите новый для замены' : 'Введите токен'}"></label>
                <label class="form-label">Приветствие для /start<textarea name="greeting" class="field" maxlength="4096" rows="4" required>${esc(config.greeting)}</textarea></label>
                <button type="button" class="secondary" onclick="openBotEmojiPicker(this.form.elements.greeting)">Вставить эмодзи в приветствие</button>
                <label class="form-label">HTTPS-адрес Mini App<input name="app_url" class="field" type="url" maxlength="1024"
                    value="${esc(config.app_url)}" placeholder="По умолчанию адрес Crafter"></label>
                <h4>Кнопки под приветствием</h4>
                <div class="bot-inline-rows">${config.buttons.map(botButtonRow).join('')}</div>
                <button type="button" class="secondary" onclick="addTelegramBotButton(this.form)">Добавить кнопку</button>
                <label class="form-label">Кнопка меню в чате<input name="menu_text" class="field" maxlength="64"
                    value="${esc(config.menu_text)}" placeholder="Пустое поле возвращает стандартное меню"></label>
                <h4>Уведомление о получении подарков</h4>
                <label class="form-label">Текст уведомления<textarea name="gift_template" class="field" maxlength="1300" rows="5" required>${esc(config.gift_template)}</textarea></label>
                <div class="bot-gift-styles" aria-label="Стили текста">
                    ${[['b','Жирный'],['i','Курсив'],['u','Подчёркнутый'],['s','Зачёркнутый'],['tg-spoiler','Спойлер']].map(([tag,label]) =>
                        `<button type="button" class="secondary" onclick="styleGiftNotification(this.form.elements.gift_template,'${tag}')">${label}</button>`).join('')}
                </div>
                <p class="sub">Поля: {count}, {gift_word}, {sender}, {gifts}, {message}.</p>
                <label class="form-label">Кнопка под уведомлением<input name="gift_button_text" class="field" maxlength="64" required value="${esc(config.gift_button_text)}"></label>
                <div class="bot-admin-actions">
                    <button class="primary" type="submit">Сохранить</button>
                    <button class="secondary" type="button" data-bot-action="connect" onclick="submitTelegramBotAction(this)">Подключить webhook</button>
                    <button class="secondary" type="button" data-bot-action="menu" onclick="submitTelegramBotAction(this)">Применить меню</button>
                </div>
                <p class="sub" role="status"></p>
            </form>
            <section class="bot-emoji-admin">
                <h4>Премиум-эмодзи</h4>
                <label class="form-label">ID эмодзи или ссылка на набор <input id="bot-emoji-source" class="field" placeholder="ID или https://t.me/addemoji/…"></label>
                <button type="button" class="secondary" onclick="importBotEmoji(this)">Добавить в библиотеку</button>
                <button type="button" class="secondary" onclick="openBotEmojiPicker()">Библиотека · <span id="bot-emoji-count">${botEmojiLibrary.length}</span></button>
            </section>`;
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
        style: row.querySelector('[name=button-style]').value,
        icon_custom_emoji_id: row.querySelector('[name=button-emoji]').value.trim(),
    }));
    const action = button.dataset.botAction;
    const status = form.querySelector('[role=status]');
    form.dataset.saving = 'true';
    button.disabled = true;
    status.textContent = 'Сохранение…';
    try {
        await api('admin/telegram-bot', {
            token: data.token, greeting: data.greeting, app_url: data.app_url, menu_text: data.menu_text, buttons,
            gift_template:data.gift_template, gift_button_text:data.gift_button_text,
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

let botEmojiLibrary = [];
const botEmojiImages = new Map();

async function importBotEmoji(button) {
    const input = document.querySelector('#bot-emoji-source');
    const value = input.value.trim();
    if (!value || button.disabled) return;
    button.disabled = true;
    try {
        const config = await api('admin/telegram-bot/emoji', {value});
        if (!input.isConnected) return;
        botEmojiLibrary = config.emoji_library;
        document.querySelector('#bot-emoji-count').textContent = botEmojiLibrary.length;
        input.value = '';
        toast('Эмодзи добавлены в библиотеку');
    } catch (error) {
        toast(error.message);
    } finally {
        button.disabled = false;
    }
}

function openBotEmojiPicker(target) {
    if (!botEmojiLibrary.length) return toast('Сначала добавьте эмодзи по ID или ссылке на набор');
    const selection = target?.tagName === 'TEXTAREA' ? [target.selectionStart, target.selectionEnd] : null;
    sheet('Премиум-эмодзи', `<div class="bot-emoji-picker">${botEmojiLibrary.map(item =>
        `<button type="button" data-bot-emoji="${esc(item.id)}" aria-label="Эмодзи ${esc(item.id)}" title="${esc(item.id)}"><span>${esc(item.emoji)}</span></button>`
    ).join('')}</div>`);
    const panel = document.querySelector('.bot-emoji-picker');
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            paintBotEmojiImage(entry.target);
        }
    }, {root:panel});
    panel.querySelectorAll('button').forEach(button => {
        observer.observe(button);
        button.onclick = () => {
            if (!target?.isConnected) return;
            const id = button.dataset.botEmoji;
            if (selection) target.setRangeText(`[[emoji:${id}]]`, ...selection, 'end');
            else target.value = id;
            closeSheet();
        };
    });
}

async function paintBotEmojiImage(button) {
    const id = button.dataset.botEmoji;
    try {
        if (!botEmojiImages.has(id)) {
            botEmojiImages.set(id, fetch('/api/admin/telegram-bot/emoji/' + encodeURIComponent(id), {
                headers:{'X-Telegram-Init-Data':tg?.initData || ''},
            }).then(response => {
                if (!response.ok) throw Error();
                return response.blob();
            }).then(blob => URL.createObjectURL(blob)));
        }
        const src = await botEmojiImages.get(id);
        if (!button.isConnected) return;
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        button.replaceChildren(img);
    } catch {
        botEmojiImages.delete(id);
    }
}

function styleGiftNotification(field, tag) {
    const {selectionStart:start, selectionEnd:end} = field;
    const selected = field.value.slice(start, end);
    const open = '<' + tag + '>';
    field.setRangeText(open + selected + '</' + tag + '>', start, end, 'end');
    field.focus();
    field.setSelectionRange(start + open.length, start + open.length + selected.length);
}
