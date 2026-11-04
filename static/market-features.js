const offerCache = new Map();

function collectionMarketContext() {
    const selection = selectedCollections();
    if (state.page !== 'market' || marketActivityVisible() || selection.length !== 1) return null;
    const id = String(selection[0]);
    const collection = state.collectionPage || state.catalog.collections.find(item =>
        [item.id, item.short_name, item.name].some(value => String(value) === id));
    if (collection) return collection;
    const gift = state.gifts.find(item => [item.collection_id, item.name].some(value => String(value) === id));
    return gift ? {id, name:gift.name, photo_url:gift.image} : null;
}

function offerRequest(collection) {
    const params = new URLSearchParams({collection: collection.name});
    for (const key of ['model','backdrop','symbol']) if (state[key]) params.set(key, state[key]);
    const key = params.toString();
    let entry = offerCache.get(key);
    if (!entry || Date.now() - entry.started > 30000) {
        entry = {started:Date.now(), data:null};
        entry.promise = api('market/offers?' + key).then(data => {
            entry.data = data;
            return data;
        }).catch(() => {
            if (offerCache.get(key) === entry) offerCache.delete(key);
            return null;
        });
        offerCache.set(key, entry);
    }
    return entry;
}

function paintCollectionMarketFeatures(grid) {
    const collection = collectionMarketContext();
    const previous = grid.previousElementSibling;
    if (!collection) {
        if (previous?.classList.contains('collection-craft-cta')) previous.remove();
        return;
    }
    const image = imageURL(collection.photo_url) || fragmentCollectionImage(giftCollectionSlug(collection.name));
    const cta = document.createElement('div');
    cta.className = 'collection-craft-cta';
    cta.innerHTML = `${image ? `<img src="${esc(image)}" alt="">` : anvilArt('craft-icon')}
        <strong>Скрафтить ${esc(collection.name)}</strong>
        <button type="button">↗ Крафт</button>`;
    cta.querySelector('button').onclick = () => {
        state.target = {id:collection.id, name:collection.name, image};
        state.quote = null;
        go('craft');
    };
    if (previous?.classList.contains('collection-craft-cta')) previous.replaceWith(cta);
    else grid.before(cta);

    const offer = document.createElement('article');
    offer.className = 'collection-offer-card';
    offer.innerHTML = `<img src="/static/assets/offer-magnate.webp" alt="" width="120" height="120">
        <strong data-best-offer>—</strong><small data-offer-status>Лучшее предложение</small>
        <button type="button" class="offer-sell" disabled>Продай сейчас</button>
        <button type="button" class="offer-open">Офферы <span>0</span></button>`;
    grid.prepend(offer);
    const entry = offerRequest(collection);
    offer.querySelector('.offer-open').onclick = () => openCollectionOffers(collection, entry);
    function paint(data) {
        if (!offer.isConnected || !data) return;
        offer.querySelector('[data-best-offer]').textContent = data.best ? money(data.best.price_gram) + ' GRAM' : '—';
        offer.querySelector('.offer-open span').textContent = data.count;
    }
    if (entry.data) paint(entry.data);
    else entry.promise.then(paint);
}

async function openCollectionOffers(collection, entry) {
    sheet('Топ 10 офферов', '<div class="loader">Загрузка…</div>');
    const loading = appSheet.querySelector('.loader');
    const [data, inventory] = await Promise.all([entry.data || entry.promise, api('inventory').catch(() => null)]);
    if (!appSheet.open || !loading?.isConnected) return;
    const ownedCount = (inventory?.gifts || state.inventory).filter(gift => gift.status === 'unlisted' &&
        (String(gift.collection_id) === String(collection.id) || gift.name === collection.name)).length;
    sheet('Топ 10 офферов', `<div class="collection-offers">
        <div class="offers-summary"><b>${esc(collection.name)}</b><span>${ownedCount} ${giftCountWord(ownedCount)}</span></div>
        <div class="segment offer-kinds" role="group" aria-label="Тип офферов">
            <button type="button" class="selected" data-offer-kind="general">По коллекции</button>
            <button type="button" data-offer-kind="specific">По атрибутам</button>
        </div>
        <div data-offer-rows></div>
        <button type="button" class="primary" data-offer-draft>Создать оффер ＋</button>
    </div>`);
    const root = appSheet.querySelector('.collection-offers');
    const rows = root.querySelector('[data-offer-rows]');
    const paint = kind => {
        const group = data?.[kind] || [];
        rows.innerHTML = group.length ? group.map(offer => `<div class="offer-row">
            <b>${money(offer.price_gram)} GRAM</b>
            <span>${esc([offer.model, offer.backdrop, offer.symbol].filter(Boolean).join(' · '))}</span>
            <small>${offer.quantity} шт.</small><button type="button" disabled>Продать</button>
        </div>`).join('') : `<p class="offer-empty">${data ? 'Офферов пока нет' : 'Не удалось загрузить офферы'}</p>`;
    };
    root.querySelectorAll('[data-offer-kind]').forEach(button => {
        button.onclick = () => {
            root.querySelector('.offer-kinds .selected').classList.remove('selected');
            button.classList.add('selected');
            paint(button.dataset.offerKind);
        };
    });
    root.querySelector('[data-offer-draft]').onclick = () => openOfferDraft(collection);
    paint(state.model ? 'specific' : 'general');
    if (state.model) {
        root.querySelector('[data-offer-kind="general"]').classList.remove('selected');
        root.querySelector('[data-offer-kind="specific"]').classList.add('selected');
    }
}

function openOfferDraft(collection) {
    sheet('Создать оффер', `<form class="offer-draft">
        <label>Цена <input name="price" inputmode="decimal" placeholder="Введите цену в GRAM"></label>
        <label>Количество <input name="quantity" type="number" min="1" step="1" value="1"></label>
        <label>Окончание оффера <select name="expiry"><option>Бессрочно</option><option>24 часа</option><option>7 дней</option></select></label>
        <div><b>Коллекция</b><p>${esc(collection.name)}</p></div>
        <div class="offer-draft-attributes"><b>Атрибуты</b>
            ${[['model','Модель'],['backdrop','Фон'],['symbol','Символ']].map(([key,label]) => `<label>${label}
                <select name="${key}"><option value="">Любой</option>${state[key] ? `<option selected>${esc(state[key])}</option>` : ''}</select></label>`).join('')}
        </div>
        <div class="offer-draft-summary"><span>Общая цена</span><b data-offer-total>0 GRAM</b></div>
        <div class="offer-draft-summary"><span>Доступный баланс</span><b>${money(state.me.balance)} GRAM</b></div>
        <button type="button" class="primary" disabled>Создать оффер</button>
    </form>`);
    const form = appSheet.querySelector('.offer-draft');
    form.onsubmit = event => event.preventDefault();
    form.oninput = () => {
        const price = resalePriceCents(form.elements.price.value);
        const quantity = Number(form.elements.quantity.value);
        form.querySelector('[data-offer-total]').textContent =
            money(Number.isSafeInteger(quantity) && quantity > 0 ? price * quantity / 100 : 0) + ' GRAM';
    };
    giftAttributes({collection_id:collection.id, name:collection.name}).then(data => {
        if (!form.isConnected || !data) return;
        for (const [key, group] of [['model','models'],['backdrop','backdrops'],['symbol','symbols']]) {
            const select = form.elements[key];
            const names = new Set([...select.options].map(option => option.value));
            for (const item of data[group] || []) {
                if (!item.name || names.has(item.name)) continue;
                names.add(item.name);
                select.add(new Option(item.name, item.name));
            }
        }
    }).catch(() => {});
}

function inventoryBank() {
    const me = state.me;
    const gram = money(me.inventory_value) + ' GRAM';
    const ton = Number(me.inventory_value_ton) > 0 ? money(me.inventory_value_ton) + ' TON' : '';
    return `<aside class="inventory-bank inventory-bank-float" aria-label="Общий банк">
        ${stakingNavIcon}<span><b>${gram}</b><small>Общий банк${ton ? ' · ' + ton : ''}</small></span>
    </aside>`;
}

function renderGamesProfile() {
    const me = state.me;
    const name = me.user.username ? '@' + me.user.username : me.user.first_name;
    document.querySelector('#main').innerHTML = `<section class="games-profile">
        <div class="games-profile-hero">
            <div class="avatar">${avatar()}</div>
            <h1>${esc(name)}</h1>
            <div class="games-profile-stats">
                <span><b>${me.games_played || 0}</b><small>Игры</small></span>
                <span><b>${money(me.best_game_win || 0)} GRAM</b><small>Лучший выигрыш</small></span>
            </div>
        </div>
        <div class="games-inventory-row"><button type="button" onclick="go('gifts')">Инвентарь <small>${me.inventory_count || 0} ${giftCountWord(me.inventory_count || 0)}</small></button>
            <button type="button" class="games-top-up" onclick="openGiftDeposit()">Пополнить</button>
        </div>
    </section>`;
}
