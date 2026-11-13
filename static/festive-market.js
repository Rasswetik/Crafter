/* The New Year market in the style of a game shop: sections on the left, offers with juicy titles whose colour follows the rarity,
   a window of the lot with what it includes and a big buy button. Horizontal on computers, vertical on phones.
   The same file renders the standalone preview page (/shop/preview) that the administrator sees for the phone and the computer. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img class="fm-ball" src="/static/assets/new-year-ornament.svg" alt="">';
const SI = () => window.crafterShopItems || {};
const NAMES = {common: 'Акция', rare: 'Особая акция', epic: 'Эпическая акция', mythic: 'Мифическая акция', legend: 'Легендарная акция', res: 'Ресурсы'};
const TYPES = {GRAM: 'Баланс GRAM', BALL: 'Шары', PACK: 'Пак', BUNDLE: 'Набор', STAR: 'Подарок Telegram', PROMO: 'Промокод', REWARD: 'Награда сообщества'};
const WIDTH = {small: 1, tall: 1, wide: 1.6, large: 2, banner: 2.6};
let offset = 0;                                                    // server time minus the time of this device
const nowSec = () => Math.floor(Date.now() / 1000) + offset;

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
    const f = SI().artHTML;
    return f ? f(it) : '<img class="si-solo" src="' + e(it.image_url || '/static/assets/community-reward.svg') + '" alt="">';
}
function descOf(it) {
    const d = SI().describe;
    return it.description || (d ? d(it) : '');
}
const priceOf = it => it.price_balls ? ORN + '<b>' + num(it.price_balls) + '</b>' : '<b>Бесплатно</b>';

/* ---------- one offer card ---------- */
function card(o, opts = {}) {
    const it = o.it, r = rarityOf(it), size = sizeOf(it), left = it.ends_at ? it.ends_at - nowSec() : null;
    const tab = left !== null ? '<span class="fm-tab" data-fm-end="' + it.ends_at + '">' + leftText(left) + '</span>'
        : it.left !== null && it.left !== undefined ? '<span class="fm-tab">Осталось ' + num(it.left) + '</span>' : '';
    const off = it.discount_percent > 0 ? '<span class="fm-off"><small>Скидка</small><b>' + it.discount_percent + '%</b></span>' : '';
    const showDesc = ['wide', 'large', 'banner'].includes(size) && descOf(it);
    return '<div class="fm-card r-' + r + ' fm-s-' + size + (opts.board ? ' is-board' : '') + '" data-fm="' + e(o.key) + '" style="--u:' + WIDTH[size] + '" tabindex="0" role="button" aria-label="' + e(it.title) + '">' +
        tab + (it.badge ? '<span class="fm-new">' + e(it.badge) + '</span>' : '') +
        '<div class="fm-body"><i class="fm-rays"></i><i class="fm-dots"></i><i class="fm-glint"></i>' +
        '<h3 class="fm-title">' + e(NAMES[r]) + '</h3>' +
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
    if (it.gram) out.push({img: '/static/assets/gram.svg', label: 'Баланс', count: num(it.gram) + ' GRAM'});
    if (it.balls) out.push({img: '/static/assets/new-year-ornament.svg', label: 'Новогодние шары', count: num(it.balls)});
    if (!out.length) {
        const pic = it.pack?.image || it.star?.image || it.image_url || (it.kind === 'GRAM' ? '/static/assets/gram.svg' : '/static/assets/new-year-ornament.svg');
        const count = it.kind === 'GRAM' ? num(it.amount) + ' GRAM' : it.kind === 'BALL' ? num(it.amount) : it.bundle > 1 ? '×' + it.bundle : '1';
        out.push({img: pic, label: it.title, count, pack: (it.kind === 'PACK' && it.amount) || ''});
    }
    return out;
}

/* ---------- the window of a lot ---------- */
function stage(o, ctx) {
    const it = o.it, r = rarityOf(it), phone = innerWidth < 760;
    document.querySelector('.fm-stage')?.remove();
    const el = document.createElement('div');
    el.className = 'fm-stage r-' + r;
    const inc = includes(o);
    const lines = descOf(it).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 5);
    const canBuy = !(ctx.preview);
    el.innerHTML = '<i class="fm-rays big"></i><i class="fm-dots"></i><div class="fm-top"><button type="button" class="fm-back" data-fm-close aria-label="Назад"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></button>' +
        '<span class="fm-bal">' + ORN + '<b data-fm-bal>' + num(ctx.balance ? ctx.balance() : 0) + '</b></span></div>' +
        '<div class="fm-info"><div class="fm-plate"><small>' + e(NAMES[r]) + '</small><h2>' + e(it.title) + '</h2></div>' +
        (lines.length ? '<ul class="fm-lines">' + lines.map(l => '<li>' + e(l) + '</li>').join('') + '</ul>' : '') + '</div>' +
        '<div class="fm-hero"><div class="fm-floor"></div><div class="fm-heroart">' + artOf(it) + '</div>' + (it.discount_percent > 0 ? '<span class="fm-off big"><small>Скидка</small><b>' + it.discount_percent + '%</b></span>' : '') + '</div>' +
        '<div class="fm-inc"><div class="fm-inc-head"><b>Включает</b>' + (inc.some(x => x.pack) ? '<button type="button" class="fm-q" data-fm-chances aria-label="Что внутри">?</button>' : '') + '</div>' +
        '<div class="fm-inc-grid">' + inc.map(x => '<button type="button" class="fm-ic"' + (x.pack ? ' data-pk-inside="' + e(x.pack) + '"' : '') + '><img src="' + e(x.img) + '" alt=""><b>' + e(x.count) + '</b><span>' + e(x.label) + '</span></button>').join('') + '</div></div>' +
        '<div class="fm-buy"><button type="button" class="fm-buybtn" data-fm-buy>' + (it.old_price_balls > it.price_balls ? '<s>' + num(it.old_price_balls) + '</s>' : '') + '<span>' + (it.price_balls ? ORN + '<b>' + num(it.price_balls) + '</b>' : '<b>Получить</b>') + '</span></button>' +
        '<p class="fm-err" role="alert"></p></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 260); document.removeEventListener('keydown', onKey); };
    const onKey = ev => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    el.querySelector('[data-fm-close]').addEventListener('click', close);
    window.crafterPacks?.bindContents?.(el);
    el.querySelector('[data-fm-chances]')?.addEventListener('click', () => el.querySelector('[data-pk-inside]')?.click());
    const btn = el.querySelector('[data-fm-buy]'), err = el.querySelector('.fm-err');
    btn.addEventListener('click', async () => {
        if (!canBuy) { err.textContent = 'Это предпросмотр: покупка отключена'; return; }
        if (o.src === 'pack') { close(); window.crafterPacks.buy(o.p, ctx.refresh); return; }
        if (o.src === 'cm') { close(); window.crafterCommunity.claim(o.m, ctx.refresh); return; }
        btn.disabled = true; err.textContent = '';
        try {
            const rid = 'si-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2));
            const res = await api('shop-items/buy', {item_id: it.id, request_id: rid});
            if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(res.balance);
            if (res.gram_balance !== undefined && state?.me) { state.me.balance = res.gram_balance; if (typeof updateBalance === 'function') updateBalance(); }
            if (res.pack_id) { close(); await window.crafterPacks?.granted(res.pack_ids || [res.pack_id], ctx.refresh); return; }
            if (res.gift_ids) { close(); toast('Подарок получен: он в «Мои подарки»'); ctx.refresh?.(); return; }
            if (res.code) {
                const cc = window.crafterCommunity;
                el.querySelector('.fm-buy').innerHTML = cc.codeBlock(res.code);
                cc.bindCode(el.querySelector('.fm-buy'), res.code); ctx.refresh?.(); return;
            }
            close(); toast(res.gram ? 'Зачислено: ' + num(res.gram) + ' GRAM' : 'Зачислено шаров: ' + num(res.balls_gain)); ctx.refresh?.();
        } catch (error) { err.textContent = error.message; btn.disabled = false; }
    });
    return el;
}

/* ---------- the market ---------- */
const ICONS = {
    featured: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="m12 2 2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z"/></svg>',
    packs: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 2h10l2 3v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5zm1.5 3L8 6h8l-.5-1zM9 10v2h6v-2zm0 4v2h4v-2z"/></svg>',
    bundles: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 8h18v4H3zm1 5h16v8H4zm7-5h2v13h-2zM12 8C10 3 6 4.5 8 7zm0 0c2-5 6-3.500 4-1z"/></svg>',
    res: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2 4 8l8 14 8-14zm0 4.200L15.500 9 12 15 8.500 9z"/></svg>',
    rewards: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 3h12v3a6 6 0 0 1-5 5.900V15h3v2H8v-2h3v-3.100A6 6 0 0 1 6 6zM4 5h2v3a3 3 0 0 1-2-2zm16 0v1a3 3 0 0 1-2 2.800V5zM7 19h10v2H7z"/></svg>',
    gifts: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 9h18v4H3zm1 5h7v7H4zm9 0h7v7h-7zM11 9h2v12h-2zM12 9C10 3 6 5 8 8zm0 0c2-6 6-4 4-1z"/></svg>',
};
function render(main, ctx) {
    if (ctx.shopState?.now) offset = ctx.shopState.now - Math.floor(Date.now() / 1000);
    const usable = it => !(it.left !== null && it.left !== undefined && it.left <= 0) && !(it.per_user && it.mine >= it.per_user) && !(it.ends_at && it.ends_at <= nowSec());
    const items = (ctx.shopState?.items || []).filter(usable).map(it => ({key: it.id, it, src: 'shop'}));
    const packs = (ctx.packState?.shop || []).map(p => ({key: 'pk:' + p.id, src: 'pack', p, it: {id: 'pk:' + p.id, kind: 'PACK', amount: p.id, title: 'Pack ' + p.title, image_url: p.image, pack: {image: p.image, title: p.title, accent: p.accent, id: p.id}, price_balls: p.price_balls, size: 'small', bundle: 1, left: null, mine: 0, rarity: 'auto', badge: '', description: ''}}));
    const rewards = (ctx.shared?.milestones || []).filter(m => m.reached && !m.redeemed && !(m.reward_kind === 'PACK' && m.code)).map(m => ({key: 'cm:' + m.id, src: 'cm', m, it: {
        id: 'cm:' + m.id, kind: 'REWARD', title: m.title, image_url: (m.image_url && /^(https:\/\/|\/static\/)/.test(m.image_url)) ? m.image_url : (m.pack?.image || m.star?.image || '/static/assets/community-reward.svg'),
        price_balls: m.price_balls, size: 'small', bundle: 1, left: m.left, rarity: 'rare', badge: 'Награда', description: 'Награда за общую цель сообщества. Тираж ограничен.', contents: null}}));
    const all = items.concat(packs);
    const isBundle = o => o.it.kind === 'BUNDLE' || (o.it.kind === 'PACK' && ((o.it.bundle > 1) || (o.it.contents && o.it.contents.length > 1)));
    const lots = ctx.data?.lots || [];
    const SEC = [
        ['featured', 'Акции', all.filter(o => o.it.old_price_balls > o.it.price_balls || ['banner', 'large'].includes(sizeOf(o.it)) || o.it.badge).concat(rewards)],
        ['packs', 'Паки', all.filter(o => o.it.kind === 'PACK' && !isBundle(o))],
        ['bundles', 'Наборы', all.filter(isBundle)],
        ['res', 'Ресурсы', all.filter(o => ['GRAM', 'BALL', 'PROMO', 'STAR'].includes(o.it.kind))],
        ['rewards', 'Награды', rewards],
        ['gifts', 'Подарки', lots],
    ].filter(s => s[2].length);
    let active = ctx.section && SEC.some(s => s[0] === ctx.section) ? ctx.section : (SEC[0] ? SEC[0][0] : '');
    const root = document.createElement('div');
    root.className = 'fm-root';
    const apply = () => root.classList.toggle('fm-phone', ctx.force ? ctx.force === 'phone' : innerWidth < 760);
    const draw = () => {
        const sec = SEC.find(s => s[0] === active);
        root.innerHTML = '<div class="fm-rail" role="navigation" aria-label="Разделы маркета">' + SEC.map(s => '<button type="button" class="fm-sec' + (s[0] === active ? ' is-on' : '') + '" data-fm-sec="' + s[0] + '"><span>' + s[1] + '</span>' + ICONS[s[0]] + (s[0] !== 'featured' ? '<em>' + s[2].length + '</em>' : '') + '</button>').join('') + '</div>' +
            '<div class="fm-main">' + (sec ? (sec[0] === 'gifts'
                ? '<div class="ny-grid fm-gifts">' + sec[2].map(l => ctx.lotTile(l)).join('') + '</div>'
                : '<div class="fm-wrap"><button type="button" class="fm-arrow l" data-fm-go="-1" aria-label="Назад">‹</button><div class="fm-row">' + sec[2].map(o => card(o)).join('') + '</div><button type="button" class="fm-arrow r" data-fm-go="1" aria-label="Вперёд">›</button></div>')
                : '<p class="ny-quiet">Совсем скоро здесь появятся новогодние предложения.</p>') + '</div>';
        root.querySelectorAll('[data-fm-sec]').forEach(b => b.addEventListener('click', () => { active = b.dataset.fmSec; draw(); }));
        const row = root.querySelector('.fm-row');
        if (row) {
            const find = key => (sec[2].find(o => o.key === key));
            row.addEventListener('click', ev => {
                if (row.dataset.dragged === '1') { row.dataset.dragged = '0'; return; }
                const c = ev.target.closest('.fm-card'); if (c) stage(find(c.dataset.fm), ctx);
            });
            row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { const c = ev.target.closest('.fm-card'); if (c) { ev.preventDefault(); stage(find(c.dataset.fm), ctx); } } });
            root.querySelectorAll('[data-fm-go]').forEach(b => b.addEventListener('click', () => row.scrollBy({left: Number(b.dataset.fmGo) * row.clientWidth * .8, behavior: 'smooth'})));
            let sx = 0, sl = 0, down = false, moved = 0;                  // a mouse can drag the row, a finger scrolls it itself
            row.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'mouse') return; down = true; moved = 0; sx = ev.clientX; sl = row.scrollLeft; });
            window.addEventListener('pointermove', ev => { if (!down) return; const dx = ev.clientX - sx; moved = Math.max(moved, Math.abs(dx)); row.scrollLeft = sl - dx; });
            window.addEventListener('pointerup', () => { if (down && moved > 6) row.dataset.dragged = '1'; down = false; });
            row.addEventListener('wheel', ev => { if (!root.classList.contains('fm-phone') && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { row.scrollLeft += ev.deltaY; ev.preventDefault(); } }, {passive: false});
        }
        ctx.bindLots?.(root);
        apply();
    };
    main.innerHTML = '<div class="new-year-page fm-page">' + (ctx.back ? '<button type="button" class="nyh-back" data-fm-back>‹ События</button>' : '') + (ctx.hero || '') + '</div>';
    main.querySelector('.fm-page').appendChild(root);
    main.querySelector('[data-fm-back]')?.addEventListener('click', ctx.back);
    draw();
    const resize = () => { if (!root.isConnected) { window.removeEventListener('resize', resize); return; } apply(); };
    window.addEventListener('resize', resize);
    const tick = () => {
        if (!root.isConnected) return;
        root.querySelectorAll('[data-fm-end]').forEach(t => { const s = Number(t.dataset.fmEnd) - nowSec(); t.textContent = leftText(s); if (s <= 0 && !t.dataset.over) { t.dataset.over = '1'; t.closest('.fm-card')?.classList.add('is-over'); } });
        setTimeout(tick, 1000);
    };
    tick();
    return {root, open: key => { const o = SEC.flatMap(s => s[2]).find(x => x.key === key); if (o && o.it) stage(o, ctx); }};
}

window.crafterFestive = {render, card, stage, rarityOf, includes, setNow: s => { offset = s - Math.floor(Date.now() / 1000); }};
})();
