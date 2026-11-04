let transferDraft;

function inventoryToolbarAction(action) {
    if (action === 'transfer') return startGiftTransfer();
    if (action === 'craft') return go('craft');
    if (action === 'add') {
        sheet('Добавить подарок', `<div class="gift-deposit-banner">${icon('gift')} ${icon('chevron')} ${icon('market')}</div>
            <p class="sub">Приём подарков из Telegram появится после подключения аккаунта для зачислений.</p>`);
    }
}

function startGiftTransfer(id) {
    transferDraft = {ids:new Set(id ? [id] : []), username:'', recipient:null, anonymous:false, request:null};
    if (id) renderTransferRecipient();
    else renderTransferPicker(true);
}

function transferArt(gift) {
    return `<span class="transfer-art" style="background:${giftBackdrop(gift)}"><img ${giftPicture(gift)} alt="" loading="lazy"></span>`;
}

function renderTransferPicker(first = false) {
    const draft = transferDraft;
    if (!draft || draft.sending) return;
    draft.picking = new Set(draft.ids);
    const inventory = state.inventory.filter(gift => gift.status === 'unlisted');
    sheet('Выберите подарки для отправки', `
        <label class="search-box">${icon('search')}<input placeholder="Быстрый поиск" aria-label="Поиск подарков"></label>
        <div class="transfer-picker-list"></div>
        <div class="transfer-actions"><button class="secondary" onclick="${first ? 'closeSheet()' : 'renderTransferRecipient()'}">Отмена</button>
        <button class="primary" id="transfer-picker-apply" onclick="applyTransferPicker()">Выбрать</button></div>`);
    const panel = document.querySelector('#sheet-body');
    const input = panel.querySelector('input');
    const list = panel.querySelector('.transfer-picker-list');
    const paint = () => {
        const query = input.value.trim().toLowerCase();
        const visible = inventory.filter(gift => (gift.name + ' ' + gift.number + ' ' + (gift.model || '')).toLowerCase().includes(query));
        list.innerHTML = visible.map(gift => `<label class="transfer-option">
            ${transferArt(gift)}<span><b>${esc(gift.name)}</b><small>#${esc(gift.number)} · ${esc(productFloor(gift))}</small></span>
            <input type="checkbox" value="${esc(gift.id)}" ${draft.picking.has(gift.id) ? 'checked' : ''}>
        </label>`).join('') || '<p class="sub">Подходящих подарков нет</p>';
    };
    input.addEventListener('input', paint);
    list.addEventListener('change', event => {
        const input = event.target;
        if (!input.matches('input[type=checkbox]')) return;
        if (input.checked && draft.picking.size >= 100) {
            input.checked = false;
            toast('Можно выбрать до 100 подарков');
            return;
        }
        if (input.checked) draft.picking.add(input.value);
        else draft.picking.delete(input.value);
        paintTransferPickerButton();
    });
    paint();
    paintTransferPickerButton();
}

function paintTransferPickerButton() {
    const count = transferDraft.picking.size;
    const button = document.querySelector('#transfer-picker-apply');
    button.disabled = !count;
    button.textContent = count ? 'Выбрать ' + count + ' ' + giftCountWord(count) : 'Выбрать подарки';
}

function applyTransferPicker() {
    transferDraft.ids = transferDraft.picking;
    renderTransferRecipient();
}

function renderTransferRecipient() {
    const draft = transferDraft;
    if (!draft) return;
    const gifts = state.inventory.filter(gift => draft.ids.has(gift.id));
    sheet('Получатель подарков', `
        <p class="sub">Введите имя пользователя Telegram.</p>
        <div class="transfer-summary"><span>Выбранные подарки</span><b>${money(cartTotal(gifts))} GRAM · ${gifts.length} ${giftCountWord(gifts.length)}</b></div>
        <div class="transfer-thumbs">${gifts.map(gift => `<div class="transfer-selected">${transferArt(gift)}<b>#${esc(gift.number)}</b>
            <button type="button" onclick="transferDraft.ids.delete(${arg(gift.id)});renderTransferRecipient()" aria-label="Убрать подарок">×</button></div>`).join('')}
            <button class="circle" onclick="renderTransferPicker()" aria-label="Добавить подарки">${icon('plus')}</button></div>
        <label class="search-box transfer-user"><span>@</span><input id="transfer-username" value="${esc(draft.username)}" maxlength="33" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Имя пользователя Telegram" aria-label="Имя пользователя Telegram"></label>
        <div id="transfer-recipient"></div>
        <label class="transfer-anonymous"><input type="checkbox" ${draft.anonymous ? 'checked' : ''} onchange="transferDraft.anonymous=this.checked"> Отправить анонимно</label>
        <div class="transfer-actions"><button class="secondary" onclick="closeSheet()">Назад</button>
        <button class="primary" id="transfer-send" onclick="submitGiftTransfer()" disabled>Отправить ${gifts.length} ${giftCountWord(gifts.length)}</button></div>
        <p class="sub" id="transfer-status" role="status">Проверьте имя перед отправкой.</p>`);
    const input = document.querySelector('#transfer-username');
    let timer;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        draft.username = input.value.trim().replace(/^@/, '');
        draft.recipient = null;
        paintTransferRecipient(null);
        if (/^[a-z0-9_]{3,32}$/i.test(draft.username)) timer = setTimeout(() => findTransferRecipient(input, draft), 300);
    });
    if (draft.recipient) paintTransferRecipient(draft.recipient);
    else if (draft.username) findTransferRecipient(input, draft);
}

async function findTransferRecipient(input, draft) {
    const query = draft.username;
    try {
        const data = await api('inventory/recipient?username=' + encodeURIComponent(query));
        if (input.isConnected && draft === transferDraft && query === draft.username) paintTransferRecipient(data.recipient, true);
    } catch (error) {
        if (input.isConnected && query === draft.username) document.querySelector('#transfer-status').textContent = error.message;
    }
}

function paintTransferRecipient(recipient, searched = false) {
    const draft = transferDraft;
    const node = document.querySelector('#transfer-recipient');
    const chosen = recipient && draft.recipient?.id === recipient.id;
    node.innerHTML = recipient ? `<button class="transfer-match ${chosen ? 'selected' : ''}" type="button"><b>${esc(recipient.name || recipient.username)}</b>
        <small>@${esc(recipient.username)}</small>${chosen ? icon('check') : ''}</button>` : searched ? '<p class="sub">Пользователь не найден в Crafter</p>' : '';
    if (recipient) node.firstElementChild.onclick = () => {
        draft.recipient = recipient;
        paintTransferRecipient(recipient);
    };
    document.querySelector('#transfer-send').disabled = !chosen || !draft.ids.size || draft.sending;
}

async function submitGiftTransfer() {
    const draft = transferDraft;
    if (!draft?.recipient || !draft.ids.size || draft.sending) return;
    const ids = [...draft.ids].sort();
    const key = [draft.recipient.id, draft.anonymous, ...ids].join('|');
    if (draft.request?.key !== key) draft.request = {key, id:paymentRequestId('crafter-gift-transfer:' + Date.now() + ':' + key)};
    const panel = document.querySelector('#transfer-status');
    draft.sending = true;
    paintTransferRecipient(draft.recipient);
    try {
        await api('inventory/transfer', {gift_ids:ids, recipient_id:draft.recipient.id, username:draft.recipient.username,
            anonymous:draft.anonymous, request_id:draft.request.id});
        state.inventory = state.inventory.filter(gift => !ids.includes(gift.id));
        if (draft === transferDraft) closeSheet();
        if (state.page === 'gifts') await renderGifts();
        toast('Подарки отправлены');
    } catch (error) {
        if (panel.isConnected) panel.textContent = error.message;
    } finally {
        draft.sending = false;
        if (panel.isConnected && transferDraft === draft) paintTransferRecipient(draft.recipient);
    }
}

async function renderGiftHistory(body) {
    let items;
    try {
        ({items} = await api('history'));
    } catch (error) {
        if (body.isConnected) body.textContent = error.message;
        return;
    }
    if (!body.isConnected) return;
    const labels = {buy:'Покупка', craft:'Крафт', sell:'Выставлено', unlist:'Снято с продажи',
        withdraw:'Вывод подарка', gift_granted:'Подарок получен', deposit:'Пополнение',
        withdraw_request:'Заявка на вывод', balance_adjustment:'Корректировка баланса'};
    body.innerHTML = `<label class="search-box">${icon('search')}<input placeholder="Поиск по истории" aria-label="Поиск по истории"></label>
        <div class="gift-history-filters"><select aria-label="Тип операции"><option value="">Все операции</option>
        <option value="gift_received">Полученные</option><option value="transfer">Отправленные</option></select>
        <select aria-label="Порядок по дате"><option value="recent">Сначала новые</option><option value="older">Сначала старые</option></select></div>
        <div class="activity-feed"></div>`;
    const feed = body.querySelector('.activity-feed');
    const [search, type, order] = body.querySelectorAll('input, select');
    const paint = () => {
        const gifts = [];
        let lastDay = '';
        const query = search.value.trim().toLowerCase();
        const filtered = items.filter(entry => !type.value || type.value === entry.kind);
        if (order.value === 'older') filtered.reverse();
        feed.innerHTML = filtered.map(entry => {
            const {data, kind} = entry;
            const day = new Date(entry.created * 1000).toLocaleDateString('ru-RU', {day:'numeric',month:'long',year:'numeric'});
            const heading = day === lastDay ? '' : '<h3>' + esc(day) + '</h3>';
            const list = data.gifts || [data.gift || (data.name ? data : null)];
            const who = kind === 'transfer' ? data.recipient : data.sender;
            const direction = kind === 'transfer' ? 'To' : kind === 'gift_received' ? 'From' : '';
            const name = typeof who === 'string' ? who : who?.username ? '@' + who.username : who?.name || 'Анонимно';
            const rows = list.filter(gift => !query || [
                gift?.name, gift?.number, name, labels[kind],
            ].some(value => String(value || '').toLowerCase().includes(query))).map(gift => {
                const index = gift ? gifts.push(gift) - 1 : null;
                const row = `${gift ? transferArt(gift) : icon('gift')}<span><b>${esc(gift?.name || labels[kind] || 'Операция')}</b>
                    <small>${kind === 'transfer' ? 'Подарок отправлен' : kind === 'gift_received' ? 'Подарок получен' : esc(labels[kind] || '')}</small></span>
                    <span>${direction ? direction + ' <strong>' + esc(name) + '</strong>' : ''}</span>`;
                return gift ? `<button class="market-activity-row gift-history-row" data-history-gift="${index}">${row}</button>` :
                    `<div class="market-activity-row gift-history-row">${row}</div>`;
            }).join('');
            if (rows) lastDay = day;
            return rows ? heading + rows : '';
        }).join('') || '<p class="sub">История пуста</p>';
        feed.querySelectorAll('[data-history-gift]').forEach(button => {
            button.onclick = () => showGiftDetail(gifts[Number(button.dataset.historyGift)], 'history');
        });
    };
    search.addEventListener('input', paint);
    type.addEventListener('change', paint);
    order.addEventListener('change', paint);
    paint();
}
