// Searchable catalog sheets inspired by the mobile Portals interface.
Object.assign(paths, {sortOrder:'M8 19V5m-4 4 4-4 4 4m4-4v14m-4-4 4 4 4-4'});
filters=function(){return `<div class="search"><label class="search-box">${icon('search')}<input aria-label="Быстрый поиск" placeholder="Быстрый поиск" value="${esc(state.query)}" oninput="state.query=this.value;changedFilter()"></label><button class="circle" onclick="state.list=!state.list;filterGrid()" aria-label="Изменить вид">${icon('grid')}</button></div><div class="filter-strip"><button class="sort" onclick="state.sort=!state.sort;changedFilter()" aria-label="Сортировать">${icon('sortOrder')}</button>${[['collection','Коллекция'],['model','Модель'],['backdrop','Фон'],['symbol','Символ']].filter(([key])=>!state.collectionPage||key!=='collection').map(([k,n])=>`<button class="filter-chip ${state[k]?'has-value':''}" onclick="openCatalogSheet('${k}')">${n}${state[k]?`<span>${k==='collection'?selectedCollections().length:1}</span>`:''}${icon('chevron')}</button>`).join('')}</div>`};
function selectedCollections(value = state.collection) {
    return value ? String(value).split(',') : [];
}
function resetCatalogDraft() {
    state.sheetValue = '';
    renderCatalogRows(document.querySelector('.catalog-search input').value);
}

const priorSheet=sheet;sheet=function(title,html){document.querySelector('#sheet').classList.remove('catalog-sheet');priorSheet(title,html)};
async function openCatalogSheet(kind){
 const titles={collection:'Коллекция',model:'Модель',backdrop:'Фон',symbol:'Символ',target:'Что скрафтить'};
 let rows=[];const collection=state.catalog.collections.find(c=>c.id===state.collection||c.short_name===state.collection);
 if(kind==='collection'||kind==='target') rows=state.catalog.collections.map(c=>({value:c.id,name:c.name,image:c.photo_url,price:c.floor_price,unit:['snapshot','thermos'].includes(state.catalog.source)?'TON':'GRAM'}));
 else if(selectedCollections().length > 1) {toast('Для фильтра по атрибутам выберите одну коллекцию');return}
 else if(kind==='model'&&collection){try{const data=await api('collections/'+encodeURIComponent(collection.short_name||collection.id)+'/models');rows=data.models.map(m=>({value:m.name,name:m.name,image:m.image,price:m.price,unit:m.price_unit|| (m.price_source==='snapshot-estimate'?'TON':'GRAM')}))}catch(e){toast(e.message);return}}
 else if(collection){try{const attrs=await api('collections/'+encodeURIComponent(collection.id)+'/attributes');const group=attrs[kind==='backdrop'?'backdrops':'symbols']||[];rows=group.map(m=>({value:m.name,name:m.name,image:m.image_url,price:Number(m.stats?.floor||0)/1e9,unit:'TON'}))}catch(e){toast(e.message);return}}
 state.catalogRows=rows;state.sheetKind=kind;state.sheetValue=kind==='target'?'':state[kind]||'';
 sheet(titles[kind],`<label class="catalog-search search-box">${icon('search')}<input placeholder="Быстрый поиск" aria-label="Быстрый поиск" oninput="renderCatalogRows(this.value)"></label><div class="catalog-columns"><span>${kind==='target'?'КОЛЛЕКЦИЯ':titles[kind]}</span><span>Мин. цена</span></div><div id="catalog-rows" class="catalog-rows"></div>${kind==='target'?'':`<div class="catalog-footer"><button onclick="resetCatalogDraft()">Сбросить</button><button class="apply" onclick="applyCatalogFilter()">Применить</button></div>`}`);
 document.querySelector('#sheet').classList.add('catalog-sheet');renderCatalogRows('');
}
function renderCatalogRows(query){const rows=state.catalogRows.filter(r=>r.name.toLowerCase().includes(query.toLowerCase()));document.querySelector('#catalog-rows').innerHTML=rows.length?rows.map(r=>`<button class="catalog-row" onclick="pickCatalogRow(${arg(r.value)})">${state.sheetKind==='target'?'':`<span class="catalog-check ${catalogRowSelected(r.value)?'checked':''}">${catalogRowSelected(r.value)?'✓':''}</span>`}<span class="catalog-thumb">${r.image?`<img loading="lazy" src="${esc(imageURL(r.image))}" alt="">`:''}</span><strong>${esc(r.name)}</strong><b>${r.price!=null&&Number(r.price)>0?money(r.price)+' '+esc(r.unit):'—'}</b></button>`).join(''):`<div class="catalog-empty">${state.sheetKind!=='collection'&&!state.collection?'Сначала выберите коллекцию':'Нет доступных данных'}</div>`}
function catalogRowSelected(value) {
    return state.page === 'market' && state.sheetKind === 'collection'
        ? selectedCollections(state.sheetValue).includes(String(value))
        : state.sheetValue === value;
}
function pickCatalogRow(value){if(state.sheetKind==='target'){const c=state.catalog.collections.find(x=>x.id===value);if(c){state.target={id:c.id,name:c.name,image:c.photo_url};state.quote=null;closeSheet();renderCraft();updateCraftQuote()}return}if(state.page==='market' && state.sheetKind==='collection'){
 const ids=new Set(selectedCollections(state.sheetValue));
 if(ids.has(String(value)))ids.delete(String(value));
 else if(ids.size<20)ids.add(String(value));
 else return toast('Можно выбрать до 20 коллекций');
 state.sheetValue=[...ids].sort().join(',');
 }else state.sheetValue=state.sheetValue===value?'':value;
 renderCatalogRows(document.querySelector('.catalog-search input').value)}
function applyCatalogFilter(){const k=state.sheetKind;if(k==='collection'&&state.collection!==state.sheetValue){state.model='';state.backdrop='';state.symbol=''}state[k]=state.sheetValue;closeSheet();if(state.page==='market')renderMarket();else renderGifts();changedFilter()}
function craftRules(){sheet('Как работает крафт',`<div class="attributes"><div><span>Оценка подарков</span><b>Флор коллекции в TON</b></div><div><span>Шанс</span><b>Сумма флоров / флор цели × 95%</b></div><div><span>Максимальный шанс</span><b>95%</b></div></div><p class="sub">Выбранные подарки списываются. При успехе результат появляется в инвентаре Crafter. Операция работает с подарками приложения; передачу NFT в Telegram она не выполняет.</p><button class="primary" onclick="closeSheet()">Понятно</button>`)}
function renderCraft() {
    const gifts = state.selected.map(id => state.inventory.find(gift =>
        gift.id === id && gift.status === 'unlisted'
    )).filter(Boolean).slice(0, CRAFT_GIFT_LIMIT);
    state.selected = gifts.map(gift => gift.id);
    saveCraftDraft();
    const quote = state.quote?.key === craftQuoteKey(state.selected, state.target?.id, state.target?.listingId) ? state.quote : null;
    const pending = !quote && gifts.length > 0 && Boolean(state.target);
    const chance = quote?.chance ?? (pending ? null : 0);
    document.querySelector('#main').innerHTML = `
        <section class="craft-page">
            <div class="forge" id="forge">
                ${Array.from({length: CRAFT_GIFT_LIMIT}, (_, index) => slot(index, gifts)).join('')}
                <div class="anvil${pending ? ' chance-pending' : ''}">
                    <div class="craft-gauge" aria-hidden="true">
                        <svg class="chance-ring" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="49"/>
                            <circle class="chance-value" cx="60" cy="60" r="49" style="stroke-dasharray:${(chance ?? 0) / 100 * 308} 308"/>
                        </svg>
                        ${anvilArt()}
                    </div>
                    <strong class="craft-chance" data-chance="${chance ?? 0}">
                        <span class="craft-chance-number">${chance === null ? '…' : money(chance)}</span><small>%</small>
                    </strong>
                </div>
            </div>
            <div class="craft-caption">Добавьте до <b>${CRAFT_GIFT_LIMIT} подарков</b>, чтобы скрафтить</div>
            <button class="target" onclick="chooseTarget()">${state.target ?
                `<img src="${esc(imageURL(state.target.image))}" alt="">${esc(state.target.name)}${state.target.number ? ` #${esc(state.target.number)}` : ''}` :
                'Выберите подарок'}${icon('chevron')}</button>
            <div class="craft-warning">⚠ Если крафт не удастся,<br>подарки сгорят</div>
            <div class="craft-bottom">
                <button id="craft-button" class="primary craft-action" onclick="${gifts.length ? 'runCraft()' : 'pickGift()'}">
                    ${gifts.length ? 'Скрафтить' : 'Добавить подарки для крафта'}
                </button>
            </div>
        </section>`;
}

function applyPicker() {
    state.selected = [...state.pickerSelected].slice(0, CRAFT_GIFT_LIMIT);
    state.quote = null;
    closeSheet();
    renderCraft();
    updateCraftQuote();
}

function removeGift(id) {
    if (state.crafting) return;
    state.selected = state.selected.filter(giftId => giftId !== id);
    state.quote = null;
    renderCraft();
    updateCraftQuote();
}

const craftQuoteKey = (ids, target, listingId) => JSON.stringify([target, listingId ?? null, ids]);
let pendingCraftQuote;

function getCraftQuote(ids, target, listingId) {
    const key = craftQuoteKey(ids, target, listingId);
    if (state.quote?.key === key && state.quote.expires_at > Date.now() / 1000) {
        return Promise.resolve(state.quote);
    }
    if (pendingCraftQuote?.key === key) return pendingCraftQuote.promise;

    const pending = {key};
    pending.promise = api('craft/quote', {gift_ids: ids, target_id: target, listing_id: listingId})
        .then(quote => ({...quote, key}))
        .finally(() => {
            if (pendingCraftQuote === pending) pendingCraftQuote = null;
        });
    pendingCraftQuote = pending;
    return pending.promise;
}

async function updateCraftQuote() {
    const ids = state.selected;
    const target = state.target?.id;
    const listingId = state.target?.listingId;
    if (!ids.length || !target) return;
    const isCurrent = () => !state.crafting && state.page === 'craft' &&
        craftQuoteKey(ids, target, listingId) === craftQuoteKey(state.selected, state.target?.id, state.target?.listingId);
    const estimate = listingId ? null : estimateCraftChance(ids, target);
    if (estimate !== null && state.quote?.key !== craftQuoteKey(ids, target, listingId)) {
        showCraftChance(estimate, true);
    }
    try {
        const quote = await getCraftQuote(ids, target, listingId);
        if (!isCurrent()) return;
        state.quote = quote;
        showCraftChance(quote.chance);
    } catch (error) {
        if (isCurrent()) {
            document.querySelector('#forge .anvil')?.classList.remove('chance-pending');
            toast(error.message);
        }
    }
}

function estimateCraftChance(ids, target) {
    if (state.me?.demo || state.catalog.source !== 'thermos') return null;
    const collections = state.catalog.collections;
    const targetFloor = Number(collections.find(item => item.id === target)?.floor_price);
    if (!Number.isFinite(targetFloor) || targetFloor <= 0) return null;
    const canonical = value => String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');
    const floors = new Map(collections.map(item => [canonical(item.name), Number(item.floor_price)]));
    const inputFloors = ids.map(id => floors.get(canonical(state.inventory.find(gift => gift.id === id)?.name)));
    if (inputFloors.some(value => !Number.isFinite(value) || value <= 0)) return null;
    const total = inputFloors.reduce((sum, value) => sum + value, 0);
    return Math.min(9500, Math.floor(total / targetFloor * 9500)) / 100;
}

function showCraftChance(chance, approximate = false) {
    const anvil = document.querySelector('#forge .anvil');
    if (!anvil) return;
    const label = anvil.querySelector('.craft-chance');
    const number = label.querySelector('.craft-chance-number');
    const ring = anvil.querySelector('.chance-value');
    anvil.classList.remove('chance-pending');
    ring.style.strokeDasharray = (chance / 100 * 308) + ' 308';
    label.classList.toggle('chance-estimate', approximate);
    label.setAttribute('aria-label', (approximate ? 'Примерный шанс ' : 'Шанс ') + money(chance) + '%');
    if (label.chanceFrame) cancelAnimationFrame(label.chanceFrame);
    const from = Number(label.dataset.chance);
    const started = performance.now();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420;
    function draw(now) {
        if (!label.isConnected) return;
        const progress = duration ? CrafterCube.smooth((now - started) / duration) : 1;
        const value = from + (chance - from) * progress;
        label.dataset.chance = value;
        number.textContent = money(value);
        if (progress < 1) label.chanceFrame = requestAnimationFrame(draw);
    }
    draw(started);
}

function chooseTarget() {
    if (!state.crafting) openCatalogSheet('target');
}

const gramIcon=()=>'<img class="gram-icon" src="/static/assets/gram.svg" alt="GRAM">';
const currencyHTML=g=>(g.price_unit==='TON'||g.catalog_only)?'TON':gramIcon();
Object.assign(state,{order:'listed_at desc',minPrice:'',maxPrice:''});
const sortOptions=[['listed_at desc','Сначала новые'],['price asc','Цена: по возрастанию'],['price desc','Цена: по убыванию'],['external_collection_number asc','ID подарка: ↑'],['external_collection_number desc','ID подарка: ↓'],['model_rarity asc','Редкость модели: ↑'],['model_rarity desc','Редкость модели: ↓']];
filters=function(){return `<div class="search"><label class="search-box">${icon('search')}<input aria-label="Быстрый поиск" placeholder="Быстрый поиск" value="${esc(state.query)}" oninput="state.query=this.value;changedFilter()"></label><button class="circle" onclick="state.list=!state.list;filterGrid()" aria-label="Изменить вид">${icon('grid')}</button></div><div class="filter-strip"><button class="sort" onclick="openPriceFilters()" aria-label="Диапазон цены">${icon('filter')}</button><button class="sort ${state.order!=='listed_at desc'?'enabled':''}" onclick="openSort()" aria-label="Сортировка">${icon('sortOrder')}</button><span class="filter-divider"></span>${[['collection','Коллекция'],['model','Модель'],['backdrop','Фон'],['symbol','Символ']].filter(([key])=>!state.collectionPage||key!=='collection').map(([k,n])=>`<button class="filter-chip ${state[k]?'has-value':''}" onclick="openCatalogSheet('${k}')">${n}${state[k]?`<span>${k==='collection'?selectedCollections().length:1}</span>`:''}${icon('chevron')}</button>`).join('')}</div>`};
renderMarket=function(){document.querySelector('#main').innerHTML=`${filters()}<div id="gifts-grid" class="grid"></div><button class="load-more" onclick="loadMore()">Показать ещё</button>${demoNote()}`;filterGrid()};
marketParams=function(offset=0){const p=new URLSearchParams({offset:String(offset),sort_by:state.order,price_unit:state.marketUnit||'GRAM'});for(const [key,value] of [['search',state.query],['collection_id',state.collection],['filter_by_models',state.model],['filter_by_backdrops',state.backdrop],['filter_by_symbols',state.symbol],['min_price',state.minPrice],['max_price',state.maxPrice]])if(value!==''&&value!=null)p.set(key,value);return p};
function openSort(){state.draftOrder=state.order;sheet('Сортировка',`<div class="sort-options">${sortOptions.map(([v,n])=>`<button class="sort-option" onclick="chooseSort(${arg(v)})" data-order="${esc(v)}"><span class="sort-radio ${v===state.draftOrder?'checked':''}"></span>${n}</button>`).join('')}</div><button class="primary sort-apply" onclick="applySort()">Применить</button>`);document.querySelector('#sheet').classList.add('sort-sheet')}
function chooseSort(v){state.draftOrder=v;document.querySelectorAll('.sort-option').forEach(el=>el.querySelector('.sort-radio').classList.toggle('checked',el.dataset.order===v))}
function applySort(){state.order=state.draftOrder;state.sort=false;closeSheet();if(state.page==='market')renderMarket();changedFilter()}
function openPriceFilters(){sheet('Цена',`<p class="sub">Диапазон цены, ${esc(state.page==="gifts"?"GRAM":state.marketUnit||"GRAM")}</p><div class="price-fields"><label>От<input id="price-min" inputmode="decimal" type="number" min="0" step="0.01" placeholder="0" value="${esc(state.minPrice)}"></label><label>До<input id="price-max" inputmode="decimal" type="number" min="0" step="0.01" placeholder="Без лимита" value="${esc(state.maxPrice)}"></label></div><div class="catalog-footer"><button onclick="state.minPrice='';state.maxPrice='';closeSheet();refreshFilteredPage();changedFilter()">Сбросить</button><button class="apply" onclick="applyPriceFilters()">Применить</button></div>`);document.querySelector('#sheet').classList.add('price-sheet')}
function applyPriceFilters(){const min=document.querySelector('#price-min').value,max=document.querySelector('#price-max').value;if((min&&(!Number.isFinite(Number(min))||Number(min)<0))||(max&&(!Number.isFinite(Number(max))||Number(max)<0))||(min&&max&&Number(min)>Number(max)))return toast('Укажите корректный диапазон цены');state.minPrice=min;state.maxPrice=max;closeSheet();refreshFilteredPage();changedFilter()}
const themedSheet=sheet;sheet=function(t,h){document.querySelector('#sheet').classList.remove('sort-sheet','price-sheet','purchase-sheet');themedSheet(t,h)};
nav=function(){document.querySelector('#nav').innerHTML=`<div class="nav-main">${[['market','market','Маркет'],['gifts','gift','Мои подарки'],['craft','craft','Крафт']].map(([p,i,n])=>`<button class="${state.page===p?'active':''}" onclick="go('${p}')" aria-label="${n}">${icon(i)}<span>${n}</span></button>`).join('')}</div><button class="profile-nav ${['profile','admin'].includes(state.page)?'active':''}" onclick="go(state.page==='profile'?'market':'profile')" aria-label="Профиль"><span class="avatar">${avatar()}</span></button>`};
Object.assign(paths, { eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z' });

function telegramGiftLink(gift) {
    if (/^https:\/\/t\.me\/nft\/[a-z0-9]+-[1-9]\d*$/i.test(gift.telegram_url || '')) {
        return gift.telegram_url;
    }
    const local = ['application-craft', 'admin-grant', 'local-purchase'].includes(gift.origin);
    const number = String(gift.source_number ?? (local ? '' : gift.number ?? ''));
    const slug = gift.name.normalize('NFKD').replace(/[^a-z0-9]/gi, '');
    return slug && /^[1-9]\d*$/.test(number) ? 'https://t.me/nft/' + slug + '-' + number : '';
}

function openTelegramGift() {
    const url = state.detailGift && telegramGiftLink(state.detailGift);
    if (!url) return toast('У этого подарка пока нет ссылки в Telegram');
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
}

function productFloor(gift) {
    const collection = state.catalog.collections.find(item =>
        item.id === gift.collection_id || item.name === gift.name
    );
    if (Number(gift.floor_price) > 0) {
        return money(gift.floor_price) + ' ' + (gift.source_price_unit || gift.price_unit || 'GRAM');
    }
    if (Number(collection?.floor_price) > 0) {
        return money(collection.floor_price) + ' ' + (collection.price_unit || 'TON');
    }
    return '—';
}

function giftCollection(gift) {
    return state.catalog.collections.find(item => item.id === gift.collection_id || item.name === gift.name);
}

function chooseLuckyGift(id) {
    const gift = state.gifts.find(item => item.id === id);
    const collection = gift && giftCollection(gift);
    if (!gift?.number || gift.catalog_only || !collection) return toast('Лот недоступен для Lucky Craft');
    state.target = {id: collection.id, listingId: gift.id, number: gift.number, name: gift.name, image: gift.image};
    state.quote = null;
    closeSheet();
    go('craft');
}

async function loadGiftAttributePrices(panel, gift, attributes) {
    try {
        const data = await giftAttributes(gift);
        if (!panel.isConnected || !data) return;
        for (const [key, , name] of attributes) {
            const group = {model:'models', symbol:'symbols', backdrop:'backdrops'}[key];
            const match = data[group]?.find(item => item.name === name);
            const price = Number(match?.stats?.floor) / 1e9;
            if (Number.isFinite(price) && price > 0) {
                panel.querySelector('[data-trait-price="' + key + '"]').textContent = money(price) + ' TON';
            }
            const rarity = Number(match?.rarity_per_mille ?? match?.rarity_permille);
            if (Number.isFinite(rarity) && rarity > 0) {
                panel.querySelector('[data-trait-rarity="' + key + '"]').textContent = money(rarity / 10) + '%';
            }
        }
    } catch {
        // Keep unavailable estimates blank when the market data source is unavailable.
    }
}

detail = function (id) {
    const own = state.page === 'gifts';
    const gift = (own ? state.inventory : state.gifts).find(item => item.id === id);
    if (!gift) return;
    state.detailGift = gift;
    const eyeLabel = telegramGiftLink(gift) ? 'Открыть подарок в Telegram' : 'У подарка пока нет ссылки в Telegram';
    const attributes = [['model', 'Модель', gift.model], ['symbol', 'Узор', gift.symbol], ['backdrop', 'Фон', gift.backdrop]];
    sheet('', `
        <div class="portal-product${own ? ' owned-gift-product' : ''}">
            ${giftPattern(gift)}<img ${giftPicture(gift, true)} alt="${esc(gift.name)}">
            <button type="button" class="gift-telegram-eye" onclick="openTelegramGift()" aria-label="${eyeLabel}" title="${eyeLabel}">${icon('eye')}</button>
            <div><h2><button type="button" class="gift-collection-link" onclick="openGiftCollection()" aria-label="Открыть коллекцию ${esc(gift.name)}">${esc(gift.name)}${icon('chevron')}</button></h2>${gift.number ? `<span>#${esc(gift.number)}</span>` : ''}</div>
        </div>
        <div class="product-properties">
            ${attributes.map(([key, label, value]) => `<div class="trait-row">
                <span>${label}</span><b>${value ? `<button type="button" class="trait-filter" onclick="filterMarketByGiftTrait(${arg(key)})"
                    aria-label="Фильтр маркета: ${esc(label)}, ${esc(value)}">${esc(value)}</button>` : '—'}<small data-trait-rarity="${key}">${Number(gift.rarity?.[key]) > 0 ? money(Number(gift.rarity[key]) / 10) + '%' : ''}</small></b>
                <strong data-trait-price="${key}">—</strong>
            </div>`).join('')}
            <div><span>Мин. цена</span><strong>${esc(productFloor(gift))}</strong></div>
            ${own ? '<div><span>Лучшее предложение</span><strong></strong></div>' : ''}
        </div>
        ${own ? `<div class="product-actions owned-gift-actions">
            <button class="secondary" onclick="toast('Вывод пока недоступен')">Вывод</button>
            <button class="primary" onclick="toast('Продажа пока недоступна')">Продать</button>
        </div>` : `<div class="market-gift-actions">
            ${gift.number && !gift.catalog_only ? `<button class="lucky-craft" onclick="chooseLuckyGift(${arg(gift.id)})">
                <span class="lucky-craft-copy"><strong>Lucky Craft</strong><small>За свои подарки</small></span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3c7-1 14 3 16 10l-1 1c-1-2-3-4-5-5L6 21a1.5 1.5 0 0 1-2-2L13 8C11 6 8 5 5 4Z" fill="currentColor"/></svg>
            </button>` : ''}
            <button id="buy-gift" class="primary" onclick="localBuyGift(${arg(gift.id)})">
            <span>Купить подарок</span><span class="buy-gift-price">${money(gift.price)} ${currencyHTML(gift)}</span>
        </button></div>`}`);
    document.querySelector('#sheet').classList.add('purchase-sheet');
    mountGiftAnimation(document.querySelector('.portal-product'), gift);
    loadGiftAttributePrices(document.querySelector('.product-properties'), gift, attributes);
};

function refreshFilteredPage(){if(state.page==='gifts')renderGifts();else renderMarket()}
const serverFilterGrid=filterGrid;filterGrid=function(){if(state.page!=='gifts')return serverFilterGrid();const original=state.inventory;state.inventory=original.filter(g=>(state.minPrice===''||Number(g.price)>=Number(state.minPrice))&&(state.maxPrice===''||Number(g.price)<=Number(state.maxPrice)));const order=state.order||'listed_at desc';if(order==='price asc'||order==='price desc')state.inventory.sort((a,b)=>(Number(a.price)-Number(b.price))*(order==='price asc'?1:-1));if(order.startsWith('external_collection_number'))state.inventory.sort((a,b)=>(Number(a.number)-Number(b.number))*(order.endsWith('asc')?1:-1));if(order.startsWith('model_rarity'))state.inventory.sort((a,b)=>((a.rarity?.model??Infinity)-(b.rarity?.model??Infinity))*(order.endsWith('asc')?1:-1));try{return serverFilterGrid()}finally{state.inventory=original}};

const localRequestIds=new Map();
function paymentRequestId(key){if(localRequestIds.has(key))return localRequestIds.get(key);let rid;try{rid=sessionStorage.getItem(key)}catch{}if(!rid){if(globalThis.crypto?.randomUUID)rid=crypto.randomUUID();else if(globalThis.crypto?.getRandomValues)rid=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');else rid=Date.now().toString(36)+Math.random().toString(36).slice(2);try{sessionStorage.setItem(key,rid)}catch{}}localRequestIds.set(key,rid);return rid}
function purchaseError(message){let el=document.querySelector('#purchase-error');if(!el){el=document.createElement('p');el.id='purchase-error';el.className='purchase-error';el.setAttribute('role','alert');document.querySelector('#sheet-body')?.appendChild(el)}el.textContent=message}
async function localBuyGift(id){if(state.buying)return;state.buying=true;const button=document.querySelector('#buy-gift');if(button){button.disabled=true;button.setAttribute('aria-busy','true')}document.querySelector('#purchase-error')?.remove();try{const result=await api('local/buy',{id,expected_price:state.detailGift?.price,request_id:paymentRequestId('crafter-purchase:'+state.me.user.id+':'+id)});state.gifts=state.gifts.filter(g=>g.id!==id);state.cart?.delete(id);state.cartSelected?.delete(id);state.me.balance=result.balance;state.me.inventory_count=(state.me.inventory_count||0)+1;state.inventory=[...state.inventory.filter(g=>g.id!==result.gift.id),{...result.gift,status:'unlisted'}];updateBalance();if(typeof saveCart==='function')saveCart();closeSheet();renderMarket();toast('Подарок добавлен в инвентарь')}catch(e){purchaseError(e.message||'Не удалось купить подарок')}finally{state.buying=false;if(button){button.disabled=false;button.removeAttribute('aria-busy')}}}
const inventoryCards=card;card=function(g,action='detail'){let html=inventoryCards(g,action);if(state.page==='gifts'&&action==='detail')html=html.split(`togglePicked(${arg(g.id)})`).join(`detail(${arg(g.id)})`).replace('</article>',`<button class="card-craft" onclick="craftGiftById(${arg(g.id)})">${icon('craft')} Крафт</button></article>`);return html};
function craftGiftById(id){state.selected=[id];state.quote=null;closeSheet();go('craft')}
const inventoryScreen=renderGifts;renderGifts=async function(){await inventoryScreen();document.querySelector('.inventory-actions')?.remove();document.querySelector('.selection-bar')?.remove()};
state.targetOrder='desc';const targetSheet=openCatalogSheet;openCatalogSheet=async function(kind){state.targetOrder='desc';await targetSheet(kind);if(document.querySelector('#catalog-rows')){document.querySelector('.catalog-columns').innerHTML='<span>'+({target:'КОЛЛЕКЦИЯ',collection:'КОЛЛЕКЦИЯ',model:'МОДЕЛЬ',backdrop:'ФОН',symbol:'СИМВОЛ'}[kind]||'')+'</span><button class="target-order" onclick="toggleTargetOrder()">ФЛОР ↓</button>';sortTargets()}};
function sortTargets(){state.catalogRows.sort((a,b)=>(Number(a.price)-Number(b.price))*(state.targetOrder==='desc'?-1:1));renderCatalogRows(document.querySelector('.catalog-search input')?.value||'');const el=document.querySelector('.target-order');if(el)el.textContent='ФЛОР '+(state.targetOrder==='desc'?'↓':'↑')}
function toggleTargetOrder(){state.targetOrder=state.targetOrder==='desc'?'asc':'desc';sortTargets()}
