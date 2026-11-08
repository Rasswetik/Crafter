// Searchable catalog sheets inspired by the mobile Portals interface.
Object.assign(paths, {sortOrder:'M8 19V5m-4 4 4-4 4 4m4-4v14m-4-4 4 4 4-4'});
filters=function(){return `<div class="search"><label class="search-box">${icon('search')}<input aria-label="Быстрый поиск" placeholder="Быстрый поиск" value="${esc(state.query)}" oninput="state.query=this.value;changedFilter()"></label><button class="circle" onclick="state.list=!state.list;filterGrid()" aria-label="Изменить вид">${icon('grid')}</button></div><div class="filter-strip"><button class="sort" onclick="state.sort=!state.sort;changedFilter()" aria-label="Сортировать">${icon('sortOrder')}</button>${[['collection','Коллекция'],['model','Модель'],['backdrop','Фон'],['symbol','Символ']].filter(([key])=>!state.collectionPage||key!=='collection').map(([k,n])=>`<button class="filter-chip ${state[k]?'has-value':''}" onclick="openCatalogSheet('${k}')">${n}${state[k]?`<span>${k==='collection'?selectedCollections().length:selectedTraits(state[k]).length}</span>`:''}${icon('chevron')}</button>`).join('')}</div>`};
function selectedCollections(value = state.collection) {
    return value ? String(value).split(',').filter(Boolean) : [];
}
function selectedTraits(value='') {
    return value ? String(value).split(',').map(v=>v.trim()).filter(Boolean) : [];
}
function matchesSelectedTrait(filter,actual) {
    return !filter || selectedTraits(filter).some(value=>
        value.toLocaleLowerCase()===String(actual||'').toLocaleLowerCase());
}
function resetCatalogDraft() {
    state.sheetValue = '';
    renderCatalogRows(document.querySelector('.catalog-search input').value);
}

const priorSheet=sheet;sheet=function(title,html){document.querySelector('#sheet').classList.remove('catalog-sheet');priorSheet(title,html)};
const CRAFTER_CRAFT_KEYS=new Set(['jingle bells','jungle bells','puff mask','myth mask','resistance dog','desk calendar']);
let catalogCraftOnly=false,catalogPreviousSelection='';
function catalogToggleCraft(){
 if(state.sheetKind!=='collection')return;
 catalogCraftOnly=!catalogCraftOnly;
 if(catalogCraftOnly){
    catalogPreviousSelection=state.sheetValue||'';
    const keys=state.catalogRows.filter(r=>CRAFTER_CRAFT_KEYS.has(String(r.name||'').trim().toLowerCase())).map(r=>String(r.value));
    if(!keys.length){catalogCraftOnly=false;return toast('Крафтовые коллекции пока не загружены');}
    state.sheetValue=keys.join(',');
 }else state.sheetValue=catalogPreviousSelection;
 document.querySelector('.catalog-craft-toggle')?.classList.toggle('active',catalogCraftOnly);
 renderCatalogRows(document.querySelector('.catalog-search input')?.value||'');
}
function catalogPriceGram(r){
 const unit=String(r.unit||r.price_unit||'').toUpperCase();
 const gram=r.floor_gram??r.portal_floor??r.gram_floor;
 const price=unit==='GRAM'?Number(r.price):Number(gram);
 if(Number.isFinite(price)&&price>0)return money(price)+' GRAM';
 const fallback=Number(r.price??r.floor_price);
 if(Number.isFinite(fallback)&&fallback>0)
   return money(fallback)+' '+(unit==='GRAM'?'GRAM':'TON');
 return '—';
}
function catalogVolumeText(r){
 const v=r.volume_24h??r.volume24h??r.volume_24_hours;
 return v!=null&&Number.isFinite(Number(v))?
    'Объём за 24ч: '+money(Number(v))+' GRAM':'Объём за 24ч: —';
}
async function openCatalogSheet(kind){
 const titles={collection:'Коллекция',model:'Модель',backdrop:'Фон',symbol:'Символ',target:'Что скрафтить'};
 let rows=[];const collection=state.catalog.collections.find(c=>c.id===state.collection||c.short_name===state.collection);
 if(kind==='target'){
    try {
        const {collections}=await api('craft/targets');
        rows=collections.map(c=>({value:c.id,name:c.name,image:c.photo_url,price:c.floor_price,unit:'TON'}));
    } catch(e) {toast(e.message);return}
 }
 else if(state.page==='market' && state.marketSource==='crafter'){
    rows=(state.marketFacets?.[kind] || []).map(row => {
        if (kind !== 'collection') return {...row,unit:'GRAM',background:kind==='backdrop' && row.background ? giftBackdrop({backdrop:row.name,background:row.background}) : row.background};
        const matched = state.catalog.collections.find(item =>
            String(item.id) === String(row.value) ||
            giftCollectionSlug(item.name) === giftCollectionSlug(row.name));
        return {...row, unit:'GRAM', image:imageURL(matched?.photo_url) ||
            fragmentCollectionImage(giftCollectionSlug(row.name))};
    });
 }
 else if(kind==='collection') rows=state.catalog.collections.map(c=>({value:c.id,name:c.name,image:c.photo_url,price:c.floor_price,unit:['snapshot','thermos'].includes(state.catalog.source)?'TON':'GRAM'}));
 else if(selectedCollections().length > 1) {toast('Для фильтра по атрибутам выберите одну коллекцию');return}
 else if(kind==='model'&&collection){try{const data=await api('collections/'+encodeURIComponent(collection.short_name||collection.id)+'/models');rows=data.models.map(m=>({value:m.name,name:m.name,image:m.image,price:m.price,unit:m.price_unit|| (m.price_source==='snapshot-estimate'?'TON':'GRAM')}))}catch(e){toast(e.message);return}}
 else if(collection){try{const attrs=await api('collections/'+encodeURIComponent(collection.id)+'/attributes'+(kind==='backdrop'?'?source=portals':''));const group=attrs[kind==='backdrop'?'backdrops':'symbols']||[];rows=group.map(m=>({value:m.name,name:m.name,image:m.image_url,background:kind==='backdrop'?giftBackdrop({backdrop:m.name,background:m}):'',price:m.portal_floor??Number(m.stats?.floor||0)/1e9,unit:m.portal_floor!=null?'GRAM':'TON'}))}catch(e){toast(e.message);return}}
 state.catalogRows=rows;state.sheetKind=kind;state.sheetValue=kind==='target'?'':state[kind]||'';
 catalogCraftOnly=false;
 sheet(titles[kind],`<div class="catalog-search-row"><label class="catalog-search search-box">${icon('search')}<input placeholder="Быстрый поиск" aria-label="Быстрый поиск" oninput="renderCatalogRows(this.value)"></label>${kind==='collection'?'<button type="button" class="catalog-craft-toggle" aria-label="Крафтовые коллекции" title="Крафтовые коллекции" onclick="catalogToggleCraft()"><svg viewBox="0 0 9 9" fill="currentColor" aria-hidden="true"><path d="M7.95567 3.80395C8.01856 3.80395 8.06973 3.8544 8.0699 3.91695V4.22956C8.0699 4.4209 8.22586 4.57601 8.41802 4.57601H8.5642C8.62714 4.57601 8.67843 4.62705 8.67843 4.68969C8.67836 5.18975 8.26981 5.59641 7.76733 5.59641H7.48244C6.71947 5.59645 5.89006 5.81967 5.89006 6.57892C5.89019 7.04269 6.24429 7.28531 6.6656 7.46461C6.87737 7.55473 7.10798 7.58984 7.3383 7.58984C7.40107 7.58999 7.45168 7.64044 7.45185 7.70285V8.88632C7.4519 8.94893 7.40117 8.99985 7.3383 9H1.83432C1.77132 9 1.72009 8.94896 1.72009 8.88632V7.70285C1.72026 7.6403 1.77143 7.58984 1.83432 7.58984C2.06419 7.58984 2.29609 7.55787 2.50266 7.4575C2.87029 7.27887 3.10501 7.0366 3.10509 6.57892C3.10509 5.81969 2.44693 5.59646 1.68405 5.59641H1.4046C0.594559 5.59641 0.297949 4.57601 0.607734 4.57601H3.2472C3.43946 4.57601 3.59532 4.4209 3.59532 4.22956V3.91695C3.59549 3.8544 3.64666 3.80395 3.70955 3.80395H7.95567Z"/><path d="M4.97285 0.00383804C5.02295 -0.00939743 5.07566 0.0123659 5.10135 0.057294C5.11456 0.0804938 5.27837 0.372394 5.45695 0.886876C5.66429 0.847304 5.98074 0.928422 6.0648 1.24077C6.12985 1.48243 6.21586 1.66992 6.0886 1.88901C6.02222 2.00326 5.89125 2.08402 5.77923 2.12381C5.82924 2.39628 5.87143 2.69229 5.89822 3.01023C5.9029 3.06496 5.86726 3.11511 5.81391 3.12932L4.81918 3.39119C4.77585 3.39119 4.73509 3.36611 4.71583 3.32555C4.5788 3.03579 4.46558 2.75767 4.37179 2.49597L1.1204 3.36344C1.06679 3.37775 1.01117 3.38442 0.955855 3.38442C0.209208 3.3841 0.0804571 2.32629 0.789954 2.13666L4.03183 1.27189C3.9272 0.735234 3.92257 0.399333 3.92236 0.37194C3.92196 0.320222 3.95657 0.275063 4.00667 0.261645L4.97285 0.00383804Z"/></svg></button>':''}</div><div class="catalog-columns"><span>${kind==='target'?'КОЛЛЕКЦИЯ':titles[kind]}</span><span>Мин. цена / объём 24ч</span></div><div id="catalog-rows" class="catalog-rows"></div>${kind==='target'?'':`<div class="catalog-footer"><button onclick="resetCatalogDraft()">Сбросить</button><button class="apply" onclick="applyCatalogFilter()">Применить</button></div>`}`);
 document.querySelector('#sheet').classList.add('catalog-sheet');renderCatalogRows('');
 if(kind==='collection'&&state.page==='market'&&state.marketSource==='crafter'){
    api('market/collection-volumes').then(data=>{
      if(state.sheetKind!=='collection'||!document.querySelector('#catalog-rows'))return;
      const volumes=data.volumes||{};
      state.catalogRows=state.catalogRows.map(r=>({...r,volume_24h:volumes[String(r.name||'').toLowerCase().trim()]??0}));
      renderCatalogRows(document.querySelector('.catalog-search input')?.value||'');
    }).catch(()=>{});
 }
}
function catalogCollectionForArtwork(row) {
    const selected=selectedCollections();
    const candidates=state.catalog?.collections||[];
    const same=(a,b)=>String(a||'').toLocaleLowerCase()===String(b||'').toLocaleLowerCase();
    const exact=row.collection_name && candidates.find(c=>same(c.name,row.collection_name));
    return exact || candidates.find(c=>same(c.id,row.value)||same(c.name,row.name)) ||
        (selected.length===1 ? candidates.find(c=>selected.some(v=>same(c.id,v)||same(c.name,v))) : null);
}
// Only isolated model/symbol PNGs may be shown inside attribute filter rows.
function catalogTraitPNG(kind, collectionName, name) {
    if(!['model','symbol'].includes(kind)||!collectionName||!name)return '';
    return '/media/trait/'+kind+'?gift='+encodeURIComponent(collectionName)+'&name='+encodeURIComponent(name);
}
function catalogArtworkURLs(row) {
    const kind=state.sheetKind;
    const collection=catalogCollectionForArtwork(row);
    const name=row.collection_name||collection?.name||
        ((kind==='collection'||kind==='target')?row.name:'');
    if(kind==='collection'||kind==='target'){
        const slug=giftCollectionSlug(name);
        return [...new Set([fragmentCollectionImage(slug),
            directFragmentCollectionImage(slug),imageURL(collection?.photo_url||row.image)].filter(Boolean))];
    }
    if(kind==='model'||kind==='symbol'){
        const matches=[...(state.inventory||[]),...(state.gifts||[])].filter(g=>
            String(g[kind]||'').toLocaleLowerCase()===String(row.name||'').toLocaleLowerCase());
        const collections=[...new Set(matches.map(g=>String(g.name||'')).filter(Boolean))];
        const giftName=name||(collections.length===1?collections[0]:'');
        if(!giftName)return [];
        const part=value=>encodeURIComponent(String(value).trim());
        return [...new Set([
            catalogTraitPNG(kind,giftName,row.name),
            'https://api.changes.tg/'+kind+'/'+part(giftName)+'/'+part(row.name)+'.png?size=128'
        ].filter(Boolean))];
    }
    return [];
}
function catalogRowArtwork(row) {
    const kind = state.sheetKind;
    const urls = catalogArtworkURLs(row);
    const backgroundColor = kind==='backdrop' && (typeof row.background==='string' ? row.background :
        row.background ? giftBackdrop({backdrop:row.name,background:row.background}) :
        giftBackdrop({backdrop:row.name}));
    const background = backgroundColor &&
        /^(?:linear-gradient|radial-gradient|#[0-9a-f]{3,8}|rgb|hsl)/i.test(backgroundColor) ?
        ' style="background:'+esc(backgroundColor)+'"' : '';
    const img = urls.length ?
        '<img loading="lazy" src="'+esc(urls[0])+'" data-gift-fallback="'+
            esc(JSON.stringify(urls.slice(1)))+
            '" alt="" onerror="nextGiftPicture(this)">' : '';
    return '<span class="catalog-thumb catalog-thumb-'+esc(kind)+'"'+background+'>'+img+'</span>';
}
function renderCatalogRows(query){
    const target=document.querySelector('#catalog-rows');if(!target)return;
    const rows=state.catalogRows.filter(r=>String(r.name||'').toLowerCase().includes(String(query||'').toLowerCase())&&
       (!catalogCraftOnly||CRAFTER_CRAFT_KEYS.has(String(r.name||'').trim().toLowerCase())));
    target.innerHTML=rows.length?rows.map(r=>
        '<button class="catalog-row" onclick="pickCatalogRow('+arg(r.value)+')">'+
        (state.sheetKind==='target'?'':'<span class="catalog-check '+(catalogRowSelected(r.value)?'checked':'')+'">'+
            (catalogRowSelected(r.value)?'✓':'')+'</span>')+
        catalogRowArtwork(r)+'<strong>'+esc(r.name)+'</strong>'+
        '<span class="catalog-value"><b>'+catalogPriceGram(r)+'</b><small>'+
        (state.sheetKind==='collection'?catalogVolumeText(r):'')+
        '</small></span></button>').join(''):
        '<div class="catalog-empty">'+(state.sheetKind!=='collection'&&!state.collection?
            'Сначала выберите коллекцию':'Нет доступных данных')+'</div>';
}
function catalogRowSelected(value) {
    const choices=state.sheetKind==='collection' ?
        selectedCollections(state.sheetValue) : selectedTraits(state.sheetValue);
    return choices.includes(String(value));
}
function pickCatalogRow(value) {
    if (state.sheetKind==='target') {
        const row=state.catalogRows.find(item=>item.value===value);
        if(row){
            state.target={id:row.value,name:row.name,image:row.image};
            state.quote=null;
            closeSheet();renderCraft();updateCraftQuote();
        }
        return;
    }
    const values=state.sheetKind==='collection' ?
        selectedCollections(state.sheetValue) : selectedTraits(state.sheetValue);
    const chosen=new Set(values);
    if(chosen.has(String(value)))chosen.delete(String(value));
    else if(chosen.size<20)chosen.add(String(value));
    else return toast('Можно выбрать до 20 значений');
    state.sheetValue=[...chosen].sort((a,b)=>a.localeCompare(b,'ru')).join(',');
    renderCatalogRows(document.querySelector('.catalog-search input')?.value||'');
}
function applyCatalogFilter(){const k=state.sheetKind;if(k==='collection'&&state.collection!==state.sheetValue){state.model='';state.backdrop='';state.symbol=''}state[k]=state.sheetValue;closeSheet();if(state.page==='market')renderMarket();else renderGifts();changedFilter()}
function craftRules(){const internal=state.target?.listingId?.startsWith('crafter-');sheet('Как работает крафт',`<div class="attributes"><div><span>Оценка подарков</span><b>${internal ? 'Оценка в GRAM' : 'Флор коллекции в TON'}</b></div><div><span>Шанс</span><b>${internal ? 'Оценка подарков / цена лота × 95%' : 'Сумма флоров / флор цели × 95%'}</b></div><div><span>Максимальный шанс</span><b>95%</b></div></div><p class="sub">Выбранные подарки списываются. При успехе результат появляется в инвентаре Crafter. Операция работает с подарками приложения; передачу NFT в Telegram она не выполняет.</p><button class="primary" onclick="closeSheet()">Понятно</button>`)}
function renderCraft() {
    const gifts = state.selected.map(id => state.inventory.find(gift =>
        gift.id === id && gift.status === 'unlisted'
    )).filter(Boolean).slice(0, CRAFT_GIFT_LIMIT);
    state.selected = gifts.map(gift => gift.id);
    saveCraftDraft();
    const quote = state.quote?.key === craftQuoteKey(state.selected, state.target?.id, state.target?.listingId) ? state.quote : null;
    const pending = !quote && gifts.length > 0 && Boolean(state.target);
    const chance = quote?.chance ?? (pending ? null : 0);
    // Preserve a running event GIF across quote/slot updates.
    const previousBanner = document.querySelector('#craft-event-banner .ice-banner-stage');
    const previousSignature = document.getElementById('craft-event-banner')?.dataset.bannerSignature || '';
    document.querySelector('#main').innerHTML = `
        <section class="craft-page">
            <div class="arena-event-banner-slot craft-event-banner" id="craft-event-banner" hidden></div>
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
    if(previousBanner) {
        const container=document.getElementById('craft-event-banner');
        if(container){
            container.append(previousBanner);
            container.hidden=false;
            container.dataset.bannerSignature=previousSignature;
        }
    }
    if(typeof crafterCraftBannerMount==='function')crafterCraftBannerMount('craft-event-banner');
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
filters=function(){return `<div class="search"><label class="search-box">${icon('search')}<input aria-label="Быстрый поиск" placeholder="Быстрый поиск" value="${esc(state.query)}" oninput="state.query=this.value;changedFilter()"></label><button class="circle" onclick="state.list=!state.list;filterGrid()" aria-label="Изменить вид">${icon('grid')}</button></div><div class="filter-strip"><button class="sort" onclick="openPriceFilters()" aria-label="Диапазон цены">${icon('filter')}</button><button class="sort ${state.order!=='listed_at desc'?'enabled':''}" onclick="openSort()" aria-label="Сортировка">${icon('sortOrder')}</button><span class="filter-divider"></span>${[['collection','Коллекция'],['model','Модель'],['backdrop','Фон'],['symbol','Символ']].filter(([key])=>!state.collectionPage||key!=='collection').map(([k,n])=>`<button class="filter-chip ${state[k]?'has-value':''}" onclick="openCatalogSheet('${k}')">${n}${state[k]?`<span>${k==='collection'?selectedCollections().length:selectedTraits(state[k]).length}</span>`:''}${icon('chevron')}</button>`).join('')}</div>`};
renderMarket=function(){document.querySelector('#main').innerHTML=`${resaleMarketTabs()}${filters()}<div id="gifts-grid" class="grid"></div><button class="load-more" onclick="loadMore()">Показать ещё</button>${demoNote()}`;filterGrid()};
marketParams=function(offset=0){const p=new URLSearchParams({offset:String(offset),sort_by:state.order,price_unit:state.marketUnit||'GRAM'});if(state.marketSource==='crafter')p.set('source','crafter');for(const [key,value] of [['search',state.query],['collection_id',state.collection],['filter_by_models',state.model],['filter_by_backdrops',state.backdrop],['filter_by_symbols',state.symbol],['min_price',state.minPrice],['max_price',state.maxPrice]])if(value!==''&&value!=null)p.set(key,value);return p};
function openSort(){state.draftOrder=state.order;sheet('Сортировка',`<div class="sort-options">${sortOptions.map(([v,n])=>`<button class="sort-option" onclick="chooseSort(${arg(v)})" data-order="${esc(v)}"><span class="sort-radio ${v===state.draftOrder?'checked':''}"></span>${n}</button>`).join('')}</div><button class="primary sort-apply" onclick="applySort()">Применить</button>`);document.querySelector('#sheet').classList.add('sort-sheet')}
function chooseSort(v){state.draftOrder=v;document.querySelectorAll('.sort-option').forEach(el=>el.querySelector('.sort-radio').classList.toggle('checked',el.dataset.order===v))}
function applySort(){state.order=state.draftOrder;state.sort=false;closeSheet();if(state.page==='market')renderMarket();changedFilter()}
function openPriceFilters(){sheet('Цена',`<p class="sub">Диапазон цены, ${esc(state.page==="gifts"?"GRAM":state.marketUnit||"GRAM")}</p><div class="price-fields"><label>От<input id="price-min" inputmode="decimal" type="number" min="0" step="0.01" placeholder="0" value="${esc(state.minPrice)}"></label><label>До<input id="price-max" inputmode="decimal" type="number" min="0" step="0.01" placeholder="Без лимита" value="${esc(state.maxPrice)}"></label></div><div class="catalog-footer"><button onclick="state.minPrice='';state.maxPrice='';closeSheet();refreshFilteredPage();changedFilter()">Сбросить</button><button class="apply" onclick="applyPriceFilters()">Применить</button></div>`);document.querySelector('#sheet').classList.add('price-sheet')}
function applyPriceFilters(){const min=document.querySelector('#price-min').value,max=document.querySelector('#price-max').value;if((min&&(!Number.isFinite(Number(min))||Number(min)<0))||(max&&(!Number.isFinite(Number(max))||Number(max)<0))||(min&&max&&Number(min)>Number(max)))return toast('Укажите корректный диапазон цены');state.minPrice=min;state.maxPrice=max;closeSheet();refreshFilteredPage();changedFilter()}
const themedSheet=sheet;sheet=function(t,h){document.querySelector('#sheet').classList.remove('sort-sheet','price-sheet','purchase-sheet','offer-sheet');themedSheet(t,h)};
nav=function(){document.querySelector('#nav').innerHTML=`<div class="nav-main">${[['market','market','Маркет'],['gifts','inventoryNav','Мои подарки'],['craft','craft','Крафт']].map(([p,i,n])=>`<button class="${state.page===p?'active':''}" onclick="go('${p}')" aria-label="${n}">${icon(i)}<span>${n}</span></button>`).join('')}</div><button class="profile-nav ${['profile','admin'].includes(state.page)?'active':''}" onclick="go(state.page==='profile'?'market':'profile')" aria-label="Профиль"><span class="avatar">${avatar()}</span></button>`};
Object.assign(paths, {
    market:'M5 20V9a7 7 0 0 1 14 0v11l-4-2-3 3-3-3-4 2Zm5-5V9a2 2 0 0 1 4 0v6',
    inventoryNav:'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9C5 9 6 3 9 4c2 1 3 5 3 5Zm0 0c7 0 6-6 3-5-2 1-3 5-3 5Z',
    eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z' });

function telegramGiftLink(gift) {
    if (/^https:\/\/t\.me\/nft\/[a-z0-9]+-[1-9]\d*$/i.test(gift.telegram_url || '')) {
        return gift.telegram_url;
    }
    const local = ['application-craft', 'admin-grant', 'local-purchase'].includes(gift.origin);
    const number = String(gift.source_number ?? (local ? '' : gift.number ?? ''));
    const slug = gift.name.normalize('NFKD').replace(/[^a-z0-9]/gi, '');
    return slug && /^[1-9]\d*$/.test(number) ? 'https://t.me/nft/' + slug + '-' + number : '';
}

function productFloor(gift) {
    if (Number(gift.crafter_floor_gram) > 0) return money(gift.crafter_floor_gram) + ' GRAM';
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
    const gift = state.gifts.find(item => item.id === id) || (state.detailGift?.id === id ? state.detailGift : null);
    if (!gift?.number || gift.catalog_only || gift.own_listing) return toast('Лот недоступен для Lucky Craft');
    const targetId = gift.resale ? String(gift.collection_id || giftCollectionSlug(gift.name)) : giftCollection(gift)?.id;
    if (!targetId) return toast('Лот недоступен для Lucky Craft');
    state.target = {id:targetId, listingId:gift.id, number:gift.number, name:gift.name, image:gift.image};
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
    if (gift) showGiftDetail(gift, own ? 'inventory' : 'market');
};

function showGiftDetail(gift, source) {
    const own = source === 'inventory';
    const listed = own && gift.status === 'listed';
    state.detailGift = gift;
    const attributes = [['model', 'Модель', gift.model], ['symbol', 'Узор', gift.symbol], ['backdrop', 'Фон', gift.backdrop]];
    sheet('', `
        <div class="portal-product${own ? ' owned-gift-product' : ''}">
            ${giftPattern(gift)}<img ${giftPicture(gift)} alt="${esc(gift.name)}" decoding="async">
            <div class="gift-detail-tools" role="group" aria-label="Действия с подарком">
                ${own && gift.status === 'unlisted' && !gift.test_only && !gift.catalog_only ? `<button type="button" class="gift-detail-tool gift-send-tool"
                    onclick="startGiftTransfer(${arg(gift.id)})" aria-label="Отправить подарок" title="Отправить подарок">
                    ${crafterTelegramPlaneSVG()}
                </button>` : ''}
                <button type="button" class="gift-detail-tool gift-eye-tool"
                    onclick="openGiftTelegramView()" aria-label="Посмотреть NFT в Telegram"
                    title="Посмотреть в Telegram" ${telegramGiftLink(gift) ? '' : 'disabled'}>
                    ${crafterGiftEyeSVG()}
                </button>
                <button type="button" class="gift-detail-tool gift-share-tool"
                    onclick="shareDetailGift()" aria-label="Поделиться подарком в Telegram"
                    title="Поделиться">
                    ${crafterGiftShareSVG()}
                </button>
            </div>
            <div><h2><button type="button" class="gift-collection-link" onclick="openGiftCollection()" aria-label="Открыть коллекцию ${esc(gift.name)}">${esc(gift.name)}${icon('chevron')}</button></h2>${gift.number ? `<span>#${esc(gift.number)}</span>` : ''}</div>
        </div>
        <div class="product-properties">
            ${attributes.map(([key, label, value]) => `<div class="trait-row">
                <span>${label}</span><b>${value ? `<button type="button" class="trait-filter" onclick="filterMarketByGiftTrait(${arg(key)})"
                    aria-label="Фильтр маркета: ${esc(label)}, ${esc(value)}">${esc(value)}</button>` : '—'}<small data-trait-rarity="${key}">${Number(gift.rarity?.[key]) > 0 ? money(Number(gift.rarity[key]) / 10) + '%' : ''}</small></b>
                <strong data-trait-price="${key}">—</strong>
            </div>`).join('')}
            <div><span>Мин. цена</span><strong>${esc(productFloor(gift))}</strong></div>
            ${listed ? `<div class="owned-listing-price"><span>Цена продажи</span><strong>${money(gift.listing_price ?? gift.price)} GRAM</strong>
                <button type="button" onclick="startResale('edit', ${arg(gift.id)})">Редактировать</button></div>` : ''}
        </div>
        ${listed ? `<button class="primary" onclick="startResale('unlist', ${arg(gift.id)})">Снять с продажи</button>` : own && gift.test_only ? `<div class="ny-footnote">Тестовый подарок в инвентаре Crafter. Вывод и продажа недоступны.</div>` : own ? `<div class="product-actions owned-gift-actions">
            <button class="secondary" onclick="requestGiftWithdrawal(${arg(gift.id)})">Вывести NFT</button>
            <button class="primary" onclick="startResale('sell', ${arg(gift.id)})">Продать</button>
        </div>` : source === 'market' ? `<div class="market-gift-actions market-offer-actions">
            ${gift.own_listing ? `<button class="primary" onclick="openListedInventory()">Управлять в инвентаре</button>` : `
                ${gift.number && !gift.catalog_only ? `<button type="button" class="lucky-craft" onclick="chooseLuckyGift(${arg(gift.id)})">
                    ${crafterLuckyActionSVG()} <strong>Lucky Craft</strong>
                </button>` : ''}
                <div class="market-offer-primary">
                    <button type="button" class="secondary" onclick="openPersonalOffer()">
                        <span>Make Offer</span><small data-offer-button-fee>0.01 GRAM</small>
                    </button>
                    <button type="button" id="buy-gift" class="primary" onclick="localBuyGift(${arg(gift.id)})">
                        <span>Buy Gift</span><span class="buy-gift-price">${money(gift.price)} ${currencyHTML(gift)}</span>
                    </button>
                </div>`}</div>` : ''}`);
    document.querySelector('#sheet').classList.add('purchase-sheet');
    // Show the already-known gift immediately; network estimates and animation never block opening.
    const panel = document.querySelector('#sheet-body .product-properties');
    const art = document.querySelector('#sheet-body .portal-product');
    const feeLabel = document.querySelector('#sheet-body [data-offer-button-fee]');
    if (feeLabel) api('offers').then(data => {
        if (feeLabel.isConnected && state.detailGift === gift) {
            feeLabel.textContent = money(data.fee_gram) + ' GRAM';
        }
    }).catch(() => {});
    requestAnimationFrame(() => {
        setTimeout(() => {
            if (!panel?.isConnected || !art?.isConnected || state.detailGift !== gift) return;
            loadGiftAttributePrices(panel, gift, attributes);
            mountGiftAnimation(art, gift, null, own); // Auto-play TGS for owned gift details.
        }, 40);
    });
};

function refreshFilteredPage(){if(state.page==='gifts')renderGifts();else renderMarket()}
const serverFilterGrid=filterGrid;filterGrid=function(){if(state.page!=='gifts')return serverFilterGrid();const original=state.inventory;state.inventory=original.filter(g=>(state.minPrice===''||Number(g.price)>=Number(state.minPrice))&&(state.maxPrice===''||Number(g.price)<=Number(state.maxPrice)));const order=state.order||'listed_at desc';if(order==='price asc'||order==='price desc')state.inventory.sort((a,b)=>(Number(a.price)-Number(b.price))*(order==='price asc'?1:-1));if(order.startsWith('external_collection_number'))state.inventory.sort((a,b)=>(Number(a.number)-Number(b.number))*(order.endsWith('asc')?1:-1));if(order.startsWith('model_rarity'))state.inventory.sort((a,b)=>((a.rarity?.model??Infinity)-(b.rarity?.model??Infinity))*(order.endsWith('asc')?1:-1));try{return serverFilterGrid()}finally{state.inventory=original}};

const localRequestIds=new Map();
function paymentRequestId(key){if(localRequestIds.has(key))return localRequestIds.get(key);let rid;try{rid=sessionStorage.getItem(key)}catch{}if(!rid){if(globalThis.crypto?.randomUUID)rid=crypto.randomUUID();else if(globalThis.crypto?.getRandomValues)rid=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');else rid=Date.now().toString(36)+Math.random().toString(36).slice(2);try{sessionStorage.setItem(key,rid)}catch{}}localRequestIds.set(key,rid);return rid}
function purchaseError(message){let el=document.querySelector('#purchase-error');if(!el){el=document.createElement('p');el.id='purchase-error';el.className='purchase-error';el.setAttribute('role','alert');document.querySelector('#sheet-body')?.appendChild(el)}el.textContent=message}
async function localBuyGift(id) {
    if (state.buying) return;
    const gift = state.detailGift;
    if (!gift || gift.id !== id || gift.own_listing) return;
    state.buying = true;
    const button = document.querySelector('#buy-gift');
    if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
    }
    document.querySelector('#purchase-error')?.remove();
    const requestKey = 'crafter-purchase:' + state.me.user.id + ':' + id + (gift.resale ? ':' + gift.price : '');
    try {
        const testing = Boolean(state.me.market_test_purchases && !gift.resale);
        const portal = !testing && !state.me.demo && !gift.resale;
        if (portal && (gift.price_unit !== 'GRAM' || !/^[a-f0-9-]{36}$/i.test(id))) {
            throw Error('Нужен действующий лот Portals с ценой в GRAM');
        }
        const result = await api(testing ? 'market/test/buy' : gift.resale ? 'resale/buy' : state.me.demo ? 'local/buy' : 'portals/buy',
            (portal || testing) ? {gift_ids:[id],expected_total:String(gift.price),request_id:paymentRequestId(requestKey)}
                   : {id,expected_price:gift.price,request_id:paymentRequestId(requestKey)});
        if (portal && result.status !== 'complete') throw Error('Покупка Portals требует проверки; не отправляйте её снова');
        const bought = result.gift || result.gifts?.[0];
        if (!bought) throw Error('Portals не подтвердил покупку подарка');
        removePurchasedMarketLots([id]);
        if (marketActivityVisible()) refreshMarketActivity();
        state.me.balance = result.balance;
        state.me.inventory_count = (state.me.inventory_count || 0) + 1;
        state.inventory = [...state.inventory.filter(item => item.id !== bought.id), {...bought,status:'unlisted'}];
        updateBalance();
        if (button?.isConnected) closeSheet();
        toast(testing?'Подарок добавлен в тестовый инвентарь':portal?'Portals подтвердил покупку. NFT находится на партнёрском хранении.':'Подарок добавлен в инвентарь');
    } catch (e) {
        if (button?.isConnected) purchaseError(e.message || 'Не удалось купить подарок');
        if (gift.resale && e.status === 409 && state.page === 'market') changedFilter();
    } finally {
        state.buying = false;
        if (button) {
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
    }
}


async function requestGiftWithdrawal(id) {
    if (!state.detailGift || state.detailGift.id !== id) return;
    if (!confirm('Создать заявку на вывод этого NFT в Telegram? Подарок будет заморожен до завершения передачи на Relayer.')) return;
    const gift=state.detailGift;
    try {
        const isPartner=gift.origin==='portals-partner';
        const request_id=paymentRequestId('gift-withdraw:'+state.me.user.id+':'+id);
        await api(isPartner?'portals/withdraw':'gifts/withdraw',{gift_id:id,request_id});
        state.inventory=state.inventory.map(item=>item.id===id?{...item,status:'withdrawing'}:item);
        closeSheet();
        toast('Заявка отправлена. Подарок заблокирован до подтверждения вывода.');
        if(state.page==='gifts') go('gifts');
    }catch(e){toast(e.message)}
}
function craftGiftById(id){state.selected=[id];state.quote=null;closeSheet();go('craft')}

state.targetOrder='desc';const targetSheet=openCatalogSheet;openCatalogSheet=async function(kind){state.targetOrder='desc';await targetSheet(kind);if(document.querySelector('#catalog-rows')){document.querySelector('.catalog-columns').innerHTML='<span>'+({target:'КОЛЛЕКЦИЯ',collection:'КОЛЛЕКЦИЯ',model:'МОДЕЛЬ',backdrop:'ФОН',symbol:'СИМВОЛ'}[kind]||'')+'</span><button class="target-order" onclick="toggleTargetOrder()">ФЛОР ↓</button>';sortTargets()}};
function sortTargets(){
    const descending=state.targetOrder==='desc';
    state.catalogRows.sort((a,b)=>{
        const left=Number(a.price)||0, right=Number(b.price)||0;
        if(left<=0||right<=0) return Number(right>0)-Number(left>0);
        return descending?right-left:left-right;
    });
    renderCatalogRows(document.querySelector('.catalog-search input')?.value||'');
    const order=document.querySelector('.target-order');
    if(order)order.textContent='ФЛОР '+(descending?'↓':'↑');
}
function toggleTargetOrder(){state.targetOrder=state.targetOrder==='desc'?'asc':'desc';sortTargets()}
