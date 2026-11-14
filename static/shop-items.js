/* Seasonal shop items besides NFT lots: GRAM balance, balls, card packs and promo codes, paid in balls. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img src="/static/assets/new-year-ornament.svg" alt="" aria-hidden="true">';
const LABEL = {GRAM: 'Баланс GRAM', BALL: 'Новогодние шары', PACK: 'Карточный пак', BUNDLE: 'Бандл', STAR: 'Подарок Telegram', PROMO: 'Промокод', CHEST: 'Ящик', DROP: 'Дроп', PASS: 'Pass Plus'};
let STARS = [], CHESTS = [], DROPS = [];
const MIXPRICE = {};                                          // choice offer: the price of every option (empty = the price of the lot)
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
    if (it.kind === 'BUNDLE') return (it.contents && it.contents[0] && it.contents[0].pack.image) || (it.chests_in && it.chests_in[0] && it.chests_in[0].chest.image) || (it.gram ? '/static/assets/gram.svg' : '/static/assets/new-year-ornament.svg');
    if (it.kind === 'PACK') return it.pack?.image || '/static/assets/packs/new-year-pack.webp';
    if (it.kind === 'STAR') return it.star?.image || '/static/assets/stargifts/bear.png';
    if (it.kind === 'CHEST') return it.chest?.image || '/static/assets/chests/gingerbread.png';
    if (it.kind === 'DROP') return it.drop?.image || '/static/assets/drops/snowman.png';
    if (it.kind === 'PASS') return it.pass?.image || '/static/assets/pass/ticket-plus.svg';
    return '/static/assets/community-reward.svg';
}
const unavailable = it => (it.left !== null && it.left <= 0) || (it.per_user !== null && it.mine >= it.per_user);
function describe(it) {
    if (it.description) return it.description;
    if (it.kind === 'GRAM') return 'На ваш баланс будет зачислено ' + num(it.amount) + ' GRAM.';
    if (it.kind === 'BALL') return 'На баланс добавится ' + num(it.amount) + ' новогодних шаров.';
    if (it.kind === 'BUNDLE') return 'В бандле: ' + [].concat((it.contents || []).map(c => c.pack.title + (c.count > 1 ? ' ×' + c.count : '')), (it.chests_in || []).map(c => c.chest.title + (c.count > 1 ? ' ×' + c.count : '')), (it.drops_in || []).map(c => c.drop.title + (c.count > 1 ? ' ×' + c.count : '')), it.gram ? [num(it.gram) + ' GRAM'] : [], it.balls ? [num(it.balls) + ' новогодних шаров'] : []).join(' + ') + '. Всё сразу за одну покупку.';
    if (it.kind === 'PACK' && it.contents && it.contents.length > 1) return 'В наборе: ' + it.contents.map(c => c.pack.title + (c.count > 1 ? ' ×' + c.count : '')).join(' + ') + '.';
    if (it.kind === 'PACK') return it.bundle > 1 ? 'Вы получите ' + it.bundle + ' карточных паков.' : 'Карточный пак с GRAM и подарками.';
    if (it.kind === 'PASS') return 'Pass Plus' + (it.pass?.season ? ' сезона «' + it.pass.season.title + '»' : '') + ': откроется верхняя дорога наград и особые квесты. Покупается один раз за сезон.';
    if (it.kind === 'DROP') return 'Дроп открывается сразу после покупки, как ящик: четыре нажатия поднимают редкость, и в конце выпадает одна награда — GRAM, шары, пак или NFT.';
    if (it.kind === 'CHEST') return 'Ящик открывается сразу после покупки: внутри шары, GRAM, паки или подарки. Что выпадет, решает случай.';
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
    ['CHEST', 'Ящик', 'Открывается сразу: награды по шансам', '/static/assets/chests/gingerbread.png'],
    ['DROP', 'Дроп', 'Открывается сразу: 4 нажатия, одна награда', '/static/assets/drops/snowman.png'],
    ['PASS', 'Pass Plus', 'Открывает Pass Plus текущего сезона', '/static/assets/pass/ticket-plus.svg'],
    ['PROMO', 'Промокод', 'Уникальный код для покупателя', '/static/assets/community-reward.svg'],
];
const PROMO_TILES = [['PASS', 'Pass Plus', '/static/assets/pass/ticket-plus.svg'], ['GRAM', 'GRAM', '/static/assets/gram.svg'], ['BALL', 'Шары', '/static/assets/new-year-ornament.svg'], ['PACK', 'Пак', '/static/assets/packs/new-year-pack.webp'], ['CHEST', 'Ящик', '/static/assets/chests/gingerbread.png']];
async function admin(content) {
    let r, packs = [];
    try { r = await api('admin/new-year/shop'); } catch (_) { return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) { STARS = []; }
    try { CHESTS = (await api('admin/new-year/chests')).chests.map(c => c.chest); } catch (_) { CHESTS = []; }
    try { DROPS = (await api('admin/drops')).drops; } catch (_) { DROPS = []; }
    let FBX = [], CHX = [];                                  // the gift calendars and the chains stand on the same board and in the same order as the offers
    try { const fr = await api('freebies'); FBX = (fr.events || []).map(x => Object.assign({now: fr.now}, x)); } catch (_) {}
    try { CHX = (await api('chains')).chains || []; } catch (_) {}
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section si-admin';
    sec.dataset.pane = 'shop';
    content.appendChild(sec);
    sec.addEventListener('click', async ev => {
        const d = ev.target.closest('[data-bg-lib-del]'); if (!d) return;
        ev.preventDefault(); ev.stopPropagation();
        try { r.bg_library = (await api('admin/new-year/shop-bg-library/delete', {url: d.dataset.bgLibDel})).library; toast('Фон убран из сохранённых'); redrawBoard(); if (typeof draw === 'function') draw(); } catch (err) { toast(err.message); }
    }, true);
    sec.addEventListener('click', async ev => {                       // clear a whole section: every offer of it is deleted
        if (!ev.target.closest('[data-sb-clear]')) return;
        const list = visible(), name = boardTab === '' ? 'Авто' : secTitle(boardTab) || 'раздел';
        if (!list.length || !confirm('Удалить ВСЕ акции раздела «' + name + '» (' + list.length + ' шт.)? Это нельзя отменить. То, что игроки уже получили, останется у них.')) return;
        try { const res = await api('admin/new-year/shop-clear', {section_id: boardTab, confirm: true}); const fresh = await api('admin/new-year/shop'); r.items = fresh.items; r.extra_order = fresh.extra_order || r.extra_order; r.order = fresh.order || r.order; r.sections = fresh.sections || r.sections; selected = null; toast('Удалено акций: ' + res.removed); redrawBoard(); } catch (err) { toast(err.message); }
    });
    sec.addEventListener('click', ev => { const b = ev.target.closest('[data-sb-tab]'); if (!b) return; boardTab = b.dataset.sbTab; selected = null; redrawBoard(); });
    const f = {kind: 'GRAM', promo: 'GRAM', amount: '1', pack: packs[0]?.id || '', price: '0', old: '', stock: '', per: '0', bundle: '1', image: '', title: '', mix: {}, items: [], bgram: '', bballs: '', size: 'small', view: 'phone', description: '', rarity: 'auto', badge: '', endsH: '', endsAt: null, section_id: '', heading: '', card_bg: '', mode: '', startsMsk: '', endsMsk: ''};
    let secForm = null;
    let editing = null;
    let startEdit = () => {};
    const toMsk = epoch => new Date((epoch + 3 * 3600) * 1000).toISOString().slice(0, 16);              // unix time -> 'YYYY-MM-DDTHH:MM' in Moscow time
    const mskEpoch = text => text ? Math.floor(Date.parse(text + ':00Z') / 1000) - 3 * 3600 : null;
    const uploadMedia = async file => {
        if (file.size > 15000000) throw new Error('Файл должен быть не больше 15 МБ');
        const body = new FormData(); body.append('file', file);
        return (await api('admin/new-year/shop-media', body)).url;
    };
    const uploadBg = async file => {                              // an uploaded background is remembered and can be picked again later
        const url = await uploadMedia(file);
        try { r.bg_library = (await api('admin/new-year/shop-bg-library', {url, name: file.name.replace(/\.[^.]+$/, '')})).library; } catch (_) {}
        return url;
    };
    const swPic = (key, cur, attr, title) => '<button type="button" class="fm-sw' + (cur === key ? ' is-on' : '') + '" ' + attr + '="' + e(key) + '"><span class="fm-swp"><span class="fm-swc' + (key && window.crafterScenes ? '' : ' cb-' + e(key || 'none')) + '">' + (key && window.crafterScenes ? window.crafterScenes.render(key, {still: true}) : '') + '</span></span><em>' + e(title) + '</em></button>';
    const swImg = (url, cur, attr, title, del) => '<span class="fm-sw fm-swlib' + (cur === 'image:' + url ? ' is-on' : '') + '"><button type="button" class="fm-swlibpick" ' + attr + '="image:' + e(url) + '"><span class="fm-swp" style="background-image:url(' + e(url) + ')"></span><em>' + e(title) + '</em></button>' +
        (del ? '<button type="button" class="fm-swdel" data-bg-lib-del="' + e(url) + '" title="Убрать из сохранённых" aria-label="Убрать из сохранённых">×</button>' : '') + '</span>';
    const upLabel = (cur, fileAttr, text) => '<label class="fm-sw fm-swup' + (cur && cur.indexOf('image:') === 0 ? ' is-on' : '') + '"><span class="fm-swp"' + (cur && cur.indexOf('image:') === 0 ? ' style="background-image:url(' + e(cur.slice(6)) + ')"' : '') + '><b>+</b></span><em>' + text + '</em><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden ' + fileAttr + '></label>';
    const galGroup = (title, inner) => inner ? '<div class="fm-gal-h">' + title + '</div><div class="fm-gal">' + inner + '</div>' : '';
    const bgGallery = (cur, attr, fileAttr, keys, isNew, uploadText) => {
        const lib = (r.bg_library || []).map(x => swImg(x.url, cur, attr, x.name, true)).join('') + upLabel(cur, fileAttr, uploadText);
        const chestBg = CHESTS.filter(c => c.bg_collection).map(c => swImg(c.bg_collection, cur, attr, c.title, false)).join('');
        const fresh = keys.filter(k => k[0] === '' || isNew(k[0])), old = keys.filter(k => k[0] !== '' && !isNew(k[0]));
        const oldOpen = old.some(k => k[0] === cur);
        return galGroup('Мои фоны (загруженные запоминаются)', lib) + galGroup('Фоны ящиков', chestBg) + galGroup('Спокойные', fresh.map(k => swPic(k[0], cur, attr, k[1])).join('')) +
            (old.length ? '<details class="fm-gal-old"' + (oldOpen ? ' open' : '') + '><summary>Старые фоны (' + old.length + ')</summary><div class="fm-gal">' + old.map(k => swPic(k[0], cur, attr, k[1])).join('') + '</div></details>' : '');
    };
    const cardBgGallery = (cur, attr, fileAttr) => bgGallery(cur, attr, fileAttr, window.crafterFestive?.cardBgKeys || [], k => /^c-soft/.test(k), 'Свой PNG');
    const secBgGallery = cur => bgGallery(cur, 'data-sf-bg', 'data-sf-bgfile', window.crafterFestive?.bgKeys || [], k => /^soft/.test(k), 'Свой PNG-фон');
    const secTitle = id => ((r.sections || []).find(x => x.id === id) || {}).title || '';
    const sectionChips = (cur, attr) => [['', 'Авто (по правилам)']].concat((r.sections || []).filter(x => x.kind !== 'exchange' && x.id !== 'gifts').map(x => [x.id, x.title])).map(c => '<button type="button" class="' + (cur === c[0] ? 'is-on' : '') + '" ' + attr + '="' + e(c[0]) + '">' + e(c[1]) + '</button>').join('');
    const eff = () => f.kind === 'PROMO' ? f.promo : f.kind;
    const range = (key, label, min, max, val, fmt) => '<div class="adm-range"><div class="adm-range-top"><label>' + label + '</label><b data-out="' + key + '">' + fmt(Number(val)) + '</b></div>' +
        '<input type="range" data-f="' + key + '" data-fmt="' + (key === 'per' ? 'per' : 'bundle') + '" min="' + min + '" max="' + max + '" step="1" value="' + val + '" style="--p:' + ((val - min) / (max - min) * 100) + '%"></div>';
    const fmtPer = v => v === 0 ? 'Без ограничений' : 'до ' + v;
    const fmtBundle = v => v === 1 ? '1 пак' : v < 5 ? v + ' пака' : v + ' паков';
    const tile = (on, attr, img, title, hint) => '<button type="button" class="adm-tile' + (on ? ' is-on' : '') + '" ' + attr + '><img src="' + e(img) + '" alt=""><b>' + title + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</button>';
    const previewItem = () => {
        const cellsOn = f.kind === 'BUNDLE' && !f.mode;
        const mixList = cellsOn ? f.items.filter(x => x.type === 'PACK').map(x => ({pack: packs.find(p => p.id === x.id), count: x.count})).filter(c => c.pack) : f.kind === 'BUNDLE' ? Object.entries(f.mix).filter(([, n]) => n > 0).map(([id, n]) => { const o = optInfo(id); return {pack: o ? {id, title: o.title, image: o.image, type: id.includes(':') ? 'X' : undefined} : null, count: n}; }).filter(c => c.pack) : [];
        const cellGram = cellsOn ? (f.items.find(x => x.type === 'GRAM') || {}).amount : f.bgram, cellBalls = cellsOn ? (f.items.find(x => x.type === 'BALL') || {}).amount : f.bballs;
        const chestSel = eff() === 'CHEST' ? CHESTS.find(c => c.id === f.amount) : null;
        const it = {chest: chestSel || null, contents: mixList.length ? mixList : null, gram: f.kind === 'BUNDLE' && !f.mode && Number(cellGram) > 0 ? cellGram : null, balls: f.kind === 'BUNDLE' && !f.mode && Number(cellBalls) > 0 ? cellBalls : null, chests_in: cellsOn ? f.items.filter(x => x.type === 'CHEST').map(x => ({chest: CHESTS.find(c => c.id === x.id), count: x.count})).filter(c => c.chest) : null, kind: f.kind === 'BUNDLE' && f.mode ? 'PACK' : f.kind, promo_kind: f.promo, amount: eff() === 'PACK' ? f.pack : f.amount, star: eff() === 'STAR' ? STARS.find(x => x.key === f.amount) : null, bundle: mixList.length ? mixList.reduce((x, c) => x + c.count, 0) : (Number(f.bundle) || 1), per_user: Number(f.per) || null, mine: 0, old_price_balls: Number(f.old) > Number(f.price) ? Number(f.old) : null, discount_percent: Number(f.old) > Number(f.price) ? Math.round((1 - Number(f.price) / Number(f.old)) * 100) : null, title: f.title || autoTitle(), image_url: f.image || (chestSel ? chestSel.image : ''),
            pack: packs.find(p => p.id === f.pack) ? {image: packs.find(p => p.id === f.pack).image} : null, price_balls: Number(f.price) || 0, left: f.stock ? Number(f.stock) : null, size: f.size, description: f.description, rarity: f.rarity, badge: f.badge, section_id: f.section_id, heading: f.heading, card_bg: f.card_bg || (chestSel && chestSel.bg_collection ? 'image:' + chestSel.bg_collection : ''), mode: f.mode, id: 'preview',
            ends_at: f.endsH ? Math.floor(Date.now() / 1000) + Number(f.endsH) * 3600 : (f.endsMsk ? mskEpoch(f.endsMsk) : f.endsAt)};
        return it;
    };
    const preview = () => tiles([previewItem()])[0] || '';
    const sendPreview = () => sec.querySelectorAll('[data-fm-pv]').forEach(fr => {
        const post = () => { try { fr.contentWindow.postMessage({type: 'fm-preview', items: [previewItem()], sections: r.sections || []}, location.origin); } catch (_) {} };
        post(); fr.addEventListener('load', post, {once: true});
    });
    const itemInfo = x => x.type === 'PACK' ? {img: packs.find(p => p.id === x.id)?.image || '', name: packs.find(p => p.id === x.id)?.title || 'Пак', n: '×' + x.count}
        : x.type === 'CHEST' ? {img: CHESTS.find(c => c.id === x.id)?.image || '', name: CHESTS.find(c => c.id === x.id)?.title || 'Ящик', n: '×' + x.count}
        : x.type === 'DROP' ? {img: DROPS.find(c => c.id === x.id)?.image || '/static/assets/drops/snowman.png', name: DROPS.find(c => c.id === x.id)?.title || 'Дроп', n: '×' + x.count}
        : x.type === 'PASS' ? {img: '/static/assets/pass/ticket-plus.svg', name: 'Pass Plus', n: '×1'}
        : x.type === 'GRAM' ? {img: '/static/assets/gram.svg', name: 'GRAM', n: num(x.amount)} : {img: '/static/assets/new-year-ornament.svg', name: 'Шары', n: num(x.amount)};
    const bundleSpec = () => {
        const packsM = {}, chestsM = {}, dropsM = {}; let gram = '', balls = '', hasPass = false;
        f.items.forEach(x => { if (x.type === 'PACK') packsM[x.id] = (packsM[x.id] || 0) + x.count; else if (x.type === 'CHEST') chestsM[x.id] = (chestsM[x.id] || 0) + x.count; else if (x.type === 'DROP') dropsM[x.id] = (dropsM[x.id] || 0) + x.count; else if (x.type === 'GRAM') gram = x.amount; else if (x.type === 'BALL') balls = x.amount; else if (x.type === 'PASS') hasPass = true; });
        return {pass: hasPass, packs: Object.entries(packsM).map(([pack_id, count]) => ({pack_id, count})), chests: Object.entries(chestsM).map(([chest_id, count]) => ({chest_id, count})), drops: Object.entries(dropsM).map(([drop_id, count]) => ({drop_id, count})), gram, balls};
    };
    const cellsHTML = () => '<div class="bnd-cells">' + f.items.map((x, i) => { const v = itemInfo(x); return '<div class="bnd-cell"><button type="button" class="bnd-x" data-bnd-del="' + i + '" aria-label="Убрать">×</button><img src="' + e(v.img) + '" alt=""><b>' + e(v.n) + '</b><span>' + e(v.name) + '</span></div>'; }).join('') +
        '<button type="button" class="bnd-cell bnd-plus" data-bnd-add aria-label="Добавить в бандл"><i>+</i><span>Добавить</span></button></div>';
    /* the window «what to add»: a pack, a chest, GRAM or balls; a pack and a chest ask which one, GRAM and balls ask the amount */
    const openAdder = () => {
        const wrap = document.createElement('div');
        wrap.className = 'bnd-modal';
        const close = () => wrap.remove();
        const add = x => { if (x.type === 'PACK' || x.type === 'CHEST' || x.type === 'DROP') { const hit = f.items.find(y => y.type === x.type && y.id === x.id); if (hit) hit.count += x.count; else f.items.push(x); } else { f.items = f.items.filter(y => y.type !== x.type); f.items.push(x); } close(); draw(); };
        const shell = (title, body) => { wrap.innerHTML = '<div class="bnd-box"><div class="bnd-top"><b>' + title + '</b><button type="button" data-x aria-label="Закрыть">×</button></div>' + body + '</div>'; wrap.querySelector('[data-x]').addEventListener('click', close); };
        const counter = (id, type) => '<div class="bnd-count"><label>Сколько штук</label><input type="number" min="1" max="50" value="1" data-bnd-n><button type="button" class="primary" data-bnd-ok>Добавить</button></div>';
        const pickOne = type => {
            const list = type === 'PACK' ? packs.map(p => ({id: p.id, title: p.title, image: p.image})) : type === 'DROP' ? DROPS : CHESTS;
            shell(type === 'PACK' ? 'Какой пак?' : type === 'DROP' ? 'Какой дроп?' : 'Какой ящик?', '<div class="bnd-grid">' + (list.length ? list.map(x => '<button type="button" class="bnd-opt" data-id="' + e(x.id) + '"><img src="' + e(x.image) + '" alt=""><span>' + e(x.title) + '</span></button>').join('') : '<p class="sub">Пока нечего выбрать.</p>') + '</div>');
            wrap.querySelectorAll('.bnd-opt').forEach(b => b.addEventListener('click', () => {
                const x = list.find(y => y.id === b.dataset.id);
                shell(e(x.title), '<div class="bnd-one"><img src="' + e(x.image) + '" alt=""></div>' + counter());
                wrap.querySelector('[data-bnd-ok]').addEventListener('click', () => add({type, id: x.id, count: Math.max(1, Math.min(50, Math.floor(Number(wrap.querySelector('[data-bnd-n]').value) || 1)))}));
            }));
        };
        const amount = type => {
            shell(type === 'GRAM' ? 'Сколько GRAM?' : 'Сколько шаров?', '<div class="bnd-one"><img src="' + (type === 'GRAM' ? '/static/assets/gram.svg' : '/static/assets/new-year-ornament.svg') + '" alt=""></div><div class="bnd-count"><label>Сумма</label><input inputmode="decimal" data-bnd-a placeholder="' + (type === 'GRAM' ? '0.5' : '100') + '"><button type="button" class="primary" data-bnd-ok>Добавить</button></div>');
            wrap.querySelector('[data-bnd-ok]').addEventListener('click', () => { const v = wrap.querySelector('[data-bnd-a]').value.trim().replace(',', '.'); if (!(Number(v) > 0)) { toast('Введите сумму'); return; } add({type, amount: type === 'BALL' ? String(Math.floor(Number(v))) : v}); });
        };
        shell('Что добавить в бандл?', '<div class="bnd-types">' + [['PACK', 'Пак', '/static/assets/packs/new-year-pack.webp'], ['CHEST', 'Ящик', '/static/assets/chests/gingerbread.png'], ['DROP', 'Дроп', '/static/assets/drops/snowman.png'], ['GRAM', 'GRAM', '/static/assets/gram.svg'], ['BALL', 'Шары', '/static/assets/new-year-ornament.svg']].map(([t, n, img]) => '<button type="button" class="bnd-type" data-type="' + t + '"><img src="' + img + '" alt=""><span>' + n + '</span></button>').join('') + '</div>');
        wrap.querySelectorAll('.bnd-type').forEach(b => b.addEventListener('click', () => (b.dataset.type === 'PACK' || b.dataset.type === 'CHEST' || b.dataset.type === 'DROP') ? pickOne(b.dataset.type) : b.dataset.type === 'PASS' ? add({type: 'PASS', count: 1}) : amount(b.dataset.type)));
        wrap.addEventListener('click', ev => { if (ev.target === wrap) close(); });
        document.body.appendChild(wrap);
    };
    // ---- auto offers: one chest -> a set of offers (1, 3, 5, 10 chests), prices and places are made by themselves
    const auState = {chest: '', counts: '1, 3, 5, 10', base: '100', markup: '10', disc: '15', bg: '', section_id: '', endsH: '', per: '', stock: '', old: true, badge: ''};
    const auPlan = () => {
        const counts = [...new Set(String(auState.counts).split(/[^0-9]+/).map(Number).filter(n => n >= 1 && n <= 20))].sort((a, b) => a - b);
        const base = Math.max(0, Number(auState.base) || 0), mk = 1 + Math.max(0, Number(auState.markup) || 0) / 100, disc = Math.min(90, Math.max(0, Number(auState.disc) || 0));
        const top = counts[counts.length - 1] || 1;
        return counts.map((n, i) => {
            const full = Math.round(base * mk * n), d = counts.length > 1 && top > 1 ? disc * (n - 1) / (top - 1) : 0, price = Math.max(0, Math.round(full * (1 - d / 100)));
            const size = counts.length === 1 ? 'wide' : i === counts.length - 1 ? 'large' : i === 0 ? 'small' : 'wide';
            return {n, full, price, off: Math.round(d), size, rarity: i === counts.length - 1 && counts.length > 1 ? 'epic' : i > 0 ? 'rare' : 'auto'};
        });
    };
    const openAuto = () => {
        if (!CHESTS.length) { toast('Сначала создайте ящик во вкладке «Ящики»'); return; }
        if (!auState.chest || !CHESTS.some(c => c.id === auState.chest)) auState.chest = CHESTS[0].id;
        const wrap = document.createElement('div');
        wrap.className = 'bnd-modal';
        const close = () => wrap.remove();
        const paint = () => {
            const ch = CHESTS.find(c => c.id === auState.chest) || CHESTS[0], plan = auPlan();
            const cur = auState.bg;
            wrap.innerHTML = '<div class="bnd-box au-box"><div class="bnd-top"><b>Автосоздание акций</b><button type="button" data-x aria-label="Закрыть">×</button></div>' +
                '<div class="adm-step"><h4>1. Какой ящик</h4><div class="bnd-grid">' + CHESTS.map(c => '<button type="button" class="bnd-opt' + (c.id === ch.id ? ' is-on' : '') + '" data-au-chest="' + e(c.id) + '"><img src="' + e(c.image) + '" alt=""><span>' + e(c.title) + '</span></button>').join('') + '</div></div>' +
                '<div class="adm-step"><h4>2. Сколько ящиков в акциях</h4><label>Через запятую: на каждое число будет своя акция<input data-au="counts" value="' + e(auState.counts) + '" placeholder="1, 3, 5, 10"></label></div>' +
                '<div class="adm-step"><h4>3. Цены</h4><div class="adm-row3"><label>Цена за 1 ящик, шаров<input type="number" min="0" data-au="base" value="' + e(auState.base) + '"></label><label>Наценка, %<input type="number" min="0" max="500" data-au="markup" value="' + e(auState.markup) + '"></label><label>Скидка за самую большую пачку, %<input type="number" min="0" max="90" data-au="disc" value="' + e(auState.disc) + '"></label></div>' +
                '<label class="adm-check"><input type="checkbox" data-au-old ' + (auState.old ? 'checked' : '') + '> Показывать зачёркнутую цену и скидку</label></div>' +
                '<div class="adm-step"><h4>4. Фон акций</h4><p class="sub">Пусто — фон самого ящика. Можно выбрать сохранённый или прикрепить свой.</p>' + cardBgGallery(cur, 'data-au-bg', 'data-au-file') + '</div>' +
                '<div class="adm-step"><h4>5. Условия</h4><div class="adm-row3"><label>Раздел<select data-au="section_id"><option value="">Авто (по правилам)</option>' + (r.sections || []).filter(x => x.kind !== 'exchange' && x.id !== 'gifts').map(x => '<option value="' + e(x.id) + '"' + (auState.section_id === x.id ? ' selected' : '') + '>' + e(x.title) + '</option>').join('') + '</select></label>' +
                '<label>Закончится через, часов (пусто — без срока)<input type="number" min="1" max="2880" data-au="endsH" value="' + e(auState.endsH) + '"></label><label>Лимит на игрока (пусто — без лимита)<input type="number" min="1" data-au="per" value="' + e(auState.per) + '"></label>' +
                '<label>Всего штук (пусто — без лимита)<input type="number" min="1" data-au="stock" value="' + e(auState.stock) + '"></label><label>Плашка (до 14 знаков)<input data-au="badge" maxlength="14" value="' + e(auState.badge) + '"></label></div></div>' +
                '<div class="adm-step"><h4>Что будет создано</h4><div class="au-plan">' + (plan.length ? plan.map(x => '<div><b>' + e(ch.title) + ' ×' + x.n + '</b><span>' + (x.off > 0 && auState.old ? '<s>' + num(x.full) + '</s> ' : '') + num(x.price) + ' шаров' + (x.off > 0 && auState.old ? ' · −' + x.off + '%' : '') + '</span></div>').join('') : '<p class="sub">Впишите количества.</p>') + '</div></div>' +
                '<div class="bnd-count"><button type="button" class="primary" data-au-go' + (plan.length ? '' : ' disabled') + '>Создать ' + plan.length + ' акц.</button></div></div>';
            wrap.querySelector('[data-x]').addEventListener('click', close);
            wrap.querySelectorAll('[data-au-chest]').forEach(b => b.addEventListener('click', () => { auState.chest = b.dataset.auChest; paint(); }));
            wrap.querySelectorAll('[data-au]').forEach(i => i.addEventListener('input', () => { auState[i.dataset.au] = i.value; if (i.tagName === 'SELECT') return; clearTimeout(paint.t); paint.t = setTimeout(() => { const k = i.dataset.au, pos = i.selectionStart; paint(); const n = wrap.querySelector('[data-au="' + k + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } }, 350); }));
            wrap.querySelector('[data-au-old]').addEventListener('change', ev => { auState.old = ev.target.checked; paint(); });
            wrap.querySelectorAll('[data-au-bg]').forEach(b => b.addEventListener('click', () => { auState.bg = b.dataset.auBg; paint(); }));
            wrap.querySelectorAll('[data-bg-lib-del]').forEach(d => d.addEventListener('click', async () => { try { r.bg_library = (await api('admin/new-year/shop-bg-library/delete', {url: d.dataset.bgLibDel})).library; paint(); } catch (err) { toast(err.message); } }));
            wrap.querySelector('[data-au-file]')?.addEventListener('change', async ev => { const file = ev.target.files[0]; if (!file) return; try { auState.bg = 'image:' + await uploadBg(file); paint(); } catch (err) { toast(err.message); } });
            wrap.querySelector('[data-au-go]')?.addEventListener('click', async ev => {
                ev.target.disabled = true;
                let made = 0;
                try {
                    for (const x of plan) {
                        await api('admin/new-year/shop', {kind: 'CHEST', amount: ch.id, bundle: x.n, price_balls: x.price, old_price_balls: auState.old && x.off > 0 ? x.full : '', stock: auState.stock, per_user: auState.per, size: x.size, rarity: x.rarity, badge: auState.badge,
                            section_id: auState.section_id, card_bg: auState.bg, ends_in_hours: auState.endsH || undefined, title: ch.title + ' ×' + x.n, image_url: '', heading: '', description: '', mode: ''});
                        made++;
                    }
                    toast('Создано акций: ' + made);
                } catch (err) { toast((made ? 'Создано ' + made + ', потом ошибка: ' : '') + err.message); }
                try { const fresh = await api('admin/new-year/shop'); r.items = fresh.items; r.extra_order = fresh.extra_order || r.extra_order; r.order = fresh.order || r.order; r.sections = fresh.sections || r.sections; } catch (_) {}
                close(); draw();
            });
        };
        wrap.addEventListener('click', ev => { if (ev.target === wrap) close(); });
        document.body.appendChild(wrap); paint();
    };
    // random pack / choice: the same cells with a «+» as in a bundle (packs of the offer, the number of each is changed right on the cell)
    const optInfo = key => key.startsWith('chest:') ? (CHESTS.find(c => 'chest:' + c.id === key) ? {image: CHESTS.find(c => 'chest:' + c.id === key).image, title: CHESTS.find(c => 'chest:' + c.id === key).title} : null)
        : key === 'pass:plus' ? {image: '/static/assets/pass/ticket-plus.svg', title: 'Pass Plus'}
        : key.startsWith('drop:') ? (DROPS.find(c => 'drop:' + c.id === key) ? {image: DROPS.find(c => 'drop:' + c.id === key).image, title: DROPS.find(c => 'drop:' + c.id === key).title} : null)
        : (packs.find(x => x.id === key) ? {image: packs.find(x => x.id === key).image, title: packs.find(x => x.id === key).title} : null);
    const mixCellsHTML = () => '<div class="bnd-cells">' + Object.entries(f.mix).filter(([, n]) => n > 0).map(([id, n]) => { const pk = optInfo(id); if (!pk) return '';
        return '<div class="bnd-cell"><button type="button" class="bnd-x" data-mix-del="' + e(id) + '" aria-label="Убрать">×</button><img src="' + e(pk.image) + '" alt=""><b>×' + n + '</b><span>' + e(pk.title) + '</span>' +
            '<span class="bnd-step"><button type="button" data-mix-dec="' + e(id) + '" aria-label="Меньше">−</button><button type="button" data-mix-inc="' + e(id) + '" aria-label="Больше">+</button></span>' + (f.mode === 'choice' ? '<input class="bnd-price" inputmode="numeric" data-mix-price="' + e(id) + '" value="' + e(MIXPRICE[id] || '') + '" placeholder="цена" aria-label="Цена этого варианта">' : '') + '</div>'; }).join('') +
        '<button type="button" class="bnd-cell bnd-plus" data-mix-add aria-label="Добавить"><i>+</i><span>Добавить</span></button></div>';
    const openMixAdder = () => {
        const wrap = document.createElement('div');
        wrap.className = 'bnd-modal';
        const close = () => wrap.remove();
        const group = (title, list) => list.length ? '<h5 class="bnd-h">' + title + '</h5><div class="bnd-grid">' + list.map(x => '<button type="button" class="bnd-opt' + ((f.mix[x.key] || 0) > 0 ? ' is-on' : '') + '" data-id="' + e(x.key) + '"><img src="' + e(x.image) + '" alt=""><span>' + e(x.title) + '</span></button>').join('') + '</div>' : '';
        wrap.innerHTML = '<div class="bnd-box"><div class="bnd-top"><b>Что добавить в акцию?</b><button type="button" data-x aria-label="Закрыть">×</button></div>' +
            group('Паки', packs.map(p => ({key: p.id, title: p.title, image: p.image}))) + group('Ящики', CHESTS.map(c => ({key: 'chest:' + c.id, title: c.title, image: c.image}))) + group('Дропы', DROPS.map(c => ({key: 'drop:' + c.id, title: c.title, image: c.image}))) + group('Pass Plus', [{key: 'pass:plus', title: 'Pass Plus', image: '/static/assets/pass/ticket-plus.svg'}]) + '</div>';
        wrap.querySelector('[data-x]').addEventListener('click', close);
        wrap.querySelectorAll('.bnd-opt').forEach(b => b.addEventListener('click', () => { f.mix[b.dataset.id] = (f.mix[b.dataset.id] || 0) + 1; close(); draw(); }));
        wrap.addEventListener('click', ev => { if (ev.target === wrap) close(); });
        document.body.appendChild(wrap);
    };
    // ---- import of offers from a table: a file (xlsx / csv) or pasted rows -> a sheet -> ticked rows -> offers
    const impState = {sheets: [], sheet: 0, picked: new Set(), text: '', busy: false};
    const openImport = () => {
        const wrap = document.createElement('div');
        wrap.className = 'bnd-modal';
        const close = () => wrap.remove();
        const cur = () => impState.sheets[impState.sheet];
        const rowsOk = sh => (sh ? sh.rows : []);
        const paint = () => {
            const sh = cur();
            let body;
            if (!impState.sheets.length) {
                body = '<div class="adm-step"><h4>1. Файл или строки</h4><p class="sub">Файл .xlsx или .csv: например «chests-shop-plan.xlsx». Листы показываются отдельно, вы выбираете нужный. Или вставьте строки из таблицы (с заголовками) в поле ниже.</p>' +
                    '<label class="imp-file"><input type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-imp-file><b>Выбрать файл</b><span>.xlsx · .csv</span></label>' +
                    '<label class="imp-paste">Или вставьте строки<textarea data-imp-text rows="6" placeholder="Название акции\tЯщик или дроп\tШтук\tЦена, шаров\t…">' + e(impState.text) + '</textarea></label>' +
                    '<div class="bnd-count"><button type="button" class="primary" data-imp-read' + (impState.busy ? ' disabled' : '') + '>' + (impState.busy ? 'Читаю…' : 'Прочитать') + '</button></div></div>';
            } else {
                const tabs = impState.sheets.map((x, i) => '<button type="button" class="sb-tab' + (i === impState.sheet ? ' is-on' : '') + (x.supported ? '' : ' is-off') + '" data-imp-sheet="' + i + '">' + e(x.name) + '<i>' + (x.supported ? x.rows.length : '—') + '</i></button>').join('');
                const rows = rowsOk(sh);
                const picked = rows.filter(r => impState.picked.has(r.row)).length;
                body = '<div class="adm-step"><h4>2. Выберите лист</h4><div class="sb-tabs">' + tabs + '</div></div>' +
                    (sh && !sh.supported ? '<p class="sub imp-note">' + e(sh.note) + '. Выберите другой лист, например «Акции к созданию».</p>' : '') +
                    (sh && sh.supported ? '<div class="adm-step"><h4>3. Отметьте акции</h4><div class="imp-bar"><label class="adm-check"><input type="checkbox" data-imp-all' + (picked && picked === rows.filter(r => r.ok).length ? ' checked' : '') + '> Отметить все подходящие</label><span>Выбрано: <b>' + picked + '</b> из ' + rows.length + '</span></div>' +
                        '<div class="imp-list">' + rows.map(r => '<label class="imp-row' + (r.ok ? '' : ' is-bad') + (impState.picked.has(r.row) ? ' is-on' : '') + '"><input type="checkbox" data-imp-row="' + r.row + '"' + (impState.picked.has(r.row) ? ' checked' : '') + (r.ok ? '' : ' disabled') + '>' +
                            '<span class="imp-main"><b>' + e(r.title) + '</b><small>' + e(r.target) + ' · ' + r.count + ' шт. · ' + (r.price ? num(r.price) + ' шаров' + (r.old ? ' (было ' + num(r.old) + ')' : '') : 'бесплатно') + (r.section ? ' · раздел «' + e(r.section) + '»' : '') + (r.term ? ' · ' + e(r.term) : '') + '</small>' +
                            (r.problems.length ? '<em class="imp-err">' + r.problems.map(e).join('; ') + '</em>' : '') + (r.warnings.length ? '<em class="imp-warn">' + r.warnings.map(e).join('; ') + '</em>' : '') + '</span></label>').join('') + '</div></div>' : '') +
                    '<div class="bnd-count imp-foot"><button type="button" data-imp-back>Другой файл</button><button type="button" class="primary" data-imp-go' + (picked && !impState.busy ? '' : ' disabled') + '>' + (impState.busy ? 'Создаю…' : 'Создать выбранные (' + picked + ')') + '</button></div>';
            }
            wrap.innerHTML = '<div class="bnd-box au-box imp-box"><div class="bnd-top"><b>Импорт акций из таблицы</b><button type="button" data-x aria-label="Закрыть">×</button></div>' + body + '</div>';
            wrap.querySelector('[data-x]').addEventListener('click', close);
            wrap.querySelector('[data-imp-text]')?.addEventListener('input', ev => { impState.text = ev.target.value; });
            const read = async file => {
                impState.busy = true; paint();
                try {
                    let res;
                    if (file) { const fd = new FormData(); fd.append('file', file); res = await api('admin/new-year/shop-import/parse', fd); } else res = await api('admin/new-year/shop-import/parse', {text: impState.text});
                    impState.sheets = res.sheets || []; impState.sheet = Math.max(0, impState.sheets.findIndex(x => x.supported));
                    impState.picked = new Set(rowsOk(cur()).filter(r => r.ok && !r.duplicate).map(r => r.row));
                } catch (err) { toast(err.message); }
                impState.busy = false; paint();
            };
            wrap.querySelector('[data-imp-file]')?.addEventListener('change', ev => { if (ev.target.files[0]) read(ev.target.files[0]); });
            wrap.querySelector('[data-imp-read]')?.addEventListener('click', () => read(null));
            wrap.querySelectorAll('[data-imp-sheet]').forEach(b => b.addEventListener('click', () => { impState.sheet = Number(b.dataset.impSheet); impState.picked = new Set(rowsOk(cur()).filter(r => r.ok && !r.duplicate).map(r => r.row)); paint(); }));
            wrap.querySelector('[data-imp-all]')?.addEventListener('change', ev => { const ok = rowsOk(cur()).filter(r => r.ok); impState.picked = ev.target.checked ? new Set(ok.map(r => r.row)) : new Set(); paint(); });
            wrap.querySelectorAll('[data-imp-row]').forEach(i => i.addEventListener('change', () => { const n = Number(i.dataset.impRow); if (i.checked) impState.picked.add(n); else impState.picked.delete(n); paint(); }));
            wrap.querySelector('[data-imp-back]')?.addEventListener('click', () => { impState.sheets = []; impState.picked = new Set(); paint(); });
            wrap.querySelector('[data-imp-go]')?.addEventListener('click', async () => {
                const list = rowsOk(cur()).filter(r => impState.picked.has(r.row));
                impState.busy = true; paint();
                let made = 0;
                try {
                    for (const r of list) { await api('admin/new-year/shop', r.payload); made++; }
                    toast('Создано акций: ' + made);
                } catch (err) { toast((made ? 'Создано ' + made + ', потом ошибка: ' : '') + err.message); }
                try { const fresh = await api('admin/new-year/shop'); r.items = fresh.items; r.extra_order = fresh.extra_order || r.extra_order; r.order = fresh.order || r.order; r.sections = fresh.sections || r.sections; } catch (_) {}
                impState.busy = false; impState.sheets = []; impState.picked = new Set();
                close(); draw();
            });
        };
        wrap.addEventListener('click', ev => { if (ev.target === wrap) close(); });
        document.body.appendChild(wrap); paint();
    };
    const autoTitle = () => {
        if (f.kind === 'BUNDLE' && !f.mode) return 'Бандл: ' + (f.items.map(x => { const v = itemInfo(x); return x.type === 'GRAM' ? num(x.amount) + ' GRAM' : x.type === 'BALL' ? num(x.amount) + ' шаров' : v.name + (x.count > 1 ? ' ×' + x.count : ''); }).join(' + ') || '…');
        if (f.kind === 'BUNDLE') return 'Бандл: ' + ([].concat(Object.entries(f.mix).filter(([, n]) => n > 0).map(([id, n]) => (packs.find(p => p.id === id)?.title || 'Пак') + (n > 1 ? ' ×' + n : '')), Number(f.bgram) > 0 ? [num(f.bgram) + ' GRAM'] : [], Number(f.bballs) > 0 ? [num(f.bballs) + ' шаров'] : []).join(' + ') || '…');
        const w = eff() === 'DROP' ? (DROPS.find(x => x.id === f.amount)?.title || 'Дроп') + (Number(f.bundle) > 1 ? ' ×' + f.bundle : '') : eff() === 'CHEST' ? (CHESTS.find(x => x.id === f.amount)?.title || 'Ящик') : eff() === 'STAR' ? (STARS.find(x => x.key === f.amount)?.name || 'Подарок') + (Number(f.bundle) > 1 ? ' ×' + f.bundle : '') : eff() === 'PACK' ? 'Pack ' + (packs.find(p => p.id === f.pack)?.title || '') + (Number(f.bundle) > 1 ? ' ×' + f.bundle : '') : eff() === 'BALL' ? num(f.amount) + ' шаров' : num(f.amount) + ' GRAM';
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
    let boardTab = '*';                                           // the board shows one section at a time, as a puzzle of that section
    const extraList = () => FBX.map(ev => ({id: 'fb:' + ev.id, src: 'fb', ev, section_id: ''})).concat(CHX.map(ch => ({id: 'ch:' + ch.id, src: 'ch', ch, section_id: ch.section_id || ''})));
    const placeOf = x => x.src ? (r.extra_order || {})[x.id] : x.position;
    const boardAll = () => {                                 // everything of the shop window in the order the players see
        const ex = extraList();
        if (r.order !== 'manual') return ex.concat(r.items);
        return r.items.concat(ex).map((x, i) => [x, i]).sort((a, b) => { const p = placeOf(a[0]), q = placeOf(b[0]); return (p == null) - (q == null) || (p != null && q != null ? p - q : 0) || a[1] - b[1]; }).map(a => a[0]);
    };
    const visible = () => boardTab === '*' ? boardAll() : boardAll().filter(it => (it.section_id || '') === boardTab);
    const extraCell = x => '<div class="sb-cell sb-wide sb-extra" data-sb="' + e(x.id) + '">' + window.crafterFestive.card(x.src === 'fb' ? {key: x.id, src: 'fb', ev: x.ev} : {key: x.id, src: 'ch', ch: x.ch}, {board: true}) +
        '<button type="button" class="sb-handle" data-sb-drag aria-label="Перетащить" title="Перетащите, чтобы переставить">' + GRIP + '</button><span class="sb-badge">' + (x.src === 'fb' ? 'календарь подарков' : 'цепочка акций') + '</span></div>';
    const tabsHTML = () => '<div class="sb-tabs">' + [['*', 'Все', r.items.length], ['', 'Авто', r.items.filter(i => !i.section_id).length]].concat((r.sections || []).filter(x => x.kind !== 'exchange' && x.id !== 'gifts').map(x => [x.id, x.title, r.items.filter(i => i.section_id === x.id).length])).map(t => '<button type="button" class="sb-tab' + (boardTab === t[0] ? ' is-on' : '') + '" data-sb-tab="' + e(t[0]) + '">' + e(t[1]) + '<i>' + t[2] + '</i></button>').join('') + (boardTab !== '*' && visible().length ? '<button type="button" class="sb-clear" data-sb-clear>Очистить раздел: удалить все акции (' + visible().length + ')</button>' : '') + '</div>';
    const boardHTML = () => visible().map(it => it.src ? extraCell(it) : '<div class="sb-cell sb-' + sizeOf(it) + (it.status === 'hidden' ? ' is-hidden' : '') + (selected === it.id ? ' is-sel' : '') + '" data-sb="' + e(it.id) + '">' +
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
            '<div class="sb-actions"><button type="button" data-sb-act="edit">Изменить всё</button><button type="button" data-sb-act="copy">Копировать</button><button type="button" data-sb-act="earlier">← Раньше</button><button type="button" data-sb-act="later">Позже →</button>' +
            '<button type="button" data-sb-act="status">' + (it.status === 'active' ? 'Скрыть' : 'Показать') + '</button><button type="button" class="danger" data-sb-act="delete">Удалить</button></div><p class="sub sb-hint">' + note + '</p></div>';
    };
    const boardSection = () => '<div class="sb-wrap"><h3>Витрина магазина <span class="sb-tools"><button type="button" class="sb-imp" data-import-open>Импорт таблицы</button><button type="button" class="primary sb-auto" data-auto-open>Автосоздание акций</button></span></h3><p class="sub">Выберите раздел: видны только его лоты, как у игроков. Меняйте порядок перетаскиванием, как пазл. «Авто» — лоты без своего раздела: они попадают в разделы по правилам.</p>' + tabsHTML() +
        '<div class="sb-board ny-grid" id="sb-board">' + (visible().length ? boardHTML() : '<p class="sub">Товаров пока нет: добавьте первый ниже.</p>') + '</div><div id="sb-drawer">' + drawerHTML() + '</div></div>';
    const redrawBoard = () => {
        const board = sec.querySelector('#sb-board'), drawer = sec.querySelector('#sb-drawer');
        const tabs = sec.querySelector('.sb-tabs'); if (tabs) tabs.outerHTML = tabsHTML();
        if (board) board.innerHTML = visible().length ? boardHTML() : '<p class="sub">В этом разделе лотов нет.</p>';
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
            const shown = [...board.children].map(c => c.dataset.sb).filter(Boolean), cur = visible().map(i => i.id);
            if (shown.join() === cur.join()) return;
            const whole = boardAll().map(i => i.id);
            let k = 0; const ids = whole.map(id => cur.includes(id) ? shown[k++] : id);   // the tiles of other sections keep their places
            const byId = new Map(r.items.map(i => [i.id, i]));
            r.items = ids.filter(id => byId.has(id)).map(id => byId.get(id));
            r.extra_order = {}; ids.forEach((id, n) => { if (!byId.has(id)) r.extra_order[id] = n + 1; else byId.get(id).position = n + 1; });
            r.order = 'manual';
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
                const fresh = await api('admin/new-year/shop'); r.items = fresh.items; r.extra_order = fresh.extra_order || r.extra_order; r.order = fresh.order || r.order; r.sections = fresh.sections || r.sections;
                redrawBoard(); toast('Сохранено');
            } catch (err) { toast(err.message); }
        });
        drawer?.querySelectorAll('[data-sb-rar]').forEach(b => b.addEventListener('click', () => styleIt({rarity: b.dataset.sbRar})));
        drawer?.querySelectorAll('[data-sb-cbg]').forEach(b => b.addEventListener('click', () => styleIt({card_bg: b.dataset.sbCbg})));
        drawer?.querySelector('[data-sb-heading]')?.addEventListener('change', ev => styleIt({heading: ev.target.value}));
        drawer?.querySelector('[data-sb-cbgfile]')?.addEventListener('change', async ev => { const file = ev.target.files[0]; if (!file) return; try { styleIt({card_bg: 'image:' + await uploadBg(file)}); } catch (err) { toast(err.message); } });
        drawer?.querySelectorAll('[data-sb-size]').forEach(b => b.addEventListener('click', async () => {
            if (!it) return;
            try { await api('admin/new-year/shop/' + it.id + '/size', {size: b.dataset.sbSize}); it.size = b.dataset.sbSize; redrawBoard(); } catch (err) { toast(err.message); }
        }));
        drawer?.querySelectorAll('[data-sb-act]').forEach(b => b.addEventListener('click', async () => {
            if (!it) return;
            const act = b.dataset.sbAct;
            try {
                if (act === 'edit') { startEdit(it.id); return; }
                if (act === 'copy') {                                              // a copy goes into the form as a new lot: change what is needed and press «Добавить товар»
                    startEdit(it.id); editing = null; f.title = (it.title || '') + ' (копия)'; draw();
                    sec.querySelector('#si-form')?.scrollIntoView({behavior: 'smooth', block: 'start'}); toast('Копия готова: поправьте и нажмите «Добавить товар»'); return;
                }
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
        sec.querySelector('[data-sf-bgfile]')?.addEventListener('change', async ev => { const file = ev.target.files[0]; if (!file) return; try { title(); secForm.bg = 'image:' + await uploadBg(file); redraw(); } catch (err) { toast(err.message); } });
        sec.querySelectorAll('[data-sec-clear]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.secClear; title(); if (k === 'bg') secForm.bg = 'night'; else secForm[k] = k === 'icon' ? 'builtin:star' : ''; redraw(); }));
        sec.querySelectorAll('[data-sec-file]').forEach(inp => inp.addEventListener('change', async () => {
            const file = inp.files[0]; if (!file) return;
            if (file.size > 15000000) { toast('Файл должен быть не больше 15 МБ'); return; }
            const body = new FormData(); body.append('file', file);
            try { const out = await api('admin/new-year/shop-media', body); const k = inp.dataset.secFile; title(); if (k === 'bg') secForm.bg = 'image:' + out.url; else secForm[k] = out.url; redraw(); } catch (err) { toast(err.message); }
        }));
        sec.querySelector('#sec-save')?.addEventListener('click', async () => {
            title();
            try { await api('admin/new-year/shop-sections', secForm); await reload(); secForm = null; toast('Раздел сохранён'); redraw(); } catch (err) { toast(err.message); }
        });
    };
    const draw = () => {
        const kinds = KIND_TILES.filter(k => !(k[0] === 'PACK' && !packs.length) && !(k[0] === 'STAR' && !STARS.length) && !(k[0] === 'CHEST' && !CHESTS.length) && !(k[0] === 'DROP' && !DROPS.length));
        const step2 = f.kind === 'PROMO' ? '<div class="adm-step"><h4>Что даёт промокод</h4><div class="adm-tiles small">' + PROMO_TILES.filter(k => !(k[0] === 'PACK' && !packs.length) && !(k[0] === 'STAR' && !STARS.length)).map(k => tile(f.promo === k[0], 'data-promo="' + k[0] + '"', k[2], k[1])).join('') + '</div></div>' : '';
        const mixTotal = Object.values(f.mix).reduce((x, n) => x + n, 0);
        const what = f.kind === 'BUNDLE'
            ? '<div class="adm-step"><h4>Состав: бандл, акция с выбором или случайный пак</h4><div class="adm-chips" style="margin-bottom:10px">' + [['', 'Всё сразу (бандл)'], ['choice', 'Игрок выбирает один вариант'], ['random', 'Случайная награда']].map(m => '<button type="button" data-mode="' + m[0] + '"' + (f.mode === m[0] ? ' class="is-on"' : '') + '>' + m[1] + '</button>').join('') + '</div><p class="sub">' + (f.mode === 'choice' ? 'Игрок смотрит варианты и покупает любой один: добавьте через «+» от 2 разных вариантов: паков, ящиков или дропов (число на карточке — сколько штук такого пака он получит). Цена: одна для всех вариантов (поле «Цена» ниже) или своя у каждого — впишите её под вариантом; пусто значит общая цена.' : f.mode === 'random' ? 'Игрок покупает чёрный пак со знаком вопроса и получает случайный из добавленных (от 2 разных).' : 'Игрок получит всё сразу за одну покупку.') + (f.mode ? ' Вариантов сейчас: <b>' + mixTotal + '</b>.' : '') + '</p>' + (f.mode ? mixCellsHTML() + (f.mode ? '' : '<div class="adm-row3" style="margin-top:12px"><div class="adm-field"><label>GRAM на баланс</label><input data-f="bgram" inputmode="decimal" value="' + e(f.bgram) + '" placeholder="Без GRAM"></div><div class="adm-field"><label>Новогодние шары</label><input data-f="bballs" inputmode="numeric" value="' + e(f.bballs) + '" placeholder="Без шаров"></div></div>') : cellsHTML() + '<p class="sub">Нажмите «+», чтобы добавить в бандл пак, ящик, GRAM или шары. Игрок получит всё сразу за одну покупку.</p>') + '</div>'
            : eff() === 'PACK'
            ? '<div class="adm-step"><h4>Какой пак</h4>' + window.crafterPacks.packTiles(packs, f.pack) + '</div>'
            : eff() === 'DROP'
            ? '<div class="adm-step"><h4>Какой дроп</h4><div class="adm-field"><select data-f="amount">' + DROPS.map(c => '<option value="' + e(c.id) + '"' + (f.amount === c.id ? ' selected' : '') + '>' + e(c.title) + '</option>').join('') + '</select><small class="sub">Дроп открывается сразу после покупки, как ящик (4 нажатия поднимают редкость, в конце одна награда).</small></div></div>'
            : eff() === 'PASS'
            ? '<div class="adm-step"><h4>Pass Plus</h4><p class="sub">Игрок получит Pass Plus сезона, который идёт сейчас (его настраивают в разделе «Пасс»). Если сезона нет или Pass Plus уже куплен, покупка не пройдёт, шары не спишутся. Цена в шарах задаётся ниже, отдельно от цены внутри самого пасса.</p></div>'
            : eff() === 'CHEST'
            ? '<div class="adm-step"><h4>Какой ящик</h4><div class="adm-field"><select data-f="amount">' + CHESTS.map(c => '<option value="' + e(c.id) + '"' + (f.amount === c.id ? ' selected' : '') + '>' + e(c.title) + '</option>').join('') + '</select><small class="sub">Ящики создаются во вкладке «Ящики». Ящик открывается сразу, в инвентаре его нет.</small></div></div>'
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
            '</div>' + ((eff() === 'PACK') || eff() === 'STAR' || eff() === 'CHEST' || eff() === 'DROP' ? range('bundle', eff() === 'STAR' ? 'Подарков за одну покупку' : eff() === 'DROP' ? 'Дропов за одну покупку' : eff() === 'CHEST' ? 'Ящиков за одну покупку' : 'Паков за одну покупку', 1, 20, f.bundle, fmtBundle) : '') +
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
        sec.querySelector('[data-cbg-file]')?.addEventListener('change', async ev => { const file = ev.target.files[0]; if (!file) return; try { pull(); f.card_bg = 'image:' + await uploadBg(file); draw(); } catch (err) { toast(err.message); } });
        sec.querySelectorAll('[data-fsec]').forEach(b => b.addEventListener('click', () => { pull(); f.section_id = b.dataset.fsec; sec.querySelectorAll('[data-fsec]').forEach(x => x.classList.toggle('is-on', x === b)); sendPreview(); }));
        sec.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { pull(); f.mode = b.dataset.mode; draw(); }));
        sec.querySelector('[data-f="endsMsk"]')?.addEventListener('change', () => { f.endsH = ''; });
        bindSections();
        sec.querySelectorAll('[data-rar]').forEach(b => b.addEventListener('click', () => { pull(); f.rarity = b.dataset.rar; draw(); }));
        sec.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { pull(); f.kind = b.dataset.kind; f.amount = eff() === 'PASS' ? 'plus' : eff() === 'DROP' ? (DROPS[0]?.id || '') : eff() === 'CHEST' ? (CHESTS[0]?.id || '') : eff() === 'STAR' ? (STARS[0]?.key || 'bear') : eff() === 'BALL' ? '100' : '1'; draw(); }));
        sec.querySelectorAll('[data-promo]').forEach(b => b.addEventListener('click', () => { pull(); f.promo = b.dataset.promo; f.amount = eff() === 'CHEST' ? (CHESTS[0]?.id || '') : eff() === 'STAR' ? (STARS[0]?.key || 'bear') : eff() === 'BALL' ? '100' : '1'; draw(); }));
        sec.querySelector('[data-bnd-add]')?.addEventListener('click', () => { pull(); openAdder(); });
        sec.querySelector('[data-gr-go]')?.addEventListener('click', async () => { pull(); try { const res = await api('admin/drops/grant', {user_id: sec.querySelector('[data-gr-user]').value.trim(), drop_id: f.amount, qty: sec.querySelector('[data-gr-qty]').value.trim() || 1}); toast('Выдано. У игрока теперь: ' + res.qty); } catch (err) { toast(err.message); } });
        sec.querySelector('[data-import-open]')?.addEventListener('click', () => { pull(); openImport(); });
        sec.querySelector('[data-auto-open]')?.addEventListener('click', () => { pull(); openAuto(); });
        sec.querySelectorAll('[data-bnd-del]').forEach(b => b.addEventListener('click', () => { pull(); f.items.splice(+b.dataset.bndDel, 1); draw(); }));
        sec.querySelectorAll('[data-mix-inc]').forEach(b => b.addEventListener('click', () => { pull(); const t = Object.values(f.mix).reduce((x, n) => x + n, 0); if (t < 500) f.mix[b.dataset.mixInc] = (f.mix[b.dataset.mixInc] || 0) + 1; draw(); }));
        sec.querySelectorAll('[data-mix-price]').forEach(i => i.addEventListener('input', () => { MIXPRICE[i.dataset.mixPrice] = i.value.replace(/\D/g, ''); }));
        sec.querySelector('[data-mix-add]')?.addEventListener('click', () => { pull(); openMixAdder(); });
        sec.querySelectorAll('[data-mix-del]').forEach(b => b.addEventListener('click', () => { pull(); f.mix[b.dataset.mixDel] = 0; draw(); }));
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
            run(() => api(editing ? 'admin/new-year/shop/' + editing + '/edit' : 'admin/new-year/shop', {contents: f.kind === 'BUNDLE' && f.mode ? Object.entries(f.mix).filter(([, n]) => n > 0).map(([key, count]) => { const o = key.startsWith('chest:') ? {chest_id: key.slice(6), count} : key.startsWith('drop:') ? {drop_id: key.slice(5), count} : key === 'pass:plus' ? {pass: true, count: 1} : {pack_id: key, count}; if (f.mode === 'choice' && MIXPRICE[key]) o.price = MIXPRICE[key]; return o; }) : f.kind === 'BUNDLE' ? bundleSpec() : undefined, kind: f.kind === 'BUNDLE' && f.mode ? 'PACK' : f.kind, promo_kind: f.promo, amount: eff() === 'PACK' ? f.pack : f.amount, price_balls: f.price || 0, old_price_balls: f.old || '', stock: f.stock, per_user: f.per === '0' ? '' : f.per, bundle: eff() === 'PACK' || eff() === 'STAR' || eff() === 'CHEST' || eff() === 'DROP' ? f.bundle : 1, image_url: f.image, title: f.title, size: f.size, description: f.description, rarity: f.rarity, badge: f.badge, section_id: f.section_id, heading: f.heading, card_bg: f.card_bg, mode: f.kind === 'BUNDLE' ? f.mode : '', starts_at_msk: f.startsMsk, ends_at_msk: f.endsH ? '' : f.endsMsk, ends_in_hours: f.endsH || ''}), editing ? 'Изменения сохранены' : 'Товар добавлен');
        });
        sec.querySelectorAll('[data-si-up],[data-si-down]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/shop/' + (b.dataset.siUp || b.dataset.siDown) + '/move', {direction: b.dataset.siUp ? 'up' : 'down'}), 'Порядок изменён')));
        sec.querySelector('#si-order')?.addEventListener('click', () => run(() => api('admin/new-year/shop-order', {mode: 'price'}), 'Порядок: по возрастанию цены'));
        sec.querySelector('[data-si-cancel]')?.addEventListener('click', () => sec.querySelector('#si-cancel')?.click());
        sec.querySelector('#si-cancel')?.addEventListener('click', () => { editing = null; Object.assign(f, {kind: 'GRAM', promo: 'GRAM', amount: '1', price: '0', old: '', stock: '', per: '0', bundle: '1', image: '', title: '', mix: {}, items: [], bgram: '', bballs: '', size: 'small', description: '', rarity: 'auto', badge: '', endsH: '', endsAt: null, section_id: '', heading: '', card_bg: '', mode: '', startsMsk: '', endsMsk: ''}); draw(); });
        startEdit = id => {
            const it = r.items.find(x => x.id === id); if (!it) return;
            editing = it.id;
            Object.assign(f, {kind: it.kind, promo: it.promo_kind || 'GRAM', amount: it.amount, pack: it.kind === 'PACK' || it.promo_kind === 'PACK' ? it.amount : f.pack, price: String(it.price_balls), old: it.old_price_balls ? String(it.old_price_balls) : '', stock: it.stock === null ? '' : String(it.stock), per: it.per_user === null ? '0' : String(it.per_user), bundle: String(it.bundle || 1), image: it.image_url && !it.pack && !it.star ? it.image_url : '', title: it.title, mix: {}, items: [], bgram: it.gram || '', bballs: it.balls ? String(it.balls) : '', size: sizeOf(it), description: it.description || '', rarity: it.rarity || 'auto', badge: it.badge || '', endsH: '', endsAt: it.ends_at || null, section_id: it.section_id || '', heading: it.heading || '', card_bg: it.card_bg || '', mode: it.mode || '', startsMsk: it.starts_at ? toMsk(it.starts_at) : '', endsMsk: it.ends_at ? toMsk(it.ends_at) : ''});
            if (it.mode) { f.kind = 'BUNDLE'; f.mix = {}; }
            if (it.kind === 'BUNDLE' || it.mode) (it.contents || []).forEach(c => { f.mix[c.pack.id] = c.count; if (c.price !== null && c.price !== undefined) MIXPRICE[c.pack.id] = String(c.price); else delete MIXPRICE[c.pack.id]; });
            if (it.kind === 'BUNDLE' && !it.mode) {                                          // the cells of the bundle
                f.items = (it.contents || []).map(c => ({type: 'PACK', id: c.pack.id, count: c.count})).concat((it.chests_in || []).map(c => ({type: 'CHEST', id: c.chest.id, count: c.count})), (it.drops_in || []).map(c => ({type: 'DROP', id: c.drop.id, count: c.count})), it.pass_in ? [{type: 'PASS', count: 1}] : []);
                if (it.gram) f.items.push({type: 'GRAM', amount: String(it.gram)});
                if (it.balls) f.items.push({type: 'BALL', amount: String(it.balls)});
            }
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
