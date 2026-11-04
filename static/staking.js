/* Crafter Games Hub and gift staking. The existing craft mechanic is preserved. */
const stakeUi = {status:null, picked:new Set(), tutorialStep:0, gifts:[], pending:false};
const stakingIconSVG = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 15h26l-5 7h-4v4l4 2H8l4-2v-4H8l-5-7Z" fill="#75e6cb" stroke="#215d59" stroke-width="1.8"/><path d="M12 5h15v5H12V5Z" fill="#85e5f5"/><path d="m19 13 3-3 3 3-3 3-3-3Z" fill="#ffe699" stroke="#cf9659" stroke-width="1.2"/></svg>';
const gameCraftIconSVG = '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true"><circle cx="61" cy="61" r="50" fill="#2e416b" opacity=".54"/><path d="M18 59h86l-13 19H79v15l12 8H32l12-8V78H31L18 59Z" fill="#bfc7e4" stroke="#5d6b91" stroke-width="3"/><path d="M56 21h48v16H56V21Z" fill="#d9e3f7" stroke="#6b82b2" stroke-width="3"/><g transform="rotate(-31 59 42)"><path d="M52 12h16v37H52V12Z" fill="#9960da" stroke="#d6b7ff" stroke-width="3"/><path d="M44 11h32v12H44V11Z" fill="#e9d2ff"/><path d="M56 49h8v23h-8V49Z" fill="#e5b89b"/></g><path d="m28 29 4-11 4 11 11 4-11 4-4 11-4-11-11-4 11-4Z" fill="#f6c971"/><path d="m93 43 2-8 3 8 8 3-8 3-3 8-2-8-8-3 8-3Z" fill="#9bdcff"/></svg>';
const stakeGiftSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M2 9h20M12 9v12M12 9C4 9 6 3 10 5c1 .5 2 3 2 4Zm0 0c8 0 6-6 2-4-1 .5-2 3-2 4Z"/></svg>';
const gamesHubIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 8-2.5 1.2A4 4 0 0 0 1 12.8L2 17a3 3 0 0 0 4.6 1.7L10 16h4l3.4 2.7A3 3 0 0 0 22 17l1-4.2a4 4 0 0 0-2.5-3.6L18 8H6Z"/><path d="M6 11v5M3.5 13.5h5M16.5 12h.1M19 14h.1"/></svg>';
const stakeNavBefore = nav;
nav = function() {
    const root = document.querySelector('#nav');
    if (!root) return;
    const inGames = ['games','craft'].includes(state.page);
    const destinations = inGames ? [
        ['market','market','Маркет'],['games','games','Hub']
    ] : [
        ['market','market','Маркет'],['gifts','gift','Мои подарки'],
        ['staking','staking','Стейкинг'],['games','games','Игры']
    ];
    root.classList.toggle('games-nav', inGames);
    root.innerHTML = `<div class="nav-main">${destinations.map(([page,kind,title]) => `
        <button type="button" onclick="go('${page}')" class="${state.page === page || (page === 'games' && state.page === 'craft') ? 'active' : ''}"
            aria-label="${title}"><span class="stake-nav-icon">${kind === 'games' ? gamesHubIcon :
                kind === 'staking' ? stakingIconSVG : icon(kind)}</span><span>${title}</span></button>`).join('')}</div>
        <button class="profile-nav ${state.page === 'profile' ? 'active' : ''}" onclick="go('profile')" aria-label="Профиль">
            <span class="avatar">${avatar()}</span></button>`;
};
const stakeGoBefore = go;
go = async function(page) {
    if (page !== 'games' && page !== 'staking') {
        document.querySelector('#app')?.classList.toggle('games-view',page === 'craft');
        return stakeGoBefore(page);
    }
    if (state.crafting) return;
    state.page = page;
    document.querySelector('#app')?.classList.remove('craft-view','cart-view');
    document.querySelector('#app')?.classList.toggle('games-view',page === 'games');
    document.querySelector('#cart-float')?.remove();
    nav();
    const main = document.querySelector('#main');
    if (!main) return;
    if (page === 'games') {
        renderGamesHub();
        return;
    }
    main.innerHTML = '<div class="loader">Загрузка стейкинга…</div>';
    try {
        const [info,inventory] = await Promise.all([api('staking'),api('inventory')]);
        if (state.page !== 'staking') return;
        stakeUi.status = info;
        state.inventory = inventory.gifts;
        stakeUi.gifts = inventory.gifts.filter(g => g.status === 'unlisted');
        renderStaking();
    } catch(error) {
        if (state.page === 'staking') {
            main.innerHTML = `<div class="error">${esc(error.message)}</div>
                <button class="secondary" onclick="go('staking')">Повторить</button>`;
        }
    }
};
function renderGamesHub() {
    document.querySelector('#main').innerHTML = `<section class="crafter-games">
        <div class="crafter-games-top"><span class="games-eyebrow">CRAFTER GAMES</span>
            <h1>Игры</h1><p>Выбирайте игровой режим</p></div>
        <button class="crafter-game-tile" onclick="go('craft')" type="button" aria-label="Открыть Крафты">
            <span class="crafter-game-stars" aria-hidden="true"></span>
            <span class="crafter-game-art">${gameCraftIconSVG}</span>
            <span class="crafter-game-bottom"><strong>Крафты</strong><span>${icon('chevron')}</span></span>
        </button>
    </section>`;
}
function stakeFormat(n) {
    const number = Number(n);
    if (!Number.isFinite(number)) return '0';
    return number.toLocaleString('ru-RU',{maximumFractionDigits:6});
}
function stakeDate(ts) {
    return new Date(Number(ts)*1000).toLocaleDateString('ru-RU',{
        day:'2-digit',month:'long',year:'numeric'
    });
}
function stakeCard(entry) {
    const gift = entry.gift;
    return `<button type="button" class="stake-gift-card" onclick="openStakedGift('${esc(entry.id)}')"
        aria-label="${esc(gift.name)} #${esc(gift.number || '')}">
        <span class="stake-gift-art" style="background:${giftBackdrop(gift)}">
            <img ${giftPicture(gift)} alt="" loading="lazy">
        </span>
        <strong>${esc(gift.name)}</strong>
        <small>${gift.number ? '#' + esc(gift.number) : ''}</small>
        <span class="stake-gift-state ${entry.can_unstake ? 'ready' : ''}">
            ${entry.can_unstake ? 'Можно вывести' : 'Заблокирован'}
        </span>
    </button>`;
}
function renderStaking() {
    const d=stakeUi.status;
    if(!d)return;
    const active=d.gifts||[];
    const total=stakeFormat(d.total_staked_gram);
    const limit=stakeFormat(d.settings.limit_gram);
    const ratio=Math.min(100,Math.round(100*Number(d.total_staked_gram)/Math.max(0.000001,Number(d.settings.limit_gram))));
    const intro = !d.activated ? `<section class="staking-welcome">
        <div class="staking-welcome-glow">${stakingIconSVG}</div>
        <h1>Стейкинг подарков</h1>
        <strong class="staking-apr">${esc(d.settings.apr_percent)}% APR</strong>
        <p>Замораживайте подарки и получайте внутренние GRAM-награды за полные сутки стейкинга.</p>
        <button class="staking-activate" type="button" onclick="showStakingTutorial()">Activate Staking</button>
    </section>` : `<div class="staking-main">
        <div class="staking-heading">
            <span class="staking-eyebrow">CRAFTER · STAKING</span>
            <button class="staking-rules-button" onclick="stakingRules()">ⓘ Правила</button>
        </div>
        <div class="staking-highlight">
            <div class="staking-highlight-icon">${stakingIconSVG}</div>
            <div><h1>Стейкинг подарков <em>${esc(d.settings.apr_percent)}% APR</em></h1>
                <p>Размещайте NFT на срок и получайте ежедневные награды</p></div>
        </div>
        ${active.length ? `<section class="staking-gift-section">
             <div class="staking-section-header"><h2>Мои подарки</h2><span>${active.length}</span></div>
             <div class="staking-gift-grid">${active.map(stakeCard).join('')}</div>
         </section>` : `<div class="staking-empty">
             <div class="staking-empty-symbol">${stakeGiftSVG}</div>
             <h2>Добавьте подарки, чтобы начать зарабатывать</h2>
             <p>Замороженные подарки не получится продать, отправить или использовать в крафте.</p>
         </div>`}
        <button class="staking-deposit-button" type="button" onclick="openStakeGiftPicker()">
            ${stakeGiftSVG} Внести подарки
        </button>
        <section class="staking-stats">
            <div class="staking-stat"><div><b>Ваш стейк</b><strong class="green">${total} GRAM</strong></div>
                <div class="staking-bar"><span style="width:${ratio}%"></span></div></div>
            <div class="staking-stat"><div><b>Лимит стейкинга</b><strong class="blue">${limit} GRAM</strong></div></div>
            <div class="staking-stat"><div><b>Начисление за сутки</b><strong class="green">+${stakeFormat(d.estimated_daily_gram)} GRAM</strong></div></div>
        </section>
        <section class="staking-claim-card">
            <span class="staking-claim-icon">${stakeGiftSVG}</span>
            <div><small>Всего заработано</small><strong>${stakeFormat(Number(d.earned_pending_gram)+Number(d.earned_claimed_gram))} GRAM</strong>
                <small>Доступно: ${stakeFormat(d.earned_pending_gram)} GRAM</small></div>
            <button type="button" onclick="claimStakingRewards()" ${Number(d.earned_pending_gram)>=Number(d.settings.claim_minimum_gram)?'':'disabled'}>
                Получить
            </button>
        </section>
    </div>`;
    document.querySelector('#main').innerHTML = `<div class="staking-page">${intro}</div>`;
}
const stakingTutorialSlides = [
    {title:'Стейкинг подарков',description:'Храните подарки в инвентаре Crafter и получайте внутренние GRAM-награды за каждый полный день.',kind:'gift'},
    {title:'Включите стейкинг',description:'Активируйте стейкинг один раз, затем выберите подарки для размещения.',kind:'activate'},
    {title:'Лимит стейкинга',description:'Вы можете внести подарков на сумму до лимита. Начальный лимит — 50 GRAM.',kind:'limit'},
    {title:'Вносите подарки',description:'После размещения подарки блокируются на установленный срок. APR и лимит задаёт администратор.',kind:'deposit'},
];
function showStakingTutorial(step=0) {
    stakeUi.tutorialStep = Math.min(stakingTutorialSlides.length-1,Math.max(0,step));
    const slide = stakingTutorialSlides[stakeUi.tutorialStep];
    const art=slide.kind==='gift'?stakingIconSVG:
        slide.kind==='activate'?'<span class="staking-tutorial-play">▶ Activate Staking</span>':
        slide.kind==='limit'?'<div class="staking-tutorial-limit">Ваш стейк <b>32/50 GRAM</b><hr>Лимит стейкинга <b>50 GRAM</b></div>':
        '<div class="staking-tutorial-deposit">'+stakeGiftSVG+'<span>Внести подарки</span></div>';
    sheet('Стейкинг', `<div class="staking-tutorial">
        <div class="staking-tutorial-art ${esc(slide.kind)}">${art}</div>
        <h2>${esc(slide.title)}</h2>
        <p>${esc(slide.description)}</p>
        <div class="staking-tutorial-dots">${stakingTutorialSlides.map((_,i)=>`<i class="${i===stakeUi.tutorialStep?'active':''}"></i>`).join('')}</div>
        <button class="staking-tutorial-next" onclick="stakeTutorialContinue()">
            ${stakeUi.tutorialStep===stakingTutorialSlides.length-1?'Activate Staking':'Продолжить'}
        </button>
    </div>`);
    document.querySelector('#sheet').classList.add('staking-tutorial-sheet');
}
async function stakeTutorialContinue() {
    if (stakeUi.tutorialStep<stakingTutorialSlides.length-1) {
        showStakingTutorial(stakeUi.tutorialStep+1);return;
    }
    try {
        const info=await api('staking/activate',{});
        stakeUi.status=info;closeSheet();renderStaking();
        toast('Стейкинг активирован');
    } catch(e) {toast(e.message)}
}
function stakingRules() {
    const d=stakeUi.status;
    sheet('Правила стейкинга', `<div class="staking-rules">
        <p>APR — годовая ставка: <b>${esc(d.settings.apr_percent)}%</b>. Награда за день рассчитывается как оценка подарка × APR / 365.</p>
        <p>Подарки блокируются на <b>${d.settings.lock_days} дн.</b> После истечения срока можно вернуть их в «Мои подарки».</p>
        <p>Лимит: <b>${esc(d.settings.limit_gram)} GRAM</b>. Вывод накопленных наград доступен от <b>1 GRAM</b>.</p>
        <p>Награды начисляются в балансе Crafter. Это не перевод GRAM-токенов в Telegram или блокчейн.</p>
    </div>`);
}
function openStakeGiftPicker() {
    const gifts=stakeUi.gifts;
    if(!gifts.length)return toast('В инвентаре нет доступных подарков');
    stakeUi.picked=new Set();
    sheet('Внести подарки', `<div class="staking-picker">
        <div class="staking-picker-header"><strong>Выберите подарки</strong>
            <p>Недоступны подарки с продажи и находящиеся в стейкинге.</p></div>
        <div class="staking-picker-list">
            ${gifts.map(g=>`<button type="button" class="staking-picker-row" data-stake-gift="${esc(g.id)}"
                onclick="toggleStakeGift('${esc(g.id)}')">
                <span class="staking-pick-check"></span>
                <span class="staking-picker-art" style="background:${giftBackdrop(g)}">
                    <img ${giftPicture(g)} alt="" loading="lazy">
                </span>
                <span class="staking-picker-info"><b>${esc(g.name)}</b>
                    <small>${g.number?'#'+esc(g.number):''}</small></span>
            </button>`).join('')}
        </div>
        <div class="staking-picker-bottom"><p id="staking-pick-count">Выбрано: 0</p>
            <button type="button" class="primary" id="staking-pick-submit" onclick="depositSelectedGifts()" disabled>
                Отправить в стейкинг
            </button></div>
    </div>`);
    document.querySelector('#sheet').classList.add('staking-picker-sheet');
}
function toggleStakeGift(id) {
    if (!stakeUi.gifts.some(g=>g.id===id))return;
    if (stakeUi.picked.has(id))stakeUi.picked.delete(id);
    else if (stakeUi.picked.size<30)stakeUi.picked.add(id);
    else return toast('Можно выбрать до 30 подарков за раз');
    document.querySelectorAll('[data-stake-gift]').forEach(el=>{
        const active=stakeUi.picked.has(el.dataset.stakeGift);
        el.classList.toggle('selected',active);
        el.setAttribute('aria-pressed',String(active));
    });
    document.querySelector('#staking-pick-count').textContent='Выбрано: '+stakeUi.picked.size;
    document.querySelector('#staking-pick-submit').disabled=!stakeUi.picked.size;
}
async function depositSelectedGifts() {
    if(stakeUi.pending||!stakeUi.picked.size)return;
    stakeUi.pending=true;
    const button=document.querySelector('#staking-pick-submit');
    if(button)button.disabled=true;
    try {
        stakeUi.status=await api('staking/deposit',{gift_ids:[...stakeUi.picked]});
        state.inventory=(await api('inventory')).gifts;
        stakeUi.gifts=state.inventory.filter(g=>g.status==='unlisted');
        closeSheet();renderStaking();toast('Подарки добавлены в стейкинг');
    } catch(e){toast(e.message)}
    finally{stakeUi.pending=false;if(button?.isConnected)button.disabled=false}
}
function openStakedGift(id) {
    const entry=stakeUi.status?.gifts?.find(e=>e.id===id);
    if(!entry)return;
    const g=entry.gift;
    sheet(g.name, `<div class="staking-gift-detail">
        <div class="staking-detail-art" style="background:${giftBackdrop(g)}">
            <img ${giftPicture(g)} alt="${esc(g.name)}">
        </div>
        <h2>${esc(g.name)} ${g.number?'#'+esc(g.number):''}</h2>
        <div class="staking-detail-stats">
            <div><span>Модель</span><b>${esc(g.model||'—')}</b></div>
            <div><span>Цена в стейкинге</span><b>${stakeFormat(entry.value_gram)} GRAM</b></div>
            <div><span>APR</span><b>${esc(entry.apr_percent)}%</b></div>
            <div><span>Разблокировка</span><b>${stakeDate(entry.unlock_at)}</b></div>
            <div><span>Начислено дней</span><b>${entry.settled_days}</b></div>
        </div>
        <button type="button" class="primary" onclick="withdrawStakedGift('${esc(entry.id)}')" ${entry.can_unstake?'':'disabled'}>
            ${entry.can_unstake?'Вывести из стейкинга':'Вывод будет доступен '+stakeDate(entry.unlock_at)}
        </button>
    </div>`);
}
async function withdrawStakedGift(id) {
    if(stakeUi.pending)return;
    stakeUi.pending=true;
    try {
        stakeUi.status=await api('staking/withdraw',{entry_id:id});
        state.inventory=(await api('inventory')).gifts;
        stakeUi.gifts=state.inventory.filter(g=>g.status==='unlisted');
        closeSheet();renderStaking();toast('Подарок возвращён в инвентарь');
    }catch(e){toast(e.message)}finally{stakeUi.pending=false}
}
async function claimStakingRewards() {
    if(stakeUi.pending)return;
    stakeUi.pending=true;
    try {
        stakeUi.status=await api('staking/claim',{});
        await refreshMe();
        renderStaking();
        toast('Награда начислена на баланс Crafter');
    }catch(e){toast(e.message)}finally{stakeUi.pending=false}
}
