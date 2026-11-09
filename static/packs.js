/* Card packs: market tiles, the opening animation (cut the pack, cards fly out and flip one by one)
   and the administrator editor. Server state lives in /api/packs. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img src="/static/assets/new-year-ornament.svg" alt="" aria-hidden="true">';
const GEM = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 21 2.5 9.5 6 3h12l3.5 6.5Z" fill="#7fd0ff"/><path d="M2.5 9.5h19M8.5 3 12 21 15.5 3M6 3l2.5 6.5M18 3l-2.5 6.5" fill="none" stroke="#fff" stroke-width="1.2" stroke-linejoin="round" opacity=".85"/></svg>';
const FLAKE = '<svg viewBox="-50 -50 100 100" aria-hidden="true"><g stroke="currentColor" stroke-width="3.2" stroke-linecap="round" fill="none">' +
    [0, 60, 120, 180, 240, 300].map(a => '<g transform="rotate(' + a + ')"><path d="M0 0V-40"/><path d="M0-16-9-26M0-16 9-26"/><path d="M0-28-6-34M0-28 6-34"/></g>').join('') + '</g></svg>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let playing = false;

/* ---------- market tiles ---------- */
function tiles(state) {
    const out = [];
    for (const m of state.mine) out.push('<button type="button" class="ny-lot cm-tile pk-tile" data-pk-open="' + e(m.id) + '"><div class="ny-lot-art"><img src="' + e(m.pack.image) + '" alt=""></div>' +
        '<div class="ny-lot-name">' + e(m.pack.title) + '</div><div class="ny-lot-id">Ваш пак</div><div class="ny-lot-price">Открыть</div></button>');
    for (const p of state.shop) out.push('<button type="button" class="ny-lot cm-tile pk-tile" data-pk-buy="' + e(p.id) + '"><div class="ny-lot-art"><img src="' + e(p.image) + '" alt=""></div>' +
        '<div class="ny-lot-name">' + e(p.title) + '</div><div class="ny-lot-id">1–5 карточек</div><div class="ny-lot-price">' + (p.price_balls ? ORN + num(p.price_balls) : 'Бесплатно') + '</div></button>');
    return out;
}
function bind(main, state, refresh) {
    main.querySelectorAll('[data-pk-open]').forEach(b => b.addEventListener('click', () => open(b.dataset.pkOpen, refresh)));
    main.querySelectorAll('[data-pk-buy]').forEach(b => b.addEventListener('click', () => buySheet(state.shop.find(p => p.id === b.dataset.pkBuy), refresh)));
}
function buySheet(p, refresh) {
    if (!p) return;
    sheet('Карточный пак', '<div class="cm-sheet-head"><span class="cm-pic big"><img src="' + e(p.image) + '" alt=""></span><div><b>' + e(p.title) + '</b><small>От 1 до 5 карточек: GRAM и новогодние подарки</small></div></div>' +
        '<button type="button" class="ny-action" id="pk-buy">' + (p.price_balls ? 'Купить за ' + num(p.price_balls) + ' шаров' : 'Получить бесплатно') + '</button>' +
        '<p class="purchase-error pk-err" role="alert"></p>');
    const body = document.querySelector('#sheet-body'), btn = body.querySelector('#pk-buy');
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const r = await api('packs/buy', {pack_id: p.id, request_id: 'pk-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2))});
            if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(r.balance);
            closeSheet();
            await open(r.user_pack_id, refresh);
        } catch (err) { body.querySelector('.pk-err').textContent = err.message; btn.disabled = false; }
    });
}

/* ---------- opening animation ---------- */
function cardMarkup(c, i) {
    let face;
    if (c.kind === 'GRAM') {
        const big = Number(c.amount) >= 2;
        face = '<div class="pk-face is-gram' + (big ? ' is-big' : '') + '"><span class="pk-gem">' + GEM + '</span><b>+' + num(c.amount) + '</b><em>GRAM</em><small>Зачислено на баланс</small></div>';
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
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'pk-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Закрыть');
    x.addEventListener('click', close); box.appendChild(x);

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
                '<label><span><input type="checkbox" name="for_sale"' + (p.for_sale ? ' checked' : '') + '> Продавать в маркете</span></label>' +
                '<label>Цена в шарах (0 — бесплатно)<input name="price_balls" type="number" min="0" step="1" value="' + e(p.price_balls) + '"></label>' +
                '<label class="full"><span><input type="checkbox" name="enabled"' + (p.enabled ? ' checked' : '') + '> Пак включён</span></label></div>' +
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

window.crafterPacks = {tiles, bind, open, admin};
})();
