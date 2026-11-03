// Searchable catalog sheets inspired by the mobile Portals interface.
filters=function(){return `<div class="search"><label class="search-box">${icon('search')}<input aria-label="Быстрый поиск" placeholder="Быстрый поиск" value="${esc(state.query)}" oninput="state.query=this.value;changedFilter()"></label><button class="circle" onclick="state.list=!state.list;filterGrid()" aria-label="Изменить вид">${icon('grid')}</button></div><div class="filter-strip"><button class="sort" onclick="state.sort=!state.sort;changedFilter()" aria-label="Сортировать">↕</button>${[['collection','Коллекция'],['model','Модель'],['backdrop','Фон'],['symbol','Символ']].map(([k,n])=>`<button class="filter-chip ${state[k]?'has-value':''}" onclick="openCatalogSheet('${k}')">${n}${state[k]?'<span>1</span>':''}${icon('chevron')}</button>`).join('')}</div>`};
const priorSheet=sheet;sheet=function(title,html){document.querySelector('#sheet').classList.remove('catalog-sheet');priorSheet(title,html)};
const priorClose=closeSheet;closeSheet=function(){document.querySelector('#sheet').classList.remove('catalog-sheet');priorClose()};
async function openCatalogSheet(kind){
 const titles={collection:'Коллекция',model:'Модель',backdrop:'Фон',symbol:'Символ',target:'Что скрафтить'};
 let rows=[];const collection=state.catalog.collections.find(c=>c.id===state.collection||c.short_name===state.collection);
 if(kind==='collection'||kind==='target') rows=state.catalog.collections.map(c=>({value:c.id,name:c.name,image:c.photo_url,price:c.floor_price,unit:['snapshot','thermos'].includes(state.catalog.source)?'TON':'GRAM'}));
 else if(kind==='model'&&collection){try{const data=await api('collections/'+encodeURIComponent(collection.short_name||collection.id)+'/models');rows=data.models.map(m=>({value:m.name,name:m.name,image:m.image,price:m.price,unit:m.price_unit|| (m.price_source==='snapshot-estimate'?'TON':'GRAM')}))}catch(e){toast(e.message);return}}
 else if(collection){try{const attrs=await api('collections/'+encodeURIComponent(collection.id)+'/attributes');const group=attrs[kind==='backdrop'?'backdrops':'symbols']||[];rows=group.map(m=>({value:m.name,name:m.name,image:m.image_url,price:Number(m.stats?.floor||0)/1e9,unit:'TON'}))}catch(e){toast(e.message);return}}
 state.catalogRows=rows;state.sheetKind=kind;state.sheetValue=kind==='target'?'':state[kind]||'';
 sheet(titles[kind],`<label class="catalog-search search-box">${icon('search')}<input placeholder="Быстрый поиск" aria-label="Быстрый поиск" oninput="renderCatalogRows(this.value)"></label><div class="catalog-columns"><span>${kind==='target'?'КОЛЛЕКЦИЯ':titles[kind]}</span><span>Мин. цена</span></div><div id="catalog-rows" class="catalog-rows"></div>${kind==='target'?'':`<div class="catalog-footer"><button onclick="state.sheetValue='';renderCatalogRows(document.querySelector('.catalog-search input').value)">Сбросить</button><button class="apply" onclick="applyCatalogFilter()">Применить</button></div>`}`);
 document.querySelector('#sheet').classList.add('catalog-sheet');renderCatalogRows('');
}
function renderCatalogRows(query){const rows=state.catalogRows.filter(r=>r.name.toLowerCase().includes(query.toLowerCase()));document.querySelector('#catalog-rows').innerHTML=rows.length?rows.map(r=>`<button class="catalog-row" onclick="pickCatalogRow(${arg(r.value)})">${state.sheetKind==='target'?'':`<span class="catalog-check ${state.sheetValue===r.value?'checked':''}">${state.sheetValue===r.value?'✓':''}</span>`}<span class="catalog-thumb">${r.image?`<img loading="lazy" src="${esc(imageURL(r.image))}" alt="">`:''}</span><strong>${esc(r.name)}</strong><b>${r.price!=null&&Number(r.price)>0?money(r.price)+' '+esc(r.unit):'—'}</b></button>`).join(''):`<div class="catalog-empty">${state.sheetKind!=='collection'&&!state.collection?'Сначала выберите коллекцию':'Нет доступных данных'}</div>`}
function pickCatalogRow(value){if(state.sheetKind==='target'){const c=state.catalog.collections.find(x=>x.id===value);if(c){state.target={id:c.id,name:c.name,image:c.photo_url};state.quote=null;closeSheet();renderCraft();updateCraftQuote()}return}state.sheetValue=state.sheetValue===value?'':value;renderCatalogRows(document.querySelector('.catalog-search input').value)}
function applyCatalogFilter(){const k=state.sheetKind;if(k==='collection'&&state.collection!==state.sheetValue){state.model='';state.backdrop='';state.symbol=''}state[k]=state.sheetValue;closeSheet();if(state.page==='market')renderMarket();else renderGifts();changedFilter()}
function craftRules(){sheet('Как работает крафт',`<div class="attributes"><div><span>Оценка подарков</span><b>Флор коллекции в TON</b></div><div><span>Шанс</span><b>Сумма флоров / флор цели × 95%</b></div><div><span>Максимальный шанс</span><b>95%</b></div></div><p class="sub">Выбранные подарки списываются. При успехе результат появляется в инвентаре Crafter. Операция работает с подарками приложения; передачу NFT в Telegram она не выполняет.</p><button class="primary" onclick="closeSheet()">Понятно</button>`)}
function renderCraft() {
    const gifts = state.selected.map(id => state.inventory.find(gift =>
        gift.id === id && gift.status === 'unlisted'
    )).filter(Boolean).slice(0, CRAFT_GIFT_LIMIT);
    state.selected = gifts.map(gift => gift.id);
    saveCraftDraft();
    const quote = state.quote?.key === craftQuoteKey(state.selected, state.target?.id) ? state.quote : null;
    const chance = quote?.chance || 0;
    document.querySelector('#main').innerHTML = `
        <section class="craft-page">
            <div class="craft-title"><button class="info-btn" onclick="craftRules()">i</button></div>
            <div class="forge" id="forge">
                ${Array.from({length: CRAFT_GIFT_LIMIT}, (_, index) => slot(index, gifts)).join('')}
                <div class="anvil">
                    <svg class="chance-ring" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="49"/>
                        <circle class="chance-value" cx="60" cy="60" r="49" style="stroke-dasharray:${chance / 100 * 308} 308"/>
                    </svg>
                    ${anvilArt()}<strong>${money(chance)}%</strong>
                </div>
            </div>
            <div class="craft-caption">Добавьте до <b>${CRAFT_GIFT_LIMIT} подарков</b>, чтобы скрафтить</div>
            <button class="target" onclick="chooseTarget()">${state.target ?
                `<img src="${esc(imageURL(state.target.image))}" alt="">${esc(state.target.name)}` :
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

const craftQuoteKey = (ids, target) => JSON.stringify([target, ids]);
let pendingCraftQuote;

function getCraftQuote(ids, target) {
    const key = craftQuoteKey(ids, target);
    if (state.quote?.key === key && state.quote.expires_at > Date.now() / 1000) {
        return Promise.resolve(state.quote);
    }
    if (pendingCraftQuote?.key === key) return pendingCraftQuote.promise;

    const pending = {key};
    pending.promise = api('craft/quote', {gift_ids: ids, target_id: target})
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
    if (!ids.length || !target) return;
    const isCurrent = () => !state.crafting && state.page === 'craft' &&
        craftQuoteKey(ids, target) === craftQuoteKey(state.selected, state.target?.id);
    try {
        const quote = await getCraftQuote(ids, target);
        if (!isCurrent()) return;
        state.quote = quote;
        document.querySelector('#forge .chance-value').style.strokeDasharray = (quote.chance / 100 * 308) + ' 308';
        document.querySelector('#forge .anvil strong').textContent = money(quote.chance) + '%';
    } catch (error) {
        if (isCurrent()) toast(error.message);
    }
}

function chooseTarget() {
    if (!state.crafting) openCatalogSheet('target');
}

function detail(id){const own=state.page==='gifts',g=(own?state.inventory:state.gifts).find(x=>x.id===id);if(!g)return;state.detailGift=g;sheet(own?'Подарок':'Покупка подарка',`<img class="purchase-art" src="${esc(imageURL(g.image))}" alt="${esc(g.name)}"><div class="purchase-heading"><h3>${esc(g.name)}</h3><span>${g.number?'#'+esc(g.number):'Инвентарь Crafter'}</span></div><div class="purchase-attrs">${[['Модель',g.model],['Фон',g.backdrop],['Символ',g.symbol]].map(([n,v])=>`<div><small>${n}</small><b>${esc(v||'—')}</b></div>`).join('')}</div><div class="quote-summary"><span>Цена</span><b>${money(g.price)} ${esc(g.price_unit||'GRAM')}</b></div>${own?`<button class="primary" onclick="closeSheet();togglePicked(${arg(g.id)})">Выбрать подарок</button>`:`<p class="sub">Предложение Portals. Покупка и оплата выполняются на площадке продавца.</p><button class="primary" onclick="openSeller()">Открыть Portals</button>`}`)}
function openSeller(){const url=state.detailGift?.purchase_url||'https://portal-market.com/';if(tg?.openTelegramLink&&url.startsWith('https://t.me/'))tg.openTelegramLink(url);else window.open(url,'_blank','noopener,noreferrer')}
const gramIcon=()=>'<img class="gram-icon" src="/static/assets/gram.svg" alt="GRAM">';
const currencyHTML=g=>(g.price_unit==='TON'||g.catalog_only)?'TON':gramIcon();
Object.assign(state,{order:'listed_at desc',minPrice:'',maxPrice:''});
const sortOptions=[['listed_at desc','Сначала новые'],['price asc','Цена: по возрастанию'],['price desc','Цена: по убыванию'],['external_collection_number asc','ID подарка: ↑'],['external_collection_number desc','ID подарка: ↓'],['model_rarity asc','Редкость модели: ↑'],['model_rarity desc','Редкость модели: ↓']];
filters=function(){return `<div class="search"><label class="search-box">${icon('search')}<input aria-label="Быстрый поиск" placeholder="Быстрый поиск" value="${esc(state.query)}" oninput="state.query=this.value;changedFilter()"></label><button class="circle" onclick="state.list=!state.list;filterGrid()" aria-label="Изменить вид">${icon('grid')}</button></div><div class="filter-strip"><button class="sort" onclick="openPriceFilters()" aria-label="Диапазон цены">${icon('filter')}</button><button class="sort ${state.order!=='listed_at desc'?'enabled':''}" onclick="openSort()" aria-label="Сортировка">↕</button><span class="filter-divider"></span>${[['collection','Коллекция'],['model','Модель'],['backdrop','Фон'],['symbol','Символ']].map(([k,n])=>`<button class="filter-chip ${state[k]?'has-value':''}" onclick="openCatalogSheet('${k}')">${n}${state[k]?'<span>1</span>':''}${icon('chevron')}</button>`).join('')}</div>`};
renderMarket=function(){document.querySelector('#main').innerHTML=`${filters()}<div id="gifts-grid" class="grid"></div><button class="load-more" onclick="loadMore()">Показать ещё</button>${demoNote()}`;filterGrid()};
marketParams=function(offset=0){const p=new URLSearchParams({offset:String(offset),sort_by:state.order,price_unit:state.marketUnit||'GRAM'});for(const [key,value] of [['search',state.query],['collection_id',state.collection],['filter_by_models',state.model],['filter_by_backdrops',state.backdrop],['filter_by_symbols',state.symbol],['min_price',state.minPrice],['max_price',state.maxPrice]])if(value!==''&&value!=null)p.set(key,value);return p};
function openSort(){state.draftOrder=state.order;sheet('Сортировка',`<div class="sort-options">${sortOptions.map(([v,n])=>`<button class="sort-option" onclick="chooseSort(${arg(v)})" data-order="${esc(v)}"><span class="sort-radio ${v===state.draftOrder?'checked':''}"></span>${n}</button>`).join('')}</div><button class="primary sort-apply" onclick="applySort()">Применить</button>`);document.querySelector('#sheet').classList.add('sort-sheet')}
function chooseSort(v){state.draftOrder=v;document.querySelectorAll('.sort-option').forEach(el=>el.querySelector('.sort-radio').classList.toggle('checked',el.dataset.order===v))}
function applySort(){state.order=state.draftOrder;state.sort=false;closeSheet();if(state.page==='market')renderMarket();changedFilter()}
function openPriceFilters(){sheet('Цена',`<p class="sub">Диапазон цены, ${esc(state.page==="gifts"?"GRAM":state.marketUnit||"GRAM")}</p><div class="price-fields"><label>От<input id="price-min" inputmode="decimal" type="number" min="0" step="0.01" placeholder="0" value="${esc(state.minPrice)}"></label><label>До<input id="price-max" inputmode="decimal" type="number" min="0" step="0.01" placeholder="Без лимита" value="${esc(state.maxPrice)}"></label></div><div class="catalog-footer"><button onclick="state.minPrice='';state.maxPrice='';closeSheet();refreshFilteredPage();changedFilter()">Сбросить</button><button class="apply" onclick="applyPriceFilters()">Применить</button></div>`);document.querySelector('#sheet').classList.add('price-sheet')}
function applyPriceFilters(){const min=document.querySelector('#price-min').value,max=document.querySelector('#price-max').value;if((min&&(!Number.isFinite(Number(min))||Number(min)<0))||(max&&(!Number.isFinite(Number(max))||Number(max)<0))||(min&&max&&Number(min)>Number(max)))return toast('Укажите корректный диапазон цены');state.minPrice=min;state.maxPrice=max;closeSheet();refreshFilteredPage();changedFilter()}
const themedSheet=sheet;sheet=function(t,h){document.querySelector('#sheet').classList.remove('sort-sheet','price-sheet','purchase-sheet');themedSheet(t,h)};
nav=function(){document.querySelector('#nav').innerHTML=`<div class="nav-main">${[['market','market','Маркет'],['gifts','gift','Мои подарки'],['craft','craft','Крафт']].map(([p,i,n])=>`<button class="${state.page===p?'active':''}" onclick="go('${p}')" aria-label="${n}">${icon(i)}<span>${n}</span></button>`).join('')}</div><button class="profile-nav ${['profile','admin'].includes(state.page)?'active':''}" onclick="go('profile')" aria-label="Профиль"><span class="avatar">${avatar()}</span></button>`};
detail=function(id){const own=state.page==='gifts',g=(own?state.inventory:state.gifts).find(x=>x.id===id);if(!g)return;state.detailGift=g;const c=state.catalog.collections.find(c=>c.id===g.collection_id||c.name===g.name);sheet('',`<div class="portal-product"><img src="${esc(imageURL(g.image))}" alt="${esc(g.name)}"><div><h2>${esc(g.name)} ›</h2>${g.number?`<span>#${esc(g.number)}</span>`:''}</div></div>${own?'<div class="product-availability">'+icon('craft')+' Доступно для крафта</div>':''}<div class="product-properties">${[['Модель',g.model],['Символ',g.symbol],['Фон',g.backdrop]].map(([n,v])=>`<div><span>${n}</span><b>${esc(v||'—')}</b></div>`).join('')}<div><span>Мин. цена коллекции</span><strong>${g.floor_price?money(g.floor_price)+' '+esc(g.price_unit||'GRAM'):c?money(c.floor_price)+' '+esc(c.price_unit||'TON'):'—'}</strong></div></div><div class="product-price"><span>Цена подарка</span><b>${money(g.price)} ${currencyHTML(g)}</b></div>${own?`<div class="product-actions"><button class="lucky-craft" onclick="craftFromDetail()">Lucky Craft<small>За свои подарки</small></button><button class="primary" onclick="closeSheet();togglePicked(${arg(g.id)})">Выбрать подарок</button></div>`:`<p class="sub">Покупка и оплата выполняются в Portals.</p><button class="primary" onclick="openSeller()">${g.purchase_url?"Купить подарок в Portals":"Открыть Portals"}<small>${money(g.price)} ${esc(g.price_unit||'GRAM')}</small></button>`}`);document.querySelector('#sheet').classList.add('purchase-sheet')};
function craftFromDetail(){const g=state.detailGift;if(!g)return;state.selected=[g.id];state.quote=null;closeSheet();go('craft')}

function refreshFilteredPage(){if(state.page==='gifts')renderGifts();else renderMarket()}
const serverFilterGrid=filterGrid;filterGrid=function(){if(state.page!=='gifts')return serverFilterGrid();const original=state.inventory;state.inventory=original.filter(g=>(state.minPrice===''||Number(g.price)>=Number(state.minPrice))&&(state.maxPrice===''||Number(g.price)<=Number(state.maxPrice)));const order=state.order||'listed_at desc';if(order==='price asc'||order==='price desc')state.inventory.sort((a,b)=>(Number(a.price)-Number(b.price))*(order==='price asc'?1:-1));if(order.startsWith('external_collection_number'))state.inventory.sort((a,b)=>(Number(a.number)-Number(b.number))*(order.endsWith('asc')?1:-1));if(order.startsWith('model_rarity'))state.inventory.sort((a,b)=>((a.rarity?.model??Infinity)-(b.rarity?.model??Infinity))*(order.endsWith('asc')?1:-1));try{return serverFilterGrid()}finally{state.inventory=original}};

const beforeLocalDetail=detail;detail=function(id){beforeLocalDetail(id);const g=state.detailGift;if(!g)return;const own=state.page==='gifts';if(!own){const body=document.querySelector('#sheet-body');body.querySelectorAll('.sub,.product-price').forEach(el=>el.remove());const buy=body.querySelector('.primary');if(buy){buy.id="buy-gift";buy.innerHTML=`<span>Купить подарок</span><span class="buy-gift-price">${money(g.price)} ${currencyHTML(g)}</span>`;buy.onclick=()=>localBuyGift(g.id);buy.disabled=false;}}else{const art=document.querySelector('.portal-product');if(art&&!document.querySelector('.detail-craft-button'))art.insertAdjacentHTML('afterend','<button class="detail-craft-button" onclick="craftFromDetail()">'+icon('craft')+' Крафт</button>')}};
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
