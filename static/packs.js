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
const pct = v => (Number(v) >= 10 ? Number(v).toFixed(1) : Number(v).toFixed(2)).replace(/\.?0+$/, '') + '%';
const CUBE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z" fill="none" stroke="#4fd37a" stroke-width="2" stroke-linejoin="round"/><path d="M3.5 7 12 11.8 20.5 7M12 11.8v9.7" fill="none" stroke="#4fd37a" stroke-width="2" stroke-linejoin="round"/></svg>';
const gem = n => '<span class="pk-amt">' + GEM + '<b>' + num(n) + '</b></span>';
async function contentsHtml(pid) {
    try {
        const c = await api('packs/' + encodeURIComponent(pid) + '/contents');
        const nft = c.prizes.filter(p => p.kind === 'NFT'), gram = c.prizes.filter(p => p.kind === 'GRAM');
        const tier = ch => ch < 3 ? 't3' : ch < 10 ? 't2' : 't1';
        const card = p => p.kind === 'NFT'
            ? '<div class="pk-pc ' + tier(p.chance) + '"><i class="pk-ch">' + pct(p.chance) + '</i><img src="' + e(p.image) + '" alt=""><b>' + e(p.name) + '</b>' + gem(p.value) + '</div>'
            : '<div class="pk-pc is-bal ' + tier(p.chance) + '"><i class="pk-ch">' + pct(p.chance) + '</i><span class="pk-bal">' + GEM + '</span><b>Баланс GRAM</b>' + gem(p.amount) + '</div>';
        return '<div class="pk-info show-chances"><h4 class="pk-h">' + CUBE + 'Что внутри?</h4>' +
            '<p class="pk-range">Может выпасть на сумму от ' + gem(c.min) + ' до ' + gem(c.max) + '</p>' +
                        '<h5 class="pk-sub">Призы, которые могут выпасть</h5><div class="pk-prizes2">' + nft.concat(gram).map(card).join('') + '</div></div>';
    } catch (_) { return ''; }
}
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
async function granted(upid, refresh) {
    const pack = await packInfo(upid);
    sheet('Пак получен', (pack ? '<div class="pk-sheet-head"><img src="' + e(pack.image) + '" alt=""></div>' : '') +
        '<p class="cm-sheet-note" style="text-align:center">Пак добавлен в ваш инвентарь («Мои подарки»). Его можно открыть, продать на маркете или оставить.</p>' +
        '<button type="button" class="ny-action" id="pk-now">Открыть сейчас</button><button type="button" class="secondary" id="pk-later" style="width:100%;margin-top:8px">Позже</button>');
    const body = document.querySelector('#sheet-body');
    body.querySelector('#pk-later').addEventListener('click', () => { closeSheet(); refresh?.(); });
    body.querySelector('#pk-now').addEventListener('click', async () => { closeSheet(); await open(upid, refresh); });
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
async function open(upid, refresh) {
    if (playing) return;
    playing = true;
    let res;
    try { res = await api('packs/open', {user_pack_id: upid}); }
    catch (err) { playing = false; toast(err.message); return; }
    const cards = res.cards || [];
    const box = document.createElement('div');
    box.className = 'pk-over';
    box.innerHTML = '<div class="pk-snow" aria-hidden="true">' + Array.from({length: 22}, (_, i) =>
        '<i style="--x:' + ((i * 47 + 5) % 100) + '%;--s:' + (2 + i % 4) + 'px;--t:' + (6 + i % 7) + 's;--d:' + (-(i * 2) % 9) + 's"></i>').join('') + '</div>' +
        '<div class="pk-stage"><div class="pk-pack"><div class="pk-part pk-body" style="background-image:url(' + e(res.pack.image) + ')"></div>' +
        '<div class="pk-part pk-top" style="background-image:url(' + e(res.pack.image) + ')"></div><div class="pk-cut"></div><div class="pk-burst"></div></div>' +
        '<div class="pk-cards n' + cards.length + '">' + cards.map(cardMarkup).join('') + '</div></div>' +
        '<div class="pk-actions"></div>';
    document.body.appendChild(box);
    const pack = box.querySelector('.pk-pack'), wrap = box.querySelector('.pk-cards'), actions = box.querySelector('.pk-actions');
    let sold = 0, finished = false;
    const close = () => {
        if (!finished && cards.some(c => c.kind === 'NFT')) { /* closing early keeps gifts in the inventory */ }
        box.classList.add('is-out');
        setTimeout(() => box.remove(), 350);
        playing = false;
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
            '<button type="button" class="ny-action pk-done">Забрать</button>';
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
    await t(60); box.classList.add('is-on');
    pack.classList.add('is-in'); await t(1000);
    pack.classList.add('is-shake'); await t(650);
    pack.classList.add('is-cut'); await t(420);
    pack.classList.add('is-open'); await t(260);
    // cards fly out of the pack and settle into a layout (FLIP)
    const pr = pack.getBoundingClientRect(), cx = pr.left + pr.width / 2, cy = pr.top + pr.height * .35;
    wrap.classList.add('is-ready');
    [...wrap.children].forEach((el, i) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--dx', (cx - (r.left + r.width / 2)) + 'px');
        el.style.setProperty('--dy', (cy - (r.top + r.height / 2)) + 'px');
        el.style.setProperty('--r', ((i - (cards.length - 1) / 2) * 9) + 'deg');
        el.style.setProperty('--w', (i * 90) + 'ms');
        el.classList.add('is-fly');
    });
    await t(40);
    pack.classList.add('is-gone');
    [...wrap.children].forEach(el => el.classList.remove('is-fly'));
    await t(1000 + cards.length * 90);
    for (const el of wrap.children) {                       // flip one by one
        el.classList.add('is-flip');
        await t(760);
    }
    await t(250);
    finished = true;
    refreshActions();
}

/* ---------- administrator ---------- */
async function admin(content) {
    let r;
    try { r = await api('admin/new-year/packs'); } catch (_) { return; }
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section pk-admin';
    sec.dataset.pane = 'packs';
    const cols = r.collections;
    const list = r.packs.map(p => '<div class="ny-admin-row"><div><b>' + e(p.title) + '</b><small>' + p.prizes.length + ' призов · ' +
        (p.for_sale ? 'в продаже за ' + num(p.price_balls) + ' шаров' : 'не продаётся') + (p.enabled ? '' : ' · выключен') + '</small></div>' +
        '<span><button type="button" data-pk-edit="' + e(p.id) + '">Изменить</button> <button type="button" data-pk-del="' + e(p.id) + '">Удалить</button></span></div>').join('');
    sec.innerHTML = '<h3>Карточные паки</h3><p class="sub">В паке от 1 до 5 карточек. Задайте шансы на количество карточек и шансы призов: GRAM на баланс или новогодние подарки (их можно продать за указанную цену). Паки можно выдавать наградой события, промокодом или продавать за шары.</p>' +
        '<div class="ny-admin-list">' + (list || '<p class="sub">Паков пока нет.</p>') + '</div><button class="secondary" type="button" id="pk-new">Новый пак</button><div id="pk-editor"></div>';
    content.appendChild(sec);
    const editor = sec.querySelector('#pk-editor');
    const edit = pack => {
        const p = pack || {id: '', title: 'Новый пак', image: '/static/assets/packs/new-year-pack.webp', card_weights: {1: 30, 2: 30, 3: 20, 4: 12, 5: 8}, for_sale: false, price_balls: 0, enabled: true, prizes: [{kind: 'GRAM', amount: '1', weight: 10}]};
        let prizes = p.prizes.map(x => ({...x}));
        const draw = () => {
            const total = prizes.reduce((s, x) => s + (Number(x.weight) || 0), 0) || 1;
            editor.innerHTML = '<form class="pk-form"><div class="ny-admin-fields">' +
                '<label class="full">Название<input name="title" maxlength="80" required value="' + e(p.title) + '"></label>' +
                '<label class="full">Картинка пака (https:// или /static/…)<input name="image_url" value="' + e(p.image) + '"></label>' +
                '<label class="ny-admin-switch full"><span><b>Продавать в маркете</b></span><input type="checkbox" name="for_sale"' + (p.for_sale ? ' checked' : '') + '></label>' +
                '<label>Цена в шарах<input name="price_balls" type="number" min="0" step="1" value="' + e(p.price_balls) + '"><small class="sub">0 — бесплатно</small></label>' +
                '<label class="ny-admin-switch full"><span><b>Пак включён</b></span><input type="checkbox" name="enabled"' + (p.enabled ? ' checked' : '') + '></label></div>' +
                '<h4>Шанс количества карточек</h4><div class="pk-w5">' + [1, 2, 3, 4, 5].map(k => '<label>' + k + '<input name="w' + k + '" type="number" min="0" step="any" value="' + e(p.card_weights[k] ?? 0) + '"></label>').join('') + '</div>' +
                '<h4>Призы</h4><div class="pk-prizes">' + prizes.map((x, i) =>
                    '<div class="pk-prize" data-i="' + i + '"><select data-f="kind"><option value="GRAM"' + (x.kind === 'GRAM' ? ' selected' : '') + '>GRAM</option><option value="NFT"' + (x.kind === 'NFT' ? ' selected' : '') + '>Подарок</option></select>' +
                    (x.kind === 'GRAM' ? '<input data-f="amount" inputmode="decimal" placeholder="Сумма" value="' + e(x.amount) + '">' :
                        '<select data-f="collection_id">' + cols.map(c => '<option value="' + e(c.id) + '"' + (c.id === x.collection_id ? ' selected' : '') + '>' + e(c.name) + '</option>').join('') + '</select>' +
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
                if (x.kind === 'NFT') { x.collection_id = cols[0]?.id; x.value = cols[0]?.value; } draw();
            }));
            editor.querySelectorAll('[data-f="collection_id"]').forEach(s => s.addEventListener('change', () => {
                pull(); const x = prizes[Number(s.closest('.pk-prize').dataset.i)]; x.value = cols.find(c => c.id === x.collection_id)?.value || ''; draw();
            }));
            editor.querySelectorAll('[data-f="weight"]').forEach(inp => inp.addEventListener('input', () => { pull(); const total = prizes.reduce((s, x) => s + (Number(x.weight) || 0), 0) || 1; editor.querySelectorAll('.pk-prize').forEach((row, i) => { row.querySelector('.pk-pct').textContent = (((Number(prizes[i].weight) || 0) / total) * 100).toFixed(1) + '%'; }); }));
            editor.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { pull(); prizes.splice(Number(b.dataset.rm), 1); draw(); }));
            editor.querySelector('#pk-add-gram').addEventListener('click', () => { pull(); prizes.push({kind: 'GRAM', amount: '1', weight: 10}); draw(); });
            editor.querySelector('#pk-add-nft').addEventListener('click', () => { pull(); prizes.push({kind: 'NFT', collection_id: cols[0]?.id, value: cols[0]?.value, weight: 5}); draw(); });
            form.addEventListener('submit', async ev => {
                ev.preventDefault(); pull();
                const f = new FormData(form);
                try {
                    await api('admin/new-year/packs', {id: p.id, title: f.get('title'), image_url: f.get('image_url'), for_sale: f.get('for_sale') === 'on',
                        price_balls: f.get('price_balls'), enabled: f.get('enabled') === 'on',
                        card_weights: Object.fromEntries([1, 2, 3, 4, 5].map(k => [String(k), f.get('w' + k)])),
                        prizes: prizes.map(x => ({kind: x.kind, amount: x.amount, collection_id: x.collection_id, value: x.value, weight: x.weight}))});
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

window.crafterPacks = {tiles, bind, open, admin, contentsHtml, bindContents, granted};
})();
