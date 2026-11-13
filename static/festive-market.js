/* The New Year market in the style of a game shop: sections on the left (an icon, a name and a picture, each section has its own
   background), offers with juicy titles whose colour follows the rarity, a window of the lot with a confirmation of the purchase,
   an animated reveal of what was bought and a panel of chances. Horizontal on computers, vertical on phones.
   The same file renders the standalone preview page (/shop/preview) that the administrator sees for the phone and the computer. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img class="fm-ball" src="/static/assets/new-year-ornament.svg" alt="">';
const SI = () => window.crafterShopItems || {};
const NAMES = {common: 'Акция', rare: 'Редкая акция', special: 'Особая акция', epic: 'Эпическая акция', mythic: 'Мифическая акция', legend: 'Легендарная акция', res: 'Ресурсы'};
const TYPES = {GRAM: 'Баланс GRAM', BALL: 'Шары', PACK: 'Пак', BUNDLE: 'Набор', STAR: 'Подарок Telegram', CHEST: 'Ящик', PROMO: 'Промокод', REWARD: 'Награда сообщества'};
const WIDTH = {small: 1, tall: 1, wide: 1.6, large: 2, banner: 2.6};
let offset = 0;                                                    // server time minus the time of this device
const nowSec = () => Math.floor(Date.now() / 1000) + offset;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.crafterAnimations === 'off';

/* ---------- registries: icons, backgrounds ---------- */
const S = (body, extra) => '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"' + (extra || '') + '>' + body + '</svg>';
const ICONS = {
    star: S('<path d="m12 2 2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.200l7.100-.6z"/>'),
    pack: S('<path d="M7 2h10l2 3v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5zm1.5 3L8 6h8l-.5-1zM9 10v2h6v-2zm0 4v2h4v-2z"/>'),
    bundle: S('<path d="M3 8h18v4H3zm1 5h16v8H4zm7-5h2v13h-2zM12 8C10 3 6 4.500 8 7zm0 0c2-5 6-3.500 4-1z"/>'),
    gem: S('<path d="M12 2 4 8l8 14 8-14zm0 4.200L15.500 9 12 15 8.500 9z"/>'),
    cup: S('<path d="M6 3h12v3a6 6 0 0 1-5 5.900V15h3v2H8v-2h3v-3.100A6 6 0 0 1 6 6zM4 5h2v3a3 3 0 0 1-2-2zm16 0v1a3 3 0 0 1-2 2.800V5zM7 19h10v2H7z"/>'),
    gift: S('<path d="M3 9h18v4H3zm1 5h7v7H4zm9 0h7v7h-7zM11 9h2v12h-2zM12 9C10 3 6 5 8 8zm0 0c2-6 6-4 4-1z"/>'),
    tree: S('<path d="M12 2 8.500 8H10l-3.500 5H8.500L5 19h14l-3.500-6h2L14 8h1.500z"/><rect x="10.800" y="19" width="2.400" height="3" rx=".6"/>'),
    flake: S('<path d="M11 2h2v5.500l3.500-2 1 1.700-4.500 2.600v2.400l2.100-1.200 3.700-2.100.9 1.700-3.700 2.100L18 13.900l-1 1.700-2.100-1.200-2.900 1.700V20.600l1.900-1.100 1 1.700-2.900 1.700-2.900-1.700 1-1.700 1.900 1.100v-3.800l-2.900-1.700-2.100 1.200-1-1.700L8.100 11.800 4.400 9.700l.9-1.700 3.700 2.100L11 11.300V8.900L6.500 6.400l1-1.700L11 6.700z"/>'),
    sleigh: S('<path d="M3 16h14a3 3 0 0 0 3-3V9h-2v4H8l-.5-5H3zm1 3h15a3 3 0 0 0 3-3h-2a1 1 0 0 1-1 1H4zM5 9.500V8h1.500l.3 4H5z"/>'),
    bell: S('<path d="M12 2a1.500 1.500 0 0 1 1.500 1.500V4.200A6 6 0 0 1 18 10v4l2 3H4l2-3v-4a6 6 0 0 1 4.500-5.800V3.500A1.500 1.500 0 0 1 12 2zM10 19h4a2 2 0 0 1-4 0z"/>'),
    candy: S('<path d="M15.500 2A5.500 5.500 0 0 0 10 7.500V10l-6 11 3 1 6.500-11.500V7.500a1.500 1.500 0 0 1 3 0V9h3V7.500A5.500 5.500 0 0 0 15.500 2z"/>'),
    crown: S('<path d="m3 8 4.500 4L12 5l4.500 7L21 8l-2 11H5z"/>'),
    fire: S('<path d="M12 2c1 3.500 5 5.500 5 10a5 5 0 0 1-10 0c0-2 1-3.500 2-4.500 0 2 1 3 2 3 0-3-1-5 1-8.500z"/>'),
    heart: S('<path d="M12 21s-8-4.700-9.500-10A5 5 0 0 1 12 7a5 5 0 0 1 9.500 4C20 16.300 12 21 12 21z"/>'),
    bag: S('<path d="M6 7V6a6 6 0 0 1 12 0v1h2l1 15H3L4 7zm2 0h8V6a4 4 0 0 0-8 0z"/>'),
};
ICONS.featured = ICONS.star; ICONS.packs = ICONS.pack; ICONS.bundles = ICONS.bundle; ICONS.res = ICONS.gem; ICONS.rewards = ICONS.cup; ICONS.gifts = ICONS.gift;
const BG_KEYS = [['softsky', 'Мягкое небо'], ['softberry', 'Ягодный'], ['softmint', 'Мятный'], ['softgold', 'Тёплое золото'], ['softnight', 'Тихая ночь'], ['softrose', 'Розовый'], ['softocean', 'Глубокий океан'], ['softlilac', 'Сирень'], ['softember', 'Тёплые угли'], ['softcocoa', 'Какао'], ['softpine', 'Хвоя'], ['softslate', 'Графит'], ['village', 'Деревня'], ['snow', 'Снегопад'], ['night', 'Звёздная ночь'], ['aurora', 'Северное сияние'], ['garland', 'Гирлянды'], ['frost', 'Мороз'], ['candy', 'Леденцы'],
    ['blue', 'Синий'], ['violet', 'Фиолетовый'], ['crimson', 'Алый'], ['emerald', 'Изумрудный'], ['gold', 'Золотой'],
    ['cabin', 'Домик'], ['bauble', 'Шары на ёлке'], ['gifts', 'Подарки'], ['sparklers', 'Бенгальские огни'], ['champagne', 'Шампанское'], ['northpole', 'Северный полюс'], ['wreath', 'Венок'], ['skating', 'Каток'], ['santa', 'Дед Мороз'], ['sunrise', 'Рассвет'], ['desert', 'Пустыня'], ['jungle', 'Джунгли'], ['cherry', 'Сакура'], ['space', 'Космос'], ['cyber', 'Кибер'], ['bubbles', 'Пузыри'], ['storm', 'Гроза'], ['hex', 'Соты'], ['collab', 'Коллаборация'], ['nikolay', 'Николай'], ['goshan', 'Гошан'], ['gifton', 'GiftTon'],
    ['fireworks', 'Фейерверк'], ['confetti', 'Конфетти'], ['snowstorm', 'Метель'], ['galaxy', 'Галактика'], ['neon', 'Неон'], ['sunset', 'Закат'], ['ocean', 'Океан'], ['forest', 'Лес'], ['mint', 'Мята'], ['rose', 'Роза'], ['steel', 'Сталь'], ['lava', 'Лава'],
    ['tree', 'Ёлка'], ['stars', 'Звёздный'], ['mitten', 'Варежки'], ['cozy', 'Уют'], ['ice', 'Лёд'], ['pine', 'Хвоя'], ['berry', 'Ягоды'], ['cocoa', 'Какао'], ['polar', 'Полярный'], ['moon', 'Лунная ночь']];
const CARD_BG_KEYS = [['', 'По редкости'], ['c-softsky', 'Мягкое небо'], ['c-softberry', 'Ягодный'], ['c-softmint', 'Мятный'], ['c-softgold', 'Тёплое золото'], ['c-softnight', 'Тихая ночь'], ['c-softrose', 'Розовый'], ['c-softocean', 'Глубокий океан'], ['c-softlilac', 'Сирень'], ['c-softember', 'Тёплые угли'], ['c-softcocoa', 'Какао'], ['c-softpine', 'Хвоя'], ['c-softslate', 'Графит'], ['ny-snow', 'Снежная ночь'], ['ny-candy', 'Леденцы'], ['ny-lights', 'Гирлянды'], ['ny-frost', 'Иней'], ['ny-ginger', 'Пряник'], ['ny-bells', 'Колокольчики'], ['ny-fire', 'Камин'],
    ['ny-aurora', 'Сияние'], ['c-blue', 'Синий'], ['c-violet', 'Фиолетовый'], ['c-crimson', 'Алый'], ['c-emerald', 'Изумрудный'], ['c-gold', 'Золотой'], ['c-pink', 'Розовый'],
    ['ny-cabin', 'Домик'], ['ny-bauble', 'Шары на ёлке'], ['ny-gifts', 'Подарки'], ['ny-sparklers', 'Бенгальские огни'], ['ny-champagne', 'Шампанское'], ['ny-northpole', 'Северный полюс'], ['ny-wreath', 'Венок'], ['ny-skating', 'Каток'], ['ny-santa', 'Дед Мороз'], ['c-sunrise', 'Рассвет'], ['c-desert', 'Пустыня'], ['c-jungle', 'Джунгли'], ['c-cherry', 'Сакура'], ['c-space', 'Космос'], ['c-cyber', 'Кибер'], ['c-bubbles', 'Пузыри'], ['c-storm', 'Гроза'], ['c-hex', 'Соты'], ['ny-collab', 'Коллаборация'], ['ny-nikolay', 'Николай'], ['ny-goshan', 'Гошан'], ['ny-gifton', 'GiftTon'],
    ['ny-fireworks', 'Фейерверк'], ['ny-confetti', 'Конфетти'], ['ny-snowstorm', 'Метель'], ['c-galaxy', 'Галактика'], ['c-neon', 'Неон'], ['c-sunset', 'Закат'], ['c-ocean', 'Океан'], ['c-forest', 'Лес'], ['c-mint', 'Мята'], ['c-rose', 'Роза'], ['c-steel', 'Сталь'], ['c-lava', 'Лава'],
    ['ny-tree', 'Ёлка'], ['ny-stars', 'Звёзды'], ['ny-mitten', 'Варежки'], ['ny-cozy', 'Уют'], ['ny-ice', 'Лёд'], ['ny-gold', 'Золото'], ['ny-pine', 'Хвоя'], ['ny-berry', 'Ягоды'], ['ny-cocoa', 'Какао'], ['ny-polar', 'Полярный'], ['ny-moon', 'Лунная ночь']];
const DEFAULT_SECTIONS = [
    {id: 'featured', title: 'Акции', kind: 'smart', rule: 'featured', icon: 'builtin:star', preview: '', bg: 'village', enabled: true},
    {id: 'packs', title: 'Паки', kind: 'smart', rule: 'packs', icon: 'builtin:pack', preview: '', bg: 'night', enabled: true},
    {id: 'collabs', title: 'Коллаборации', kind: 'smart', rule: 'collab', icon: 'builtin:crown', preview: '', bg: 'collab', enabled: true},
    {id: 'bundles', title: 'Наборы', kind: 'smart', rule: 'bundles', icon: 'builtin:bundle', preview: '', bg: 'candy', enabled: true},
    {id: 'res', title: 'Ресурсы', kind: 'smart', rule: 'res', icon: 'builtin:gem', preview: '', bg: 'emerald', enabled: true},
    {id: 'rewards', title: 'Награды', kind: 'smart', rule: 'rewards', icon: 'builtin:cup', preview: '', bg: 'gold', enabled: true},
    {id: 'gifts', title: 'Подарки', kind: 'smart', rule: 'gifts', icon: 'builtin:gift', preview: '', bg: 'snow', enabled: true},
];
function iconHTML(icon, rule) {
    if (icon && icon.startsWith('builtin:')) return ICONS[icon.slice(8)] || ICONS.star;
    if (icon && /^\/media\/shop\//.test(icon)) return '<img class="fm-ico-img" src="' + e(icon) + '" alt="" draggable="false">';
    return ICONS[rule] || ICONS.star;
}
function railButton(s) {
    return '<button type="button" class="fm-sec" data-fm-sec="' + e(s.id) + '" title="' + e(s.title) + '"><span class="fm-ico">' + iconHTML(s.icon, s.rule) + '</span><span class="fm-lab">' + e(s.title) + '</span></button>' +
        (s.preview && /^\/media\/shop\//.test(s.preview) ? '<img class="fm-pic" src="' + e(s.preview) + '" alt="" draggable="false">' : '');
}
function bgHTML(key) {
    if (window.crafterScenes && !(key && key.startsWith('image:'))) return '<div class="fm-bgx">' + window.crafterScenes.render(key || 'night') + '</div>';
    if (key && key.startsWith('image:')) return '<div class="fm-bgx bg-image" style="background-image:url(' + e(key.slice(6)) + ')"></div>';
    if (key === 'village' && window.crafterVillage) return '<div class="fm-bgx bg-village">' + window.crafterVillage() + '</div>';
    const k = key === 'village' ? 'night' : (key || 'night');
    let kids = '';
    if (false) for (let i = 0; i < 38; i++) kids += '<i class="fm-flake" style="--x:' + ((i * 37 + 7) % 100) + '%;--s:' + (2 + i % 4) + 'px;--t:' + (9 + i % 7) + 's;--d:-' + ((i * 1.7) % 11).toFixed(1) + 's;--dx:' + (i % 2 ? 24 : -24) + 'px"></i>';
    if (['snow', 'tree', 'pine', 'ice', 'polar', 'moon', 'cozy', 'cocoa'].includes(k)) for (let i = 0; i < 26; i++) kids += '<i class="fm-flake" style="--x:' + ((i * 41 + 9) % 100) + '%;--s:' + (2 + i % 4) + 'px;--t:' + (10 + i % 6) + 's;--d:-' + ((i * 1.9) % 12).toFixed(1) + 's;--dx:' + (i % 2 ? 20 : -20) + 'px"></i>';
    if (k === 'fireworks') {
        const cols = ['#ff5c6e', '#ffd27a', '#6ac7ff', '#9be37f', '#c39bff', '#ff9ad5'];
        for (let i = 0; i < 9; i++) kids += '<i class="fm-fw" style="--x:' + ((i * 37 + 12) % 88 + 6) + '%;--y:' + ((i * 23 + 10) % 48 + 8) + '%;--s:' + (110 + (i * 29) % 90) + 'px;--c:' + cols[i % cols.length] + ';--d:-' + ((i * 0.9) % 5).toFixed(1) + 's"></i><i class="fm-fw b" style="--x:' + ((i * 37 + 12) % 88 + 6) + '%;--y:' + ((i * 23 + 10) % 48 + 8) + '%;--s:' + (70 + (i * 17) % 60) + 'px;--c:#fff;--d:-' + ((i * 0.9 + .3) % 5).toFixed(1) + 's"></i>';
    }
    if (k === 'confetti') for (let i = 0; i < 34; i++) kids += '<i class="fm-conf" style="--x:' + ((i * 29 + 5) % 100) + '%;--c:' + ['#ff5c6e', '#ffd27a', '#6ac7ff', '#9be37f', '#c39bff'][i % 5] + ';--t:' + (7 + i % 6) + 's;--d:-' + ((i * 1.3) % 9).toFixed(1) + 's;--r:' + (i * 47 % 360) + 'deg"></i>';
    if (k === 'snowstorm') for (let i = 0; i < 70; i++) kids += '<i class="fm-flake" style="--x:' + ((i * 31 + 3) % 100) + '%;--s:' + (2 + i % 5) + 'px;--t:' + (4 + i % 5) + 's;--d:-' + ((i * 0.7) % 6).toFixed(1) + 's;--dx:' + (i % 2 ? 90 : -60) + 'px"></i>';
    if (k === 'night' || k === 'stars' || k === 'moon' || k === 'galaxy' || k === 'fireworks') for (let i = 0; i < 46; i++) kids += '<i class="fm-star" style="--x:' + ((i * 53 + 11) % 100) + '%;--y:' + ((i * 29 + 5) % 100) + '%;--s:' + (1 + i % 3) + 'px;--d:-' + ((i * .7) % 5).toFixed(1) + 's"></i>';
    if (k === 'aurora') kids = '<i class="fm-blob a"></i><i class="fm-blob b"></i><i class="fm-blob c"></i>';
    if (k === 'garland') { let b = ''; for (let i = 0; i < 18; i++) b += '<i class="fm-bulb" style="--x:' + (i * 5.8).toFixed(1) + '%;--c:' + ['#ff5c6e', '#ffd27a', '#6ac7ff', '#9be37f', '#c39bff'][i % 5] + ';--d:-' + ((i * .45) % 3).toFixed(1) + 's"></i>'; kids = '<span class="fm-wire"></span>' + b; }
    if (k === 'frost') for (let i = 0; i < 9; i++) kids += '<i class="fm-crystal" style="--x:' + ((i * 41 + 9) % 100) + '%;--y:' + ((i * 23 + 13) % 100) + '%;--s:' + (50 + (i * 37) % 90) + 'px;--r:' + (i * 31 % 90) + 'deg"></i>';
    return '<div class="fm-bgx bg-' + e(k) + '">' + kids + '</div>';
}

function rarityOf(it) {
    if (it.rarity && it.rarity !== 'auto') return it.rarity;
    if (['GRAM', 'BALL', 'PROMO', 'STAR'].includes(it.kind)) return 'res';
    const p = Number(it.price_balls) || 0;
    return p >= 8000 ? 'legend' : p >= 2500 ? 'mythic' : p >= 800 ? 'epic' : p >= 400 ? 'rare' : 'common';
}
const sizeOf = it => (it.size && WIDTH[it.size] ? it.size : 'small');
function leftText(s) {
    if (s <= 0) return 'Закончилась';
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? d + 'д. ' + h + 'ч.' : h ? h + 'ч. ' + m + 'м.' : m + 'м. ' + (s % 60) + 'с.';
}
function artOf(it) {
    if (it.mode === 'random' && it.contents && it.contents.length) {                 // a black pack with a question mark
        return '<div class="fm-mystery"><img class="si-solo" src="' + e(it.contents[0].pack.image) + '" alt=""><b>?</b><i></i><i></i><i></i></div>';
    }
    if (it.mode === 'choice' && it.contents && it.contents.length) {
        const list = it.contents.slice(0, 4), n = list.length;
        return '<div class="fm-choiceart">' + list.map((c, i) => '<img src="' + e(c.pack.image) + '" alt="" style="--i:' + i + ';--n:' + n + '">').join('') + '</div>';
    }
    const f = SI().artHTML;
    return f ? f(it) : '<img class="si-solo" src="' + e(it.image_url || '/static/assets/community-reward.svg') + '" alt="">';
}
function descOf(it) {
    const d = SI().describe;
    if (!it.description && it.mode === 'choice') return 'Выберите один из ' + (it.contents || []).length + ' паков и получите его сразу.';
    if (!it.description && it.mode === 'random') return 'Случайный пак из ' + (it.contents || []).length + ': какой выпадет, узнаете после покупки.';
    return it.description || (d ? d(it) : '');
}
const priceOf = it => it.price_balls ? ORN + '<b>' + num(it.price_balls) + '</b>' : '<b>Бесплатно</b>';
const headingOf = it => it.heading || (it.mode === 'choice' ? 'Акция с выбором' : it.mode === 'random' ? 'Случайный пак' : NAMES[rarityOf(it)]);

/* ---------- one offer card ---------- */
function card(o, opts = {}) {
    if (o.src === 'fb' && window.crafterFreebies) return window.crafterFreebies.card(o.ev);
    if (o.src === 'ch' && window.crafterChains) return window.crafterChains.card(o.ch);
    const it = o.it, r = rarityOf(it), size = sizeOf(it), left = it.ends_at ? it.ends_at - nowSec() : null;
    const tab = left !== null ? '<span class="fm-tab" data-fm-end="' + it.ends_at + '">' + leftText(left) + '</span>'
        : it.left !== null && it.left !== undefined ? '<span class="fm-tab">Осталось ' + num(it.left) + '</span>' : '';
    const off = it.discount_percent > 0 ? '<span class="fm-off"><small>Скидка</small><b>' + it.discount_percent + '%</b></span>' : '';
    const showDesc = ['wide', 'large', 'banner'].includes(size) && descOf(it);
    const cbg = it.card_bg || '';
    const scene = cbg && !cbg.startsWith('image:') && window.crafterScenes ? '<div class="fm-cbs">' + window.crafterScenes.render(cbg) + '</div>' : '';
    const cbClass = cbg ? (cbg.startsWith('image:') ? ' cb-image' : (scene ? ' has-cbs' + (window.crafterScenes.light(cbg) ? ' is-light' : '') : ' cb-' + cbg)) : '';
    const cbStyle = cbg.startsWith('image:') ? ' style="background-image:linear-gradient(rgba(8,12,40,.18),rgba(8,12,40,.5)),url(' + e(cbg.slice(6)) + ')"' : '';
    return '<div class="fm-card r-' + r + (it.chest ? ' fm-chestcard' : '') + ' fm-s-' + size + (opts.board ? ' is-board' : '') + (opts.fresh ? ' is-fresh' : '') + '" data-fm="' + e(o.key) + '" style="--u:' + WIDTH[size] + '" tabindex="0" role="button" aria-label="' + e(it.title) + '">' +
        tab + (it.badge ? '<span class="fm-new">' + e(it.badge) + '</span>' : '') +
        '<div class="fm-body' + cbClass + '"' + cbStyle + '>' + scene + '<i class="fm-rays"></i><i class="fm-dots"></i><i class="fm-glint"></i>' +
        '<h3 class="fm-title">' + e(headingOf(it)) + '</h3>' +
        '<div class="fm-art">' + artOf(it) + '</div>' +
        '<div class="fm-name"><b>' + e(it.title) + '</b><small>' + e(TYPES[it.kind] || '') + (it.bundle > 1 && it.kind !== 'BUNDLE' ? ' ×' + it.bundle : '') + '</small>' +
        (showDesc ? '<p>' + e(descOf(it)) + '</p>' : '') + '</div>' +
        off + '<div class="fm-price">' + (it.old_price_balls > it.price_balls ? '<s>' + num(it.old_price_balls) + '</s>' : '') + '<span>' + priceOf(it) + '</span></div>' +
        '<i class="fm-spark s1"></i><i class="fm-spark s2"></i><i class="fm-spark s3"></i></div></div>';
}

/* ---------- what an offer includes ---------- */
function includes(o) {
    const it = o.it, out = [];
    (it.contents || []).forEach(c => out.push({img: c.pack.image, label: c.pack.title, count: '×' + c.count, pack: c.pack.id}));
    (it.chests_in || []).forEach(c => out.push({img: c.chest.image, label: c.chest.title, count: '×' + c.count}));
    if (it.gram) out.push({img: '/static/assets/gram.svg', label: 'Баланс', count: num(it.gram) + ' GRAM'});
    if (it.balls) out.push({img: '/static/assets/new-year-ornament.svg', label: 'Новогодние шары', count: num(it.balls)});
    if (!out.length) {
        const pic = it.pack?.image || it.star?.image || it.image_url || (it.kind === 'GRAM' ? '/static/assets/gram.svg' : '/static/assets/new-year-ornament.svg');
        const count = it.kind === 'GRAM' ? num(it.amount) + ' GRAM' : it.kind === 'BALL' ? num(it.amount) : it.bundle > 1 ? '×' + it.bundle : '1';
        out.push({img: pic, label: it.title, count, pack: (it.kind === 'PACK' && it.amount) || ''});
    }
    return out;
}
function packImages(it) {
    const list = [];
    if (it.mode === 'random' && it.contents && it.contents.length) return [it.contents[0].pack.image];
    if (it.mode === 'choice' && it.contents) return it.contents.map(c => c.pack.image).slice(0, 6);
    (it.contents || []).forEach(c => { for (let i = 0; i < Math.min(c.count, 3); i++) list.push(c.pack.image); });
    if (!list.length && (it.pack?.image || it.kind === 'PACK')) for (let i = 0; i < Math.min(it.bundle || 1, 8); i++) list.push(it.pack?.image || it.image_url);
    return list.slice(0, 9);
}

/* ---------- the panel of chances ---------- */
const chanceCache = new Map();
async function chancesData(pid, ctx) {
    if (ctx.preview) throw new Error('В предпросмотре шансы не показываются');
    if (!chanceCache.has(pid)) chanceCache.set(pid, api('packs/' + encodeURIComponent(pid) + '/contents'));
    try { return await chanceCache.get(pid); } catch (error) { chanceCache.delete(pid); throw error; }
}
const tierOf = ch => ch < 1 ? 'legend' : ch < 3 ? 'epic' : ch < 10 ? 'rare' : 'common';
const pct = v => (v < 0.01 ? '<0,01' : v < 1 ? v.toFixed(2).replace('.', ',') : v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)) + '%';
function openChances(packs, ctx) {
    document.querySelector('.fm-chances')?.remove();
    const el = document.createElement('div');
    el.className = 'fm-chances';
    const scene = window.crafterScenes ? '<div class="fm-cbs">' + window.crafterScenes.render('night', {still: true}) + '</div>' : '';
    el.innerHTML = scene + '<div class="fm-ch-top"><h2>Шансы на награды</h2><button type="button" class="fm-x" data-fm-x aria-label="Закрыть"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
        '<div class="fm-ch-layout">' + (packs.length > 1 ? '<div class="fm-ch-side">' + packs.map((p, i) => '<button type="button" class="fm-ch-pk' + (i ? '' : ' is-on') + '" data-p="' + e(p.id) + '"><img src="' + e(p.image) + '" alt=""><span>' + e(p.title) + '</span></button>').join('') + '</div>' : '') +
        '<div class="fm-ch-body" data-fm-ch><div class="fm-ch-load"><i></i><i></i><i></i></div></div></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 240); document.removeEventListener('keydown', onKey); };
    const onKey = ev => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    el.querySelector('[data-fm-x]').addEventListener('click', close);
    const body = el.querySelector('[data-fm-ch]');
    const show = async pack => {
        body.innerHTML = '<div class="fm-ch-load"><i></i><i></i><i></i></div>';
        body.scrollTop = 0;
        try {
            const d = await chancesData(pack.id, ctx);
            const nft = d.prizes.filter(p => p.kind === 'NFT').sort((a, b) => a.chance - b.chance), gram = d.prizes.filter(p => p.kind !== 'NFT').sort((a, b) => Number(a.amount) - Number(b.amount));
            const counts = d.cards.map(c => c.count), avg = d.cards.reduce((x, c) => x + c.count * c.chance, 0) / 100;
            const top = Math.max(...d.cards.map(c => c.chance));
            const cardWord = n => n === 1 ? 'карточка' : n < 5 ? 'карточки' : 'карточек';
            body.innerHTML = '<div class="fm-ch-hero"><img src="' + e(d.pack.image || pack.image) + '" alt=""><div><b>' + e(d.pack.title || pack.title) + '</b><small>В паке от ' + Math.min(...counts) + ' до ' + Math.max(...counts) + ' карточек · в среднем ' + avg.toFixed(1).replace('.', ',') + '</small></div></div>' +
                '<section class="fm-ch-sec"><h4>Сколько карточек в паке</h4><div class="fm-ch-bars">' + d.cards.map(c => '<div class="fm-ch-bar"><span>' + c.count + ' ' + cardWord(c.count) + '</span><i><u style="width:' + Math.max(2, c.chance / top * 100).toFixed(1) + '%"></u></i><b>' + pct(c.chance) + '</b></div>').join('') + '</div></section>' +
                (nft.length ? '<section class="fm-ch-sec"><h4>Подарки <small>шанс на одну карточку</small></h4><div class="fm-ch-gifts">' + nft.map((p, i) => '<div class="fm-ch-gift t-' + tierOf(p.chance) + '" style="--i:' + i + '"><em>' + pct(p.chance) + '</em><img src="' + e(p.image) + '" alt="" loading="lazy"><b>' + e(p.model || p.name) + '</b><small>' + e(p.model ? p.name : '') + '</small><u>' + num(p.value) + ' GRAM</u></div>').join('') + '</div></section>' : '') +
                (gram.length ? '<section class="fm-ch-sec"><h4>Баланс GRAM <small>шанс на одну карточку</small></h4><div class="fm-ch-gram">' + gram.map(p => '<div class="fm-ch-g t-' + tierOf(p.chance) + '"><b>' + num(p.amount) + '</b><span>GRAM</span><em>' + pct(p.chance) + '</em></div>').join('') + '</div></section>' : '');
        } catch (error) { body.innerHTML = '<p class="fm-ch-err">' + e(error.message) + '</p>'; }
    };
    show(packs[0]);
    el.querySelectorAll('.fm-ch-pk').forEach(b => b.addEventListener('click', () => {
        el.querySelectorAll('.fm-ch-pk').forEach(x => x.classList.toggle('is-on', x === b));
        show(packs.find(p => p.id === b.dataset.p));
    }));
}

/* ---------- the reveal after a purchase ---------- */
function reveal(o, result, ctx, closeStage) {
    const it = o.it, el = document.createElement('div');
    el.className = 'fm-reveal r-' + rarityOf(it);
    const ids = result.packIds || [], total = result.count || it.bundle || ids.length || 1;
    const got = result.picked && (it.contents || []).find(c => c.pack.id === result.picked);
    const imgs = got ? Array.from({length: Math.min(total, 8)}, () => got.pack.image) : packImages(it);
    const spawn = imgs.length ? imgs : [it.pack?.image || it.image_url || '/static/assets/gram.svg'];
    const isPack = Boolean(result.packIds);
    const fan = spawn.map((src, i) => {
        const mid = (spawn.length - 1) / 2, x = (i - mid) * (spawn.length > 5 ? 11 : 15);
        return '<img class="fm-rv-pack" src="' + e(src) + '" alt="" style="--x:' + x.toFixed(1) + '%;--r:' + ((i - mid) * 5).toFixed(1) + 'deg;--i:' + i + ';--z:' + (20 - Math.round(Math.abs(i - mid) * 2)) + '">';
    }).join('');
    const sparks = Array.from({length: 26}, (_, i) => '<i class="fm-rv-spark" style="--a:' + (i * 360 / 26).toFixed(0) + 'deg;--d:' + (120 + (i * 37) % 160) + 'px;--t:' + (.9 + (i % 5) * .12).toFixed(2) + 's;--c:' + ['#ffd36b', '#7cc8ff', '#ff7a9a', '#9be37f', '#ffffff'][i % 5] + '"></i>').join('');
    let title, text, buttons;
    if (isPack) {
        title = got ? (it.mode === 'random' ? 'Вам выпал: ' : 'Вы получили: ') + '<b>' + e(got.pack.title) + (total > 1 ? ' ×' + num(total) : '') + '</b>' : 'Вы купили: <b>×' + num(total) + '</b>';
        if (result.title) title = result.title;
        text = total > 1 ? 'Паки уже в инвентаре («Мои подарки»). Что с ними сделать?' : 'Пак уже в инвентаре («Мои подарки»). Что с ним сделать?';
        buttons = '<button type="button" class="fm-btn green" data-rv-open>' + (total > 1 ? 'Открыть все (' + num(total) + ')' : 'Открыть сейчас') + '</button>' +
            '<button type="button" class="fm-btn blue" data-rv-keep>Оставить в инвентаре</button>';
    } else {
        title = result.title || 'Покупка совершена';
        text = result.text || '';
        buttons = (result.html || '') + '<button type="button" class="fm-btn green" data-rv-keep>Отлично</button>';
    }
    const cb = it.card_bg || '';
    const rvScene = cb && !cb.startsWith('image:') && window.crafterScenes;
    const rvBg = rvScene ? '<div class="fm-rv-bg">' + window.crafterScenes.render(cb) + '</div>' : cb ? '<div class="fm-rv-bg ' + (cb.startsWith('image:') ? 'cb-image' : 'cb-' + e(cb)) + '"' + (cb.startsWith('image:') ? ' style="background-image:linear-gradient(rgba(8,12,40,.3),rgba(8,12,40,.55)),url(' + e(cb.slice(6)) + ')"' : '') + '></div>' : '';
    el.innerHTML = rvBg + '<i class="fm-rays big"></i><i class="fm-dots"></i><div class="fm-rv-stage"><div class="fm-rv-burst">' + sparks + '</div><div class="fm-rv-packs' + (spawn.length === 1 ? ' is-one' : '') + '"><i class="fm-rv-aura"></i>' + fan + '</div></div>' +
        '<div class="fm-rv-panel"><small>' + e(result.head || 'Покупка совершена') + '</small><h2>' + title + '</h2><p>' + e(text) + '</p><div class="fm-rv-btns">' + buttons + '</div></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    // a random pack: the packs of the offer flash by like a reel, slow down and stop on the one that dropped
    const pool = (it.contents || []).map(c => c.pack.image).filter(Boolean);
    if (it.mode === 'random' && got && pool.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches && !ctx.preview) {
        const slots = [...el.querySelectorAll('.fm-rv-pack')], finalSrc = got.pack.image;
        el.classList.add('is-rolling');
        let i = Math.floor(Math.random() * pool.length), wait = 60;
        const spin = () => {
            if (wait > 430) {                                                // the last step: it stops on the real pack
                slots.forEach(img => { img.src = finalSrc; });
                el.classList.remove('is-rolling'); el.classList.add('is-landed');
                return;
            }
            i = (i + 1) % pool.length;
            slots.forEach(img => { img.src = pool[i]; });
            wait *= 1.13;
            setTimeout(spin, wait);
        };
        setTimeout(spin, 320);
    }
    const done = () => { el.classList.remove('is-in'); setTimeout(() => { el.remove(); closeStage(); }, 260); ctx.refresh?.(); };
    el.querySelector('[data-rv-keep]')?.addEventListener('click', done);
    el.querySelector('[data-rv-open]')?.addEventListener('click', async () => {
        if (ctx.preview || !ids.length) { done(); return; }
        const btn = el.querySelector('[data-rv-open]'), keep = el.querySelector('[data-rv-keep]');
        btn.disabled = true; keep.disabled = true; btn.classList.add('is-busy'); btn.textContent = 'Открываем…';
        const pre = api('packs/open', {user_pack_id: ids[0]});            // the first pack is opened on the server while the screen is still here
        pre.catch(() => {});
        try { await pre; } catch (error) { toast(error.message); btn.disabled = false; keep.disabled = false; btn.classList.remove('is-busy'); btn.textContent = 'Открыть сейчас'; return; }
        el.classList.remove('is-in'); setTimeout(() => el.remove(), 200); closeStage();
        try { await window.crafterPacks.openMany(ids, ctx.refresh, pre); } catch (error) { toast(error.message); }
    });
    result.bind?.(el);
    return el;
}

/* ---------- the window of a lot ---------- */
const BASE = '/new-year/market';
const CHEV = d => '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
/* the window of the freebies: a row of gift boxes on a background that is mirrored again and again */
function fbStage(o, ctx, opts2 = {}) {
    document.querySelector('.fm-stage')?.remove();
    const ev = o.ev, el = document.createElement('div');
    el.className = 'fm-stage fm-fbstage';
    el.innerHTML = '<button type="button" class="fm-back" data-fm-close aria-label="Назад"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></button>' +
        '<span class="fm-bal">' + ORN + '<b data-fm-bal>' + num(ctx.balance ? ctx.balance() : 0) + '</b></span><div class="fb-host" data-fb-host></div>';
    el.style.backgroundImage = 'url(' + ev.page_bg + ')';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    if (window.crafterFreebies?.tileBg) window.crafterFreebies.tileBg(ev.page_bg, innerWidth < 760 ? 520 : 900).then(t => { if (!el.isConnected) return; el.style.backgroundImage = 'url(' + t.url + ')'; el.style.backgroundSize = t.w + 'px ' + t.h + 'px'; el.style.backgroundRepeat = 'repeat'; });
    window.crafterFreebies?.mount(el.querySelector('[data-fb-host]'), ev, {reload: ctx.refresh});
    let pushed = false, closed = false;
    if (!ctx.preview) {
        try {
            if (opts2.fromUrl) history.replaceState({crafterPage: 'new-year', fmLot: o.key}, '', BASE + '/' + encodeURIComponent(o.key));
            else { history.pushState({crafterPage: 'new-year', fmLot: o.key}, '', BASE + '/' + encodeURIComponent(o.key)); pushed = true; }
        } catch (_) {}
    }
    const onPop = () => { if (location.pathname.indexOf(BASE + '/') !== 0) close(true); };
    const close = fromPop => {
        if (closed) return; closed = true;
        el.classList.remove('is-in'); setTimeout(() => el.remove(), 260);
        document.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop);
        { const t = document.querySelector('[data-fm="fb:' + ev.id + '"]'); if (t && window.crafterFreebies) { const d = document.createElement('div'); d.innerHTML = window.crafterFreebies.card(ev); t.replaceWith(d.firstElementChild); } }
        if (!ctx.preview && fromPop !== true) { try { if (pushed) history.back(); else history.replaceState({crafterPage: 'new-year'}, '', BASE); } catch (_) {} }
    };
    const onKey = ev2 => { if (ev2.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey); window.addEventListener('popstate', onPop);
    el.querySelector('[data-fm-close]').addEventListener('click', () => close());
    return el;
}

function stage(o, ctx, opts2 = {}) {
    if (o.src === 'fb') return fbStage(o, ctx, opts2);
    if (o.src === 'ch') return window.crafterChains.stage(o.ch, ctx);
    const it = o.it, r = rarityOf(it);
    document.querySelector('.fm-stage')?.remove();
    const el = document.createElement('div');
    const stageScene = it.card_bg && !it.card_bg.startsWith('image:') && window.crafterScenes ? '<div class="fm-cbs">' + window.crafterScenes.render(it.card_bg) + '</div>' : '';
    el.className = 'fm-stage r-' + r + (it.card_bg ? (it.card_bg.startsWith('image:') ? '' : (stageScene ? ' has-cbs' : ' cb-' + it.card_bg)) : '');
    const inc = includes(o);
    const choice = it.mode === 'choice' && it.contents && it.contents.length > 1 ? it.contents : null;
    let pick = 0;
    const lines = descOf(it).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 5);
    const packsIn = inc.filter(x => x.pack).map(x => ({id: x.pack, title: x.label, image: x.img}));
    const optArt = i => '<img class="si-solo fm-pickart" src="' + e(choice[i].pack.image) + '" alt="">' + (choice[i].count > 1 ? '<b class="fm-pickcount">×' + choice[i].count + '</b>' : '');
    const heroInner = choice ? optArt(0) : artOf(it);
    const incHead = it.mode === 'random' ? 'Может выпасть' : choice ? 'Выберите один' : 'Включает';
    el.innerHTML = stageScene + '<i class="fm-rays big"></i><i class="fm-dots"></i>' +
        '<button type="button" class="fm-back" data-fm-close aria-label="Назад"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></button>' +
        '<span class="fm-bal">' + ORN + '<b data-fm-bal>' + num(ctx.balance ? ctx.balance() : 0) + '</b></span>' +
        '<div class="fm-info"><div class="fm-plate"><small>' + e(headingOf(it)) + '</small><h2>' + e(it.title) + '</h2></div>' +
        (choice ? '<p class="fm-pickname" data-fm-pickname></p>' : '') +
        (lines.length ? '<ul class="fm-lines">' + lines.map(l => '<li>' + e(l) + '</li>').join('') + '</ul>' : '') + '</div>' +
        '<div class="fm-hero">' + (choice ? '<button type="button" class="fm-harrow l" data-fm-h="-1" aria-label="Предыдущий">' + CHEV('m15 5-7 7 7 7') + '</button><button type="button" class="fm-harrow r" data-fm-h="1" aria-label="Следующий">' + CHEV('m9 5 7 7-7 7') + '</button>' : '') +
        '<div class="fm-floor"></div><div class="fm-heroart' + (it.chest ? ' is-chest' : '') + '" data-fm-heroart>' + heroInner + '</div>' + (it.discount_percent > 0 ? '<span class="fm-off big"><small>Скидка</small><b>' + it.discount_percent + '%</b></span>' : '') + '</div>' +
        '<div class="fm-inc"><div class="fm-inc-head"><b>' + incHead + '</b>' + (packsIn.length || it.chest ? '<button type="button" class="fm-q" data-fm-chances aria-label="Шансы на награды"><span>?</span><small>Шансы</small></button>' : '') + '</div>' +
        '<div class="fm-inc-grid">' + inc.map((x, i) => '<button type="button" class="fm-ic' + (choice && !i ? ' is-pick' : '') + '" style="--i:' + i + '"' + (choice ? ' data-fm-opt="' + i + '"' : x.pack ? ' data-fm-pk="' + e(x.pack) + '"' : '') + '><img src="' + e(x.img) + '" alt=""><b>' + e(x.count) + '</b><span>' + e(x.label) + '</span></button>').join('') + '</div></div>' +
        '<div class="fm-buy"><button type="button" class="fm-buybtn" data-fm-buy>' + (it.old_price_balls > it.price_balls ? '<s>' + num(it.old_price_balls) + '</s>' : '') + '<span>' + (it.price_balls ? ORN + '<b>' + num(it.price_balls) + '</b>' : '<b>Получить</b>') + '</span></button>' +
        '<p class="fm-err" role="alert"></p></div>' +
        '<div class="fm-confirm" hidden><div class="fm-cbox"><b>Подтвердить?</b><span class="fm-cwhat" data-fm-cwhat></span><button type="button" class="fm-yes" data-fm-yes>ДА</button><button type="button" class="fm-no" data-fm-no>Отмена</button></div></div>';
    if (it.card_bg && it.card_bg.startsWith('image:')) el.style.backgroundImage = 'linear-gradient(rgba(8,12,40,.3),rgba(8,12,40,.55)),url(' + it.card_bg.slice(6) + ')', el.style.backgroundSize = 'cover';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    // every lot has its own address: a link opens the lot, Back closes it
    let pushed = false, closed = false;
    if (!ctx.preview) {
        try {
            if (opts2.fromUrl) history.replaceState({crafterPage: 'new-year', fmLot: o.key}, '', BASE + '/' + encodeURIComponent(o.key));
            else { history.pushState({crafterPage: 'new-year', fmLot: o.key}, '', BASE + '/' + encodeURIComponent(o.key)); pushed = true; }
        } catch (_) {}
    }
    const onPop = () => { if (location.pathname.indexOf(BASE + '/') !== 0) close(true); };
    const close = fromPop => {
        if (closed) return; closed = true;
        el.classList.remove('is-in'); setTimeout(() => el.remove(), 260);
        document.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop);
        if (!ctx.preview && fromPop !== true) { try { if (pushed) history.back(); else history.replaceState({crafterPage: 'new-year'}, '', BASE); } catch (_) {} }
    };
    const onKey = ev => { if (ev.key === 'Escape' && !document.querySelector('.fm-chances,.fm-reveal')) close(); };
    document.addEventListener('keydown', onKey); window.addEventListener('popstate', onPop);
    el.querySelector('[data-fm-close]').addEventListener('click', () => close());
    const chancesList = () => { const first = choice ? packsIn[pick] : null; return first ? [first].concat(packsIn.filter((_, j) => j !== pick)) : packsIn; };
    el.querySelector('[data-fm-chances]')?.addEventListener('click', () => it.chest ? window.crafterChests.chances(it.chest.id, api) : openChances(chancesList(), ctx));
    if (it.chest && window.crafterChests) {                           // the chest stands in the window as a 3D model, the picture is the fallback
        const art = el.querySelector('[data-fm-heroart]');
        art.innerHTML = '<div class="cx-host"><img class="si-solo" src="' + e(it.chest.image) + '" alt=""></div>';
        const v = window.crafterChests.viewer(art.firstChild, it.chest, {drag: true});
        v.ready.catch(() => {});
        new MutationObserver((_, ob) => { if (!el.isConnected) { v.dispose(); ob.disconnect(); } }).observe(document.body, {childList: true});
    }
    el.querySelectorAll('[data-fm-pk]').forEach(b => b.addEventListener('click', () => { const i = packsIn.findIndex(p => p.id === b.dataset.fmPk); openChances(i > 0 ? [packsIn[i]].concat(packsIn.filter((_, j) => j !== i)) : packsIn, ctx); }));
    const nameEl = el.querySelector('[data-fm-pickname]');
    const setPick = i => {
        pick = (i + choice.length) % choice.length;
        const art = el.querySelector('[data-fm-heroart]');
        art.classList.remove('fm-swap'); void art.offsetWidth;
        art.innerHTML = optArt(pick); art.classList.add('fm-swap');
        el.querySelectorAll('[data-fm-opt]').forEach(b => b.classList.toggle('is-pick', Number(b.dataset.fmOpt) === pick));
        nameEl.innerHTML = 'Ваш выбор: <b>' + e(choice[pick].pack.title) + (choice[pick].count > 1 ? ' ×' + choice[pick].count : '') + '</b>';
    };
    if (choice) {
        setPick(0);
        el.querySelectorAll('[data-fm-opt]').forEach(b => b.addEventListener('click', () => setPick(Number(b.dataset.fmOpt))));
        el.querySelectorAll('[data-fm-h]').forEach(b => b.addEventListener('click', () => setPick(pick + Number(b.dataset.fmH))));
        el.addEventListener('keydown', ev => { if (ev.key === 'ArrowLeft') setPick(pick - 1); if (ev.key === 'ArrowRight') setPick(pick + 1); });
    }
    const btn = el.querySelector('[data-fm-buy]'), err = el.querySelector('.fm-err'), bubble = el.querySelector('.fm-confirm');
    const hide = () => { bubble.classList.remove('is-in'); setTimeout(() => { bubble.hidden = true; }, 200); };
    btn.addEventListener('click', ev => {
        ev.stopPropagation(); err.textContent = '';
        if (o.src === 'cm') { close(); window.crafterCommunity.claim(o.m, ctx.refresh); return; }
        el.querySelector('[data-fm-cwhat]').innerHTML = (choice ? e(choice[pick].pack.title) + (choice[pick].count > 1 ? ' ×' + choice[pick].count : '') : e(it.title)) + (it.price_balls ? ' · ' + ORN + '<b>' + num(it.price_balls) + '</b>' : ' · бесплатно');
        bubble.hidden = false; requestAnimationFrame(() => bubble.classList.add('is-in'));
    });
    bubble.addEventListener('click', ev => { if (!ev.target.closest('.fm-cbox')) hide(); });
    el.querySelector('[data-fm-no]').addEventListener('click', hide);
    el.querySelector('[data-fm-yes]').addEventListener('click', async () => {
        const yes = el.querySelector('[data-fm-yes]');
        yes.disabled = true; err.textContent = '';
        try {
            const res = await perform(o, ctx, choice ? choice[pick].pack.id : undefined);
            hide();
            if (res.chests) {
                await window.crafterChests.playMany(res.chests, {bg: it.card_bg || res.chests[0].chest.bg, refresh: ctx.refresh, toast});
                if (res.rest) reveal(o, res.rest, ctx, () => close()); else close();
            } else if (res.chest) window.crafterChests.play(res.chest, {bg: it.card_bg || res.chest.chest.bg, refresh: ctx.refresh, toast, onDone: () => close()});
            else reveal(o, res, ctx, () => close());
        } catch (error) { hide(); err.textContent = error.message; }
        yes.disabled = false;
    });
    return el;
}
async function perform(o, ctx, choice) {
    const it = o.it, rid = 'si-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2));
    if (ctx.preview) {                                               // the preview page shows the animation only
        await new Promise(r => setTimeout(r, 450));
        const pool = it.contents || [], pickedC = it.mode === 'choice' ? pool.find(c => c.pack.id === choice) : it.mode === 'random' ? pool[0] : null;
        return ['PACK', 'BUNDLE'].includes(it.kind) ? {packIds: [], count: pickedC ? pickedC.count : it.bundle || 1, picked: pickedC ? pickedC.pack.id : undefined} : {title: it.kind === 'GRAM' ? 'Зачислено: ' + num(it.amount) + ' GRAM' : 'Покупка совершена', text: 'Так будет выглядеть сообщение игроку.'};
    }
    if (o.src === 'pack') {
        const res = await api('packs/buy', {pack_id: o.p.id, request_id: rid});
        if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(res.balance);
        return {packIds: [res.user_pack_id], count: 1};
    }
    const res = await api('shop-items/buy', {item_id: it.id, request_id: rid, choice});
    if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(res.balance);
    if (res.gram_balance !== undefined && state?.me) { state.me.balance = res.gram_balance; if (typeof updateBalance === 'function') updateBalance(); }
    if (res.chest_opens && res.chest_opens.length) {                  // several chests: they open one after another, then the rest of the purchase is shown
        const ids = res.pack_id ? (res.pack_ids || [res.pack_id]) : null;
        const rest = ids ? {packIds: ids, count: ids.length} : (res.gram || res.balls_gain) ? {title: res.gram ? 'Зачислено: ' + num(res.gram) + ' GRAM' : 'Зачислено шаров: ' + num(res.balls_gain), text: 'Баланс уже обновлён.'} : null;
        return {chests: res.chest_opens, rest};
    }
    if (res.pack_id) { const ids = res.pack_ids || [res.pack_id]; return {packIds: ids, count: ids.length, picked: res.picked}; }
    if (res.chest_open) return {chest: res.chest_open};
    if (res.gift_ids) return {title: 'Подарок получен', text: 'Он уже в разделе «Мои подарки».'};
    if (res.code) { const cc = window.crafterCommunity; return {title: 'Ваш промокод', text: 'Он привязан к вашему аккаунту и работает один раз.', html: cc.codeBlock(res.code), bind: root => cc.bindCode(root, res.code)}; }
    return {title: res.gram ? 'Зачислено: ' + num(res.gram) + ' GRAM' : 'Зачислено шаров: ' + num(res.balls_gain), text: 'Баланс уже обновлён.'};
}

/* ---------- the market ---------- */
function render(main, ctx) {
    if (ctx.shopState?.now) offset = ctx.shopState.now - Math.floor(Date.now() / 1000);
    const usable = it => !(it.left !== null && it.left !== undefined && it.left <= 0) && !(it.per_user && it.mine >= it.per_user) && !(it.ends_at && it.ends_at <= nowSec());
    const items = (ctx.shopState?.items || []).filter(usable).map(it => ({key: it.id, it, src: 'shop'}));
    const packs = (ctx.packState?.shop || []).map(p => ({key: 'pk:' + p.id, src: 'pack', p, it: {id: 'pk:' + p.id, kind: 'PACK', amount: p.id, title: 'Pack ' + p.title, image_url: p.image, pack: {image: p.image, title: p.title, accent: p.accent, id: p.id}, price_balls: p.price_balls, size: 'small', bundle: 1, left: null, mine: 0, rarity: 'auto', badge: '', description: ''}}));
    const rewards = (ctx.shared?.milestones || []).filter(m => m.reached && !m.redeemed && !(m.reward_kind === 'PACK' && m.code)).map(m => ({key: 'cm:' + m.id, src: 'cm', m, it: {
        id: 'cm:' + m.id, kind: 'REWARD', title: m.title, image_url: (m.image_url && /^(https:\/\/|\/static\/)/.test(m.image_url)) ? m.image_url : (m.pack?.image || m.star?.image || '/static/assets/community-reward.svg'),
        price_balls: m.price_balls, size: 'small', bundle: 1, left: m.left, rarity: 'special', badge: 'Награда', description: 'Награда за общую цель сообщества. Тираж ограничен.', contents: null}}));
    const all = items.concat(packs);
    const fbs = (ctx.freebies || []).map(ev => ({key: 'fb:' + ev.id, src: 'fb', ev, it: {id: 'fb:' + ev.id, kind: 'FREEBIE', title: ev.title, size: 'wide', rarity: 'special', price_balls: 0}}));
    const chs = (ctx.chains || []).map(ch => ({key: 'ch:' + ch.id, src: 'ch', ch, it: {id: 'ch:' + ch.id, kind: 'CHAIN', title: ch.title, size: 'wide', rarity: 'special', price_balls: 0, section_id: ch.section_id || ''}}));
    const sections = (ctx.shopState?.sections && ctx.shopState.sections.length ? ctx.shopState.sections : DEFAULT_SECTIONS).filter(s => ctx.showEmpty || s.enabled !== false);
    const customIds = new Set(sections.filter(s => s.kind !== 'exchange' && s.id !== 'gifts').map(s => s.id));
    const mine = o => o.it.section_id && customIds.has(o.it.section_id);
    const COLLAB = ['gifton', 'goshan', 'nikolay'];                    // packs of collaborations stand in their own section
    const isCollab = o => o.it.kind === 'PACK' && !o.it.mode && COLLAB.includes(String(o.it.amount));
    const isBundle = o => !o.it.mode && (o.it.kind === 'BUNDLE' || (o.it.kind === 'PACK' && ((o.it.bundle > 1) || (o.it.contents && o.it.contents.length > 1))));
    const lots = ctx.data?.lots || [];
    const rule = {
        featured: () => fbs.concat(chs.filter(o => !mine(o))).concat(all.filter(o => !mine(o) && (o.it.mode || o.it.old_price_balls > o.it.price_balls || ['banner', 'large'].includes(sizeOf(o.it)) || o.it.badge))).concat(rewards),
        packs: () => all.filter(o => !mine(o) && !o.it.mode && o.it.kind === 'PACK' && !isBundle(o) && !isCollab(o)),
        collab: () => all.filter(o => !mine(o) && isCollab(o)),
        bundles: () => all.filter(o => !mine(o) && isBundle(o)),
        res: () => all.filter(o => !mine(o) && ['GRAM', 'BALL', 'PROMO', 'STAR'].includes(o.it.kind)),
        rewards: () => rewards,
        gifts: () => lots,
    };
    const exAll = ctx.shopState?.exchanges || [];
    const SEC = sections.map(s => ({s, list: s.kind === 'exchange' ? exAll.filter(x => x.section_id === s.id).map(x => ({key: 'ex:' + x.id, src: 'ex', ex: x})) : s.kind === 'custom' ? all.concat(chs).filter(o => o.it.section_id === s.id) : (rule[s.rule] ? rule[s.rule]() : []).concat(s.rule !== 'gifts' ? all.filter(o => o.it.section_id === s.id) : [])})).filter(x => x.list.length || ctx.showEmpty);
    const railW = 224;
    let active = ctx.section && SEC.some(x => x.s.id === ctx.section) ? ctx.section : (SEC[0] ? SEC[0].s.id : '');
    const root = document.createElement('div');
    root.className = 'fm-root';
    root.innerHTML = '<div class="fm-bg"></div><div class="fm-rail-col">' + (ctx.back ? '<div class="fm-head"><button type="button" class="fm-backbtn" data-fm-back aria-label="К событиям" title="К событиям"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg><span>События</span></button><span class="fm-balpill" title="Баланс шаров">' + ORN + '<b data-fm-bal>' + num(ctx.balance ? ctx.balance() : 0) + '</b></span></div>' : '') + '<div class="fm-rail" role="navigation" aria-label="Разделы маркета"><i class="fm-ind"></i>' +
        SEC.map(x => '<div class="fm-sec-wrap" data-wrap="' + e(x.s.id) + '">' + railButton(x.s) + (x.s.rule !== 'featured' && x.list.length ? '<em>' + x.list.length + '</em>' : '') + '</div>').join('') + '</div>' +
        '</div>' +
        '<div class="fm-main"></div>';
    const rail = root.querySelector('.fm-rail'), ind = root.querySelector('.fm-ind'), host = root.querySelector('.fm-main');
    const phone = () => (ctx.force ? ctx.force === 'phone' : innerWidth < 760);
    const apply = () => {
        root.classList.toggle('fm-phone', phone());
        root.style.setProperty('--rail', railW + 'px');
        place();
    };
    const place = () => {
        const w = rail.querySelector('.fm-sec-wrap.is-on');
        if (!w) { ind.style.opacity = 0; return; }
        ind.style.opacity = 1;
        ind.style.width = w.offsetWidth + 'px'; ind.style.height = w.offsetHeight + 'px';
        ind.style.transform = 'translate(' + w.offsetLeft + 'px,' + w.offsetTop + 'px)';
    };
    const setBg = key => {
        const bg = root.querySelector('.fm-bg');
        if (bg.dataset.key === key) return;
        bg.dataset.key = key;
        const layer = document.createElement('div');
        layer.className = 'fm-bg-layer';
        layer.innerHTML = bgHTML(key);
        bg.appendChild(layer);
        requestAnimationFrame(() => layer.classList.add('is-in'));
        [...bg.children].filter(c => c !== layer).forEach(old => { old.classList.remove('is-in'); setTimeout(() => old.remove(), 700); });
    };
    const SEEN = 'crafter:fm-seen';
    let seen = null, freshKeys = new Set();
    try { const raw = localStorage.getItem(SEEN); seen = raw ? new Set(JSON.parse(raw)) : null; } catch (_) {}
    const markSeen = list => {                                        // an offer that the player has never seen comes with an entrance of its own
        if (ctx.preview) return;
        freshKeys = new Set(seen ? list.filter(x => !seen.has(x.key)).map(x => x.key) : []);
        const all = new Set(seen || []); list.forEach(x => all.add(x.key)); seen = all;
        try { localStorage.setItem(SEEN, JSON.stringify([...all].slice(-400))); } catch (_) {}
    };
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(list => list.forEach(en => en.target.classList.toggle('is-vis', en.isIntersecting)), {threshold: .05}) : null;
    const show = (id, first) => {
        active = id;
        const entry = SEC.find(x => x.s.id === id);
        rail.querySelectorAll('.fm-sec-wrap').forEach(w => w.classList.toggle('is-on', w.dataset.wrap === id));
        place();
        if (!entry) { host.innerHTML = '<p class="ny-quiet">Совсем скоро здесь появятся новогодние предложения.</p>'; return; }
        const gifts = entry.s.rule === 'gifts' && entry.s.kind !== 'custom' && entry.s.kind !== 'exchange';
        const exch = entry.s.kind === 'exchange' && window.crafterFestiveExchange;
        host.innerHTML = '<div class="fm-view' + (first ? '' : ' fm-enter') + '">' + (exch ? window.crafterFestiveExchange.html(entry.list.map(o => o.ex), ctx) : gifts
            ? '<div class="ny-grid fm-gifts">' + entry.list.map(l => ctx.lotTile(l)).join('') + '</div>'
            : entry.list.length ? (markSeen(entry.list), '') + '<div class="fm-wrap"><button type="button" class="fm-arrow l" data-fm-go="-1" aria-label="Назад">‹</button><div class="fm-row">' + entry.list.map(x => card(x, {fresh: freshKeys.has(x.key)})).join('') + '</div><button type="button" class="fm-arrow r" data-fm-go="1" aria-label="Вперёд">›</button></div>'
            : '<p class="ny-quiet">В этом разделе пока ничего нет.</p>') + '</div>';
        setBg(entry.s.bg || 'night');
        if (exch) window.crafterFestiveExchange.bind(host, ctx, entry.list.map(o => o.ex), () => show(id, true));
        const row = host.querySelector('.fm-row');
        if (row) {
            const find = key => entry.list.find(x => x.key === key);
            row.addEventListener('click', ev => {
                if (row.dataset.dragged === '1') { row.dataset.dragged = '0'; return; }
                const c = ev.target.closest('.fm-card'); if (c) stage(find(c.dataset.fm), ctx);
            });
            row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { const c = ev.target.closest('.fm-card'); if (c) { ev.preventDefault(); stage(find(c.dataset.fm), ctx); } } });
            host.querySelectorAll('[data-fm-go]').forEach(b => b.addEventListener('click', () => row.scrollBy({left: Number(b.dataset.fmGo) * row.clientWidth * .8, behavior: 'smooth'})));
            const arrows = () => host.querySelectorAll('.fm-arrow').forEach(b => { b.hidden = row.scrollWidth <= row.clientWidth + 4; });
            arrows(); setTimeout(arrows, 400); window.addEventListener('resize', arrows);
            let sx = 0, sl = 0, down = false, moved = 0;                  // a mouse can drag the row, a finger scrolls it itself
            row.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'mouse') return; down = true; moved = 0; sx = ev.clientX; sl = row.scrollLeft; });
            const move = ev => { if (!down) return; const dx = ev.clientX - sx; moved = Math.max(moved, Math.abs(dx)); row.scrollLeft = sl - dx; };
            const up = () => { if (down && moved > 6) row.dataset.dragged = '1'; down = false; if (!row.isConnected) { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); } };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
            row.addEventListener('wheel', ev => { if (!root.classList.contains('fm-phone') && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { row.scrollLeft += ev.deltaY; ev.preventDefault(); } }, {passive: false});
            if (io) row.querySelectorAll('.fm-card').forEach(c => io.observe(c)); else row.querySelectorAll('.fm-card').forEach(c => c.classList.add('is-vis'));
        }
        ctx.bindLots?.(host);
    };
    rail.addEventListener('click', ev => { const b = ev.target.closest('[data-fm-sec],.fm-pic'); const w = ev.target.closest('.fm-sec-wrap'); if (w && w.dataset.wrap !== active) { ripple(w, ev); show(w.dataset.wrap); } });
    const ripple = (w, ev) => {
        if (reduced()) return;
        const r = document.createElement('i'), box = w.getBoundingClientRect();
        r.className = 'fm-rip'; r.style.left = (ev.clientX - box.left) + 'px'; r.style.top = (ev.clientY - box.top) + 'px';
        w.appendChild(r); setTimeout(() => r.remove(), 600);
    };
    main.innerHTML = '<div class="new-year-page fm-page"></div>';
    main.querySelector('.fm-page').appendChild(root);
    root.querySelector('[data-fm-back]')?.addEventListener('click', ctx.back);
    apply();
    show(active, true);
    requestAnimationFrame(place);
    const resize = () => { if (!root.isConnected) { window.removeEventListener('resize', resize); return; } apply(); };
    window.addEventListener('resize', resize);
    const tick = () => {
        if (!root.isConnected) return;
        root.querySelectorAll('[data-fm-bal]').forEach(b => { if (ctx.balance) b.textContent = num(ctx.balance()); });
        root.querySelectorAll('[data-fm-end]').forEach(t => { const s = Number(t.dataset.fmEnd) - nowSec(); t.textContent = leftText(s); if (s <= 0 && !t.dataset.over) { t.dataset.over = '1'; t.closest('.fm-card')?.classList.add('is-over'); } });
        setTimeout(tick, 1000);
    };
    tick();
    const openKey = (key, fromUrl) => {
        const sec = SEC.find(x => x.list.some(o => o.key === key)); if (!sec) return false;
        if (sec.s.id !== active) show(sec.s.id);
        stage(sec.list.find(o => o.key === key), ctx, {fromUrl}); return true;
    };
    if (!ctx.preview && window.__fmLot) { const k = window.__fmLot; window.__fmLot = ''; if (!openKey(k, true)) { try { history.replaceState({crafterPage: 'new-year'}, '', BASE); } catch (_) {} } }
    // an offer with a start time appears by itself: the list is checked every half a minute
    if (!ctx.preview) {
        const known = new Set(items.map(x => x.key));
        const poll = async () => {
            if (!root.isConnected) return;
            if (!document.querySelector('.fm-stage,.fm-reveal,.fm-chances') && document.visibilityState === 'visible') {
                try { const r = await api('shop-items'); if (root.isConnected && (r.items || []).some(i => !known.has(i.id))) { ctx.refresh?.(); return; } } catch (_) {}
            }
            setTimeout(poll, 30000);
        };
        setTimeout(poll, 30000);
    }
    return {root, show, open: key => { const o = SEC.flatMap(x => x.list).find(x => x.key === key); if (o && o.it) stage(o, ctx); }};
}

window.crafterFestive = {render, card, stage, reveal, rarityOf, includes, railButton, bgHTML, iconHTML, icons: ICONS, bgKeys: BG_KEYS, cardBgKeys: CARD_BG_KEYS, names: NAMES, setNow: s => { offset = s - Math.floor(Date.now() / 1000); }};
})();
