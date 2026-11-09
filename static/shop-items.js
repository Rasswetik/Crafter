/* Seasonal shop items besides NFT lots: GRAM balance, balls, card packs and promo codes, paid in balls. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img src="/static/assets/new-year-ornament.svg" alt="" aria-hidden="true">';
const LABEL = {GRAM: 'Баланс GRAM', BALL: 'Новогодние шары', PACK: 'Карточный пак', PROMO: 'Промокод'};
const KIND_NAME = [['GRAM', 'GRAM'], ['BALL', 'Шары'], ['PACK', 'Пак'], ['PROMO', 'Промокод']];
function art(it) {
    if (it.image_url) return it.image_url;
    if (it.kind === 'GRAM') return '/static/assets/gram.svg';
    if (it.kind === 'BALL') return '/static/assets/new-year-ornament.svg';
    if (it.kind === 'PACK') return it.pack?.image || '/static/assets/packs/new-year-pack.webp';
    return '/static/assets/community-reward.svg';
}
const unavailable = it => (it.left !== null && it.left <= 0) || (it.per_user !== null && it.mine >= it.per_user);
function describe(it) {
    if (it.kind === 'GRAM') return 'На ваш баланс будет зачислено ' + num(it.amount) + ' GRAM.';
    if (it.kind === 'BALL') return 'На баланс добавится ' + num(it.amount) + ' новогодних шаров.';
    if (it.kind === 'PACK') return it.bundle > 1 ? 'Вы получите ' + it.bundle + ' карточных паков.' : 'Карточный пак с GRAM и подарками.';
    const what = it.promo_kind === 'PACK' ? (it.bundle > 1 ? it.bundle + ' карточных паков' : 'карточный пак') : it.promo_kind === 'BALL' ? num(it.amount) + ' шаров' : num(it.amount) + ' GRAM';
    return 'Вы получите уникальный промокод на ' + what + '. Его активируете только вы, один раз.';
}

function tiles(items) {
    return (items || []).filter(it => !unavailable(it)).map(it =>
        '<button type="button" class="ny-lot cm-tile si-tile" data-si="' + e(it.id) + '"><div class="ny-lot-art"><img src="' + e(art(it)) + '" alt=""></div>' +
        '<div class="ny-lot-name">' + e(it.title) + '</div>' +
        '<div class="ny-lot-id">' + (it.left !== null ? 'Осталось ' + num(it.left) : it.kind === 'PACK' && it.bundle > 1 ? it.bundle + ' ' + (it.bundle < 5 ? 'пака' : 'паков') + ' в наборе' : LABEL[it.kind]) + '</div>' +
        '<div class="ny-lot-price">' + (it.price_balls ? ORN + num(it.price_balls) : 'Бесплатно') + '</div></button>');
}
function bind(main, items, refresh) {
    main.querySelectorAll('[data-si]').forEach(b => b.addEventListener('click', () => sheetFor((items || []).find(i => i.id === b.dataset.si), refresh)));
}
async function sheetFor(it, refresh) {
    if (!it) return;
    sheet(LABEL[it.kind], '<div class="cm-sheet-head"><span class="cm-pic big"><img src="' + e(art(it)) + '" alt=""></span><div><b>' + e(it.title) + '</b><small>' + e(describe(it)) + '</small></div></div>' +
        (it.left !== null ? '<p class="cm-sheet-note">Осталось: ' + num(it.left) + '</p>' : '') + (it.per_user !== null ? '<p class="cm-sheet-note">Лимит: до ' + it.per_user + ' на игрока (куплено ' + it.mine + ')</p>' : '') +
        '<div id="si-extra"></div><button type="button" class="ny-action" id="si-buy">' + (it.price_balls ? 'Купить за ' + num(it.price_balls) + ' шаров' : 'Получить бесплатно') + '</button>' +
        '<p class="purchase-error si-err" role="alert"></p>');
    const body = document.querySelector('#sheet-body'), btn = body.querySelector('#si-buy');
    const packId = it.kind === 'PACK' ? it.amount : (it.kind === 'PROMO' && it.promo_kind === 'PACK' ? it.amount : null);
    if (packId && window.crafterPacks?.contentsHtml) window.crafterPacks.contentsHtml(packId).then(h => { const x = body.querySelector('#si-extra'); if (x) x.innerHTML = h; });
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const r = await api('shop-items/buy', {item_id: it.id, request_id: 'si-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2))});
            if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(r.balance);
            if (r.gram_balance !== undefined && state?.me) { state.me.balance = r.gram_balance; if (typeof updateBalance === 'function') updateBalance(); }
            if (r.pack_id) { closeSheet(); await window.crafterPacks?.granted(r.pack_id, refresh, (r.pack_ids || []).length); return; }
            if (r.code) {
                const cc = window.crafterCommunity;
                body.innerHTML = '<div class="cm-sheet-head"><span class="cm-pic big"><img src="' + e(art(it)) + '" alt=""></span><div><b>' + e(it.title) + '</b></div></div>' + cc.codeBlock(r.code);
                cc.bindCode(body, r.code); refresh?.(); return;
            }
            closeSheet(); toast(r.gram ? 'Зачислено: ' + num(r.gram) + ' GRAM' : 'Зачислено шаров: ' + num(r.balls_gain)); refresh?.();
        } catch (err) { body.querySelector('.si-err').textContent = err.message; btn.disabled = false; }
    });
}

/* ---------- administrator ---------- */
const KIND_TILES = [
    ['GRAM', 'GRAM на баланс', 'Игрок сразу получает GRAM', '/static/assets/gram.svg'],
    ['BALL', 'Новогодние шары', 'Игрок получает шары', '/static/assets/new-year-ornament.svg'],
    ['PACK', 'Карточный пак', 'Пак попадает в инвентарь', '/static/assets/packs/new-year-pack.webp'],
    ['PROMO', 'Промокод', 'Уникальный код для покупателя', '/static/assets/community-reward.svg'],
];
const PROMO_TILES = [['GRAM', 'GRAM', '/static/assets/gram.svg'], ['BALL', 'Шары', '/static/assets/new-year-ornament.svg'], ['PACK', 'Пак', '/static/assets/packs/new-year-pack.webp']];
async function admin(content) {
    let r, packs = [];
    try { r = await api('admin/new-year/shop'); } catch (_) { return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section si-admin';
    sec.dataset.pane = 'shop';
    content.appendChild(sec);
    const f = {kind: 'GRAM', promo: 'GRAM', amount: '1', pack: packs[0]?.id || '', price: '0', stock: '', per: '0', bundle: '1', image: '', title: ''};
    const eff = () => f.kind === 'PROMO' ? f.promo : f.kind;
    const range = (key, label, min, max, val, fmt) => '<div class="adm-range"><div class="adm-range-top"><label>' + label + '</label><b data-out="' + key + '">' + fmt(Number(val)) + '</b></div>' +
        '<input type="range" data-f="' + key + '" data-fmt="' + (key === 'per' ? 'per' : 'bundle') + '" min="' + min + '" max="' + max + '" step="1" value="' + val + '" style="--p:' + ((val - min) / (max - min) * 100) + '%"></div>';
    const fmtPer = v => v === 0 ? 'Без ограничений' : 'до ' + v;
    const fmtBundle = v => v === 1 ? '1 пак' : v < 5 ? v + ' пака' : v + ' паков';
    const tile = (on, attr, img, title, hint) => '<button type="button" class="adm-tile' + (on ? ' is-on' : '') + '" ' + attr + '><img src="' + e(img) + '" alt=""><b>' + title + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</button>';
    const preview = () => {
        const it = {kind: f.kind, promo_kind: f.promo, amount: eff() === 'PACK' ? f.pack : f.amount, bundle: Number(f.bundle) || 1, per_user: Number(f.per) || null, mine: 0, title: f.title || autoTitle(), image_url: f.image,
            pack: packs.find(p => p.id === f.pack) ? {image: packs.find(p => p.id === f.pack).image} : null, price_balls: Number(f.price) || 0, left: f.stock ? Number(f.stock) : null};
        return tiles([it])[0] || '';
    };
    const autoTitle = () => {
        const w = eff() === 'PACK' ? 'Pack ' + (packs.find(p => p.id === f.pack)?.title || '') + (Number(f.bundle) > 1 ? ' ×' + f.bundle : '') : eff() === 'BALL' ? num(f.amount) + ' шаров' : num(f.amount) + ' GRAM';
        return f.kind === 'PROMO' ? 'Промокод: ' + w : w;
    };
    const list = () => r.items.map(it => '<div class="ny-admin-row"><div class="cm-admin-pic"><img src="' + e(art(it)) + '" alt=""></div><div><b>' + e(it.title) + '</b><small>' + e(LABEL[it.kind]) + ' · ' +
        (it.price_balls ? num(it.price_balls) + ' шаров' : 'бесплатно') + ' · продано ' + it.sold + (it.stock !== null ? '/' + it.stock : '') + (it.bundle > 1 ? ' · ' + it.bundle + ' пака за покупку' : '') + (it.per_user !== null ? ' · лимит ' + it.per_user : '') + (it.status === 'hidden' ? ' · скрыт' : '') + '</small></div>' +
        '<span><button type="button" data-si-st="' + e(it.id) + '" data-next="' + (it.status === 'active' ? 'hidden' : 'active') + '">' + (it.status === 'active' ? 'Скрыть' : 'Показать') + '</button> <button type="button" data-si-del="' + e(it.id) + '">Удалить</button></span></div>').join('');
    const draw = () => {
        const kinds = KIND_TILES.filter(k => !(k[0] === 'PACK' && !packs.length));
        const step2 = f.kind === 'PROMO' ? '<div class="adm-step"><h4>Что даёт промокод</h4><div class="adm-tiles small">' + PROMO_TILES.filter(k => !(k[0] === 'PACK' && !packs.length)).map(k => tile(f.promo === k[0], 'data-promo="' + k[0] + '"', k[2], k[1])).join('') + '</div></div>' : '';
        const what = eff() === 'PACK'
            ? '<div class="adm-step"><h4>Какой пак</h4>' + window.crafterPacks.packTiles(packs, f.pack) + '</div>'
            : '<div class="adm-step"><h4>' + (eff() === 'BALL' ? 'Сколько шаров' : 'Сколько GRAM') + '</h4><div class="adm-field"><input data-f="amount" inputmode="decimal" value="' + e(f.amount) + '">' +
              '<div class="adm-chips">' + (eff() === 'BALL' ? ['50', '100', '500', '1000'] : ['0.5', '1', '2', '5', '10']).map(v => '<button type="button" data-chip="amount" data-v="' + v + '">' + v + '</button>').join('') + '</div></div></div>';
        sec.innerHTML = '<h3>Новый товар</h3><p class="sub">Товар за новогодние шары. Появится в новогоднем маркете рядом с подарками.</p>' +
            '<div class="adm-step"><h4>Что продаём</h4><div class="adm-tiles">' + kinds.map(k => tile(f.kind === k[0], 'data-kind="' + k[0] + '"', k[3], k[1], k[2])).join('') + '</div></div>' +
            step2 + what +
            '<div class="adm-step"><h4>Условия</h4><div class="adm-row3">' +
            '<div class="adm-field"><label>Цена в шарах</label><input data-f="price" type="number" min="0" step="1" value="' + e(f.price) + '"><div class="adm-chips"><button type="button" data-chip="price" data-v="0">Бесплатно</button><button type="button" data-chip="price" data-v="50">50</button><button type="button" data-chip="price" data-v="100">100</button></div></div>' +
            '<div class="adm-field"><label>Сколько всего</label><input data-f="stock" type="number" min="1" step="1" value="' + e(f.stock) + '" placeholder="Без ограничений"></div>' +
            '</div>' + (eff() === 'PACK' ? range('bundle', 'Паков за одну покупку', 1, 20, f.bundle, fmtBundle) : '') +
            range('per', 'Сколько раз может купить один игрок', 0, 20, f.per, fmtPer) + '</div>' +
            '<details class="adm-more"' + (f.image || f.title ? ' open' : '') + '><summary>Название и картинка</summary><div class="adm-row3">' +
            '<div class="adm-field"><label>Название</label><input data-f="title" maxlength="80" value="' + e(f.title) + '" placeholder="' + e(autoTitle()) + '"></div>' +
            '<div class="adm-field" style="grid-column:span 2"><label>Картинка (ссылка)</label><input data-f="image" value="' + e(f.image) + '" placeholder="По умолчанию подставится сама"></div></div></details>' +
            '<div class="adm-step"><h4>Как будет выглядеть</h4><div class="adm-preview"><div class="ny-grid">' + preview() + '</div></div></div>' +
            '<button class="primary" type="button" id="si-add">Добавить товар</button>' +
            '<h3 style="margin-top:26px">Товары</h3><div class="ny-admin-list">' + (list() || '<p class="sub">Товаров пока нет.</p>') + '</div>';
        bind();
    };
    const pull = () => sec.querySelectorAll('[data-f]').forEach(i => { f[i.dataset.f] = i.value; });
    const run = async (fn, ok) => { try { await fn(); toast(ok); content.innerHTML = ''; window.renderAdminNewYear?.(content); } catch (err) { toast(err.message); } };
    const bind = () => {
        sec.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { pull(); f.kind = b.dataset.kind; f.amount = eff() === 'BALL' ? '100' : '1'; draw(); }));
        sec.querySelectorAll('[data-promo]').forEach(b => b.addEventListener('click', () => { pull(); f.promo = b.dataset.promo; f.amount = eff() === 'BALL' ? '100' : '1'; draw(); }));
        sec.querySelectorAll('[data-adm-pack]').forEach(b => b.addEventListener('click', () => { pull(); f.pack = b.dataset.admPack; draw(); }));
        sec.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => { pull(); f[b.dataset.chip] = b.dataset.v; draw(); }));
        sec.querySelectorAll('[data-f]').forEach(i => i.addEventListener('change', () => { pull(); draw(); }));
        sec.querySelectorAll('input[type=range]').forEach(i => i.addEventListener('input', () => {
            const min = Number(i.min), max = Number(i.max), v = Number(i.value);
            i.style.setProperty('--p', ((v - min) / (max - min) * 100) + '%');
            const out = sec.querySelector('[data-out="' + i.dataset.f + '"]');
            if (out) out.textContent = (i.dataset.fmt === 'per' ? fmtPer : fmtBundle)(v);
        }));
        sec.querySelector('#si-add').addEventListener('click', () => {
            pull();
            run(() => api('admin/new-year/shop', {kind: f.kind, promo_kind: f.promo, amount: eff() === 'PACK' ? f.pack : f.amount, price_balls: f.price || 0, stock: f.stock, per_user: f.per === '0' ? '' : f.per, bundle: eff() === 'PACK' ? f.bundle : 1, image_url: f.image, title: f.title}), 'Товар добавлен');
        });
        sec.querySelectorAll('[data-si-st]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + b.dataset.siSt + '/status', {status: b.dataset.next}), 'Готово')));
        sec.querySelectorAll('[data-si-del]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + b.dataset.siDel + '/delete', {}), 'Товар удалён')));
    };
    draw();
}

window.crafterShopItems = {tiles, bind, admin};
})();
