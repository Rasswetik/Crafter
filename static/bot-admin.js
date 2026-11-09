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
                <h4>Фразы бота</h4>
                <p class="sub">Любое сообщение бота можно переписать. Вставляйте поля кнопками, обычные эмодзи печатайте прямо в тексте, а премиум-эмодзи выбирайте из каталога.</p>
                <div id="bot-phrases" class="bot-phrases">${(config.phrases || []).map(phraseCard).join('')}</div>
                <div class="bot-admin-actions">
                    <button class="primary" type="submit">Сохранить</button>
                    <button class="secondary" type="button" data-bot-action="connect" onclick="submitTelegramBotAction(this)">Подключить webhook</button>
                    <button class="secondary" type="button" data-bot-action="menu" onclick="submitTelegramBotAction(this)">Применить меню</button>
                </div>
                <p class="sub" role="status"></p>
            </form>
            <section class="bot-emoji-admin">
                <h4>Каталог премиум-эмодзи</h4>
                <p class="sub">Без ограничения по количеству. Наборы попадают в отдельные группы, по которым можно фильтровать.</p>
                <label class="form-label">ID эмодзи (через пробел) или ссылка на набор <input id="bot-emoji-source" class="field" placeholder="https://t.me/addemoji/… или ID"></label>
                <label class="form-label">Группа (необязательно)<input id="bot-emoji-group" class="field" maxlength="64" placeholder="По умолчанию — название набора"></label>
                <div class="bot-admin-actions">
                    <button type="button" class="secondary" onclick="importBotEmoji(this)">Добавить в каталог</button>
                    <button type="button" class="secondary" onclick="openBotEmojiPicker()">Открыть каталог · <span id="bot-emoji-count">${config.emoji_total ?? botEmojiLibrary.length}</span></button>
                </div>
                <div id="bot-emoji-groups" class="bot-emoji-groups"></div>
            </section>`;
        loadBotEmojiGroups();
        bindBotPhrases(content);
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
            phrases: collectBotPhrases(form),
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
    const input = document.querySelector('#bot-emoji-source'), group = document.querySelector('#bot-emoji-group');
    const value = input.value.trim();
    if (!value || button.disabled) return;
    button.disabled = true;
    try {
        const config = await api('admin/telegram-bot/emoji', {value, group: group.value.trim()});
        if (!input.isConnected) return;
        document.querySelector('#bot-emoji-count').textContent = config.emoji_total;
        input.value = ''; group.value = '';
        toast('Эмодзи добавлены в каталог');
        loadBotEmojiGroups();
    } catch (error) {
        toast(error.message);
    } finally {
        button.disabled = false;
    }
}

async function loadBotEmojiGroups() {
    const box = document.querySelector('#bot-emoji-groups');
    if (!box) return;
    try {
        const data = await api('admin/telegram-bot/emoji-catalog?limit=1');
        if (!box.isConnected) return;
        box.innerHTML = data.groups.map(g => `<span class="bot-egroup"><b>${esc(g.name || 'Без группы')}</b><small>${g.count}</small>
            <button type="button" data-del-group="${esc(g.name)}" aria-label="Удалить группу">×</button></span>`).join('');
        box.querySelectorAll('[data-del-group]').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('Удалить группу «' + b.dataset.delGroup + '» из каталога?')) return;
            try { await api('admin/telegram-bot/emoji/delete', {group: b.dataset.delGroup}); document.querySelector('#bot-emoji-count').textContent = (await api('admin/telegram-bot/emoji-catalog?limit=1')).all; loadBotEmojiGroups(); }
            catch (error) { toast(error.message); }
        }));
    } catch (_) { /* catalog is optional */ }
}

/* Catalog window: search, group filters and endless loading. Inserts [[emoji:ID]] into a textarea or an ID into an input. */
function openBotEmojiPicker(target) {
    const selection = target?.tagName === 'TEXTAREA' ? [target.selectionStart, target.selectionEnd] : null;
    sheet('Премиум-эмодзи', `<div class="bot-catalog"><input class="field bot-catalog-search" type="search" placeholder="Поиск: ID, эмодзи или группа" autocomplete="off">
        <div class="bot-catalog-groups"></div><div class="bot-emoji-picker"></div><p class="sub bot-catalog-note"></p></div>`);
    const root = document.querySelector('.bot-catalog'), grid = root.querySelector('.bot-emoji-picker'), note = root.querySelector('.bot-catalog-note');
    const search = root.querySelector('.bot-catalog-search'), chips = root.querySelector('.bot-catalog-groups');
    let group = '', q = '', offset = 0, total = 0, loading = false, version = 0;
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            if (entry.target.dataset.more) load(false); else paintBotEmojiImage(entry.target);
        }
    }, {root: grid, rootMargin: '200px'});
    async function load(reset) {
        if (loading) return;
        if (reset) { offset = 0; grid.innerHTML = ''; version++; }
        const mine = version;
        loading = true;
        try {
            const data = await api('admin/telegram-bot/emoji-catalog?limit=120&offset=' + offset + '&group=' + encodeURIComponent(group) + '&q=' + encodeURIComponent(q));
            if (mine !== version || !grid.isConnected) return;
            total = data.total;
            if (reset || !chips.children.length) {
                chips.innerHTML = `<button type="button" data-g="" class="${group === '' ? 'is-on' : ''}">Все · ${data.all}</button>` +
                    data.groups.map(g => `<button type="button" data-g="${esc(g.name)}" class="${group === g.name ? 'is-on' : ''}">${esc(g.name || 'Без группы')} · ${g.count}</button>`).join('');
            }
            grid.querySelector('[data-more]')?.remove();
            grid.insertAdjacentHTML('beforeend', data.items.map(item =>
                `<button type="button" data-bot-emoji="${esc(item.id)}" aria-label="Эмодзи ${esc(item.id)}" title="${esc(item.id)}"><span>${esc(item.emoji)}</span></button>`).join(''));
            offset += data.items.length;
            grid.querySelectorAll('button:not([data-seen])').forEach(b => { b.dataset.seen = '1'; observer.observe(b); });
            if (offset < total) { grid.insertAdjacentHTML('beforeend', '<i data-more="1" class="bot-more"></i>'); observer.observe(grid.lastElementChild); }
            note.textContent = total ? 'Найдено: ' + total : 'Ничего не найдено. Добавьте эмодзи в каталог по ссылке на набор.';
        } catch (error) { note.textContent = error.message; }
        finally { loading = false; }
    }
    chips.addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (!b) return; group = b.dataset.g; chips.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b)); load(true); });
    let timer = 0;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(true); }, 250); });
    grid.addEventListener('click', e => {
        const button = e.target.closest('[data-bot-emoji]');
        if (!button || !target?.isConnected) return;
        const id = button.dataset.botEmoji;
        if (selection) target.setRangeText(`[[emoji:${id}]]`, ...selection, 'end'); else target.value = id;
        closeSheet();
        target.dispatchEvent(new Event('input', {bubbles: true}));
    });
    load(true);
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

function phraseCard(p) {
    const styles = [['b', 'Ж'], ['i', 'К'], ['u', 'П'], ['s', 'З'], ['tg-spoiler', 'Спойлер']];
    return `<div class="bot-phrase" data-key="${esc(p.key)}" data-default="${esc(p.default)}">
        <div class="bot-phrase-head"><b>${esc(p.title)}</b><button type="button" class="secondary" data-act="reset">Сбросить</button></div>
        <textarea class="field" rows="3" maxlength="1300" data-role="text">${esc(p.text)}</textarea>
        <div class="bot-phrase-tools">
            ${p.fields.map(f => `<button type="button" class="bot-chip" data-act="field" data-v="{${esc(f)}}">{${esc(f)}}</button>`).join('')}
            ${styles.map(([t, l]) => `<button type="button" class="bot-chip" data-act="style" data-v="${t}">${l}</button>`).join('')}
            <button type="button" class="bot-chip is-emoji" data-act="emoji">😀 Эмодзи</button>
        </div>
        ${p.button ? `<label class="form-label">Кнопка под сообщением<input class="field" maxlength="64" data-role="button" data-bkey="${esc(p.button.key)}" data-bdefault="${esc(p.button.default)}" value="${esc(p.button.text)}"></label>` : ''}
    </div>`;
}
function bindBotPhrases(root) {
    root.querySelectorAll('.bot-phrases').forEach(box => box.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const card = b.closest('.bot-phrase'), area = card.querySelector('[data-role=text]');
        if (b.dataset.act === 'reset') { area.value = card.dataset.default; const btn = card.querySelector('[data-role=button]'); if (btn) btn.value = btn.dataset.bdefault; return; }
        if (b.dataset.act === 'emoji') return openBotEmojiPicker(area);
        const start = area.selectionStart, end = area.selectionEnd;
        if (b.dataset.act === 'field') { area.setRangeText(b.dataset.v, start, end, 'end'); }
        else { const sel = area.value.slice(start, end), open = '<' + b.dataset.v + '>'; area.setRangeText(open + sel + '</' + b.dataset.v + '>', start, end, 'end'); area.setSelectionRange(start + open.length, start + open.length + sel.length); }
        area.focus();
    }));
}
function collectBotPhrases(form) {
    const out = {};
    form.querySelectorAll('.bot-phrase').forEach(card => {
        const text = card.querySelector('[data-role=text]').value.trim();
        out[card.dataset.key] = text === card.dataset.default ? '' : text;
        const btn = card.querySelector('[data-role=button]');
        if (btn) out[btn.dataset.bkey] = btn.value.trim() === btn.dataset.bdefault ? '' : btn.value.trim();
    });
    return out;
}
