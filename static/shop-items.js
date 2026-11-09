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
    if (it.kind === 'PACK') return 'Карточный пак: от 1 до 5 карточек с GRAM и подарками.';
    const what = it.promo_kind === 'PACK' ? 'карточный пак' : it.promo_kind === 'BALL' ? num(it.amount) + ' шаров' : num(it.amount) + ' GRAM';
    return 'Вы получите уникальный промокод на ' + what + '. Его активируете только вы, один раз.';
}

function tiles(items) {
    return (items || []).filter(it => !unavailable(it)).map(it =>
        '<button type="button" class="ny-lot cm-tile si-tile" data-si="' + e(it.id) + '"><div class="ny-lot-art"><img src="' + e(art(it)) + '" alt=""></div>' +
        '<div class="ny-lot-name">' + e(it.title) + '</div>' +
        '<div class="ny-lot-id">' + (it.left !== null ? 'Осталось ' + num(it.left) : LABEL[it.kind]) + '</div>' +
        '<div class="ny-lot-price">' + (it.price_balls ? ORN + num(it.price_balls) : 'Бесплатно') + '</div></button>');
}
function bind(main, items, refresh) {
    main.querySelectorAll('[data-si]').forEach(b => b.addEventListener('click', () => sheetFor((items || []).find(i => i.id === b.dataset.si), refresh)));
}
async function sheetFor(it, refresh) {
    if (!it) return;
    sheet(LABEL[it.kind], '<div class="cm-sheet-head"><span class="cm-pic big"><img src="' + e(art(it)) + '" alt=""></span><div><b>' + e(it.title) + '</b><small>' + e(describe(it)) + '</small></div></div>' +
        (it.left !== null ? '<p class="cm-sheet-note">Осталось: ' + num(it.left) + '</p>' : '') +
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
            if (r.pack_id) { closeSheet(); await window.crafterPacks?.granted(r.pack_id, refresh); return; }
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
async function admin(content) {
    let r, packs = [];
    try { r = await api('admin/new-year/shop'); } catch (_) { return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section si-admin';
    sec.dataset.pane = 'shop';
    const rows = r.items.map(it => '<div class="ny-admin-row"><div class="cm-admin-pic"><img src="' + e(art(it)) + '" alt=""></div><div><b>' + e(it.title) + '</b><small>' + e(LABEL[it.kind]) + ' · ' +
        (it.price_balls ? num(it.price_balls) + ' шаров' : 'бесплатно') + ' · продано ' + it.sold + (it.stock !== null ? '/' + it.stock : '') + (it.status === 'hidden' ? ' · скрыт' : '') + '</small></div>' +
        '<span><button type="button" data-si-st="' + e(it.id) + '" data-next="' + (it.status === 'active' ? 'hidden' : 'active') + '">' + (it.status === 'active' ? 'Скрыть' : 'Показать') + '</button> <button type="button" data-si-del="' + e(it.id) + '">Удалить</button></span></div>').join('');
    sec.innerHTML = '<h3>Новый товар</h3><p class="sub">Товары за новогодние шары. Появляются в новогоднем маркете рядом с подарками.</p>' +
        '<form id="si-form"><div class="cm-seg">' + KIND_NAME.filter(k => !(k[0] === 'PACK' && !packs.length)).map((k, i) => '<button type="button" data-kind="' + k[0] + '" class="' + (i === 0 ? 'is-on' : '') + '">' + k[1] + '</button>').join('') + '</div>' +
        '<div class="ny-admin-fields">' +
        '<label id="si-promo-label" class="full" hidden>Что даёт промокод<select name="promo_kind"><option value="GRAM">GRAM</option><option value="BALL">Шары</option>' + (packs.length ? '<option value="PACK">Карточный пак</option>' : '') + '</select></label>' +
        '<label id="si-amount-label">Сколько GRAM<input name="amount" inputmode="decimal" value="1"></label>' +
        '<label id="si-pack-label" hidden>Какой пак<select name="amount_pack">' + packs.map(p => '<option value="' + e(p.id) + '">' + e(p.title) + '</option>').join('') + '</select></label>' +
        '<label>Цена в шарах<input name="price_balls" type="number" min="0" step="1" value="0"><small class="sub">0 — бесплатно</small></label>' +
        '<label>Количество в наличии<input name="stock" type="number" min="1" step="1" placeholder="без ограничений"></label>' +
        '<label>Лимит на игрока<input name="per_user" type="number" min="1" step="1" placeholder="без ограничений"></label>' +
        '<label class="full">Картинка (необязательно)<input name="image_url" placeholder="https://…/image.png"></label>' +
        '<label class="full">Название (необязательно)<input name="title" maxlength="80" placeholder="Создастся автоматически"></label></div>' +
        '<button class="primary" type="submit">Добавить товар</button></form>' +
        '<h3 style="margin-top:22px">Товары</h3><div class="ny-admin-list">' + (rows || '<p class="sub">Товаров пока нет.</p>') + '</div>';
    content.appendChild(sec);
    const form = sec.querySelector('#si-form');
    let kind = 'GRAM';
    const sync = () => {
        const promo = form.elements.promo_kind.value, eff = kind === 'PROMO' ? promo : kind;
        form.querySelector('#si-promo-label').hidden = kind !== 'PROMO';
        form.querySelector('#si-pack-label').hidden = eff !== 'PACK';
        form.querySelector('#si-amount-label').hidden = eff === 'PACK';
        form.querySelector('#si-amount-label').firstChild.textContent = eff === 'BALL' ? 'Сколько шаров' : 'Сколько GRAM';
        form.elements.amount.value = eff === 'BALL' ? '100' : '1';
    };
    form.querySelectorAll('.cm-seg [data-kind]').forEach(b => b.addEventListener('click', () => {
        kind = b.dataset.kind; form.querySelectorAll('.cm-seg [data-kind]').forEach(x => x.classList.toggle('is-on', x === b)); sync();
    }));
    form.elements.promo_kind.addEventListener('change', sync);
    const run = async (fn, ok) => { try { await fn(); toast(ok); content.innerHTML = ''; window.renderAdminNewYear?.(content); } catch (err) { toast(err.message); } };
    form.addEventListener('submit', ev => {
        ev.preventDefault();
        const body = Object.fromEntries(new FormData(form));
        body.kind = kind;
        const eff = kind === 'PROMO' ? body.promo_kind : kind;
        if (eff === 'PACK') body.amount = body.amount_pack;
        run(() => api('admin/new-year/shop', body), 'Товар добавлен');
    });
    sec.querySelectorAll('[data-si-st]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + b.dataset.siSt + '/status', {status: b.dataset.next}), 'Готово')));
    sec.querySelectorAll('[data-si-del]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + b.dataset.siDel + '/delete', {}), 'Товар удалён')));
}

window.crafterShopItems = {tiles, bind, admin};
})();
