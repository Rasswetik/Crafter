/* Seasonal shop items besides NFT lots: GRAM balance, balls, card packs and promo codes, paid in balls. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img src="/static/assets/new-year-ornament.svg" alt="" aria-hidden="true">';
const LABEL = {GRAM: 'Баланс GRAM', BALL: 'Новогодние шары', PACK: 'Карточный пак', STAR: 'Подарок Telegram', PROMO: 'Промокод'};
let STARS = [];
const KIND_NAME = [['GRAM', 'GRAM'], ['BALL', 'Шары'], ['PACK', 'Пак'], ['STAR', 'Подарок'], ['PROMO', 'Промокод']];
/* Packs in a bundle stand one behind another: the first one straight in front, the others behind it, each a bit more turned. */
function packOf(it) { return it.kind === 'PACK' || (it.kind === 'PROMO' && it.promo_kind === 'PACK'); }
function artHTML(it, cls) {
    const src = art(it);
    if (packOf(it) && Number(it.bundle) > 1) {
        const shown = Math.min(5, Number(it.bundle));
        const order = it.contents && it.contents.length ? it.contents.flatMap(c => Array(Math.max(1, Number(c.count))).fill(c.pack.image)) : [];
        const imgs = Array.from({length: shown}, (_, i) => '<img src="' + e(order[i] || src) + '" alt="" style="--i:' + i + ';--st:' + Math.ceil(i / 2) + ';--s:' + (i % 2 ? 1 : -1) + '">').join('');
        return '<span class="si-fan n' + shown + (cls ? ' ' + cls : '') + '">' + imgs + (Number(it.bundle) > shown ? '<b class="si-fan-count">×' + it.bundle + '</b>' : '') + '</span>';
    }
    return '<img class="si-solo" src="' + e(src) + '" alt="">';
}
const accentOf = it => (it.pack && it.pack.accent) || (it.kind === 'GRAM' ? '255 196 84' : it.kind === 'BALL' ? '238 84 84' : it.kind === 'PROMO' ? '255 190 90' : '90 150 240');
const SPARKS = [[8, 18, 0], [86, 12, .5], [14, 70, 1.1], [90, 62, .3], [50, 6, .8], [72, 86, 1.4], [28, 90, .6]].map(([x, y, d]) => '<i class="si-spark" style="left:' + x + '%;top:' + y + '%;animation-delay:' + d + 's"></i>').join('');
const priceHTML = it => it.price_balls ? (it.old_price_balls > it.price_balls ? '<s class="si-old">' + num(it.old_price_balls) + '</s>' : '') + ORN + num(it.price_balls) : 'Бесплатно';
const offHTML = it => it.discount_percent > 0 ? '<span class="si-off">−' + it.discount_percent + '%</span>' : '';
function art(it) {
    if (it.image_url) return it.image_url;
    if (it.kind === 'GRAM') return '/static/assets/gram.svg';
    if (it.kind === 'BALL') return '/static/assets/new-year-ornament.svg';
    if (it.kind === 'PACK') return it.pack?.image || '/static/assets/packs/new-year-pack.webp';
    if (it.kind === 'STAR') return it.star?.image || '/static/assets/stargifts/bear.svg';
    return '/static/assets/community-reward.svg';
}
const unavailable = it => (it.left !== null && it.left <= 0) || (it.per_user !== null && it.mine >= it.per_user);
function describe(it) {
    if (it.kind === 'GRAM') return 'На ваш баланс будет зачислено ' + num(it.amount) + ' GRAM.';
    if (it.kind === 'BALL') return 'На баланс добавится ' + num(it.amount) + ' новогодних шаров.';
    if (it.kind === 'PACK' && it.contents && it.contents.length > 1) return 'В наборе: ' + it.contents.map(c => c.pack.title + (c.count > 1 ? ' ×' + c.count : '')).join(' + ') + '.';
    if (it.kind === 'PACK') return it.bundle > 1 ? 'Вы получите ' + it.bundle + ' карточных паков.' : 'Карточный пак с GRAM и подарками.';
    if (it.kind === 'STAR') return 'Подарок Telegram' + (it.bundle > 1 ? ' ×' + it.bundle : '') + ' попадёт в «Мои подарки»: его можно продать сайту за GRAM, вывести в Telegram или использовать в апгрейде и крафте.';
    const what = it.promo_kind === 'STAR' ? 'подарок Telegram' + (it.bundle > 1 ? ' ×' + it.bundle : '') : it.promo_kind === 'PACK' ? (it.bundle > 1 ? it.bundle + ' карточных паков' : 'карточный пак') : it.promo_kind === 'BALL' ? num(it.amount) + ' шаров' : num(it.amount) + ' GRAM';
    return 'Вы получите уникальный промокод на ' + what + '. Его активируете только вы, один раз.';
}

function tiles(items) {
    return (items || []).filter(it => !unavailable(it)).map(it =>
        '<button type="button" class="ny-lot cm-tile si-tile" data-si="' + e(it.id) + '"><div class="ny-lot-art">' + artHTML(it) + offHTML(it) + '</div>' +
        '<div class="ny-lot-name">' + e(it.title) + '</div>' +
        '<div class="ny-lot-id">' + (it.left !== null ? 'Осталось ' + num(it.left) : (it.kind === 'PACK' || it.kind === 'STAR') && it.bundle > 1 ? it.bundle + ' шт. в наборе' : LABEL[it.kind]) + '</div>' +
        '<div class="ny-lot-price">' + priceHTML(it) + '</div></button>');
}
function bind(main, items, refresh) {
    main.querySelectorAll('[data-si]').forEach(b => b.addEventListener('click', () => sheetFor((items || []).find(i => i.id === b.dataset.si), refresh)));
}
async function sheetFor(it, refresh) {
    if (!it) return;
    sheet(LABEL[it.kind], '<div class="si-hero" style="--ac:' + accentOf(it) + '"><span class="si-glow"></span><span class="si-shine"></span>' + SPARKS +
        '<div class="si-stage">' + artHTML(it, 'is-hero') + '</div>' + offHTML(it) +
        '<div class="si-hero-text"><b>' + e(it.title) + '</b><small>' + e(describe(it)) + '</small></div></div>' +
        (it.discount_percent > 0 ? '<div class="si-sale"><span class="si-off inline">−' + it.discount_percent + '%</span><s>' + num(it.old_price_balls) + '</s> ' + ORN + '<b>' + num(it.price_balls) + '</b><small>Скидка · вы экономите ' + num(it.old_price_balls - it.price_balls) + ' шаров</small></div>' : '') +
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
            if (r.pack_id) { closeSheet(); await window.crafterPacks?.granted(r.pack_ids || [r.pack_id], refresh); return; }
            if (r.gift_ids) { closeSheet(); toast('Подарок получен — он в «Мои подарки»'); refresh?.(); return; }
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
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) { STARS = []; }
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section si-admin';
    sec.dataset.pane = 'shop';
    content.appendChild(sec);
    const f = {kind: 'GRAM', promo: 'GRAM', amount: '1', pack: packs[0]?.id || '', price: '0', old: '', stock: '', per: '0', bundle: '1', image: '', title: '', mix: {}};
    const eff = () => f.kind === 'PROMO' ? f.promo : f.kind;
    const range = (key, label, min, max, val, fmt) => '<div class="adm-range"><div class="adm-range-top"><label>' + label + '</label><b data-out="' + key + '">' + fmt(Number(val)) + '</b></div>' +
        '<input type="range" data-f="' + key + '" data-fmt="' + (key === 'per' ? 'per' : 'bundle') + '" min="' + min + '" max="' + max + '" step="1" value="' + val + '" style="--p:' + ((val - min) / (max - min) * 100) + '%"></div>';
    const fmtPer = v => v === 0 ? 'Без ограничений' : 'до ' + v;
    const fmtBundle = v => v === 1 ? '1 пак' : v < 5 ? v + ' пака' : v + ' паков';
    const tile = (on, attr, img, title, hint) => '<button type="button" class="adm-tile' + (on ? ' is-on' : '') + '" ' + attr + '><img src="' + e(img) + '" alt=""><b>' + title + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</button>';
    const preview = () => {
        const mixList = f.kind === 'PACK' ? Object.entries(f.mix).filter(([, n]) => n > 0).map(([id, n]) => ({pack: packs.find(p => p.id === id), count: n})).filter(c => c.pack) : [];
        const it = {contents: mixList.length ? mixList : null, kind: f.kind, promo_kind: f.promo, amount: eff() === 'PACK' ? f.pack : f.amount, star: eff() === 'STAR' ? STARS.find(x => x.key === f.amount) : null, bundle: mixList.length ? mixList.reduce((x, c) => x + c.count, 0) : (Number(f.bundle) || 1), per_user: Number(f.per) || null, mine: 0, old_price_balls: Number(f.old) > Number(f.price) ? Number(f.old) : null, discount_percent: Number(f.old) > Number(f.price) ? Math.round((1 - Number(f.price) / Number(f.old)) * 100) : null, title: f.title || autoTitle(), image_url: f.image,
            pack: packs.find(p => p.id === f.pack) ? {image: packs.find(p => p.id === f.pack).image} : null, price_balls: Number(f.price) || 0, left: f.stock ? Number(f.stock) : null};
        return tiles([it])[0] || '';
    };
    const autoTitle = () => {
        const w = eff() === 'STAR' ? (STARS.find(x => x.key === f.amount)?.name || 'Подарок') + (Number(f.bundle) > 1 ? ' ×' + f.bundle : '') : eff() === 'PACK' ? 'Pack ' + (packs.find(p => p.id === f.pack)?.title || '') + (Number(f.bundle) > 1 ? ' ×' + f.bundle : '') : eff() === 'BALL' ? num(f.amount) + ' шаров' : num(f.amount) + ' GRAM';
        return f.kind === 'PROMO' ? 'Промокод: ' + w : w;
    };
    const list = () => r.items.map(it => '<div class="ny-admin-row"><div class="cm-admin-pic"><img src="' + e(art(it)) + '" alt=""></div><div><b>' + e(it.title) + '</b><small>' + e(LABEL[it.kind]) + ' · ' +
        (it.price_balls ? num(it.price_balls) + ' шаров' + (it.discount_percent > 0 ? ' (скидка −' + it.discount_percent + '%, было ' + num(it.old_price_balls) + ')' : '') : 'бесплатно') + ' · продано ' + it.sold + (it.stock !== null ? '/' + it.stock : '') + (it.bundle > 1 ? ' · ' + it.bundle + ' пака за покупку' : '') + (it.per_user !== null ? ' · лимит ' + it.per_user : '') + (it.status === 'hidden' ? ' · скрыт' : '') + '</small></div>' +
        '<span><button type="button" data-si-st="' + e(it.id) + '" data-next="' + (it.status === 'active' ? 'hidden' : 'active') + '">' + (it.status === 'active' ? 'Скрыть' : 'Показать') + '</button> <button type="button" data-si-del="' + e(it.id) + '">Удалить</button></span></div>').join('');
    const draw = () => {
        const kinds = KIND_TILES.filter(k => !(k[0] === 'PACK' && !packs.length) && !(k[0] === 'STAR' && !STARS.length));
        const step2 = f.kind === 'PROMO' ? '<div class="adm-step"><h4>Что даёт промокод</h4><div class="adm-tiles small">' + PROMO_TILES.filter(k => !(k[0] === 'PACK' && !packs.length) && !(k[0] === 'STAR' && !STARS.length)).map(k => tile(f.promo === k[0], 'data-promo="' + k[0] + '"', k[2], k[1])).join('') + '</div></div>' : '';
        const mixTotal = Object.values(f.mix).reduce((x, n) => x + n, 0);
        const what = f.kind === 'PACK'
            ? '<div class="adm-step"><h4>Состав набора</h4><p class="sub">Добавляйте любые паки вместе: например New Year + Winter + Snowman. Всего в наборе до 20 паков, сейчас: <b>' + mixTotal + '</b>.</p><div class="si-mix">' + packs.map(p => '<div class="si-mix-row' + ((f.mix[p.id] || 0) > 0 ? ' is-on' : '') + '"><img src="' + e(p.image) + '" alt=""><b>' + e(p.title) + '</b><span class="si-mix-step"><button type="button" data-mix-dec="' + e(p.id) + '" aria-label="Меньше">−</button><output>' + (f.mix[p.id] || 0) + '</output><button type="button" data-mix-inc="' + e(p.id) + '" aria-label="Больше">+</button></span></div>').join('') + '</div></div>'
            : eff() === 'PACK'
            ? '<div class="adm-step"><h4>Какой пак</h4>' + window.crafterPacks.packTiles(packs, f.pack) + '</div>'
            : eff() === 'STAR'
            ? '<div class="adm-step"><h4>Какой подарок</h4><div class="adm-field"><select data-f="amount">' + window.crafterStarGifts.options(STARS, f.amount) + '</select></div></div>'
            : '<div class="adm-step"><h4>' + (eff() === 'BALL' ? 'Сколько шаров' : 'Сколько GRAM') + '</h4><div class="adm-field"><input data-f="amount" inputmode="decimal" value="' + e(f.amount) + '">' +
              '<div class="adm-chips">' + (eff() === 'BALL' ? ['50', '100', '500', '1000'] : ['0.5', '1', '2', '5', '10']).map(v => '<button type="button" data-chip="amount" data-v="' + v + '">' + v + '</button>').join('') + '</div></div></div>';
        sec.innerHTML = '<h3>Новый товар</h3><p class="sub">Товар за новогодние шары. Появится в новогоднем маркете рядом с подарками.</p>' +
            '<div class="adm-step"><h4>Что продаём</h4><div class="adm-tiles">' + kinds.map(k => tile(f.kind === k[0], 'data-kind="' + k[0] + '"', k[3], k[1], k[2])).join('') + '</div></div>' +
            step2 + what +
            '<div class="adm-step"><h4>Условия</h4><div class="adm-row3">' +
            '<div class="adm-field"><label>Цена в шарах</label><input data-f="price" type="number" min="0" step="1" value="' + e(f.price) + '"><div class="adm-chips"><button type="button" data-chip="price" data-v="0">Бесплатно</button><button type="button" data-chip="price" data-v="50">50</button><button type="button" data-chip="price" data-v="100">100</button></div></div>' +
            '<div class="adm-field"><label>Старая цена (скидка)</label><input data-f="old" type="number" min="0" step="1" value="' + e(f.old) + '" placeholder="Без скидки"><small class="sub">' + (Number(f.old) > Number(f.price) ? 'Скидка ' + Math.round((1 - Number(f.price) / Number(f.old)) * 100) + '%' : 'Больше текущей цены') + '</small></div>' +
            '<div class="adm-field"><label>Сколько всего</label><input data-f="stock" type="number" min="1" step="1" value="' + e(f.stock) + '" placeholder="Без ограничений"></div>' +
            '</div>' + ((eff() === 'PACK' && f.kind !== 'PACK') || eff() === 'STAR' ? range('bundle', eff() === 'STAR' ? 'Подарков за одну покупку' : 'Паков за одну покупку', 1, 20, f.bundle, fmtBundle) : '') +
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
        sec.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { pull(); f.kind = b.dataset.kind; f.amount = eff() === 'STAR' ? (STARS[0]?.key || 'bear') : eff() === 'BALL' ? '100' : '1'; draw(); }));
        sec.querySelectorAll('[data-promo]').forEach(b => b.addEventListener('click', () => { pull(); f.promo = b.dataset.promo; f.amount = eff() === 'STAR' ? (STARS[0]?.key || 'bear') : eff() === 'BALL' ? '100' : '1'; draw(); }));
        sec.querySelectorAll('[data-mix-inc]').forEach(b => b.addEventListener('click', () => { pull(); const t = Object.values(f.mix).reduce((x, n) => x + n, 0); if (t < 20) f.mix[b.dataset.mixInc] = (f.mix[b.dataset.mixInc] || 0) + 1; draw(); }));
        sec.querySelectorAll('[data-mix-dec]').forEach(b => b.addEventListener('click', () => { pull(); f.mix[b.dataset.mixDec] = Math.max(0, (f.mix[b.dataset.mixDec] || 0) - 1); draw(); }));
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
            run(() => api('admin/new-year/shop', {contents: f.kind === 'PACK' ? Object.entries(f.mix).filter(([, n]) => n > 0).map(([pack_id, count]) => ({pack_id, count})) : undefined, kind: f.kind, promo_kind: f.promo, amount: eff() === 'PACK' ? f.pack : f.amount, price_balls: f.price || 0, old_price_balls: f.old || '', stock: f.stock, per_user: f.per === '0' ? '' : f.per, bundle: eff() === 'PACK' || eff() === 'STAR' ? f.bundle : 1, image_url: f.image, title: f.title}), 'Товар добавлен');
        });
        sec.querySelectorAll('[data-si-st]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + b.dataset.siSt + '/status', {status: b.dataset.next}), 'Готово')));
        sec.querySelectorAll('[data-si-del]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + b.dataset.siDel + '/delete', {}), 'Товар удалён')));
    };
    draw();
}

window.crafterShopItems = {tiles, bind, admin};
})();
