/* Crafter Admin 2.0 — finance, maintenance, user details, withdrawals and modes. */
const adminConsoleState = {
    financePeriod: 'week', customFrom:'', customTo:'',
    userTab:'overview', userFinancePeriod:'month',
    activeUser:null, userRequest:0,
};
function adminFmt(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString('ru-RU',{maximumFractionDigits:2}) : '—';
}
function adminWhen(unix) {
    return unix ? new Date(Number(unix)*1000).toLocaleString('ru-RU') : '—';
}
function adminMetric(title,value,unit,sub) {
    return '<div class="admin-metric-card"><small>' + esc(title) + '</small>' +
        '<strong>' + esc(String(value)) + (unit ? '<em> ' + esc(unit) + '</em>':'') +
        '</strong>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>';
}
function adminNotice(text) {
    return '<div class="admin-glass-note">' + esc(text) + '</div>';
}
function adminGraph(report) {
    const data=(report.series||[]).slice(-40);
    if (!data.length) return '<div class="admin-chart-empty">За выбранный период подтверждённых операций нет.</div>';
    const W=680,H=230,left=10,top=18,base=191,graphH=169;
    const max=Math.max(1,...data.flatMap(x=>[Number(x.deposit_gram)||0,Number(x.withdraw_gram)||0]));
    const gap=(W-left-10)/data.length;
    const width=Math.max(2,Math.min(16,gap*.32));
    const fmt = val => Number(val||0).toFixed(2);
    const bars=data.map((x,i)=>{
        const deposited=Math.max(0,Number(x.deposit_gram)||0);
        const withdrawn=Math.max(0,Number(x.withdraw_gram)||0);
        const x0=left+i*gap+gap/2;
        const h1=graphH*deposited/max, h2=graphH*withdrawn/max;
        return '<rect x="'+fmt(x0-width-1)+'" y="'+fmt(base-h1)+
            '" width="'+fmt(width)+'" height="'+fmt(Math.max(h1,.5))+'" rx="2" fill="#68d9bf">' +
            '<title>'+esc(x.date)+' · Депозиты '+adminFmt(deposited)+' GRAM</title></rect>'+
            '<rect x="'+fmt(x0+1)+'" y="'+fmt(base-h2)+'" width="'+fmt(width)+
            '" height="'+fmt(Math.max(h2,.5))+'" rx="2" fill="#85aaff">' +
            '<title>'+esc(x.date)+' · Выводы '+adminFmt(withdrawn)+' GRAM</title></rect>';
    }).join('');
    const labels=data.map((x,i)=>{
        const every=Math.max(1,Math.ceil(data.length/5));
        if(i%every!==0 && i!==data.length-1) return '';
        return '<text x="'+fmt(left+i*gap+gap/2)+'" y="215" fill="#95aebe" '+
            'text-anchor="middle" font-size="10">'+esc(String(x.date).slice(5))+'</text>';
    }).join('');
    const grids=[0,.25,.5,.75,1].map(x=>{
        const y=base-graphH*x;
        return '<line x1="3" x2="677" y1="'+fmt(y)+'" y2="'+fmt(y)+
            '" stroke="#b6d3e7" stroke-opacity=".11" stroke-dasharray="4 5"/>';
    }).join('');
    return '<div class="admin-chart-wrap"><svg viewBox="0 0 680 230" role="img" '+
        'aria-label="Депозиты и выводы GRAM по датам">'+grids+bars+labels+'</svg>'+
        '<div class="admin-chart-legend"><span><i class="admin-legend-in"></i>Депозиты</span>'+
        '<span><i class="admin-legend-out"></i>Выводы</span></div></div>';
}
function adminFinanceBody(info) {
    const t=info.totals||{},counts=info.counts||{};
    const confirmedDeposits=counts.deposit_confirmed||0;
    const confirmedWithdrawals=counts.withdraw_confirmed||0;
    return '<div class="admin-metrics">' +
        adminMetric('Депозиты',adminFmt(t.deposit_gram),'GRAM',confirmedDeposits+' подтверждено')+
        adminMetric('Выводы',adminFmt(t.withdraw_gram),'GRAM',confirmedWithdrawals+' подтверждено')+
        adminMetric('Чистый поток',adminFmt(info.net_gram),'GRAM','Депозиты минус выводы')+
        adminMetric('Депозиты TON',adminFmt(t.deposit_ton),'TON','Из блокчейн-операций')+
        adminMetric('Выводы TON',adminFmt(t.withdraw_ton),'TON','Подтверждённые транзакции')+
        adminMetric('Чистая прибыль','—','','Нет полного учёта расходов')+
        '</div><div class="admin-glass-panel admin-chart-panel">' +
        '<div class="admin-chart-title"><h3>Движение средств</h3>'+
        '<small>'+esc(info.start)+' — '+esc(info.end)+'</small></div>'+
        adminGraph(info)+'</div>'+
        adminNotice(info.finance_note||'Депозиты и выводы не равны бухгалтерской прибыли.');
}
function adminPeriodButtons(selected, callback) {
    return '<div class="admin-periods" role="group" aria-label="Период статистики">' +
        [['day','День'],['week','Неделя'],['month','Месяц'],['all','Всё время'],['custom','Свои даты']]
            .map(([id,label])=>'<button type="button" class="'+
                (selected===id?'selected':'')+'" onclick="'+callback+'('+arg(id)+
                ')">'+label+'</button>').join('')+'</div>';
}
async function renderAdminFinance(content=document.querySelector('#admin-content')){
    if(!content?.isConnected)return;
    const period=adminConsoleState.financePeriod;
    content.innerHTML='<div class="admin-section-intro"><h3>Финансы</h3>'+
        '<p>Подтверждённые депозиты, выводы и денежный поток.</p></div>'+
        adminPeriodButtons(period,'adminSetFinancePeriod')+
        (period==='custom' ? '<div class="admin-date-row"><label>С<input type="date" id="admin-fin-from" value="'+
            esc(adminConsoleState.customFrom)+'"></label><label>По<input type="date" id="admin-fin-to" value="'+
            esc(adminConsoleState.customTo)+'"></label>'+
            '<button type="button" onclick="adminApplyFinanceDates()">Применить</button></div>':'')+
        '<div id="admin-fin-results" class="admin-loading-panel">Загружаем финансовую статистику…</div>';
    const out=content.querySelector('#admin-fin-results');
    let query='admin/finance?period='+encodeURIComponent(period);
    if(period==='custom'){
        if(!adminConsoleState.customFrom||!adminConsoleState.customTo) {
            out.textContent='Выберите начало и конец периода.';
            return;
        }
        query+='&from='+encodeURIComponent(adminConsoleState.customFrom)+
            '&to='+encodeURIComponent(adminConsoleState.customTo);
    }
    try{
        const info=await api(query);
        if(out.isConnected)out.outerHTML=adminFinanceBody(info);
    }catch(error){if(out.isConnected)out.textContent=error.message;}
}
function adminSetFinancePeriod(period){
    adminConsoleState.financePeriod=period;
    renderAdminFinance();
}
function adminApplyFinanceDates(){
    adminConsoleState.customFrom=document.getElementById('admin-fin-from')?.value||'';
    adminConsoleState.customTo=document.getElementById('admin-fin-to')?.value||'';
    renderAdminFinance();
}
async function renderAdminMaintenance(content=document.querySelector('#admin-content')){
    const d=await api('admin/maintenance');
    if(!content?.isConnected)return;
    content.innerHTML='<div class="admin-section-intro"><h3>Технические работы</h3>'+
        '<p>Обычные посетители увидят экран Liquid Glass с вращающейся шестерёнкой.'+
        ' Доступ администраторов останется открыт по проверенной Telegram-подписи.</p></div>'+
        '<div class="admin-maintenance-hero admin-glass-panel">'+
        '<div class="admin-maintenance-visual"><svg viewBox="0 0 24 24" fill="none" '+
        'stroke="currentColor" stroke-width="1.7"><path d="M10 2h4l.7 2.3 2.1 1 2.2-.8 2 3.5-1.7 1.7v2.6L21 14l-2 3.5-2.2-.8-2.1 1L14 20h-4l-.7-2.3-2.1-1-2.2.8L3 14l1.7-1.7V9.7L3 8l2-3.5 2.2.8 2.1-1z"/>'+
        '<circle cx="12" cy="11" r="3.2"/></svg></div>'+
        '<div><small>СОСТОЯНИЕ САЙТА</small><h3>'+(d.enabled?'Технические работы включены':'Сайт работает')+'</h3>'+
        '<p>'+(d.enabled?'Для обычных пользователей закрыт доступ к игровым API.':
            'Обычным пользователям доступны все включённые разделы.')+'</p></div>'+
        '<span class="admin-pill '+(d.enabled?'is-alert':'is-good')+'">'+(d.enabled?'ВКЛЮЧЕНО':'АКТИВЕН')+'</span></div>'+
        '<div class="admin-glass-panel admin-maintenance-controls">'+
        '<label for="admin-maint-message">Сообщение для посетителей</label>'+
        '<textarea id="admin-maint-message" rows="3" maxlength="180" placeholder="Обновляем сервис…">'+
        esc(d.message||'')+'</textarea>'+
        '<button type="button" class="'+(d.enabled?'admin-button-secondary':'admin-button-primary')+
        '" onclick="adminToggleMaintenance('+(!d.enabled)+')">'+
        (d.enabled?'Отключить технические работы':'Включить технические работы')+'</button>'+
        '<small>Все действия фиксируются в журнале администраторов.</small></div>';
}
async function adminToggleMaintenance(enabled){
    if(!confirm(enabled?'Включить технические работы для обычных пользователей?':
                'Выключить технические работы и открыть сайт?'))return;
    const message=document.getElementById('admin-maint-message')?.value||'';
    try{
        await api('admin/maintenance',{
            enabled, message,
            confirm:enabled?'ENABLE_MAINTENANCE':'DISABLE_MAINTENANCE'
        });
        toast(enabled?'Технические работы включены':'Сайт снова открыт');
        await renderAdminMaintenance();
    }catch(error){toast(error.message);}
}
function adminQueueHeader(title,description){
    return '<div class="admin-section-intro"><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p></div>';
}
async function renderAdminNFTQueue(content=document.querySelector('#admin-content')){
    content.innerHTML=adminQueueHeader('Вывод NFT','Ручная передача конкретного Telegram-подарка через Relayer, затем подтверждение заявки.')+
        '<p class="admin-loading-panel">Загрузка заявок…</p>';
    const data=await api('admin/withdrawals/nft');
    if(!content.isConnected)return;
    const list=data.gifts||[];
    content.innerHTML=adminQueueHeader('Вывод NFT','Подтверждайте выдачу только после фактической передачи указанного NFT.')+
        '<div class="admin-mini-summary">'+adminMetric('Заявок',list.length,'')+
        adminMetric('В очереди',list.filter(x=>x.status==='queued').length,'')+'</div>'+
        '<div id="admin-nft-queue" class="admin-queue-list"></div>';
    const node=content.querySelector('#admin-nft-queue');
    if(!list.length)node.textContent='Заявок нет.';
    else list.forEach(entry=>{
        const wrapper=document.createElement('section');
        wrapper.className='admin-glass-panel';
        wrapper.append(drawGiftWithdrawal(entry));
        const link=document.createElement('button');link.className='admin-link-button';
        link.textContent='Карточка пользователя →';
        link.onclick=()=>openAdminUserPage(entry.user_id);
        wrapper.append(link);node.append(wrapper);
    });
}
async function renderAdminTONQueue(content=document.querySelector('#admin-content')){
    content.innerHTML=adminQueueHeader('Вывод TON','Ручные заявки и подтверждения TON Connect.')+
        '<p class="admin-loading-panel">Загрузка заявок…</p>';
    const data=await api('admin/withdrawals/ton');
    if(!content.isConnected)return;
    const list=data.ton||[];
    content.innerHTML=adminQueueHeader('Вывод TON','Перевод только после подтверждения кошелька. Никаких автоматических заявок по умолчанию.')+
        '<div class="admin-mini-summary">'+adminMetric('Заявок',list.length,'')+
        adminMetric('В обработке',list.filter(x=>['queued','processing'].includes(x.status)).length,'')+'</div>'+
        '<div id="admin-ton-queue" class="admin-queue-list"></div>';
    const node=content.querySelector('#admin-ton-queue');
    if(!list.length)node.textContent='Заявок нет.';
    else list.forEach(entry=>{
        const wrapper=document.createElement('section');wrapper.className='admin-glass-panel';
        wrapper.append(drawTONWithdrawal(entry));const link=document.createElement('button');
        link.className='admin-link-button';link.textContent='Карточка пользователя →';
        link.onclick=()=>openAdminUserPage(entry.user_id);wrapper.append(link);node.append(wrapper);
    });
}
async function renderAdminActivity(content=document.querySelector('#admin-content')){
    content.innerHTML=adminQueueHeader('История действий','Журнал операций и администраторских изменений.')+
        '<p class="admin-loading-panel">Загружаем журнал…</p>';
    const data=await api('admin/logs?limit=200');
    if(!content.isConnected)return;
    const events=data.items||[];
    content.innerHTML=adminQueueHeader('История действий','История не включает секреты кошельков и Telegram-сессий.')+
        '<div class="admin-glass-panel admin-activity-table">'+
        (events.length?events.map(x=>
            '<div class="admin-log-entry"><span class="admin-log-dot"></span><div><b>'+
            esc(x.action||x.kind||x.type||'Действие')+'</b><small>'+
            esc(x.gift?.name||'')+(x.amount?' · '+esc(x.amount)+' GRAM':'')+
            '</small></div><span>'+adminWhen(x.created)+'</span>'+
            (x.user_id>0?'<button type="button" onclick="openAdminUserPage('+Number(x.user_id)+')">'+
                'ID '+Number(x.user_id)+'</button>':'')+'</div>').join('') :
            '<p class="admin-empty">История пуста.</p>')+'</div>';
}
async function renderAdminCrafts(content=document.querySelector('#admin-content')){
    content.innerHTML=adminQueueHeader('Управление крафтами',
        'Статистика крафтов и управление доступными коллекциями и моделями.')+
        '<p class="admin-loading-panel">Загрузка…</p>';
    const [data,configured]=await Promise.all([
        api('admin/crafts/report'),api('admin/selection')
    ]);
    if(!content.isConnected)return;
    const rules=configured.selection||{};
    const keys=Object.keys(rules).sort();
    const collections=(state.catalog?.collections||[]).map(c=>
        '<option value="'+esc(c.short_name||c.id)+'">'+esc(c.name)+'</option>').join('');
    content.innerHTML=adminQueueHeader('Управление крафтами',
        'Управляйте разрешёнными моделями, каталогом и просматривайте последние операции.')+
        '<div class="admin-mini-summary">'+
        adminMetric('Крафтов',data.recent_counts?.craft||0,'','Из последних 100 операций')+
        adminMetric('Выдач подарков',data.recent_counts?.gift_granted||0,'')+'</div>'+
        '<div class="admin-glass-panel"><h3>Доступные модели крафта</h3>'+
        '<p class="admin-small-warning">Укажите точные названия моделей через запятую. '+
        'Ограничения сохраняются на сервере и применяются к правилам крафта.</p>'+
        '<div class="admin-craft-rules">'+
        (keys.length?keys.map(key=>
            '<label class="admin-craft-rule"><strong>'+esc(key)+'</strong>'+
            '<input type="text" data-craft-key="'+esc(key)+'" value="'+
            esc((rules[key]||[]).join(', '))+'" placeholder="Модели через запятую"></label>'
        ).join(''):'<p class="admin-empty">Индивидуальных ограничений нет.</p>')+
        '</div><div class="admin-craft-add"><label>Коллекция'+
        '<select id="admin-craft-new-collection"><option value="">Выберите коллекцию</option>'+
        collections+'</select></label><label>Модели'+
        '<input type="text" id="admin-craft-new-models" placeholder="Model 1, Model 2"></label></div>'+
        '<button type="button" class="admin-button-primary admin-craft-save" '+
        'onclick="adminSaveCraftSelections()">Сохранить правила</button></div>'+
        '<div class="admin-glass-panel"><h3>Настройки и каталог</h3>'+
        '<div class="admin-glass-action-grid">'+
        '<button onclick="openAdminSection(\'portal\')">Коллекции и модели →</button>'+
        '<button onclick="openAdminSection(\'modes\')">Доступность режимов →</button>'+
        '</div></div>'+
        '<div class="admin-glass-panel"><h3>Последние операции</h3>'+
        (data.recent||[]).map(x=>'<div class="admin-log-entry"><div><b>'+
            esc(x.kind)+'</b><small>'+adminWhen(x.created)+'</small></div>'+
            '<button type="button" onclick="openAdminUserPage('+Number(x.user_id)+')">'+
            'ID '+Number(x.user_id)+'</button></div>').join('')+'</div>'+
        adminNotice(data.note||'');
}
async function adminSaveCraftSelections(){
    const rules={};
    document.querySelectorAll('[data-craft-key]').forEach(input=>{
        const entries=String(input.value||'').split(',').map(x=>x.trim()).filter(Boolean);
        if(entries.length) rules[input.dataset.craftKey]=Array.from(new Set(entries));
    });
    const collection=document.getElementById('admin-craft-new-collection')?.value||'';
    const models=document.getElementById('admin-craft-new-models')?.value||'';
    if(collection){
        const names=models.split(',').map(x=>x.trim()).filter(Boolean);
        if(!names.length)return toast('Введите названия моделей для выбранной коллекции');
        rules[collection]=Array.from(new Set([...(rules[collection]||[]),...names]));
    }
    try{
        await api('admin/selection',{selection:rules});
        toast('Правила крафта сохранены');
        await renderAdminCrafts();
    }catch(error){toast(error.message);}
}
async function renderAdminModes(content=document.querySelector('#admin-content')){
    content.innerHTML=adminQueueHeader('Управление режимами','Включение и отключение существующих режимов на сервере.')+
        '<p class="admin-loading-panel">Загрузка…</p>';
    const info=await api('admin/modes');
    if(!content.isConnected)return;
    const list=[
        ['craft','Крафты','Режим сборки подарков'],
        ['arena','Arena','Игровая арена'],
        ['staking','Стейкинг','Начисление по APR'],
    ];
    content.innerHTML=adminQueueHeader('Управление режимами',
        'При отключении сервер блокирует новые игровые запросы обычных пользователей. Администраторы сохраняют доступ.')+
        '<div class="admin-mode-list">'+list.map(([id,name,details])=>{
            const enabled=Boolean(info.modes?.[id]);
            return '<section class="admin-glass-panel admin-mode-card"><div>'+
                '<h3>'+name+'</h3><p>'+details+'</p></div>'+
                '<span class="admin-pill '+(enabled?'is-good':'is-alert')+'">'+
                (enabled?'Включён':'Выключен')+'</span>'+
                '<button type="button" onclick="adminChangeMode('+arg(id)+','+(!enabled)+')">'+
                (enabled?'Отключить':'Включить')+'</button></section>';
        }).join('')+'</div><div class="admin-glass-panel">'+
        '<h3>Настройки режимов</h3><div class="admin-glass-action-grid">'+
        '<button onclick="openAdminSection(\'arena\')">Arena — банк и комиссия →</button>'+
        '<button onclick="openAdminSection(\'staking\')">Стейкинг — APR →</button>'+
        '<button onclick="openAdminSection(\'events\')">Ивенты и награды →</button>'+
        '</div></div>';
}
async function adminChangeMode(mode,enabled){
    if(!confirm((enabled?'Включить':'Отключить')+' режим '+mode+' для всех обычных пользователей?'))return;
    try{
        await api('admin/modes',{mode,enabled,confirm:'SET_MODE'});
        toast('Настройки режима сохранены');
        await renderAdminModes();
    }catch(error){toast(error.message);}
}
function adminUserRow(title,value,extra){
    return '<div class="admin-user-fact"><small>'+esc(title)+'</small>'+
        '<strong>'+esc(String(value??'—'))+'</strong>'+
        (extra?'<span>'+esc(extra)+'</span>':'')+'</div>';
}
function adminUserActionTabs(uid,selected){
    return '<div class="admin-user-tabs">'+
        [['overview','Обзор'],['inventory','Инвентарь'],['money','Финансы'],
         ['operations','Операции'],['settings','Управление']]
            .map(([k,label])=>'<button type="button" class="'+(k===selected?'selected':'')+
                '" onclick="adminUserTab('+uid+','+arg(k)+')">'+label+'</button>').join('')+
        '</div><div id="admin-user-panel" class="admin-user-panel"></div>';
}
async function openAdminUserPage(uid){
    const id=Number(uid);
    if(!Number.isSafeInteger(id)||id<=0)return;
    state.adminSection='users';
    history.pushState({adminUser:id},'', '/admin/user/'+id);
    document.querySelector('#main')?.setAttribute('data-admin-user',String(id));
    await renderAdminUserDetail(id);
}
async function renderAdminUserDetail(uid){
    const main=document.querySelector('#main');
    if(!main)return;
    const stamp=++adminConsoleState.userRequest;
    main.innerHTML='<div class="admin-loading-panel">Загружаем пользователя '+uid+'…</div>';
    try{
        const info=await api('admin/user/'+uid);
        if(!main.isConnected||stamp!==adminConsoleState.userRequest)return;
        adminConsoleState.activeUser=info;
        const u=info.user;
        main.innerHTML='<div class="admin-user-page">'+
            '<div class="admin-user-page-top"><button class="admin-back" onclick="openAdminSection(\'users\')">'+
            '‹ Пользователи</button><span class="admin-small-label">/admin/user/'+Number(uid)+'</span></div>'+
            '<div class="admin-user-profile admin-glass-panel"><span class="admin-user-avatar">'+
            esc(String(u.name||'U').slice(0,1).toUpperCase())+'</span>'+
            '<div><small>КАРТОЧКА ПОЛЬЗОВАТЕЛЯ</small><h2>'+esc(u.name||'Пользователь')+'</h2>'+
            '<p>@'+esc(u.username||'—')+' · ID '+Number(uid)+'</p></div>'+
            '<span class="admin-pill '+(u.banned?'is-alert':'is-good')+'">'+
            (u.banned?'Заблокирован':'Активен')+'</span></div>'+
            '<div class="admin-metrics admin-user-stats">'+
            adminMetric('Баланс',adminFmt(u.balance),'GRAM')+
            adminMetric('Подарки',Number(u.gifts),'шт.')+
            adminMetric('Депозиты',info.deposits?.length||0,'','Последние 30 операций')+
            adminMetric('Выводы',info.withdrawals?.length||0,'','Последние 30 операций')+
            '</div>'+adminUserActionTabs(uid,adminConsoleState.userTab||'overview')+'</div>';
        await adminUserTab(uid,adminConsoleState.userTab||'overview');
    }catch(error){
        if(main.isConnected && stamp===adminConsoleState.userRequest)
            main.innerHTML='<div class="admin-glass-note">'+esc(error.message)+'</div>'+
                '<button class="admin-back" onclick="openAdminSection(\'users\')">‹ Пользователи</button>';
    }
}
async function adminUserTab(uid,tab){
    const root=document.getElementById('admin-user-panel');
    if(!root||!adminConsoleState.activeUser)return;
    adminConsoleState.userTab=tab;
    document.querySelectorAll('.admin-user-tabs button').forEach((b,i)=>
        b.classList.toggle('selected',['overview','inventory','money','operations','settings'][i]===tab));
    const info=adminConsoleState.activeUser, u=info.user;
    const rows=(items,category)=>'<div class="admin-user-entries">'+
        ((items||[]).length?(items||[]).map(item=>
            '<div class="admin-user-entry"><div><b>'+esc(item.id||item.kind||item.status||'Запись')+
            '</b><small>'+adminWhen(item.created)+'</small></div>'+
            '<div><b>'+esc(item.gram||'')+' '+(item.gram?'GRAM':'')+'</b>'+
            '<small>'+esc(item.status||category||'')+'</small></div></div>').join(''):
            '<p class="admin-empty">Записей нет.</p>')+'</div>';
    if(tab==='overview'){
        root.innerHTML='<div class="admin-user-overview">'+
            '<section class="admin-glass-panel"><h3>Данные профиля</h3>'+
            adminUserRow('Telegram ID',u.id)+adminUserRow('Имя',u.name||'—')+
            adminUserRow('Username',u.username?'@'+u.username:'—')+
            adminUserRow('Реферер',u.referrer||'—')+
            adminUserRow('Регистрация',adminWhen(u.created))+'</section>'+
            '<section class="admin-glass-panel"><h3>Быстрые действия</h3>'+
            '<div class="admin-glass-action-grid">'+
            '<button onclick="adminUserTab('+uid+',\'inventory\')">Инвентарь →</button>'+
            '<button onclick="adminUserTab('+uid+',\'money\')">Финансы →</button>'+
            '<button onclick="adminInspectOffers('+uid+')">Офферы →</button>'+
            '<button onclick="adminInspectLogs('+uid+')">История →</button>'+
            '</div></section></div>';
    }else if(tab==='inventory'){
        root.innerHTML='<div class="admin-loading-panel">Загрузка инвентаря…</div>';
        try {
            const res=await api('admin/users/'+uid+'/inventory');
            if(!root.isConnected||adminConsoleState.userTab!==tab)return;
            root.innerHTML='<section class="admin-glass-panel"><div class="admin-panel-head">'+
                '<h3>Инвентарь</h3><span>'+res.gifts.length+' загружено</span></div>'+
                '<div class="admin-user-gift-grid">'+(res.gifts||[]).map(g=>{
                    const art=imageURL(g.image||'');
                    return '<div class="admin-user-gift">'+
                        (art?'<img src="'+esc(art)+'" alt="" loading="lazy">':'<span>◇</span>')+
                        '<b>'+esc(g.name||'Gift')+'</b><small>№'+esc(g.number||'—')+
                        ' · '+esc(g.status||'')+'</small>'+
                        '<button type="button" onclick="adminRemoveGift('+uid+','+arg(g.id)+')">'+
                        'Удалить из учёта</button></div>';
                }).join('')+'</div>'+(res.has_more?'<button class="admin-link-button" onclick="adminInspectGifts('+uid+')">'+
                    'Открыть полный инвентарь →</button>':'')+
                '<p class="admin-small-warning">Удаление меняет учёт Crafter; Telegram NFT не передаётся.</p></section>';
        }catch(error){if(root.isConnected)root.textContent=error.message;}
    }else if(tab==='money'){
        root.innerHTML='<section class="admin-glass-panel"><h3>Статистика пользователя</h3>'+
            '<p class="admin-loading-panel">Загрузка финансов…</p></section>';
        try{
            const report=await api('admin/users/'+uid+'/finance?period='+adminConsoleState.userFinancePeriod);
            if(!root.isConnected||adminConsoleState.userTab!==tab)return;
            root.innerHTML='<div class="admin-section-intro"><h3>Финансы пользователя</h3></div>'+
                '<div class="admin-periods">'+['day','week','month','all'].map(id=>
                '<button class="'+(adminConsoleState.userFinancePeriod===id?'selected':'')+
                '" onclick="adminUserFinPeriod('+uid+','+arg(id)+')">'+
                ({day:'День',week:'Неделя',month:'Месяц',all:'Всё время'}[id])+
                '</button>').join('')+'</div>'+adminFinanceBody(report);
        }catch(error){if(root.isConnected)root.textContent=error.message;}
    }else if(tab==='operations'){
        root.innerHTML='<div class="admin-user-overview">'+
            '<section class="admin-glass-panel"><h3>Пополнения</h3>'+
            rows(info.deposits,'deposit')+'</section>'+
            '<section class="admin-glass-panel"><h3>Выводы TON</h3>'+
            rows(info.withdrawals,'withdraw')+'</section>'+
            '<section class="admin-glass-panel"><h3>Выводы NFT</h3>'+
            rows(info.gift_withdrawals,'gift')+'</section>'+
            '<section class="admin-glass-panel"><h3>История действий</h3>'+
            rows(info.recent,'action')+
            '<button type="button" class="admin-link-button" onclick="adminInspectLogs('+uid+')">'+
            'Полный журнал →</button></section></div>';
    }else if(tab==='settings'){
        await state.catalogReady;
        if(!root.isConnected||adminConsoleState.userTab!==tab)return;
        root.innerHTML='<div class="admin-user-overview">'+
            '<section class="admin-glass-panel"><h3>Корректировка баланса</h3>'+
            '<p class="admin-small-warning">Изменение внутреннего баланса не переводит TON. '+
            'Перед корректировкой сверяйте подтверждённые операции.</p>'+
            '<div class="admin-user-form"><label>GRAM<input id="user-balance" type="number" min="0" '+
            'step=".01" value="'+esc(u.balance)+'"></label>'+
            '<button type="button" onclick="saveUserBalance('+uid+')">Сохранить баланс</button></div></section>'+
            '<section class="admin-glass-panel"><h3>Выдача подарка</h3>'+
            '<p class="admin-small-warning">Административная выдача изменяет только учёт Crafter.</p>'+
            '<select class="field" id="grant-collection" onchange="loadGrantModels(this.value,'+uid+')">'+
            '<option value="">Выберите коллекцию</option>'+
            (state.catalog?.collections||[]).map(c=>'<option value="'+esc(c.short_name||c.id)+'">'+
                esc(c.name)+'</option>').join('')+'</select><div id="grant-models"></div></section>'+
            '<section class="admin-glass-panel"><h3>Доступ пользователя</h3>'+
            '<p>Состояние: <strong>'+(u.banned?'Заблокирован':'Активен')+'</strong></p>'+
            '<button type="button" class="'+(u.banned?'admin-button-secondary':'admin-button-danger')+
            '" onclick="adminChangeUserBan('+uid+','+(!u.banned)+')">'+
            (u.banned?'Разблокировать пользователя':'Заблокировать пользователя')+
            '</button></section></div>';
    }
}
function adminUserFinPeriod(uid,period){
    adminConsoleState.userFinancePeriod=period;
    adminUserTab(uid,'money');
}
async function adminChangeUserBan(uid,banned){
    if(!confirm(banned?'Заблокировать пользователя?':'Разблокировать пользователя?'))return;
    try{
        await api('admin/users/'+uid+'/ban',{banned,reason:banned?'Заблокирован администратором':''});
        toast(banned?'Пользователь заблокирован':'Пользователь разблокирован');
        await renderAdminUserDetail(uid);
    }catch(error){toast(error.message);}
}

/* Only the verified configured primary administrator can manage other admins. */
const adminRoleLabels = {
    finance:'Финансы',users:'Пользователи',maintenance:'Технические работы',
    audit:'История действий',nft_withdraw:'Выводы NFT',ton_withdraw:'Выводы TON',
    tonconnect:'Автовывод TON',relayer:'Relayer',crafts:'Крафты',modes:'Режимы',
    staking:'Стейкинг',arena:'Arena',banners:'Баннеры',
    craft_banner:'Баннер крафтов',ice_banner:'Баннер Ice Arena',
    events:'Ивенты',portal:'Portal Market','telegram-bot':'Telegram-бот',
    announcements:'Анонсы',snow:'Снег'
};
let adminRoleData=null;
async function renderAdminRoles(content=document.querySelector('#admin-content')){
    if(!state.me?.is_primary_admin){
        content.textContent='Доступ только главному администратору.';
        return;
    }
    content.innerHTML='<p class="admin-loading-panel">Загрузка администраторов…</p>';
    try{adminRoleData=await api('admin/admins');}
    catch(error){content.textContent=error.message;return;}
    if(!content.isConnected)return;
    const active=(adminRoleData.admins||[]).filter(x=>x.is_admin);
    const inactive=(adminRoleData.admins||[]).filter(x=>!x.is_admin);
    content.innerHTML='<div class="admin-section-intro"><h3>Управление администраторами</h3>'+
       '<p>Только главный администратор может назначать или отзывать права.</p></div>'+
       '<div class="admin-mini-summary">'+
       adminMetric('Администраторов',active.length,'')+
       adminMetric('Отозванных доступов',inactive.length,'')+'</div>'+
       '<section class="admin-glass-panel admin-roles-panel"><h3>Добавить администратора</h3>'+
       '<label>Telegram ID<input id="admin-role-uid" type="text" inputmode="numeric"'+
       ' placeholder="Числовой Telegram ID"></label>'+
       '<label>Уровень прав<select id="admin-role-kind" onchange="adminRoleTogglePermissions()">'+
       '<option value="sections">Выбранные разделы</option>'+
       '<option value="full">Все разделы</option></select></label>'+
       '<fieldset id="admin-role-options" class="admin-role-options"><legend>Доступные разделы</legend>'+
       adminRoleData.sections.map(p=>
         '<label><input type="checkbox" value="'+esc(p)+'" name="admin-role-section">'+
         esc(adminRoleLabels[p]||p)+'</label>').join('')+'</fieldset>'+
       '<button type="button" class="admin-button-primary admin-role-save" '+
       'onclick="adminSaveRole()">Выдать права</button>'+
       '<p class="admin-small-warning">Пользователь должен сначала зайти в Crafter.'+
       ' Роли проверяются сервером для каждого запроса.</p></section>'+
       '<section class="admin-glass-panel admin-roles-panel"><h3>Администраторы</h3>'+
       '<div class="admin-admin-list">'+(adminRoleData.admins||[]).map(row=>
          '<div class="admin-admin-row"><div class="admin-role-user">'+
          '<b>'+esc(row.name||'Пользователь')+'</b><small>'+
          (row.username?'@'+esc(row.username)+' · ':'')+'ID '+row.user_id+
          '</small></div><div class="admin-role-desc">'+
          '<strong>'+esc(row.is_primary_admin?'Главный администратор':
             row.role==='full'?'Все права':
             row.is_admin?'Отдельные права':'Доступ отозван')+'</strong>'+
          '<small>'+esc(row.permissions.includes('*')?'Все разделы':
             row.permissions.map(p=>adminRoleLabels[p]||p).join(', ')||'Нет прав')+
          '</small></div>'+
          (row.is_primary_admin?'': '<button type="button" class="admin-role-remove"'+
             ' onclick="adminRevokeRole('+row.user_id+')">Удалить права</button>')+
          '</div>').join('')+'</div></section>';
}
function adminRoleTogglePermissions(){
    const all=document.getElementById('admin-role-kind')?.value==='full';
    const options=document.getElementById('admin-role-options');
    if(options)options.hidden=all;
}
async function adminSaveRole(){
    if(!state.me?.is_primary_admin)return;
    const value=document.getElementById('admin-role-uid')?.value.trim();
    const role=document.getElementById('admin-role-kind')?.value;
    if(!/^[1-9]\d{0,18}$/.test(value||''))return toast('Введите Telegram ID');
    const uid=Number(value);
    if(!Number.isSafeInteger(uid))return toast('Некорректный Telegram ID');
    const permissions=role==='full'?[]:[...document.querySelectorAll(
       'input[name="admin-role-section"]:checked')].map(x=>x.value);
    if(role!=='full'&&!permissions.length)return toast('Выберите хотя бы один раздел');
    if(!confirm('Выдать права Telegram ID '+uid+'?'))return;
    try{
        await api('admin/admins',{user_id:uid,role,permissions});
        toast('Права администратора сохранены');
        await renderAdminRoles();
    }catch(error){toast(error.message);}
}
async function adminRevokeRole(uid){
    if(!state.me?.is_primary_admin)return;
    if(!confirm('Отозвать права администратора ID '+uid+'?'))return;
    try{
        await api('admin/admins/'+uid+'/revoke',{});
        toast('Административный доступ отозван');
        await renderAdminRoles();
    }catch(error){toast(error.message);}
}
