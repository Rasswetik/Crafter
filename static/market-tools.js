Object.assign(paths, {
    activity:'M2 12h4l3-6 5 12 3-6h5',
    bulk:'M3 7h5m4 0h9M3 17h10m4 0h4M8 4v6m9 4v6',
});
const BULK_LIMIT = 50;
let bulkSelection;
let activity;

function marketActivityVisible() { return Boolean(activity); }

const marketToolFilters = filters;
filters = function () {
    let html = marketToolFilters();
    if (state.page !== 'market') return html;
    const active = Boolean(activity);
    const internal = state.marketSource === 'crafter';
    const bulkOpen = !internal && Boolean(bulkSelection?.expanded);
    if (active) html = html.replace(/<button[^>]*onclick="(?:openPriceFilters|openSort)\(\)"[^>]*>.*?<\/button>/g, '');
    return html.replace('</label>', `</label><button class="circle market-tool ${active?'selected':''}"
        onclick="toggleMarketActivity()" aria-label="Активность маркета" aria-pressed="${active}">${icon('activity')}</button>`)
        .replace('</div><div class="filter-strip">', `${active || internal ? '' : `<button class="circle market-tool ${bulkOpen?'selected':''}"
            onclick="toggleBulkSelection()" data-bulk-toggle aria-label="Массовое добавление в корзину" aria-expanded="${bulkOpen}">${icon('bulk')}</button>`}</div>
            ${bulkOpen && !active ? bulkPanel() : ''}<div class="filter-strip">${active ? `<button class="filter-chip" onclick="openMarketActivityTypes()">Тип активности${activity.types.length ? ' · '+activity.types.length : ''}${icon('chevron')}</button>` : ''}`);
};

function bulkPanel() {
    return `<div class="market-bulk">
        <label class="market-bulk-control"><span>Выбрать лоты</span>
            <input type="range" aria-label="Количество подарков" min="0" max="${bulkSelection.max}" step="1" value="${bulkSelection.count}"
                ${!bulkSelection.ready || !bulkSelection.max || state.marketFilterPending ? 'disabled' : ''} oninput="changeBulkSelection(Number(this.value))">
        </label>
        <div><b data-bulk-total>0 GRAM</b><small data-bulk-count>0 подарков</small></div>
    </div>`;
}

function newBulkSelection(expanded) {
    return {signature:bulkFilterSignature(), count:0, max:0, added:new Set(), loading:false, ready:false, expanded};
}

function toggleBulkSelection() {
    restoreCart();
    if (!bulkSelection) bulkSelection = newBulkSelection(false);
    bulkSelection.expanded = !bulkSelection.expanded;
    const button = document.querySelector('[data-bulk-toggle]');
    button?.classList.toggle('selected', bulkSelection.expanded);
    button?.setAttribute('aria-expanded', String(bulkSelection.expanded));
    if (bulkSelection.expanded) {
        document.querySelector('#main .search')?.insertAdjacentHTML('afterend', bulkPanel());
        paintBulkControls();
        prepareBulkSelection();
    } else {
        document.querySelector('.market-bulk')?.remove();
    }
}

function bulkFilterSignature() {
    const params = marketParams();
    params.delete('price_unit');
    return params.toString();
}

function resetBulkForFilters() {
    if (!bulkSelection || bulkSelection.signature === bulkFilterSignature()) return;
    for (const id of bulkSelection.added) {
        state.cart.delete(id);
        state.cartSelected.delete(id);
    }
    // Replace the object so in-flight pagination cannot add lots from the old filter.
    bulkSelection = newBulkSelection(bulkSelection.expanded);
    saveCart();
    updateMarketCartButtons();
    paintBulkControls();
}

function marketBulkCandidates() {
    const collections = selectedCollections();
    const query = state.query.toLowerCase();
    const seen = new Set();
    const filtered = state.gifts.filter(gift => !gift.catalog_only && Number(gift.price) > 0 &&
        ['GRAM', undefined].includes(gift.price_unit) &&
        (!collections.length || collections.includes(String(gift.collection_id)) || collections.includes(gift.name)) &&
        (!state.model || gift.model === state.model) && (!state.backdrop || gift.backdrop === state.backdrop) &&
        (!state.symbol || gift.symbol === state.symbol) &&
        (gift.name+' '+gift.number+' '+(gift.model||'')).toLowerCase().includes(query)).filter(gift => {
        const serial = gift.number ? gift.name.toLowerCase() + ':' + gift.number : gift.id;
        if (seen.has(serial)) return false;
        seen.add(serial);
        return true;
    });
    return state.sort ? filtered.sort((a,b) => Number(a.price)-Number(b.price)) : filtered;
}

function syncBulkSelection(bulk) {
    const requested = marketBulkCandidates().slice(0, bulk.count);
    const ids = new Set(requested.map(item => item.id));
    for (const id of bulk.added) {
        if (ids.has(id)) continue;
        state.cart.delete(id);
        state.cartSelected.delete(id);
        bulk.added.delete(id);
    }
    for (const gift of requested) {
        if (state.cart.has(gift.id)) continue;
        if (state.cart.size >= 100) break;
        state.cart.set(gift.id, gift);
        state.cartSelected.add(gift.id);
        bulk.added.add(gift.id);
    }
    saveCart();
    updateMarketCartButtons();
    paintBulkControls();
}

function paintBulkSummary(items) {
    const total = document.querySelector('[data-bulk-total]');
    const count = document.querySelector('[data-bulk-count]');
    if (!total || !count) return;
    total.textContent = money(cartTotal(items)) + ' GRAM';
    count.textContent = state.marketFilterPending ? 'Обновляем выдачу…' :
        bulkSelection?.loading ? 'Загружаем лоты…' : items.length + ' ' + giftCountWord(items.length);
}

function paintBulkControls() {
    const bulk = bulkSelection;
    const range = document.querySelector('.market-bulk input');
    if (!bulk || !range) return;
    range.max = bulk.max;
    range.value = bulk.count;
    range.style.setProperty('--bulk-progress', (bulk.max ? 100 * bulk.count / bulk.max : 0) + '%');
    range.disabled = !bulk.ready || !bulk.max || Boolean(state.marketFilterPending);
    paintBulkSummary(marketBulkCandidates().slice(0, bulk.count).filter(item => state.cart.has(item.id)));
}

async function prepareBulkSelection() {
    const bulk = bulkSelection;
    if (!bulk?.expanded || bulk.loading || bulk.ready || state.marketFilterPending) return;
    const current = () => state.page === 'market' && bulkSelection === bulk && bulk.signature === bulkFilterSignature();
    bulk.loading = true;
    paintBulkControls();
    try {
        // Resolve the range before enabling it so the thumb never jumps while dragged.
        for (let page = 0; current() && page < 6 && state.marketHasMore && marketBulkCandidates().length < BULK_LIMIT; page++) {
            while (current() && state.marketLoading) await new Promise(resolve => setTimeout(resolve, 75));
            if (!current() || marketBulkCandidates().length >= BULK_LIMIT || !state.marketHasMore) break;
            const cursor = state.marketCursor;
            await loadMore();
            if (state.marketCursor === cursor) break;
        }
    } finally {
        bulk.loading = false;
        if (current()) {
            bulk.max = Math.min(BULK_LIMIT, marketBulkCandidates().length);
            bulk.ready = true;
            paintBulkControls();
        }
    }
}

function changeBulkSelection(count) {
    const bulk = bulkSelection;
    if (!bulk?.ready || state.cartBuying || state.marketFilterPending || bulk.signature !== bulkFilterSignature()) return;
    bulk.count = Math.max(0, Math.min(bulk.max, Math.round(count)));
    syncBulkSelection(bulk);
}

function removePurchasedMarketLots(ids) {
    const removed = new Set(ids);
    const collectible = gift => !gift?.resale && gift?.number && gift.name.toLowerCase() + ':' + gift.number;
    const serials = new Set(ids.map(id => collectible(state.gifts.find(gift => gift.id === id) || state.cart.get(id))).filter(Boolean));
    for (const gift of [...state.gifts, ...state.cart.values()]) {
        if (serials.has(collectible(gift))) removed.add(gift.id);
    }
    if (bulkSelection) {
        const selected = marketBulkCandidates().slice(0, bulkSelection.count);
        bulkSelection.count -= selected.filter(gift => removed.has(gift.id)).length;
    }
    state.gifts = state.gifts.filter(gift => !removed.has(gift.id));
    for (const id of removed) {
        state.cart.delete(id);
        state.cartSelected.delete(id);
        bulkSelection?.added.delete(id);
    }
    if (bulkSelection?.ready) bulkSelection.max = Math.min(BULK_LIMIT, marketBulkCandidates().length);
    saveCart();
    if (state.page === 'market') filterGrid();
    paintBulkControls();
}

const activityTypes = {buy:'Покупка', sell:'Листинг', craft:'Крафт', lucky_craft:'Lucky Craft'};
function toggleMarketActivity() {
    bulkSelection = null;
    activity = activity ? null : {types:[], key:'', data:null};
    renderMarket();
    updateCartFloat();
    if (!activity) changedFilter();
}

function openMarketActivityTypes() {
    if (!activity) return;
    sheet('Тип активности', `<div class="activity-types">${Object.entries(activityTypes).map(([key,label]) =>
        `<label><input type="checkbox" name="market-activity-type" value="${key}" ${activity.types.includes(key)?'checked':''}> ${label}</label>`).join('')}</div>
        <div class="activity-type-actions"><button class="secondary" onclick="applyMarketActivityTypes(true)">Сбросить</button>
        <button class="primary" onclick="applyMarketActivityTypes(false)">Применить</button></div>`);
    document.querySelector('#sheet').classList.add('sort-sheet');
}

function applyMarketActivityTypes(reset) {
    if (!activity) return;
    activity.types = reset ? [] : [...document.querySelectorAll('[name=market-activity-type]:checked')].map(el => el.value);
    closeSheet();
    renderMarket();
}

function marketActivityParams(offset = 0) {
    return new URLSearchParams({offset:String(offset), collections:state.collection || '',
        search:state.query || '', model:state.model || '',
        backdrop:state.backdrop || '', symbol:state.symbol || '', types:activity.types.join(',')});
}

async function refreshMarketActivity(more = false) {
    const active = activity;
    if (!active) return;
    const key = marketActivityParams().toString();
    if (more && (!active.data?.has_more || active.pending)) return;
    if (!more && active.key === key && (active.data || active.pending)) {
        paintMarketActivity();
        return;
    }
    if (!more) {
        active.key = key;
        active.data = null;
    }
    const token = {};
    active.pending = token;
    paintMarketActivity();
    try {
        const data = await api('market/activity?' + marketActivityParams(more ? active.data.items.length : 0));
        if (activity !== active || active.pending !== token || active.key !== key) return;
        if (more) data.items = active.data.items.concat(data.items);
        active.data = data;
    } catch (error) {
        if (activity === active && active.pending === token) toast(error.message);
    } finally {
        if (activity === active && active.pending === token) {
            active.pending = null;
            paintMarketActivity();
        }
    }
}

function paintMarketActivity() {
    const container = document.querySelector('#market-activity');
    if (!container || !activity) return;
    const data = activity.data;
    if (!data) {
        container.innerHTML = activity.pending ? '<p class="sub">Загрузка активности…</p>' :
            '<button class="secondary" onclick="refreshMarketActivity()">Повторить</button>';
        return;
    }
    let lastDay = '';
    const rows = data.items.map(({gift,kind,price,created}, index) => {
        const date = new Date(created * 1000);
        const day = date.toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric'});
        const heading = day === lastDay ? '' : `<h3>${esc(day)}</h3>`;
        lastDay = day;
        return `${heading}<button type="button" class="market-activity-row" data-activity-gift="${index}">
            <span class="activity-art" style="background:${giftBackdrop(gift)}"><img ${giftPicture(gift)} alt="" loading="lazy"></span>
            <span><b>${esc(gift.name)}</b><small>${gift.number?'#'+esc(gift.number)+' · ':''}${date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</small></span>
            <span class="activity-price"><small>${activityTypes[kind] || ''}</small>${price != null ? `<b>${money(price)} ${gramIcon()}</b>` : ''}</span>
        </button>`;
    }).join('');
    container.innerHTML = `<div class="activity-feed">${rows || '<p class="sub">По этим фильтрам пока нет операций</p>'}</div>
        ${data.has_more ? `<button class="secondary" onclick="refreshMarketActivity(true)" ${activity.pending?'disabled':''}>Показать ещё</button>` : ''}`;
    container.querySelectorAll('[data-activity-gift]').forEach(button => {
        button.onclick = async () => {
            const item = data.items[Number(button.dataset.activityGift)];
            if (item.listing_id) {
                try {
                    const {gift} = await api('resale/listings/' + encodeURIComponent(item.listing_id));
                    if (button.isConnected) showGiftDetail(gift, 'market');
                    return;
                } catch (error) {
                    if (error.status !== 404) return toast(error.message);
                }
            }
            if (button.isConnected) showGiftDetail(item.gift, 'history');
        };
    });
}

const renderMarketToolsBase = renderMarket;
renderMarket = function () {
    resetBulkForFilters();
    renderMarketToolsBase();
    if (activity) {
        marketObserver?.disconnect();
        document.querySelector('#market-sentinel')?.remove();
        const grid = document.querySelector('#gifts-grid');
        if (grid) {
            grid.id = 'market-activity';
            grid.className = '';
        }
        refreshMarketActivity();
    } else if (bulkSelection?.expanded) {
        paintBulkControls();
        prepareBulkSelection();
    }
};

const changedMarketToolsBase = changedFilter;
changedFilter = function () {
    if (activity && state.page === 'market') {
        saveView();
        refreshMarketActivity();
        return;
    }
    resetBulkForFilters();
    changedMarketToolsBase();
    paintBulkControls();
    prepareBulkSelection();
};

const goMarketToolsBase = go;
go = function (page) {
    activity = null;
    bulkSelection = null;
    return goMarketToolsBase(page);
};
