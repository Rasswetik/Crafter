/* The server owns the clock, stakes and draw. The board only animates that result. */
const arena = {
    view: 0, timer: 0, frame: 0, data: null, cells: [], boardKey: '',
    giftSources: new Map(), pending: false, mode: 'gram', picked: new Set(), gifts: [], retry: null,
};
const arenaPalette = [
    ['#b30054','#ff7748'], ['#4642d4','#776cfc'], ['#15a65b','#5df574'],
    ['#c16b30','#ffd359'], ['#9daf10','#d6ee3e'], ['#0b92a7','#42e6da'],
    ['#c62773','#fa79b1'], ['#2862c0','#60a3ff'],
];
const arenaInitialsPalette = [
    ['#dbc000','#46b82b'], ['#a96cea','#7350ba'],
    ['#68d2af','#168a75'], ['#ffbd49','#e67631'],
];
const arenaNumber = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2});
function arenaFormat(value) {
    const decimal=Number(value);
    return arenaNumber.format(Number.isFinite(decimal)?Math.round((decimal+Number.EPSILON)*100)/100:0);
}
const arenaGiftValue = gift => arenaFormat(gift.value / 1e6);
const arenaBadge = player => (player.name.trim().split(/\s+/).slice(0, 2)
    .map(part => Array.from(part)[0]).join('') || 'И').toUpperCase();
const arenaSettingsKey = () => 'crafter-arena-controls:' + state.me?.user?.id;
const arenaDefaults = {amounts: ['0.1', '0.5', '1'], all: true};

function arenaSettings() {
    try { return JSON.parse(localStorage.getItem(arenaSettingsKey())) || arenaDefaults; }
    catch { return arenaDefaults; }
}

function arenaRules() {
    if (arena.privateToken) return arenaPrivateInfo();
    sheet('Инфо · Arena', `<div class="arena-sheet-copy">
        <p>В одной комнате можно ставить GRAM и подарки из «Моих подарков».</p>
        <p>Когда ставки сделают двое игроков, начнётся 15-секундный отсчёт. До его конца можно присоединиться или увеличить ставку.</p>
        <p>Шанс победы равен вашей доле банка. После закрытия ставок сервер случайно определяет победителя с учётом этих шансов. Шайба останавливается в зоне победителя.</p>
        <p>Победитель получает свой взнос и подарки. ${arena.data?.fee_bps === 0
            ? 'Этот раунд проходит без комиссии.'
            : 'Arena удерживает 8% с GRAM, выигранных у соперников.'}</p>
        <p>Если включён Crafter, он помечен как «Бот» и может поставить свои GRAM или NFT и увеличить ставку до закрытия раунда. Его шанс рассчитывается так же, как у других игроков.</p>
        <p>Если за 5 минут соперник не появится, ставка вернётся автоматически.</p>
    </div>`);
}

function arenaEndpoint(action = '') {
    return (arena.privateToken ? 'arena/private/' + arena.privateToken : 'arena')
        + (action ? '/' + action : '');
}

async function arenaThemeLoad(view) {
    try{
        const result=await api('arena/theme');
        if(view!==arena.view)return;
        document.querySelector('#app')?.classList.toggle('arena-winter',result.winter===true);
    }catch(_error){}
    if(view===arena.view){
        clearTimeout(arena.winterTimer);
        arena.winterTimer=setTimeout(()=>arenaThemeLoad(view),60000);
    }
}

function enterArena(main, privateToken = null) {
    arena.privateToken = privateToken;
    arena.seenResult = 0;
    arena.retry = null;
    arena.picked.clear();
    arena.data = null;
    arena.gifts = [];
    arena.giftLoad = null;
    arena.boardKey = '';
    arena.cells = [];
    arena.visibleWeights = new Map();
    arena.boardMotion = null;
    arena.playback = null;
    arena.failures = 0;
    arena.polling = false;
    arena.frameLast = 0;
    arena.view++;
    main.innerHTML = `<section class="arena-page arena-loading ${privateToken ? 'arena-private-active' : ''}" aria-label="Arena" aria-busy="true">
        <div id="arena-event-banner" class="arena-event-banner-slot" hidden></div>
        <div class="arena-highlights" aria-label="Рекорды арены">
            <div class="arena-highlight" id="arena-best-game"><div class="arena-highlight-heading">Топ игра</div>
                <div class="arena-highlight-content"><span class="arena-highlight-empty">Пока нет игр</span></div></div>
            <div class="arena-highlight" id="arena-last-game"><div class="arena-highlight-heading">Последняя игра</div>
                <div class="arena-highlight-content"><span class="arena-highlight-empty">Пока нет игр</span></div></div>
        </div>
        <div class="arena-table">
            <div class="arena-meta"><span>Банк <b id="arena-bank">0 GRAM</b></span>
                <span id="arena-phase" role="status">Загрузка…</span></div>
            <div class="arena-board-frame"><div class="arena-board-viewport"><svg class="arena-board" viewBox="0 0 100 100" role="img" aria-label="Игровое поле">
                <defs id="arena-colors"></defs>
                <g id="arena-world">
                    <g id="arena-cells"></g>
                    <g id="arena-avatars"></g>
                    <g id="arena-puck" visibility="hidden">
                        <circle r="3.8" fill="#e9ffe3" fill-opacity=".86" stroke="#fff" stroke-width=".5"/>
                        <circle r="2.5" fill="#27351e" fill-opacity=".58" stroke="#fff" stroke-width=".34"/>
                        <path d="M-1.8 0h3.6M0-1.8v3.6" stroke="#fff" stroke-width=".3"/>
                        <g id="arena-aim" fill="none" stroke="#fff" stroke-width=".55">
                            <path d="M.2-6.1A6.1 6.1 0 0 1 6.1 0h4.1m-1.8-1.6 1.8 1.6-1.8 1.6" stroke-linecap="round" stroke-linejoin="round"/>
                        </g>
                        <text id="arena-puck-name" x="0" y="-5.5"></text>
                    </g>
                </g>
            </svg></div></div>
        </div>
        <div class="arena-roster-heading"><h2>Игроки <small id="arena-count">0</small><small id="arena-round"></small></h2></div>
        <div id="arena-players" class="arena-players"></div>
        <div class="arena-dock">
            <div class="arena-modes">
                <div class="arena-mode-tabs" role="group" aria-label="Тип ставки">
                    <button type="button" data-mode="gifts" aria-label="NFT" onclick="arenaMode('gifts')">${stakingGiftIcon}</button>
                    <button type="button" data-mode="gram" aria-label="GRAM" onclick="arenaMode('gram')">${arenaGramIcon}</button>
                </div>
            <div class="arena-room-tabs" role="group" aria-label="Комнаты арены">
                <button type="button" onclick="arenaSwitchRoom(1)" aria-pressed="${privateToken ? 'false' : 'true'}">Комната 1</button>
                <button type="button" onclick="arenaSwitchRoom(2)" aria-pressed="${privateToken ? 'true' : 'false'}">Комната 2</button>
            </div>
            </div>
            <div id="arena-actions" class="arena-actions"></div>
        </div>
    </section>`;
    arenaRenderControls();
    iceArenaLoadBanner(arena.view, Boolean(privateToken));
    arenaThemeLoad(arena.view);
    arenaPoll(arena.view);
    arena.frame = requestAnimationFrame(arenaFrame);
}

function leaveArena() {
    arena.view++;
    clearTimeout(iceArenaBannerPollTimer);
    clearTimeout(arena.winterTimer);
    document.querySelector('#app')?.classList.remove('arena-winter');
    arena.data = null;
    clearTimeout(arena.timer);
    cancelAnimationFrame(arena.frame);
    clearTimeout(arena.resultOpenTimer);
    clearTimeout(arena.resultCloseTimer);
    if (appSheet.open && appSheet.querySelector('.arena-win-panel, .arena-result-detail')) closeSheet();
}

async function arenaPoll(view) {
    if (view !== arena.view || arena.polling) return;
    arena.polling = true;
    const sent = performance.now();
    try {
        const data = await api(arenaEndpoint());
        if (view === arena.view) {
            arena.failures = 0;
            arenaApply(data, sent);
        }
    } catch (error) {
        if (view === arena.view) {
            arena.failures = Math.min(5, arena.failures + 1);
            document.querySelector('.arena-page').classList.remove('arena-loading');
            document.querySelector('.arena-page').setAttribute('aria-busy','false');
            document.querySelector('#arena-phase').textContent = error.message;
        }
    } finally {
        if (view === arena.view) {
            arena.polling = false;
            // During live bets refresh promptly; avoid spamming the server
            // while waiting or when the Telegram WebView is in background.
            const phase = arena.data?.phase;
            const delay = document.hidden ? 6500 :
                arena.failures ? Math.min(15000, 2500 * 2 ** (arena.failures - 1)) :
                phase === 'betting' || phase === 'playing' ? 1300 :
                phase === 'result' ? 1600 : 2200;
            arena.timer = setTimeout(() => arenaPoll(view), delay);
        }
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden || !document.querySelector('.arena-page') || arena.polling) return;
    clearTimeout(arena.timer);
    arena.timer = setTimeout(() => arenaPoll(arena.view), 0);
});

function arenaApply(data, sent) {
    if (arena.data && data.server_time < arena.data.server_time) return;
    const old = arena.data;
    if (!old) {
        document.querySelector('.arena-page').classList.remove('arena-loading');
        document.querySelector('.arena-page').setAttribute('aria-busy','false');
    }
    arena.data = data;
    arenaRenderHighlights(data);
    if (data.private_room) {
        const sameRoom = arenaPrivate.info?.token === data.private_room.token;
        arenaPrivate.info = {...(sameRoom ? arenaPrivate.info : {}), ...data.private_room};
    }
    arena.serverOrigin = (performance.now() + sent) / 2 - data.server_time;
    state.me.balance = data.balance;
    updateBalance();
    const key = JSON.stringify([data.round_id, data.players]);
    if (key !== arena.boardKey) {
        arena.boardKey = key;
        arenaRenderBoard(data, old);
        arenaRenderPlayers(data);
    }
    if (!old || old.round_id !== data.round_id || old.phase !== data.phase ||
            old.balance !== data.balance) arenaRenderControls();
    if (arena.mode === 'gifts' && (!old || old.round_id !== data.round_id || data.phase === 'result' && old.phase !== 'result')) {
        arenaRefreshGifts(true);
    }
    arenaQueueResult(data, old);
}

function arenaArea(points) {
    return Math.abs(points.reduce((sum, point, i) => {
        const next = points[(i + 1) % points.length];
        return sum + point.x * next.y - point.y * next.x;
    }, 0)) / 2;
}

function arenaClip(points, axis, offset, sign) {
    const result = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const da = sign * (a.x * axis.x + a.y * axis.y - offset);
        const db = sign * (b.x * axis.x + b.y * axis.y - offset);
        if (da <= 0) result.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
            const t = da / (da - db);
            result.push({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
        }
    }
    return result;
}

function arenaCells(players, seed, weights) {
    if (!players.length) return [];
    const cells = [];
    const root = {index: 0};
    const leaves = [root];
    // A new player subdivides an existing leaf. Earlier splits keep their axes.
    for (let i = 1; i < players.length; i++) {
        const branch = leaves.shift();
        branch.left = {index: branch.index};
        branch.right = {index: i};
        branch.turn = i;
        leaves.push(branch.left, branch.right);
    }
    function weight(node) {
        node.weight = node.left ? weight(node.left) + weight(node.right) : weights[node.index];
        return node.weight;
    }
    function split(node, points, depth) {
        if (!node.weight || points.length < 3) return;
        if (!node.left) {
            const center = {
                x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
                y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
            };
            const radius = Math.min(Math.sqrt(arenaArea(points)) * .25, ...points.map((a, i) => {
                const b = points[(i + 1) % points.length];
                return Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) /
                    (Math.hypot(b.x - a.x, b.y - a.y) || 1);
            }));
            cells.push({player: players[node.index], index: node.index, points, center, radius});
            return;
        }
        if (!node.right.weight) return split(node.left, points, depth + 1);
        if (!node.left.weight) return split(node.right, points, depth + 1);
        const wanted = arenaArea(points) * node.left.weight / node.weight;
        const angle = (seed % 167) * .013 + depth * 1.37 + (node.turn - 1) * .43;
        const axis = {x: Math.cos(angle), y: Math.sin(angle)};
        const dots = points.map(p => p.x * axis.x + p.y * axis.y);
        let low = Math.min(...dots), high = Math.max(...dots);
        for (let i = 0; i < 38; i++) {
            const midline = (low + high) / 2;
            if (arenaArea(arenaClip(points, axis, midline, 1)) < wanted) low = midline;
            else high = midline;
        }
        const offset = (low + high) / 2;
        split(node.left, arenaClip(points, axis, offset, 1), depth + 1);
        split(node.right, arenaClip(points, axis, offset, -1), depth + 1);
    }
    weight(root);
    split(root, [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}], 0);
    return cells;
}

function arenaPaintBoard(cells) {
    const visible = new Map(cells.map(cell => [cell.index, cell]));
    arena.tiles.forEach(({polygon, avatar}, index) => {
        const cell = visible.get(index);
        polygon.setAttribute('points', cell ? cell.points.map(p => p.x + ',' + p.y).join(' ') : '');
        avatar.setAttribute('visibility', cell && cell.radius >= 1.2 ? 'visible' : 'hidden');
        if (cell) avatar.setAttribute('transform', `translate(${cell.center.x} ${cell.center.y}) scale(${cell.radius})`);
    });
}

function arenaRenderBoard(data, previous) {
    const players = data.players;
    const weights = players.map(player => Number(player.value));
    const from = players.map(player => arena.visibleWeights.get(player.id) || 0);
    const open = data.phase === 'waiting' || data.phase === 'betting';
    const animate = open && previous?.round_id === data.round_id && from.some(Boolean) &&
        weights.some((value, i) => value !== from[i]) && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    arena.cells = arenaCells(players, data.seed, weights);
    const colors = document.querySelector('#arena-colors');
    const layer = document.querySelector('#arena-cells');
    const avatars = document.querySelector('#arena-avatars');
    colors.innerHTML = '<clipPath id="arena-avatar-clip"><circle r="1"/></clipPath>' + players.map((_, i) => {
        const [dark, light] = arenaPalette[i % arenaPalette.length];
        const [top, bottom] = arenaInitialsPalette[i % arenaInitialsPalette.length];
        return `<linearGradient id="arena-color-${i}" gradientUnits="userSpaceOnUse" x2="100" y2="100">
            <stop stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient>
            <linearGradient id="arena-initials-${i}" x2="0" y2="1">
                <stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
            </linearGradient>`;
    }).join('');
    layer.innerHTML = players.map((_, i) => `<polygon fill="url(#arena-color-${i})"/>`).join('') ||
        '<text class="arena-empty-field" x="50" y="50">Ожидаем ставки</text>';
    avatars.innerHTML = players.map((player, i) => {
        const photo = imageURL(player.photo);
        return `<g><circle r="1" fill="url(#arena-initials-${i})"/>
            <text class="arena-avatar-letters" font-size=".92">${esc(arenaBadge(player))}</text>
            ${photo ? `<image href="${esc(photo)}" x="-1" y="-1" width="2" height="2"
                preserveAspectRatio="xMidYMid slice" clip-path="url(#arena-avatar-clip)"/>` : ''}</g>`;
    }).join('');
    arena.tiles = players.map((_, i) => ({polygon: layer.children[i], avatar: avatars.children[i]}));
    arena.boardMotion = animate ? {from, weights, started: performance.now()} : null;
    arena.visibleWeights = new Map(players.map((player, i) => [player.id, animate ? from[i] : weights[i]]));
    arenaPaintBoard(animate ? arenaCells(players, data.seed, from) : arena.cells);
}

function arenaAnimateBoard(now, data) {
    const motion = arena.boardMotion;
    if (!motion) return;
    const done = !arenaBetOpen(data) || now >= motion.started + 360;
    const t = done ? 1 : Math.max(0, (now - motion.started) / 360);
    const eased = t * t * (3 - 2 * t);
    const weights = motion.weights.map((value, i) => motion.from[i] + (value - motion.from[i]) * eased);
    arena.visibleWeights = new Map(data.players.map((player, i) => [player.id, weights[i]]));
    arenaPaintBoard(done ? arena.cells : arenaCells(data.players, data.seed, weights));
    if (done) arena.boardMotion = null;
}

function arenaBotBadge(player) {
    return player.is_bot ? ' <span class="arena-bot-badge">Бот</span>' : '';
}

function arenaAvatar(player) {
    const photo = imageURL(player.photo);
    return `<span class="arena-avatar">${photo ? `<img src="${esc(photo)}" alt="">` : esc(arenaBadge(player))}</span>`;
}

function arenaRenderHighlights(data) {
    for (const [id, result] of [['arena-best-game', data.best_result], ['arena-last-game', data.last_result]]) {
        const card = document.getElementById(id);
        if (!card) continue;
        const key = result ? result.round_id + ':' + result.value : '';
        if (card.dataset.key === key) continue;
        card.dataset.key = key;
        const row = card.querySelector('.arena-highlight-content');
        const player = result?.winner;
        if (!player) {
            row.innerHTML = '<span class="arena-highlight-empty">Пока нет игр</span>';
            continue;
        }
        const value = arenaFormat(result.value);
        row.innerHTML = `${arenaAvatar(player)}<span class="arena-highlight-name">${esc(player.name)}${arenaBotBadge(player)}</span>
            <strong class="arena-highlight-win">+${value} <img src="/static/assets/gram.svg" alt="GRAM"></strong>`;
    }
}

function arenaRenderPlayers(data) {
    document.querySelector('#arena-bank').textContent = arenaFormat(data.bank) + ' GRAM';
    document.querySelector('#arena-count').textContent = data.players.length;
    document.querySelector('#arena-round').textContent = 'Игра #' + data.round_id;
    document.querySelector('#arena-players').innerHTML = data.players.map((player, i) => {
        const [dark, light] = arenaPalette[i % arenaPalette.length];
        return `<button class="arena-player" type="button" onclick="arenaPlayer(${i})"
            style="--arena-team:${light};--arena-avatar:linear-gradient(150deg,${light},${dark})">
            ${arenaAvatar(player)}<span class="arena-player-info"><b>${esc(player.name)}${arenaBotBadge(player)}</b>
            <small>${arenaFormat(player.chance)}% шанс</small></span><strong>${arenaFormat(player.value)} GRAM</strong>
            ${player.gifts.length || Number(player.gram) ? `<span class="arena-player-items">
                ${Number(player.gram) ? `<span class="arena-mini-gram">${arenaGramIcon}<b>${arenaFormat(player.gram)}</b></span>` : ''}
                ${player.gifts.map(gift => `<span class="arena-player-gift">${arenaGiftArt(gift)}
                    <b>${arenaGiftValue(gift)}</b></span>`).join('')}
                </span>` : ''}
        </button>`;
    }).join('') || '<p class="arena-no-players">Сделайте первую ставку, чтобы открыть раунд.</p>';
}

function arenaGiftArt(gift, lazy = false) {
    const key = JSON.stringify([gift.id, gift.image, gift.number]);
    const cached = arena.giftSources.get(key);
    const picture = giftPicture(gift);
    const source = cached ? picture.replace(/^src="[^"]*"/, () => 'src="' + esc(cached) + '"') : picture;
    return `<span class="arena-gift-art" style="background:${giftBackdrop(gift)}">
        ${stakingGiftIcon}<img ${source} data-arena-gift="${esc(key)}" alt="" decoding="async"
            ${lazy ? 'loading="lazy"' : ''} onload="arenaGiftLoaded(this)"></span>`;
}

function arenaGiftLoaded(image) {
    image.parentElement.classList.add('arena-gift-loaded');
    arena.giftSources.set(image.dataset.arenaGift, image.getAttribute('src'));
    if (arena.giftSources.size > 200) arena.giftSources.delete(arena.giftSources.keys().next().value);
}

const arenaResultDuration = 5000;
function arenaQueueResult(data, previous) {
    const result = data.last_result;
    if (!result || result.round_id <= (arena.seenResult || 0)) return;
    const current = data.phase === 'result' && data.round_id === result.round_id;
    if (!current && previous?.round_id !== result.round_id) return;
    arena.seenResult = result.round_id;
    const view = arena.view;
    const end = current && arena.playback?.round === result.round_id
        ? arena.playback.start + data.aim_ms + data.flight_ms + data.finish_ms
        : performance.now();
    arena.resultOpenTimer = setTimeout(() => {
        if (arena.view !== view) return;
        arenaShowPrizes(result.winner.name + ' выиграл', result.value, result.gram, result.gifts, result.winner, result.fee_gram);
        clearTimeout(arena.resultCloseTimer);
        arena.resultCloseTimer = setTimeout(() => {
            if (arena.view === view && appSheet.open &&
                appSheet.querySelector('.arena-win-panel, .arena-result-detail')) closeSheet();
        }, arenaResultDuration);
    }, Math.max(0, end - performance.now()));
}

function arenaPrizeCards(gram, gifts) {
    return `<div class="arena-prizes">${Number(gram) ? `<div class="arena-gram-prize">
        <img src="/static/assets/gram.svg" alt=""><b>${arenaFormat(gram)} GRAM</b></div>` : ''}
        ${gifts.map((gift, i) => `<button class="arena-prize-gift" type="button" onclick="arenaGiftInfo(${i})">
            ${arenaGiftArt(gift)}<span class="arena-prize-info"><b>${esc(gift.name)} #${esc(gift.number)}</b>
            <small>${arenaGiftValue(gift)} GRAM</small></span></button>`).join('')}</div>`;
}

function arenaShowPrizes(title, total, gram, gifts, winner = null, fee = '0') {
    arena.detail = {title, total, gram, gifts, winner, fee};
    const multiplier = winner?.value > 0 ? arenaFormat(Number((total / winner.value).toFixed(2))) : '';
    sheet(title, `<div class="${winner ? 'arena-win-panel' : 'arena-stake-panel'}">
        ${winner ? `<div class="arena-win-avatar">${arenaAvatar(winner)}
            <p>${arenaBotBadge(winner)} Ставка ${arenaFormat(winner.value)} GRAM · шанс ${arenaFormat(winner.chance)}%</p></div>` : ''}
        <strong class="arena-sheet-total">${arenaFormat(total)} GRAM
            ${multiplier ? `<span>${multiplier}×</span>` : ''}</strong>
        
        ${arenaPrizeCards(gram, gifts)}
    </div>`);
}

function arenaPlayer(index) {
    const player = arena.data?.players[index];
    if (player) arenaShowPrizes('Ставка · ' + player.name, player.value, player.gram, player.gifts);
}

function arenaGiftInfo(index) {
    const gift = arena.detail.gifts[index];
    sheet(gift.name + ' #' + gift.number, `<div class="${arena.detail.winner ? 'arena-result-detail' : ''}">
        <div class="arena-detail-art">${arenaGiftArt(gift)}</div>
        ${[['Модель', gift.model], ['Фон', gift.backdrop], ['Узор', gift.symbol?.name || gift.symbol],
            ['Оценка', arenaGiftValue(gift) + ' GRAM']].map(([label, value]) =>
        `<div class="detail-row"><span>${label}</span><b>${esc(value || '—')}</b></div>`).join('')}
        <button class="secondary" type="button" onclick="arenaShowPrizes(arena.detail.title,arena.detail.total,arena.detail.gram,arena.detail.gifts,arena.detail.winner,arena.detail.fee)">Назад</button></div>`);
}

const arenaWall = 4;
const arenaSpan = 100 - 2 * arenaWall;
const arenaSpeed = .22;
const arenaClamp = (value, min, max) => Math.max(min, Math.min(max, value));

function arenaReflect(value) {
    const period = arenaSpan * 2;
    const phase = ((value - arenaWall) % period + period) % period;
    return arenaWall + Math.min(phase, period - phase);
}

function arenaFlight(travel, duration, direction) {
    const accelerationTime = Math.min(travel, duration);
    const distance = arenaSpeed * (accelerationTime ** 2 / (2 * duration) + Math.max(0, travel - duration));
    return {x: 50 + direction.x * distance, y: 50 + direction.y * distance};
}

function arenaBrakePlan(start, duration, direction, target) {
    const unfolded = axis => {
        const stop = arenaClamp(target[axis], arenaWall, 100 - arenaWall);
        const ideal = start[axis] + direction[axis] * arenaSpeed * duration / 2;
        // Either reflection of the endpoint repeats every two board widths.
        const closest = base => base + Math.round((ideal - base) / (2 * arenaSpan)) * 2 * arenaSpan;
        const a = closest(stop), b = closest(2 * arenaWall - stop);
        return Math.abs(a - ideal) <= Math.abs(b - ideal) ? a : b;
    };
    return {duration, start, direction, target, end: {x: unfolded('x'), y: unfolded('y')}};
}

function arenaBrakePosition(plan, elapsed) {
    const t = arenaClamp(elapsed / plan.duration, 0, 1);
    const u = 1 - t;
    const position = axis => {
        // Cubic Hermite path: starts at flight velocity and ends at rest.
        const velocity = plan.direction[axis] * arenaSpeed;
        const path = u * u * (1 + 2*t) * plan.start[axis] + u * u * t * velocity * plan.duration +
            t * t * (3 - 2*t) * plan.end[axis];
        const stop = arenaClamp(plan.target[axis], arenaWall, 100 - arenaWall);
        const edge = arenaClamp((t - .8) / .2, 0, 1);
        return arenaReflect(path) + (plan.target[axis] - stop) * edge * edge * (3 - 2*edge);
    };
    return {x: position('x'), y: position('y'), zoom: 1 + .75 * t * t * (3 - 2*t)};
}

function arenaPuckFrame(data, now) {
    if (!arena.playback || arena.playback.round !== data.round_id) {
        arena.playback = {round: data.round_id, start: data.bet_until + arena.serverOrigin};
    }
    const play = arena.playback;
    const elapsed = Math.max(0, now - play.start);
    const angle = data.seed / 2**32 * Math.PI * 2;
    const travel = Math.max(0, elapsed - data.aim_ms);
    const direction = {x: Math.cos(angle), y: Math.sin(angle)};
    const target = arena.cells.find(cell => cell.player.id === data.target);
    if (target && !play.brake) {
        // On a delayed result packet, continue from the last moving trajectory.
        const at = play.hasMoved ? Math.max(data.flight_ms, play.travel) : data.flight_ms;
        const duration = Math.max(700, data.flight_ms + data.finish_ms - at);
        play.brake = {at, plan: arenaBrakePlan(arenaFlight(at, data.flight_ms, direction), duration, direction, target.center)};
    }
    const aiming = elapsed < data.aim_ms;
    if (aiming) {
        const turn = elapsed / data.aim_ms;
        return {x:50, y:50, zoom:1, aiming, angle:angle - 2 * Math.PI * (1 - turn) ** 2};
    }
    play.hasMoved = true;
    play.travel = travel;
    if (play.brake && travel >= play.brake.at) {
        return {...arenaBrakePosition(play.brake.plan, travel - play.brake.at), aiming, angle};
    }
    const flight = arenaFlight(travel, data.flight_ms, direction);
    return {x:arenaReflect(flight.x), y:arenaReflect(flight.y), zoom:1, aiming, angle};
}

function arenaInside(point, points) {
    return points.every((a, i) => {
        const b = points[(i + 1) % points.length];
        return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= -.0001;
    });
}

function arenaFrame(now) {
    const data = arena.data;
    const active = data && (arena.boardMotion || data.phase === 'playing' || data.phase === 'result');
    const minFrameMs = active ? 33 : 180;
    if (arena.frameLast && now - arena.frameLast < minFrameMs) {
        arena.frame = requestAnimationFrame(arenaFrame);
        return;
    }
    arena.frameLast = now;
    if (data) {
        const serverNow = now - arena.serverOrigin;
        const elapsed = serverNow - data.bet_until;
        arenaAnimateBoard(now, data);
        const phase = document.querySelector('#arena-phase');
        const puck = document.querySelector('#arena-puck');
        const world = document.querySelector('#arena-world');
        let label = 'Ожидаем игроков', show = false, aim = false;
        let position = {x: 50, y: 50}, zoom = 1, player = null;
        if (data.phase === 'waiting' && data.wait_until) {
            const seconds = Math.max(0, Math.ceil((data.wait_until - serverNow) / 1000));
            label = 'Ждём соперника · ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        }
        if (data.phase === 'betting') {
            label = 'Ставки · ' + Math.max(0, Math.ceil(-elapsed / 1000)) + ' с';
        }
        if (data.phase === 'playing' || data.phase === 'result') {
            show = true;
            const motion = arenaPuckFrame(data, now);
            position = motion;
            zoom = motion.zoom;
            aim = motion.aiming;
            label = aim ? 'Прицеливание' : '● LIVE';
            document.querySelector('#arena-aim').setAttribute('transform', `rotate(${motion.angle * 180 / Math.PI})`);
            player = aim ? null : arena.cells.find(cell => arenaInside(position, cell.points))?.player;
            if (data.phase === 'result') label = 'Раунд завершён';
        }
        if (phase.textContent !== label) phase.textContent = label;
        arenaUpdatePickerClock();
        puck.setAttribute('visibility', show ? 'visible' : 'hidden');
        if (show) {
            puck.setAttribute('transform', `translate(${position.x} ${position.y})`);
            document.querySelector('#arena-aim').setAttribute('visibility', aim ? 'visible' : 'hidden');
            const name = document.querySelector('#arena-puck-name');
            name.textContent = player ? Array.from(player.name).slice(0, 24).join('') : '';
            name.setAttribute('x', Math.max(14, Math.min(86, position.x)) - position.x);
            name.setAttribute('y', position.y < 11 ? 8 : -5.5);
        }
        const pan = value => Math.max(100 - zoom*100, Math.min(0, 50 - value*zoom));
        world.setAttribute('transform', `translate(${pan(position.x)} ${pan(position.y)}) scale(${zoom})`);
    }
    arena.frame = requestAnimationFrame(arenaFrame);
}

function arenaMode(mode) {
    arena.mode = mode;
    arenaRenderControls();
    if (mode === 'gifts' && arena.data) arenaRefreshGifts(true);
}

function arenaBetOpen(data = arena.data) {
    return data && (data.phase === 'waiting' ||
        (data.phase === 'betting' && performance.now() - arena.serverOrigin < data.bet_until));
}

function arenaGiftSlots() {
    const viewer = arena.data?.players.find(player => player.id === arena.data.viewer);
    return (arena.data?.gift_limit || 20) - (viewer?.gifts.length || 0);
}

const arenaGramIcon = '<img class="arena-gram-icon" src="/static/assets/gram.svg" alt="">';

const arenaStakeGem = '<svg class="arena-gram-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M4.5 1.5h7a1.7 1.7 0 0 1 1.43.78l2.62 4.1a.85.85 0 0 1-.11 1.06l-6.86 6.8a.82.82 0 0 1-1.16 0L.56 7.44a.85.85 0 0 1-.11-1.06l2.62-4.1A1.7 1.7 0 0 1 4.5 1.5Zm5.32 1.98L9.15 5.3l-1.82.68a.24.24 0 0 0 0 .45l1.82.68.67 1.82a.24.24 0 0 0 .45 0l.68-1.82 1.82-.68a.24.24 0 0 0 0-.45l-1.82-.68-.68-1.82a.24.24 0 0 0-.45 0Z"/></svg>';
const arenaPencilIcon = '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12.5 3.8 3.7 3.7M3.4 16.6l1.1-4.1 9.8-9.8a1.3 1.3 0 0 1 1.8 0l1.2 1.2a1.3 1.3 0 0 1 0 1.8l-9.8 9.8-4.1 1.1Z"/></svg>';

function arenaRenderControls() {
    const root = document.querySelector('#arena-actions');
    const data = arena.data;
    const settings = arenaSettings();
    const open = arenaBetOpen(data) && !arena.pending;
    document.querySelectorAll('.arena-modes [data-mode]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === arena.mode));
    });
    const cheapest = arena.gifts[0];
    const myStake = Number(data?.players?.find(player => player.id === data.viewer)?.value || 0);
    const minBet = Number(data?.private_room?.min_bet || 0);
    const maxBet = Number(data?.private_room?.max_bet || Infinity);
    const allowed = value => myStake + value >= minBet - 1e-9 && myStake + value <= maxBet + 1e-9;
    const giftsOpen = open && arenaGiftSlots() > 0;
    root.classList.toggle('arena-gift-actions', arena.mode === 'gifts');
    root.classList.toggle('arena-cash-actions', arena.mode === 'gram' && !arena.retry);
    root.innerHTML = arena.mode === 'gifts' ? `
        <button type="button" class="arena-choose-gifts" ${giftsOpen ? '' : 'disabled'} onclick="arenaGiftPicker()">Выбрать гифты</button>
        <button type="button" class="arena-quick-gift" aria-label="Быстрая ставка подарком"
            ${giftsOpen && cheapest && allowed(cheapest.value / 1e6) && !arena.giftLoad ? '' : 'disabled'} onclick="arenaQuickGift()">
            <span>Добавить<small>${cheapest ? arenaGiftValue(cheapest) + ' GRAM' : 'Нет гифтов'}</small></span>
            ${cheapest ? `<span class="arena-quick-art">${arenaGiftArt(cheapest)}</span>` : ''}</button>` : `
        <button type="button" class="arena-pencil" aria-label="Настроить кнопки" onclick="arenaOpenSettings()">${arenaPencilIcon}</button>
        ${settings.amounts.map(amount => `<button type="button" class="arena-stake-amount" ${open && Number(data.balance) >= Number(amount) && allowed(Number(amount)) ? '' : 'disabled'}
            onclick="arenaStake(${arg(amount)})">${arenaStakeGem}<span>${arenaFormat(amount)}</span></button>`).join('')}
        ${settings.all ? `<button type="button" class="arena-all-in" ${open && Number(data.balance) > 0 && allowed(Number(data.balance)) ? '' : 'disabled'} onclick="arenaAllIn()">Ва-банк</button>` : ''}`;
    if (arena.retry) root.innerHTML = `<button type="button" ${arena.pending ? 'disabled' : ''}
        onclick="arenaStake(...arena.retry.args)">Проверить предыдущую ставку</button>`;
}

function arenaOpenSettings() {
    const settings = arenaSettings();
    arena.settingsDraft = {amounts: [...settings.amounts], all: settings.all};
    arena.settingsSlot = 0;
    sheet('Настроить кнопки', `<form class="arena-settings" onsubmit="arenaSaveSettings(event)">
        <div class="arena-settings-tabs" role="group" aria-label="Кнопка ставки">
            ${settings.amounts.map((_, i) => `<button type="button" aria-label="Кнопка ${i+1}"
                onclick="arenaSelectSetting(${i})">${arenaGramIcon}<span></span></button>`).join('')}
        </div>
        <div class="arena-settings-amount">
            <input id="arena-amount" aria-label="Сумма ставки" inputmode="decimal" maxlength="14"
                autocomplete="off" oninput="arenaEditSetting(this.value)">
            <span>GRAM</span>
            <button type="button" aria-label="Стереть цифру" onclick="arenaEraseSetting()">
                <svg viewBox="0 0 28 20" fill="currentColor" aria-hidden="true"><path d="M8 2h16a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H8a3 3 0 0 1-2-1L1 11a2 2 0 0 1 0-2l5-6a3 3 0 0 1 2-1Z"/><path d="m12 6 8 8m0-8-8 8" stroke="#202020" stroke-width="2.4" stroke-linecap="round"/></svg>
            </button>
        </div>
        <label class="arena-settings-toggle">Скрывать «Ва-банк»
            <input type="checkbox" name="hide-all" role="switch" ${settings.all ? '' : 'checked'}></label>
        <div class="arena-sheet-actions"><button type="button" class="secondary" onclick="arenaResetSettings()">Сбросить всё</button>
            <button type="submit" class="primary">Сохранить</button></div>
    </form>`);
    arenaSelectSetting(0);
}

function arenaSelectSetting(index) {
    arena.settingsSlot = index;
    const input = document.querySelector('#arena-amount');
    input.value = arena.settingsDraft.amounts[index];
    arenaEditSetting(input.value);
}

function arenaEditSetting(value) {
    arena.settingsDraft.amounts[arena.settingsSlot] = value;
    const input = document.querySelector('#arena-amount');
    const length = Math.max(2, value.length);
    input.style.setProperty('--amount-length', length);
    input.style.setProperty('--amount-size', Math.max(26, 56 - Math.max(0, length - 4) * 4) + 'px');
    document.querySelectorAll('.arena-settings-tabs button').forEach((button, i) => {
        button.setAttribute('aria-pressed', String(i === arena.settingsSlot));
        button.querySelector('span').textContent = arena.settingsDraft.amounts[i] || '—';
    });
}

function arenaEraseSetting() {
    const input = document.querySelector('#arena-amount');
    input.value = input.value.slice(0, -1);
    arenaEditSetting(input.value);
    input.focus();
}

function arenaSaveSettings(event) {
    event.preventDefault();
    const amounts = arena.settingsDraft.amounts.map(value => value.trim().replace(',', '.'));
    const invalid = amounts.findIndex(value => !/^\d{1,7}(\.\d{1,6})?$/.test(value) || +value <= 0 || +value > 1e6);
    if (invalid !== -1) {
        arenaSelectSetting(invalid);
        return toast('Укажите сумму от 0,000001 до 1 000 000 GRAM');
    }
    const all = !event.currentTarget.elements['hide-all'].checked;
    try { localStorage.setItem(arenaSettingsKey(), JSON.stringify({amounts, all})); }
    catch { return toast('Не удалось сохранить настройки'); }
    closeSheet();
    arenaRenderControls();
}

function arenaResetSettings() {
    arena.settingsDraft = {amounts: [...arenaDefaults.amounts], all: arenaDefaults.all};
    document.querySelector('.arena-settings-toggle input').checked = false;
    arenaSelectSetting(0);
}

async function arenaRefreshGifts(quiet = false) {
    if (arena.giftLoad) return arena.giftLoad;
    const view = arena.view;
    arena.giftLoad = (async () => {
        try {
            const {gifts} = await api('arena/gifts');
            if (view !== arena.view) return false;
            arena.gifts = gifts;
            return true;
        } catch (error) {
            if (!quiet && view === arena.view) toast(error.message);
            return false;
        } finally {
            if (view === arena.view) {
                arena.giftLoad = null;
                arenaRenderControls();
            }
        }
    })();
    arenaRenderControls();
    return arena.giftLoad;
}

function arenaQuickGift() {
    const gift = arena.gifts[0];
    if (gift && arenaBetOpen() && arenaGiftSlots() > 0) arenaStake('0', [gift.id], arena.data.round_id, gift.value);
}

const arenaGiftPlural = new Intl.PluralRules('ru-RU');
function arenaGiftCount(count) {
    const word = {one:'гифт', few:'гифта', many:'гифтов'}[arenaGiftPlural.select(count)] || 'гифта';
    return count + ' ' + word;
}

async function arenaGiftPicker() {
    if (!arenaBetOpen()) return;
    const view = arena.view, round = arena.data.round_id;
    arena.picked.clear();
    arena.collections = new Set();
    arena.giftAscending = false;
    sheet('Выберите гифты', `<div class="arena-picker">
        <p id="arena-picker-timer" aria-live="off"></p>
        <div class="arena-picker-filters">
            <button type="button" id="arena-price-sort" disabled onclick="arenaToggleGiftSort()">Цена <span>↓</span></button>
            <button type="button" id="arena-collection-filter" disabled onclick="arenaOpenCollections()">Коллекция <span>⌄</span></button>
        </div>
        <div class="arena-picker-scroll"><div id="arena-picker-grid" class="arena-picker-grid" role="group" aria-label="Гифты">
            ${'<span class="arena-gift-skeleton" aria-hidden="true"></span>'.repeat(9)}
        </div></div>
        <div class="arena-picker-footer">
            <div class="arena-picker-summary">
                <input id="arena-gift-range" type="range" min="0" max="0" value="0" aria-label="Количество гифтов" oninput="arenaSelectGiftCount(this.value)">
                <div><b id="arena-gift-total">0 GRAM</b><small id="arena-gift-count">0 гифтов</small></div>
            </div>
            <div class="arena-sheet-actions">
                <button id="arena-clear-gifts" class="secondary" type="button" onclick="arenaClearGifts()" disabled>Очистить всё</button>
                <button id="arena-gift-submit" class="primary" type="button" disabled
                    onclick="arenaStake('0', [...arena.picked], ${round})">Добавить 0 гифтов</button>
            </div>
        </div>
        <dialog id="arena-collections" aria-labelledby="arena-collections-title">
            <div class="sheet-head"><h2 id="arena-collections-title">Выбрать коллекцию</h2>
                <button class="close" type="button" aria-label="Закрыть коллекции" onclick="this.closest('dialog').close()">×</button></div>
            <div id="arena-collection-list"></div>
        </dialog>
    </div>`);
    arena.pickerRound = round;
    arenaUpdatePickerClock();
    const loaded = await arenaRefreshGifts();
    if (view !== arena.view || arena.pickerRound !== round || !appSheet.open ||
            !document.querySelector('#arena-picker-grid')) return;
    if (loaded) arenaRenderGiftGrid();
    else document.querySelector('#arena-picker-grid').innerHTML =
        '<p class="arena-picker-empty">Не удалось загрузить гифты. <button class="secondary" type="button" onclick="arenaGiftPicker()">Повторить</button></p>';
}

function arenaVisibleGifts() {
    const gifts = arena.gifts.filter(gift => !arena.collections.size || arena.collections.has(gift.name));
    return arena.giftAscending ? gifts : gifts.reverse();
}

function arenaRenderGiftGrid() {
    const grid = document.querySelector('#arena-picker-grid');
    const gifts = arenaVisibleGifts();
    grid.innerHTML = gifts.map(gift => `<button type="button" class="arena-gift-tile" data-gift-id="${esc(gift.id)}"
        aria-label="${esc(gift.name)} #${esc(gift.number)}, ${arenaGiftValue(gift)} GRAM"
        onclick="arenaToggleGift(this.dataset.giftId)">
        ${arenaGiftArt(gift, true)}
        <span class="arena-gift-check" aria-hidden="true"></span>
        <span class="arena-gift-price">${arenaGiftValue(gift)} ${arenaGramIcon}</span>
    </button>`).join('') || (arena.gifts.length ?
        '<p class="arena-picker-empty">В этих коллекциях нет доступных гифтов.</p>' :
        '<div class="arena-picker-empty"><p>Нет доступных гифтов с оценкой.</p><button class="secondary" type="button" onclick="closeSheet();go(&quot;gifts&quot;)">Мои подарки</button></div>');
    const filter = document.querySelector('#arena-collection-filter');
    filter.disabled = !arena.gifts.length;
    document.querySelector('#arena-price-sort').disabled = gifts.length < 2;
    filter.firstChild.textContent = arena.collections.size ? 'Коллекция · ' + arena.collections.size + ' ' : 'Коллекция ';
    document.querySelector('#arena-price-sort span').textContent = arena.giftAscending ? '↑' : '↓';
    arenaUpdateGiftSelection();
}

function arenaToggleGiftSort() {
    arena.giftAscending = !arena.giftAscending;
    arenaRenderGiftGrid();
}

function arenaOpenCollections() {
    const counts = new Map();
    for (const gift of arena.gifts) counts.set(gift.name, (counts.get(gift.name) || 0) + 1);
    const list = document.querySelector('#arena-collection-list');
    list.innerHTML = [...counts].sort(([a, n], [b, m]) => m - n || a.localeCompare(b)).map(([name, count]) => `
        <label class="arena-collection-option"><input type="checkbox" value="${esc(name)}" ${arena.collections.has(name) ? 'checked' : ''}
            onchange="arenaToggleCollection(this)">
            <span><img src="${esc(fragmentCollectionImage(giftCollectionSlug(name)))}" alt="" loading="lazy" onerror="this.hidden=true"></span>
            <b>${esc(name)}</b><small>${arenaGiftCount(count)}</small></label>`).join('') ||
        '<p class="arena-picker-empty">Нет коллекций</p>';
    document.querySelector('#arena-collections').showModal();
}

function arenaToggleCollection(checkbox) {
    if (checkbox.checked) arena.collections.add(checkbox.value);
    else arena.collections.delete(checkbox.value);
    arenaRenderGiftGrid();
}

function arenaToggleGift(id) {
    if (!arenaBetOpen() || arena.pickerRound !== arena.data.round_id || arena.pending) return;
    if (arena.picked.has(id)) arena.picked.delete(id);
    else if (arena.picked.size >= arenaGiftSlots()) return toast('Достигнут лимит гифтов на раунд');
    else arena.picked.add(id);
    arenaUpdateGiftSelection();
}

function arenaSelectGiftCount(count) {
    const visible = arenaVisibleGifts();
    for (const gift of visible) arena.picked.delete(gift.id);
    const available = Math.max(0, arenaGiftSlots() - arena.picked.size);
    for (const gift of visible.slice(0, Math.min(Number(count), available))) arena.picked.add(gift.id);
    arenaUpdateGiftSelection();
}

function arenaClearGifts() {
    arena.picked.clear();
    arenaUpdateGiftSelection();
}

function arenaUpdateGiftSelection() {
    const visible = arenaVisibleGifts();
    const visiblePicked = visible.filter(gift => arena.picked.has(gift.id)).length;
    const remaining = Math.max(0, arenaGiftSlots() - (arena.picked.size - visiblePicked));
    const range = document.querySelector('#arena-gift-range');
    range.max = Math.min(remaining, visible.length);
    range.value = visiblePicked;
    document.querySelectorAll('#arena-picker-grid [data-gift-id]').forEach(button => {
        button.setAttribute('aria-pressed', String(arena.picked.has(button.dataset.giftId)));
    });
    const total = arena.gifts.reduce((sum, gift) => sum + (arena.picked.has(gift.id) ? gift.value : 0), 0);
    document.querySelector('#arena-gift-total').textContent = arenaFormat(total / 1e6) + ' GRAM';
    document.querySelector('#arena-gift-count').textContent = arenaGiftCount(arena.picked.size);
    document.querySelector('#arena-clear-gifts').disabled = !arena.picked.size;
    document.querySelector('#arena-gift-submit').textContent = 'Добавить ' + arenaGiftCount(arena.picked.size);
    arenaUpdatePickerClock();
}

function arenaUpdatePickerClock() {
    const timer = document.querySelector('#sheet[open] #arena-picker-timer');
    if (!timer || !arena.data) return;
    const open = arenaBetOpen() && arena.pickerRound === arena.data.round_id && !arena.pending;
    const seconds = Math.max(0, Math.ceil((arena.data.bet_until - performance.now() + arena.serverOrigin) / 1000));
    const label = !arenaBetOpen() || arena.pickerRound !== arena.data.round_id ? 'Ставки на этот раунд закрыты' :
        arena.data.phase === 'betting' ? 'Игра начнётся через 00:' + String(seconds).padStart(2, '0') : '';
    if (timer.textContent !== label) timer.textContent = label;
    document.querySelector('#arena-gift-submit').disabled = !open || !arena.picked.size || arena.picked.size > arenaGiftSlots();
    document.querySelector('#arena-gift-range').disabled = !open;
}

function arenaAllIn() {
    const round = arena.data.round_id;
    sheet('Ва-банк', `<div class="arena-sheet-copy"><p>Поставить весь доступный баланс в этом раунде?</p>
        <button class="primary" type="button" onclick="arenaStake('all', [], ${round})">Поставить всё</button></div>`);
}

async function arenaStake(amount, giftIds = [], round = arena.data?.round_id, quickValue) {
    if (!round || arena.pending || (!arena.retry && (!arenaBetOpen() || round !== arena.data.round_id))) return;
    const signature = JSON.stringify([round, amount, giftIds, quickValue]);
    if (arena.retry && arena.retry.signature !== signature) {
        return toast('Проверьте результат предыдущей ставки, повторив её');
    }
    const view = arena.view, sent = performance.now();
    const requestId = arena.retry?.id || crypto.randomUUID();
    const stakePanel = appSheet.open ? document.querySelector('#sheet-body').firstElementChild : null;
    arena.pending = true;
    arenaRenderControls();
    try {
        const data = await api(arenaEndpoint('stake'), {round_id: round, request_id: requestId, amount, gift_ids: giftIds, quick_value: quickValue});
        arena.retry = null;
        if (view === arena.view) {
            if ((giftIds.length && !quickValue || amount === 'all') && stakePanel?.isConnected) closeSheet();
            if (giftIds.length) arena.gifts = arena.gifts.filter(gift => !giftIds.includes(gift.id));
            arenaApply(data, sent);
            toast('Ставка принята');
        }
    } catch (error) {
        arena.retry = error.status && error.status < 500 ? null : {signature, id: requestId, args: [amount, giftIds, round, quickValue]};
        if (view === arena.view) toast(error.message);
    } finally {
        arena.pending = false;
        if (state.page === 'arena') {
            arenaRenderControls();
            if (giftIds.length) arenaRefreshGifts(true);
        }
    }
}
