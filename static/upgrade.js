/* Crafter Upgrade mode: stake a gift, pick a pricier target, spin the wheel.
   The server rolls and settles; this file only presents the already-decided result. */
(function () {
'use strict';
const RADIUS = 116, CIRC = 2 * Math.PI * RADIUS;
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
        <svg viewBox="0 0 260 260" aria-hidden="true">
            <circle class="upg-track" cx="130" cy="130" r="${RADIUS}"/>
            <circle class="upg-zone" id="upg-zone" cx="130" cy="130" r="${RADIUS}" stroke-dasharray="0 ${CIRC}"/>
        </svg>
        <div class="upg-pointer" id="upg-pointer"><i></i></div>
        <div class="upg-core"><div class="upg-core-gift" id="upg-core-gift"></div><b id="upg-percent"></b><small id="upg-label"></small></div>
    </div>`;
}
const plusIcon = '<svg class="upg-plus" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
function slot(kind) {
    const isStake = kind === 'stake', item = isStake ? ui.stake : ui.target;
    const disabled = !isStake && !ui.stake;
    const body = item
        ? `<img class="upg-thumb" ${centerPicture(item)} alt="" draggable="false"><span class="upg-slot-text"><strong>${h(item.name)}</strong><small>${item.gram ? 'Ставка' : '#' + h(item.number || '')} · ${fmt(item.price)} GRAM</small></span>`
        : `${plusIcon}<strong>${isStake ? 'Выбрать ставку' : 'Выбрать цель'}</strong>`;
    return `<button type="button" class="upg-slot ${item ? 'is-filled' : ''}" data-slot="${kind}" ${disabled || ui.spinning ? 'disabled' : ''}>${body}</button>`;
}
function render() {
    const main = root();
    if (!main) return;
    main.innerHTML = `<section class="upg">${wheel()}
        <div class="upg-slots">${slot('stake')}${slot('target')}</div>
        <button type="button" class="upg-go" id="upg-go" disabled>Апгрейд</button></section>`;
    main.querySelector('[data-slot="stake"]').onclick = openStakeSheet;
    main.querySelector('[data-slot="target"]').onclick = openCollectionSheet;
    main.querySelector('#upg-go').onclick = () => (ui.done ? resetRound() : spin());
    setChance(ui.chance, false);
    placePointer(ui.angle);
    renderCore();
    refreshGo();
}
/* Centre of the wheel: the target gift picture, its chance underneath. */
/* Transparent model PNG first (never cropped by a backdrop), then the usual fallbacks. */
function centerPicture(g) {
    const model = typeof giftAnimationPath === 'function' ? giftAnimationPath(g) : '';
    if (!model) return giftPicture(g, true);
    const rest = [typeof imageURL === 'function' ? imageURL(g.image) : g.image].filter(Boolean);
    return `src="${h(model + '.png')}" data-gift-fallback="${h(JSON.stringify(rest))}" onerror="nextGiftPicture(this)"`;
}
function renderCore() {
    const box = document.querySelector('#upg-core-gift');
    if (!box) return;
    box.innerHTML = ui.target ? `<img ${centerPicture(ui.target)} alt="" draggable="false">` : '<span class="upg-core-empty">?</span>';
    box.classList.toggle('has-gift', Boolean(ui.target));
}
function refreshGo() {
    const go = document.querySelector('#upg-go');
    if (go) go.disabled = ui.done ? false : (!(ui.stake && ui.target && ui.quote) || ui.spinning);
}

/* ---- wheel ---- */
function setChance(percent, animate = true) {
    ui.chance = percent;
    const zone = document.querySelector('#upg-zone'), label = document.querySelector('#upg-percent');
    if (!zone) return;
    const clamped = Math.max(0, Math.min(100, percent));
    const len = clamped / 100 * CIRC;
    // The zone is centred on the bottom point (180°) and grows evenly to both sides.
    zone.style.opacity = len > 0 ? '' : '0';
    zone.style.transition = animate ? 'stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1), transform 1.1s cubic-bezier(.2,.8,.2,1)' : 'none';
    zone.style.transform = `rotate(${90 - clamped * 1.8}deg)`;
    zone.setAttribute('stroke-dasharray', `${len} ${CIRC}`);
    const text = v => (v > 0 ? v.toFixed(2).replace(/\.?0+$/, '') + '%' : '');
    if (!animate || !percent) { label.textContent = text(percent); return; }
    const from = parseFloat(label.textContent) || 0, start = performance.now();
    const step = now => {
        const t = Math.min(1, (now - start) / 1100), e = 1 - Math.pow(1 - t, 3);
        label.textContent = text(from + (percent - from) * e);
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
    // One continuous slide: fast start, long smooth deceleration that stops exactly on the target.
    // The easing curve never leaves 0..1, so the pointer cannot overshoot or swing back.
    const anim = pointer.animate([
        {transform: `rotate(${from}deg)`},
        {transform: `rotate(${target}deg)`},
    ], {duration: 6500, easing: 'cubic-bezier(.08,.62,.12,1)', fill: 'forwards'});
    return anim.finished.then(() => {
        ui.angle = target % 360;
        anim.cancel(); pointer.classList.remove('is-spinning'); placePointer(ui.angle);
    });
}

/* ---- sheets ---- */
function searchBar(placeholder, withSort) {
    return `<div class="upg-tools"><label class="upg-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" placeholder="${h(placeholder)}" autocomplete="off"></label>
        ${withSort ? '<button type="button" class="upg-sort" data-dir="asc" title="Сначала дешёвые" aria-label="Сначала дешёвые">Цена ↑</button>' : ''}</div>`;
}
function bindSearch(body, itemSelector, textOf) {
    body.querySelector('.upg-search input').oninput = e => {
        const q = e.target.value.trim().toLowerCase();
        let shown = 0;
        body.querySelectorAll(itemSelector).forEach(n => { n.hidden = Boolean(q) && !textOf(n).includes(q); if (!n.hidden) shown++; });
        const none = body.querySelector('.upg-none');
        if (none) none.hidden = shown > 0;          // empty state instead of a blank sheet
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
        const info = await api('upgrade/stakes');
        ui.gifts = info.gifts;
        const balance = Number(info.balance || 0), min = Number(info.gram_min || 0.1);
        const body = el.querySelector('.upg-sheet-body');
        const giftsHTML = ui.gifts.length ? `<div class="upg-grid">${ui.gifts.map((g, i) => `<button type="button" class="upg-card" data-i="${i}">
            ${giftArt(g)}<strong>${h(g.name)}</strong><small>#${h(g.number || '')} · ${fmt(g.upgrade_value)} GRAM</small></button>`).join('')}</div>` :
            '<p class="upg-empty">Нет подарков, подходящих для апгрейда.</p>';
        const max = Math.floor(balance * 100) / 100;
        const gramHTML = `<div class="upg-gram">
            <div class="upg-gram-balance"><img src="/static/assets/gram.svg" alt=""><span>Баланс</span><b>${fmt(balance)} GRAM</b></div>
            <label class="upg-gram-field"><img src="/static/assets/gram.svg" alt=""><input id="upg-gram-amount" inputmode="decimal" autocomplete="off" placeholder="0.1" value=""></label>
            <button type="button" class="upg-gram-go" id="upg-gram-go" disabled>Поставить</button></div>`;
        body.innerHTML = `<div class="upg-seg"><button type="button" class="is-on" data-tab="gifts">Подарки</button><button type="button" data-tab="gram">GRAM</button></div>
            <div id="upg-tab-gifts">${giftsHTML}</div><div id="upg-tab-gram" hidden>${gramHTML}</div>`;
        body.querySelectorAll('.upg-seg button').forEach(b => b.addEventListener('click', () => {
            body.querySelectorAll('.upg-seg button').forEach(x => x.classList.toggle('is-on', x === b));
            body.querySelector('#upg-tab-gifts').hidden = b.dataset.tab !== 'gifts';
            body.querySelector('#upg-tab-gram').hidden = b.dataset.tab !== 'gram';
        }));
        const input = body.querySelector('#upg-gram-amount');
        const valid = () => { const v = Number(String(input.value).replace(',', '.')); return Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 100) / 100 : null; };
        const sync = () => { body.querySelector('#upg-gram-go').disabled = valid() === null; input.classList.toggle('is-err', input.value !== '' && valid() === null); };
        input?.addEventListener('input', sync);
        body.querySelector('#upg-gram-go')?.addEventListener('click', () => {
            const v = valid(); if (v === null) return;
            const id = 'gram:' + v.toFixed(2);
            ui.stake = {id, name: 'GRAM', number: '', model: '', image: '/static/assets/gram.svg', gram: true, upgrade_value: v.toFixed(2), price: v.toFixed(2)};
            ui.target = ui.quote = null; ui.collection = null;
            closeSheet(); render(); setChance(0, false); pulseWheel();
        });
        sync();
        body.querySelector('#upg-tab-gifts').onclick = e => {
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
        ui.collections = (await api(`upgrade/collections?stake_id=${encodeURIComponent(ui.stake.id)}`)).collections || [];
        const body = el.querySelector('.upg-sheet-body');
        if (!ui.collections.length) { body.innerHTML = '<p class="upg-empty">Нет доступных коллекций</p>'; return; }
        body.innerHTML = `${searchBar('Поиск коллекции', true)}<p class="upg-empty upg-none" hidden>Ничего не найдено</p><div class="upg-collections">${ui.collections.map((c, i) => `<button type="button" class="upg-collection ${c.crafter ? 'has-crafter' : ''}" data-i="${i}" data-price="${h(c.floor || '')}" data-name="${h(String(c.name).toLowerCase())}">
            ${c.crafter ? `<em class="upg-badge">${c.crafter}</em>` : ''}
            <img src="${h(c.photo_url || '')}" alt="" loading="lazy" draggable="false"><span>${h(c.name)}</span></button>`).join('')}</div>`;
        bindSearch(body, '.upg-collection', node => node.dataset.name);
        // Cheapest first by default; the button flips the order. Collections without a price go last either way.
        const arrange = () => {
            const dir = body.querySelector('.upg-sort')?.dataset.dir === 'desc' ? -1 : 1;
            const grid = body.querySelector('.upg-collections');
            [...grid.children].sort((a, b) => {
                const pa = Number(a.dataset.price) || 0, pb = Number(b.dataset.price) || 0;
                if ((pa > 0) !== (pb > 0)) return pa > 0 ? -1 : 1;
                return dir * (pa - pb) || a.dataset.name.localeCompare(b.dataset.name);
            }).forEach(node => grid.append(node));
        };
        arrange();
        body.querySelector('.upg-sort').onclick = e => {
            const s = e.currentTarget; s.dataset.dir = s.dataset.dir === 'desc' ? 'asc' : 'desc';
            s.textContent = s.dataset.dir === 'desc' ? 'Цена ↓' : 'Цена ↑';
            s.title = s.ariaLabel = s.dataset.dir === 'desc' ? 'Сначала дорогие' : 'Сначала дешёвые';
            arrange();
        };
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
                .sort((a, b) => ((b[0].source === 'crafter') - (a[0].source === 'crafter')) || dir * (Number(a[0].price) - Number(b[0].price)));  // Crafter market first, then by price
            body.querySelector('.upg-grid').innerHTML = rows.length ? rows.map(([g, i]) => `<button type="button" class="upg-card" data-i="${i}">
                ${giftArt(g)}<span class="upg-src">${g.source === 'crafter' ? 'Crafter' : h(String(g.market || 'Portals').charAt(0).toUpperCase() + String(g.market || 'Portals').slice(1).toLowerCase())}</span>
                <strong>${h(g.name)}</strong><small>#${h(g.number || '')} · ${fmt(g.price)} GRAM</small>
                <em>${fmt(g.chance)}%</em></button>`).join('') : '<p class="upg-empty" style="grid-column:1/-1">Ничего не найдено</p>';
        };
        body.innerHTML = `${searchBar('Поиск по модели или номеру', true)}<div class="upg-grid"></div>`;
        draw();
        body.querySelector('.upg-search input').oninput = draw;
        body.querySelector('.upg-sort').onclick = e => {
            const s = e.currentTarget; s.dataset.dir = s.dataset.dir === 'desc' ? 'asc' : 'desc';
            s.textContent = s.dataset.dir === 'desc' ? 'Цена ↓' : 'Цена ↑';
            s.title = s.ariaLabel = s.dataset.dir === 'desc' ? 'Сначала дорогие' : 'Сначала дешёвые'; draw();
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
