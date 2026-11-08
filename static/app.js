const paths={market:'M4 4h16v17l-8-5-8 5V4Zm5 4v5h6V8H9Z',gift:'M3 8h18v4H3V8Zm2 4v9h14v-9M12 8v13M12 8C5 8 6 1 10 4l2 4Zm0 0c7 0 6-7 2-4l-2 4Z',search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-6',grid:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',settings:'M9.7 2.6h4.6l.6 2.3a8 8 0 0 1 2 1.2l2.3-.8 2.3 4-1.8 1.6a8 8 0 0 1 0 2.3l1.8 1.6-2.3 4-2.3-.8a8 8 0 0 1-2 1.2l-.6 2.3H9.7l-.6-2.3a8 8 0 0 1-2-1.2l-2.3.8-2.3-4 1.8-1.6a8 8 0 0 1 0-2.3L2.5 9.3l2.3-4 2.3.8a8 8 0 0 1 2-1.2l.6-2.3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z','rotate-ccw':'M3 11a9 9 0 1 1 3 7M3 4v7h7'};
function anvilArt(className = 'anvil-svg') {
    return `<span class="anvil-mark ${className}" aria-hidden="true"></span>`;
}
const icon=(name)=>name === 'craft' ? anvilArt('craft-icon') : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.gift}"/></svg>`;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arg=x=>esc(JSON.stringify(String(x)));
const imageURL=x=>/^(https:\/\/|\/static\/assets\/|\/api\/arena\/private\/[A-Za-z0-9_-]{24}\/bot-avatar(?:\?v=\d+)?$|\/media\/(?:fragment|collection)\/[a-z0-9-]+$|data:image\/webp;base64,)/.test(x||'')?x:'';
const money=x=>{let n=Number(x);return Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:2}):'—'};
let state={page:'market',me:null,gifts:[],catalog:{collections:[],attributes:{}},selected:[],list:false,query:'',collection:'',model:'',backdrop:'',sort:false,inventory:[],crafting:false,selection:{}};
let tg=window.Telegram?.WebApp;
const telegramSessionKey = 'crafter:telegram-session';
function crafterWebSession() {
    try { return localStorage.getItem('crafter-web-session') || ''; }
    catch { return ''; }
}
function telegramInitData() {
    if (tg?.initData) return tg.initData;
    try { return sessionStorage.getItem(telegramSessionKey) || ''; }
    catch { return ''; }
}
function openAdminPage() {
    try { if (tg?.initData) sessionStorage.setItem(telegramSessionKey, tg.initData); }
    catch {}
    location.assign('/admin');
}

async function api(path, body) {
    const controller = new AbortController();
    const upload = body instanceof FormData;
    const timer = setTimeout(() => controller.abort(), upload ? 45000 : path.startsWith('market') ? 18000 : 12000);
    try {
        const headers = {'X-Telegram-Init-Data': telegramInitData()};
        if (!headers['X-Telegram-Init-Data'] && crafterWebSession()) headers['X-Crafter-Web-Session'] = crafterWebSession();
        if (!upload) headers['Content-Type'] = 'application/json';
        const response = await fetch('/api/' + path, {
            method: body === undefined ? 'GET' : 'POST', signal: controller.signal, headers,
            body: upload ? body : JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
            if (response.status === 503 && data.maintenance &&
                typeof window.crafterShowMaintenance === 'function') {
                window.crafterShowMaintenance(data.message || '');
            }
            if (response.status === 401 && crafterWebSession() && !telegramInitData()) {
                try { localStorage.removeItem('crafter-web-session'); } catch {}
                location.reload();
            }
            const error = Error(data.error || 'Ошибка запроса');
            error.status = response.status;
            throw error;
        }
        return data;
    } catch (error) {
        if (error.name === 'AbortError') throw Error('Сервер долго не отвечает. Попробуйте ещё раз.');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function toast(msg) {
    const el = document.querySelector('#toast');
    if (!el) return;
    // A modal <dialog> lives in the top layer. z-index on <body> cannot
    // overtake it: mount the toast inside the topmost open dialog.
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    const top = dialogs.at(-1) || document.body;
    top.appendChild(el);
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => {
        el.style.display = 'none';
        if (el.parentNode !== document.body) document.body.appendChild(el);
    }, 3500);
}
const appSheet = document.querySelector('#sheet');
let sheetCloseTimer;
let sheetPressOutside = false;

function sheet(title, html) {
    clearTimeout(sheetCloseTimer);
    appSheet.classList.remove('sheet-closing', 'transfer-picker-sheet', 'transfer-recipient-sheet', 'gift-deposit-sheet', 'staking-tutorial-sheet', 'staking-picker-sheet', 'resale-editor-sheet', 'wallet-filter-sheet');
    document.querySelector('#sheet-title').textContent = title;
    document.querySelector('#sheet-body').innerHTML = html;
    if (!appSheet.open) appSheet.showModal();
}

function closeSheet() {
    if (!appSheet.open || appSheet.classList.contains('sheet-closing')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        appSheet.close();
        return;
    }
    appSheet.classList.add('sheet-closing');
    sheetCloseTimer = setTimeout(() => {
        appSheet.close();
        appSheet.classList.remove('sheet-closing');
    }, 180);
}

function outsideSheet(point) {
    const rect = appSheet.getBoundingClientRect();
    return point.clientX < rect.left || point.clientX >= rect.right ||
        point.clientY < rect.top || point.clientY >= rect.bottom;
}
function startSheetPress(point) {
    sheetPressOutside = appSheet.open && !appSheet.querySelector('dialog[open]') && outsideSheet(point);
}
function endSheetPress(point) {
    if (appSheet.open && sheetPressOutside && outsideSheet(point)) closeSheet();
    sheetPressOutside = false;
}
document.addEventListener('pointerdown', startSheetPress, true);
document.addEventListener('pointerup', endSheetPress, true);
document.addEventListener('touchstart', event => startSheetPress(event.touches[0]), {capture:true, passive:true});
document.addEventListener('touchend', event => endSheetPress(event.changedTouches[0]), {capture:true, passive:true});
appSheet.addEventListener('click', event => {
    if (event.target === appSheet && event.detail && outsideSheet(event)) closeSheet();
});
appSheet.addEventListener('cancel', event => {event.preventDefault(); closeSheet();});
// Restore live messages when a modal closes before their timer completes.
appSheet.addEventListener('close', () => {
    const el = document.querySelector('#toast');
    if (el && el.parentNode === appSheet) document.body.appendChild(el);
});
function avatar(){const u=state.me?.user;return imageURL(u?.photo_url)?`<img src="${esc(imageURL(u.photo_url))}" alt="Аватар">`:esc((u?.first_name||'Г')[0])}
function nav(){document.querySelector('#nav').innerHTML=[['market','market','Маркет'],['gifts','gift','Мои подарки'],['craft','craft','Крафт']].map(([page,i,label])=>`<button onclick="go('${page}')" class="${state.page===page?'active':''}">${icon(i)}${label}</button>`).join('')+`<button class="profile-nav ${['profile','admin'].includes(state.page)?'active':''}" onclick="go('profile')" aria-label="Профиль"><span class="avatar">${avatar()}</span></button>`}
function crafterLoading(page = '') {
    const block = (kind) => '<i class="skeleton-block skeleton-' + kind + '"></i>';
    const grid = page === 'market' || page === 'gifts';
    return `<div class="crafter-skeleton" role="status" aria-label="Загрузка">
        ${block(grid ? 'search' : 'title')}
        ${grid ? '<div class="skeleton-filters">' + block('chip').repeat(3) + '</div>' : ''}
        <div class="${grid ? 'skeleton-grid' : 'skeleton-stack'}">
            ${grid ? block('gift').repeat(window.innerWidth>=1400?11:window.innerWidth>=1024?7:4) : block('row').repeat(4)}
        </div>
    </div>`;
}
async function go(page){if(state.crafting)return;if(page==='admin')return openAdminPage();state.page=page;nav();const el=document.querySelector('#main');el.innerHTML=crafterLoading(page);try{if(page==='market'){clearTimeout(filterTimer);filterRequest++;const data=await api('market?'+marketParams());if(state.page!==page)return;state.marketFilterPending=false;state.marketCursor=data.next_offset||20;state.marketHasMore=data.has_more??data.gifts.length>=20;state.marketWarning=data.warning||'';state.marketFloorGram=data.collection_floor_gram;state.marketFacets=data.facets||{};state.marketUnit=data.price_unit||'TON';if(data.sort_by)state.order=data.sort_by;state.gifts=data.gifts;state.source=data.source||(data.demo?'demo':'portals');renderMarket()}if(page==='gifts'){const [inventory, me]=await Promise.all([api('inventory'),api('me')]);if(state.page!==page)return;state.inventory=inventory.gifts;state.me=me;renderGifts()}if(page==='craft'){state.inventory=(await api('inventory')).gifts;if(state.page!==page)return;renderCraft();updateCraftQuote()}if(page==='profile'){await refreshMe();if(state.page===page)renderProfile()}}catch(e){el.innerHTML=`${page === 'market' ? resaleMarketTabs() : ''}<div class="error">${esc(e.message)}</div><button class="secondary" onclick="go('${page}')">Повторить</button>`}}
function demoNote(){return state.me?.demo?'<div class="demo-label">ДЕМО · тестовые цены и подарки</div>':''}
function card(g,action='detail'){return `<article class="gift"><button class="art" style="width:100%;padding:0" onclick="${action}(${arg(g.id)})" aria-label="${esc(g.name)}"><img ${giftPicture(g)} alt="${esc(g.name)}" loading="lazy"><span class="badge">${esc(g.model||'GIFT')}</span></button><h3>${esc(g.name)}</h3><p class="number">#${esc(g.number)}</p><button class="price" onclick="${action}(${arg(g.id)})">${money(g.price)} ◆</button></article>`}
function filters(){return `<div class="search"><label class="search-box">${icon('search')}<input aria-label="Быстрый поиск" placeholder="Быстрый поиск" value="${esc(state.query)}" oninput="state.query=this.value;filterGrid()"></label><button class="circle" onclick="state.list=!state.list;filterGrid()" aria-label="Изменить вид">${icon('grid')}</button></div><div class="filters"><button class="sort" onclick="state.sort=!state.sort;filterGrid()" aria-label="Сортировать по цене">↕</button>${['collection','model','backdrop'].map((k,i)=>`<select id="filter-${k}" aria-label="${['Коллекция','Модель','Фон'][i]}" onchange="state.${k}=this.value;filterGrid()"><option value="">${['Коллекция','Модель','Фон'][i]}</option>${[...new Set((state.page==='gifts'?state.inventory:state.gifts).map(g=>k==='collection'?g.name:g[k]))].filter(Boolean).map(v=>`<option ${state[k]===v?'selected':''}>${esc(v)}</option>`).join('')}</select>`).join('')}</div>`}
function filterGrid(){let gifts=state.page==='gifts'?state.inventory:state.gifts;let filtered=gifts.filter(g=>(g.name+' '+g.number).toLowerCase().includes(state.query.toLowerCase())&&(!state.collection||g.name===state.collection)&&(!state.model||g.model===state.model)&&(!state.backdrop||g.backdrop===state.backdrop));if(state.sort)filtered=[...filtered].sort((a,b)=>Number(a.price)-Number(b.price));const grid=document.querySelector('#gifts-grid');if(grid){grid.className='grid'+(state.list?' list':'');grid.innerHTML=filtered.length?filtered.map(g=>card(g)).join(''):'<p class="sub">Ничего не найдено</p>'}}
function renderMarket(){document.querySelector('#main').innerHTML=`<div class="page-title"><h1>Маркет</h1><span class="live">Коллекционные подарки</span></div><div class="hero"><small>СОБЕРИ СВОЮ КОЛЛЕКЦИЮ</small><h2>Больше, чем<br>просто подарок.</h2><p>Находи. Собирай. Создавай.</p><img src="/static/assets/amulet.webp" alt=""></div>${filters()}<div id="gifts-grid" class="grid"></div>${demoNote()}`;filterGrid();if(!state.me.demo){document.querySelector('#main').insertAdjacentHTML('beforeend','<button class="secondary" style="width:100%;margin-top:20px" onclick="loadMore()">Показать ещё</button>')}}
async function loadMore(){try{let data=await api('market?offset='+state.gifts.length);if(!data.gifts.length)return toast('Все подарки загружены');state.gifts.push(...data.gifts);filterGrid()}catch(e){toast(e.message)}}
function detail(id){let g=[...state.gifts,...state.inventory].find(g=>g.id===id);if(!g)return;sheet(g.name,`<img class="detail-art" ${giftPicture(g)} alt="${esc(g.name)}"><div class="detail-row"><span>Номер</span><b>#${esc(g.number)}</b></div><div class="detail-row"><span>Модель</span><b>${esc(g.model||'—')}</b></div><div class="detail-row"><span>Фон</span><b>${esc(g.backdrop||'—')}</b></div><div class="detail-row"><span>Цена</span><b>${money(g.price)} GRAM</b></div><button class="primary" onclick="toast('Покупка будет доступна после настройки платежей')">${state.me.demo?'Демонстрация покупки':'Купить'} · ${money(g.price)} ◆</button>`)}
function renderGifts(){document.querySelector('#main').innerHTML=`<h1>Мои подарки</h1><div class="notice">${state.me.demo?'Тестовый инвентарь для проверки крафта.':'Здесь появятся подарки, зачисленные в ваш инвентарь приложения.'}</div>${state.inventory.length?filters()+'<div id="gifts-grid" class="grid"></div>':`<div class="empty">${icon('gift')}<h2>Ваши подарки будут здесь</h2><p>Соберите свою первую коллекцию</p><button class="primary" onclick="go('market')">Открыть маркет</button></div>`}${demoNote()}`;filterGrid()}
function renderProfile(){let m=state.me,u=m.user;document.querySelector('#main').innerHTML=`<div class="crafter-profile-heading"><h1>Профиль</h1><button type="button" class="crafter-open-settings" onclick="crafterOpenSettings()" aria-label="Настройки" title="Настройки"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5h3l.6 2.2c.6.2 1.1.4 1.6.8l2.1-.7 2.2 2.2-.7 2.1c.3.5.6 1 .8 1.6l2.2.6v3l-2.2.6c-.2.6-.5 1.1-.8 1.6l.7 2.1-2.2 2.2-2.1-.7c-.5.3-1 .6-1.6.8l-.6 2.2h-3l-.6-2.2c-.6-.2-1.1-.5-1.6-.8l-2.1.7-2.2-2.2.7-2.1c-.3-.5-.6-1-.8-1.6l-2.2-.6v-3l2.2-.6c.2-.6.5-1.1.8-1.6l-.7-2.1 2.2-2.2 2.1.7c.5-.4 1-.6 1.6-.8l.6-2.2Z"/><circle cx="12" cy="12" r="3.3"/></svg></button></div><section class="profile-card"><div class="identity"><div class="avatar">${avatar()}</div><div><h2>${esc(u.first_name)}</h2><p class="sub">@${esc(u.username||'user')} · ${esc(u.id)}</p></div><button class="pill" onclick="go('gifts')">Инвентарь<b>${state.me.demo?4:0} ♟</b></button></div><div class="stats"><div><b>${money(m.inventory_value)} GRAM</b><span>Стоимость инвентаря</span></div><div><b>${m.bought} / ${m.sold}</b><span>Куплено / Продано</span></div><div><b>${money(m.volume)} GRAM</b><span>Общий объём</span></div></div></section><div class="section-label">РЕФЕРАЛЬНАЯ ПРОГРАММА</div><section class="panel"><div class="ref-head"><strong>Уровень рефералов ${m.referral_level}</strong><b>${m.referral_progress}%</b></div><div class="progress"><div style="width:${m.referral_progress}%"></div></div><div class="ref-stats"><div><small>Приглашено друзей</small><b>${m.referrals}</b></div><div><small>До уровня 2</small><b>${Math.max(10-m.referrals,0)}</b></div></div><p>Приглашайте друзей по своей персональной ссылке.</p></section><button class="primary" onclick="invite()">Пригласить друзей</button>${m.is_admin?`<div class="section-label">УПРАВЛЕНИЕ</div><button class="panel admin-entry" onclick="openAdminPage()">${icon('shield')}<span>Админ-панель<small>Каталог, цены и модели Portals</small></span><span class="chev">›</span></button>`:''}${demoNote()}`}
async function invite(){let link=state.me.invite_link;if(!link)return toast('Укажите BOT_USERNAME в настройках сервера');if(tg?.initData)tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent('Присоединяйся к Crafter'));else try{await navigator.clipboard.writeText(link);toast('Ссылка скопирована')}catch(e){toast(link)}}
async function boot(){try{state.me=await api('me');if(typeof crafterAnnouncementsOnEnter==='function')crafterAnnouncementsOnEnter();state.catalogReady=api('catalog').then(data=>{state.catalog=data;return data}).catch(()=>state.catalog);api('referral',{}).catch(()=>{});const view=new URLSearchParams(location.search).get('view');if (typeof arenaInviteToken === 'function' && arenaInviteToken()) { await go('arena'); return; }if (!await openCollectionFromUrl()) await go(['gifts','profile'].includes(view) ? view : restoreCraftDraft() ? 'craft' : 'market')}catch(e){document.querySelector('#main').innerHTML=`<div class="empty">${icon('shield')}<h2>Не удалось загрузить приложение</h2><p>${esc(e.message)}</p><button class="secondary" onclick="location.reload()">Повторить</button></div>`}}


