/* Crafter desktop navigation. Actual app routes; phones retain original footer. */
(function(){
'use strict';
const media=window.matchMedia('(min-width: 1024px)');
let sidebar=null, signature='';
const options=[
 ['market','Маркет','market'],['gifts','Мои подарки','gift'],
 ['games','Игры','games'],['craft','Крафты','hammer'],['upgrade','Апгрейд','upgrade'],
 ['arena','Арена','arena'],['staking','Стейкинг','staking'],
 ['profile','Профиль','profile']
];
function desktopIcon(name) {
    if(typeof gameNavIcons!=='undefined' && gameNavIcons[name])return gameNavIcons[name];
    if(name==='upgrade')return window.crafterUpgradeIcon||'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v14"/><path d="m6 9 6-6 6 6"/><path d="M5 21h14"/></svg>';
    if(name==='hammer')return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 21 13-13M13 3l8 8M10 6l5-5 8 8-5 5Z"/></svg>';
    if(name==='profile')return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-8 16-8 16 0"/></svg>';
    return typeof icon==='function'?icon(name):'◇';
}
function eligible(page) {
    return page==='craft' ? (typeof crafterCanSeeMode!=='function'||crafterCanSeeMode('craft')) :
           page==='upgrade' ? (typeof crafterCanSeeMode!=='function'||crafterCanSeeMode('upgrade')) :
           page==='arena' ? (typeof crafterCanSeeMode!=='function'||crafterCanSeeMode('arena')) :
           page==='staking' ? (typeof crafterCanSeeMode!=='function'||crafterCanSeeMode('staking')) : true;
}
function mount(){
    if(sidebar&&sidebar.isConnected)return sidebar;
    sidebar=document.createElement('aside');
    sidebar.id='crafter-desktop-sidebar';
    sidebar.setAttribute('aria-label','Навигация Crafter на компьютере');
    document.body.append(sidebar);
    return sidebar;
}
function render(){
    const root=mount(),me=state?.me,page=state?.page||'market',user=me?.user||{};
    const next=[page,user.id,user.username,Boolean(me?.is_admin),
        ...options.map(item=>item[0]+':'+eligible(item[0]))].join('|');
    if(next===signature&&root.children.length)return;
    signature=next;
    const visible=options.filter(item=>eligible(item[0]));
    root.innerHTML=
        '<div class="desktop-sidebar-logo"><span class="desktop-brand-mark">'+
        (typeof anvilArt==='function'?anvilArt('desktop-logo-anvil'):desktopIcon('hammer'))+
        '</span><strong>Crafter</strong></div>'+
        '<button type="button" class="desktop-sidebar-account" onclick="go(\'profile\')">'+
        '<span class="desktop-sidebar-avatar">'+(me&&typeof avatar==='function'?avatar():'◈')+'</span>'+
        '<span class="desktop-sidebar-identity"><b>'+esc(user.first_name||user.name||'Профиль')+
        '</b><small>@'+esc(user.username||'user')+'</small></span>'+
        '<span class="desktop-sidebar-chevron" aria-hidden="true">›</span></button>'+
        '<div class="desktop-sidebar-caption">НАВИГАЦИЯ</div>'+
        '<div class="desktop-sidebar-menu" role="navigation">'+visible.map(item=>{
           const p=item[0],label=item[1],iconName=item[2];
           return '<button type="button" class="desktop-sidebar-link '+
           (page===p?'is-active':'')+'" onclick="go(\''+p+'\')" aria-current="'+(page===p?'page':'false')+'">'+
           '<span class="desktop-sidebar-link-icon">'+desktopIcon(iconName)+'</span>'+
           '<span>'+label+'</span></button>';
        }).join('')+'</div>'+
        '<div class="desktop-sidebar-divider"></div>'+
        '<button type="button" class="desktop-sidebar-secondary" onclick="crafterOpenSettings()">'+
        '<span class="desktop-sidebar-link-icon">'+desktopIcon('settings')+'</span>Настройки</button>'+
        (me?.is_admin?'<button class="desktop-sidebar-secondary" onclick="openAdminPage()">'+
        '<span class="desktop-sidebar-link-icon">'+desktopIcon('shield')+
        '</span>Админ-панель</button>':'')+
        '<div class="desktop-sidebar-footer">© Crafter · Telegram gifts</div>';
}
window.crafterDesktopNavRefresh=render;
if(typeof nav==='function'){
    const originalNav=nav;
    nav=function(){originalNav.apply(this,arguments);render();};
}
if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',render,{once:true});
else render();
media.addEventListener?.('change',render);
})();