/* Community events: hub cards, the goal page with a vertical progress bar, the reward shop block,
   the "goal reached" ceremony and the administrator form. Server state lives in /api/community. */
(function () {
'use strict';
const NOUN = {craft: 'крафтов', upgrade: 'апгрейдов', buy: 'покупок', sale: 'продаж'};
const METRIC_NAME = {craft: 'Крафты', upgrade: 'Апгрейды', buy: 'Покупки', sale: 'Продажи'};
const DEFAULT_IMG = '/static/assets/community-reward.svg';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const img = m => (m.image_url && /^(https:\/\/|\/static\/)/.test(m.image_url)) ? m.image_url : (m.pack?.image || m.star?.image || DEFAULT_IMG);
const rewardText = m => m.reward_kind === 'STAR' ? 'Подарок Telegram «' + (m.star?.title || '') + '» · ' + num(m.star?.price || 0) + ' GRAM' : m.reward_kind === 'PACK' ? 'Пак «' + (m.pack?.title || '') + '»: 1–5 карточек' : m.reward_kind === 'BALL' ? 'Промокод на ' + num(m.reward_amount) + ' шаров' : 'Промокод на ' + num(m.reward_amount) + ' GRAM';
const priceText = m => m.price_balls ? num(m.price_balls) + ' шаров' : 'Бесплатно';
const pct = (a, b) => b > 0 ? Math.max(0, Math.min(100, a / b * 100)) : 0;
const uid = () => state?.me?.id || state?.me?.user_id || 'me';

/* ---------- SVG art ---------- */
function pine(x, y, s, fill) {
    const t = (w, top, bot) => `M${x - w * s} ${y + bot * s}L${x} ${y + top * s}L${x + w * s} ${y + bot * s}Z`;
    return `<path d="${t(15, -44, -18)}${t(21, -30, -2)}${t(27, -14, 14)}" fill="${fill}"/><rect x="${x - 2.5 * s}" y="${y + 13 * s}" width="${5 * s}" height="${8 * s}" fill="#2a1b17"/>`;
}
function marketArt() {
    const bulbs = [];
    const cols = ['#ff5a6a', '#ffd25e', '#5ccfff', '#7be38f', '#ff82d6'];
    for (let i = 0; i < 13; i++) {
        const t = i / 12, x = 188 + t * 176, y = 52 + Math.sin(t * Math.PI) * 15 + (i % 2 ? 1 : 0);
        bulbs.push(`<g class="nyh-bulb" style="--i:${i}"><circle cx="${x.toFixed(1)}" cy="${(y + 5).toFixed(1)}" r="7" fill="${cols[i % 5]}" opacity=".28"/><path d="M${(x - 2.2).toFixed(1)} ${y.toFixed(1)}h4.4l1 6a3.2 3.2 0 0 1-6.4 0Z" fill="${cols[i % 5]}"/><ellipse cx="${(x - .8).toFixed(1)}" cy="${(y + 4).toFixed(1)}" rx=".7" ry="1.5" fill="#fff" opacity=".8"/></g>`);
    }
    const stars = Array.from({length: 26}, (_, i) => `<circle class="nyh-star" style="--i:${i}" cx="${(i * 47 + 13) % 400}" cy="${(i * 29 + 7) % 78}" r="${i % 4 ? .8 : 1.5}" fill="#fff"/>`).join('');
    const stripes = Array.from({length: 10}, (_, i) => `<path d="M${205 + i * 14} 86h14v13a7 7 0 0 1-14 0Z" fill="${i % 2 ? '#fff6ee' : '#e63946'}"/>`).join('');
    const shelf = [[232, '#ff5a6a'], [256, '#5ccfff'], [280, '#ffd25e'], [304, '#a78bfa']].map(([x, c]) =>
        `<rect x="${x}" y="108" width="16" height="16" rx="2" fill="${c}"/><rect x="${x + 6.5}" y="108" width="3" height="16" fill="#fff" opacity=".85"/><rect x="${x}" y="114.5" width="16" height="3" fill="#fff" opacity=".85"/><path d="M${x + 8} 108c-6-7-10 0-2 0M${x + 8} 108c6-7 10 0 2 0" stroke="#fff" fill="none" stroke-width="1.6"/>`).join('');
    return `<svg class="nyh-art" viewBox="0 0 400 170" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
<defs>
<linearGradient id="mk-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070d27"/><stop offset=".55" stop-color="#18286a"/><stop offset="1" stop-color="#4a3f94"/></linearGradient>
<linearGradient id="mk-aur" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3cf0b8" stop-opacity="0"/><stop offset=".4" stop-color="#46c8ff" stop-opacity=".55"/><stop offset=".75" stop-color="#b36bff" stop-opacity=".45"/><stop offset="1" stop-color="#ff7ad9" stop-opacity="0"/></linearGradient>
<radialGradient id="mk-moon"><stop offset="0" stop-color="#fffbe6"/><stop offset=".6" stop-color="#ffe9a8"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>
<radialGradient id="mk-warm" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#fff0b8"/><stop offset=".55" stop-color="#ffb457"/><stop offset="1" stop-color="#d9672a"/></radialGradient>
<radialGradient id="mk-halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffcf70" stop-opacity=".65"/><stop offset="1" stop-color="#ffcf70" stop-opacity="0"/></radialGradient>
<linearGradient id="mk-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b3a26"/><stop offset="1" stop-color="#2f1d14"/></linearGradient>
<linearGradient id="mk-roof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a1283a"/><stop offset="1" stop-color="#5e1625"/></linearGradient>
<linearGradient id="mk-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6fbff"/><stop offset="1" stop-color="#aac8ee"/></linearGradient>
<radialGradient id="mk-ball" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#ff7a86"/><stop offset="1" stop-color="#a0152a"/></radialGradient>
</defs>
<rect width="400" height="170" fill="url(#mk-sky)"/>
<path class="nyh-aurora" d="M0 70C70 20 150 100 230 46S350 22 400 60V0H0Z" fill="url(#mk-aur)"/>
${stars}
<circle cx="338" cy="30" r="26" fill="url(#mk-moon)" opacity=".85"/><circle cx="338" cy="30" r="12" fill="#fff6d2"/><circle cx="342" cy="27" r="11" fill="#ffe9a8" opacity=".55"/>
<path d="M0 118c60-26 110-6 170-20s120-22 230 6V170H0Z" fill="#26356f" opacity=".85"/>
<g opacity=".9">${pine(30, 110, 1.15, '#14335a')}${pine(86, 118, .9, '#17406b')}${pine(150, 114, 1.05, '#12305a')}${pine(384, 112, 1.1, '#14335a')}</g>
<ellipse cx="275" cy="98" rx="120" ry="64" fill="url(#mk-halo)"/>
<rect x="208" y="86" width="6" height="62" fill="url(#mk-wood)"/><rect x="336" y="86" width="6" height="62" fill="url(#mk-wood)"/>
<rect x="214" y="90" width="122" height="46" fill="#2a1912"/>
<rect x="222" y="96" width="106" height="36" rx="3" fill="url(#mk-warm)"/>
<path d="M222 114h106M222 106h106" stroke="#7a4524" stroke-width="2"/>
${shelf}
<path d="M198 88 275 50l77 38Z" fill="url(#mk-roof)"/>
<path d="M194 90 275 46l81 44-5 2-76-39-76 39Z" fill="#fff"/>
<path d="M200 88C226 76 250 62 275 52c25 10 49 24 75 36" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/>
${stripes}
<path d="M205 86h140v3H205Z" fill="#8f1d2c"/>
<rect x="206" y="134" width="138" height="14" rx="2" fill="url(#mk-wood)"/><rect x="206" y="134" width="138" height="3" fill="#fff" opacity=".7"/>
<path d="M188 52C240 76 310 76 364 52" fill="none" stroke="#1e5b3b" stroke-width="2.4" stroke-linecap="round"/>
${bulbs.join('')}
<g class="nyh-ball"><line x1="275" y1="99" x2="275" y2="108" stroke="#e9c75e" stroke-width="1.4"/><circle cx="275" cy="115" r="7" fill="url(#mk-ball)"/><rect x="272.5" y="106" width="5" height="3.5" rx="1" fill="#e9c75e"/></g>
<path d="M0 150c60-8 120-4 190-2s150 5 210-4v26H0Z" fill="url(#mk-snow)"/>
<path d="M0 158c70-5 130-2 200 0s130 2 200-3" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/>
<g transform="translate(150 150)"><rect x="0" y="-18" width="30" height="22" rx="3" fill="#2f7be0"/><rect x="12.5" y="-18" width="5" height="22" fill="#fff"/><rect x="0" y="-9" width="30" height="4.5" fill="#fff"/><path d="M15-18c-9-12-16 0-3 0M15-18c9-12 16 0 3 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="0" y="-18" width="30" height="4" fill="#fff" opacity=".18"/></g>
<g transform="translate(120 156)"><rect x="0" y="-14" width="22" height="16" rx="3" fill="#e63946"/><rect x="9" y="-14" width="4" height="16" fill="#ffd25e"/><rect x="0" y="-7" width="22" height="3.5" fill="#ffd25e"/><path d="M11-14c-7-9-12 0-2 0M11-14c7-9 12 0 2 0" stroke="#ffd25e" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>
<g transform="translate(360 156)"><rect x="0" y="-20" width="26" height="22" rx="3" fill="#9b5cf6"/><rect x="10.5" y="-20" width="5" height="22" fill="#ffe9a8"/><rect x="0" y="-11" width="26" height="4.5" fill="#ffe9a8"/><path d="M13-20c-8-11-14 0-3 0M13-20c8-11 14 0 3 0" stroke="#ffe9a8" stroke-width="2.6" fill="none" stroke-linecap="round"/></g>
</svg>`;
}
const LOCK = '<svg class="cm-lock" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.6" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
/* The hub card shows the real bar in miniature: same tube, ticks and prize icons, with the real progress. */
function cardArt(data) {
    const ev = data.event, ms = data.milestones, X = 262, W = 66, Y = 26, H = 118;
    const frac = Math.min(1, data.progress / ev.target);
    const pos = ms.map(m => ({m, ty: Y + H * (1 - Math.min(1, m.threshold / ev.target))})).sort((a, b) => a.ty - b.ty);
    let last = -99;
    pos.forEach(p => { p.cy = Math.max(p.ty, last + 36, Y + 15); last = p.cy; });
    for (let i = pos.length - 1, lim = Y + H - 15; i >= 0; i--) { pos[i].cy = Math.min(pos[i].cy, lim); lim = pos[i].cy - 36; }
    const fillH = Math.max(4, (H - 8) * frac);
    const stars = Array.from({length: 22}, (_, i) => '<circle class="nyh-star" style="--i:' + i + '" cx="' + ((i * 61 + 11) % 400) + '" cy="' + ((i * 37 + 9) % 160) + '" r="' + (i % 3 ? .9 : 1.6) + '" fill="#fff"/>').join('');
    const prizes = pos.map(p => {
        const on = p.m.reached;
        return '<circle cx="' + (X + W) + '" cy="' + p.ty.toFixed(1) + '" r="3.2" fill="' + (on ? '#ffe9a8' : '#c8d9f2') + '" opacity=".9"/>' +
            '<path d="M' + (X + W + 3) + ' ' + p.ty.toFixed(1) + 'L' + (X + W + 11) + ' ' + p.cy.toFixed(1) + '" stroke="' + (on ? '#ffd36b' : 'rgba(200,220,255,.35)') + '" stroke-width="1.2" fill="none"/>' +
            '<image href="' + e(img(p.m)) + '" x="' + (X + W + 12) + '" y="' + (p.cy - 15).toFixed(1) + '" width="30" height="30" opacity="' + (on ? 1 : .5) + '" preserveAspectRatio="xMidYMid meet"/>';
    }).join('');
    return '<svg class="nyh-art nyh-art-cm" viewBox="0 0 400 170" preserveAspectRatio="xMaxYMid meet" aria-hidden="true">' +
        '<defs><linearGradient id="cc-sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1a3e"/><stop offset="1" stop-color="#25266b"/></linearGradient>' +
        '<linearGradient id="cc-fill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1366d6"/><stop offset=".6" stop-color="#3ea8ff"/><stop offset="1" stop-color="#bfe8ff"/></linearGradient>' +
        '<pattern id="cc-str" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="12" fill="#fff" opacity=".18"/></pattern>' +
        '<linearGradient id="cc-glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".35" stop-color="#fff" stop-opacity=".04"/><stop offset=".85" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#fff" stop-opacity=".16"/></linearGradient></defs>' +
        stars +
        '<rect x="' + X + '" y="' + Y + '" width="' + W + '" height="' + H + '" rx="20" fill="#0f1830" stroke="rgba(190,225,255,.6)" stroke-width="1.6"/>' +
        '<rect x="' + (X + 4) + '" y="' + (Y + H - 4 - fillH).toFixed(1) + '" width="' + (W - 8) + '" height="' + fillH.toFixed(1) + '" rx="16" fill="url(#cc-fill)"/>' +
        '<rect x="' + (X + 4) + '" y="' + (Y + H - 4 - fillH).toFixed(1) + '" width="' + (W - 8) + '" height="' + fillH.toFixed(1) + '" rx="16" fill="url(#cc-str)"/>' +
        '<rect x="' + X + '" y="' + Y + '" width="' + W + '" height="' + H + '" rx="20" fill="url(#cc-glass)"/>' + prizes + '</svg>';
}

/* ---------- hub card ---------- */
function card(data) {
    return '<button type="button" class="nyh-card nyh-community" data-nyh="community" aria-label="События сообщества">' + cardArt(data) +
        '<span class="nyh-copy"><strong>События сообщества</strong>' +
        '<span class="nyh-mini"><span class="nyh-mini-bar"><i style="width:' + pct(data.progress, data.event.target).toFixed(1) + '%"></i></span><em>' + num(data.progress) + ' / ' + num(data.event.target) + '</em></span></span></button>';
}

/* ---------- goal page ---------- */
const seenKey = () => 'crafter-cm-seen-' + uid();
function seen() { try { return JSON.parse(localStorage.getItem(seenKey()) || '[]'); } catch (_) { return []; } }
function remember(id) { try { const s = seen(); if (!s.includes(id)) { s.push(id); localStorage.setItem(seenKey(), JSON.stringify(s)); } } catch (_) {} }
const unseen = data => data?.event?.enabled ? data.milestones.find(m => m.reached && !seen().includes(m.id)) : null;
const CG_COLORS = ['#ffd36b', '#7cc8ff', '#ff7a9a', '#9be37f', '#c39bff', '#ffffff'];
const CG_REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.crafterAnimations === 'off';
function burst(host, strong) {
    const n = strong ? 24 : 10;
    for (let i = 0; i < n; i++) {
        const s = document.createElement('i');
        s.className = 'cg-spark';
        const a = (i / n) * 360 + Math.random() * 14, d = (strong ? 58 : 34) + Math.random() * (strong ? 52 : 22);
        s.style.cssText = '--a:' + a.toFixed(0) + 'deg;--d:' + d.toFixed(0) + 'px;--c:' + CG_COLORS[i % CG_COLORS.length] + ';--s:' + (3 + Math.random() * 4).toFixed(1) + 'px;--t:' + (0.75 + Math.random() * 0.55).toFixed(2) + 's';
        host.appendChild(s);
        setTimeout(() => s.remove(), 1700);
    }
    const ring = document.createElement('i');
    ring.className = 'cg-ring';
    host.appendChild(ring);
    setTimeout(() => ring.remove(), 1200);
}
function page(main, data, nav, opts = {}) {
    const ev = data.event, ms = data.milestones.slice().sort((a, b) => a.threshold - b.threshold);
    const total = Math.max(1, ev.target), frac = Math.min(1, Math.max(0, data.progress / total)), p = pct(data.progress, ev.target);
    const seenIds = seen(), still = opts.plain || CG_REDUCED();
    const fresh = opts.plain ? [] : ms.filter(m => m.reached && !m.code && !seenIds.includes(m.id));
    const stateOf = m => m.code ? 'claimed' : m.reached ? (m.left ? 'ready' : 'gone') : 'locked';
    const next = ms.find(m => !m.reached);
    const noun = NOUN[ev.metric] || '';
    const status = m => ({claimed: 'Получено', ready: 'Забрать', gone: 'Разобрано', locked: 'ещё ' + num(Math.max(0, m.threshold - data.progress))})[stateOf(m)];
    const readyCount = ms.filter(m => stateOf(m) === 'ready').length;
    main.innerHTML = '<div class="new-year-page cg-page"><button type="button" class="nyh-back" data-cm-back>‹ События</button>' +
        '<section class="cg-panel"><div class="cg-snow" aria-hidden="true">' + Array.from({length: 18}, (_, i) =>
            '<i style="--x:' + ((i * 53 + 9) % 100) + '%;--s:' + (2 + i % 3) + 'px;--t:' + (7 + i % 6) + 's;--d:' + (-(i * 2) % 9) + 's"></i>').join('') + '</div>' +
        '<div class="cg-head"><small>События сообщества</small><h1>Набираем <b>' + num(ev.target) + '</b> ' + noun + '</h1>' +
        (ev.description ? '<p>' + e(ev.description) + '</p>' : '') +
        '<div class="cg-stats"><div class="cg-now"><b data-cg-count>' + (still ? num(data.progress) : '0') + '</b><span>из ' + num(ev.target) + ' · ' + p.toFixed(p < 10 ? 1 : 0) + '%</span></div>' +
        (next ? '<div class="cg-next">До следующей награды: <b>' + num(Math.max(0, next.threshold - data.progress)) + '</b></div>' : '<div class="cg-next is-done">Все награды открыты</div>') + '</div></div>' +
        '<div class="cg-board"><div class="cg-scroll"><div class="cg-inner" id="cg-inner"><svg class="cg-conn" id="cg-conn" aria-hidden="true"></svg>' +
        ms.map(m => '<button type="button" class="cg-prize is-locked" data-cg="' + e(m.id) + '" aria-label="' + e(m.title) + '"><span class="cg-pic"><img src="' + e(img(m)) + '" alt="" loading="lazy"></span>' +
            '<i class="cg-badge">' + LOCK + '</i><span class="cg-lab"></span></button>').join('') +
        '<div class="cg-track"><div class="cg-fill" style="width:' + (still ? (frac * 100).toFixed(2) : 0) + '%"><i class="cg-shine"></i><b class="cg-knob"></b></div>' +
        ms.map(m => '<i class="cg-tick" data-cgt="' + e(m.id) + '"></i>').join('') + '</div>' +
        '<div class="cg-marks">' + ms.map(m => '<span data-cgm="' + e(m.id) + '">' + num(m.threshold) + '</span>').join('') + '</div>' +
        '<svg class="cg-end' + (frac >= 1 ? ' is-on' : '') + '" viewBox="-30 -30 60 60" aria-hidden="true"><path d="M0-26 7-9 26-7 12 6 16 25 0 16-16 25-12 6-26-7-7-9Z" fill="#ffe9a8" stroke="#fff6cf" stroke-width="2" stroke-linejoin="round"/></svg>' +
        '</div></div></div>' +
        '<div class="cg-cta" data-cg-cta' + (readyCount ? '' : ' hidden') + '><span><b>' + (fresh.length ? 'Награда открыта!' : 'Есть награды для вас') + '</b> Заберите их в маркете</span><button type="button" class="ny-action" data-cg-market>В маркет</button></div>' +
        '<div class="cg-legend">' + ms.map(m => '<button type="button" class="cg-card is-' + stateOf(m) + '" data-cgl="' + e(m.id) + '"><span class="cg-pic"><img src="' + e(img(m)) + '" alt="" loading="lazy"></span>' +
            '<span class="cg-info"><b>' + e(m.title) + '</b><small>' + num(m.threshold) + ' ' + noun + ' · ' + e(priceText(m)) + '</small></span><em>' + status(m) + '</em></button>').join('') + '</div></section></div>';
    main.querySelector('[data-cm-back]').addEventListener('click', nav.back);
    const inner = main.querySelector('#cg-inner'), conn = main.querySelector('#cg-conn'), fill = main.querySelector('.cg-fill'), count = main.querySelector('[data-cg-count]');
    const els = new Map(ms.map(m => [m.id, main.querySelector('[data-cg="' + m.id + '"]')]));
    const ROW = 96, PIC = 64;
    const layout = () => {
        if (!inner.isConnected) { window.removeEventListener('resize', layout); return; }
        const rows = ms.length > 1 ? 2 : 1, A = rows * ROW + 8, need = Math.ceil(ms.length / rows) * 72 + 56;
        inner.style.minWidth = need + 'px';
        const W = inner.clientWidth, TRACK = A + 26;
        inner.style.height = (TRACK + 74) + 'px';
        const lanes = [[], []];
        ms.forEach((m, i) => lanes[i % rows].push({m, x: Math.min(W - 40, Math.max(40, m.threshold / total * W)), tick: Math.min(W, m.threshold / total * W), row: i % rows}));
        lanes.forEach(lane => {
            for (let i = 1; i < lane.length; i++) lane[i].x = Math.max(lane[i].x, lane[i - 1].x + 68);
            for (let i = lane.length - 2; i >= 0; i--) lane[i].x = Math.min(lane[i].x, lane[i + 1].x - 68);
        });
        let paths = '';
        lanes.flat().forEach(({m, x, tick, row}) => {
            const top = A - (row + 1) * ROW + 10, el = els.get(m.id);
            el.style.left = x + 'px'; el.style.top = top + 'px';
            const y0 = top + PIC + 4, y1 = TRACK, mid = y0 + (y1 - y0) * .55;
            paths += '<path data-cgp="' + e(m.id) + '" class="' + (el.classList.contains('is-locked') ? '' : 'is-on') + '" d="M' + x.toFixed(1) + ' ' + y0 + 'C' + x.toFixed(1) + ' ' + mid + ' ' + tick.toFixed(1) + ' ' + mid + ' ' + tick.toFixed(1) + ' ' + y1 + '"/>';
            const t = main.querySelector('[data-cgt="' + m.id + '"]'), lab = main.querySelector('[data-cgm="' + m.id + '"]');
            t.style.left = tick + 'px'; lab.style.left = tick + 'px';
        });
        conn.setAttribute('width', W); conn.setAttribute('height', TRACK + 4); conn.setAttribute('viewBox', '0 0 ' + W + ' ' + (TRACK + 4)); conn.innerHTML = paths;
        main.querySelector('.cg-track').style.top = TRACK + 'px';
        main.querySelector('.cg-marks').style.top = (TRACK + 36) + 'px';
        main.querySelector('.cg-end').style.top = (TRACK - 15) + 'px';
    };
    const apply = m => {
        const el = els.get(m.id), st = stateOf(m);
        el.classList.remove('is-locked', 'is-ready', 'is-claimed', 'is-gone'); el.classList.add('is-' + st);
        el.querySelector('.cg-badge').innerHTML = st === 'claimed' ? '✓' : st === 'locked' ? LOCK : '';
        el.querySelector('.cg-lab').textContent = st === 'ready' ? 'Забрать' : st === 'gone' ? 'Разобрано' : '';
        main.querySelector('[data-cgp="' + m.id + '"]')?.classList.toggle('is-on', st !== 'locked');
        main.querySelector('[data-cgt="' + m.id + '"]')?.classList.toggle('is-on', st !== 'locked');
        main.querySelector('[data-cgm="' + m.id + '"]')?.classList.toggle('is-on', st !== 'locked');
    };
    layout();
    window.addEventListener('resize', layout);
    const wake = m => {
        apply(m);
        const el = els.get(m.id), isFresh = fresh.includes(m);
        el.classList.add('is-waking');
        setTimeout(() => el.classList.remove('is-waking'), 1300);
        burst(el, isFresh);
        if (isFresh) remember(m.id);
    };
    if (still) ms.forEach(m => { if (m.reached) apply(m); });
    else {
        const t0 = performance.now(), dur = 900 + 1900 * frac, done = new Set();
        const frame = now => {
            if (!main.isConnected) return;
            const k = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - k, 3), f = frac * eased;
            fill.style.width = (f * 100).toFixed(2) + '%';
            count.textContent = num(Math.round(data.progress * eased));
            ms.forEach(m => { if (m.reached && !done.has(m.id) && f >= m.threshold / total - 1e-6) { done.add(m.id); wake(m); } });
            if (k < 1) requestAnimationFrame(frame);
            else { if (frac >= 1) main.querySelector('.cg-end')?.classList.add('is-on'); ms.forEach(m => { if (m.reached && !done.has(m.id)) wake(m); }); }
        };
        setTimeout(() => requestAnimationFrame(frame), 250);
    }
    const open = id => {
        const m = ms.find(x => x.id === id);
        if (!m) return;
        if (stateOf(m) === 'ready') { window.crafterCmFocusShop = true; nav.market(); return; }
        claimSheet(m, () => window.crafterNewYearShow?.('community'));
    };
    main.querySelectorAll('[data-cg]').forEach(b => b.addEventListener('click', () => open(b.dataset.cg)));
    main.querySelectorAll('[data-cgl]').forEach(b => b.addEventListener('click', () => open(b.dataset.cgl)));
    main.querySelector('[data-cg-market]')?.addEventListener('click', () => { window.crafterCmFocusShop = true; nav.market(); });
}

/* ---------- shop tiles (shown inside the market grid) ---------- */
const ORN = '<img src="/static/assets/new-year-ornament.svg" alt="" aria-hidden="true">';
function tiles(data) {
    return data.milestones.filter(m => m.reached && !m.redeemed && !(m.reward_kind === 'PACK' && m.code)).map(m => {
        const out = !m.left && !m.code;
        const price = m.code ? 'Мой код' : out ? 'Разобрано' : m.price_balls ? ORN + num(m.price_balls) : 'Бесплатно';
        return '<button type="button" class="ny-lot cm-tile' + (out ? ' is-out' : '') + '" data-cm-lot="' + e(m.id) + '"' + (out ? ' disabled' : '') + '>' +
            '<div class="ny-lot-art"><img src="' + e(img(m)) + '" alt=""></div>' +
            '<div class="ny-lot-name">' + e(m.title) + '</div>' +
            '<div class="ny-lot-id">Тираж ' + num(m.left) + '/' + num(m.supply) + '</div>' +
            '<div class="ny-lot-price">' + price + '</div></button>';
    });
}
function bindShop(main, data, refresh) {
    main.querySelectorAll('[data-cm-lot]').forEach(b => b.addEventListener('click', () => claimSheet(data.milestones.find(m => m.id === b.dataset.cmLot), refresh)));
    if (window.crafterCmFocusShop) { window.crafterCmFocusShop = false; main.querySelector('.cm-tile')?.scrollIntoView({behavior: 'smooth', block: 'center'}); }
}
function codeBlock(code) {
    return '<div class="cm-code"><small>Ваш уникальный промокод</small><b>' + e(code) + '</b>' +
        '<p>Код привязан к вашему аккаунту и активируется один раз.</p>' +
        '<div class="cm-code-actions"><button type="button" class="secondary" data-cm-copy>Скопировать</button><button type="button" class="primary" data-cm-redeem>Активировать</button></div>' +
        '<p class="cm-code-out" role="status"></p></div>';
}
function bindCode(body, code) {
    body.querySelector('[data-cm-copy]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); toast('Код скопирован'); } catch (_) { toast(code); }
    });
    const btn = body.querySelector('[data-cm-redeem]'), out = body.querySelector('.cm-code-out');
    btn?.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const r = await api('promocodes/redeem', {code});
            if (r.pack_id) { closeSheet(); window.crafterPacks?.granted(r.pack_id); return; }
            out.textContent = 'Получено: ' + num(r.reward) + (r.currency === 'BALL' ? ' шаров' : ' GRAM');
            out.classList.add('ok');
            if (state.me && r.balance !== undefined) { state.me.balance = r.balance; if (typeof updateBalance === 'function') updateBalance(); }
            if (r.currency === 'BALL' && typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(r.new_year_balance);
        } catch (err) { out.textContent = err.message; out.classList.remove('ok'); btn.disabled = false; }
    });
}
function claimSheet(m, refresh) {
    if (!m) return;
    const rid = 'cm-' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
    const head = '<div class="cm-sheet-head"><span class="cm-pic big"><img src="' + e(img(m)) + '" alt=""></span><div><b>' + e(m.title) + '</b><small>' + e(rewardText(m)) + '</small></div></div>';
    if (!m.reached) { sheet('Награда сообщества', head + '<p class="cm-sheet-note">Откроется, когда сообщество соберёт ' + num(m.threshold) + '. Цена: ' + e(priceText(m)) + '. Тираж: ' + num(m.supply) + '.</p>'); return; }
    if (m.reward_kind === 'PACK' && m.code) { sheet('Награда сообщества', head + '<p class="cm-sheet-note">' + (m.redeemed ? 'Вы уже открыли этот пак.' : 'Пак уже у вас — откройте его в разделе «Новогодний маркет».') + '</p>'); return; }
    if (m.reward_kind === 'STAR' && m.code) { sheet('Награда сообщества', head + '<p class="cm-sheet-note">Подарок уже у вас — он в разделе «Мои подарки».</p>'); return; }
    if (m.code) { sheet('Награда сообщества', head + codeBlock(m.code)); bindCode(document.querySelector('#sheet-body'), m.code); return; }
    sheet('Награда сообщества', head +
        '<p class="cm-sheet-note">Тираж: осталось ' + num(m.left) + ' из ' + num(m.supply) + '. ' + (m.reward_kind === 'STAR' ? 'Подарок Telegram сразу появится в «Мои подарки».' : 'Вы получите уникальный промокод, который сможете активировать только вы.') + '</p>' +
        '<button type="button" class="ny-action" id="cm-claim">' + (m.price_balls ? 'Получить за ' + num(m.price_balls) + ' шаров' : 'Получить бесплатно') + '</button>' +
        '<p class="purchase-error cm-claim-err" role="alert"></p>');
    const body = document.querySelector('#sheet-body'), btn = body.querySelector('#cm-claim');
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const r = await api('community/claim', {milestone_id: m.id, request_id: rid});
            if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(r.balance);
            if (r.gift_id) { m.code = 'STAR:' + r.gift_id; closeSheet(); toast('Подарок получен — он в «Мои подарки»'); refresh?.(); return; }
            if (r.pack_id) { m.code = 'PACK:' + r.pack_id; closeSheet(); await window.crafterPacks?.granted(r.pack_id, refresh); return; }
            m.code = r.code;
            body.innerHTML = head + codeBlock(r.code);
            bindCode(body, r.code);
            refresh?.();
        } catch (err) { body.querySelector('.cm-claim-err').textContent = err.message; btn.disabled = false; }
    });
}

/* ---------- ceremony hook ---------- */
function checkCeremony() {}

/* ---------- administrator ---------- */
const KINDS = [['GRAM', 'Промокод GRAM'], ['BALL', 'Шары'], ['PACK', 'Карточный пак'], ['STAR', 'Подарок Telegram']];
let STARS = [];
const sw = (name, label, on, hint) => '<label class="ny-admin-switch full"><span><b>' + label + '</b>' + (hint ? '<small class="sub" style="display:block;margin-top:4px">' + hint + '</small>' : '') + '</span><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '></label>';
async function admin(content) {
    let r, packs = [];
    try { r = await api('admin/new-year/community'); } catch (_) { return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) { STARS = []; }
    if (!content?.isConnected) return;
    const ev = r.event || {title: 'Крафтим вместе', description: '', metric: 'craft', target: 10000, enabled: false};
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section cm-admin';
    sec.dataset.pane = 'events';
    const rows = (r.milestones || []).map(m => '<div class="ny-admin-row"><div class="cm-admin-pic"><img src="' + e(img(m)) + '" alt=""></div><div><b>' + e(m.title) + '</b><small>с ' + num(m.threshold) + ' · ' + e(rewardText(m)) + ' · ' + e(priceText(m)) + ' · выдано ' + m.sold + '/' + m.supply + '</small></div>' +
        '<button type="button" data-cm-del="' + e(m.id) + '">Удалить</button></div>').join('');
    sec.innerHTML = '<h3>Общая цель</h3>' +
        (r.event ? '<p class="cm-admin-now"><b>' + num(r.progress) + '</b> из ' + num(ev.target) + ' ' + (NOUN[ev.metric] || '') + ' собрано</p>' : '<p class="sub">Создайте событие: все игроки вместе набирают цель и открывают награды.</p>') +
        '<form id="cm-event-form"><div class="ny-admin-fields">' +
        '<label class="full">Название<input name="title" maxlength="80" required value="' + e(ev.title) + '"></label>' +
        '<label class="full">Описание (необязательно)<input name="description" maxlength="300" value="' + e(ev.description) + '"></label>' +
        '<label>Что считаем<select name="metric">' + Object.keys(METRIC_NAME).map(k => '<option value="' + k + '"' + (ev.metric === k ? ' selected' : '') + '>' + METRIC_NAME[k] + '</option>').join('') + '</select></label>' +
        '<label>Цель<input name="target" type="number" min="1" step="1" required value="' + e(ev.target) + '"></label>' +
        sw('enabled', 'Показывать игрокам', ev.enabled) + sw('restart', 'Начать счёт заново', false, 'Обнулит прогресс и этапы') + '</div>' +
        '<button class="primary" type="submit">Сохранить событие</button></form>' +
        (r.event ? '<h3 style="margin-top:22px">Награды за этапы</h3><div class="ny-admin-list">' + (rows || '<p class="sub">Наград пока нет — добавьте первую ниже.</p>') + '</div>' +
        '<h3 style="margin-top:22px">Новая награда</h3><form id="cm-ms-form">' +
        '<div class="cm-seg" role="radiogroup">' + KINDS.filter(k => (k[0] !== 'PACK' || packs.length) && (k[0] !== 'STAR' || STARS.length)).map((k, i) => '<button type="button" data-kind="' + k[0] + '" class="' + (i === 0 ? 'is-on' : '') + '">' + k[1] + '</button>').join('') + '</div>' +
        '<div class="ny-admin-fields">' +
        '<label>Когда открывается<input name="threshold" type="number" min="1" step="1" required placeholder="например 1000"><small class="sub">Сколько должно быть собрано</small></label>' +
        '<label>Тираж<input name="supply" type="number" min="1" step="1" required value="100"><small class="sub">Сколько игроков получат</small></label>' +
        '<label id="cm-amount-label">Размер награды<input name="reward_amount" inputmode="decimal" value="1"></label>' +
        '<div id="cm-pack-label" class="full" hidden><span class="adm-lbl">Какой пак</span>' + (window.crafterPacks ? window.crafterPacks.packTiles(packs, packs[0]?.id) : '') + '<input type="hidden" name="reward_pack" value="' + e(packs[0]?.id || '') + '"></div>' +
        '<label id="cm-star-label" class="full" hidden>Какой подарок<select name="reward_star">' + (window.crafterStarGifts ? window.crafterStarGifts.options(STARS) : '') + '</select></label>' +
        '<label>Цена в шарах<input name="price_balls" type="number" min="0" step="1" value="0"><small class="sub">0 — бесплатно</small></label>' +
        '<label class="full">Картинка (необязательно)<input name="image_url" placeholder="Для пака берётся его картинка"></label>' +
        '<label class="full">Название (необязательно)<input name="title" maxlength="80" placeholder="Создастся автоматически"></label></div>' +
        '<button class="primary" type="submit">Добавить награду</button></form>' : '');
    content.appendChild(sec);
    const run = async (fn, ok) => { try { await fn(); toast(ok); content.innerHTML = ''; window.renderAdminNewYear?.(content); } catch (err) { toast(err.message); } };
    sec.querySelector('#cm-event-form').addEventListener('submit', ev2 => {
        ev2.preventDefault();
        const f = new FormData(ev2.target);
        run(() => api('admin/new-year/community', {title: f.get('title'), description: f.get('description'), metric: f.get('metric'),
            target: f.get('target'), enabled: f.get('enabled') === 'on', restart: f.get('restart') === 'on'}), 'Событие сохранено');
    });
    const form = sec.querySelector('#cm-ms-form');
    let kind = 'GRAM';
    form?.querySelectorAll('.cm-seg [data-kind]').forEach(b => b.addEventListener('click', () => {
        kind = b.dataset.kind;
        form.querySelectorAll('.cm-seg [data-kind]').forEach(x => x.classList.toggle('is-on', x === b));
        form.querySelector('#cm-pack-label').hidden = kind !== 'PACK';
        form.querySelector('#cm-amount-label').hidden = kind === 'PACK' || kind === 'STAR';
        form.querySelector('#cm-star-label').hidden = kind !== 'STAR';
        const amt = form.querySelector('[name=reward_amount]');
        amt.value = kind === 'BALL' ? '100' : '1';
        form.querySelector('#cm-amount-label').firstChild.textContent = kind === 'BALL' ? 'Сколько шаров' : 'Сколько GRAM';
    }));
    form?.querySelectorAll('[data-adm-pack]').forEach(b => b.addEventListener('click', () => {
        form.elements.reward_pack.value = b.dataset.admPack;
        form.querySelectorAll('[data-adm-pack]').forEach(x => x.classList.toggle('is-on', x === b));
    }));
    form?.addEventListener('submit', ev2 => {
        ev2.preventDefault();
        const body = Object.fromEntries(new FormData(ev2.target));
        body.reward_kind = kind;
        if (kind === 'PACK') body.reward_amount = body.reward_pack;
        if (kind === 'STAR') body.reward_amount = body.reward_star;
        run(() => api('admin/new-year/community/milestones', body), 'Награда добавлена');
    });
    sec.querySelectorAll('[data-cm-del]').forEach(b => b.addEventListener('click', () =>
        run(() => api('admin/new-year/community/milestones/' + b.dataset.cmDel + '/delete', {}), 'Награда удалена')));
}

window.crafterCommunity = {card, page, tiles, bindShop, checkCeremony, marketArt, admin, codeBlock, bindCode};
})();
