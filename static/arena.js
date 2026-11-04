/* The server owns the clock, stakes and draw. The board only animates that result. */
const arena = {
    view: 0, timer: 0, frame: 0, data: null, cells: [], boardKey: '',
    pending: false, mode: 'gram', picked: new Set(), gifts: [], retry: null,
};
const arenaPalette = [
    ['#9919da','#d140ff'], ['#4642d4','#776cfc'], ['#15a65b','#5df574'],
    ['#c16b30','#ffd359'], ['#9daf10','#d6ee3e'], ['#0b92a7','#42e6da'],
    ['#c62773','#fa79b1'], ['#2862c0','#60a3ff'],
];
const arenaFormat = value => Number(value).toLocaleString('ru-RU', {maximumFractionDigits: 6});
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
    sheet('Инфо · Arena', `<div class="arena-sheet-copy">
        <p>В одной комнате можно ставить GRAM и подарки из «Моих подарков».</p>
        <p>Когда ставки сделают двое игроков, начнётся 15-секундный отсчёт. До его конца можно присоединиться или увеличить ставку.</p>
        <p>Шанс победы равен вашей доле банка. После закрытия ставок сервер случайно определяет победителя с учётом этих шансов. Шайба останавливается в зоне победителя.</p>
        <p>Победитель получает все поставленные GRAM и подарки. Пока в раунде один игрок, он может отменить ставку. Если за 5 минут соперник не появится, ставка вернётся автоматически.</p>
    </div>`);
}

function enterArena(main) {
    arena.data = null;
    arena.gifts = [];
    arena.giftLoad = null;
    arena.boardKey = '';
    arena.cells = [];
    arena.view++;
    main.innerHTML = `<section class="arena-page arena-loading" aria-label="Arena" aria-busy="true">
        <div class="arena-table">
            <div class="arena-meta"><span>Банк <b id="arena-bank">0 GRAM</b></span>
                <span id="arena-phase" role="status">Загрузка…</span></div>
            <svg class="arena-board" viewBox="0 0 100 100" role="img" aria-label="Игровое поле">
                <defs id="arena-colors"></defs>
                <g id="arena-world">
                    <g id="arena-cells"></g>
                    <g id="arena-puck" visibility="hidden">
                        <circle r="3.8" fill="#e9ffe3" fill-opacity=".86" stroke="#fff" stroke-width=".5"/>
                        <circle r="2.5" fill="#27351e" fill-opacity=".58" stroke="#fff" stroke-width=".34"/>
                        <path d="M-1.8 0h3.6M0-1.8v3.6" stroke="#fff" stroke-width=".3"/>
                        <g id="arena-aim" fill="none" stroke="#fff" stroke-width=".55">
                            <path d="M4.8 0h5.7m-2-1.5 2 1.5-2 1.5"/>
                        </g>
                        <text id="arena-puck-name" x="0" y="-5.5"></text>
                    </g>
                </g>
            </svg>
        </div>
        <div id="arena-result"></div>
        <div class="arena-roster-heading"><h2>Игроки <small id="arena-count">0</small></h2>
            <span id="arena-round"></span></div>
        <div id="arena-players" class="arena-players"></div>
        <div class="arena-dock">
            <div class="arena-modes">
                <div class="arena-mode-tabs" role="group" aria-label="Тип ставки">
                    <button type="button" data-mode="gifts" aria-label="NFT" onclick="arenaMode('gifts')">${stakingGiftIcon}</button>
                    <button type="button" data-mode="gram" aria-label="GRAM" onclick="arenaMode('gram')">${arenaGramIcon}</button>
                </div>
                <span class="arena-room">Комната 1</span>
            </div>
            <div id="arena-actions" class="arena-actions"></div>
            <button id="arena-cancel" type="button" hidden onclick="arenaCancel()">Вернуть ставку</button>
        </div>
    </section>`;
    arenaRenderControls();
    arenaPoll(arena.view);
    arena.frame = requestAnimationFrame(arenaFrame);
}

function leaveArena() {
    arena.view++;
    clearTimeout(arena.timer);
    cancelAnimationFrame(arena.frame);
}

async function arenaPoll(view) {
    const sent = performance.now();
    try {
        const data = await api('arena');
        if (view === arena.view) arenaApply(data, sent);
    } catch (error) {
        if (view === arena.view) {
            document.querySelector('.arena-page').classList.remove('arena-loading');
            document.querySelector('.arena-page').setAttribute('aria-busy','false');
            document.querySelector('#arena-phase').textContent = error.message;
        }
    } finally {
        if (view === arena.view) arena.timer = setTimeout(() => arenaPoll(view), 850);
    }
}

function arenaApply(data, sent) {
    if (arena.data && data.server_time < arena.data.server_time) return;
    const old = arena.data;
    if (!old) {
        document.querySelector('.arena-page').classList.remove('arena-loading');
        document.querySelector('.arena-page').setAttribute('aria-busy','false');
    }
    arena.data = data;
    arena.serverOrigin = (performance.now() + sent) / 2 - data.server_time;
    state.me.balance = data.balance;
    updateBalance();
    const key = JSON.stringify([data.round_id, data.players]);
    if (key !== arena.boardKey) {
        arena.boardKey = key;
        arenaRenderBoard(data);
        arenaRenderPlayers(data);
    }
    if (!old || old.round_id !== data.round_id || old.phase !== data.phase || old.can_cancel !== data.can_cancel ||
            old.balance !== data.balance) arenaRenderControls();
    if (arena.mode === 'gifts' && (!old || old.round_id !== data.round_id || data.phase === 'result' && old.phase !== 'result')) {
        arenaRefreshGifts(true);
    }
    if (data.last_result?.round_id !== old?.last_result?.round_id || data.phase !== old?.phase) {
        arenaRenderResult(data);
    }
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

function arenaCells(players, seed) {
    const cells = [];
    function split(group, points, depth) {
        if (group.length === 1) {
            const player = group[0];
            const center = {
                x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
                y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
            };
            const radius = Math.min(13, Math.sqrt(arenaArea(points)) * .27, ...points.map((a, i) => {
                const b = points[(i + 1) % points.length];
                return Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) /
                    (Math.hypot(b.x - a.x, b.y - a.y) || 1);
            }));
            cells.push({player, points, center, radius});
            return;
        }
        const mid = Math.ceil(group.length / 2);
        const left = group.slice(0, mid), right = group.slice(mid);
        const weight = list => list.reduce((sum, player) => sum + Number(player.value), 0);
        const wanted = arenaArea(points) * weight(left) / weight(group);
        const angle = (seed % 167) * .013 + depth * 1.37 + cells.length * .43;
        const axis = {x: Math.cos(angle), y: Math.sin(angle)};
        const dots = points.map(p => p.x * axis.x + p.y * axis.y);
        let low = Math.min(...dots), high = Math.max(...dots);
        for (let i = 0; i < 48; i++) {
            const midline = (low + high) / 2;
            if (arenaArea(arenaClip(points, axis, midline, 1)) < wanted) low = midline;
            else high = midline;
        }
        const offset = (low + high) / 2;
        split(left, arenaClip(points, axis, offset, 1), depth + 1);
        split(right, arenaClip(points, axis, offset, -1), depth + 1);
    }
    if (players.length) split(players, [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}], 0);
    return cells;
}

function arenaRenderBoard(data) {
    arena.cells = arenaCells(data.players, data.seed);
    document.querySelector('#arena-colors').innerHTML = arena.cells.map(({player, center, radius}, i) => {
        const [dark, light] = arenaPalette[i % arenaPalette.length];
        return `<linearGradient id="arena-color-${i}" x2="100%" y2="100%"><stop stop-color="${dark}"/>
            <stop offset="1" stop-color="${light}"/></linearGradient>
            <clipPath id="arena-avatar-${i}"><circle cx="${center.x}" cy="${center.y}" r="${radius}"/></clipPath>`;
    }).join('');
    document.querySelector('#arena-cells').innerHTML = arena.cells.map(({player, points, center, radius}, i) => {
        const {x, y} = center;
        const photo = imageURL(player.photo);
        return `<polygon points="${points.map(p => p.x + ',' + p.y).join(' ')}" fill="url(#arena-color-${i})"/>
            <circle cx="${x}" cy="${y}" r="${radius}" fill="#252447" fill-opacity=".58"/>
            ${photo && radius >= 1.2 ? `<image href="${esc(photo)}" x="${x-radius}" y="${y-radius}"
                width="${2*radius}" height="${2*radius}" preserveAspectRatio="xMidYMid slice"
                clip-path="url(#arena-avatar-${i})"/>` : ''}
            <text class="arena-avatar-letters" x="${x}" y="${y}" font-size="${radius*.85}"
                ${photo ? 'visibility="hidden"' : ''}>${esc(arenaBadge(player))}</text>`;
    }).join('') || '<text class="arena-empty-field" x="50" y="50">Ожидаем ставки</text>';
}

function arenaAvatar(player) {
    const photo = imageURL(player.photo);
    return `<span class="arena-avatar">${photo ? `<img src="${esc(photo)}" alt="">` : esc(arenaBadge(player))}</span>`;
}

function arenaRenderPlayers(data) {
    document.querySelector('#arena-bank').textContent = arenaFormat(data.bank) + ' GRAM';
    document.querySelector('#arena-count').textContent = data.players.length;
    document.querySelector('#arena-round').textContent = 'Игра #' + data.round_id;
    document.querySelector('#arena-players').innerHTML = data.players.map((player, i) => {
        const [dark, light] = arenaPalette[i % arenaPalette.length];
        return `<button class="arena-player" type="button" onclick="arenaPlayer(${i})"
            style="--arena-team:${light};--arena-avatar:linear-gradient(150deg,${light},${dark})">
            ${arenaAvatar(player)}<span class="arena-player-info"><b>${esc(player.name)}</b>
            <small>${arenaFormat(player.chance)}% шанс</small></span><strong>${arenaFormat(player.value)} GRAM</strong>
            ${player.gifts.length || Number(player.gram) ? `<span class="arena-player-items">
                ${Number(player.gram) ? `<span class="arena-mini-gram">${arenaGramIcon}<b>${arenaFormat(player.gram)}</b></span>` : ''}
                ${player.gifts.map(gift => `<span style="background:${giftBackdrop(gift)}"><img ${giftPicture(gift)} alt="${esc(gift.name)}"><b>${arenaGiftValue(gift)}</b></span>`).join('')}
                </span>` : ''}
        </button>`;
    }).join('') || '<p class="arena-no-players">Сделайте первую ставку, чтобы открыть раунд.</p>';
}

function arenaRenderResult(data) {
    const result = data.last_result;
    document.querySelector('#arena-result').innerHTML = result ? `<button class="arena-winner ${data.phase === 'result' ? 'current' : ''}"
        type="button" onclick="arenaWinner()">${arenaAvatar(result.winner)}
        <span><b>${esc(result.winner.name)} выиграл</b><small>${arenaFormat(result.value)} GRAM · Награда</small></span>
        <strong>›</strong></button>` : '';
}

function arenaPrizeCards(gram, gifts) {
    return `<div class="arena-prizes">${Number(gram) ? `<div class="arena-gram-prize">
        <img src="/static/assets/gram.svg" alt=""><b>${arenaFormat(gram)} GRAM</b></div>` : ''}
        ${gifts.map((gift, i) => `<button type="button" onclick="arenaGiftInfo(${i})" style="background:${giftBackdrop(gift)}">
            <img ${giftPicture(gift)} alt=""><b>${esc(gift.name)} #${esc(gift.number)}</b>
            <small>${arenaGiftValue(gift)} GRAM</small></button>`).join('')}</div>`;
}

function arenaShowPrizes(title, total, gram, gifts, winner = null) {
    arena.detail = {title, total, gram, gifts, winner};
    const multiplier = winner?.value > 0 ? arenaFormat(Number((total / winner.value).toFixed(2))) : '';
    sheet(title, `<div class="${winner ? 'arena-win-panel' : 'arena-stake-panel'}">
        ${winner ? `<div class="arena-win-avatar">${arenaAvatar(winner)}</div>` : ''}
        <strong class="arena-sheet-total">${arenaFormat(total)} GRAM
            ${multiplier ? `<span>${multiplier}×</span>` : ''}</strong>
        ${arenaPrizeCards(gram, gifts)}
    </div>`);
}

function arenaWinner() {
    const result = arena.data?.last_result;
    if (result) arenaShowPrizes(result.winner.name + ' выиграл', result.value, result.gram, result.gifts, result.winner);
}

function arenaPlayer(index) {
    const player = arena.data?.players[index];
    if (player) arenaShowPrizes('Ставка · ' + player.name, player.value, player.gram, player.gifts);
}

function arenaGiftInfo(index) {
    const gift = arena.detail.gifts[index];
    sheet(gift.name + ' #' + gift.number, `<div class="arena-detail-art" style="background:${giftBackdrop(gift)}">
        <img ${giftPicture(gift)} alt="${esc(gift.name)}"></div>
        ${[['Модель', gift.model], ['Фон', gift.backdrop], ['Узор', gift.symbol?.name || gift.symbol],
            ['Оценка', arenaGiftValue(gift) + ' GRAM']].map(([label, value]) =>
        `<div class="detail-row"><span>${label}</span><b>${esc(value || '—')}</b></div>`).join('')}
        <button class="secondary" type="button" onclick="arenaShowPrizes(arena.detail.title,arena.detail.total,arena.detail.gram,arena.detail.gifts,arena.detail.winner)">Назад</button>`);
}

function arenaPosition(time, angle) {
    const reflect = n => {
        const phase = ((n - 4) % 184 + 184) % 184;
        return 4 + (phase <= 92 ? phase : 184 - phase);
    };
    const distance = time * .14;
    return {x: reflect(50 + Math.cos(angle) * distance), y: reflect(50 + Math.sin(angle) * distance)};
}

function arenaInside(point, points) {
    return points.every((a, i) => {
        const b = points[(i + 1) % points.length];
        return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= -.0001;
    });
}

function arenaFrame(now) {
    const data = arena.data;
    if (data) {
        const serverNow = now - arena.serverOrigin;
        const elapsed = serverNow - data.bet_until;
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
            aim = elapsed < data.aim_ms;
            label = aim ? 'Прицеливание' : '● LIVE';
            const angle = data.seed / 2**32 * Math.PI * 2;
            const travel = Math.max(0, elapsed - data.aim_ms);
            position = arenaPosition(Math.min(travel, data.flight_ms), angle);
            if (aim) position = {x: 50, y: 50};
            document.querySelector('#arena-aim').setAttribute('transform', `rotate(${angle * 180 / Math.PI})`);
            const target = arena.cells.find(cell => cell.player.id === data.target);
            if (target && travel >= data.flight_ms) {
                const start = arenaPosition(data.flight_ms, angle);
                const after = arenaPosition(data.flight_ms + 5, angle);
                const end = target.center;
                const t = Math.min(1, (travel - data.flight_ms) / data.finish_ms);
                const u = 1 - t;
                const control = axis => Math.max(4, Math.min(96, start[axis] + (after[axis] - start[axis]) * 22));
                position = {x: u**3*start.x + 3*u*u*t*control('x') + (3*u*t*t+t**3)*end.x,
                            y: u**3*start.y + 3*u*u*t*control('y') + (3*u*t*t+t**3)*end.y};
                zoom = 1 + t*t*.75;
            }
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

function arenaRenderControls() {
    const root = document.querySelector('#arena-actions');
    const data = arena.data;
    const settings = arenaSettings();
    const open = arenaBetOpen(data) && !arena.pending;
    document.querySelectorAll('.arena-modes [data-mode]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === arena.mode));
    });
    const cancel = document.querySelector('#arena-cancel');
    cancel.hidden = !data?.can_cancel;
    cancel.disabled = !open;
    const cheapest = arena.gifts[0];
    const giftsOpen = open && arenaGiftSlots() > 0;
    root.classList.toggle('arena-gift-actions', arena.mode === 'gifts');
    root.innerHTML = arena.mode === 'gifts' ? `
        <button type="button" class="arena-choose-gifts" ${giftsOpen ? '' : 'disabled'} onclick="arenaGiftPicker()">Выбрать гифты</button>
        <button type="button" class="arena-quick-gift" aria-label="Быстрая ставка подарком"
            ${giftsOpen && cheapest && !arena.giftLoad ? '' : 'disabled'} onclick="arenaQuickGift()">
            <span>Добавить<small>${cheapest ? arenaGiftValue(cheapest) + ' GRAM' : 'Нет гифтов'}</small></span>
            ${cheapest ? `<span class="arena-quick-art" style="background:${giftBackdrop(cheapest)}">
                <img ${giftPicture(cheapest)} alt=""></span>` : ''}</button>` : `
        <button type="button" class="arena-pencil" aria-label="Настроить кнопки" onclick="arenaOpenSettings()">✎</button>
        ${settings.amounts.map(amount => `<button type="button" ${open && Number(data.balance) >= Number(amount) ? '' : 'disabled'}
            onclick="arenaStake(${arg(amount)})">${arenaFormat(amount)} <span>◆</span></button>`).join('')}
        ${settings.all ? `<button type="button" ${open && Number(data.balance) > 0 ? '' : 'disabled'} onclick="arenaAllIn()">Ва-банк</button>` : ''}`;
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
    input.style.setProperty('--amount-length', Math.max(2, value.length));
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
        style="background:${giftBackdrop(gift)}" aria-label="${esc(gift.name)} #${esc(gift.number)}, ${arenaGiftValue(gift)} GRAM"
        onclick="arenaToggleGift(this.dataset.giftId)">
        <img ${giftPicture(gift)} alt="" loading="lazy">
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
    arena.pending = true;
    arenaRenderControls();
    try {
        const data = await api('arena/stake', {round_id: round, request_id: requestId, amount, gift_ids: giftIds, quick_value: quickValue});
        arena.retry = null;
        if (view === arena.view) {
            if (giftIds.length && !quickValue || amount === 'all') closeSheet();
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

async function arenaCancel() {
    if (!arena.data?.can_cancel || arena.pending) return;
    const view = arena.view, sent = performance.now();
    arena.pending = true;
    arenaRenderControls();
    try {
        const data = await api('arena/cancel', {round_id: arena.data.round_id});
        if (view === arena.view) arenaApply(data, sent);
    } catch (error) {
        if (view === arena.view) toast(error.message);
    } finally {
        arena.pending = false;
        if (state.page === 'arena') arenaRenderControls();
    }
}
