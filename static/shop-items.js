/* Seasonal shop items besides NFT lots: GRAM balance, balls, card packs and promo codes, paid in balls. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img src="/static/assets/new-year-ornament.svg" alt="" aria-hidden="true">';
const LABEL = {GRAM: 'Баланс GRAM', BALL: 'Новогодние шары', PACK: 'Карточный пак', BUNDLE: 'Бандл', STAR: 'Подарок Telegram', PROMO: 'Промокод'};
let STARS = [];
const SIZES = [['small', 'Обычная', '1×1', 'Маленькая плитка в сетке'], ['wide', 'Широкая', '2×1', 'Вытянута на две колонки'],
    ['tall', 'Длинная', '1×2', 'Высокая, на две строки'], ['large', 'Большая', '2×2', 'Крупная витрина'], ['banner', 'Баннер', 'на всю ширину', 'Акция на всю строку']];
const sizeOf = it => (SIZES.some(s => s[0] === it.size) ? it.size : 'small');
const KIND_NAME = [['GRAM', 'GRAM'], ['BALL', 'Шары'], ['PACK', 'Пак'], ['STAR', 'Подарок'], ['PROMO', 'Промокод']];
/* Packs in a bundle stand one behind another: the first one straight in front, the others behind it, each a bit more turned. */
function packOf(it) { return it.kind === 'PACK' || (it.kind === 'BUNDLE' && it.contents && it.contents.length) || (it.kind === 'PROMO' && it.promo_kind === 'PACK'); }
function artHTML(it, cls) {
    const src = art(it);
    /* a bundle of several kinds of packs: every kind stands in one spread fan, so none of them is hidden behind the first */
    const kinds = packOf(it) && it.contents && it.contents.length > 1 ? it.contents.slice(0, 7) : null;
    if (kinds) {
        const mid = (kinds.length - 1) / 2;
        const imgs = kinds.map((c, i) => '<img' + (Math.abs(i - mid) < .6 ? ' class="mid"' : '') + ' src="' + e(c.pack.image || src) + '" alt="" title="' + e(c.pack.title) + '" style="--pos:' + (i - mid).toFixed(2) + ';--apos:' + Math.abs(i - mid).toFixed(2) + ';--z:' + (20 - Math.round(Math.abs(i - mid) * 2)) + '">').join('');
        return '<span class="si-fan spread n' + kinds.length + (cls ? ' ' + cls : '') + '">' + imgs + (Number(it.bundle) > 1 ? '<b class="si-fan-count">×' + it.bundle + '</b>' : '') + '</span>';
    }
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
    if (it.kind === 'BUNDLE') return (it.contents && it.contents[0] && it.contents[0].pack.image) || (it.gram ? '/static/assets/gram.svg' : '/static/assets/new-year-ornament.svg');
    if (it.kind === 'PACK') return it.pack?.image || '/static/assets/packs/new-year-pack.webp';
    if (it.kind === 'STAR') return it.star?.image || '/static/assets/stargifts/bear.png';
    return '/static/assets/community-reward.svg';
}
const unavailable = it => (it.left !== null && it.left <= 0) || (it.per_user !== null && it.mine >= it.per_user);
function describe(it) {
    if (it.description) return it.description;
    if (it.kind === 'GRAM') return 'На ваш баланс будет зачислено ' + num(it.amount) + ' GRAM.';
    if (it.kind === 'BALL') return 'На баланс добавится ' + num(it.amount) + ' новогодних шаров.';
    if (it.kind === 'BUNDLE') return 'В бандле: ' + [].concat((it.contents || []).map(c => c.pack.title + (c.count > 1 ? ' ×' + c.count : '')), it.gram ? [num(it.gram) + ' GRAM'] : [], it.balls ? [num(it.balls) + ' новогодних шаров'] : []).join(' + ') + '. Всё сразу за одну покупку.';
    if (it.kind === 'PACK' && it.contents && it.contents.length > 1) return 'В наборе: ' + it.contents.map(c => c.pack.title + (c.count > 1 ? ' ×' + c.count : '')).join(' + ') + '.';
    if (it.kind === 'PACK') return it.bundle > 1 ? 'Вы получите ' + it.bundle + ' карточных паков.' : 'Карточный пак с GRAM и подарками.';
    if (it.kind === 'STAR') return 'Подарок Telegram' + (it.bundle > 1 ? ' ×' + it.bundle : '') + ' попадёт в «Мои подарки»: его можно продать сайту за GRAM, вывести в Telegram или использовать в апгрейде и крафте.';
    const what = it.promo_kind === 'STAR' ? 'подарок Telegram' + (it.bundle > 1 ? ' ×' + it.bundle : '') : it.promo_kind === 'PACK' ? (it.bundle > 1 ? it.bundle + ' карточных паков' : 'карточный пак') : it.promo_kind === 'BALL' ? num(it.amount) + ' шаров' : num(it.amount) + ' GRAM';
    return 'Вы получите уникальный промокод на ' + what + '. Его активируете только вы, один раз.';
}

function tiles(items, all) {
    return (items || []).filter(it => all || !unavailable(it)).map((it, i) =>
        '<button type="button" class="ny-lot cm-tile si-tile si-sz-' + sizeOf(it) + '" data-si="' + e(it.id) + '" style="--ac:' + accentOf(it) + ';--n:' + Math.min(i, 14) + '"><div class="ny-lot-art">' + artHTML(it) + offHTML(it) + '</div>' +
        '<div class="ny-lot-name">' + e(it.title) + '</div>' + (sizeOf(it) === 'small' || sizeOf(it) === 'tall' ? '' : '<div class="si-desc">' + e(describe(it)) + '</div>') +
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
    ['BUNDLE', 'Бандл / выбор / случайный', 'Несколько паков сразу, на выбор или случайный', '/static/assets/community-reward.svg'],
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
    const f = {kind: 'GRAM', promo: 'GRAM', amount: '1', pack: packs[0]?.id || '', price: '0', old: '', stock: '', per: '0', bundle: '1', image: '', title: '', mix: {}, bgram: '', bballs: '', size: 'small', view: 'phone', description: '', rarity: 'auto', badge: '', endsH: '', endsAt: null, section_id: '', heading: '', card_bg: '', mode: '', startsMsk: '', endsMsk: ''};
    let secForm = null;
    let editing = null;
    let startEdit = () => {};
    const toMsk = epoch => new Date((epoch + 3 * 3600) * 1000).toISOString().slice(0, 16);              // unix time -> 'YYYY-MM-DDTHH:MM' in Moscow time
    const mskEpoch = text => text ? Math.floor(Date.parse(text + ':00Z') / 1000) - 3 * 3600 : null;
    const uploadMedia = async file => {
        if (file.size > 600000) throw new Error('Файл должен быть не больше 600 КБ');
        const body = new FormData(); body.append('file', file);
        return (await api('admin/new-year/shop-media', body)).url;
    };
    const cardBgGallery = (cur, attr, fileAttr) => '<div class="fm-gal">' + (window.crafterFestive?.cardBgKeys || []).map(k => '<button type="button" class="fm-sw' + (cur === k[0] ? ' is-on' : '') + '" ' + attr + '="' + e(k[0]) + '"><span class="fm-swp"><span class="fm-swc cb-' + e(k[0] || 'none') + '"></span></span><em>' + e(k[1]) + '</em></button>').join('') +
        '<label class="fm-sw fm-swup' + (cur && cur.indexOf('image:') === 0 ? ' is-on' : '') + '"><span class="fm-swp"' + (cur && cur.indexOf('image:') === 0 ? ' style="background-image:url(' + e(cur.slice(6)) + ')"' : '') + '><b>+</b></span><em>Своя картинка</em><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden ' + fileAttr + '></label></div>';
    const secBgGallery = cur => '<div class="fm-gal">' + (window.crafterFestive?.bgKeys || []).map(k => '<button type="button" class="fm-sw' + (cur === k[0] ? ' is-on' : '') + '" data-sf-bg="' + e(k[0]) + '"><span class="fm-swp"><span class="fm-swc"><span class="fm-bgx bg-' + (k[0] === 'village' ? 'villagepv' : e(k[0])) + '"></span></span></span><em>' + e(k[1]) + '</em></button>').join('') + '</div>';
    const secTitle = id => ((r.sections || []).find(x => x.id === id) || {}).title || '';
    const sectionChips = (cur, attr) => [['', 'Авто (по правилам)']].concat((r.sections || []).filter(x => x.kind !== 'exchange' && x.id !== 'gifts').map(x => [x.id, x.title])).map(c => '<button type="button" class="' + (cur === c[0] ? 'is-on' : '') + '" ' + attr + '="' + e(c[0]) + '">' + e(c[1]) + '</button>').join('');
    const eff = () => f.kind === 'PROMO' ? f.promo : f.kind;
    const range = (key, label, min, max, val, fmt) => '<div class="adm-range"><div class="adm-range-top"><label>' + label + '</label><b data-out="' + key + '">' + fmt(Number(val)) + '</b></div>' +
        '<input type="range" data-f="' + key + '" data-fmt="' + (key === 'per' ? 'per' : 'bundle') + '" min="' + min + '" max="' + max + '" step="1" value="' + val + '" style="--p:' + ((val - min) / (max - min) * 100) + '%"></div>';
    const fmtPer = v => v === 0 ? 'Без ограничений' : 'до ' + v;
    const fmtBundle = v => v === 1 ? '1 пак' : v < 5 ? v + ' пака' : v + ' паков';
    const tile = (on, attr, img, title, hint) => '<button type="button" class="adm-tile' + (on ? ' is-on' : '') + '" ' + attr + '><img src="' + e(img) + '" alt=""><b>' + title + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</button>';
    const previewItem = () => {
        const mixList = f.kind === 'BUNDLE' ? Object.entries(f.mix).filter(([, n]) => n > 0).map(([id, n]) => ({pack: packs.find(p => p.id === id), count: n})).filter(c => c.pack) : [];
        const it = {contents: mixList.length ? mixList : null, gram: f.kind === 'BUNDLE' && !f.mode && Number(f.bgram) > 0 ? f.bgram : null, balls: f.kind === 'BUNDLE' && !f.mode && Number(f.bballs) > 0 ? f.bballs : null, kind: f.kind === 'BUNDLE' && f.mode ? 'PACK' : f.kind, promo_kind: f.promo, amount: eff() === 'PACK' ? f.pack : f.amount, star: eff() === 'STAR' ? STARS.find(x => x.key === f.amount) : null, bundle: mixList.length ? mixList.reduce((x, c) => x + c.count, 0) : (Number(f.bundle) || 1), per_user: Number(f.per) || null, mine: 0, old_price_balls: Number(f.old) > Number(f.price) ? Number(f.old) : null, discount_percent: Number(f.old) > Number(f.price) ? Math.round((1 - Number(f.price) / Number(f.old)) * 100) : null, title: f.title || autoTitle(), image_url: f.image,
            pack: packs.find(p => p.id === f.pack) ? {image: packs.find(p => p.id === f.pack).image} : null, price_balls: Number(f.price) || 0, left: f.stock ? Number(f.stock) : null, size: f.size, description: f.description, rarity: f.rarity, badge: f.badge, section_id: f.section_id, heading: f.heading, card_bg: f.card_bg, mode: f.mode, id: 'preview',
            ends_at: f.endsH ? Math.floor(Date.now() / 1000) + Number(f.endsH) * 3600 : (f.endsMsk ? mskEpoch(f.endsMsk) : f.endsAt)};
        return it;
    };
    const preview = () => tiles([previewItem()])[0] || '';
    const sendPreview = () => sec.querySelectorAll('[data-fm-pv]').forEach(fr => {
        const post = () => { try { fr.contentWindow.postMessage({type: 'fm-preview', items: [previewItem()], sections: r.sections || []}, location.origin); } catch (_) {} };
        post(); fr.addEventListener('load', post, {once: true});
    });
    const autoTitle = () => {
        if (f.kind === 'BUNDLE') return 'Бандл: ' + ([].concat(Object.entries(f.mix).filter(([, n]) => n > 0).map(([id, n]) => (packs.find(p => p.id === id)?.title || 'Пак') + (n > 1 ? ' ×' + n : '')), Number(f.bgram) > 0 ? [num(f.bgram) + ' GRAM'] : [], Number(f.bballs) > 0 ? [num(f.bballs) + ' шаров'] : []).join(' + ') || '…');
        const w = eff() === 'STAR' ? (STARS.find(x => x.key === f.amount)?.name || 'Подарок') + (Number(f.bundle) > 1 ? ' ×' + f.bundle : '') : eff() === 'PACK' ? 'Pack ' + (packs.find(p => p.id === f.pack)?.title || '') + (Number(f.bundle) > 1 ? ' ×' + f.bundle : '') : eff() === 'BALL' ? num(f.amount) + ' шаров' : num(f.amount) + ' GRAM';
        return f.kind === 'PROMO' ? 'Промокод: ' + w : w;
    };
    const list = () => r.items.map(it => '<div class="ny-admin-row"><div class="cm-admin-pic"><img src="' + e(art(it)) + '" alt=""></div><div><b>' + e(it.title) + '</b><small>' + e(LABEL[it.kind]) + ' · ' +
        (it.price_balls ? num(it.price_balls) + ' шаров' + (it.discount_percent > 0 ? ' (скидка −' + it.discount_percent + '%, было ' + num(it.old_price_balls) + ')' : '') : 'бесплатно') + ' · продано ' + it.sold + (it.stock !== null ? '/' + it.stock : '') + (it.bundle > 1 ? ' · ' + it.bundle + ' пака за покупку' : '') + (it.per_user !== null ? ' · лимит ' + it.per_user : '') + (it.status === 'hidden' ? ' · скрыт' : '') + ' · размер: ' + e((SIZES.find(s => s[0] === sizeOf(it)) || SIZES[0])[1]) + '</small></div>' +
        '<span><select class="si-size-select" data-si-size="' + e(it.id) + '" aria-label="Размер плитки">' + SIZES.map(s => '<option value="' + s[0] + '"' + (sizeOf(it) === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select> <button type="button" data-si-up="' + e(it.id) + '" aria-label="Выше">↑</button> <button type="button" data-si-down="' + e(it.id) + '" aria-label="Ниже">↓</button> <button type="button" data-si-edit="' + e(it.id) + '">Изменить</button> <button type="button" data-si-st="' + e(it.id) + '" data-next="' + (it.status === 'active' ? 'hidden' : 'active') + '">' + (it.status === 'active' ? 'Скрыть' : 'Показать') + '</button> <button type="button" data-si-del="' + e(it.id) + '">Удалить</button></span></div>').join('');
    let selected = null;
    const RARS = [['auto', 'Авто', '#7a8398', '#b5bdd0'], ['common', 'Акция', '#2f7bff', '#4fd6ff'], ['rare', 'Редкая', '#4a7bff', '#7a5cff'], ['special', 'Особая акция', '#ff5fd0', '#45d9ff'], ['epic', 'Эпическая', '#6a2cff', '#d058ff'], ['mythic', 'Мифическая', '#e5322a', '#ff9a3d'], ['legend', 'Легендарная', '#f09a14', '#ffe97a']];
    const GRIP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>';
    const COG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
    const sizeShape = s => '<span class="sz-shape sz-' + s + '" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    const boardHTML = () => r.items.map(it => '<div class="sb-cell sb-' + sizeOf(it) + (it.status === 'hidden' ? ' is-hidden' : '') + (selected === it.id ? ' is-sel' : '') + '" data-sb="' + e(it.id) + '">' +
        (window.crafterFestive ? window.crafterFestive.card({key: it.id, src: 'shop', it}, {board: true}) : (tiles([it], true)[0] || '')) +
        '<button type="button" class="sb-handle" data-sb-drag aria-label="Перетащить лот" title="Перетащите, чтобы переставить">' + GRIP + '</button>' +
        '<button type="button" class="sb-gear" data-sb-gear aria-label="Настройки лота" title="Настройки лота">' + COG + '</button>' +
        (it.status === 'hidden' ? '<span class="sb-badge">скрыт</span>' : '') + (it.section_id && secTitle(it.section_id) ? '<span class="sb-sec">' + e(secTitle(it.section_id)) + '</span>' : '') + (it.starts_at && it.starts_at > Date.now() / 1000 ? '<span class="sb-badge">ещё не началась</span>' : '') + '<button type="button" hidden data-si-edit="' + e(it.id) + '"></button></div>').join('');
    const drawerHTML = () => {
        const it = r.items.find(x => x.id === selected);
        const note = r.order === 'manual' ? 'Порядок: ваш. <button type="button" class="sb-link" data-sb-price>Вернуть по цене</button>' : 'Порядок: по возрастанию цены. Потяните любую плитку за ⠿, и порядок станет вашим.';
        if (!it) return '<p class="sub sb-hint">Тяните плитки за значок ⠿, чтобы переставить их. Двойное нажатие или ⚙ открывает настройки лота. ' + note + '</p>';
        return '<div class="sb-drawer"><div class="sb-drawer-top"><b>' + e(it.title) + '</b><button type="button" class="sb-x" data-sb-close aria-label="Закрыть">×</button></div>' +
            '<div class="sb-sizes">' + SIZES.map(s => '<button type="button" class="sz-opt' + (sizeOf(it) === s[0] ? ' is-on' : '') + '" data-sb-size="' + s[0] + '">' + sizeShape(s[0]) + '<b>' + s[1] + '</b><small>' + s[2] + '</small></button>').join('') + '</div>' +
            '<div class="sb-set"><label>Раздел</label><div class="sb-chips">' + sectionChips(it.section_id || '', 'data-sb-sec') + '</div></div>' +
            '<div class="sb-set"><label>Название и цена</label><div class="sb-quick">' +
            '<label>Название<input type="text" data-sb-q="title" maxlength="80" value="' + e(it.title) + '"></label>' +
            '<label>Цена, шаров<input type="number" min="0" data-sb-q="price_balls" value="' + e(String(it.price_balls)) + '"></label>' +
            '<label>Старая цена (скидка)<input type="number" min="0" data-sb-q="old_price_balls" value="' + e(it.old_price_balls ? String(it.old_price_balls) : '') + '" placeholder="Без скидки"></label>' +
            '<label>Значок<input type="text" data-sb-q="badge" maxlength="14" value="' + e(it.badge || '') + '" placeholder="НОВОЕ, ХИТ"></label>' +
            '<label>Сколько всего<input type="number" min="0" data-sb-q="stock" value="' + (it.stock === null || it.stock === undefined ? '' : e(String(it.stock))) + '" placeholder="Без ограничений"></label>' +
            '<label>На одного игрока<input type="number" min="0" data-sb-q="per_user" value="' + (it.per_user === null || it.per_user === undefined ? '' : e(String(it.per_user))) + '" placeholder="Без ограничений"></label>' +
            '<label>Появится (МСК)<input type="datetime-local" data-sb-q="starts_at_msk" value="' + (it.starts_at ? toMsk(it.starts_at) : '') + '"></label>' +
            '<label>Закончится (МСК)<input type="datetime-local" data-sb-q="ends_at_msk" value="' + (it.ends_at ? toMsk(it.ends_at) : '') + '"></label>' +
            '<label class="sb-q-wide">Описание<textarea data-sb-q="description" maxlength="240" rows="2">' + e(it.description || '') + '</textarea></label></div>' +
            '<button type="button" class="primary" data-sb-save>Сохранить</button></div>' +
            '<div class="sb-set"><label>Редкость</label><div class="sb-chips">' + RARS.map(x => '<button type="button" class="' + ((it.rarity || 'auto') === x[0] ? 'is-on' : '') + '" data-sb-rar="' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>' +
            '<div class="sb-set"><label>Заголовок акции</label><input type="text" data-sb-heading maxlength="30" value="' + e(it.heading || '') + '" placeholder="Например: Зимняя ярмарка"></div>' +
            '<div class="sb-set"><label>Фон карточки</label>' + cardBgGallery(it.card_bg || '', 'data-sb-cbg', 'data-sb-cbgfile') + '</div>' +
            '<div class="sb-actions"><button type="button" data-sb-act="edit">Изменить всё</button><button type="button" data-sb-act="earlier">← Раньше</button><button type="button" data-sb-act="later">Позже →</button>' +
            '<button type="button" data-sb-act="status">' + (it.status === 'active' ? 'Скрыть' : 'Показать') + '</button><button type="button" class="danger" data-sb-act="delete">Удалить</button></div><p class="sub sb-hint">' + note + '</p></div>';
    };
    const boardSection = () => '<div class="sb-wrap"><h3>Витрина магазина</h3><p class="sub">Так лоты выглядят у игроков. Меняйте порядок перетаскиванием, как пазл.</p>' +
        '<div class="sb-board ny-grid" id="sb-board">' + (r.items.length ? boardHTML() : '<p class="sub">Товаров пока нет: добавьте первый ниже.</p>') + '</div><div id="sb-drawer">' + drawerHTML() + '</div></div>';
    const redrawBoard = () => {
        const board = sec.querySelector('#sb-board'), drawer = sec.querySelector('#sb-drawer');
        if (board) board.innerHTML = r.items.length ? boardHTML() : '<p class="sub">Товаров пока нет: добавьте первый ниже.</p>';
        if (drawer) drawer.innerHTML = drawerHTML();
        bindBoard();
    };
    const open = id => { selected = id; redrawBoard(); sec.querySelector('#sb-drawer')?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); };
    const startDrag = (ev, cell) => {
        const board = sec.querySelector('#sb-board');
        if (!board || ev.button > 0) return;
        ev.preventDefault();
        const box = cell.getBoundingClientRect(), grab = {x: ev.clientX - box.left, y: ev.clientY - box.top};
        const ghost = cell.cloneNode(true);
        ghost.classList.add('sb-ghost'); ghost.removeAttribute('data-sb');
        ghost.style.cssText = 'position:fixed;left:' + box.left + 'px;top:' + box.top + 'px;width:' + box.width + 'px;height:' + box.height + 'px;z-index:99999;pointer-events:none';
        document.body.appendChild(ghost);
        cell.classList.add('is-drag');
        let scroller = null;
        for (let n = sec.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) { scroller = n; break; } }
        const flip = mutate => {
            const cells = [...board.children], before = new Map(cells.map(c => [c, c.getBoundingClientRect()]));
            mutate();
            cells.forEach(c => {
                if (c === cell) return;
                const a = before.get(c), b = c.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
                if (!dx && !dy) return;
                c.style.transition = 'none'; c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
                requestAnimationFrame(() => { c.style.transition = 'transform .3s cubic-bezier(.22,.8,.3,1)'; c.style.transform = ''; });
            });
        };
        const move = ev2 => {
            ghost.style.left = (ev2.clientX - grab.x) + 'px'; ghost.style.top = (ev2.clientY - grab.y) + 'px';
            const step = ev2.clientY < 70 ? -16 : ev2.clientY > innerHeight - 70 ? 16 : 0;
            if (step) (scroller || window).scrollBy(0, step);
            const hit = document.elementsFromPoint(ev2.clientX, ev2.clientY).find(n => n !== cell && n.classList && n.classList.contains('sb-cell') && board.contains(n));
            if (!hit) return;
            const hb = hit.getBoundingClientRect();
            const after = hb.width > hb.height * 1.3 ? ev2.clientX > hb.left + hb.width / 2 : ev2.clientY > hb.top + hb.height / 2 || (hb.width <= hb.height * 1.3 && ev2.clientX > hb.left + hb.width / 2 && ev2.clientY > hb.top + hb.height * .25);
            const ref = after ? hit.nextSibling : hit;
            if (ref === cell || (after && hit.nextSibling === cell)) return;
            flip(() => board.insertBefore(cell, ref));
        };
        const end = async () => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
            ghost.remove(); cell.classList.remove('is-drag');
            const ids = [...board.children].map(c => c.dataset.sb).filter(Boolean);
            if (ids.join() === r.items.map(i => i.id).join()) return;
            r.items = ids.map(id => r.items.find(i => i.id === id)); r.order = 'manual';
            try { await api('admin/new-year/shop-arrange', {ids}); toast('Порядок сохранён'); } catch (err) { toast(err.message); }
            redrawBoard();
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    };
    const bindBoard = () => {
        sec.querySelectorAll('.sb-cell').forEach(cell => {
            cell.addEventListener('dblclick', () => open(cell.dataset.sb));
            cell.querySelector('[data-sb-gear]')?.addEventListener('click', () => open(cell.dataset.sb));
            cell.querySelector('[data-sb-drag]')?.addEventListener('pointerdown', ev => startDrag(ev, cell));
        });
        const it = r.items.find(x => x.id === selected), drawer = sec.querySelector('#sb-drawer');
        drawer?.querySelector('[data-sb-close]')?.addEventListener('click', () => { selected = null; redrawBoard(); });
        drawer?.querySelector('[data-sb-price]')?.addEventListener('click', () => run(() => api('admin/new-year/shop-order', {mode: 'price'}), 'Порядок: по возрастанию цены'));
        const styleIt = async (patch) => { try { await api('admin/new-year/shop/' + it.id + '/style', patch); Object.assign(it, patch); redrawBoard(); } catch (err) { toast(err.message); } };
        drawer?.querySelectorAll('[data-sb-sec]').forEach(b => b.addEventListener('click', async () => { try { await api('admin/new-year/shop/' + it.id + '/section', {section_id: b.dataset.sbSec}); it.section_id = b.dataset.sbSec; redrawBoard(); toast('Раздел изменён'); } catch (err) { toast(err.message); } }));
        drawer?.querySelector('[data-sb-save]')?.addEventListener('click', async () => {
            const patch = {};
            drawer.querySelectorAll('[data-sb-q]').forEach(i => { patch[i.dataset.sbQ] = i.value; });
            try {
                await api('admin/new-year/shop/' + it.id + '/style', patch);
                const fresh = await api('admin/new-year/shop'); r.items = fresh.items; r.sections = fresh.sections || r.sections;
                redrawBoard(); toast('Сохранено');
            } catch (err) { toast(err.message); }
        });
        drawer?.querySelectorAll('[data-sb-rar]').forEach(b => b.addEventListener('click', () => styleIt({rarity: b.dataset.sbRar})));
        drawer?.querySelectorAll('[data-sb-cbg]').forEach(b => b.addEventListener('click', () => styleIt({card_bg: b.dataset.sbCbg})));
        drawer?.querySelector('[data-sb-heading]')?.addEventListener('change', ev => styleIt({heading: ev.target.value}));
        drawer?.querySelector('[data-sb-cbgfile]')?.addEventListener('change', async ev => { const file = ev.target.files[0]; if (!file) return; try { styleIt({card_bg: 'image:' + await uploadMedia(file)}); } catch (err) { toast(err.message); } });
        drawer?.querySelectorAll('[data-sb-size]').forEach(b => b.addEventListener('click', async () => {
            if (!it) return;
            try { await api('admin/new-year/shop/' + it.id + '/size', {size: b.dataset.sbSize}); it.size = b.dataset.sbSize; redrawBoard(); } catch (err) { toast(err.message); }
        }));
        drawer?.querySelectorAll('[data-sb-act]').forEach(b => b.addEventListener('click', async () => {
            if (!it) return;
            const act = b.dataset.sbAct;
            try {
                if (act === 'edit') { startEdit(it.id); return; }
                if (act === 'status') { const next = it.status === 'active' ? 'hidden' : 'active'; await api('admin/new-year/shop/' + it.id + '/status', {status: next}); it.status = next; redrawBoard(); return; }
                if (act === 'delete') { if (!confirm('Удалить лот «' + it.title + '»?')) return; await api('admin/new-year/shop/' + it.id + '/delete', {}); r.items = r.items.filter(x => x.id !== it.id); selected = null; redrawBoard(); toast('Лот удалён'); return; }
                const at = r.items.indexOf(it), to = act === 'earlier' ? at - 1 : at + 1;
                if (to < 0 || to >= r.items.length) return;
                await api('admin/new-year/shop/' + it.id + '/move', {direction: act === 'earlier' ? 'up' : 'down'});
                r.items.splice(to, 0, r.items.splice(at, 1)[0]); r.order = 'manual'; redrawBoard();
            } catch (err) { toast(err.message); }
        }));
    };

    const icoOf = v => v && v.indexOf('/media/') === 0 ? '<img src="' + e(v) + '" alt="">' : (window.crafterFestive ? window.crafterFestive.iconHTML(v || 'builtin:star') : '');
    const mediaPick = (key, label, val) => '<div class="adm-field"><label>' + label + '</label><div class="fm-up">' + (val && val.indexOf('/media/') === 0 ? '<img src="' + e(val) + '" alt="">' : '<i>нет</i>') +
        '<label class="fm-upbtn">Загрузить<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" data-sec-file="' + key + '" hidden></label>' + (val && val.indexOf('/media/') === 0 ? '<button type="button" data-sec-clear="' + key + '">Убрать</button>' : '') + '</div></div>';
    const bgName = s => ((window.crafterFestive?.bgKeys || []).find(k => k[0] === s.bg) || [0, s.bg.indexOf('image:') === 0 ? 'своя картинка' : s.bg])[1];
    const sectionsHTML = () => {
        const list = (r.sections || []).map(s => '<div class="fm-srow' + (s.enabled ? '' : ' is-off') + '"><span class="fm-sico">' + icoOf(s.icon) + '</span><b>' + e(s.title) + '</b><small>' + (s.kind === 'custom' ? 'свой раздел' : s.kind === 'exchange' ? 'раздел обмена' : 'встроенный') + ' · фон: ' + e(bgName(s)) + (s.enabled ? '' : ' · скрыт') + '</small>' +
            (s.preview ? '<img class="fm-spv" src="' + e(s.preview) + '" alt="">' : '') +
            '<span class="fm-sbt"><button type="button" data-sec-up="' + e(s.id) + '" aria-label="Выше">↑</button><button type="button" data-sec-down="' + e(s.id) + '" aria-label="Ниже">↓</button><button type="button" data-sec-edit="' + e(s.id) + '">Изменить</button>' +
            (s.kind !== 'smart' ? '<button type="button" data-sec-del="' + e(s.id) + '">Удалить</button>' : '') + '</span></div>').join('');
        let form = '';
        if (secForm) {
            const bgs = window.crafterFestive?.bgKeys || [];
            const ic = window.crafterFestive?.icons || {}, icons = Object.keys(ic).filter((k, i, all) => all.findIndex(x => ic[x] === ic[k]) === i);
            form = '<div class="adm-step fm-sform"><h4>' + (secForm.id ? 'Раздел: изменить' : 'Новый раздел') + '</h4><div class="adm-row3"><div class="adm-field"><label>Название (до 24 знаков)</label><input data-sf="title" maxlength="24" value="' + e(secForm.title) + '" placeholder="Новый год"></div>' +
                '<div class="adm-field"><label>Показывать игрокам</label><select data-sf="enabled"><option value="1"' + (secForm.enabled ? ' selected' : '') + '>Да</option><option value="0"' + (secForm.enabled ? '' : ' selected') + '>Нет</option></select></div></div>' +
                '<div class="adm-field"><label>Значок из набора</label><div class="fm-icons">' + icons.map(k => '<button type="button" class="fm-iconopt' + (secForm.icon === 'builtin:' + k ? ' is-on' : '') + '" data-sf-icon="builtin:' + e(k) + '">' + window.crafterFestive.iconHTML('builtin:' + k) + '</button>').join('') + '</div></div>' +
                mediaPick('icon', 'или свой значок (SVG или PNG)', secForm.icon) + mediaPick('preview', 'Картинка справа от кнопки раздела', secForm.preview) +
                '<div class="adm-field"><label>Фон раздела</label>' + secBgGallery(secForm.bg) + '</div>' +
                mediaPick('bg', 'или своя картинка фоном', secForm.bg.indexOf('image:') === 0 ? secForm.bg.slice(6) : '') +
                '<button class="primary" type="button" id="sec-save">Сохранить раздел</button> <button type="button" id="sec-cancel">Отмена</button></div>';
        }
        return '<h3 style="margin-top:26px">Разделы маркета</h3><p class="sub">Кнопки слева в маркете. У каждого раздела свой значок, картинка справа от кнопки и свой фон. Лоты кладутся в раздел в форме товара ниже.</p><div class="fm-slist">' + list + '</div>' +
            (secForm ? '' : '<button type="button" id="sec-add">+ Добавить раздел</button> <button type="button" id="sec-add-ex">+ Раздел обмена</button>') + form;
    };
    const bindSections = () => {
        const reload = async () => { try { r.sections = (await api('admin/new-year/shop')).sections || r.sections; } catch (_) {} };
        const title = () => { const i = sec.querySelector('[data-sf="title"]'); if (i && secForm) secForm.title = i.value; };
        const redraw = () => { pull(); draw(); };
        sec.querySelector('#sec-add')?.addEventListener('click', () => { secForm = {title: '', icon: 'builtin:star', preview: '', bg: 'night', enabled: true}; redraw(); });
        sec.querySelector('#sec-add-ex')?.addEventListener('click', () => { secForm = {title: 'Обмен', icon: 'builtin:gem', preview: '', bg: 'blue', enabled: true, kind: 'exchange'}; redraw(); });
        sec.querySelector('#sec-cancel')?.addEventListener('click', () => { secForm = null; redraw(); });
        sec.querySelectorAll('[data-sec-edit]').forEach(b => b.addEventListener('click', () => { const s = r.sections.find(x => x.id === b.dataset.secEdit); secForm = {id: s.id, title: s.title, icon: s.icon, preview: s.preview, bg: s.bg, enabled: s.enabled}; redraw(); sec.querySelector('.fm-sform')?.scrollIntoView({behavior: 'smooth', block: 'center'}); }));
        sec.querySelectorAll('[data-sec-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Удалить раздел? Его лоты вернутся в автоматические разделы.')) return; try { await api('admin/new-year/shop-sections/' + b.dataset.secDel + '/delete', {}); await reload(); toast('Раздел удалён'); redraw(); } catch (err) { toast(err.message); } }));
        sec.querySelectorAll('[data-sec-up],[data-sec-down]').forEach(b => b.addEventListener('click', async () => {
            const id = b.dataset.secUp || b.dataset.secDown, ids = r.sections.map(s => s.id), at = ids.indexOf(id), to = b.dataset.secUp ? at - 1 : at + 1;
            if (to < 0 || to >= ids.length) return;
            ids.splice(to, 0, ids.splice(at, 1)[0]);
            try { await api('admin/new-year/shop-sections-arrange', {ids}); await reload(); redraw(); } catch (err) { toast(err.message); }
        }));
        if (!secForm) return;
        sec.querySelectorAll('[data-sf]').forEach(i => i.addEventListener('change', () => { secForm[i.dataset.sf] = i.dataset.sf === 'enabled' ? i.value === '1' : i.value; }));
        sec.querySelectorAll('[data-sf-icon]').forEach(b => b.addEventListener('click', () => { title(); secForm.icon = b.dataset.sfIcon; redraw(); }));
        sec.querySelectorAll('[data-sf-bg]').forEach(b => b.addEventListener('click', () => { title(); secForm.bg = b.dataset.sfBg; redraw(); }));
        sec.querySelectorAll('[data-sec-clear]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.secClear; title(); if (k === 'bg') secForm.bg = 'night'; else secForm[k] = k === 'icon' ? 'builtin:star' : ''; redraw(); }));
        sec.querySelectorAll('[data-sec-file]').forEach(inp => inp.addEventListener('change', async () => {
            const file = inp.files[0]; if (!file) return;
            if (file.size > 600000) { toast('Файл должен быть не больше 600 КБ'); return; }
            const body = new FormData(); body.append('file', file);
            try { const out = await api('admin/new-year/shop-media', body); const k = inp.dataset.secFile; title(); if (k === 'bg') secForm.bg = 'image:' + out.url; else secForm[k] = out.url; redraw(); } catch (err) { toast(err.message); }
        }));
        sec.querySelector('#sec-save')?.addEventListener('click', async () => {
            title();
            try { await api('admin/new-year/shop-sections', secForm); await reload(); secForm = null; toast('Раздел сохранён'); redraw(); } catch (err) { toast(err.message); }
        });
    };
    const draw = () => {
        const kinds = KIND_TILES.filter(k => !(k[0] === 'PACK' && !packs.length) && !(k[0] === 'STAR' && !STARS.length));
        const step2 = f.kind === 'PROMO' ? '<div class="adm-step"><h4>Что даёт промокод</h4><div class="adm-tiles small">' + PROMO_TILES.filter(k => !(k[0] === 'PACK' && !packs.length) && !(k[0] === 'STAR' && !STARS.length)).map(k => tile(f.promo === k[0], 'data-promo="' + k[0] + '"', k[2], k[1])).join('') + '</div></div>' : '';
        const mixTotal = Object.values(f.mix).reduce((x, n) => x + n, 0);
        const what = f.kind === 'BUNDLE'
            ? '<div class="adm-step"><h4>Состав: бандл, акция с выбором или случайный пак</h4><div class="adm-chips" style="margin-bottom:10px">' + [['', 'Всё сразу (бандл)'], ['choice', 'Игрок выбирает один пак'], ['random', 'Случайный пак']].map(m => '<button type="button" data-mode="' + m[0] + '"' + (f.mode === m[0] ? ' class="is-on"' : '') + '>' + m[1] + '</button>').join('') + '</div><p class="sub">' + (f.mode === 'choice' ? 'Игрок смотрит варианты и покупает любой один: отметьте от 2 разных паков (число рядом — сколько штук такого пака он получит).' : f.mode === 'random' ? 'Игрок покупает чёрный пак со знаком вопроса и получает случайный из отмеченных (от 2 разных).' : 'Игрок получит всё сразу за одну покупку: любые паки (до 500), GRAM на баланс и шары.') + ' Паков сейчас: <b>' + mixTotal + '</b>.</p><div class="si-mix">' + packs.map(p => '<div class="si-mix-row' + ((f.mix[p.id] || 0) > 0 ? ' is-on' : '') + '"><img src="' + e(p.image) + '" alt=""><b>' + e(p.title) + '</b><span class="si-mix-step"><button type="button" data-mix-dec="' + e(p.id) + '" aria-label="Меньше">−</button><input class="si-mix-n" type="number" min="0" max="500" data-mix-set="' + e(p.id) + '" value="' + (f.mix[p.id] || 0) + '"><button type="button" data-mix-inc="' + e(p.id) + '" aria-label="Больше">+</button></span></div>').join('') + '</div>' + (f.mode ? '' : '<div class="adm-row3" style="margin-top:12px"><div class="adm-field"><label>GRAM на баланс</label><input data-f="bgram" inputmode="decimal" value="' + e(f.bgram) + '" placeholder="Без GRAM"></div><div class="adm-field"><label>Новогодние шары</label><input data-f="bballs" inputmode="numeric" value="' + e(f.bballs) + '" placeholder="Без шаров"></div></div>') + '</div>'
            : eff() === 'PACK'
            ? '<div class="adm-step"><h4>Какой пак</h4>' + window.crafterPacks.packTiles(packs, f.pack) + '</div>'
            : eff() === 'STAR'
            ? '<div class="adm-step"><h4>Какой подарок</h4><div class="adm-field"><select data-f="amount">' + window.crafterStarGifts.options(STARS, f.amount) + '</select></div></div>'
            : '<div class="adm-step"><h4>' + (eff() === 'BALL' ? 'Сколько шаров' : 'Сколько GRAM') + '</h4><div class="adm-field"><input data-f="amount" inputmode="decimal" value="' + e(f.amount) + '">' +
              '<div class="adm-chips">' + (eff() === 'BALL' ? ['50', '100', '500', '1000'] : ['0.5', '1', '2', '5', '10']).map(v => '<button type="button" data-chip="amount" data-v="' + v + '">' + v + '</button>').join('') + '</div></div></div>';
        sec.innerHTML = boardSection() + sectionsHTML() + '<h3 style="margin-top:26px" id="si-form">' + (editing ? 'Изменить товар' : 'Новый товар') + '</h3>' + (editing ? '<div class="si-editing">Вы меняете: <b>' + e(f.title || autoTitle()) + '</b><button type="button" data-si-cancel>Отмена, создать новый</button></div>' : '<p class="sub">Товар за новогодние шары. Появится в особом маркете.</p>') +
            '<div class="adm-step"><h4>Что продаём</h4><div class="adm-tiles">' + kinds.map(k => tile(f.kind === k[0], 'data-kind="' + k[0] + '"', k[3], k[1], k[2])).join('') + '</div></div>' +
            step2 + what +
            '<div class="adm-step"><h4>Условия</h4><div class="adm-row3">' +
            '<div class="adm-field"><label>Цена в шарах</label><input data-f="price" type="number" min="0" step="1" value="' + e(f.price) + '"><div class="adm-chips"><button type="button" data-chip="price" data-v="0">Бесплатно</button><button type="button" data-chip="price" data-v="50">50</button><button type="button" data-chip="price" data-v="100">100</button></div></div>' +
            '<div class="adm-field"><label>Старая цена (скидка)</label><input data-f="old" type="number" min="0" step="1" value="' + e(f.old) + '" placeholder="Без скидки"><small class="sub">' + (Number(f.old) > Number(f.price) ? 'Скидка ' + Math.round((1 - Number(f.price) / Number(f.old)) * 100) + '%' : 'Больше текущей цены') + '</small></div>' +
            '<div class="adm-field"><label>Сколько всего</label><input data-f="stock" type="number" min="1" step="1" value="' + e(f.stock) + '" placeholder="Без ограничений"></div>' +
            '</div>' + ((eff() === 'PACK') || eff() === 'STAR' ? range('bundle', eff() === 'STAR' ? 'Подарков за одну покупку' : 'Паков за одну покупку', 1, 20, f.bundle, fmtBundle) : '') +
            range('per', 'Сколько раз может купить один игрок', 0, 20, f.per, fmtPer) + '</div>' +
            '<details class="adm-more"' + (f.image || f.title || f.description ? ' open' : '') + '><summary>Название, описание и картинка</summary><div class="adm-row3">' +
            '<div class="adm-field"><label>Название</label><input data-f="title" maxlength="80" value="' + e(f.title) + '" placeholder="' + e(autoTitle()) + '"></div>' +
            '<div class="adm-field" style="grid-column:span 2"><label>Картинка (ссылка)</label><input data-f="image" value="' + e(f.image) + '" placeholder="По умолчанию подставится сама"></div>' +
            '<div class="adm-field" style="grid-column:1/-1"><label>Описание лота</label><textarea data-f="description" maxlength="240" rows="3" placeholder="' + e(describe({...{kind: f.kind, promo_kind: f.promo, amount: f.amount, bundle: f.bundle, contents: null}})) + '">' + e(f.description) + '</textarea>' +
            '<small class="sub si-desc-count"><span data-count>' + String(f.description || '').length + '</span>/240 · показывается в широкой и большой плитках, в баннере и в окне товара</small></div></div></details>' +
            '<div class="adm-step"><h4>Оформление акции</h4><p class="sub">Редкость задаёт цвет и название акции в маркете. «Авто» выбирает её по цене.</p><div class="fm-rar">' +
            RARS.map(r => '<button type="button" class="fm-rar-opt' + (f.rarity === r[0] ? ' is-on' : '') + '" data-rar="' + r[0] + '" style="--c1:' + r[2] + ';--c2:' + r[3] + '"><i></i><b>' + r[1] + '</b></button>').join('') + '</div>' +
            '<div class="adm-field"><label>Раздел</label><div class="adm-chips">' + sectionChips(f.section_id, 'data-fsec') + '</div></div>' +
            '<details class="fm-special"' + (f.rarity === 'special' || f.heading || f.card_bg ? ' open' : '') + '><summary>Особое оформление: свой заголовок и фон' + (f.rarity === 'special' ? ' (для особой акции)' : '') + '</summary>' +
            '<div class="adm-field"><label>Заголовок акции</label><input data-f="heading" maxlength="30" value="' + e(f.heading) + '" placeholder="Например: Зимняя ярмарка"></div>' +
            '<div class="adm-field"><label>Фон карточки и окна лота</label>' + cardBgGallery(f.card_bg, 'data-cbg', 'data-cbg-file') + '</div></details>' +
            '<div class="adm-row3"><div class="adm-field"><label>Значок на карточке</label><input data-f="badge" maxlength="14" value="' + e(f.badge) + '" placeholder="НОВОЕ, ХИТ"></div>' +
            '<div class="adm-field"><label>Появится (по Москве)</label><input type="datetime-local" data-f="startsMsk" value="' + e(f.startsMsk) + '"><small class="sub">Пусто: сразу. До этого момента игроки акцию не видят.</small></div>' +
            '<div class="adm-field"><label>Закончится (по Москве)</label><input type="datetime-local" data-f="endsMsk" value="' + e(f.endsMsk) + '"><small class="sub">Пусто: без срока.</small></div></div>' +
            '<div class="adm-field"><label>Или быстро: на сколько от этой минуты</label><div class="adm-chips">' + [['', 'Не менять'], ['24', '1 день'], ['72', '3 дня'], ['168', '7 дней'], ['336', '14 дней'], ['720', '30 дней']].map(c =>
                '<button type="button" data-chip="endsH" data-v="' + c[0] + '"' + (String(f.endsH) === c[0] && c[0] !== '' ? ' class="is-on"' : '') + '>' + c[1] + '</button>').join('') + '</div></div></div>' +
            '<div class="adm-step"><h4>Размер плитки</h4><p class="sub">Как плитка стоит в магазине: можно сделать широкую, длинную, большую или баннер на всю ширину.</p><div class="sz-pick">' +
            SIZES.map(s => '<button type="button" class="sz-opt' + (f.size === s[0] ? ' is-on' : '') + '" data-size="' + s[0] + '"><span class="sz-shape sz-' + s[0] + '" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><b>' + s[1] + '</b><small>' + s[2] + '</small></button>').join('') + '</div></div>' +
            '<div class="adm-step"><h4>Как будет выглядеть</h4><p class="sub">Живой предпросмотр отдельной страницей: слева телефон (вертикально), справа компьютер (горизонтально). <a href="/shop/preview" target="_blank" rel="noopener">Открыть на весь экран</a></p>' +
            '<div class="fm-pvs"><div class="fm-pv-phone"><iframe class="fm-pv" data-fm-pv="phone" src="/shop/preview?device=phone" title="Телефон"></iframe></div>' +
            '<div class="fm-pv-pc"><div class="fm-pv-bar"><i></i><i></i><i></i></div><iframe class="fm-pv" data-fm-pv="pc" src="/shop/preview?device=pc" title="Компьютер"></iframe></div></div></div>' +
            '<button class="primary" type="button" id="si-add">' + (editing ? 'Сохранить изменения' : 'Добавить товар') + '</button>' + (editing ? ' <button type="button" id="si-cancel">Отмена</button>' : '') +
            '';
        sec.querySelectorAll('input[data-f]').forEach(i => { i.setAttribute('autocomplete', 'off'); i.setAttribute('name', 'shop-' + i.dataset.f); });
        bind();
    };
    const pull = () => sec.querySelectorAll('[data-f]').forEach(i => { f[i.dataset.f] = i.value; });
    const run = async (fn, ok) => { try { await fn(); toast(ok); content.innerHTML = ''; window.renderAdminNewYear?.(content); } catch (err) { toast(err.message); } };
    const bind = () => {
        bindBoard();
        sendPreview();
        sec.querySelectorAll('[data-cbg]').forEach(b => b.addEventListener('click', () => { pull(); f.card_bg = b.dataset.cbg; sec.querySelectorAll('[data-cbg],.fm-swup').forEach(x => x.classList.toggle('is-on', x === b)); sendPreview(); }));
        sec.querySelector('[data-cbg-file]')?.addEventListener('change', async ev => { const file = ev.target.files[0]; if (!file) return; try { pull(); f.card_bg = 'image:' + await uploadMedia(file); draw(); } catch (err) { toast(err.message); } });
        sec.querySelectorAll('[data-fsec]').forEach(b => b.addEventListener('click', () => { pull(); f.section_id = b.dataset.fsec; sec.querySelectorAll('[data-fsec]').forEach(x => x.classList.toggle('is-on', x === b)); sendPreview(); }));
        sec.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { pull(); f.mode = b.dataset.mode; draw(); }));
        sec.querySelector('[data-f="endsMsk"]')?.addEventListener('change', () => { f.endsH = ''; });
        bindSections();
        sec.querySelectorAll('[data-rar]').forEach(b => b.addEventListener('click', () => { pull(); f.rarity = b.dataset.rar; draw(); }));
        sec.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { pull(); f.kind = b.dataset.kind; f.amount = eff() === 'STAR' ? (STARS[0]?.key || 'bear') : eff() === 'BALL' ? '100' : '1'; draw(); }));
        sec.querySelectorAll('[data-promo]').forEach(b => b.addEventListener('click', () => { pull(); f.promo = b.dataset.promo; f.amount = eff() === 'STAR' ? (STARS[0]?.key || 'bear') : eff() === 'BALL' ? '100' : '1'; draw(); }));
        sec.querySelectorAll('[data-mix-inc]').forEach(b => b.addEventListener('click', () => { pull(); const t = Object.values(f.mix).reduce((x, n) => x + n, 0); if (t < 500) f.mix[b.dataset.mixInc] = (f.mix[b.dataset.mixInc] || 0) + 1; draw(); }));
        sec.querySelectorAll('[data-mix-set]').forEach(i => i.addEventListener('change', () => { pull(); f.mix[i.dataset.mixSet] = Math.max(0, Math.min(500, Math.floor(Number(i.value) || 0))); draw(); }));
        sec.querySelectorAll('[data-mix-dec]').forEach(b => b.addEventListener('click', () => { pull(); f.mix[b.dataset.mixDec] = Math.max(0, (f.mix[b.dataset.mixDec] || 0) - 1); draw(); }));
        sec.querySelectorAll('[data-adm-pack]').forEach(b => b.addEventListener('click', () => { pull(); f.pack = b.dataset.admPack; draw(); }));
        sec.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => { pull(); f.size = b.dataset.size; draw(); }));
        sec.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { pull(); f.view = b.dataset.view; draw(); }));
        sec.querySelectorAll('[data-si-size]').forEach(b => b.addEventListener('change', () => run(() => api('admin/new-year/shop/' + b.dataset.siSize + '/size', {size: b.value}), 'Размер изменён')));
        sec.querySelector('textarea[data-f="description"]')?.addEventListener('input', ev => {
            const out = sec.querySelector('[data-count]'); if (out) out.textContent = ev.target.value.length;
            const live = sec.querySelector('.sz-grid .si-tile .si-desc'); if (live) live.textContent = ev.target.value || describe(Object.assign({}, f, {description: ''}));
        });
        sec.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => { pull(); f[b.dataset.chip] = b.dataset.v; if (b.dataset.chip === 'endsH') { f.endsAt = null; f.endsMsk = ''; } draw(); }));
        sec.querySelectorAll('[data-f]').forEach(i => i.addEventListener('change', () => { pull(); if (i.dataset.f === 'endsMsk') { f.endsH = ''; draw(); } else sendPreview(); }));
        sec.querySelectorAll('input[type=range]').forEach(i => i.addEventListener('input', () => {
            const min = Number(i.min), max = Number(i.max), v = Number(i.value);
            i.style.setProperty('--p', ((v - min) / (max - min) * 100) + '%');
            const out = sec.querySelector('[data-out="' + i.dataset.f + '"]');
            if (out) out.textContent = (i.dataset.fmt === 'per' ? fmtPer : fmtBundle)(v);
        }));
        sec.querySelector('#si-add').addEventListener('click', () => {
            pull();
            run(() => api(editing ? 'admin/new-year/shop/' + editing + '/edit' : 'admin/new-year/shop', {contents: f.kind === 'BUNDLE' && f.mode ? Object.entries(f.mix).filter(([, n]) => n > 0).map(([pack_id, count]) => ({pack_id, count})) : f.kind === 'BUNDLE' ? {packs: Object.entries(f.mix).filter(([, n]) => n > 0).map(([pack_id, count]) => ({pack_id, count})), gram: f.bgram, balls: f.bballs} : undefined, kind: f.kind === 'BUNDLE' && f.mode ? 'PACK' : f.kind, promo_kind: f.promo, amount: eff() === 'PACK' ? f.pack : f.amount, price_balls: f.price || 0, old_price_balls: f.old || '', stock: f.stock, per_user: f.per === '0' ? '' : f.per, bundle: eff() === 'PACK' || eff() === 'STAR' ? f.bundle : 1, image_url: f.image, title: f.title, size: f.size, description: f.description, rarity: f.rarity, badge: f.badge, section_id: f.section_id, heading: f.heading, card_bg: f.card_bg, mode: f.kind === 'BUNDLE' ? f.mode : '', starts_at_msk: f.startsMsk, ends_at_msk: f.endsH ? '' : f.endsMsk, ends_in_hours: f.endsH || ''}), editing ? 'Изменения сохранены' : 'Товар добавлен');
        });
        sec.querySelectorAll('[data-si-up],[data-si-down]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + (b.dataset.siUp || b.dataset.siDown) + '/move', {direction: b.dataset.siUp ? 'up' : 'down'}), 'Порядок изменён')));
        sec.querySelector('#si-order')?.addEventListener('click', () => run(() => api('admin/new-year/shop-order', {mode: 'price'}), 'Порядок: по возрастанию цены'));
        sec.querySelector('[data-si-cancel]')?.addEventListener('click', () => sec.querySelector('#si-cancel')?.click());
        sec.querySelector('#si-cancel')?.addEventListener('click', () => { editing = null; Object.assign(f, {kind: 'GRAM', promo: 'GRAM', amount: '1', price: '0', old: '', stock: '', per: '0', bundle: '1', image: '', title: '', mix: {}, bgram: '', bballs: '', size: 'small', description: '', rarity: 'auto', badge: '', endsH: '', endsAt: null, section_id: '', heading: '', card_bg: '', mode: '', startsMsk: '', endsMsk: ''}); draw(); });
        startEdit = id => {
            const it = r.items.find(x => x.id === id); if (!it) return;
            editing = it.id;
            Object.assign(f, {kind: it.kind, promo: it.promo_kind || 'GRAM', amount: it.amount, pack: it.kind === 'PACK' || it.promo_kind === 'PACK' ? it.amount : f.pack, price: String(it.price_balls), old: it.old_price_balls ? String(it.old_price_balls) : '', stock: it.stock === null ? '' : String(it.stock), per: it.per_user === null ? '0' : String(it.per_user), bundle: String(it.bundle || 1), image: it.image_url && !it.pack && !it.star ? it.image_url : '', title: it.title, mix: {}, bgram: it.gram || '', bballs: it.balls ? String(it.balls) : '', size: sizeOf(it), description: it.description || '', rarity: it.rarity || 'auto', badge: it.badge || '', endsH: '', endsAt: it.ends_at || null, section_id: it.section_id || '', heading: it.heading || '', card_bg: it.card_bg || '', mode: it.mode || '', startsMsk: it.starts_at ? toMsk(it.starts_at) : '', endsMsk: it.ends_at ? toMsk(it.ends_at) : ''});
            if (it.mode) { f.kind = 'BUNDLE'; f.mix = {}; }
            if (it.kind === 'BUNDLE' || it.mode) (it.contents || []).forEach(c => { f.mix[c.pack.id] = c.count; });
            draw(); sec.querySelector('#si-form')?.scrollIntoView({behavior: 'smooth', block: 'start'});
        };
        sec.querySelectorAll('[data-si-edit]').forEach(b => b.addEventListener('click', () => startEdit(b.dataset.siEdit)));
        sec.querySelectorAll('[data-si-st]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + b.dataset.siSt + '/status', {status: b.dataset.next}), 'Готово')));
        sec.querySelectorAll('[data-si-del]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + b.dataset.siDel + '/delete', {}), 'Товар удалён')));
    };
    draw();
}

window.crafterShopItems = {tiles, bind, admin, artHTML, describe, sizeOf, accentOf};
})();
