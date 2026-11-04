const RESALE_LIMIT = 30;
let resaleDraft;

function resaleMarketTabs() {
    const active = state.marketSource || 'portals';
    return `<div class="resale-market-tabs" aria-label="Источник лотов">
        <button type="button" aria-pressed="${active === 'portals'}" onclick="selectResaleMarket('portals')">Portals</button>
        <button type="button" aria-pressed="${active === 'crafter'}" onclick="selectResaleMarket('crafter')">Своя продажа</button>
    </div>`;
}

function selectResaleMarket(source) {
    if ((state.marketSource || 'portals') === source) return;
    state.marketSource = source;
    state.marketUnit = 'GRAM';
    go('market');
}

function openListedInventory() {
    closeSheet();
    state.inventoryTab = 'gifts';
    state.inventoryStatus = 'listed';
    go('gifts');
}

function eligibleResaleGifts(action) {
    const status = action === 'sell' ? 'unlisted' : 'listed';
    return state.inventory.filter(gift => gift.status === status && !gift.catalog_only);
}

function startResale(action, giftId) {
    if (resaleDraft?.saving) return;
    const inventory = eligibleResaleGifts(action);
    if (!inventory.length) return toast(action === 'sell' ? 'Нет подарков для продажи' : 'Нет выставленных подарков');
    const gift = inventory.find(item => item.id === giftId);
    if (giftId && !gift) return toast('Подарок уже недоступен');
    resaleDraft = {action, ids: new Set(giftId ? [giftId] : []), prices: new Map(), saving: false};
    if (action === 'edit') resaleDraft.prices.set(giftId, String(gift.listing_price ?? gift.price));
    if (giftId) renderResaleEditor();
    else openResalePicker();
}

function openResalePicker() {
    const draft = resaleDraft;
    renderInventoryPicker({
        title: draft.action === 'sell' ? 'Выбранные подарки для продажи' : 'Выберите подарки для снятия',
        inventory: eligibleResaleGifts(draft.action),
        ids: draft.ids,
        limit: RESALE_LIMIT,
        onCancel: draft.ids.size ? renderResaleEditor : closeSheet,
        onApply: ids => {
            draft.ids = ids;
            renderResaleEditor();
        },
    });
}

function resalePriceCents(value) {
    if (!/^[0-9]{1,7}(?:[.,][0-9]{1,2})?$/.test(value)) return 0;
    const [units, decimal = ''] = value.split(/[.,]/);
    const cents = Number(units) * 100 + Number(decimal.padEnd(2, '0'));
    return cents <= 100000000 ? cents : 0;
}

function renderResaleEditor() {
    const draft = resaleDraft;
    const gifts = eligibleResaleGifts(draft.action).filter(gift => draft.ids.has(gift.id));
    const unlist = draft.action === 'unlist';
    const edit = draft.action === 'edit';
    const title = unlist ? 'Снять с продажи подарки' : edit ? 'Редактировать цену' : 'Введите цены на подарки';
    sheet(title, `<div class="resale-editor">
        <div class="resale-editor-scroll">
            ${unlist ? '<p class="resale-hint">Подарки вернутся в «Не выставленные».</p>' : ''}
            ${gifts.map(gift => `<article class="resale-editor-card" data-resale-card="${esc(gift.id)}">
                ${edit ? '' : `<button type="button" class="resale-remove" data-resale-remove="${esc(gift.id)}" aria-label="Убрать подарок">×</button>`}
                <div class="resale-editor-top">
                    ${transferArt(gift)}<span><b>${esc(gift.name)}</b><small>#${esc(gift.number)}</small></span>
                    ${unlist ? `<span class="resale-current-price"><b>${money(gift.listing_price ?? gift.price)} GRAM</b><small>Цена</small></span>` :
                        `<input class="resale-price" type="text" inputmode="decimal" maxlength="10" placeholder="Цена"
                            aria-label="Цена в GRAM для ${esc(gift.name)}" data-resale-price="${esc(gift.id)}" value="${esc(draft.prices.get(gift.id) || '')}">`}
                </div>
                <div class="resale-reference"><span>Мин. цена</span><b>${esc(productFloor(gift))}</b></div>
                ${[['models','model'], ['backdrops','backdrop'], ['symbols','symbol']].filter(([, key]) => gift[key]).map(([group, key]) => {
                    const rarity = Number(gift.rarity?.[key]);
                    return `<div class="resale-trait" data-group="${group}" data-trait="${esc(gift[key])}">
                        <span>${esc(gift[key])} <small data-picker-rarity ${rarity > 0 ? '' : 'hidden'}>${rarity > 0 ? money(rarity / 10) + '%' : ''}</small></span>
                        <b data-picker-price>—</b>
                    </div>`;
                }).join('')}
            </article>`).join('')}
            ${edit ? '' : '<button type="button" class="resale-add" data-resale-add>Добавить больше подарков <b>+</b></button>'}
        </div>
        <div class="resale-editor-footer">
            ${unlist ? '' : `<div class="resale-fee"><span>Комиссия маркета (4%)</span><b><span data-resale-fee>0</span> ${gramIcon()}</b></div>`}
            <p class="resale-error" role="alert" hidden></p>
            <button type="button" class="primary resale-confirm" disabled>
                <b data-resale-label></b><small data-resale-subtitle></small>
            </button>
        </div>
    </div>`);
    appSheet.classList.add('resale-editor-sheet');
    const editor = appSheet.querySelector('.resale-editor');
    const cards = new Map([...editor.querySelectorAll('[data-resale-card]')].map(card => [card.dataset.resaleCard, card]));
    const estimates = new Map();
    for (const gift of gifts) {
        const key = gift.collection_id || gift.name;
        if (!estimates.has(key)) {
            estimates.set(key, Promise.resolve(state.catalogReady).then(() => giftAttributes(gift)).catch(() => null));
        }
        estimates.get(key).then(data => paintTransferTraits(cards.get(gift.id), data));
    }
    const confirm = editor.querySelector('.resale-confirm');
    const error = editor.querySelector('.resale-error');
    const update = () => {
        const amounts = gifts.map(gift => resalePriceCents(String(unlist ? (gift.listing_price ?? gift.price) : (draft.prices.get(gift.id) || ''))));
        const sum = amounts.reduce((total, price) => total + price, 0);
        const fee = unlist ? 0 : amounts.reduce((total, price) => total + Math.floor((price * 4 + 50) / 100), 0);
        if (!unlist) editor.querySelector('[data-resale-fee]').textContent = money(fee / 100);
        const count = gifts.length + ' ' + giftCountWord(gifts.length);
        editor.querySelector('[data-resale-label]').textContent = unlist ? 'Снять с продажи ' + count :
            edit ? 'Сохранить цену' : 'Продать ' + (gifts.length === 1 ? 'подарок' : count);
        editor.querySelector('[data-resale-subtitle]').textContent = unlist ? 'Общая цена: ' + money(sum / 100) + ' GRAM' :
            'Вы получаете ' + money((sum - fee) / 100) + ' GRAM';
        confirm.disabled = draft.saving || !gifts.length || (!unlist && amounts.some(price => !price));
    };
    editor.querySelectorAll('[data-resale-price]').forEach(input => {
        input.oninput = () => {
            draft.prices.set(input.dataset.resalePrice, input.value);
            error.hidden = true;
            update();
        };
    });
    editor.querySelectorAll('[data-resale-remove]').forEach(button => {
        button.onclick = () => {
            if (draft.saving) return;
            draft.ids.delete(button.dataset.resaleRemove);
            if (draft.ids.size) renderResaleEditor();
            else openResalePicker();
        };
    });
    const add = editor.querySelector('[data-resale-add]');
    if (add) add.onclick = () => { if (!draft.saving) openResalePicker(); };
    confirm.onclick = async () => {
        if (draft.saving) return;
        draft.saving = true;
        error.hidden = true;
        update();
        try {
            const items = gifts.map(gift => ({id:gift.id, ...(unlist ? {} : {price:draft.prices.get(gift.id)})}));
            await api('resale/listings', {action:draft.action, items});
        } catch (e) {
            error.textContent = e.message;
            error.hidden = false;
            draft.saving = false;
            update();
            return;
        }
        draft.saving = false;
        if (editor.isConnected) closeSheet();
        if (state.page === 'gifts') {
            state.inventoryStatus = unlist ? 'unlisted' : 'listed';
            await go('gifts');
        }
        toast(unlist ? 'Подарки сняты с продажи' : edit ? 'Цена обновлена' : 'Лоты появились в «Своей продаже»');
    };
    update();
}
