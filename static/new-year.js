/* Crafter New Year event / responsive navigation and administrator panel. */
(function(){
'use strict';
const ORNAMENT='/static/assets/new-year-ornament.svg';

/* A team of reindeer pulling a sleigh: a small line icon for the menu and a soft scene for the event tile. */
const DEER = (x, y, s, c, cls) => '<g class="ny-deer ' + cls + '" transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + c + '"><g class="ny-deer-bob">' +
    '<path d="M-22 -4C-22 -15 -8 -18 5 -17C16 -16 23 -10 22 -2C21 7 9 11 -4 10C-15 9 -22 5 -22 -4z"/><path d="M15 -13L27 -29L35 -24L25 -6z"/>' +
    '<ellipse cx="35" cy="-28" rx="9" ry="6.4" transform="rotate(-22 35 -28)"/><circle cx="43" cy="-26.5" r="2.4" fill="#ff4d5e"/>' +
    '<path d="M32 -34L29 -47M30 -42L22 -45M30 -42L35 -52M37 -33L43 -45M41 -40L48 -42" fill="none" stroke="' + c + '" stroke-width="2.2" stroke-linecap="round"/>' +
    '<circle cx="-23" cy="-7" r="3.2" fill="#fff3d9"/>' +
    '<path class="lg l1" d="M14 6L22 25" fill="none" stroke="' + c + '" stroke-width="4.2" stroke-linecap="round"/><path class="lg l2" d="M7 8L10 27" fill="none" stroke="' + c + '" stroke-width="4.2" stroke-linecap="round"/>' +
    '<path class="lg l3" d="M-12 7L-21 24" fill="none" stroke="' + c + '" stroke-width="4.2" stroke-linecap="round"/><path class="lg l4" d="M-5 9L-9 27" fill="none" stroke="' + c + '" stroke-width="4.2" stroke-linecap="round"/></g></g>';
const SLEIGH_SCENE = '<svg class="ny-sleigh" viewBox="0 0 280 120" aria-hidden="true" focusable="false">' +
    '<g fill="#fff"><path class="tw tw1" d="M30 18l2.2 5.8L38 26l-5.8 2.2L30 34l-2.2-5.8L22 26l5.8-2.2z"/><path class="tw tw2" d="M246 14l1.6 4.2L252 20l-4.4 1.6L246 26l-1.6-4.4L240 20l4.4-1.8z"/><circle class="tw tw3" cx="150" cy="12" r="2"/><circle class="tw tw1" cx="96" cy="32" r="1.6"/></g>' +
    '<g class="ny-sl-body"><path d="M6 94h40M0 102h26M14 86h22" fill="none" stroke="#cfe6ff" stroke-width="2" stroke-linecap="round" opacity=".5"/>' +
    '<g transform="translate(46 70)"><path d="M-8 22H70q9 0 9-9" fill="none" stroke="#ffd98a" stroke-width="4" stroke-linecap="round"/><path d="M4 12V22M52 12V22" stroke="#ffd98a" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M-6 -8H62q8 0 6 8L62 14H0q-6 0-6-6z" fill="#ff5c6e"/><path d="M-6 -8H62q8 0 6 8" fill="none" stroke="#ffb3bb" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M2 -8Q-6 -34 14 -36Q36 -34 26 -8z" fill="#f4c26b"/><path d="M12 -34q2-6 8-4" fill="none" stroke="#fff3d0" stroke-width="2.4" stroke-linecap="round"/></g>' +
    '<path d="M118 82L154 86L196 84" fill="none" stroke="#ffd98a" stroke-width="1.8" stroke-dasharray="3 3"/>' +
    DEER(150, 82, .86, '#e1a263', 'd2') + DEER(210, 78, 1, '#f3bd7d', 'd1') + '</g></svg>';
const SLEIGH_ICON = '<svg class="ny-nav-sleigh" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2 20h14q3 0 3-3"/><path d="M3 9.5h13l-1 6.5H4z"/><path d="M4.5 9.5Q3 4 7 4t3.5 5.5"/><path d="M19 12.5h2"/>' +
    '<ellipse cx="25" cy="14" rx="4.4" ry="2.8"/><path d="M28 11.5l1.8-3.6"/><circle cx="30.4" cy="7" r="1.5"/><path d="M29.6 5.4l-.8-3m.8 3l2-1.8"/><path d="M22.4 16.4L21.4 21M27 16.6l1 4.4"/></svg>';
const SEASON_ICON=SLEIGH_ICON;
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
    document.querySelector('#nav .nav-main .ny-nav-tab')?.remove();      // on the phone the event is not in the bottom bar: it lives in the Games section
    const desktop=document.querySelector('#crafter-desktop-sidebar .desktop-sidebar-menu');
    desktop?.querySelector('.ny-desktop-link')?.remove();
    if(active()&&desktop){
        const button=document.createElement('button');
        button.type='button';
        button.className='desktop-sidebar-link ny-desktop-link'+(state.page==='new-year'?' is-active':'');
        button.setAttribute('aria-current',state.page==='new-year'?'page':'false');
        button.innerHTML='<span class="desktop-sidebar-link-icon">'+SEASON_ICON+'</span><span>Событие</span>';
        button.addEventListener('click',()=>go('new-year'));
        const market=desktop.querySelector('button[onclick*="market"]');
        if(market)market.after(button);else desktop.prepend(button);
    }
}
function addSeasonTile(){
    const wrap=document.querySelector('#main .crafter-games');
    if(!wrap||!active()||wrap.querySelector('.ny-game-tile'))return;
    wrap.insertAdjacentHTML('afterbegin','<button class="crafter-game-tile ny-game-tile" type="button" onclick="go(\'new-year\')"><span class="crafter-game-label"><strong>Событие</strong><span>Новогодний маркет, адвент-календарь и события сообщества</span><span class="crafter-game-open">Открыть</span></span><span class="ny-art" aria-hidden="true">'+SLEIGH_SCENE+'</span></button>');
}
if(typeof renderGamesHub==='function'){
    const hubBefore=renderGamesHub;
    renderGamesHub=function(){hubBefore.apply(this,arguments);addSeasonTile();};
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
let view='hub';
function community(){return window.crafterCommunity||null;}
let lockInfo={locks:{},now:0,at:0},lockTimer=null;
function isHiddenSection(name){return !state?.me?.is_admin&&(lockInfo.hidden||[]).includes(name);}
function lockLeft(name){const ts=lockInfo.locks[name];if(!ts)return 0;return Math.max(0,Math.ceil(ts-(lockInfo.now+(Date.now()-lockInfo.at)/1000)));}
function lockText(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),p=n=>String(n).padStart(2,'0');return (d?d+' д ':'')+(d||h?h+' ч ':'')+p(m)+' мин '+p(s%60)+' с';}
async function showNewYear(next){
    if(next)view=next;
    const main=document.querySelector('#main');
    if(!main)return;
    document.querySelector('#app')?.classList.toggle('fm-full',view==='market');
    nyBlur(false);
    try{
        const want=view==='market'?'/new-year/market':'/new-year',now=location.pathname.replace(/\/+$/,'');
        if(now.indexOf('/new-year')===0&&now!==want&&!(view==='market'&&now.indexOf('/new-year/market/')===0))history.pushState({crafterPage:'new-year'},'',want);
    }catch(_){}
    main.innerHTML=typeof crafterLoading==='function'?crafterLoading(view==='market'?'ny-market':view==='community'?'ny-goal':'ny-hub'):'';
    try{
        const [data,shared,packState,shopState,advState,lockReply,fbState]=await Promise.all([api('new-year'),api('community').catch(()=>null),api('packs').catch(()=>null),api('shop-items').catch(()=>null),api('advent').catch(()=>null),api('new-year/locks').catch(()=>null),api('freebies').catch(()=>null)]);
        window.__fbEvents=(fbState&&fbState.events||[]).map(x=>Object.assign({now:fbState.now},x));
        if(state.page!=='new-year'||!main.isConnected)return;
        lockInfo={locks:(lockReply&&lockReply.locks)||{},now:(lockReply&&lockReply.now)||0,at:Date.now(),hidden:(lockReply&&lockReply.hidden)||[]};
        if(view!=='hub'&&lockLeft(view)){toast('Раздел откроется позже');view='hub';}
        if(view!=='hub'&&isHiddenSection(view)){view='hub';document.querySelector('#app')?.classList.remove('fm-full');}
        if(!data.enabled&&!state.me?.is_admin){
            state.me.new_year_enabled=false;await go('market');return;
        }
        lastData=data;lastData.community=shared;lastData.packs=packState;lastData.advent=advState;updateHeaderWallet(data.balance);
        if(view==='community'&&community()&&shared?.event){community().page(main,shared,{back:()=>showNewYear('hub'),market:()=>showNewYear('market')});return;}
        if(view==='advent'&&window.crafterAdvent&&advState?.enabled){window.crafterAdvent.page(main,advState,{back:()=>showNewYear('hub'),reload:()=>showNewYear('advent')});return;}
        if(view==='market')return drawMarket(main,data,shared,packState,shopState);
        view='hub';drawHub(main,data,shared,advState);
        community()?.checkCeremony?.(shared,{market:()=>showNewYear('market')});
    }catch(error){
        if(state.page==='new-year')main.innerHTML='<div class="new-year-page ny-empty">'+
            '<h3>Не удалось загрузить подарки</h3><p>'+escapeHTML(error.message)+'</p>'+
            '<button class="secondary" type="button" onclick="go(\'new-year\')">Повторить</button></div>';
    }
}
function nyBlur(on){                                              // the village, blurred and dimmed, stands behind the hub and the pages of the event
    const app=document.querySelector('#app');if(!app)return;
    let layer=app.querySelector(':scope > .ny-bgblur');
    if(!on){layer?.remove();return;}
    if(layer)return;
    layer=document.createElement('div');layer.className='ny-bgblur';layer.setAttribute('aria-hidden','true');
    layer.innerHTML=(typeof villageScene==='function'?villageScene():'')+'<i></i>';
    app.prepend(layer);
}
function drawHub(main,data,shared,advState){
    const art=community()?.marketArt?.()||'';
    main.innerHTML='<div class="new-year-page ny-hubpage">'+
        (isHiddenSection('market')?'':'<button type="button" class="nyh-card nyh-market" data-nyh="market" aria-label="Особый маркет">'+art+
        '<span class="nyh-copy"><strong>Особый маркет</strong></span><i class="nyh-go" aria-hidden="true">›</i></button>')+
        (community()&&shared?.event&&!isHiddenSection('community')?community().card(shared):'')+
        (window.crafterAdvent&&advState?.enabled&&!isHiddenSection('advent')?window.crafterAdvent.card(advState):'')+
        '</div>';
    ['market','community','advent'].forEach(name=>{
        const card=main.querySelector('[data-nyh="'+name+'"]');if(!card)return;
        if(lockLeft(name)){
            card.classList.add('is-soon');card.setAttribute('aria-disabled','true');
            card.insertAdjacentHTML('beforeend','<span class="nyh-soon"><small>Откроется через</small><b data-soon="'+name+'">'+lockText(lockLeft(name))+'</b></span>');
            card.addEventListener('click',()=>toast('Откроется через '+lockText(lockLeft(name))));
        }else card.addEventListener('click',()=>showNewYear(name));
    });
    clearInterval(lockTimer);
    if(main.querySelector('[data-soon]'))lockTimer=setInterval(()=>{
        if(!main.isConnected||state.page!=='new-year'){clearInterval(lockTimer);return;}
        let opened=false;
        main.querySelectorAll('[data-soon]').forEach(el=>{const s=lockLeft(el.dataset.soon);if(s<=0)opened=true;else el.textContent=lockText(s);});
        if(opened){clearInterval(lockTimer);showNewYear('hub');}
    },1000);
}
const SEASON_GIFTS=['candycane','cookieheart','gingercookie','holidaydrink','jinglebells','partysparkler','santahat','sleighbell','snowglobe','snowmittens','spicedwine','winterwreath','xmasstocking'];

/* The banner of the New Year market: a decorated night village, drawn in SVG (houses, a chapel, firs with garlands, the aurora, the moon,
   smoke, lights, falling snow and a small sleigh crossing the sky). Everything is generated here, nothing is loaded. */
window.crafterVillage=function(){return villageScene();};
function villageScene(){
    let seed=17;
    const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
    const f=v=>Number(v).toFixed(1);
    const COL=['#ff5c6e','#ffd27a','#6ac7ff','#b58cff','#7ae0a8'];
    let stars='';
    for(let i=0;i<80;i++)stars+='<circle class="nyv-tw" cx="'+f(rnd()*1200)+'" cy="'+f(rnd()*170)+'" r="'+f(.5+rnd()*1.4)+'" style="animation-delay:-'+f(rnd()*5)+'s;animation-duration:'+f(2.4+rnd()*3.2)+'s"/>';
    const house=(x,base,w,h,body,shade,roof,wins,chimney)=>{
        const top=base-h,rh=h*.64,peak=top-rh,cx=x+w/2;
        let out='<g class="nyv-house"><rect x="'+f(x)+'" y="'+f(top)+'" width="'+f(w)+'" height="'+f(h)+'" fill="'+body+'"/><rect x="'+f(x+w*.74)+'" y="'+f(top)+'" width="'+f(w*.26)+'" height="'+f(h)+'" fill="'+shade+'"/>';
        if(chimney){
            const cxm=x+w*.7;
            out+='<rect x="'+f(cxm)+'" y="'+f(peak+rh*.3)+'" width="'+f(w*.12)+'" height="'+f(rh*.6)+'" fill="#7a4b3a"/><rect x="'+f(cxm-3)+'" y="'+f(peak+rh*.26)+'" width="'+f(w*.12+6)+'" height="7" rx="3" fill="#f4f8ff"/>';
            for(let k=0;k<3;k++)out+='<circle class="nyv-smoke" cx="'+f(cxm+w*.06)+'" cy="'+f(peak+rh*.22)+'" r="'+f(w*.045)+'" style="animation-delay:-'+f(k*2.2+rnd())+'s"/>';
        }
        out+='<path d="M'+f(x-9)+' '+f(top+4)+'L'+f(cx)+' '+f(peak)+'L'+f(x+w+9)+' '+f(top+4)+'Z" fill="'+roof+'"/>';
        out+='<path d="M'+f(x-10)+' '+f(top-1)+'L'+f(cx)+' '+f(peak-6)+'L'+f(x+w+10)+' '+f(top-1)+'Q'+f(x+w*.86)+' '+f(top+9)+' '+f(x+w*.7)+' '+f(top+1)+'T'+f(x+w*.42)+' '+f(top+1)+'T'+f(x+w*.14)+' '+f(top+3)+'T'+f(x-10)+' '+f(top-1)+'Z" fill="#f6faff"/>';
        for(let k=0;k<6;k++){const px=x-4+k*(w+8)/5.2;out+='<path d="M'+f(px)+' '+f(top+3)+'l3.4 0-1.7 '+f(5+rnd()*6)+'z" fill="#d6ecff" opacity=".9"/>';}
        wins.forEach(([fx,fy])=>{
            const wx=x+w*fx,wy=top+h*fy,ww=w*.2,wh=h*.27;
            out+='<circle class="nyv-win-glow" cx="'+f(wx+ww/2)+'" cy="'+f(wy+wh/2)+'" r="'+f(ww*1.25)+'" fill="url(#nyv-glow)"/><rect class="nyv-win" x="'+f(wx)+'" y="'+f(wy)+'" width="'+f(ww)+'" height="'+f(wh)+'" rx="2" fill="#ffd27a" style="animation-delay:-'+f(rnd()*6)+'s;animation-duration:'+f(2.6+rnd()*5)+'s"/><path d="M'+f(wx+ww/2)+' '+f(wy)+'v'+f(wh)+'M'+f(wx)+' '+f(wy+wh/2)+'h'+f(ww)+'" stroke="#b06a1c" stroke-width="1.2"/>';
        });
        out+='<rect x="'+f(cx-w*.09)+'" y="'+f(base-h*.4)+'" width="'+f(w*.18)+'" height="'+f(h*.4)+'" rx="'+f(w*.09)+'" fill="#5a2d1a"/><circle cx="'+f(cx)+'" cy="'+f(base-h*.27)+'" r="'+f(w*.055)+'" fill="none" stroke="#e0425a" stroke-width="2.6"/><circle cx="'+f(cx)+'" cy="'+f(base-h*.27)+'" r="'+f(w*.055)+'" fill="none" stroke="#2f8a4a" stroke-width="1" stroke-dasharray="2 3"/>';
        return out+'</g>';
    };
    const fir=(cx,base,s,deco,star)=>{
        let out='<g transform="translate('+f(cx)+' '+f(base)+') scale('+s+')"><rect x="-4" y="6" width="8" height="12" fill="#4a2c1a"/><path d="M0 -64L15 -37H7L20 -15H9L25 8H-25L-9 -15H-20L-7 -37H-15Z" fill="#1f6a5d"/><path d="M0 -64L15 -37H7L20 -15H9L25 8H-25L-9 -15H-20L-7 -37H-15Z" fill="#2c8a74" opacity=".35" transform="translate(5 0)"/>';
        out+='<path d="M0 -64L7 -50L0 -53L-7 -50Z M-15 -37L-9 -27L-4 -31L2 -27L8 -31L15 -37L7 -37L0 -34L-7 -37Z M-20 -15L-14 -6L-8 -10L-1 -5L6 -10L12 -6L20 -15L9 -15L0 -11L-9 -15Z" fill="#f2f8ff"/>';
        if(deco){
            out+='<path d="M-11 -34Q0 -26 11 -34M-17 -13Q0 -3 17 -13M-22 6Q0 16 22 6" fill="none" stroke="#ffd98a" stroke-width="1.3" opacity=".9"/>';
            [[-8,-31],[7,-30],[0,-22],[-14,-10],[3,-8],[14,-9],[-19,8],[-6,12],[9,11],[19,6]].forEach((p,i)=>{
                out+='<circle class="nyv-bulb" cx="'+p[0]+'" cy="'+p[1]+'" r="2.3" fill="'+COL[i%COL.length]+'" style="animation-delay:-'+f(rnd()*3)+'s"/>';
            });
        }
        if(star)out+='<circle cx="0" cy="-66" r="13" fill="url(#nyv-glow)"/><path class="nyv-star" d="M0 -76l3 7 8 .8-6 5.4 1.8 7.8L0 -61l-6.8 4 1.8-7.8-6-5.4 8-.8z" fill="#ffe08a"/>';
        return out+'</g>';
    };
    const lamp=x=>'<g><circle class="nyv-win-glow" cx="'+x+'" cy="262" r="26" fill="url(#nyv-glow)"/><rect x="'+(x-1.5)+'" y="266" width="3" height="40" fill="#2b2f44"/><rect x="'+(x-5)+'" y="256" width="10" height="13" rx="2.5" fill="#ffd27a" class="nyv-win" style="animation-delay:-'+f(rnd()*4)+'s"/><path d="M'+(x-7)+' 256l7-7 7 7z" fill="#2b2f44"/></g>';
    const garland=(x1,y1,cxm,cym,x2,y2,n)=>{
        let out='<path d="M'+x1+' '+y1+'Q'+cxm+' '+cym+' '+x2+' '+y2+'" fill="none" stroke="#3a3350" stroke-width="1.4"/>';
        for(let i=1;i<n;i++){const t=i/n,x=(1-t)*(1-t)*x1+2*(1-t)*t*cxm+t*t*x2,y=(1-t)*(1-t)*y1+2*(1-t)*t*cym+t*t*y2;
            out+='<circle class="nyv-bulb" cx="'+f(x)+'" cy="'+f(y+2)+'" r="2.6" fill="'+COL[i%COL.length]+'" style="animation-delay:-'+f(rnd()*3)+'s"/>';}
        return out;
    };
    let flakes='';
    for(let i=0;i<78;i++)flakes+='<circle class="nyv-flake" cx="'+f(rnd()*1200)+'" cy="-10" r="'+f(1.3+rnd()*(i%5===0?4:2.6))+'" style="animation-duration:'+f(7+rnd()*8)+'s;animation-delay:-'+f(rnd()*12)+'s;--dx:'+f(-30+rnd()*60)+'px"/>';
    const fw=(x,y,c,delay)=>{let l='';for(let i=0;i<14;i++)l+='<line x1="0" y1="-7" x2="0" y2="-'+(i%2?20:28)+'" stroke="'+c+'" stroke-width="2.2" stroke-linecap="round" transform="rotate('+(i*360/14)+')"/>';return '<g class="nyv-fw" transform="translate('+x+' '+y+')" style="animation-delay:'+delay+'s">'+l+'<circle r="3" fill="'+c+'"/></g>';};
    const stall=(x,base,c1)=>{let st='';for(let i=0;i<6;i++)st+='<path d="M'+(x+i*10)+' '+(base-44)+'h10v9a5 5 0 0 1-10 0z" fill="'+(i%2?'#fff6ee':c1)+'"/>';return '<g><rect x="'+(x+3)+'" y="'+(base-36)+'" width="4" height="36" fill="#5b3a26"/><rect x="'+(x+53)+'" y="'+(base-36)+'" width="4" height="36" fill="#5b3a26"/><rect x="'+(x+6)+'" y="'+(base-28)+'" width="48" height="20" fill="#2a1912"/><rect class="nyv-win" x="'+(x+9)+'" y="'+(base-25)+'" width="42" height="13" rx="2" fill="#ffd27a" style="animation-delay:-'+f(rnd()*4)+'s"/><circle class="nyv-win-glow" cx="'+(x+30)+'" cy="'+(base-19)+'" r="34" fill="url(#nyv-glow)"/><rect x="'+(x+8)+'" y="'+(base-8)+'" width="44" height="8" fill="#7a4b3a"/><path d="M'+(x-3)+' '+(base-44)+'L'+(x+30)+' '+(base-58)+'L'+(x+63)+' '+(base-44)+'z" fill="#b8374a"/><path d="M'+(x-4)+' '+(base-45)+'L'+(x+30)+' '+(base-60)+'L'+(x+64)+' '+(base-45)+'q-16 6-34 2t-34-2z" fill="#f6faff"/>'+st+'<circle class="nyv-bulb" cx="'+(x+8)+'" cy="'+(base-30)+'" r="2.4" fill="#ff5c6e"/><circle class="nyv-bulb" cx="'+(x+52)+'" cy="'+(base-30)+'" r="2.4" fill="#6ac7ff" style="animation-delay:-1.3s"/></g>';};
    const sleigh=SLEIGH_SCENE.replace('<svg class="ny-sleigh" viewBox="0 0 280 120" aria-hidden="true" focusable="false">','<svg x="0" y="0" width="170" height="73" viewBox="0 0 280 120" overflow="visible">');
    return '<svg viewBox="0 0 1200 340" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>'+
        '<linearGradient id="nyv-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b2c"/><stop offset=".55" stop-color="#1c2468"/><stop offset=".85" stop-color="#5b3a86"/><stop offset="1" stop-color="#b86a8f"/></linearGradient>'+
        '<radialGradient id="nyv-glow"><stop offset="0" stop-color="#ffd98a" stop-opacity=".85"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>'+
        '<radialGradient id="nyv-moon"><stop offset="0" stop-color="#fff4cf" stop-opacity=".55"/><stop offset="1" stop-color="#fff4cf" stop-opacity="0"/></radialGradient>'+
        '<linearGradient id="nyv-aur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5dffc0" stop-opacity="0"/><stop offset=".45" stop-color="#4fe0c8" stop-opacity=".55"/><stop offset="1" stop-color="#7a6bff" stop-opacity="0"/></linearGradient>'+
        '<linearGradient id="nyv-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#050824" stop-opacity=".82"/><stop offset=".5" stop-color="#050824" stop-opacity=".42"/><stop offset="1" stop-color="#050824" stop-opacity="0"/></linearGradient>'+
        '<linearGradient id="nyv-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f8ff"/><stop offset="1" stop-color="#b9c8ef"/></linearGradient>'+
        '<filter id="nyv-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="16"/></filter></defs>'+
        '<rect width="1200" height="340" fill="url(#nyv-sky)"/>'+
        '<g class="nyv-aurora" filter="url(#nyv-blur)"><path d="M-40 120C160 20 320 150 520 70S860 30 1240 110V190C900 120 700 190 500 140S120 100-40 190Z" fill="url(#nyv-aur)"/><path class="nyv-aur2" d="M300 90C500 10 700 110 900 50S1120 40 1240 80V150C1040 100 860 150 700 120S440 80 300 150Z" fill="url(#nyv-aur)" opacity=".7"/></g>'+
        stars+
        '<circle cx="985" cy="74" r="120" fill="url(#nyv-moon)"/><circle cx="985" cy="74" r="35" fill="#fff6d8"/><circle cx="974" cy="66" r="6" fill="#efe2b4" opacity=".7"/><circle cx="996" cy="86" r="4.5" fill="#efe2b4" opacity=".6"/><circle cx="992" cy="60" r="3" fill="#efe2b4" opacity=".6"/>'+
        '<g class="nyv-fly">'+sleigh+'</g>'+fw(760,70,'#ffd36b',0)+fw(1090,118,'#7cc8ff',2.8)+fw(880,42,'#ff7a9a',5.2)+
        '<rect width="1200" height="340" fill="url(#nyv-shade)"/>'+
        '<path d="M0 238L110 168L185 214L320 118L450 218L560 172L690 230L830 146L970 216L1090 164L1200 220V340H0Z" fill="#2a3680"/>'+
        '<path d="M320 118L296 152L314 146L328 160L346 144L364 156L344 134Z M830 146L808 176L824 170L838 182L856 168L870 178L850 160Z M110 168L92 192L108 188L122 198L136 186Z" fill="#c9d8ff" opacity=".85"/>'+
        '<path d="M0 266Q140 226 300 256T600 248T900 254T1200 240V340H0Z" fill="#1c2766"/>'+
        fir(70,278,.75,false)+fir(150,284,.6,false)+fir(430,270,.7,false)+fir(520,276,.55,false)+fir(700,274,.62,false)+fir(1170,276,.72,false)+
        house(205,298,92,64,'#e6b980','#c79a62','#b8374a',[[.18,.3],[.6,.3]],true)+
        house(330,300,70,52,'#8fc1dd','#6fa2c2','#2f4f95',[[.2,.28],[.62,.28]],true)+
        '<g class="nyv-house"><rect x="578" y="206" width="46" height="94" fill="#d9c7ad"/><rect x="610" y="206" width="14" height="94" fill="#b8a688"/><path d="M570 210L601 118L632 210Z" fill="#b8374a"/><path d="M570 206L601 114L632 206Q616 216 601 208T570 206Z" fill="#f6faff"/><rect x="598" y="92" width="6" height="30" fill="#d9c7ad"/><path d="M601 70v26M591 80h20" stroke="#ffe08a" stroke-width="3" stroke-linecap="round"/><circle cx="601" cy="226" r="11" fill="#ffd27a" class="nyv-win" style="animation-delay:-1.4s"/><circle cx="601" cy="226" r="26" fill="url(#nyv-glow)" class="nyv-win-glow"/><rect x="592" y="262" width="18" height="38" rx="9" fill="#5a2d1a"/></g>'+
        house(660,300,96,68,'#d88a8a','#b46868','#2f6f5c',[[.16,.3],[.6,.3]],true)+
        house(790,302,74,54,'#e8cf93','#c9ad6a','#7d3a8a',[[.2,.28],[.62,.28]],true)+
        stall(420,300,'#2f7be0')+stall(494,302,'#8a5be0')+stall(870,302,'#e0425a')+
        garland(222,244,265,262,330,250,7)+garland(400,252,520,272,578,250,9)+garland(624,250,640,262,688,248,5)+garland(756,246,775,262,790,258,5)+
        lamp(180)+lamp(440)+lamp(740)+lamp(860)+
        fir(1020,296,1.55,true,true)+
        '<g><rect x="975" y="286" width="22" height="18" rx="2" fill="#e0425a"/><rect x="984" y="286" width="4" height="18" fill="#ffe08a"/><rect x="1036" y="290" width="26" height="14" rx="2" fill="#4a8ee8"/><rect x="1047" y="290" width="4" height="14" fill="#fff"/><rect x="1004" y="294" width="16" height="12" rx="2" fill="#8a5be0"/></g>'+
        fir(930,302,.9,true)+fir(1100,304,.95,true)+
        '<path d="M0 304Q200 282 430 300T840 296T1200 300V340H0Z" fill="url(#nyv-snow)"/><path d="M0 322Q260 308 520 320T1200 318V340H0Z" fill="#dfe8ff"/>'+
        '<g transform="translate(120 300)"><circle cx="0" cy="-8" r="15" fill="#fff"/><circle cx="0" cy="-30" r="11" fill="#fff"/><circle cx="0" cy="-47" r="8" fill="#fff"/><path d="M0 -47l11 2-11 2z" fill="#ff8a3d"/><circle cx="-3" cy="-49" r="1.2" fill="#222"/><circle cx="3" cy="-49" r="1.2" fill="#222"/><path d="M-9 -38Q0 -33 9 -38" stroke="#e0425a" stroke-width="3.4" fill="none" stroke-linecap="round"/><rect x="-7" y="-60" width="14" height="9" rx="2" fill="#2b2f44"/><rect x="-10" y="-52" width="20" height="3" fill="#2b2f44"/></g>'+
        '<path d="M250 318v-14M262 318v-14M274 318v-14M246 310h32M246 316h32" stroke="#b07a4a" stroke-width="3" opacity=".9"/>'+
        flakes+'</svg>';
}
function marketHero(){
    return '<section class="nym-hero"><div class="nym-scene" aria-hidden="true">'+villageScene()+'</div>'+
        '<div class="nym-copy"><h1>Особый маркет</h1></div></section>';
}
function drawFestive(main,data,shared,packState,shopState){
    const wallet=()=>Number(String(document.querySelector('#app > header > .winter-currency-balance b')?.textContent||'0').replace(/\s/g,'').replace(/\u00a0/g,''))||Number(data.balance?.balls||0);
    const focus=Boolean(window.crafterCmFocusShop);
    window.crafterCmFocusShop=false;
    const ctx={data,shared,packState,shopState,freebies:window.__fbEvents||[],hero:marketHero(),back:()=>showNewYear('hub'),refresh:()=>showNewYear('market'),balance:wallet,
        section:focus?'rewards':undefined,lotTile,
        bindLots:root=>root.querySelectorAll('[data-ny-lot]').forEach(btn=>btn.addEventListener('click',()=>openLot(btn.dataset.nyLot)))};
    window.crafterFestive.render(main,ctx);
}
function drawMarket(main,data,shared,packState,shopState){
    if(window.crafterFestive)return drawFestive(main,data,shared,packState,shopState);
    const packTiles=window.crafterPacks&&packState?window.crafterPacks.tiles(packState):[];
    const shopTiles=window.crafterShopItems&&shopState?window.crafterShopItems.tiles(shopState.items):[];
    const rewards=packTiles.concat(shopTiles,community()&&shared?.event?community().tiles(shared):[]);
    const total=data.lots.length+rewards.length;
    main.innerHTML='<div class="new-year-page">'+
        '<button type="button" class="nyh-back" data-nyh-back>‹ События</button>'+
        marketHero()+
        '<div class="ny-section-title"><h2>Праздничные подарки</h2><span>'+total+' шт.</span></div>'+
        (total?'<div class="ny-grid">'+rewards.join('')+data.lots.map(lotTile).join('')+'</div>':
         '<p class="ny-quiet">Совсем скоро здесь появятся новогодние подарки.</p>')+
        '</div>';
    main.querySelector('[data-nyh-back]')?.addEventListener('click',()=>showNewYear('hub'));
    main.querySelectorAll('[data-ny-lot]').forEach(btn=>{
        btn.addEventListener('click',()=>openLot(btn.dataset.nyLot));
    });
    if(packState)window.crafterPacks?.bind(main,packState,()=>showNewYear('market'));
    if(shopState)window.crafterShopItems?.bind(main,shopState.items,()=>showNewYear('market'));
    community()?.bindShop?.(main,shared,()=>showNewYear('market'));
}
window.crafterNewYearShow=showNewYear;
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
        await showNewYear('market');
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
    view=window.__nyOpen==='advent'?'advent':'hub';window.__nyOpen=null;
    {const m=/^\/new-year\/market(?:\/([^/]+))?\/?$/.exec(location.pathname);if(m){view='market';window.__fmLot=m[1]?decodeURIComponent(m[1]):'';}}
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
window.addEventListener('popstate',()=>{                      // Back and Forward between the hub, the market and a lot
    if(state?.page!=='new-year')return;
    const p=location.pathname.replace(/\/+$/,'');
    if(p==='/new-year'&&view==='market')showNewYear('hub');
    else if(p.indexOf('/new-year/market')===0&&view!=='market'){const m=/^\/new-year\/market\/([^/]+)$/.exec(p);if(m)window.__fmLot=decodeURIComponent(m[1]);showNewYear('market');}
});

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
    content.querySelectorAll(':scope > .ny-admin-section').forEach(x=>{x.dataset.pane='main';});
    const tabs=document.createElement('div');
    tabs.className='ny-tabs';
    const names=[['main','Основное'],['events','События сообщества'],['packs','Паки'],['shop','Магазин'],['exchange','Обмен и коды'],['freebies','Подарки по дням'],['chests','Ящики'],['advent','Адвент']];
    const setTab=name=>{window.crafterNyTab=name;content.dataset.nyTab=name;tabs.querySelectorAll('button').forEach(b=>b.classList.toggle('is-on',b.dataset.tab===name));};
    tabs.innerHTML=names.map(([id,label])=>'<button type="button" data-tab="'+id+'">'+label+'</button>').join('');
    tabs.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
    content.prepend(tabs);setTab(window.crafterNyTab||'main');
    window.crafterCommunity?.admin?.(content);
    window.crafterPacks?.admin?.(content);
    window.crafterShopItems?.admin?.(content);
    window.crafterExchange?.admin?.(content);
    window.crafterFreebiesAdmin?.admin?.(content);
    window.crafterChestsAdmin?.admin?.(content);
    window.crafterAdvent?.admin?.(content);
    window.crafterNyLocks?.admin?.(content);
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
