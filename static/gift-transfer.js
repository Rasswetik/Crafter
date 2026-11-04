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

const transferPickerTraits = [['name','Коллекция'], ['model','Модель'], ['backdrop','Фон'], ['symbol','Символ']];
const TRANSFER_LIMIT = 100;

function transferPickerRow(gift, index, checked) {
    const traits = [['model', 'models', gift.model], ['backdrop', 'backdrops', gift.backdrop]];
    return `<label class="transfer-option" data-picker-index="${index}">
        <span class="transfer-option-top">
            ${transferArt(gift)}
            <span class="transfer-option-name"><b>${esc(gift.name)}</b><small>${gift.number ? '#' + esc(gift.number) : ''}</small></span>
            <input class="transfer-checkbox" type="checkbox" value="${esc(gift.id)}" aria-label="Выбрать ${esc(gift.name)}" ${checked ? 'checked' : ''}>
        </span>
        <span class="transfer-option-details">
            <span class="transfer-detail"><span>Мин. цена</span><b>${esc(productFloor(gift))}</b></span>
            ${traits.filter(([, , name]) => name).map(([key, group, name]) => {
                const rarity = Number(gift.rarity?.[key]);
                return `<span class="transfer-detail transfer-trait" data-group="${group}" data-trait="${esc(name)}">
                    <span>${esc(name)} <small data-picker-rarity ${rarity > 0 ? '' : 'hidden'}>${rarity > 0 ? money(rarity / 10) + '%' : ''}</small></span>
                    <b data-picker-price>—</b>
                </span>`;
            }).join('')}
        </span>
    </label>`;
}

function renderTransferPicker(first = false) {
    const draft = transferDraft;
    if (!draft || draft.sending) return;
    const inventory = state.inventory.filter(gift => gift.status === 'unlisted');
    draft.picking = new Set(inventory.filter(gift => draft.ids.has(gift.id)).map(gift => gift.id));
    sheet('Выберите подарки для отправки', `
        <div class="transfer-picker-controls">
            <label class="search-box">${icon('search')}<input type="search" placeholder="Быстрый поиск" aria-label="Поиск подарков"></label>
            <div class="filter-strip transfer-filter-strip">
                <button type="button" class="sort" data-picker-reset aria-label="Сбросить фильтры">${icon('filter')}</button>
                <button type="button" class="sort" data-picker-sort aria-label="Сортировать по цене" aria-pressed="false">${icon('sortOrder')}</button>
                <span class="filter-divider"></span>
                ${transferPickerTraits.map(([key, label]) => `<button type="button" class="filter-chip transfer-filter-chip"
                    data-picker-filter="${key}" aria-haspopup="dialog">${label}${icon('chevron')}</button>`).join('')}
            </div>
            <div class="transfer-select-tools">
                <label><input class="transfer-checkbox" type="checkbox" data-picker-all> Выбрать всё <small data-picker-count></small></label>
                <button type="button" data-picker-clear>Снять выделение</button>
            </div>
        </div>
        <div class="transfer-picker-list"></div>
        <dialog class="transfer-filter-dialog" aria-labelledby="transfer-filter-title"></dialog>
        <div class="transfer-actions transfer-picker-footer"><button class="secondary" onclick="${first ? 'closeSheet()' : 'renderTransferRecipient()'}">Отмена</button>
        <button class="primary" id="transfer-picker-apply" onclick="applyTransferPicker()">Выбрать</button></div>`);
    const dialog = document.querySelector('#sheet');
    dialog.classList.add('transfer-picker-sheet');
    const panel = document.querySelector('#sheet-body');
    const input = panel.querySelector('input[type=search]');
    const list = panel.querySelector('.transfer-picker-list');
    const filterButtons = [...panel.querySelectorAll('[data-picker-filter]')];
    const filterDialog = panel.querySelector('.transfer-filter-dialog');
    const filters = new Map();
    const all = panel.querySelector('[data-picker-all]');
    const clear = panel.querySelector('[data-picker-clear]');
    const sortButton = panel.querySelector('[data-picker-sort]');
    const count = panel.querySelector('[data-picker-count]');
    const apply = panel.querySelector('#transfer-picker-apply');
    const attributes = new Map();
    let observer, sort = false, visible = [];

    const paintSelection = () => {
        const selected = visible.filter(gift => draft.picking.has(gift.id)).length;
        all.disabled = !visible.length;
        all.checked = !!selected && selected === visible.length;
        all.indeterminate = selected > 0 && !all.checked;
        clear.disabled = !draft.picking.size;
        clear.textContent = 'Снять выделение' + (draft.picking.size ? ' · ' + draft.picking.size : '');
        count.textContent = '· ' + visible.length;
        apply.disabled = !draft.picking.size;
        apply.textContent = draft.picking.size ? 'Выбрать ' + draft.picking.size + ' ' + giftCountWord(draft.picking.size) : 'Выбрать подарки';
    };

    const paint = () => {
        const query = input.value.trim().toLowerCase();
        visible = inventory.filter(gift =>
            [...filters].every(([key, values]) => values.has(gift[key])) &&
            [gift.name, gift.number, gift.model, gift.backdrop].some(value => String(value ?? '').toLowerCase().includes(query)));
        if (sort) visible.sort((a,b) => Number(a.floor_price || a.price || 0) - Number(b.floor_price || b.price || 0));
        list.innerHTML = visible.map((gift, index) => transferPickerRow(gift, index, draft.picking.has(gift.id))).join('') ||
            '<p class="sub">Подходящих подарков нет</p>';
        paintSelection();
        observer?.disconnect();
        const observedGifts = visible;
        observer = new IntersectionObserver((entries, activeObserver) => {
            for (const entry of entries) {
                if (!entry.isIntersecting || !entry.target.isConnected) continue;
                activeObserver.unobserve(entry.target);
                const gift = observedGifts[Number(entry.target.dataset.pickerIndex)];
                const key = gift.collection_id || gift.name;
                if (!attributes.has(key)) {
                    attributes.set(key, Promise.resolve(state.catalogReady).then(() => giftAttributes(gift)).catch(() => null));
                }
                attributes.get(key).then(data => paintTransferTraits(entry.target, data));
            }
        }, {root:list});
        list.querySelectorAll('[data-picker-index]').forEach(row => observer.observe(row));
    };

    input.addEventListener('input', paint);
    const paintFilters = () => {
        filterButtons.forEach((button, index) => {
            const [key, label] = transferPickerTraits[index];
            const values = filters.get(key);
            button.classList.toggle('has-value', Boolean(values?.size));
            button.innerHTML = label + (values?.size ? `<span>${values.size}</span>` : '') + icon('chevron');
        });
        list.scrollTop = 0;
        paint();
    };
    filterButtons.forEach((button, index) => {
        const [key, label] = transferPickerTraits[index];
        button.onclick = () => {
            const rows = new Map();
            for (const gift of inventory) {
                if (gift[key] && (key === 'name' || !filters.has('name') || filters.get('name').has(gift.name))) {
                    if (!rows.has(gift[key])) rows.set(gift[key], gift);
                }
            }
            openTransferFilter(filterDialog, key, label, rows, filters.get(key), selected => {
                if (selected.size) filters.set(key, selected);
                else filters.delete(key);
                if (key === 'name') transferPickerTraits.slice(1).forEach(([trait]) => filters.delete(trait));
                paintFilters();
            });
        };
    });
    sortButton.onclick = () => {
        sort = !sort;
        sortButton.setAttribute('aria-pressed', String(sort));
        paint();
    };
    panel.querySelector('[data-picker-reset]').onclick = () => {
        input.value = '';
        filters.clear();
        paintFilters();
    };
    all.onchange = () => {
        if (all.checked) {
            for (const gift of visible) {
                if (draft.picking.size >= TRANSFER_LIMIT) break;
                draft.picking.add(gift.id);
            }
            if (visible.some(gift => !draft.picking.has(gift.id))) toast('Можно выбрать до 100 подарков');
        } else {
            visible.forEach(gift => draft.picking.delete(gift.id));
        }
        list.querySelectorAll('input').forEach(box => { box.checked = draft.picking.has(box.value); });
        paintSelection();
    };
    clear.onclick = () => {
        draft.picking.clear();
        list.querySelectorAll('input').forEach(box => { box.checked = false; });
        paintSelection();
    };
    list.addEventListener('change', event => {
        const box = event.target;
        if (!box.matches('input[type=checkbox]')) return;
        if (!box.checked) draft.picking.delete(box.value);
        else if (draft.picking.size < TRANSFER_LIMIT) draft.picking.add(box.value);
        else {
            box.checked = false;
            toast('Можно выбрать до 100 подарков');
        }
        paintSelection();
    });
    dialog.addEventListener('close', () => { observer?.disconnect(); filterDialog.close(); }, {once:true});
    paint();
}

function openTransferFilter(dialog, key, label, rows, selection, apply) {
    const selected = new Set(selection);
    dialog.innerHTML = `<div class="sheet-head"><h2 id="transfer-filter-title">${label}</h2>
        <button type="button" class="close" aria-label="Закрыть">×</button></div>
        <label class="catalog-search search-box">${icon('search')}<input type="search" placeholder="Быстрый поиск" aria-label="Быстрый поиск"></label>
        <div class="catalog-rows"></div>
        <div class="catalog-footer"><button type="button" data-reset>Сбросить</button><button type="button" class="apply">Применить</button></div>`;
    const list = dialog.querySelector('.catalog-rows');
    const input = dialog.querySelector('input');
    const paint = () => {
        const query = input.value.trim().toLocaleLowerCase();
        list.innerHTML = [...rows].sort(([a],[b]) => a.localeCompare(b)).filter(([name]) => name.toLocaleLowerCase().includes(query))
            .map(([name, gift]) => {
                const checked = selected.has(name);
                const art = key === 'backdrop' ? `<span class="catalog-thumb" style="background:${giftBackdrop(gift)}"></span>` :
                    key === 'symbol' ? '' : transferArt(gift);
                return `<button type="button" class="catalog-row" data-value="${esc(name)}" aria-pressed="${checked}">
                    <span class="catalog-check ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</span>${art}<strong>${esc(name)}</strong></button>`;
            }).join('') || '<div class="catalog-empty">Ничего не найдено</div>';
    };
    list.onclick = event => {
        const button = event.target.closest('[data-value]');
        if (!button) return;
        const {value} = button.dataset;
        if (selected.has(value)) selected.delete(value);
        else {
            if (key !== 'name') selected.clear();
            selected.add(value);
        }
        paint();
        [...list.querySelectorAll('button')].find(row => row.dataset.value === value)?.focus({preventScroll:true});
    };
    input.oninput = paint;
    dialog.querySelector('.close').onclick = () => dialog.close();
    dialog.querySelector('[data-reset]').onclick = () => { selected.clear(); paint(); };
    dialog.querySelector('.apply').onclick = () => { dialog.close(); apply(selected); };
    paint();
    dialog.showModal();
}

function paintTransferTraits(row, data) {
    if (!row.isConnected || !data) return;
    for (const trait of row.querySelectorAll('[data-group]')) {
        const {group, trait:name} = trait.dataset;
        const item = data[group]?.find(value => value.name === name);
        const price = Number(item?.stats?.floor) / 1e9;
        if (price > 0) trait.querySelector('[data-picker-price]').textContent = money(price) + ' TON';
        const rarity = Number(item?.rarity_per_mille ?? item?.rarity_permille);
        if (rarity > 0) {
            const badge = trait.querySelector('[data-picker-rarity]');
            badge.textContent = money(rarity / 10) + '%';
            badge.hidden = false;
        }
    }
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
        <div class="transfer-recipient-content">
            <p class="sub">Введите имя пользователя Telegram.</p>
            <div class="transfer-summary"><span>Выбранные подарки</span><b>${money(cartTotal(gifts))} GRAM · ${gifts.length} ${giftCountWord(gifts.length)}</b></div>
            <div class="transfer-preview">
                <div class="transfer-thumbs" tabindex="0" aria-label="Выбранные подарки">${gifts.map(gift => `<div class="transfer-selected">${transferArt(gift)}${gift.number ? `<b>#${esc(gift.number)}</b>` : ''}
                    <button type="button" onclick="removeTransferGift(${arg(gift.id)})" aria-label="Убрать ${esc(gift.name)}${gift.number ? ' #' + esc(gift.number) : ''}">×</button></div>`).join('')}</div>
                <button class="circle transfer-add" onclick="renderTransferPicker()" aria-label="Добавить подарки">${icon('plus')}</button>
            </div>
            <label class="search-box transfer-user"><span aria-hidden="true">@</span><input id="transfer-username" value="${esc(draft.username)}" maxlength="33" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Имя пользователя Telegram" aria-label="Имя пользователя Telegram"></label>
            <div id="transfer-recipient"></div>
            <label class="transfer-anonymous"><input class="transfer-checkbox" type="checkbox" ${draft.anonymous ? 'checked' : ''} onchange="transferDraft.anonymous=this.checked"> Отправить анонимно</label>
        </div>
        <div class="transfer-recipient-footer">
            <div class="transfer-actions"><button class="secondary" onclick="closeSheet()">Назад</button>
            <button class="primary" id="transfer-send" onclick="submitGiftTransfer()" disabled>Отправить ${gifts.length} ${giftCountWord(gifts.length)}</button></div>
            <p class="sub" id="transfer-status" role="status">Проверьте имя перед отправкой.</p>
        </div>`);
    document.querySelector('#sheet').classList.add('transfer-recipient-sheet');
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

function removeTransferGift(id) {
    if (transferDraft.sending) return;
    const scroll = document.querySelector('.transfer-thumbs').scrollLeft;
    transferDraft.ids.delete(id);
    renderTransferRecipient();
    document.querySelector('.transfer-thumbs').scrollLeft = scroll;
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
    const name = recipient?.name || recipient?.username || '';
    const photo = imageURL(recipient?.photo_url);
    node.innerHTML = recipient ? `<button class="transfer-match ${chosen ? 'selected' : ''}" type="button" aria-pressed="${Boolean(chosen)}">
        <span class="transfer-avatar"><span aria-hidden="true">${esc([...name][0]?.toUpperCase() || '•')}</span>${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : ''}</span>
        <span class="transfer-match-name"><b>${esc(name)}</b><small>@${esc(recipient.username)}</small></span>
        ${chosen ? icon('check') : ''}</button>` : searched ? '<p class="sub">Пользователь не найден в Crafter</p>' : '';
    node.querySelector('img')?.addEventListener('error', event => event.currentTarget.remove());
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
    const key = JSON.stringify([draft.recipient.id, draft.anonymous, ids]);
    if (draft.request?.key !== key) draft.request = {key, id:globalThis.crypto?.randomUUID?.() || paymentRequestId('crafter-gift-transfer:' + Date.now() + ':' + ids.join('|'))};
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
            const note = direction && data.message ? `<p class="gift-history-note">${esc(data.message)}</p>` : '';
            return rows ? heading + rows + note : '';
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
