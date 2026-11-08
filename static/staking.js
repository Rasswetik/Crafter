/* Crafter Games Hub and gift staking. The existing craft mechanic is preserved. */
const stakeUi = {status:null, picked:new Set(), tutorialStep:0, gifts:[], pending:false};
const crafterModePolicy = {craft:true,arena:true,staking:true,upgrade:true};
let crafterModePolicyLoaded = false;
async function loadCrafterModePolicy() {
    if (crafterModePolicyLoaded) return;
    crafterModePolicyLoaded = true;
    try {
        const data = await api('site/modes');
        for (const id of ['craft','arena','staking','upgrade'])
            if (typeof data.modes?.[id] === 'boolean') crafterModePolicy[id] = data.modes[id];
        if (state.page === 'games') renderGamesHub();
        if (typeof nav === 'function') nav();
    } catch(_) { crafterModePolicyLoaded = false; }
}
function crafterCanSeeMode(mode) {
    return Boolean(state.me?.is_admin || crafterModePolicy[mode]);
}

const stakingMachinePNG = '<img class="staking-machine-png" src="/static/assets/staking-machine.png" alt="Стейкинг подарков" decoding="async">';
const magnateArt = (className) => `<img class="${className}" src="/static/assets/craft-magnate.webp" alt="" decoding="async">`;
const gamesHubIcon = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M1.71925 7.38372L1.12057 12.7718C0.90383 14.7224 2.43075 16.4284 4.39339 16.4284C5.64068 16.4284 6.78091 15.7237 7.33872 14.6081L7.85714 13.5713H12.1429L12.6613 14.6081C13.2191 15.7237 14.3593 16.4284 15.6066 16.4284C17.5693 16.4284 19.0962 14.7224 18.8794 12.7718L18.2807 7.38373C18.0396 5.2133 16.205 3.57129 14.0212 3.57129H5.97875C3.79497 3.57129 1.96041 5.2133 1.71925 7.38372ZM6.25001 6.24986C6.74312 6.24986 7.14287 6.6496 7.14287 7.14272V7.91665H7.91679C8.40991 7.91665 8.80965 8.31639 8.80965 8.8095C8.80965 9.30262 8.40991 9.70236 7.91679 9.70236H7.14287V10.476C7.14287 10.9692 6.74312 11.3689 6.25001 11.3689C5.75691 11.3689 5.35715 10.9692 5.35715 10.476V9.70236H4.58347C4.09035 9.70236 3.69061 9.30262 3.69061 8.8095C3.69061 8.31639 4.09035 7.91665 4.58347 7.91665H5.35715V7.14272C5.35715 6.6496 5.75691 6.24986 6.25001 6.24986ZM13.2366 10.5952C13.7297 10.5952 14.1295 10.1955 14.1295 9.70236C14.1295 9.20925 13.7297 8.8095 13.2366 8.8095C12.7435 8.8095 12.3438 9.20925 12.3438 9.70236C12.3438 10.1955 12.7435 10.5952 13.2366 10.5952ZM15.9152 7.4887C15.9152 7.98182 15.5154 8.38156 15.0223 8.38156C14.5293 8.38156 14.1295 7.98182 14.1295 7.4887C14.1295 6.99559 14.5293 6.59585 15.0223 6.59585C15.5154 6.59585 15.9152 6.99559 15.9152 7.4887Z"/></svg>';
const stakingGiftIcon = '<svg viewBox="0 0 25 25" fill="currentColor" aria-hidden="true"><path d="M8.48261 1.07292C7.88291 0.692664 7.08851 0.870545 6.70827 1.47023C6.32801 2.06991 6.50588 2.86431 7.10557 3.24457L8.74748 4.28569H3.07143C1.83356 4.28569 0.5 5.12404 0.5 6.52388V8.95273C0.5 10.2588 1.66097 11.0761 2.82193 11.1797C2.81206 11.1827 2.80225 11.1859 2.79253 11.1892H11.4286V6.65879H13.5714V11.1892H22.2075C22.1977 11.1859 22.1879 11.1827 22.178 11.1797C23.3391 11.0761 24.5 10.2588 24.5 8.95273V6.52388C24.5 5.12404 23.1665 4.28569 21.9286 4.28569H16.2526L17.8945 3.24457C18.4942 2.86431 18.6721 2.06991 18.2919 1.47023C17.9115 0.870545 17.1172 0.692664 16.5175 1.07292L12.5 3.62036L8.48261 1.07292Z"/><path d="M2.5 13h8.93v10H5a2.5 2.5 0 0 1-2.5-2.5V13Zm11.07 0h8.93v7.5A2.5 2.5 0 0 1 20 23h-6.43V13Z"/></svg>';
const stakingNavIcon = '<svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.44873 2.67537C10.3605 0.905475 12.2533 0.451782 13.245 0.496604C13.9563 0.528747 14.2767 1.16028 14.2767 1.64162V3.89603C15.1773 4.34879 15.7797 4.95236 16.1493 5.7046C16.5138 6.44632 16.6244 7.27936 16.6438 8.13332L17.5374 8.86729C17.686 8.9894 17.7721 9.17167 17.7721 9.36404V12.2167C17.7721 12.3103 17.7517 12.4028 17.7122 12.4877C17.008 14.0027 15.7595 14.8213 14.2767 15.4022V16.2213C14.2767 16.9313 13.7011 17.507 12.991 17.507H10.7411C10.031 17.507 9.45538 16.9313 9.45538 16.2213V15.5985H6.70314V16.1208C6.70314 16.8309 6.12751 17.4065 5.41742 17.4065H3.14729C2.43805 17.4065 1.86148 16.8324 1.86156 16.1213C1.86164 15.3975 1.86173 14.2756 1.86154 13.9137C1.85089 13.8774 1.83519 13.8272 1.81335 13.7585L1.78771 13.678C1.74212 13.5352 1.68262 13.3488 1.61739 13.1316L1.61166 13.1124C1.17024 11.6424 0.350539 8.91261 1.52519 6.3092C1.61266 6.11532 1.71095 5.9255 1.82082 5.74068C1.21353 5.26005 0.604741 4.58131 0.266993 3.67622C0.111834 3.26043 0.32312 2.79758 0.738913 2.64242C1.15471 2.48726 1.61756 2.69855 1.77272 3.11434C1.98382 3.68008 2.3835 4.1408 2.8376 4.49576C3.24205 4.12877 3.72169 3.80343 4.28639 3.53285C5.56834 2.91859 7.25677 2.60114 9.44873 2.67537ZM9.48288 6.30275C9.48288 6.74656 9.12311 7.10633 8.67931 7.10633H6.29433C5.85053 7.10633 5.49076 6.74656 5.49076 6.30275C5.49076 5.85895 5.85053 5.49918 6.29433 5.49918H8.67931C9.12311 5.49918 9.48288 5.85895 9.48288 6.30275ZM12.6432 8.89662C13.1868 8.89662 13.6275 8.4559 13.6275 7.91225C13.6275 7.3686 13.1868 6.92787 12.6432 6.92787C12.0995 6.92787 11.6588 7.3686 11.6588 7.91225C11.6588 8.4559 12.0995 8.89662 12.6432 8.89662Z"/></svg>';
// Custom SVG: a clean market arch + two stands, matched to filled Games/Staking icons.
const crafterMarketIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M4.2 4.5c0-1.1.9-2 2-2h11.6c1.1 0 2 .9 2 2v3.2l1.5 2.7c.7 1.3.1 2.9-1.3 3.5V19c0 1.3-1 2.3-2.3 2.3H6.3C5 21.3 4 20.3 4 19v-5.1c-1.3-.6-2-2.2-1.3-3.5l1.5-2.7V4.5Zm2.3.1v3h11v-3h-11ZM6.1 11.1H17.9l-1.1-2.3H7.2l-1.1 2.3Zm.2 3v4.9h3.1v-4.9H6.3Zm5.5 0v4.9h5.9v-4.9h-5.9Z" clip-rule="evenodd"/></svg>';
const arenaNavIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.5 1.8a.45.45 0 0 1 .64.64l-5.2 6.65-8.71 8.7 1.15 1.15a1.22 1.22 0 0 1-1.72 1.72l-1.15-1.15-2.3 2.3a1.48 1.48 0 0 1-2.1-2.1l2.3-2.3-1.15-1.15a1.22 1.22 0 0 1 1.73-1.72l1.15 1.15 8.7-8.71 6.66-5.18ZM2.5 1.8l6.66 5.18 2.03 2.04-2.2 2.2-2.04-2.04-5.09-6.74a.45.45 0 0 1 .64-.64Zm12.8 11.67 2.55 2.55 1.15-1.15a1.22 1.22 0 0 1 1.73 1.72l-1.15 1.15 2.3 2.3a1.48 1.48 0 0 1-2.1 2.1l-2.3-2.3-1.15 1.15a1.22 1.22 0 0 1-1.72-1.72l1.15-1.15-2.55-2.55 2.09-2.1Z"/></svg>';
const gameNavIcons = {games: gamesHubIcon, gift: stakingGiftIcon, staking: stakingNavIcon, market: crafterMarketIcon, arena: arenaNavIcon};
nav = function() {
    const root = document.querySelector('#nav');
    if (!root) return;
    const inGames = Boolean(state.gamesMode || ['games','craft','arena','events','upgrade'].includes(state.page));
    const sidePage = inGames ? 'market' : 'games';
    const sideLabel = inGames ? 'Маркет' : 'Игры';
    const destinations = inGames ? [
        ['games','games','Hub'], ['upgrade','upgrade','Апгрейд'], ...(window.crafterOfflinePreview ? [] : [['arena','arena','Arena']])
    ] : [
        ['market','market','Маркет'],['gifts','gift','Мои подарки'],
        ['staking','staking','Стейкинг']
    ];
    const visibleDestinations = destinations.filter(([page]) =>
        (page !== 'arena' || crafterCanSeeMode('arena')) &&
        (page !== 'upgrade' || crafterCanSeeMode('upgrade')) &&
        (page !== 'staking' || crafterCanSeeMode('staking')));
    root.classList.toggle('games-nav', inGames);
    root.innerHTML = `<button class="games-entry" type="button" onclick="go('${sidePage}')" aria-label="${sideLabel}">
        <span class="stake-nav-icon">${gameNavIcons[sidePage] || icon(sidePage)}</span><span class="nav-label">${sideLabel}</span></button>
        <div class="nav-main">${visibleDestinations.map(([page,kind,title]) => `
        <button type="button" onclick="go('${page}')" class="${state.page === page || (page === 'games' && state.page === 'craft') ? 'active' : ''}"
            data-game-page="${page}" aria-label="${title}"><span class="stake-nav-icon">${gameNavIcons[kind] || icon(kind)}</span><span class="nav-label">${title}</span></button>`).join('')}</div>
        <button class="profile-nav ${state.page === 'profile' ? 'active' : ''}" onclick="go('profile')" aria-label="Профиль">
            <span class="avatar">${avatar()}</span></button>`;
};
const stakeGoBefore = go;
let stakeCountdownTimer;
let stakeServerTimeOffset = 0;
go = async function(page, eventId = null, focusLeaderboard = true) {
    if (state.crafting) return;
    document.querySelector('#app')?.classList.toggle('staking-view', page === 'staking');
    document.querySelector('#app')?.classList.toggle('arena-view', page === 'arena');
    clearTimeout(stakeCountdownTimer);
    if (state.page === 'arena') leaveArena();
    // Games is a navigation context, not a permanent extra tab. Keep Hub available
    // while visiting the profile from a game; Market leaves Games mode.
    if (['games', 'craft', 'arena', 'events'].includes(page)) state.gamesMode = true;
    else if (page === 'market' || page === 'gifts' || page === 'staking') state.gamesMode = false;
    if (!['games', 'staking', 'arena', 'events'].includes(page)) {
        document.querySelector('#app')?.classList.toggle('games-view', Boolean(state.gamesMode));
        return stakeGoBefore(page);
    }
    state.page = page;
    document.querySelector('#app')?.classList.remove('craft-view','cart-view');
    document.querySelector('#app')?.classList.toggle('games-view',Boolean(state.gamesMode));
    document.querySelector('#cart-float')?.remove();
    nav();
    updateBalance();
    const main = document.querySelector('#main');
    if (!main) return;
    if (page === 'games') {
        renderGamesHub();
        return;
    }
    if (page === 'arena') {
        const invite = typeof arenaInviteToken === 'function' && arenaInviteToken();
        if (invite) arenaShowInvite(invite);
        else enterArena(main);
        return;
    }
    if (page === 'events') {
        if (eventId) await openCrafterEvent(eventId, focusLeaderboard);
        else await renderEventsPage();
        return;
    }
    stakeUi.status = null;
    main.innerHTML = crafterLoading(page);
    try {
        const [info,inventory] = await Promise.all([api('staking'),api('inventory')]);
        if (state.page !== 'staking') return;
        stakeUi.status = info;
        state.inventory = inventory.gifts;
        stakeUi.gifts = inventory.gifts.filter(g => g.status === 'unlisted' && !g.catalog_only);
        renderStaking();
    } catch(error) {
        if (state.page === 'staking') {
            main.innerHTML = `<div class="error">${esc(error.message)}</div>
                <button class="secondary" onclick="go('staking')">Повторить</button>`;
        }
    }
};
const crafterArenaSwordArt = '<svg class="crafter-animated-swords" viewBox="0 0 100 100" aria-hidden="true">'+
'<defs><linearGradient id="crafter-ice-steel"><stop stop-color="#efffff"/><stop offset=".4" stop-color="#6ed4ff"/><stop offset="1" stop-color="#2387c9"/></linearGradient>'+
'<linearGradient id="crafter-violet-steel"><stop stop-color="#fff6ff"/><stop offset=".4" stop-color="#cb9cff"/><stop offset="1" stop-color="#8751d8"/></linearGradient>'+
'<linearGradient id="crafter-guard"><stop stop-color="#f3feff"/><stop offset=".55" stop-color="#acbcd0"/><stop offset="1" stop-color="#50617e"/></linearGradient></defs>'+
'<g class="sword sword-left"><path class="sword-blade" d="M50 5 43 23 44.3 67H55.7L57 23Z" fill="url(#crafter-ice-steel)"/>'+
'<path d="M50 9V65" stroke="#f5ffff" stroke-width="1.5" opacity=".9"/>'+
'<path class="sword-crossguard" d="M26 69 32 61 45 65 50 67 55 65 68 61 74 69 57 74 53 78H47L43 74Z" fill="url(#crafter-guard)"/>'+
'<path class="sword-hilt" d="M46.5 77H53.5V91H46.5Z" fill="#314869"/><circle cx="50" cy="94" r="4" fill="#88dcfa" stroke="#efffff" stroke-width="1.3"/></g>'+
'<g class="sword sword-right"><path class="sword-blade" d="M50 5 43 23 44.3 67H55.7L57 23Z" fill="url(#crafter-violet-steel)"/>'+
'<path d="M50 9V65" stroke="#f5ffff" stroke-width="1.5" opacity=".9"/>'+
'<path class="sword-crossguard" d="M26 69 32 61 45 65 50 67 55 65 68 61 74 69 57 74 53 78H47L43 74Z" fill="url(#crafter-guard)"/>'+
'<path class="sword-hilt" d="M46.5 77H53.5V91H46.5Z" fill="#4f3965"/><circle cx="50" cy="94" r="4" fill="#d0aaff" stroke="#efffff" stroke-width="1.3"/></g>'+
'</svg>';

function renderGamesHub() {
    document.querySelector('#main').innerHTML = `<section class="crafter-games">
        <div class="crafter-hub-craft-banner arena-event-banner-slot" id="craft-hub-banner" hidden></div>
        ${crafterCanSeeMode('craft') ? `<button class="crafter-game-tile crafter-pepe-tile" onclick="go('craft')" type="button">
            <span class="crafter-game-label"><strong>Крафты</strong>
                <span>Соберите подарки и выберите цель</span>
                <span class="crafter-game-open">Играть</span></span>
            <span class="crafter-game-emblem">${anvilArt('crafter-game-anvil')}</span>
            <span class="crafter-pepe-motion" aria-hidden="true"><img class="crafter-pepe-picture" src="/static/assets/splash-magnate.png" alt="" loading="lazy" decoding="async"><span class="crafter-pepe-lottie" data-crafter-lottie="magnate"></span></span>
        </button>` : ''}
        ${!crafterCanSeeMode('upgrade') ? '' : `<button class="crafter-game-tile crafter-upgrade-tile" onclick="go('upgrade')" type="button">
            <span class="crafter-game-label"><strong>Апгрейд</strong>
                <span>Поставьте подарок и получите дороже</span>
                <span class="crafter-game-open">Играть</span></span>
            <span class="hub-wheel" aria-hidden="true"><i class="hub-wheel-ring"></i><i class="hub-wheel-zone"></i><i class="hub-wheel-pointer"></i><b>↑</b></span>
        </button>`}
        ${window.crafterOfflinePreview || !crafterCanSeeMode('arena') ? '' : `<button class="crafter-game-tile arena-tile crafter-swords-tile" onclick="go('arena')" type="button">
            <span class="crafter-game-label"><strong>Arena</strong>
                <span>Один раунд. Один победитель.</span>
                <span class="crafter-game-open">Играть</span></span>
            <span class="arena-tile-icon crafter-swords-motion">${crafterArenaSwordArt}</span>
        </button>`}
    </section>`;
    if(typeof crafterCraftBannerMount==='function')crafterCraftBannerMount('craft-hub-banner');
    if(typeof crafterLottieEnhance==='function')requestAnimationFrame(()=>crafterLottieEnhance(document.querySelector('#main')));
    loadCrafterModePolicy();
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
function stakeTimeLeft(unlockAt) {
    return Math.max(0, Math.ceil(Number(unlockAt) - (Date.now() / 1000 + stakeServerTimeOffset)));
}
function stakeCountdownText(seconds) {
    const days = Math.floor(seconds / 86400);
    const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
        .map(part => String(part).padStart(2, '0')).join(':');
    return days ? `${days}д ${clock}` : clock;
}
function updateStakeCountdowns() {
    clearTimeout(stakeCountdownTimer);
    if (state.page !== 'staking') return;
    let running = false;
    const selectors = '#main [data-stake-unlock], #sheet[open] [data-stake-unlock]';
    for (const label of document.querySelectorAll(selectors)) {
        const left = stakeTimeLeft(label.dataset.stakeUnlock);
        const detail = label instanceof HTMLButtonElement;
        label.textContent = left ? stakeCountdownText(left) : (detail ? 'Вывести из стейкинга' : 'Можно вывести');
        if (detail) label.disabled = left > 0;
        else label.classList.toggle('ready', !left);
        running ||= left > 0;
    }
    if (running) stakeCountdownTimer = setTimeout(updateStakeCountdowns, 1000);
}
function stakeCard(entry) {
    const gift = entry.gift;
    return `<button type="button" class="stake-gift-card" onclick="openStakedGift(${arg(entry.id)})"
        aria-label="${esc(gift.name)} #${esc(gift.number || '')}">
        <span class="stake-gift-art" style="background:${giftBackdrop(gift)}">
            <img ${giftPicture(gift)} alt="" loading="lazy">
        </span>
        <strong>${esc(gift.name)}</strong>
        <small>${gift.number ? '#' + esc(gift.number) : ''}</small>
        <span class="stake-gift-state" data-stake-unlock="${esc(entry.unlock_at)}"></span>
    </button>`;
}
function renderStaking() {
    const d=stakeUi.status;
    if(!d)return;
    stakeServerTimeOffset = Number.isFinite(d.server_time) ? d.server_time - Date.now() / 1000 : 0;
    const active=d.gifts||[];
    const total=stakeFormat(d.total_staked_gram);
    const limit=stakeFormat(d.settings.limit_gram);
    const ratio=Math.min(100,Math.round(100*Number(d.total_staked_gram)/Math.max(0.000001,Number(d.settings.limit_gram))));
    const intro = !d.activated ? `<section class="staking-welcome">
        <div class="staking-welcome-glow">${stakingMachinePNG}</div>
        <h1>Стейкинг подарков</h1>
        <strong class="staking-apr">${esc(d.settings.apr_percent)}% APR</strong>
        <p>Замораживайте подарки и получайте внутренние GRAM-награды за полные сутки стейкинга.</p>
        <button class="staking-activate" type="button" onclick="showStakingTutorial()" ${d.enabled?'':'disabled'}>Activate Staking</button>
    </section>` : `<div class="staking-main">
        ${active.length ? `<section class="staking-gift-section">
             <div class="staking-section-header"><h2>Мои подарки</h2><span>${active.length}</span></div>
             <div class="staking-gift-grid">${active.map(stakeCard).join('')}</div>
         </section>` : `<div class="staking-highlight">
            <div class="staking-highlight-icon">${stakingMachinePNG}</div>
            <div><h1>Стейкинг подарков</h1>
                <strong class="staking-apr-display">${esc(d.settings.apr_percent)}% APR
                    <button type="button" class="staking-apr-info" onclick="stakingRules()" aria-label="Что такое APR">i</button>
                </strong>
                <p>Держите NFT-подарки в стейкинге и получайте ежедневные GRAM-награды</p></div>
        </div>
        <div class="staking-empty">
             <div class="staking-empty-symbol">${stakingGiftIcon}</div>
             <h2>Добавьте подарки, чтобы начать зарабатывать</h2>
             <p>Замороженные подарки не получится продать, отправить или использовать в крафте.</p>
         </div>`}
        <button class="staking-deposit-button" type="button" onclick="openStakeGiftPicker()" ${d.enabled?'':'disabled'}>
            ${stakingGiftIcon} Внести подарки
        </button>
        <section class="staking-stats">
            <div class="staking-stat"><div><b>Ваш стейк</b><strong class="green">${total} GRAM</strong></div>
                <div class="staking-bar"><span style="width:${ratio}%"></span></div></div>
            <div class="staking-stat"><div><b>Лимит стейкинга</b><strong class="blue">${limit} GRAM</strong></div></div>
            <div class="staking-stat"><div><b>Начисление за сутки</b><strong class="green">+${stakeFormat(d.estimated_daily_gram)} GRAM</strong></div></div>
        </section>
        <section class="staking-claim-card">
            <span class="staking-claim-icon">${stakingGiftIcon}</span>
            <div><small>Всего заработано</small><strong>${stakeFormat(Number(d.earned_pending_gram)+Number(d.earned_claimed_gram))} GRAM</strong>
                <small>Доступно: ${stakeFormat(d.earned_pending_gram)} GRAM</small></div>
            <button type="button" onclick="claimStakingRewards()" ${Number(d.earned_pending_gram)>=Number(d.settings.claim_minimum_gram)?'':'disabled'}>
                Получить
            </button>
        </section>
    </div>`;
    document.querySelector('#main').innerHTML = `<div class="staking-page">${intro}</div>`;
    updateStakeCountdowns();
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
    const art=slide.kind==='gift'?stakingMachinePNG:
        slide.kind==='activate'?'<span class="staking-tutorial-play">▶ Activate Staking</span>':
        slide.kind==='limit'?'<div class="staking-tutorial-limit">Ваш стейк <b>32/50 GRAM</b><hr>Лимит стейкинга <b>50 GRAM</b></div>':
        '<div class="staking-tutorial-deposit">'+stakingGiftIcon+'</div>';
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
    if (!d) return;
    sheet('Правила стейкинга', `<div class="staking-rules">
        <p>APR — годовая ставка: <b>${esc(d.settings.apr_percent)}%</b>. Награда за день рассчитывается как оценка подарка × APR / 365.</p>
        <p>Подарки блокируются на <b>${d.settings.lock_days} дн.</b> После истечения срока можно вернуть их в «Мои подарки».</p>
        <p>Лимит: <b>${esc(d.settings.limit_gram)} GRAM</b>. Вывод накопленных наград доступен от <b>1 GRAM</b>.</p>
        <p>Награды начисляются в балансе Crafter. Это не перевод GRAM-токенов в Telegram или блокчейн.</p>
    </div>`);
}
function openStakeGiftPicker() {
    if (stakeUi.pending) return;
    const gifts = stakeUi.gifts;
    if (!gifts.length) {
        sheet('Внести подарки', emptyGiftActions());
        startEmptyGiftCarousel(appSheet);
        return;
    }
    stakeUi.picked=new Set();
    sheet('Внести подарки', `<div class="staking-picker">
        <div class="staking-picker-header"><strong>Выберите подарки</strong>
            <p>Недоступны подарки с продажи и находящиеся в стейкинге.</p></div>
        <div class="staking-picker-list">
            ${gifts.map(g=>`<button type="button" class="staking-picker-row" data-stake-gift="${esc(g.id)}" aria-pressed="false"
                onclick="toggleStakeGift(${arg(g.id)})">
                <span class="staking-pick-check"></span>
                <span class="staking-picker-art" style="background:${giftBackdrop(g)}">
                    <img ${giftPicture(g)} alt="" loading="lazy" width="60" height="60">
                </span>
                <span class="staking-picker-info"><b>${esc(g.name)}</b>
                    <small>${g.number?'#'+esc(g.number):''}</small></span>
            </button>`).join('')}
        </div>
        <div class="staking-picker-bottom"><p id="staking-pick-count">Выбрано: 0</p>
            <p id="staking-pick-error" class="staking-pick-error" role="alert" hidden></p>
            <button type="button" class="primary" id="staking-pick-submit" onclick="depositSelectedGifts()" disabled>
                Отправить в стейкинг
            </button></div>
    </div>`);
    document.querySelector('#sheet').classList.add('staking-picker-sheet');
}
function toggleStakeGift(id) {
    if (stakeUi.pending || !stakeUi.gifts.some(g => g.id === id)) return;
    document.querySelector('#staking-pick-error').hidden = true;
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
    const button = document.querySelector('#staking-pick-submit');
    const error = document.querySelector('#staking-pick-error');
    const ids = [...stakeUi.picked];
    button.disabled = true;
    error.hidden = true;
    try {
        stakeUi.status = await api('staking/deposit', {gift_ids: ids});
        stakeUi.gifts = stakeUi.gifts.filter(gift => !ids.includes(gift.id));
        state.inventory = state.inventory.filter(gift => !ids.includes(gift.id));
        stakeUi.picked.clear();
        if (button.isConnected) closeSheet();
        if (state.page === 'staking') renderStaking();
        toast('Подарки добавлены в стейкинг');
    } catch (e) {
        if (error?.isConnected) {
            error.textContent = e.message;
            error.hidden = false;
        }
        toast(e.message || 'Не удалось внести подарки. Проверьте оценку и лимит стейкинга.');
    } finally {
        stakeUi.pending = false;
        if (button.isConnected) button.disabled = !stakeUi.picked.size;
    }
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
            <div><span>Заработано</span><b>${stakeFormat(entry.earned_gram)} GRAM</b></div>
        </div>
        <button type="button" class="primary" onclick="withdrawStakedGift(${arg(entry.id)})"
            data-stake-unlock="${esc(entry.unlock_at)}" disabled></button>
    </div>`);
    updateStakeCountdowns();
}
async function withdrawStakedGift(id) {
    if(stakeUi.pending)return;
    stakeUi.pending=true;
    try {
        stakeUi.status=await api('staking/withdraw',{entry_id:id});
        if (state.page === 'staking') {
            closeSheet();
            await go('staking');
        }
        toast('Подарок возвращён в инвентарь');
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
