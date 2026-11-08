/* Crafter Upgrade mode: stake a gift, pick a pricier target, spin the wheel.
   The server rolls and settles; this file only presents the already-decided result. */
(function () {
'use strict';
const RADIUS = 100, CIRC = 2 * Math.PI * RADIUS;
const ui = {done: false, stake: null, collection: null, target: null, offers: [], quote: null, spinning: false,
            gifts: [], collections: [], chance: 0, angle: 0};

const upgradeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v14"/><path d="m6 9 6-6 6 6"/><path d="M5 21h14"/></svg>';
if (typeof gameNavIcons !== 'undefined') gameNavIcons.upgrade = upgradeIcon;
window.crafterUpgradeIcon = upgradeIcon;

const fmt = n => { const v = Number(n); return Number.isFinite(v) ? v.toLocaleString('ru-RU', {maximumFractionDigits: 2}) : '—'; };
const h = s => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
const root = () => document.querySelector('#main');
const alive = () => state.page === 'upgrade' && root()?.querySelector('.upg');

function giftArt(g) {
    return `<span class="upg-art" style="background:${giftBackdrop(g)}"><img ${giftPicture(g)} alt="" loading="lazy" draggable="false"></span>`;
}
function wheel() {
    return `<div class="upg-wheel" id="upg-wheel">
        <svg viewBox="0 0 240 240" aria-hidden="true">
            <defs><linearGradient id="upg-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fd0ff"/><stop offset="1" stop-color="#2f7bff"/></linearGradient>
                <filter id="upg-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter></defs>
            <circle class="upg-track" cx="120" cy="120" r="${RADIUS}"/>
            <g>
                <circle class="upg-zone-glow" id="upg-zone-glow" cx="120" cy="120" r="${RADIUS}" filter="url(#upg-glow)" stroke-dasharray="0 ${CIRC}"/>
                <circle class="upg-zone" id="upg-zone" cx="120" cy="120" r="${RADIUS}" stroke-dasharray="0 ${CIRC}"/>
            </g>
        </svg>
        <div class="upg-core"><div class="upg-core-gift" id="upg-core-gift"></div><b id="upg-percent">0%</b><small id="upg-label">шанс</small></div>
        <div class="upg-pointer" id="upg-pointer"><i></i></div>
    </div>`;
}
function slot(kind) {
    const isStake = kind === 'stake', item = isStake ? ui.stake : ui.target;
    const disabled = !isStake && !ui.stake;
    const body = item ? `${giftArt(item)}<strong>${h(item.name)}</strong><small>#${h(item.number || '')} · ${fmt(item.price)} GRAM</small>`
        : `<span class="upg-plus">+</span><strong>${isStake ? 'Выбрать ставку' : 'Выбрать цель'}</strong><small>${isStake ? 'Ваш подарок' : 'Подарок дороже ставки'}</small>`;
    return `<button type="button" class="upg-slot ${item ? 'is-filled' : ''}" data-slot="${kind}" ${disabled || ui.spinning ? 'disabled' : ''}>${body}</button>`;
}
function render() {
    const main = root();
    if (!main) return;
    main.innerHTML = `<section class="upg">${wheel()}
        <div class="upg-slots">${slot('stake')}${slot('target')}</div>
        <button type="button" class="upg-go" id="upg-go" disabled>Апгрейд</button>
        <p class="upg-note">Шанс = ценность ставки / цена цели (−5% комиссии). Результат определяет сервер.</p></section>`;
    main.querySelector('[data-slot="stake"]').onclick = openStakeSheet;
    main.querySelector('[data-slot="target"]').onclick = openCollectionSheet;
    main.querySelector('#upg-go').onclick = () => (ui.done ? resetRound() : spin());
    setChance(ui.chance, false);
    placePointer(ui.angle);
    renderCore();
    refreshGo();
}
/* Centre of the wheel: the target gift picture, its chance underneath. */
function renderCore() {
    const box = document.querySelector('#upg-core-gift');
    if (!box) return;
    box.innerHTML = ui.target ? `<img ${giftPicture(ui.target, true)} alt="" draggable="false">` : '<span class="upg-core-empty">?</span>';
    box.classList.toggle('has-gift', Boolean(ui.target));
}
function refreshGo() {
    const go = document.querySelector('#upg-go');
    if (go) go.disabled = ui.done ? false : (!(ui.stake && ui.target && ui.quote) || ui.spinning);
}

/* ---- wheel ---- */
function setChance(percent, animate = true) {
    ui.chance = percent;
    const zone = document.querySelector('#upg-zone'), glow = document.querySelector('#upg-zone-glow'),
          label = document.querySelector('#upg-percent');
    if (!zone) return;
    const len = Math.max(0, Math.min(100, percent)) / 100 * CIRC;
    // The zone is centred on the bottom point (180°) and grows evenly to both sides.
    const turn = 90 - Math.max(0, Math.min(100, percent)) * 1.8;
    for (const el of [zone, glow]) {
        el.style.opacity = len > 0 ? '' : '0';
        el.style.transition = animate ? 'stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1), transform 1.1s cubic-bezier(.2,.8,.2,1)' : 'none';
        el.style.transform = `rotate(${turn}deg)`;
        el.setAttribute('stroke-dasharray', `${len} ${CIRC}`);
    }
    if (!animate) { label.textContent = (percent ? percent.toFixed(2).replace(/\.?0+$/, '') : '0') + '%'; return; }
    const from = parseFloat(label.textContent) || 0, start = performance.now();
    const step = now => {
        const t = Math.min(1, (now - start) / 1100), e = 1 - Math.pow(1 - t, 3);
        label.textContent = (from + (percent - from) * e).toFixed(percent % 1 ? 2 : 0).replace(/\.?0+$/, '') + '%';
        if (t < 1 && document.body.contains(label)) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
function placePointer(deg) {
    const p = document.querySelector('#upg-pointer');
    if (p) p.style.transform = `rotate(${deg}deg)`;
}
/* Zone = 180° ± chance*1.8°, so roll fraction f (0..100) maps to 180° - chance*1.8° + f*3.6°. */
function animateSpin(rollPercent) {
    const pointer = document.querySelector('#upg-pointer');
    const target = 360 * 6 + 180 - ui.chance * 1.8 + rollPercent * 3.6;
    if (!pointer.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        ui.angle = target % 360; placePointer(ui.angle); return Promise.resolve();
    }
    pointer.classList.add('is-spinning');
    const from = ui.angle;
    const anim = pointer.animate([
        {transform: `rotate(${from}deg)`, offset: 0, easing: 'cubic-bezier(.35,.0,.2,1)'},
        {transform: `rotate(${target + 7}deg)`, offset: .86, easing: 'ease-in-out'},
        {transform: `rotate(${target - 3}deg)`, offset: .93, easing: 'ease-in-out'},
        {transform: `rotate(${target}deg)`, offset: 1},
    ], {duration: 6200, fill: 'forwards'});
    return anim.finished.then(() => {
        ui.angle = target % 360;
        anim.cancel(); pointer.classList.remove('is-spinning'); placePointer(ui.angle);
    });
}

/* ---- sheets ---- */
function searchBar(placeholder, withSort) {
    return `<div class="upg-tools"><label class="upg-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" placeholder="${h(placeholder)}" autocomplete="off"></label>
        ${withSort ? '<button type="button" class="upg-sort" data-dir="asc">Сначала дешёвые ↑</button>' : ''}</div>`;
}
function bindSearch(body, itemSelector, textOf) {
    body.querySelector('.upg-search input').oninput = e => {
        const q = e.target.value.trim().toLowerCase();
        body.querySelectorAll(itemSelector).forEach(n => { n.hidden = Boolean(q) && !textOf(n).includes(q); });
    };
}
function sheet(title, content, onClose) {
    closeSheet();
    const el = document.createElement('div');
    el.className = 'upg-sheet'; el.id = 'upg-sheet';
    el.innerHTML = `<div class="upg-sheet-card" role="dialog" aria-modal="true" aria-label="${h(title)}">
        <div class="upg-sheet-head"><h2>${h(title)}</h2><button type="button" class="upg-close" aria-label="Закрыть">×</button></div>
        <div class="upg-sheet-body">${content}</div></div>`;
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('.upg-close')) { closeSheet(); onClose?.(); } });
    document.querySelector('#app').append(el);
    requestAnimationFrame(() => el.classList.add('is-open'));
    return el;
}
function closeSheet() { document.querySelector('#upg-sheet')?.remove(); }

async function openStakeSheet() {
    if (ui.spinning) return;
    const el = sheet('Выберите ставку', '<div class="upg-loading">Загрузка…</div>');
    try {
        ui.gifts = (await api('upgrade/stakes')).gifts;
        const body = el.querySelector('.upg-sheet-body');
        if (!ui.gifts.length) { body.innerHTML = '<p class="upg-empty">Нет подарков, подходящих для апгрейда.</p>'; return; }
        body.innerHTML = `<div class="upg-grid">${ui.gifts.map((g, i) => `<button type="button" class="upg-card" data-i="${i}">
            ${giftArt(g)}<strong>${h(g.name)}</strong><small>#${h(g.number || '')} · ${fmt(g.upgrade_value)} GRAM</small></button>`).join('')}</div>`;
        body.onclick = e => {
            const b = e.target.closest('.upg-card'); if (!b) return;
            const picked = ui.gifts[Number(b.dataset.i)];
            ui.stake = {...picked, price: picked.upgrade_value}; ui.target = ui.quote = null; ui.collection = null;
            closeSheet(); render(); setChance(0, false); pulseWheel();
        };
    } catch (error) { el.querySelector('.upg-sheet-body').innerHTML = `<p class="upg-empty">${h(error.message)}</p>`; }
}
function pulseWheel() {
    const w = document.querySelector('#upg-wheel'); if (!w) return;
    w.classList.remove('is-armed'); void w.offsetWidth; w.classList.add('is-armed');
}
async function openCollectionSheet() {
    if (ui.spinning || !ui.stake) return;
    const el = sheet('Выберите коллекцию', '<div class="upg-loading">Загрузка…</div>');
    try {
        if (!ui.collections.length) ui.collections = (await api('craft/targets')).collections || [];
        const body = el.querySelector('.upg-sheet-body');
        body.innerHTML = `${searchBar('Поиск коллекции')}<div class="upg-collections">${ui.collections.map((c, i) => `<button type="button" class="upg-collection" data-i="${i}" data-name="${h(String(c.name).toLowerCase())}">
            <img src="${h(c.photo_url || '')}" alt="" loading="lazy" draggable="false"><span>${h(c.name)}</span></button>`).join('')}</div>`;
        bindSearch(body, '.upg-collection', node => node.dataset.name);
        body.onclick = e => {
            const b = e.target.closest('.upg-collection'); if (!b) return;
            openOffers(ui.collections[Number(b.dataset.i)]);
        };
    } catch (error) { el.querySelector('.upg-sheet-body').innerHTML = `<p class="upg-empty">${h(error.message)}</p>`; }
}
async function openOffers(collection) {
    const el = sheet(collection.name, '<div class="upg-loading">Ищем предложения…</div>', openCollectionSheet);
    try {
        const data = await api(`upgrade/targets?stake_id=${encodeURIComponent(ui.stake.id)}&collection_id=${encodeURIComponent(collection.id)}`);
        ui.offers = data.gifts;
        const body = el.querySelector('.upg-sheet-body');
        if (!ui.offers.length) { body.innerHTML = '<p class="upg-empty">Нет подходящих подарков этой коллекции для вашей ставки.</p>'; return; }
        const draw = () => {
            const q = (body.querySelector('.upg-search input')?.value || '').trim().toLowerCase();
            const dir = body.querySelector('.upg-sort')?.dataset.dir === 'desc' ? -1 : 1;
            const rows = ui.offers.map((g, i) => [g, i]).filter(([g]) =>
                !q || `${g.name} ${g.model} ${g.backdrop} ${g.symbol} ${g.number}`.toLowerCase().includes(q))
                .sort((a, b) => dir * (Number(a[0].price) - Number(b[0].price)));
            body.querySelector('.upg-grid').innerHTML = rows.length ? rows.map(([g, i]) => `<button type="button" class="upg-card" data-i="${i}">
                ${giftArt(g)}<span class="upg-src">${g.source === 'portals' ? 'Portals' : 'Crafter'}</span>
                <strong>${h(g.name)}</strong><small>#${h(g.number || '')} · ${fmt(g.price)} GRAM</small>
                <em>${fmt(g.chance)}%</em></button>`).join('') : '<p class="upg-empty" style="grid-column:1/-1">Ничего не найдено</p>';
        };
        body.innerHTML = `${searchBar('Поиск по модели или номеру', true)}<div class="upg-grid"></div>`;
        draw();
        body.querySelector('.upg-search input').oninput = draw;
        body.querySelector('.upg-sort').onclick = e => {
            const s = e.currentTarget; s.dataset.dir = s.dataset.dir === 'desc' ? 'asc' : 'desc';
            s.textContent = s.dataset.dir === 'desc' ? 'Сначала дорогие ↓' : 'Сначала дешёвые ↑'; draw();
        };
        body.onclick = async e => {
            const b = e.target.closest('.upg-card'); if (!b) return;
            const offer = ui.offers[Number(b.dataset.i)];
            b.disabled = true;
            try {
                const quote = await api('upgrade/quote', {stake_id: ui.stake.id, collection_id: collection.id, listing_id: offer.id});
                ui.collection = collection; ui.target = offer; ui.quote = quote;
                closeSheet(); render(); setChance(Number(quote.chance), true); pulseWheel(); refreshGo();
            } catch (error) { b.disabled = false; toast(error.message); }
        };
    } catch (error) { el.querySelector('.upg-sheet-body').innerHTML = `<p class="upg-empty">${h(error.message)}</p>`; }
}

/* ---- spin ---- */
function newRequestId() {
    return globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}
async function spin() {
    if (ui.spinning || !ui.quote) return;
    ui.spinning = true; state.crafting = true;
    document.querySelectorAll('.upg-slot').forEach(b => b.disabled = true); refreshGo();
    const go = document.querySelector('#upg-go'); go.classList.add('is-busy'); go.textContent = 'Крутим…';
    let result;
    try {
        result = await api('upgrade', {quote_id: ui.quote.quote_id, request_id: newRequestId()});
    } catch (error) {
        ui.spinning = false; state.crafting = false; toast(error.message);
        if (alive()) { ui.quote = null; ui.target = null; render(); setChance(0, false); }
        return;
    }
    await animateSpin(Number(result.roll));
    ui.spinning = false; state.crafting = false;
    if (typeof refreshMe === 'function') refreshMe().catch(() => {});
    showResult(result);
}
/* The result is shown on the wheel itself: red + "Проигрыш", or green + a gently moving gift. */
function showResult(result) {
    const wheelEl = document.querySelector('#upg-wheel'), label = document.querySelector('#upg-label');
    if (!wheelEl) return;
    ui.done = true;
    wheelEl.classList.add(result.success ? 'is-win' : 'is-lose');
    if (label) label.textContent = result.success ? 'Победа' : 'Проигрыш';
    const go = document.querySelector('#upg-go');
    if (go) { go.classList.remove('is-busy'); go.textContent = 'Ещё раз'; go.disabled = false; }
}
function resetRound() {
    ui.done = false; ui.stake = ui.target = ui.quote = ui.collection = null; ui.chance = 0;
    if (alive()) { render(); setChance(0, false); }
}

/* ---- navigation ---- */
const goBefore = go;
go = async function (page, ...rest) {
    const app = document.querySelector('#app');
    app?.classList.toggle('upgrade-view', page === 'upgrade');
    if (page !== 'upgrade') { closeSheet(); return goBefore.call(this, page, ...rest); }
    if (state.crafting) return;
    if (state.page === 'arena' && typeof leaveArena === 'function') leaveArena();
    state.gamesMode = true; state.page = 'upgrade';
    app?.classList.remove('craft-view', 'cart-view');
    app?.classList.add('games-view');
    document.querySelector('#cart-float')?.remove();
    if (typeof nav === 'function') nav();
    if (typeof updateBalance === 'function') updateBalance();
    ui.done = false; ui.stake = ui.target = ui.quote = ui.collection = null; ui.chance = 0; ui.angle = 0;
    render();
    if (typeof crafterLoading === 'function') loadHint();
};
function loadHint() { /* screen renders instantly; inventory loads when the sheet opens */ }
})();
