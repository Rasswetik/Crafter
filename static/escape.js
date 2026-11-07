/* Escape: Crafter's independent, concurrent ball-and-shard arcade mode. */
const escapeGame = {
    view: 0, info: null, difficulty: 'light', stake: '5',
    pending: false, pendingId: '', pendingKey: '',
    active: new Map(), latestRefresh: 0, lastResult: null,
    liveMessage: '', motionReduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches
};
const escapeShards = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 1 29 14 18 31 3 18 16 1Z" fill="#5bd4fc" fill-opacity=".3" stroke="#9ee9ff" stroke-width="2"/><path d="m16 1 2 30L3 18l26-4L16 1Z" stroke="#e9fdff" stroke-opacity=".7"/></svg>';
function escapeMoney(value) {
    const x = Number(value);
    return Number.isFinite(x) ? money(x) : '0';
}
function escapeConfig(mode) {
    const configs = escapeGame.info?.difficulties || {};
    return configs[mode] || {step:'0.20x',first_sector:94,min_shards:6,max_shards:10};
}
function escapeLocalePlayer(value) {
    return String(value || 'Игрок').trim().slice(0,32);
}
function escapeUpdateHeader() {
    const element = document.querySelector('#app.escape-view > header .balance b');
    if (element && escapeGame.info)
        element.textContent = escapeMoney(escapeGame.info.balance) + ' TEST GRAM';
}
function escapeBestCard(label, result, icon) {
    const heading = '<span class="escape-record-heading"><span class="escape-record-icon">' + icon +
        '</span>' + label + '</span>';
    return '<div class="escape-record-card">' + heading +
        (result ? '<strong>' + escapeMoney(result.payout) + '<small> TEST GRAM</small></strong>' +
        '<span class="escape-record-meta">' + esc(escapeLocalePlayer(result.player)) +
        ' · ' + esc(result.multiplier) + '</span>' :
        '<strong>—</strong><span class="escape-record-meta">Пока нет побед</span>') + '</div>';
}
function escapeModes() {
    return ['light','mid','epic'].map(mode =>
        '<button type="button" class="escape-mode-' + mode +
        (escapeGame.difficulty === mode ? ' selected' : '') +
        '" onclick="escapeSetMode(' + arg(mode) + ')" aria-pressed="' +
        (escapeGame.difficulty === mode) + '">' + mode[0].toUpperCase() +
        mode.slice(1) + '</button>').join('');
}
function escapePage() {
    const config = escapeConfig(escapeGame.difficulty);
    return '<section class="escape-screen" aria-label="Escape">' +
        '<div class="escape-records" id="escape-records">' +
        escapeBestCard('Лучшая игра недели', escapeGame.info?.best_week, '♛') +
        escapeBestCard('Лучшая игра дня', escapeGame.info?.best_day, '✧') + '</div>' +
        '<div class="escape-shard-info"><span class="escape-shard-icon">' + escapeShards +
        '</span><div class="escape-shard-copy"><strong>Осколки</strong>' +
        '<span id="escape-shard-bonus">За каждый: +' + esc(config.step) + '</span></div>' +
        '<div class="escape-shard-count"><span id="escape-shard-live">0</span><small>СОБРАНО</small></div>' +
        '<button type="button" class="escape-shard-rules" onclick="escapeRules()" aria-label="Информация об Escape">i</button></div>' +
        '<div class="escape-wheel-wrap"><div class="escape-wheel-caption"><span>ESCAPE</span>' +
        '<span id="escape-wheel-status">Ищи выход</span></div>' +
        '<div class="escape-wheel" id="escape-wheel">' +
        '<div class="escape-wheel-halo"></div>' +
        '<div class="escape-wheel-rotor" id="escape-wheel-rotor" style="--escape-sector:' +
        Number(config.first_sector) * 3.6 + 'deg">' +
        '<div class="escape-wheel-arc"></div><div class="escape-wheel-center">' +
        '<div class="escape-wheel-center-art">✧</div></div></div>' +
        '<span class="escape-wheel-pointer" aria-hidden="true"></span>' +
        '<div class="escape-wheel-exit" aria-label="Выход"><i></i><span>ESCAPE</span></div>' +
        '<div class="escape-ball-layer" id="escape-ball-layer"></div>' +
        '<div class="escape-shard-ring" aria-hidden="true">' +
        Array.from({length:9},(_,i) => '<i style="--piece:' + i + '">' + escapeShards + '</i>').join('') +
        '</div></div>' +
        '<div class="escape-wheel-legend"><span><i class="escape-legend-win"></i> Успех</span>' +
        '<span><i class="escape-legend-lose"></i> Проигрыш</span>' +
        '<span class="escape-running" id="escape-running">Шаров: 0</span></div>' +
        '</div>' +
        '<section class="escape-controls"><div class="escape-section-title">' +
        '<span>Ставка</span><span class="escape-test-label">TEST GRAM</span></div>' +
        '<div class="escape-stake-entry"><input id="escape-stake-input" type="text"' +
        ' inputmode="decimal" autocomplete="off" aria-label="Ставка в тестовых GRAM"' +
        ' oninput="escapeSetStake(this.value)" value="' + esc(escapeGame.stake) + '"' +
        ' placeholder="0.00"><span>GRAM</span></div>' +
        '<div class="escape-section-title escape-difficulty-title"><span>Сложность</span>' +
        '<small id="escape-difficulty-hint">' + esc(config.step) + ' / осколок</small></div>' +
        '<div class="escape-modes" role="group" aria-label="Сложность Escape">' +
        escapeModes() + '</div>' +
        '<div class="escape-quick" role="group" aria-label="Быстрая ставка">' +
        ['1','5','10','25','50','MAX'].map(x =>
            '<button type="button" onclick="escapeQuickStake(' + arg(x) + ')">' + x + '</button>'
        ).join('') + '</div>' +
        '<button id="escape-confirm" class="escape-confirm" onclick="escapePlay()" type="button">' +
        '<span>Подтвердить игру</span><b>↗</b></button>' +
        '<p class="escape-hint" id="escape-hint">Тестовая игра: реальные GRAM и NFT не списываются.</p>' +
        '</section>' +
        '<div id="escape-feedback" class="escape-feedback" aria-live="polite"></div>' +
        '<section class="escape-history"><h3>Последние игры</h3>' +
        '<div id="escape-history-items" class="escape-history-items"></div></section>' +
        '</section>';
}
async function enterEscape(main) {
    escapeGame.view++;
    const view = escapeGame.view;
    escapeGame.info = null;
    escapeGame.active.clear();
    escapeGame.pending = false;
    escapeGame.liveMessage = '';
    main.innerHTML = crafterLoading('escape');
    document.querySelector('#app')?.classList.add('escape-view');
    try {
        const data = await api('escape/state');
        if (view !== escapeGame.view || state.page !== 'escape') return;
        escapeGame.info = data;
        main.innerHTML = escapePage();
        escapeUpdateHeader();
        escapeRenderRecordCards();
        escapeRenderRecent();
        escapeUpdateControls();
    } catch (error) {
        if (view !== escapeGame.view || state.page !== 'escape') return;
        main.innerHTML = '<div class="escape-load-error"><p>' + esc(error.message) +
            '</p><button type="button" onclick="go(\'escape\')">Повторить</button></div>';
    }
}
function leaveEscape() {
    escapeGame.view++;
    escapeGame.active.forEach(entry => {
        entry.element?.getAnimations().forEach(animation => animation.cancel());
        entry.element?.remove();
    });
    escapeGame.active.clear();
    document.querySelector('#app')?.classList.remove('escape-view');
    escapeGame.latestRefresh++;
}
function escapeRenderRecordCards() {
    const target = document.getElementById('escape-records');
    if (!target || !escapeGame.info) return;
    target.innerHTML = escapeBestCard('Лучшая игра недели', escapeGame.info.best_week, '♛') +
        escapeBestCard('Лучшая игра дня', escapeGame.info.best_day, '✧');
}
function escapeRenderRecent() {
    const target = document.getElementById('escape-history-items');
    if (!target) return;
    const list = escapeGame.info?.recent || [];
    target.innerHTML = list.length ? list.slice(0,6).map(item =>
        '<div class="escape-history-row"><span class="escape-history-result ' +
        (item.success ? 'win' : 'lose') + '">' + (item.success ? 'Победа' : 'Поражение') +
        '</span><span>' + esc(item.difficulty.toUpperCase()) +
        ' · ' + esc(item.shards) + ' оск.</span><strong>' +
        (item.success ? '+' + escapeMoney(item.payout) : '0') + ' TEST GRAM</strong></div>'
    ).join('') : '<p class="escape-history-empty">Первая игра уже близко.</p>';
}
function escapeSetMode(mode) {
    if (!['light','mid','epic'].includes(mode)) return;
    escapeGame.difficulty = mode;
    escapeGame.pendingId = '';
    escapeGame.pendingKey = '';
    document.querySelectorAll('.escape-modes button').forEach(b =>
        b.classList.toggle('selected', b.classList.contains('escape-mode-' + mode)));
    const config = escapeConfig(mode);
    const label = document.getElementById('escape-shard-bonus');
    const help = document.getElementById('escape-difficulty-hint');
    if (label) label.textContent = 'За каждый: +' + config.step;
    if (help) help.textContent = config.step + ' / осколок';
    if (!escapeGame.active.size) escapeSetSector(config.first_sector);
    escapeUpdateControls();
}
function escapeSetStake(value) {
    escapeGame.stake = String(value ?? '');
    escapeGame.pendingId = '';
    escapeGame.pendingKey = '';
    escapeUpdateControls();
}
function escapeQuickStake(value) {
    escapeGame.stake = value === 'MAX' ?
        escapeMoney(Math.min(500,Number(escapeGame.info?.balance || 0))) : value;
    const input = document.getElementById('escape-stake-input');
    if (input) input.value = escapeGame.stake;
    escapeGame.pendingId = '';
    escapeGame.pendingKey = '';
    escapeUpdateControls();
}
function escapeStakeValid() {
    if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(escapeGame.stake)) return false;
    const stake = Number(escapeGame.stake);
    return stake >= .1 && stake <= 500 && stake <= Number(escapeGame.info?.balance || 0);
}
function escapeUpdateControls() {
    const button = document.getElementById('escape-confirm');
    const hint = document.getElementById('escape-hint');
    if (button) {
        button.disabled = escapeGame.pending || !escapeStakeValid();
        button.classList.toggle('is-ready', escapeStakeValid() && !escapeGame.pending);
    }
    if (hint) hint.textContent = Number(escapeGame.info?.balance || 0) < .1 ?
        'Тестовый баланс закончился. Можно восстановить его для дальнейших проверок.' :
        !escapeStakeValid() ? 'Ставка от 0,10 до 500 тестовых GRAM в пределах баланса.' :
        'Тестовая игра · реальные GRAM, подарки и Portals не затрагиваются.';
    if (hint && Number(escapeGame.info?.balance || 0) < .1) {
        hint.innerHTML = 'Тестовый баланс закончился. ' +
            '<button type="button" onclick="escapeResetBalance()">Восстановить</button>';
    }
}
function escapeSetSector(percent) {
    const rotor = document.getElementById('escape-wheel-rotor');
    if (rotor) rotor.style.setProperty('--escape-sector',
        Math.max(0,Math.min(100,Number(percent))) * 3.6 + 'deg');
}
function escapeUpdateLive() {
    const count = escapeGame.active.size;
    const rotor = document.getElementById('escape-wheel-rotor');
    const live = document.getElementById('escape-running');
    const headline = document.getElementById('escape-wheel-status');
    const shard = document.getElementById('escape-shard-live');
    if (rotor) {
        rotor.classList.toggle('is-spinning', count > 0);
        const maxShard = Math.max(0,...Array.from(escapeGame.active.values(),r=>r.shards));
        const speed = Math.max(.38, 2.8 - maxShard * .26);
        rotor.style.setProperty('--escape-spin-time', speed + 's');
        const reference = Array.from(escapeGame.active.values()).at(-1);
        if (reference && reference.sector != null) escapeSetSector(reference.sector);
        else escapeSetSector(escapeConfig(escapeGame.difficulty).first_sector);
        if (shard) shard.textContent = String(maxShard);
    }
    if (live) live.textContent = 'Шаров: ' + count;
    if (headline) headline.textContent = count ? 'Собираем осколки' : 'Ищи выход';
}
function escapeNewId() {
    return 'escape-' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'') :
        String(Date.now()) + '-' + Math.random().toString(36).slice(2));
}
async function escapePlay() {
    if (escapeGame.pending || !escapeStakeValid() || state.page !== 'escape') return;
    const view = escapeGame.view;
    const mode = escapeGame.difficulty;
    const stake = escapeGame.stake;
    const key = mode + ':' + stake;
    if (!escapeGame.pendingId || escapeGame.pendingKey !== key) {
        escapeGame.pendingId = escapeNewId();
        escapeGame.pendingKey = key;
    }
    escapeGame.pending = true;
    escapeUpdateControls();
    try {
        const result = await api('escape/play', {
            difficulty: mode, stake, request_id: escapeGame.pendingId
        });
        if (view !== escapeGame.view || state.page !== 'escape') return;
        escapeGame.pendingId = '';
        escapeGame.pendingKey = '';
        escapeGame.info.balance = result.balance;
        escapeUpdateHeader();
        // Do not wait for previous animation: every click creates a separate ball.
        escapeAnimateRound(result, view);
        escapeRefresh();
    } catch (error) {
        if (view !== escapeGame.view) return;
        escapeMessage(error.message || 'Ошибка запуска Escape');
        // Retain idempotency key on uncertain network errors: a retry cannot debit twice.
    } finally {
        if (view === escapeGame.view) {
            escapeGame.pending = false;
            escapeUpdateControls();
        }
    }
}
async function escapeResetBalance() {
    const view = escapeGame.view;
    try {
        await api('escape/test-balance/reset', {});
        if (view === escapeGame.view) await escapeRefresh();
    } catch (error) {escapeMessage(error.message);}
}
async function escapeRefresh() {
    const view = escapeGame.view, ticket = ++escapeGame.latestRefresh;
    try {
        const latest = await api('escape/state');
        if (view !== escapeGame.view || state.page !== 'escape' ||
            ticket !== escapeGame.latestRefresh) return;
        escapeGame.info = latest;
        escapeUpdateHeader();
        escapeRenderRecordCards();
        escapeRenderRecent();
        escapeUpdateControls();
    } catch (error) {
        if (view === escapeGame.view) escapeMessage(error.message);
    }
}
function escapeMessage(text, isWin = false) {
    const element = document.getElementById('escape-feedback');
    if (!element) return;
    const item = document.createElement('div');
    item.className = 'escape-flash' + (isWin ? ' win' : '');
    item.textContent = text;
    element.prepend(item);
    while (element.children.length > 3) element.lastChild.remove();
    setTimeout(() => item.remove(), 6500);
}
function escapeNewBall(result) {
    const layer = document.getElementById('escape-ball-layer');
    if (!layer) return null;
    const id = String(result.id);
    const ball = document.createElement('div');
    const variant = result.difficulty;
    ball.className = 'escape-ball escape-ball-' + variant;
    ball.dataset.roundId = id;
    ball.innerHTML = '<span class="escape-ball-label">0x</span>' +
        '<span class="escape-ball-core"><i></i></span>';
    layer.appendChild(ball);
    return ball;
}
function escapeBurst(position, positive) {
    const layer = document.getElementById('escape-ball-layer');
    if (!layer) return;
    const effect = document.createElement('div');
    effect.className = 'escape-impact' + (positive ? '' : ' is-danger');
    effect.style.left = 'calc(50% + ' + position.x + 'px)';
    effect.style.top = 'calc(50% + ' + position.y + 'px)';
    effect.innerHTML = escapeShards;
    layer.appendChild(effect);
    setTimeout(() => effect.remove(), 530);
}
function escapeAnimateBall(element, start, stop, duration) {
    if (!element?.isConnected) return Promise.resolve();
    const coords = p => 'translate(calc(-50% + ' + p.x + 'px), calc(-50% + ' + p.y + 'px)) scale(' + (p.scale || 1) + ')';
    const animation = element.animate([
        {transform:coords(start),offset:0},
        {transform:coords({x:(start.x+stop.x)/2,y:(start.y+stop.y)/2-22,scale:.94}),offset:.55},
        {transform:coords(stop),offset:1},
    ],{duration,easing:'cubic-bezier(.35,.05,.58,.98)',fill:'forwards'});
    return animation.finished.catch(() => {});
}
async function escapeAnimateRound(result, view) {
    const element = escapeNewBall(result);
    if (!element) return;
    const track = {
        id:result.id, shards:0, sector:escapeConfig(result.difficulty).first_sector,
        element, steps:result.steps, end:false, position:{x:0,y:0}
    };
    escapeGame.active.set(result.id,track);
    escapeUpdateLive();
    const label = element.querySelector('.escape-ball-label');
    const reduced = escapeGame.motionReduced;
    for (const step of result.steps) {
        if (view !== escapeGame.view || state.page !== 'escape') break;
        track.shards = step.shard;
        track.sector = Number(step.sector_bps) / 100;
        escapeUpdateLive();
        const angle = (step.shard * 137.5 + escapeGame.active.size * 43) * Math.PI / 180;
        const point = {x:Math.round(Math.cos(angle)*65),y:Math.round(Math.sin(angle)*64)};
        const duration = reduced ? 55 : Math.max(160,650 - step.shard * 48);
        await escapeAnimateBall(element,track.position,point,duration);
        if (view !== escapeGame.view || state.page !== 'escape') break;
        track.position = point;
        if (label) label.textContent = step.multiplier;
        escapeBurst(point,Boolean(step.safe));
        await new Promise(resolve=>setTimeout(resolve,reduced?10:Math.max(70,220-step.shard*12)));
    }
    if (view === escapeGame.view && state.page === 'escape') {
        const exit = result.success ? {x:164,y:-13} : {x:2,y:165};
        element.classList.add(result.success?'is-winning':'is-losing');
        await escapeAnimateBall(element,track.position,exit,reduced?75:620);
        if (view === escapeGame.view) {
            escapeMessage(result.success ?
                '+' + escapeMoney(result.payout) + ' TEST GRAM · ' + result.multiplier + ' · Escape!' :
                'Проигрыш · ' + result.multiplier + ' · ' + result.shards + ' осколков',
                Boolean(result.success));
        }
    }
    element.remove();
    escapeGame.active.delete(result.id);
    if (view === escapeGame.view && state.page === 'escape') {
        escapeUpdateLive();
        escapeRefresh();
    }
}
function escapeRules() {
    sheet('Escape · осколки', '<div class="escape-rules">' +
        '<p>Выберите Light, Mid или Epic и тестовую ставку GRAM. Затем подтвердите игру.' +
        ' Шар появляется с множителем 0x. За каждый собранный осколок коэффициент увеличивается.</p>' +
        '<p>Колесо ускоряется, а голубая зона выживания сужается. Если шар выдержит все осколки,' +
        ' он вылетит через правый выход: ставка умножится на достигнутый коэффициент.' +
        ' При поражении виртуальная ставка сгорает.</p>' +
        '<p>Исход и последовательность осколков определяются на сервере до начала анимации.' +
        ' Одновременно разрешено несколько шаров. Суммы и рекорды — только тестовые:' +
        ' настоящие GRAM, NFT и Portals не используются.</p></div>');
}
