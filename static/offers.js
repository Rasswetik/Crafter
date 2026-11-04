const offerExpiries = [['day','24 часа'], ['week','7 дней'], ['none','Бессрочно']];
const offerTraits = [['model','Модель','models'], ['backdrop','Фон','backdrops'], ['symbol','Символ','symbols']];
let offerDraft;
let offerInboxTab = 'received';
let offerActionPending = false;

function offerAmount(value) {
    return Number(value || 0).toLocaleString('ru-RU', {maximumFractionDigits:9});
}

async function openOfferDraft(collection) {
    return showOfferForm({collection, expiry:'none', quantity:1, price:'', traits:{
        model:state.model || '', backdrop:state.backdrop || '', symbol:state.symbol || '',
    }});
}

function openPersonalOffer() {
    const gift = state.detailGift;
    if (!gift || gift.own_listing) return;
    return showOfferForm({gift, expiry:'none', quantity:1, price:'', traits:{}});
}

async function showOfferForm(draft) {
    offerDraft = draft;
    const gift = draft.gift;
    const collection = draft.collection;
    const enabled = Boolean(collection || gift?.resale);
    // The offer editor replaces the gift viewer instead of stacking on it.
    // Closing or submitting the offer must leave the user on the market.
    if (gift) state.detailGift = null;
    sheet(gift ? 'Ваше предложение' : 'Создать оффер', `<form class="offer-draft offer-trading-form">
        ${gift ? `<div class="offer-gift-summary">${transferArt(gift)}
            <span><b>${esc(gift.name)}</b><small>#${esc(gift.number)}</small></span>
            <span><b>${money(gift.price)} GRAM</b><small>Цена подарка</small></span>
        </div>` : `<div><b>Коллекция</b><p>${esc(collection.name)}</p></div>`}
        <div class="offer-expiry-block"><b>Окончание оффера</b><div class="segment offer-expiries">
            ${offerExpiries.map(([value,label]) => `<button type="button" class="${draft.expiry === value ? 'selected' : ''}"
                data-expiry="${value}" aria-pressed="${draft.expiry === value}">${label}</button>`).join('')}
        </div></div>
        <label>Цена <span class="offer-price-row"><input name="price" inputmode="decimal" maxlength="10" placeholder="Введите цену в GRAM" value="${esc(draft.price)}">
            ${gift ? '<button type="button" data-discount="95">−5%</button><button type="button" data-discount="90">−10%</button>' : ''}</span></label>
        ${collection ? `<label>Количество <input name="quantity" type="number" min="1" max="30" step="1" value="${draft.quantity}"></label>
            <div class="offer-draft-attributes"><b>Атрибуты</b>
                ${offerTraits.map(([key,label]) => `<button type="button" data-offer-trait="${key}">
                    <span>${label}</span><b>${esc(draft.traits[key] || 'Любой')} ›</b></button>`).join('')}
            </div><dialog class="transfer-filter-dialog" aria-labelledby="transfer-filter-title"></dialog>` : ''}
        <div class="offer-draft-summary"><span>Сумма оффера</span><b data-offer-total>0 GRAM</b></div>
        <div class="offer-draft-summary"><span>Комиссия за отправку</span><b data-offer-fee>0,01 TON</b></div>
        <div class="offer-draft-summary"><span>Доступный баланс</span><b data-offer-balance>—</b></div>
        <p class="offer-form-error" role="status">${enabled ? '' : 'Этот лот выставлен на Portals. Внутренний оффер доступен для лотов Craft Market.'}</p>
        <button type="submit" class="primary" disabled>${gift ? 'Отправить оффер' : 'Создать оффер'}</button>
    </form>`);
    appSheet.classList.add('offer-sheet');
    const form = appSheet.querySelector('.offer-trading-form');
    const submit = form.querySelector('[type=submit]');
    const error = form.querySelector('.offer-form-error');
    const update = () => {
        draft.price = form.elements.price.value;
        draft.quantity = collection ? Number(form.elements.quantity.value) : 1;
        const cents = resalePriceCents(draft.price);
        const validQuantity = Number.isInteger(draft.quantity) && draft.quantity >= 1 && draft.quantity <= 30;
        const total = validQuantity ? cents * draft.quantity / 100 : 0;
        form.querySelector('[data-offer-total]').textContent = money(total) + ' GRAM';
        submit.disabled = !enabled || !draft.info || draft.saving || !validQuantity || !cents ||
            total + Number(draft.info?.fee_gram || 0) > Number(draft.info?.balance || 0) + 1e-9;
    };
    form.oninput = update;
    form.querySelectorAll('[data-expiry]').forEach(button => {
        button.onclick = () => {
            draft.expiry = button.dataset.expiry;
            form.querySelectorAll('[data-expiry]').forEach(option => {
                const active = option === button;
                option.classList.toggle('selected', active);
                option.setAttribute('aria-pressed', String(active));
            });
        };
    });
    form.querySelectorAll('[data-discount]').forEach(button => {
        button.onclick = () => {
            form.elements.price.value = (Number(gift.price) * Number(button.dataset.discount) / 100).toFixed(2);
            update();
        };
    });
    if (collection) {
        const attributes = giftAttributes({collection_id:collection.id, name:collection.name}).catch(() => null);
        form.querySelectorAll('[data-offer-trait]').forEach(button => {
            button.onclick = async () => {
                const key = button.dataset.offerTrait;
                const [, label, group] = offerTraits.find(trait => trait[0] === key);
                const data = await attributes;
                if (!form.isConnected || !appSheet.open) return;
                const items = new Map((data?.[group] || state.marketFacets?.[key] || []).filter(item => item.name).map(item => [item.name, {
                    ...item, name:item.name, image:item.image_url || item.image, model:key === 'model' ? item.name : '',
                }]));
                if (draft.traits[key] && !items.has(draft.traits[key])) items.set(draft.traits[key], {name:draft.traits[key]});
                openTransferFilter(form.querySelector('dialog'), key, label, items, draft.traits[key] ? [draft.traits[key]] : [], selected => {
                    draft.traits[key] = [...selected][0] || '';
                    button.querySelector('b').textContent = (draft.traits[key] || 'Любой') + ' ›';
                });
            };
        });
    }
    form.onsubmit = async event => {
        event.preventDefault();
        if (submit.disabled) return;
        draft.saving = true;
        error.textContent = '';
        update();
        const payload = {
            price:draft.price, quantity:draft.quantity, expiry:draft.expiry,
            expected_fee_gram:draft.info.fee_gram,
            ...(gift ? {lot_id:gift.id} : {collection:collection.name, ...draft.traits}),
        };
        const signature = JSON.stringify(payload);
        if (draft.request?.signature !== signature) {
            draft.request = {signature, id:paymentRequestId('offer:' + state.me.user.id + ':' + signature + ':' + Date.now())};
        }
        try {
            const result = await api('offers', {...payload, request_id:draft.request.id});
            state.me.balance = result.balance;
            updateBalance();
            offerCache.clear();
            if (offerDraft === draft && form.isConnected) closeSheet();
            toast('Оффер отправлен');
        } catch (e) {
            if (form.isConnected) error.textContent = e.message;
        } finally {
            draft.saving = false;
            if (form.isConnected) update();
        }
    };
    try {
        draft.info = await api('offers');
        if (!form.isConnected) return;
        form.querySelector('[data-offer-fee]').textContent = '0,01 TON · ' + offerAmount(draft.info.fee_gram) + ' GRAM';
        form.querySelector('[data-offer-balance]').textContent = offerAmount(draft.info.balance) + ' GRAM';
        update();
    } catch (e) {
        if (form.isConnected && enabled) error.textContent = e.message;
    }
}

const offerStateLabels = {
    active:'Активен', accepted:'Принят', declined:'Отклонён', withdrawn:'Отозван', expired:'Истёк', closed:'Лот закрыт',
};

async function renderOffersInbox(body) {
    body.innerHTML = crafterLoading('offers');
    let data;
    try {
        data = await api('offers');
    } catch (e) {
        if (body.isConnected) body.innerHTML = `<p class="error">${esc(e.message)}</p>`;
        return;
    }
    if (!body.isConnected) return;
    state.me.balance = data.balance;
    updateBalance();
    const tabs = [['received','Получено'], ['placed','Размещено'], ['collections','Коллекции']];
    const paint = () => {
        // Only ongoing offers belong in these tabs; settled ones remain in history.
        const list = (data[offerInboxTab] || []).filter(item => item.status === 'active');
        body.innerHTML = `<div class="segment offer-inbox-tabs">${tabs.map(([key,label]) =>
            `<button type="button" data-offer-tab="${key}" class="${key === offerInboxTab ? 'selected' : ''}">
                ${label} <span>${data[key].filter(item => item.status === 'active').length}</span></button>`).join('')}</div>
            <div class="offer-inbox-list">${list.length ? list.map(offer => `<article class="offer-inbox-card">
                <div class="offer-gift-summary">${transferArt(offer.gift)}
                    <span><b>${esc(offer.gift.name)}</b><small>${offer.gift.number ? '#' + esc(offer.gift.number) : esc([offer.model,offer.backdrop,offer.symbol].filter(Boolean).join(' · '))}</small></span>
                    <span><b>${money(offer.price)} GRAM</b><small>${offerStateLabels[offer.status] || ''}${offer.quantity > 1 ? ' · ' + offer.remaining + ' / ' + offer.quantity : ''}</small></span>
                </div>
                ${offer.status === 'active' ? `<div class="offer-inbox-actions">
                    ${offerInboxTab === 'received' ? `<button type="button" class="secondary" data-offer-action="decline" data-id="${esc(offer.id)}">Отклонить</button>
                        <button type="button" class="primary" data-offer-action="accept" data-id="${esc(offer.id)}">Принять</button>` :
                        `<button type="button" class="secondary" data-offer-action="withdraw" data-id="${esc(offer.id)}">Отозвать</button>`}
                </div>` : ''}
            </article>`).join('') : '<p class="offer-empty">Офферов пока нет</p>'}</div>`;
        body.querySelectorAll('[data-offer-tab]').forEach(button => {
            button.onclick = () => {offerInboxTab = button.dataset.offerTab;paint();};
        });
        body.querySelectorAll('[data-offer-action]').forEach(button => {
            button.onclick = () => {
                const offer = list.find(item => item.id === button.dataset.id);
                confirmOfferAction(offer, button.dataset.offerAction, body);
            };
        });
    };
    paint();
}

function confirmOfferAction(offer, action, body) {
    const labels = {accept:'Принять оффер', decline:'Отклонить оффер', withdraw:'Отозвать оффер'};
    const text = action === 'accept' ? 'Вы получаете ' + money((resalePriceCents(offer.price) -
        Math.floor((resalePriceCents(offer.price) * 4 + 50) / 100)) / 100) + ' GRAM после комиссии 4%.' :
        'Сумма оффера вернётся покупателю. Комиссия за отправку удерживается.';
    sheet(labels[action], `<p class="sub">${text}</p><button type="button" class="primary" data-confirm-offer>${labels[action]}</button>`);
    const button = appSheet.querySelector('[data-confirm-offer]');
    button.onclick = () => performOfferAction(offer.id, action, {button, body});
}

async function performOfferAction(id, action, {button, body, giftId} = {}) {
    if (offerActionPending) return;
    offerActionPending = true;
    if (button) button.disabled = true;
    try {
        const data = await api('offers/' + encodeURIComponent(id) + '/action', {action, ...(giftId ? {gift_id:giftId} : {})});
        state.me.balance = data.balance;
        updateBalance();
        offerCache.clear();
        closeSheet();
        if (body?.isConnected) await renderOffersInbox(body);
        else if (state.page === 'market') changedFilter();
        toast(({accept:'Оффер принят', decline:'Оффер отклонён', withdraw:'Оффер отозван'})[action]);
    } catch (e) {
        toast(e.message);
    } finally {
        offerActionPending = false;
        if (button?.isConnected) button.disabled = false;
    }
}

async function acceptCollectionOffer(collection, offer) {
    if (!offer?.executable) return;
    try {
        const {gifts} = await api('inventory');
        const matching = gifts.filter(gift => ['unlisted','listed'].includes(gift.status) && !gift.catalog_only &&
            giftCollectionSlug(gift.name) === giftCollectionSlug(collection.name) &&
            offerTraits.every(([key]) => !offer[key] || offer[key].toLowerCase() === String(gift[key] || '').toLowerCase()));
        if (!matching.length) return toast('У вас нет подходящего подарка');
        renderInventoryPicker({title:'Выберите подарок для продажи', inventory:matching, ids:new Set(), limit:1,
            onCancel:closeSheet, onApply:ids => {
                const giftId = [...ids][0];
                const proceeds = resalePriceCents(offer.price_gram) - Math.floor((resalePriceCents(offer.price_gram) * 4 + 50) / 100);
                sheet('Продать по офферу', `<p class="sub">Вы получаете ${money(proceeds / 100)} GRAM после комиссии 4%.</p>
                    <button type="button" class="primary" data-confirm-offer>Подтвердить</button>`);
                const button = appSheet.querySelector('[data-confirm-offer]');
                button.onclick = () => performOfferAction(offer.id, 'accept', {button, giftId});
            },
        });
    } catch (e) { toast(e.message); }
}
