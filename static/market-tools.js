Object.assign(paths, {activity:'M2 12h4l3-6 5 12 3-6h5'});
const BULK_LIMIT = 50;
let bulkSelection;
let activity;

const marketToolFilters = filters;
filters = function () {
    let html = marketToolFilters();
    if (state.page !== 'market') return html;
    const active = Boolean(activity);
    const bulkOpen = Boolean(bulkSelection);
    if (active) html = html.replace(/<button[^>]*onclick="(?:openPriceFilters|openSort)\(\)"[^>]*>.*?<\/button>/g, '');
    return html.replace('</label>', `</label><button class="circle market-tool ${active?'selected':''}"
        onclick="toggleMarketActivity()" aria-label="Активность маркета" aria-pressed="${active}">${icon('activity')}</button>`)
        .replace('</div><div class="filter-strip">', `${active ? '' : `<button class="circle market-tool ${bulkOpen?'selected':''}"
            onclick="toggleBulkSelection()" aria-label="Массовое добавление в корзину" aria-expanded="${bulkOpen}">${icon('chevron')}</button>`}</div>
            ${bulkOpen && !active ? bulkPanel() : ''}<div class="filter-strip">${active ? `<button class="filter-chip" onclick="openMarketActivityTypes()">Тип активности${activity.types.length ? ' · '+activity.types.length : ''}${icon('chevron')}</button>` : ''}`);
};

function bulkPanel() {
    return `<div class="market-bulk">
        <input type="range" aria-label="Количество подарков" min="0" max="${BULK_LIMIT}" value="${bulkSelection.count}"
            oninput="changeBulkSelection(Number(this.value))">
        <div><b data-bulk-total>0 GRAM</b><small data-bulk-count>0 подарков</small></div>
    </div>`;
}

function toggleBulkSelection() {
    if (bulkSelection) bulkSelection = null;
    else {
        restoreCart();
        bulkSelection = {signature:marketParams().toString(), count:0, added:new Set(), loading:false};
    }
    renderMarket();
}

function marketBulkCandidates() {
    const collections = selectedCollections();
    const query = state.query.toLowerCase();
    const seen = new Set();
    return state.gifts.filter(gift => !gift.catalog_only && Number(gift.price) > 0 &&
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
    const added = requested.filter(gift => state.cart.has(gift.id));
    saveCart();
    filterGrid();
    paintBulkSummary(added);
}

function paintBulkSummary(items) {
    const total = document.querySelector('[data-bulk-total]');
    const count = document.querySelector('[data-bulk-count]');
    if (!total || !count) return;
    total.textContent = money(cartTotal(items)) + ' GRAM';
    count.textContent = items.length + ' ' + giftCountWord(items.length);
}

async function changeBulkSelection(count) {
    const bulk = bulkSelection;
    if (!bulk || state.cartBuying) return;
    bulk.count = Math.max(0, Math.min(BULK_LIMIT, count));
    const current = () => state.page === 'market' && bulkSelection === bulk && bulk.signature === marketParams().toString();
    if (!current()) return;
    syncBulkSelection(bulk);
    if (bulk.loading) return;
    bulk.loading = true;
    try {
        for (let page = 0; current() && page < 5 && state.marketHasMore && marketBulkCandidates().length < bulk.count; page++) {
            while (current() && state.marketLoading) await new Promise(resolve => setTimeout(resolve, 100));
            if (!current() || marketBulkCandidates().length >= bulk.count || !state.marketHasMore) break;
            const cursor = state.marketCursor;
            await loadMore();
            if (state.marketCursor === cursor) break;
            if (current()) syncBulkSelection(bulk);
        }
    } finally {
        bulk.loading = false;
        if (current()) syncBulkSelection(bulk);
    }
}

const activityTypes = {buy:'Покупка', sell:'Листинг', craft:'Крафт', lucky_craft:'Lucky Craft'};
function toggleMarketActivity() {
    bulkSelection = null;
    activity = activity ? null : {types:[], model:null, key:'', data:null};
    renderMarket();
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
        search:state.query || '', model:activity.model ?? state.model ?? '',
        backdrop:state.backdrop || '', symbol:state.symbol || '', types:activity.types.join(',')});
}

function setActivityModel(value) {
    activity.model = value;
    renderMarket();
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
    const model = activity.model ?? state.model ?? '';
    const models = [...new Set([model, ...data.models].filter(Boolean))];
    let lastDay = '';
    const rows = data.items.map(({gift,kind,price,created}) => {
        const date = new Date(created * 1000);
        const day = date.toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric'});
        const heading = day === lastDay ? '' : `<h3>${esc(day)}</h3>`;
        lastDay = day;
        return `${heading}<article class="market-activity-row">
            <div class="activity-art" style="background:${giftBackdrop(gift)}"><img ${giftPicture(gift)} alt="" loading="lazy"></div>
            <div><b>${esc(gift.name)}</b><small>${gift.number?'#'+esc(gift.number)+' · ':''}${date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</small></div>
            <div class="activity-price"><small>${activityTypes[kind] || ''}</small>${price != null ? `<b>${money(price)} GRAM</b>` : ''}</div>
        </article>`;
    }).join('');
    container.innerHTML = `<div class="activity-summary">
        <div><small>Объём покупок</small><b>${money(data.turnover)} GRAM</b></div>
        <div><small>Покупок</small><b>${money(data.purchases)}</b></div>
        <label><small>Модель</small><select aria-label="Модель в статистике" onchange="setActivityModel(this.value)">
            <option value="">Все модели</option>${models.map(item => `<option value="${esc(item)}" ${item===model?'selected':''}>${esc(item)}</option>`).join('')}
        </select></label></div><div class="activity-feed">${rows || '<p class="sub">По этим фильтрам пока нет операций</p>'}</div>
        ${data.has_more ? `<button class="secondary" onclick="refreshMarketActivity(true)" ${activity.pending?'disabled':''}>Показать ещё</button>` : ''}`;
}

const renderMarketToolsBase = renderMarket;
renderMarket = function () {
    if (bulkSelection && bulkSelection.signature !== marketParams().toString()) bulkSelection = null;
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
    } else if (bulkSelection) {
        paintBulkSummary(marketBulkCandidates().slice(0, bulkSelection.count).filter(item => state.cart.has(item.id)));
    }
};

const changedMarketToolsBase = changedFilter;
changedFilter = function () {
    if (activity && state.page === 'market') {
        activity.model = null;
        saveView();
        refreshMarketActivity();
        return;
    }
    changedMarketToolsBase();
};

const goMarketToolsBase = go;
go = function (page) {
    activity = null;
    bulkSelection = null;
    return goMarketToolsBase(page);
};
