/* Card packs: market tiles, the opening animation (cut the pack, cards fly out and flip one by one)
   and the administrator editor. Server state lives in /api/packs. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img src="/static/assets/new-year-ornament.svg" alt="" aria-hidden="true">';
const GEM = '<img class="pk-gram" src="/static/assets/gram.svg" alt="GRAM">';
const FLAKE = '<svg viewBox="-50 -50 100 100" aria-hidden="true"><g stroke="currentColor" stroke-width="3.2" stroke-linecap="round" fill="none">' +
    [0, 60, 120, 180, 240, 300].map(a => '<g transform="rotate(' + a + ')"><path d="M0 0V-40"/><path d="M0-16-9-26M0-16 9-26"/><path d="M0-28-6-34M0-28 6-34"/></g>').join('') + '</g></svg>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let playing = false;

/* ---------- contents and chances ---------- */
const pct = v => { const n = Number(v); return (n >= 10 ? n.toFixed(1) : n >= 0.1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n > 0 ? n.toFixed(4) : '0').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + '%'; };
const CUBE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z" fill="none" stroke="#4fd37a" stroke-width="2" stroke-linejoin="round"/><path d="M3.5 7 12 11.8 20.5 7M12 11.8v9.7" fill="none" stroke="#4fd37a" stroke-width="2" stroke-linejoin="round"/></svg>';
const gem = n => '<span class="pk-amt">' + GEM + '<b>' + num(n) + '</b></span>';
async function contentsGrid(pid) {
    const c = await api('packs/' + encodeURIComponent(pid) + '/contents');
    const tier = ch => ch < 3 ? 't3' : ch < 10 ? 't2' : 't1';
    return '<div class="pk-info show-chances"><div class="pk-prizes2">' + c.prizes.map(p => p.kind === 'NFT'
        ? '<div class="pk-pc ' + tier(p.chance) + '"><i class="pk-ch">' + pct(p.chance) + '</i><img src="' + e(p.image) + '" alt=""><b>' + e(p.model || p.name) + '</b>' + (p.model ? '<small>' + e(p.name) + '</small>' : '') + gem(p.value) + '</div>'
        : '<div class="pk-pc is-bal ' + tier(p.chance) + '"><i class="pk-ch">' + pct(p.chance) + '</i><span class="pk-bal">' + GEM + '</span><b>Баланс GRAM</b>' + gem(p.amount) + '</div>').join('') + '</div></div>';
}
/* Where a pack's contents are needed, a "What is inside?" button opens this window. */
async function contentsHtml(pid) {
    return '<button type="button" class="secondary pk-inside-btn" data-pk-inside="' + e(pid) + '">Что внутри?</button>';
}
const contentsCache = new Map();
let insideBusy = false;
async function openInside(pid) {
    if (!pid || insideBusy) return;
    insideBusy = true;
    setTimeout(() => { insideBusy = false; }, 500);          // a double tap never opens two windows
    let html = '';
    try {
        if (!contentsCache.has(pid)) contentsCache.set(pid, contentsGrid(pid));
        html = await contentsCache.get(pid);
    } catch (err) { contentsCache.delete(pid); toast(err.message); return; }
    document.querySelectorAll('dialog.pk-win').forEach(d => d.remove());
    // Same window as "choose a stake" in upgrades: a card at the bottom on phones, centred on desktop.
    // It is its own modal dialog, so it sits above the gift sheet and is removed completely on close.
    const win = document.createElement('dialog');
    win.className = 'pk-win';
    win.innerHTML = '<div class="pk-win-card" role="document"><div class="pk-win-head"><h2>' + CUBE + ' Что внутри?</h2><button type="button" class="pk-win-x" aria-label="Закрыть">×</button></div>' +
        '<div class="pk-win-body">' + html + '</div></div>';
    const close = () => { win.classList.remove('is-open'); setTimeout(() => { try { win.close(); } catch (_) {} win.remove(); }, 200); };
    win.addEventListener('click', ev => { if (ev.target === win || ev.target.closest('.pk-win-x')) close(); });
    win.addEventListener('cancel', ev => { ev.preventDefault(); close(); });
    document.body.appendChild(win);
    win.showModal();
    requestAnimationFrame(() => win.classList.add('is-open'));
}
window.openPackContents = function (id) {
    const g = [...(state?.inventory || []), ...(state?.gifts || []), state?.detailGift].find(x => x && x.id === id && x.pack_id) || (state?.detailGift?.pack_id ? state.detailGift : null);
    if (g) openInside(g.pack_id);
    else toast('Содержимое этого пака недоступно');
};
window.crafterPackWarm = pid => { if (pid && !contentsCache.has(pid)) contentsCache.set(pid, contentsGrid(pid).catch(() => { contentsCache.delete(pid); return ''; })); };
document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-pk-inside]');
    if (b) { ev.preventDefault(); openInside(b.dataset.pkInside); }
});
function bindContents(root) {
    const btn = root?.querySelector('.pk-toggle');
    btn?.addEventListener('click', () => {
        const on = root.querySelector('.pk-info').classList.toggle('show-chances');
        btn.textContent = on ? 'Скрыть шансы' : 'Показать шансы';
    });
}
/* A sheet with the pack picture, its contents and chances and one action button. */
function packSheet(pack, label, go) {
    sheet(pack.title, '<div class="pk-sheet-head"><img src="' + e(pack.image) + '" alt=""></div><div id="pk-contents"><p class="cm-sheet-note">Загрузка…</p></div>' +
        '<button type="button" class="ny-action" id="pk-go">' + e(label) + '</button><p class="purchase-error pk-err" role="alert"></p>');
    const body = document.querySelector('#sheet-body');
    contentsHtml(pack.id).then(h => { const x = body?.querySelector('#pk-contents'); if (x) { x.innerHTML = h || ''; bindContents(x); } });
    const btn = body.querySelector('#pk-go');
    btn.addEventListener('click', async () => { btn.disabled = true; try { await go(body); } catch (err) { body.querySelector('.pk-err').textContent = err.message; btn.disabled = false; } });
}

/* ---------- market tiles ---------- */
function tiles(state) {
    const out = [];
    for (const p of state.shop) out.push('<button type="button" class="ny-lot cm-tile pk-tile" data-pk-buy="' + e(p.id) + '"><div class="ny-lot-art"><img src="' + e(p.image) + '" alt=""></div>' +
        '<div class="ny-lot-name">Pack ' + e(p.title) + '</div><div class="ny-lot-id">Пак</div><div class="ny-lot-price">' + (p.price_balls ? ORN + num(p.price_balls) : 'Бесплатно') + '</div></button>');
    return out;
}
function bind(main, state, refresh) {
    main.querySelectorAll('[data-pk-buy]').forEach(b => b.addEventListener('click', () => buySheet(state.shop.find(p => p.id === b.dataset.pkBuy), refresh)));
}
function buySheet(p, refresh) {
    if (!p) return;
    packSheet(p, p.price_balls ? 'Купить за ' + num(p.price_balls) + ' шаров' : 'Получить бесплатно', async () => {
        const r = await api('packs/buy', {pack_id: p.id, request_id: 'pk-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2))});
        if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(r.balance);
        closeSheet();
        await granted(r.user_pack_id, refresh);
    });
}

/* ---------- a pack reaches the inventory ---------- */
async function packInfo(upid) {
    try { return ((await api('packs')).mine || []).find(m => m.id === upid)?.pack || null; } catch (_) { return null; }
}
async function openMany(ids, refresh) {
    for (let i = 0; i < ids.length; i++) {
        await open(ids[i], i === ids.length - 1 ? refresh : null, {index: i + 1, total: ids.length});
    }
}
async function granted(input, refresh) {
    const ids = Array.isArray(input) ? input : [input];
    const count = ids.length;
    const pack = await packInfo(ids[0]);
    sheet(count > 1 ? 'Паки получены' : 'Пак получен', (pack ? '<div class="pk-sheet-head"><img src="' + e(pack.image) + '" alt=""></div>' : '') +
        '<p class="cm-sheet-note" style="text-align:center">' + (count > 1 ? 'Паков получено: ' + count + '. Они добавлены в ваш инвентарь («Мои подарки»). Можно открыть все сразу — по очереди.' : 'Пак добавлен в ваш инвентарь («Мои подарки»). Его можно открыть, продать на маркете или оставить.') + '</p>' +
        '<button type="button" class="ny-action" id="pk-now">' + (count > 1 ? 'Открыть все (' + count + ')' : 'Открыть сейчас') + '</button><button type="button" class="secondary" id="pk-later" style="width:100%;margin-top:8px">Позже</button>');
    const body = document.querySelector('#sheet-body');
    body.querySelector('#pk-later').addEventListener('click', () => { closeSheet(); refresh?.(); });
    body.querySelector('#pk-now').addEventListener('click', async () => { closeSheet(); await openMany(ids, refresh); });
}
/* The regular gift sheet (catalog-ui.js) is used for packs; its "Open" button calls this. */
window.openPackFromDetail = function (id) {
    const g = (state?.inventory || []).find(x => x.id === id);
    if (!g) return;
    closeSheet();
    open(g.user_pack_id, async () => {
        try { state.inventory = (await api('inventory')).gifts; } catch (_) {}
        if (state.page === 'gifts' && typeof renderGifts === 'function') renderGifts();
    });
};

/* ---------- opening animation ---------- */
/* The bag is opened like a real foil bag: the left corner of the seal strip is pulled and the strip peels off in one even
   motion, left to right, along a straight line while the rest of the bag stays flat. */
const TEAR_Y = 11;
function tearPack(pack, reduce) {
    const top = pack.querySelector('.pk-top'), body = pack.querySelector('.pk-body');
    const poly = list => 'polygon(' + list.map(p => p[0].toFixed(2) + '% ' + p[1].toFixed(2) + '%').join(',') + ')';
    const frame = p => {
        const x = 100 * p;                                          // the tear front travels from the pulled left corner to the right edge
        top.style.clipPath = poly([[0, 0], [x, 0], [x, TEAR_Y], [0, TEAR_Y]]);
        body.style.clipPath = poly([[0, TEAR_Y], [x, TEAR_Y], [x, 0], [100, 0], [100, 100], [0, 100]]);
        top.style.transformOrigin = x + '% ' + TEAR_Y + '%';
        // The torn part stays joined to the bag at the tear front and only turns about it, so the pulled corner rises
        // while the strip is still attached to the part that has not come off yet.
        top.style.transform = 'translate(0%,0%) rotate(' + (8 + 34 * p).toFixed(2) + 'deg)';
    };
    const total = reduce ? 350 : 1900;
    return new Promise(resolve => {
        const t0 = performance.now();
        const step = now => {
            const k = Math.min(1, (now - t0) / total);
            frame(.5 - .5 * Math.cos(Math.PI * k));                 // one smooth ease: no sudden speed changes
            if (k < 1) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
    });
}
function cardMarkup(c, i) {
    let face;
    if (c.kind === 'GRAM') {
        const a = Number(c.amount), tier = a >= 3 ? 't3' : a >= 1 ? 't2' : 't1';
        face = '<div class="pk-face is-gram ' + tier + '"><span class="pk-gem">' + GEM + '</span><b>+' + num(c.amount) + '</b><em>GRAM</em></div>';
    } else {
        face = '<div class="pk-face is-nft"><img src="' + e(c.image) + '" alt=""><b>' + e(c.title) + '</b>' +
            '<button type="button" class="pk-sell" data-pk-sell="' + e(c.nft_id) + '">Продать ' + GEM + ' ' + num(c.value) + '</button></div>';
    }
    return '<div class="pk-card" data-i="' + i + '"><div class="pk-in"><div class="pk-back"><span class="pk-flake">' + FLAKE + '</span><i>?</i><small>CRAFTER</small></div>' + face + '</div></div>';
}
async function open(upid, refresh, meta) {
    if (playing) return;
    playing = true;
    let res;
    try { res = await api('packs/open', {user_pack_id: upid}); }
    catch (err) { playing = false; toast(err.message); return; }
    const cards = res.cards || [];
    const box = document.createElement('div');
    box.className = 'pk-over';
    box.style.setProperty('--ac', (res.pack && res.pack.accent) || '59 134 238');
    let finish;
    const closed = new Promise(r => { finish = r; });
    box.innerHTML = '<div class="pk-snow" aria-hidden="true">' + Array.from({length: 22}, (_, i) =>
        '<i style="--x:' + ((i * 47 + 5) % 100) + '%;--s:' + (2 + i % 4) + 'px;--t:' + (6 + i % 7) + 's;--d:' + (-(i * 2) % 9) + 's"></i>').join('') + '</div>' +
        '<div class="pk-stage"><div class="pk-pack"><div class="pk-part pk-body" style="background-image:url(' + e(res.pack.image) + ')"></div>' +
        '<div class="pk-part pk-top" style="background-image:url(' + e(res.pack.image) + ')"></div></div>' +
        '<div class="pk-cards n' + cards.length + '">' + cards.map(cardMarkup).join('') + '</div></div>' +
        '<div class="pk-actions"></div>';
    if (meta && meta.total > 1) box.insertAdjacentHTML('afterbegin', '<div class="pk-counter">Пак ' + meta.index + ' из ' + meta.total + '</div>');
    document.body.appendChild(box);
    const pack = box.querySelector('.pk-pack'), wrap = box.querySelector('.pk-cards'), actions = box.querySelector('.pk-actions');
    let sold = 0, finished = false;
    const close = () => {
        if (!finished && cards.some(c => c.kind === 'NFT')) { /* closing early keeps gifts in the inventory */ }
        box.classList.add('is-out');
        setTimeout(() => box.remove(), 350);
        playing = false;
        finish();
        if (res.balance !== undefined && state?.me) { state.me.balance = res.balance; if (typeof updateBalance === 'function') updateBalance(); }
        refresh?.();
    };

    const sellOne = async btn => {
        btn.disabled = true;
        try {
            const r = await api('packs/sell', {nft_ids: [btn.dataset.pkSell]});
            res.balance = r.balance; sold++;
            btn.closest('.pk-card').classList.add('is-sold');
            btn.innerHTML = 'Продано'; toast('Продано: ' + num(r.amount) + ' GRAM');
            refreshActions();
        } catch (err) { toast(err.message); btn.disabled = false; }
    };
    wrap.addEventListener('click', ev => { const b = ev.target.closest('[data-pk-sell]'); if (b && !b.disabled) sellOne(b); });
    const unsold = () => [...wrap.querySelectorAll('[data-pk-sell]:not([disabled])')];
    function refreshActions() {
        const left = unsold();
        const total = left.reduce((s, b) => s + Number(cards.find(c => c.nft_id === b.dataset.pkSell)?.value || 0), 0);
        actions.innerHTML = (left.length > 1 ? '<button type="button" class="secondary pk-sell-all">Продать всё · ' + num(total) + ' GRAM</button>' : '') +
            '<button type="button" class="ny-action pk-done">' + (meta && meta.index < meta.total ? 'Следующий пак' : 'Забрать') + '</button>';
        actions.querySelector('.pk-done').addEventListener('click', close);
        actions.querySelector('.pk-sell-all')?.addEventListener('click', async ev => {
            ev.target.disabled = true;
            try {
                const ids = left.map(b => b.dataset.pkSell);
                const r = await api('packs/sell', {nft_ids: ids});
                res.balance = r.balance; left.forEach(b => { b.closest('.pk-card').classList.add('is-sold'); b.disabled = true; b.textContent = 'Продано'; });
                toast('Продано: ' + num(r.amount) + ' GRAM'); refreshActions();
            } catch (err) { toast(err.message); ev.target.disabled = false; }
        });
        actions.classList.add('is-on');
    }

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = ms => reduce ? sleep(ms / 4) : sleep(ms);
    try {
        await t(60); box.classList.add('is-on');
        pack.classList.add('is-in'); await t(1000);
        pack.classList.add('is-shake'); await t(650);
        pack.classList.remove('is-shake');
        await tearPack(pack, reduce);                         // the seal tears open left to right
        pack.classList.add('is-open'); await t(420);          // the torn strip flies off
        // the bag sinks to the bottom of the stage and gets smaller, leaving room for the cards above it
        const stage = box.querySelector('.pk-stage');
        const before = pack.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        const scale = reduce ? .6 : .56;
        const lowCenter = sr.bottom - before.height * scale / 2 - 4;
        pack.style.setProperty('--low-y', (lowCenter - (before.top + before.height / 2)).toFixed(1) + 'px');
        pack.style.setProperty('--low-s', String(scale));
        pack.classList.add('is-low'); await t(950);
        // the cards come out of the opening one after another: straight up out of the bag, then spread to their places
        const pr = pack.getBoundingClientRect(), px = pr.left + pr.width / 2;
        wrap.classList.add('is-ready');
        const kids = [...wrap.children];
        const order = kids.map((_, i) => i);
        const animations = order.map(i => {
            const el = kids[i], r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const inside = 'translate(' + (px - cx) + 'px,' + (pr.top + pr.height * .55 - cy) + 'px) scale(.62)';
            const out = 'translate(' + (px - cx) + 'px,' + (pr.top - r.height * .42 - cy) + 'px) scale(.9) rotate(' + ((i - (kids.length - 1) / 2) * 2.5) + 'deg)';
            return el.animate([{transform: inside}, {transform: out, offset: .5}, {transform: 'none'}],
                {duration: reduce ? 300 : 1100, delay: reduce ? 0 : i * 260, easing: 'cubic-bezier(.33,.7,.3,1)', fill: 'both'});
        });
        await Promise.all(animations.map(x => x.finished.catch(() => {})));
        animations.forEach(x => { try { x.commitStyles(); x.cancel(); } catch (_) {} });
        pack.classList.add('is-gone'); await t(500);
    } catch (err) {                                          // the show failed: reveal the cards at once, nothing is lost
        console.error(err);
        box.classList.add('is-on'); pack.remove(); wrap.classList.add('is-ready');
        [...wrap.children].forEach(el => { el.getAnimations?.().forEach(x => x.cancel()); el.style.transform = 'none'; });
    }
    for (const el of wrap.children) {                       // flip one by one
        el.classList.add('is-flip');
        await t(760);
    }
    await t(250);
    finished = true;
    refreshActions();
    await closed;
}

/* ---------- administrator helpers ---------- */
/* Two windows, like the market picker: first the collection (search + grid), then its model (or "any model"). */
function openPicker(title, items, render, onPick, extra) {
    const box = document.createElement('div');
    box.className = 'adm-pick';
    box.innerHTML = '<div class="adm-pick-win" role="dialog" aria-label="' + e(title) + '"><div class="adm-pick-head"><b>' + e(title) + '</b><button type="button" class="adm-pick-x" aria-label="Закрыть">×</button></div>' +
        '<input class="adm-pick-search" type="search" placeholder="Поиск по названию" autocomplete="off">' + (extra || '') + '<div class="adm-pick-grid"></div></div>';
    document.body.appendChild(box);
    const grid = box.querySelector('.adm-pick-grid'), search = box.querySelector('.adm-pick-search');
    const draw = () => {
        const q = search.value.trim().toLowerCase();
        const list = items.filter(c => !q || c.name.toLowerCase().includes(q));
        grid.innerHTML = list.map(render).join('') || '<p class="sub">Ничего не найдено</p>';
    };
    const close = () => box.remove();
    box.addEventListener('click', ev => {
        if (ev.target === box || ev.target.closest('.adm-pick-x')) return close();
        const card = ev.target.closest('[data-i]');
        if (card) { const item = items[Number(card.dataset.i)]; close(); onPick(item); }
        const any = ev.target.closest('[data-any]');
        if (any) { close(); onPick(null); }
    });
    search.addEventListener('input', draw);
    draw(); search.focus();
}
let catalogCache = null;
async function pickGift(collections, onPick) {
    if (!collections || !collections.length) {
        try { catalogCache = catalogCache || (await api('admin/new-year/catalog')).collections; } catch (err) { return toast(err.message); }
        collections = catalogCache;
    }
    openPicker('Выберите подарок', collections.map((c, i) => ({...c, _i: i})),
        c => '<button type="button" class="adm-pick-card" data-i="' + c._i + '"><img src="' + e(c.image) + '" alt="" loading="lazy"><b>' + e(c.name) + '</b><span class="pk-amt">' + GEM + '<b>' + num(c.value) + '</b></span></button>',
        async c => {
            const col = collections[c._i];
            let models = [];
            try { models = (await api('admin/new-year/catalog/' + encodeURIComponent(col.id) + '/models')).models; } catch (_) {}
            if (!models.length) return onPick(col, null);
            openPicker(col.name + ': модель', models.map((m, i) => ({...m, _i: i})),
                m => '<button type="button" class="adm-pick-card" data-i="' + m._i + '"><img src="' + e(m.image) + '" alt="" loading="lazy"><b>' + e(m.name) + '</b>' + (m.price ? '<span class="pk-amt">' + GEM + '<b>' + num(m.price) + '</b></span>' : '') + '</button>',
                m => onPick(col, m ? models[m._i] : null),
                '<button type="button" class="secondary adm-pick-any" data-any="1">Любая модель коллекции</button>');
        });
}
/* Pack choice as picture tiles (no drop-down). Returns html; the caller binds clicks on [data-adm-pack]. */
function packTiles(packs, selected) {
    return '<div class="adm-packs">' + packs.map(p => '<button type="button" class="adm-pack' + (p.id === selected ? ' is-on' : '') + '" data-adm-pack="' + e(p.id) + '"><img src="' + e(p.image) + '" alt=""><b>' + e(p.title) + '</b></button>').join('') + '</div>';
}

/* ---------- administrator ---------- */
async function admin(content) {
    let r;
    try { r = await api('admin/new-year/packs'); } catch (_) { return; }
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section pk-admin';
    sec.dataset.pane = 'packs';
    const cols = [];
    const list = r.packs.map(p => '<div class="ny-admin-row"><div><b>' + e(p.title) + '</b><small>' + p.prizes.length + ' призов · ' +
        (p.for_sale ? 'в продаже за ' + num(p.price_balls) + ' шаров' : 'не продаётся') + (p.enabled ? '' : ' · выключен') + '</small></div>' +
        '<span><button type="button" data-pk-edit="' + e(p.id) + '">Изменить</button> <button type="button" data-pk-del="' + e(p.id) + '">Удалить</button></span></div>').join('');
    sec.innerHTML = '<h3>Карточные паки</h3><p class="sub">В паке от 1 до 5 карточек. Задайте шансы на количество карточек и шансы призов: GRAM на баланс или новогодние подарки (их можно продать за указанную цену). Паки можно выдавать наградой события, промокодом или продавать за шары.</p>' +
        '<div class="ny-admin-list">' + (list || '<p class="sub">Паков пока нет.</p>') + '</div><button class="secondary" type="button" id="pk-new">Новый пак</button><div id="pk-editor"></div>';
    content.appendChild(sec);
    const editor = sec.querySelector('#pk-editor');
    const edit = pack => {
        const p = pack || {id: '', title: 'Новый пак', image: '/static/assets/packs/new-year-pack.webp', card_weights: {1: 60, 2: 24, 3: 10, 4: 4, 5: 1.5, 6: .5}, for_sale: false, price_balls: 0, enabled: true, prizes: [{kind: 'GRAM', amount: '1', weight: 10}]};
        let prizes = p.prizes.map(x => ({...x}));
        const draw = () => {
            const total = prizes.reduce((s, x) => s + (Number(x.weight) || 0), 0) || 1;
            editor.innerHTML = '<form class="pk-form"><div class="ny-admin-fields">' +
                '<label class="full">Название<input name="title" maxlength="80" required value="' + e(p.title) + '"></label>' +
                '<label class="full">Картинка пака (https:// или /static/…)<input name="image_url" value="' + e(p.image) + '"></label>' +
                '<label class="ny-admin-switch full"><span><b>Продавать в маркете</b></span><input type="checkbox" name="for_sale"' + (p.for_sale ? ' checked' : '') + '></label>' +
                '<label>Цена в шарах<input name="price_balls" type="number" min="0" step="1" value="' + e(p.price_balls) + '"><small class="sub">0 — бесплатно</small></label>' +
                '<label class="ny-admin-switch full"><span><b>Пак включён</b></span><input type="checkbox" name="enabled"' + (p.enabled ? ' checked' : '') + '></label></div>' +
                '<h4>Шанс количества карточек</h4><div class="pk-w5">' + [1, 2, 3, 4, 5, 6].map(k => '<label>' + k + '<input name="w' + k + '" type="number" min="0" step="any" value="' + e(p.card_weights[k] ?? 0) + '"></label>').join('') + '</div>' +
                '<h4>Призы</h4><div class="pk-prizes">' + prizes.map((x, i) =>
                    '<div class="pk-prize" data-i="' + i + '"><select data-f="kind"><option value="GRAM"' + (x.kind === 'GRAM' ? ' selected' : '') + '>GRAM</option><option value="NFT"' + (x.kind === 'NFT' ? ' selected' : '') + '>Подарок</option></select>' +
                    (x.kind === 'GRAM' ? '<input data-f="amount" inputmode="decimal" placeholder="Сумма" value="' + e(x.amount) + '">' :
                        '<input type="hidden" data-f="collection_id" value="' + e(x.collection_id) + '"><button type="button" class="pk-pick" data-pick-i="' + i + '">' + (x.collection_id ? '<img src="' + e(x.image || '') + '" alt=""><span>' + e(x.model ? x.model + ' · ' + x.name : x.name || x.collection_id) + '</span>' : '<span>Выбрать подарок</span>') + '</button>' +
                        '<input data-f="value" inputmode="decimal" placeholder="Цена продажи" value="' + e(x.value) + '">') +
                    '<input data-f="weight" type="number" min="0" step="any" value="' + e(x.weight) + '" title="Шанс"><span class="pk-pct">' + (((Number(x.weight) || 0) / total) * 100).toFixed(1) + '%</span>' +
                    '<button type="button" data-rm="' + i + '" aria-label="Убрать">×</button></div>').join('') + '</div>' +
                '<div class="pk-row"><button type="button" class="secondary" id="pk-add-gram">+ GRAM</button><button type="button" class="secondary" id="pk-add-nft">+ Подарок</button></div>' +
                '<button class="primary" type="submit">Сохранить пак</button></form>';
            bindForm();
        };
        const pull = () => {
            editor.querySelectorAll('.pk-prize').forEach(row => {
                const x = prizes[Number(row.dataset.i)];
                row.querySelectorAll('[data-f]').forEach(inp => { x[inp.dataset.f] = inp.value; });
            });
        };
        const bindForm = () => {
            const form = editor.querySelector('form');
            editor.querySelectorAll('.pk-prize [data-f="kind"]').forEach(s => s.addEventListener('change', () => {
                pull(); const x = prizes[Number(s.closest('.pk-prize').dataset.i)];
                if (x.kind === 'NFT') { x.collection_id = ''; x.value = ''; } draw();
                if (x.kind === 'NFT') editor.querySelector('[data-pick-i="' + s.closest('.pk-prize').dataset.i + '"]')?.click();
            }));
            editor.querySelectorAll('[data-pick-i]').forEach(b => b.addEventListener('click', () => pickGift(null, (c, m) => {
                pull(); const x = prizes[Number(b.dataset.pickI)];
                Object.assign(x, {collection_id: c.id, name: c.name, image: m ? m.image : c.image, model: m ? m.name : '', value: (m && m.price) || c.value});
                draw();
            })));
            editor.querySelectorAll('[data-f="weight"]').forEach(inp => inp.addEventListener('input', () => { pull(); const total = prizes.reduce((s, x) => s + (Number(x.weight) || 0), 0) || 1; editor.querySelectorAll('.pk-prize').forEach((row, i) => { row.querySelector('.pk-pct').textContent = (((Number(prizes[i].weight) || 0) / total) * 100).toFixed(1) + '%'; }); }));
            editor.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { pull(); prizes.splice(Number(b.dataset.rm), 1); draw(); }));
            editor.querySelector('#pk-add-gram').addEventListener('click', () => { pull(); prizes.push({kind: 'GRAM', amount: '1', weight: 10}); draw(); });
            editor.querySelector('#pk-add-nft').addEventListener('click', () => pickGift(null, (c, m) => { pull(); prizes.push({kind: 'NFT', collection_id: c.id, name: c.name, image: m ? m.image : c.image, model: m ? m.name : '', value: (m && m.price) || c.value, weight: 5}); draw(); }));
            form.addEventListener('submit', async ev => {
                ev.preventDefault(); pull();
                const f = new FormData(form);
                try {
                    await api('admin/new-year/packs', {id: p.id, title: f.get('title'), image_url: f.get('image_url'), for_sale: f.get('for_sale') === 'on',
                        price_balls: f.get('price_balls'), enabled: f.get('enabled') === 'on',
                        card_weights: Object.fromEntries([1, 2, 3, 4, 5, 6].map(k => [String(k), f.get('w' + k)])),
                        prizes: prizes.map(x => ({kind: x.kind, amount: x.amount, collection_id: x.collection_id, model: x.model, value: x.value, weight: x.weight}))});
                    toast('Пак сохранён'); content.innerHTML = ''; window.renderAdminNewYear?.(content);
                } catch (err) { toast(err.message); }
            });
        };
        draw(); editor.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    };
    sec.querySelector('#pk-new').addEventListener('click', () => edit(null));
    sec.querySelectorAll('[data-pk-edit]').forEach(b => b.addEventListener('click', () => edit(r.packs.find(p => p.id === b.dataset.pkEdit))));
    sec.querySelectorAll('[data-pk-del]').forEach(b => b.addEventListener('click', async () => {
        try { await api('admin/new-year/packs/' + b.dataset.pkDel + '/delete', {}); toast('Пак удалён'); content.innerHTML = ''; window.renderAdminNewYear?.(content); }
        catch (err) { toast(err.message); }
    }));
    window.crafterPackList = r.packs;
}

window.crafterPacks = {tiles, bind, open, openMany, admin, contentsHtml, bindContents, granted, pickGift, packTiles};
})();
