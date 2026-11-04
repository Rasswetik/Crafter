Object.assign(paths,{plus:'M12 5v14M5 12h14',arrow:'M12 20V4m-5 5 5-5 5 5',send:'m3 11 18-8-8 18-2-8-8-2Zm8 2L21 3',cart:'M2 3h3l3 12h11l3-9H6m3 14h1m8 0h1',filter:'M3 4h18l-7 8v8l-4-2v-6L3 4Z',chevron:'m6 9 6 6 6-6',hammer:'m8 3 11 4-2 5-11-4 2-5Zm2 7-5 11-3-1 5-11',anvil:'M3 7h18l-4 5h-4v5l4 2v2H7v-2l4-2v-5H8L3 7Zm8-4h9v3h-9V3Z'});
Object.assign(state,{inventoryTab:'gifts',inventoryStatus:'unlisted',picked:new Set(),marketTab:'all',source:'demo'});
function updateBalance(){document.querySelector('.balance b').textContent=money(state.me?.balance||0)+' GRAM'}
async function refreshMe(){state.me=await api('me');updateBalance()}
const originalGo=go;
go = async function (page) {
    if (state.crafting) return;
    state.picked.clear();
    document.querySelector('#app').classList.toggle('craft-view', page === 'craft');
    await originalGo(page);
    updateBalance();
};
function nav(){document.querySelector('#nav').innerHTML=`<div class="nav-main">${[['market','market','Маркет'],['gifts','gift','Мои подарки'],['craft','hammer','Крафт']].map(([p,i,t])=>`<button onclick="go('${p}')" class="${state.page===p?'active':''}">${icon(i)}${t}</button>`).join('')}</div><button class="profile-nav ${['profile','admin'].includes(state.page)?'active':''}" onclick="go('profile')" aria-label="Профиль"><span class="avatar">${avatar()}</span></button>`}
function card(g, action = 'detail') {
    const own = state.page === 'gifts' && action === 'detail';
    const canSend = g.status === 'unlisted';
    const floor = productFloor(g);
    return `<article class="gift ${own ? 'inventory-gift' : ''}">
        <button class="art" onclick="${action}(${arg(g.id)})" aria-label="${esc(g.name)}">
            <img ${giftPicture(g)} alt="${esc(g.name)}" loading="lazy">
        </button>
        ${own && canSend ? `<button class="inventory-craft-dot" onclick="craftGiftById(${arg(g.id)})" aria-label="Использовать для крафта">${anvilArt('inventory-anvil')}</button>` : ''}
        ${g.resale ? `<span class="resale-source">${g.own_listing ? 'Мой лот' : 'Craft Market'}</span>` : ''}
        <h3>${esc(g.name)}</h3><p class="number">#${esc(g.number)}</p>
        <div class="gift-bottom">
            <button class="price" onclick="${action}(${arg(g.id)})">${own && g.status === 'listed' ? `<small>Цена продажи</small><b>${money(g.listing_price ?? g.price)} ${gramIcon()}</b>` : own ? `<small>Минимальная цена</small><b>${floor.endsWith(' GRAM') ? esc(floor.slice(0, -5)) + ' ' + gramIcon() : esc(floor)}</b>` : `${money(g.price)} ${g.catalog_only || g.price_unit === 'TON' ? 'TON' : gramIcon()}`}</button>
            ${own || g.resale ? '' : `<button class="basket" onclick="${action}(${arg(g.id)})" aria-label="Открыть подарок">${icon('basket')}</button>`}
        </div>
    </article>`;
}
function filters(){let gifts=state.page==='gifts'?state.inventory:state.gifts;const collections=state.page==='market'&&state.catalog.collections.length?state.catalog.collections.map(c=>[c.id,c.name]):[...new Set(gifts.map(x=>x.name))].map(n=>[n,n]);let currentCollection=state.catalog.collections.find(x=>x.id===state.collection),attrs=state.catalog.attributes[currentCollection?.short_name]||{};let models=Object.keys(attrs.models||{}),backgrounds=Object.keys(attrs.backdrops||{});return `<div class="search"><label class="search-box">${icon('search')}<input aria-label="Быстрый поиск" placeholder="Быстрый поиск" value="${esc(state.query)}" oninput="state.query=this.value;changedFilter()"></label><button class="circle" onclick="state.list=!state.list;filterGrid()" aria-label="Изменить вид">${icon('grid')}</button></div><div class="filters"><button class="sort" onclick="showFilterHelp()" aria-label="Фильтры">${icon('filter')}</button><button class="sort" onclick="state.sort=!state.sort;changedFilter()" aria-label="Сортировать по цене">↕</button>${['collection','model','backdrop'].map((k,i)=>`<select aria-label="${['Коллекция','Модель','Фон'][i]}" onchange="state.${k}=this.value;changedFilter()"><option value="">${['Коллекция','Модель','Фон'][i]}</option>${(i===0?collections:(i===1&&models.length?models:i===2&&backgrounds.length?backgrounds:[...new Set(gifts.map(x=>x[k]))].filter(Boolean)).map(n=>[n,n])).map(([v,n])=>`<option value="${esc(v)}" ${state[k]===v?'selected':''}>${esc(n)}</option>`).join('')}</select>`).join('')}</div>`}
function showFilterHelp(){sheet('Фильтры','<p class="sub">Выберите коллекцию, модель и фон в строке фильтров. Кнопка ↕ сортирует подарки по цене.</p>')}
function marketParams(offset=0){let p=new URLSearchParams({offset:String(offset)});if(state.query)p.set('search',state.query);if(state.collection)p.set('collection_id',state.collection);if(state.model)p.set('filter_by_models',state.model);if(state.backdrop)p.set('filter_by_backdrops',state.backdrop);if(state.symbol)p.set('filter_by_symbols',state.symbol);p.set('sort_by',state.sort?'price asc':'listed_at desc');return p}
let filterTimer,filterRequest=0;
function changedFilter(){if(state.page!=='market'||state.source==='demo'){filterGrid();return}clearTimeout(filterTimer);state.marketFilterPending=true;const ticket=++filterRequest;filterTimer=setTimeout(async()=>{try{let data=await api('market?'+marketParams());if(ticket!==filterRequest||state.page!=='market')return;state.gifts=data.gifts;state.marketCursor=data.next_offset||20;state.marketHasMore=data.has_more??data.gifts.length>=20;state.marketWarning=data.warning||'';state.marketFloorGram=data.collection_floor_gram;state.marketFacets=data.facets||{};state.marketUnit=data.price_unit||'TON';if(data.sort_by)state.order=data.sort_by;state.marketFilterPending=false;renderMarket()}catch(e){if(ticket===filterRequest&&state.page==='market')toast(e.message)}},300)}
function emptyGiftActions() {
    return `<section class="gifts-empty-guide">
        <div class="gifts-empty-slides" onscroll="syncEmptyGiftSlide(this)">
            <div class="gifts-empty-slide">
                <img src="/static/assets/gifts-empty-deposit.webp" alt="" width="104" height="104">
                <h2>Есть подарки в Telegram?</h2>
                <p>Добавьте их через нашего бота</p>
                <button type="button" onclick="openGiftDeposit()">Как добавить подарки?</button>
            </div>
            <div class="gifts-empty-slide">
                <img src="/static/assets/gifts-empty-market.webp" alt="" width="104" height="104">
                <h2>Если подарков нет</h2>
                <p>Купите их на маркетплейсе</p>
                <button type="button" onclick="closeSheet();go('market')">Перейти в маркет</button>
            </div>
        </div>
        <div class="gifts-empty-dots" aria-label="Подсказки">
            <button type="button" aria-label="Как добавить подарки" aria-current="true" onclick="showEmptyGiftSlide(this, 0)"></button>
            <button type="button" aria-label="Перейти в маркет" aria-current="false" onclick="showEmptyGiftSlide(this, 1)"></button>
        </div>
    </section>`;
}
function showEmptyGiftSlide(button, index) {
    const slides = button.closest('.gifts-empty-guide').querySelector('.gifts-empty-slides');
    slides.scrollLeft = slides.clientWidth * index;
}
function syncEmptyGiftSlide(slides) {
    if (!slides.clientWidth) return;
    const index = Math.round(slides.scrollLeft / slides.clientWidth);
    slides.nextElementSibling.querySelectorAll('button').forEach((button, i) => {
        button.setAttribute('aria-current', String(i === index));
    });
}
function startEmptyGiftCarousel(container) {
    const guide = container.querySelector('.gifts-empty-guide');
    const slides = guide?.querySelector('.gifts-empty-slides');
    if (!slides) return;
    const inSheet = appSheet.contains(guide);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    function advance() {
        if (!guide.isConnected || (inSheet && !appSheet.open)) return;
        if (!document.hidden && (inSheet || !appSheet.open) && !reducedMotion.matches && document.documentElement.dataset.crafterAnimations !== 'off' &&
            slides.clientWidth && !guide.matches(':hover, :focus-within, :active')) {
            const current = Math.round(slides.scrollLeft / slides.clientWidth);
            const next = (current + 1) % slides.children.length;
            slides.scrollTo({left: slides.clientWidth * next, behavior: 'smooth'});
        }
        setTimeout(advance, 5000);
    }
    setTimeout(advance, 5000);
}
function filterGrid() {
    const gifts = state.page === 'gifts' ? state.inventory.filter(gift => gift.status === state.inventoryStatus) : state.gifts;
    const collections = selectedCollections();
    const collectionNames = new Set(state.catalog.collections.filter(item =>
        collections.includes(String(item.id)) || collections.includes(item.short_name)).map(item => giftCollectionSlug(item.name)));
    const query = state.query.toLowerCase();
    const filtered = gifts.filter(gift =>
        (gift.name + ' ' + gift.number + ' ' + (gift.model || '')).toLowerCase().includes(query) &&
        (!collections.length || collections.includes(gift.name) || collections.includes(String(gift.collection_id)) || collectionNames.has(giftCollectionSlug(gift.name))) &&
        matchesSelectedTrait(state.model, gift.model) &&
        matchesSelectedTrait(state.backdrop, gift.backdrop) &&
        matchesSelectedTrait(state.symbol, gift.symbol));
    if (state.sort) filtered.sort((a, b) => Number(a.price) - Number(b.price));
    const grid = document.querySelector('#gifts-grid');
    if (!grid) return;
    grid.className = 'grid' + (state.list ? ' list' : '');
    const showGiftGuide = state.page === 'gifts' && state.inventoryStatus === 'unlisted' && !gifts.length;
    const empty = showGiftGuide ? emptyGiftActions() : `<div class="inventory-empty">${icon('gift')}<h2>${state.page === 'gifts' ? 'Нет подарков' : 'Ничего не найдено'}</h2>
        <p>${state.page === 'gifts' ? 'Добавьте подарки или выберите другую вкладку' : 'Попробуйте изменить фильтры'}</p></div>`;
    if (state.page === 'market') {
        if (filtered.length) updateMarketGrid(grid, filtered);
        else grid.innerHTML = empty;
        paintCollectionMarketFeatures(grid);
    }
    else if (filtered.length || !grid.firstElementChild?.classList.contains(showGiftGuide ? 'gifts-empty-guide' : 'inventory-empty')) {
        grid.innerHTML = filtered.length ? filtered.map(gift => card(gift)).join('') : empty;
        if (!filtered.length && showGiftGuide) startEmptyGiftCarousel(grid);
    }
}

function updateMarketGrid(grid, gifts) {
    const wanted = new Set(gifts.map(gift => gift.id));
    const existing = new Map();
    for (const node of [...grid.children]) {
        const id = node.dataset.marketLot;
        if (wanted.has(id)) existing.set(id, node);
        else node.remove();
    }
    const template = document.createElement('template');
    for (const [index, gift] of gifts.entries()) {
        let node = existing.get(gift.id);
        const version = JSON.stringify(gift);
        if (node?.marketVersion !== version) {
            template.innerHTML = card(gift);
            const fresh = template.content.firstElementChild;
            fresh.dataset.marketLot = gift.id;
            fresh.marketVersion = version;
            node?.replaceWith(fresh);
            node = fresh;
        }
        const current = grid.children[index];
        if (current !== node) grid.insertBefore(node, current || null);
    }
    while (grid.children.length > gifts.length) grid.lastElementChild.remove();
}

function renderMarket(){document.querySelector('#main').innerHTML=`<div class="market-categories"><button class="selected" onclick="state.marketTab='all';renderMarket()"><span>${icon('gift')}</span>Все</button><button class="${state.marketTab==='collections'?'selected':''}" onclick="state.marketTab='collections';renderCollections()"><span>${icon('market')}</span>Коллекции</button><button onclick="go('craft')"><span>${icon('hammer')}</span>Крафт</button></div>${filters()}${state.marketWarning?`<div class="notice">${esc(state.marketWarning)}</div>`:''}<div id="gifts-grid" class="grid"></div><button class="load-more" onclick="loadMore()">Показать ещё</button>${demoNote()}`;filterGrid()}
function renderCollections(){renderMarket();document.querySelectorAll('.market-categories button').forEach((b,i)=>b.classList.toggle('selected',i===1));const c=state.catalog.collections.length?state.catalog.collections:[...new Map(state.gifts.map(g=>[g.collection_id,{id:g.collection_id,name:g.name,photo_url:fragmentCollectionImage(giftCollectionSlug(g.name)),floor_price:g.price}])).values()];document.querySelector('#gifts-grid').innerHTML=c.map(x=>`<button class="collection-card" onclick="openCollection(${arg(x.id)})"><img src="${esc(imageURL(x.photo_url) || fragmentCollectionImage(giftCollectionSlug(x.name)))}" alt="${esc(x.name)}"><strong>${esc(x.name)}</strong><small>от ${money(x.floor_price)} ◆</small></button>`).join('')}
function openCollection(id){state.collection=id;state.marketTab='all';renderMarket();changedFilter()}
async function loadMore(){if(state.source==='demo')return toast('Все тестовые подарки загружены');try{let d=await api('market?'+marketParams(state.gifts.length));if(!d.gifts.length)return toast('Все подарки загружены');state.gifts.push(...d.gifts);filterGrid()}catch(e){toast(e.message)}}
async function inventoryTab(tab){state.inventoryTab=tab;state.picked.clear();await renderGifts()}
const inventoryToolbarPaths = {
    add:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v4h4v2h-4v4h-2v-4H7v-2h4V7Z',
    withdraw:'M12 3 5 10l2 2 3.5-3.5V21h3V8.5L17 12l2-2-7-7Z',
    transfer:'M2 10.7 21.3 3c.5-.2 1 .3.8.8l-5 17.3c-.1.5-.8.6-1.1.3l-5-4.1 7-9.4-9.6 7L2 11.7c-.4-.2-.4-.8 0-1Z',
    sell:'M2 4h3l.9 3H22l-2.3 8H8l.6 2H19v2H7L3.5 6H2V4Zm7 16a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
};

function inventoryToolbarIcon(action) {
    if (action === 'craft') return anvilArt('inventory-anvil');
    return `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${inventoryToolbarPaths[action === 'unlist' ? 'sell' : action]}"/></svg>`;
}

async function renderGifts(){const counts={unlisted:state.inventory.filter(g=>g.status!=='listed').length,listed:state.inventory.filter(g=>g.status==='listed').length};document.querySelector('#main').innerHTML=`<div class="inventory-tabs">${[['gifts','Гифты'],['offers','Офферы'],['history','История']].map(([k,t])=>`<button class="${state.inventoryTab===k?'selected':''}" onclick="inventoryTab('${k}')">${t}</button>`).join('')}</div><div id="inventory-body"></div>`;const body=document.querySelector('#inventory-body');if(state.inventoryTab==='history'){await renderGiftHistory(body);return}if(state.inventoryTab==='offers'){await renderOffersInbox(body);return}body.innerHTML=`<div class="segment"><button class="${state.inventoryStatus==='unlisted'?'selected':''}" onclick="state.inventoryStatus='unlisted';state.picked.clear();renderGifts()">Не выставл. <span>${counts.unlisted}</span></button><button class="${state.inventoryStatus==='listed'?'selected':''}" onclick="state.inventoryStatus='listed';state.picked.clear();renderGifts()">Выставл. <span>${counts.listed}</span></button></div><div class="inventory-actions">${[['Добавить','add'],['Вывод','withdraw'],['Отправить','transfer'],[state.inventoryStatus==='listed'?'Снять':'Продать',state.inventoryStatus==='listed'?'unlist':'sell'],['Крафт','craft']].map(([t,a])=>`<button onclick="inventoryToolbarAction('${a}')" ${a==='withdraw'?'disabled':''}>${inventoryToolbarIcon(a)}<span>${t}</span></button>`).join('')}</div>${filters()}<div id="gifts-grid" class="grid"></div>${inventoryBank()}${demoNote()}`;filterGrid()}
function togglePicked(id){state.picked.has(id)?state.picked.delete(id):state.picked.add(id);filterGrid();updatePicked()}
function updatePicked(){let e=document.querySelector('#selection-count');if(e)e.textContent=state.picked.size?'Выбрано: '+state.picked.size:'Выберите подарки'}
function inventoryAction(action){if(action==='add'){sheet('Добавить подарки',`<div class="inventory-empty">${icon('gift')}<h2>Пополните коллекцию</h2><p>${state.me.demo?'В тестовом режиме подарки можно купить на тестовый баланс в маркете.':'Приём реальных подарков будет доступен после подключения депозитного бота.'}</p><button class="primary" onclick="closeSheet();go('market')">Перейти в маркет</button></div>`);return}if(!state.picked.size)return toast('Сначала выберите подарки');if(action==='craft'){const eligible=state.inventory.filter(x=>state.picked.has(x.id)&&x.status==='unlisted');if(eligible.length!==state.picked.size)return toast('Сначала снимите подарки с продажи');if(eligible.length>CRAFT_GIFT_LIMIT)return toast('Выберите до 4 подарков');state.selected=eligible.map(g=>g.id);state.quote=null;go('craft');return}sheet(({sell:'Продать подарки',unlist:'Снять с продажи',withdraw:'Вывести подарки',transfer:'Отправить подарки'})[action],`<p class="sub">Выбрано подарков: ${state.picked.size}. ${state.me.demo?'Тестовая операция. Реальные NFT не перемещаются.':''}</p>${action==='sell'?'<label class="form-label">Цена каждого подарка, GRAM</label><input class="field" id="action-value" type="number" min="0.01" step="0.01" placeholder="0.00">':action==='transfer'?'<label class="form-label">Получатель</label><input class="field" id="action-value" placeholder="@username или Telegram ID">':''}<button class="primary" onclick="submitInventoryAction('${action}')">Подтвердить</button>`)}
async function submitInventoryAction(action){try{await api('inventory/action',{action,gift_ids:[...state.picked],price:document.querySelector('#action-value')?.value,recipient:document.querySelector('#action-value')?.value});closeSheet();state.picked.clear();state.inventory=(await api('inventory')).gifts;await refreshMe();await renderGifts();toast('Тестовая операция выполнена')}catch(e){toast(e.message)}}
function detail(id){let g=[...state.gifts,...state.inventory].find(g=>g.id===id);if(!g)return;const own=state.page==='gifts';sheet(g.name,`<img class="detail-art" src="${esc(imageURL(g.image))}" alt="${esc(g.name)}"><div class="gift-detail-number">#${esc(g.number)}</div><div class="attributes"><div><span>Модель</span><b>${esc(g.model||'—')}</b></div><div><span>Фон</span><b>${esc(g.backdrop||'—')}</b></div><div><span>Статус</span><b>${own?(g.status==='listed'?'Выставлен':'В инвентаре'):'На маркете'}</b></div></div><button class="primary" onclick="${own?`closeSheet();togglePicked(${arg(g.id)})`:`buyGift(${arg(g.id)})`}">${own?'Выбрать подарок':'Купить за '+money(g.price)+' ◆'}</button>`)}
async function buyGift(id){if(state.gifts.find(g=>g.id===id)?.catalog_only)return toast('Это модель из каталога, а не предложение на продажу');if(!state.me.demo)return toast('Покупки за реальные средства ещё не подключены');try{await api('demo/buy',{id});await refreshMe();closeSheet();toast('Подарок добавлен в «Мои подарки»')}catch(e){toast(e.message)}}
const baseRenderProfile=renderProfile;
renderProfile=function(){baseRenderProfile();let p=document.querySelector('.pill b');if(p)p.innerHTML=(state.me.inventory_count||0)+' 🎁'};


const CRAFT_GIFT_LIMIT = 4;

function slot(index, gifts) {
    const gift = gifts[index];
    return `<button class="slot craft-slot${gift ? '' : ' is-empty'}" data-index="${index}"
        ${gift ? `style="background:${giftBackdrop(gift)}"` : ''}
        onclick="${gift ? `removeGift(${arg(gift.id)})` : 'pickGift()'}"
        aria-label="${gift ? 'Убрать подарок' : 'Добавить подарок'}">
        ${gift ? `<img ${giftPicture(gift)} alt="${esc(gift.name)}">` : '<span class="slot-plus"></span>'}
    </button>`;
}

const baseSheet=sheet;
sheet=function(title,html){document.querySelector('#sheet').classList.remove('gift-picker');baseSheet(title,html)};

function pickGift() {
    if (state.crafting) return;
    state.pickerGifts = state.inventory.filter(gift => gift.status === 'unlisted');
    if (!state.pickerGifts.length) {
        sheet('Добавить подарки', emptyGiftActions());
        startEmptyGiftCarousel(appSheet);
        return;
    }
    state.pickerSelected = new Set(state.selected.slice(0, CRAFT_GIFT_LIMIT));
    sheet('Выберите до 4 подарков', `
        <div class="picker-content" id="picker-content"></div>
        <div class="picker-footer">
            <button class="primary" onclick="applyPicker()">Готово</button>
        </div>`);
    document.querySelector('#sheet').classList.add('gift-picker');
    renderPicker();
}

function renderPicker() {
    const list = document.querySelector('#picker-content');
    list.innerHTML = state.pickerGifts.length ? `<div class="grid">${state.pickerGifts.map(gift => {
        const selected = state.pickerSelected.has(gift.id);
        return `<button class="picker-gift ${selected ? 'selected' : ''}" aria-pressed="${selected}" onclick="togglePicker(${arg(gift.id)})">
            <div style="background:${giftBackdrop(gift)}"><img ${giftPicture(gift)} alt=""><span>${selected ? '✓' : ''}</span></div>
            <b>${esc(gift.name)}</b><small>#${esc(gift.number)}</small>
        </button>`;
    }).join('')}</div>` : `<div class="picker-empty">${anvilArt('picker-anvil')}<p>Нет подарков для крафта</p></div>`;
}

function togglePicker(id) {
    if (state.pickerSelected.has(id)) state.pickerSelected.delete(id);
    else if (state.pickerSelected.size < CRAFT_GIFT_LIMIT) state.pickerSelected.add(id);
    else return toast('Можно добавить до 4 подарков');
    renderPicker();
}

async function renderAdminUsers(content) {
    content.innerHTML = '<label class="search-box">'+icon('search')+'<input placeholder="Имя, username или ID" oninput="searchUsers(this.value)" aria-label="Найти пользователя"></label><div id="users-list"></div>';
    await loadUsers('');
}

async function renderAdminPortal(content) {
    const [status] = await Promise.all([api('admin/status'), state.catalogReady]);
    if (!content.isConnected) return;
    content.innerHTML = `<section class="panel"><h3>Каталог подарков</h3><p>Коллекций: ${state.catalog.collections.length}. Цены и изображения загружаются отдельно от выдачи подарков.</p><p>${status.mode==='partner'?'Partner API подключён':'Открытый API · без ключа'}</p><div id="sync-progress" class="notice">${esc(status.sync?.error||'Готово к обновлению')}</div><button class="primary" onclick="refreshPortal(this)">Обновить каталог Portal</button><p class="sub">При недоступности Portal сохраняется предыдущий каталог. Исходные оценки TON не выдаются за актуальные цены GRAM.</p></section><section class="panel"><h3>Коллекции и модели</h3><select class="field" id="catalog-collection" onchange="showCatalogModels(this.value)"><option value="">Выберите коллекцию</option>${state.catalog.collections.map(c=>`<option value="${esc(c.short_name||c.id)}">${esc(c.name)}</option>`).join('')}</select><div id="catalog-models"></div></section>`;
}
let userSearchTimer;
function searchUsers(q){clearTimeout(userSearchTimer);userSearchTimer=setTimeout(()=>loadUsers(q),250)}
async function loadUsers(q){try{const data=await api('admin/users?search='+encodeURIComponent(q));state.adminUsers=data.users;const el=document.querySelector('#users-list');if(el)el.innerHTML=data.users.length?data.users.map(u=>`<button class="user-row" onclick="openUser(${u.id})"><span class="user-avatar">${esc((u.name||'U')[0])}</span><span><b>${esc(u.name||'Пользователь')}</b><small>@${esc(u.username||'—')} · ${u.id}</small></span><span class="user-balance">${money(u.balance)} <small>GRAM · ${u.gifts} подарков${u.banned ? ' · БЛОКИРОВКА' : ''}</small></span></button>`).join(''):'<div class="inventory-empty"><p>Пользователи появятся после первого входа</p></div>'}catch(e){toast(e.message)}}
async function openUser(uid){const list=document.querySelector('#users-list');await state.catalogReady;if(!list?.isConnected)return;const u=state.adminUsers.find(x=>x.id===uid);if(!u)return;sheet(u.name||String(uid),`<p class="sub">@${esc(u.username||'—')} · ${uid}</p><label class="form-label">Баланс GRAM</label><div class="balance-editor"><input id="user-balance" class="field" type="number" min="0" step="0.01" value="${esc(u.balance)}"><button class="secondary" onclick="saveUserBalance(${uid})">Сохранить</button></div><div class="admin-user-tools">
    <button type="button" class="secondary" onclick="adminInspectGifts(${uid})">Инвентарь · ${u.gifts}</button>
    <button type="button" class="secondary" onclick="adminInspectOffers(${uid})">Офферы</button>
    <button type="button" class="secondary" onclick="adminInspectLogs(${uid})">Логи</button>
    <button type="button" class="secondary ${u.banned ? 'admin-unban' : 'admin-ban'}" onclick="adminToggleBan(${uid},${u.banned ? 'false' : 'true'})">
        ${u.banned ? 'Разблокировать' : 'Заблокировать'}</button>
</div><h3>Добавить подарок в инвентарь</h3><select class="field" id="grant-collection" onchange="loadGrantModels(this.value,${uid})"><option value="">Коллекция</option>${state.catalog.collections.map(c=>`<option value="${esc(c.short_name||c.id)}">${esc(c.name)}</option>`).join('')}</select><div id="grant-models"></div>`)}
async function saveUserBalance(uid){try{await api('admin/users/'+uid+'/balance',{balance:document.querySelector('#user-balance').value});toast('Баланс сохранён');loadUsers('')}catch(e){toast(e.message)}}
let grantModelRequest=0;
async function loadGrantModels(slug,uid){const ticket=++grantModelRequest;const el=document.querySelector('#grant-models');el.innerHTML='<p class="sub">Загрузка моделей…</p>';try{const data=await api('collections/'+encodeURIComponent(slug)+'/models');if(ticket!==grantModelRequest||!el.isConnected)return;el.innerHTML=data.models.length?`<div class="grant-models">${data.models.map(m=>`<button onclick="grantModel(${uid},${arg(slug)},${arg(m.name)})"><img src="${esc(imageURL(m.image))}" alt="${esc(m.name)}" loading="lazy"><b>${esc(m.name)}</b><small>${money(m.price)} ${m.price_unit|| (m.price_source==='snapshot-estimate'?'TON · оценка':'GRAM')}</small></button>`).join('')}</div>`:'<p class="sub">Модели пока не загружены</p>'}catch(e){el.textContent=e.message}}
async function grantModel(uid,slug,model){try{await api('admin/users/'+uid+'/gifts',{collection_id:slug,model});toast('Подарок добавлен в инвентарь');await loadUsers('')}catch(e){toast(e.message)}}
async function refreshPortal(button){button.disabled=true;try{await api('admin/portal/sync',{});pollPortal()}catch(e){toast(e.message);button.disabled=false}}
async function pollPortal(){try{let s=await api('admin/status'),el=document.querySelector('#sync-progress');if(!el)return;el.textContent=s.sync.running?`Обработано коллекций: ${s.sync.completed} / ${s.sync.total}`:s.sync.error||'Каталог обновлён';if(s.sync.running)setTimeout(pollPortal,2000);else state.catalog=await api('catalog')}catch(e){toast(e.message)}}
async function showCatalogModels(slug){let data=await api('collections/'+encodeURIComponent(slug)+'/models');document.querySelector('#catalog-models').innerHTML=data.models.map(m=>`<div class="model-row"><span>${esc(m.name)}</span><b style="margin-left:auto">${money(m.price)} ${m.price_unit|| (m.price_source==='snapshot-estimate'?'TON':'GRAM')}</b></div>`).join('')}


renderProfile=function(){if(state.gamesMode)return renderGamesProfile();const m=state.me,u=m.user;document.querySelector('#main').innerHTML=`<section class="portal-profile"><div class="profile-identity"><div class="avatar">${avatar()}</div><div class="profile-name"><h2>${esc(u.first_name)}</h2><small>@${esc(u.username||'user')}</small></div><button class="profile-inventory" onclick="go('gifts')">Инвентарь ›</button></div><div class="profile-metrics"><div><b>${m.inventory_count || 0}</b><span>Подарков в инвентаре</span></div><div><b>${m.bought} / ${m.sold}</b><span>Куплено / Продано</span></div><div><b>${money(m.volume)} <em>GRAM</em></b><span>Общий объём</span></div></div></section><section class="portal-referrals"><div class="portal-ref-heading"><b>УРОВЕНЬ РЕФЕРАЛОВ ${m.referral_level}</b><span>${m.referral_progress}%</span></div><div class="portal-ref-grid"><div><span class="ref-label">${icon('gift')} Рефералы</span><strong>${m.referrals}</strong></div><div><span class="ref-label">${icon('market')} До уровня 2</span><strong>${Math.max(10-m.referrals,0)}</strong></div></div></section><button class="primary profile-invite" onclick="invite()">Пригласить друзей</button>${m.is_admin?`<button class="panel admin-entry" onclick="openAdminPage()">${icon('shield')}<span>Админ-панель<small>Пользователи · Баннеры · Telegram-бот</small></span><span>›</span></button>`:''}`};
