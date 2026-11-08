/* Crafter Admin 2.0 — responsive command center and dedicated user routes. */
const adminSections = {
    finance:      {label:'Финансы',detail:'Депозиты, выводы, графики и период',group:'main',glyph:'wallet',render:renderAdminFinance},
    users:        {label:'Пользователи',detail:'Отдельные профили, баланс, инвентарь',group:'main',glyph:'gift',render:renderAdminUsers},
    maintenance:  {label:'Технические работы',detail:'Доступ администратора, стеклянная заглушка',group:'main',glyph:'shield',render:renderAdminMaintenance},
    audit:        {label:'История действий',detail:'Операции и аудит',group:'main',glyph:'grid',render:renderAdminActivity},
    cancellations:{label:'Управление отменами',detail:'Просмотр отменённых операций',group:'main',glyph:'rotate-ccw',render:renderAdminCancellations},
    nft_withdraw: {label:'Выводы NFT',detail:'Ручная передача подарков',group:'money',glyph:'gift',render:renderAdminNFTQueue},
    ton_withdraw: {label:'Выводы TON',detail:'Ручные заявки и подтверждения',group:'money',glyph:'wallet',render:renderAdminTONQueue},
    tonconnect:   {label:'Автовывод TON',detail:'Политика, кошелёк, обработчик',group:'money',glyph:'wallet',render:renderTonAdmin},
    relayer:      {label:'Relayer',detail:'Приём подарков и история',group:'money',glyph:'send',render:renderTelegramDeposits},
    crafts:       {label:'Крафты',detail:'Операции, каталог и настройки',group:'manage',glyph:'gift',render:renderAdminCrafts},
    modes:        {label:'Режимы',detail:'Управление доступностью игр',group:'manage',glyph:'grid',render:renderAdminModes},
    staking:      {label:'Стейкинг',detail:'Годовой APR и ограничения',group:'manage',glyph:'gift',render:renderAdminStaking},
    arena:        {label:'Arena',detail:'Банк, комиссии, ставки',group:'manage',glyph:'grid',render:renderAdminArena},
    banners:      {label:'Баннеры',detail:'Галерея, карусель и публикация',group:'manage',glyph:'market',render:renderAdminBanners},
    craft_banner: {label:'Баннер крафтов',detail:'События, GIF, таймер',group:'manage',glyph:'grid',render:renderCraftBannerAdmin},
    ice_banner:   {label:'Баннер Ice Arena',detail:'Визуальный редактор',group:'manage',glyph:'grid',render:renderIceBannerAdmin},
    events:       {label:'Ивенты и рейтинги',detail:'Награды, лидеры, сроки',group:'manage',glyph:'grid',render:renderAdminEvents},
    portal:       {label:'Portal Market',detail:'Каталог и модели подарков',group:'system',glyph:'market',render:renderAdminPortal},
    'telegram-bot':{label:'Telegram-бот',detail:'Уведомления и настройки',group:'system',glyph:'send',render:renderTelegramBotAdmin},
    announcements:{label:'Анонсы',detail:'Окна и сообщения',group:'system',glyph:'grid',render:renderAdminAnnouncements},
    snow:         {label:'Снег на сайте',detail:'Погода и оформление',group:'system',glyph:'gift',render:renderAdminSnow},
    admins:       {label:'Управление админами',detail:'Роли и права по разделам',group:'system',glyph:'shield',render:renderAdminRoles},
};
const adminGroupTitles = {main:'Обзор',money:'Финансовые операции',manage:'Управление',system:'Система'};
function adminCanOpenSection(id){
    const me=state.me||{};
    if(id==='admins')return Boolean(me.is_primary_admin);
    if(id==='cancellations')return Boolean(me.is_primary_admin||me.admin_permissions?.includes('*')||me.admin_permissions?.includes('audit'));
    if(!me.is_admin)return false;
    return Boolean(me.is_primary_admin||me.admin_permissions?.includes('*')||
        me.admin_permissions?.includes(id));
}
function adminAllowedSection(id){
    if(adminSections[id]&&adminCanOpenSection(id))return id;
    return Object.keys(adminSections).find(adminCanOpenSection)||'finance';
}

function adminNavCards() {
    return Object.entries(adminGroupTitles).map(([group, title]) =>
        '<div class="admin-nav-group"><span class="admin-nav-heading">'+title+'</span>'+
        Object.entries(adminSections).filter(([id,item])=>id!=='admins'&&item.group===group&&adminCanOpenSection(id)).map(([id,item])=>
            '<button type="button" class="admin-nav-link'+
            (state.adminSection===id?' is-current':'')+
            '" onclick="openAdminSection('+arg(id)+')" aria-current="'+
            (state.adminSection===id?'page':'false')+'">'+
            '<span class="admin-nav-icon">'+icon(item.glyph)+'</span>'+
            '<span class="admin-nav-title">'+item.label+'</span><span class="admin-nav-arrow">›</span>'+
            '</button>').join('')+'</div>').join('');
}
async function renderAdmin() {
    const activeNavigation=document.getElementById('admin-navigation');
    const savedNavScroll=activeNavigation?.scrollTop||0;
    const keepMenuOpen=activeNavigation?.classList.contains('is-open')||false;
    const main=document.querySelector('#main');
    if(!main)return;
    state.adminSection=adminAllowedSection(state.adminSection);
    const section=adminSections[state.adminSection];
    main.removeAttribute('data-admin-user');
    main.innerHTML='<div class="admin-dashboard">'+
        '<aside class="admin-navigation" id="admin-navigation" aria-label="Меню админки">'+
        '<div class="admin-nav-head"><small>CRAFTER / CONSOLE</small><strong>Разделы</strong></div>'+
        (state.me?.is_primary_admin?
         '<button type="button" class="admin-owner-quick '+(state.adminSection==='admins'?'is-current':'')+
         '" onclick="openAdminSection(\'admins\')"><span class="admin-owner-quick-icon">'+icon('shield')+
         '</span><span><b>Управление админами</b><small>Добавить · права · удалить</small></span>'+
         '<span class="admin-nav-arrow">›</span></button>':'')+
        adminNavCards()+'</aside>'+
        '<section class="admin-workspace">'+
        '<div class="admin-workspace-header"><button type="button" class="admin-mobile-nav-toggle" '+
        'onclick="adminToggleMenu()" aria-label="Открыть меню">☰ Меню</button>'+
        '<div><small>ПАНЕЛЬ УПРАВЛЕНИЯ</small><h2>'+section.label+'</h2>'+
        '<p>'+section.detail+'</p></div>'+
        (state.me?.is_primary_admin&&state.adminSection!=='admins'?
         '<button type="button" class="admin-header-owner-button" onclick="openAdminSection(\'admins\')">'+
         icon('shield')+'<span>Администраторы</span></button>':'')+'</div>'+
        '<div id="admin-content" class="admin-content"><p class="admin-loading-panel">Загрузка раздела…</p></div>'+
        '</section></div>';
    const newNavigation=document.getElementById('admin-navigation');
    if(newNavigation) {
        newNavigation.scrollTop=savedNavScroll;
        newNavigation.classList.toggle('is-open', keepMenuOpen);
        newNavigation.querySelector('[aria-current="page"]')?.setAttribute('tabindex','0');
    }
    const content=main.querySelector('#admin-content');
    try{
        await section.render(content);
    }catch(error){
        if(content.isConnected)content.innerHTML='<div class="admin-glass-note">'+esc(error.message)+'</div>';
    }
}
function adminToggleMenu(){
    document.getElementById('admin-navigation')?.classList.toggle('is-open');
}
function openAdminSection(id){
    closeSheet();
    state.adminSection=adminAllowedSection(id);
    adminConsoleState.activeUser=null;
    adminConsoleState.userRequest++;
    const next='/admin?section='+encodeURIComponent(state.adminSection);
    if(location.pathname+location.search!==next)history.pushState({section:state.adminSection},'',next);
    // Keep the current viewport/selected menu position on section changes.
    // Rebuilding the entire navigation used to jump the admin to the top.
    const currentY=window.scrollY;
    renderAdmin();
    requestAnimationFrame(()=>{
        if(!window.matchMedia('(max-width:740px)').matches)
            window.scrollTo({top:currentY,behavior:'instant'});
    });
}
window.addEventListener('popstate',()=>{
    const match=location.pathname.match(/^\/admin\/user\/([1-9]\d*)$/);
    if(match){
        state.adminSection='users';
        document.getElementById('main')?.setAttribute('data-admin-user',match[1]);
        renderAdminUserDetail(Number(match[1]));
    }else{
        state.adminSection=new URLSearchParams(location.search).get('section')||'finance';
        renderAdmin();
    }
});
(async()=>{
    const main=document.querySelector('#main');
    try{
        tg?.ready();
        tg?.expand();
        state.me=await api('me');
        if(!state.me.is_admin)throw Error('Доступ только для администратора');
        state.page='admin';
        state.catalogReady=api('catalog').then(data=>{state.catalog=data;}).catch(()=>{});
        const match=location.pathname.match(/^\/admin\/user\/([1-9]\d*)$/);
        if(match){
            state.adminSection='users';
            await renderAdminUserDetail(Number(match[1]));
        }else{
            state.adminSection=new URLSearchParams(location.search).get('section')||'finance';
            await renderAdmin();
        }
    }catch(error){
        if(main)main.innerHTML='<section class="admin-glass-panel admin-access-error">'+
            '<h2>Доступ ограничен</h2><p>'+esc(error.message)+'</p>'+
            '<a href="/">Вернуться на сайт</a></section>';
    }
})();