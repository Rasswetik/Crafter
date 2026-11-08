/* Crafter New Year event / responsive navigation and administrator panel. */
(function(){
'use strict';
const ORNAMENT='/static/assets/new-year-ornament.svg';
const SEASON_ICON='<img class="ny-nav-icon" src="'+ORNAMENT+'" alt="">';
const pending=new Map();
let busy=false;
let lastData=null;

function active(){return Boolean(state?.me?.new_year_enabled);}
function escapeHTML(value){return typeof esc==='function'?esc(value):String(value??'');}
function safeInt(value){const n=Number(value);return Number.isFinite(n)?n.toLocaleString('ru-RU'):'0';}
function giftImage(lot){return typeof lot.gift.image==='string'&&lot.gift.image.startsWith('https://')?lot.gift.image:'';}
function nftArt(lot){const url=giftImage(lot);return url?'<img src="'+escapeHTML(url)+'" loading="lazy" alt="'+escapeHTML(lot.gift.name)+'">':'<span class="ny-unloaded-art">NFT</span>';}
function displayOrnament(){return '<img src="'+ORNAMENT+'" alt="" aria-hidden="true">';}
function updateHeaderWallet(balance){
    const el=document.querySelector('#app > header > .winter-currency-balance');
    if(!el)return;
    const num=Number(balance?.balls||0);
    const value=el.querySelector('b');
    if(value)value.textContent=safeInt(num);
    el.title='Новогодние шары';
    el.setAttribute('aria-label','Новогодние шары: '+safeInt(num));
    for(const key of ['balls','donate','tinsel']){
        const hud=document.querySelector('[data-ny-wallet="'+key+'"]');
        if(hud)hud.textContent=safeInt(balance?.[key]||0);
    }
}
function navSeason(){
    if(!state?.me)return;
    const main=document.querySelector('#nav .nav-main');
    const current=main?.querySelector('.ny-nav-tab');
    if(current)current.remove();
    if(active()&&main){
        const button=document.createElement('button');
        button.className='ny-nav-tab'+(state.page==='new-year'?' active':'');
        button.type='button';
        button.dataset.gamePage='new-year';
        button.setAttribute('aria-label','Новый год');
        button.innerHTML='<span class="stake-nav-icon">'+SEASON_ICON+'</span><span class="nav-label">Новый год</span>';
        button.addEventListener('click',()=>go('new-year'));
        const market=main.querySelector('[data-game-page="market"]');
        if(market)market.after(button);else main.prepend(button);
    }
    const desktop=document.querySelector('#crafter-desktop-sidebar .desktop-sidebar-menu');
    desktop?.querySelector('.ny-desktop-link')?.remove();
    if(active()&&desktop){
        const button=document.createElement('button');
        button.type='button';
        button.className='desktop-sidebar-link ny-desktop-link'+(state.page==='new-year'?' is-active':'');
        button.setAttribute('aria-current',state.page==='new-year'?'page':'false');
        button.innerHTML='<span class="desktop-sidebar-link-icon">'+SEASON_ICON+'</span><span>Новый год</span>';
        button.addEventListener('click',()=>go('new-year'));
        const market=desktop.querySelector('button[onclick*="market"]');
        if(market)market.after(button);else desktop.prepend(button);
    }
}
window.crafterNewYearNavRefresh=navSeason;
window.crafterNewYearUpdateBalance=updateHeaderWallet;
const beforeNav=nav;
nav=function(){beforeNav.apply(this,arguments);navSeason();};
if(typeof window.crafterDesktopNavRefresh==='function'){
    const originalDesktop=window.crafterDesktopNavRefresh;
    window.crafterDesktopNavRefresh=function(){originalDesktop();navSeason();};
}

function balances(data){
    const wallet=data?.balance||{};
    return '<div class="ny-hud">'+
        '<div class="ny-balance">'+displayOrnament()+'<div><small>Баланс шаров</small><strong data-ny-wallet="balls">'+
        safeInt(wallet.balls)+'</strong></div></div>'+
        '<div class="ny-right">'+
        '<div class="ny-balance"><div><small>Донат</small><strong data-ny-wallet="donate">'+safeInt(wallet.donate)+'</strong></div></div>'+
        '<div class="ny-balance"><div><small>Мишура</small><strong data-ny-wallet="tinsel">'+safeInt(wallet.tinsel)+'</strong></div></div>'+
        '</div></div>';
}
function lotTile(lot){
    const name=escapeHTML(lot.gift.name);
    return '<button type="button" class="ny-lot" data-ny-lot="'+escapeHTML(lot.id)+'">'+
        '<div class="ny-lot-art">'+nftArt(lot)+'</div>'+
        '<div class="ny-lot-name">'+name+'</div>'+
        '<div class="ny-lot-id">#'+escapeHTML(lot.gift.number)+'</div>'+
        '<div class="ny-lot-price">'+displayOrnament()+safeInt(lot.price)+'</div></button>';
}
async function showNewYear(){
    const main=document.querySelector('#main');
    if(!main)return;
    main.innerHTML='<div class="new-year-page"><div class="ny-hero"><small>CRAFTER · WINTER EVENT</small><h1>Новый год</h1><p>Загружаем праздничный маркет...</p></div></div>';
    try{
        const data=await api('new-year');
        if(state.page!=='new-year'||!main.isConnected)return;
        if(!data.enabled&&!state.me?.is_admin){
            state.me.new_year_enabled=false;await go('market');return;
        }
        lastData=data;updateHeaderWallet(data.balance);
        main.innerHTML='<div class="new-year-page">'+
            '<section class="ny-hero"><small>CRAFTER · WINTER EVENT</small>'+
            '<h1>Новогодний маркет</h1><p>Коллекционные NFT-подарки за новогодние шары.</p></section>'+
            '<div class="ny-section-title"><h2>Праздничные подарки</h2><span>'+data.lots.length+' лотов</span></div>'+
            (data.lots.length?'<div class="ny-grid">'+data.lots.map(lotTile).join('')+'</div>':
             '<div class="ny-empty">'+displayOrnament()+'<h3>Подарочки уже в пути!</h3>'+
             '<p>Совсем скоро здесь появятся новогодние NFT-подарки. Следите за обновлениями!</p></div>')+
            '</div>';
        main.querySelectorAll('[data-ny-lot]').forEach(btn=>{
            btn.addEventListener('click',()=>openLot(btn.dataset.nyLot));
        });
    }catch(error){
        if(state.page==='new-year')main.innerHTML='<div class="new-year-page ny-empty">'+
            '<h3>Не удалось загрузить подарки</h3><p>'+escapeHTML(error.message)+'</p>'+
            '<button class="secondary" type="button" onclick="go(\'new-year\')">Повторить</button></div>';
    }
}
async function openLot(id){
    const original=lastData?.lots?.find(x=>x.id===id);
    if(!original)return toast('Лот недоступен, обновите страницу');
    sheet('','<div class="ny-detail-loading">Загрузка данных NFT из Telegram…</div>');
    const detail=document.querySelector('#sheet-body');
    try{
        const response=await api('new-year/lots/'+encodeURIComponent(id)+'/details');
        if(!detail?.isConnected)return;
        const lot=response.lot;
        if(!lastData.lots.some(x=>x.id===id))return;
        lastData.lots=lastData.lots.map(x=>x.id===id?lot:x);
        const traits=[
            ['Модель',lot.gift.model],
            ['Узор',lot.gift.symbol],
            ['Фон',lot.gift.backdrop]
        ];
        const rarity=lot.gift.rarity||{};
        const names=['model','symbol','backdrop'];
        const lines=traits.map(([label,value],i)=>{
            const percent=Number(rarity[names[i]]);
            return '<div><span>'+label+'</span><strong>'+
                escapeHTML(value||'Нет данных Portals')+
                (Number.isFinite(percent)&&percent>0?' <small>'+safeInt(percent/10)+'%</small>':'')+
                '</strong></div>';
        });
        lines.push('<div><span>Мин. цена</span><strong>'+
            (lot.gift.floor_price?escapeHTML(lot.gift.floor_price)+' GRAM':'Нет данных Portals')+'</strong></div>');
        lines.push('<div><span>Стоимость</span><strong>'+safeInt(lot.price)+' шаров</strong></div>');
        detail.innerHTML='<div class="ny-detail-visual">'+nftArt(lot)+
            '<div class="ny-detail-label">'+escapeHTML(lot.gift.name)+' #'+
            escapeHTML(lot.gift.number)+'</div></div>'+
            '<div class="ny-property-table">'+lines.join('')+'</div>'+
            '<button id="ny-buy" type="button" class="ny-action">Buy Gift · '+
            safeInt(lot.price)+' '+displayOrnament()+'</button>'+
            '<a class="ny-detail-view" href="'+escapeHTML(lot.url)+
            '" target="_blank" rel="noopener noreferrer">Посмотреть NFT в Telegram ↗</a>'+
            '<p id="ny-buy-error" class="purchase-error" role="alert"></p>';
        document.querySelector('#sheet')?.classList.add('purchase-sheet');
        detail.querySelector('#ny-buy')?.addEventListener('click',()=>buyLot(lot));
    }catch(error){
        if(detail?.isConnected)detail.innerHTML='<div class="ny-detail-error" role="alert">'+
            escapeHTML(error.message||'Данные NFT недоступны')+
            '<p>Сведения о подарке должны быть подтверждены Portals. Покупка недоступна до загрузки.</p>'+
            '<button type="button" class="secondary" id="ny-detail-retry">Повторить</button></div>';
        detail.querySelector('#ny-detail-retry')?.addEventListener('click',()=>openLot(id));
    }
}
async function buyLot(lot){
    if(busy)return;
    busy=true;
    const btn=document.querySelector('#ny-buy');
    if(btn)btn.disabled=true;
    try{
        if(!pending.has(lot.id))pending.set(lot.id,crypto.randomUUID());
        const result=await api('new-year/buy',{lot_id:lot.id,request_id:pending.get(lot.id)});
        pending.delete(lot.id);
        lastData.balance=result.balance;
        lastData.lots=lastData.lots.filter(x=>x.id!==lot.id);
        updateHeaderWallet(result.balance);
        if(state.me)state.me.inventory_count=(state.me.inventory_count||0)+1;
        if(Array.isArray(state.inventory))state.inventory.push({...result.gift,status:'unlisted'});
        closeSheet();
        await showNewYear();
        toast('Подарок добавлен в инвентарь Crafter');
    }catch(error){
        const output=document.querySelector('#ny-buy-error');
        if(output)output.textContent=error.message;
        else toast(error.message);
    }finally{busy=false;if(btn?.isConnected)btn.disabled=false;}
}

const beforeGo=go;
go=async function(page,...args){
    if(page!=='new-year'){
        if(state.page==='new-year'){
            document.querySelector('#app')?.classList.remove('new-year-view');
        }
        return beforeGo.call(this,page,...args);
    }
    if(!active())return toast('Раздел Новый год пока отключён');
    if(state.crafting)return;
    if(state.page==='arena'&&typeof leaveArena==='function')leaveArena();
    state.page='new-year';state.gamesMode=false;
    document.querySelector('#app')?.classList.remove('games-view','arena-view','staking-view','craft-view','cart-view');
    document.querySelector('#app')?.classList.add('new-year-view');
    document.querySelector('#cart-float')?.remove();
    if(typeof nav==='function')nav();
    await showNewYear();
};
async function pollSeason(){
    if(!state?.me||document.visibilityState==='hidden')return;
    try{
        const status=await api('new-year/status');
        if(typeof status.enabled==='boolean'&&status.enabled!==active()){
            state.me.new_year_enabled=status.enabled;
            nav();
            if(state.page==='new-year'&&!status.enabled&&!state.me.is_admin)go('market');
        }
    }catch(_){}
}
setInterval(pollSeason,30000);

function formFields(form){return Object.fromEntries(new FormData(form));}
function adminLot(lot){
    const text=escapeHTML(lot.gift.name+' #'+lot.gift.number);
    return '<div class="ny-admin-row"><div><b>'+text+'</b><small>'+
        safeInt(lot.price)+' шаров · '+(lot.status==='active'?'Активен':lot.status==='sold'?'Продан':'Скрыт')+
        '</small></div><button type="button" data-ny-admin-lot="'+escapeHTML(lot.id)+'" '+
        (lot.status==='sold'?'disabled':'')+'>'+
        (lot.status==='active'?'Скрыть':'Вернуть')+'</button></div>';
}
async function renderAdminNewYear(content=document.querySelector('#admin-content')){
    const result=await api('admin/new-year');
    if(!content?.isConnected)return;
    content.innerHTML='<section class="ny-admin-section"><h3>Новый год</h3>'+
      '<label class="ny-admin-switch"><span><b>Показывать Новый год всем игрокам</b><small class="sub" style="display:block;margin-top:6px">Кнопка появится в мобильной панели и под Маркетом на ПК.</small></span>'+
      '<input type="checkbox" id="ny-admin-enabled" '+(result.enabled?'checked':'')+'></label></section>'+
      '<section class="ny-admin-section"><h3>Создать NFT-лот</h3>'+
      '<p class="sub">Модель, фон, узор и изображение — по ссылке Telegram; флор коллекции — из Portals.</p>'+
      '<form id="ny-admin-lot-form"><div class="ny-admin-fields">'+
      '<label class="full">Ссылка на NFT<input name="url" placeholder="https://t.me/nft/ChillFlame-426793" required type="url"></label>'+
      '<label>Цена в шарах<input name="price" type="number" min="1" max="1000000000" step="1" required></label>'+
      
      
      
      
      '</div><button class="primary" type="submit">Создать лот</button></form></section>'+
      '<section class="ny-admin-section"><h3>Балансы игроков</h3>'+
      '<p class="sub">Начислить или списать тестовую праздничную валюту. Для списания используйте отрицательное число.</p>'+
      '<form id="ny-admin-wallet-form"><div class="ny-admin-fields">'+
      '<label class="full">Telegram ID<input name="user_id" inputmode="numeric" type="text" pattern="[0-9]+" required></label>'+
      '<label>Шары<input name="balls" type="number" step="1" value="0"></label>'+
      '<label>Донат<input name="donate" type="number" step="1" value="0"></label>'+
      '<label>Мишура<input name="tinsel" type="number" step="1" value="0"></label>'+
      '</div><button class="primary" type="submit">Применить к балансу</button></form></section>'+
      '<section class="ny-admin-section"><h3>Новогодние лоты</h3>'+
      '<div class="ny-admin-list">'+(result.lots.length?result.lots.map(adminLot).join(''):'<p class="sub">Лотов пока нет.</p>')+
      '</div></section>';
    const toggle=content.querySelector('#ny-admin-enabled');
    toggle.addEventListener('change',async()=>{
        toggle.disabled=true;
        const checked=toggle.checked;
        try{
            await api('admin/new-year/settings',{enabled:checked});
            state.me.new_year_enabled=checked;
            toast(checked?'Новый год включён для игроков':'Раздел Новый год выключен');
        }catch(error){toggle.checked=!checked;toast(error.message);}
        finally{toggle.disabled=false;}
    });
    for(const [id,endpoint] of [['ny-admin-lot-form','new-year/lots'],['ny-admin-wallet-form','new-year/wallet']]){
        const form=content.querySelector('#'+id);
        form.addEventListener('submit',async(event)=>{
            event.preventDefault();
            const button=form.querySelector('[type="submit"]');
            button.disabled=true;
            try{
                const data=formFields(form);
                const result=await api('admin/'+endpoint,data);
                toast(endpoint.endsWith('wallet')?'Баланс сохранён':'NFT-лот добавлен');
                await renderAdminNewYear(content);
            }catch(error){toast(error.message);}
            finally{if(button.isConnected)button.disabled=false;}
        });
    }
    content.querySelectorAll('[data-ny-admin-lot]').forEach(button=>{
        button.addEventListener('click',async()=>{
            const lot=result.lots.find(l=>l.id===button.dataset.nyAdminLot);
            if(!lot)return;
            button.disabled=true;
            try{
                await api('admin/new-year/lots/'+lot.id+'/status',
                          {status:lot.status==='active'?'hidden':'active'});
                await renderAdminNewYear(content);
                toast('Состояние лота изменено');
            }catch(error){toast(error.message);button.disabled=false;}
        });
    });
}
window.renderAdminNewYear=renderAdminNewYear;
})();
