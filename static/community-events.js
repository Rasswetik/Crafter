/* Community events: hub cards, the goal page with a vertical progress bar, the reward shop block,
   the "goal reached" ceremony and the administrator form. Server state lives in /api/community. */
(function () {
'use strict';
const NOUN = {craft: 'крафтов', upgrade: 'апгрейдов', buy: 'покупок', sale: 'продаж'};
const METRIC_NAME = {craft: 'Крафты', upgrade: 'Апгрейды', buy: 'Покупки', sale: 'Продажи'};
const DEFAULT_IMG = '/static/assets/community-reward.svg';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const img = m => (m.image_url && /^(https:\/\/|\/static\/)/.test(m.image_url)) ? m.image_url : DEFAULT_IMG;
const rewardText = m => m.reward_kind === 'BALL' ? 'Промокод на ' + num(m.reward_amount) + ' шаров' : 'Промокод на ' + num(m.reward_amount) + ' GRAM';
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
function cardArt() {
    return `<svg class="nyh-art nyh-art-cm" viewBox="0 0 400 170" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
<defs><linearGradient id="cc-sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1a3e"/><stop offset="1" stop-color="#2b2a78"/></linearGradient>
<linearGradient id="cc-fill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1f7ae0"/><stop offset=".6" stop-color="#5fc3ff"/><stop offset="1" stop-color="#ffe9a8"/></linearGradient>
<radialGradient id="cc-glow"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".8"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient></defs>
<rect width="400" height="170" fill="url(#cc-sky)"/>
${Array.from({length: 22}, (_, i) => `<circle class="nyh-star" style="--i:${i}" cx="${(i * 61 + 11) % 400}" cy="${(i * 37 + 9) % 160}" r="${i % 3 ? .9 : 1.6}" fill="#fff"/>`).join('')}
<g transform="translate(300 12)">
<circle cx="35" cy="6" r="34" fill="url(#cc-glow)"/>
<path d="M35-10l5.8 12.4 13.6 1.7-10 9.4 2.6 13.4L35 19.8 23 26.9l2.6-13.4-10-9.4 13.6-1.7Z" fill="#ffe9a8" stroke="#fff" stroke-width="1.2" stroke-linejoin="round" class="nyh-ball"/>
<rect x="6" y="40" width="58" height="112" rx="14" fill="#ffffff" fill-opacity=".1" stroke="#cfe8ff" stroke-opacity=".7" stroke-width="2"/>
<rect x="11" y="92" width="48" height="55" rx="10" fill="url(#cc-fill)"/>
<path d="M11 92h48" stroke="#fff" stroke-width="2" opacity=".7"/>
${[0, 1, 2, 3].map(i => `<path d="M2 ${58 + i * 28}h14M54 ${58 + i * 28}h14" stroke="#ffe9a8" stroke-width="2" stroke-linecap="round" opacity=".9"/>`).join('')}
<rect x="13" y="46" width="6" height="96" rx="3" fill="#fff" opacity=".22"/>
</g>
<g transform="translate(212 112)"><rect width="30" height="26" rx="3" fill="#e63946"/><rect x="12.5" width="5" height="26" fill="#ffd25e"/><rect y="9" width="30" height="5" fill="#ffd25e"/><path d="M15 0c-9-12-16 0-3 0M15 0c9-12 16 0 3 0" stroke="#ffd25e" stroke-width="3" fill="none" stroke-linecap="round"/></g>
<g transform="translate(246 124)"><rect width="22" height="20" rx="3" fill="#2f7be0"/><rect x="9" width="4" height="20" fill="#fff"/><path d="M11 0c-7-9-12 0-2 0M11 0c7-9 12 0 2 0" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>
<path d="M0 150c80-8 160-2 240-2s110 2 160-4v26H0Z" fill="#dcecff" opacity=".9"/>
</svg>`;
}

/* ---------- hub card ---------- */
function card(data) {
    const ev = data.event, p = pct(data.progress, ev.target), reached = data.milestones.filter(m => m.reached).length;
    return '<button type="button" class="nyh-card nyh-community" data-nyh="community" aria-label="События сообщества">' + cardArt() +
        '<span class="nyh-copy"><small>События сообщества</small><strong>' + e(ev.title) + '</strong>' +
        '<span class="nyh-mini"><span class="nyh-mini-bar"><i style="width:' + p.toFixed(1) + '%"></i></span>' +
        '<em>' + num(data.progress) + ' / ' + num(ev.target) + ' ' + (NOUN[ev.metric] || '') + '</em></span></span>' +
        '<span class="nyh-meta"><b>' + reached + '/' + data.milestones.length + '</b> наград<i aria-hidden="true">›</i></span></button>';
}

/* ---------- goal page ---------- */
function bar(data, opts = {}) {
    const ev = data.event, H = opts.height || 440;
    const fill = pct(opts.value ?? data.progress, ev.target);
    return '<div class="cm-tube" style="height:' + H + 'px"><div class="cm-glass"></div>' +
        '<div class="cm-fill" style="--to:' + fill.toFixed(2) + '%;height:' + (opts.instant ? fill.toFixed(2) + '%' : '0%') + '">' +
        Array.from({length: 9}, (_, i) => '<u style="--x:' + ((i * 37 + 11) % 86 + 6) + '%;--d:' + (-(i * 1.3) % 6) + 's;--s:' + (3 + i % 4) + 'px"></u>').join('') +
        '</div><i class="cm-cap"></i></div>';
}
function page(main, data, nav) {
    const ev = data.event, H = Math.max(440, data.milestones.length * 104 + 60), tubeH = H;
    const ms = data.milestones;
    const pos = ms.map(m => ({m, ty: tubeH * (1 - Math.min(1, m.threshold / ev.target))}));
    let last = -999;
    pos.forEach(p => { p.cy = Math.max(p.ty - 44, last + 98, 0); p.cy = Math.min(p.cy, H - 90); last = p.cy; });
    for (let i = pos.length - 2; i >= 0; i--) pos[i].cy = Math.min(pos[i].cy, pos[i + 1].cy - 98);
    const p = pct(data.progress, ev.target);
    main.innerHTML = '<div class="new-year-page cm-page">' +
        '<button type="button" class="nyh-back" data-cm-back>‹ События</button>' +
        '<section class="cm-hero"><div class="cm-snow" aria-hidden="true">' + Array.from({length: 16}, (_, i) =>
            '<i style="--x:' + ((i * 53 + 9) % 100) + '%;--s:' + (2 + i % 4) + 'px;--t:' + (6 + i % 7) + 's;--d:' + (-(i * 2) % 9) + 's"></i>').join('') + '</div>' +
        '<small>' + e(ev.title) + '</small><h1>Это цель</h1>' +
        '<div class="cm-goal"><b>' + num(ev.target) + '</b><span>' + (NOUN[ev.metric] || '') + '</span></div>' +
        (ev.description ? '<p>' + e(ev.description) + '</p>' : '') +
        '<div class="cm-now">Сообщество собрало <b>' + num(data.progress) + '</b> · ' + p.toFixed(p < 10 ? 1 : 0) + '%</div></section>' +
        '<section class="cm-stage" style="height:' + (H + 6) + 'px">' +
        '<div class="cm-ticks">' + pos.map(x => '<span class="cm-tl' + (x.m.reached ? ' is-on' : '') + '" style="top:' + x.ty.toFixed(1) + 'px">' + num(x.m.threshold) + '</span>').join('') + '</div>' +
        bar(data, {height: tubeH}) +
        '<div class="cm-lines" style="height:' + H + 'px"><div class="cm-tickmarks">' + pos.map(x => '<i class="' + (x.m.reached ? 'is-on' : '') + '" style="top:' + x.ty.toFixed(1) + 'px"></i>').join('') + '</div></div>' +
        '<svg class="cm-conn" width="18" height="' + H + '" viewBox="0 0 18 ' + H + '" aria-hidden="true">' + pos.map(x =>
            '<path class="' + (x.m.reached ? 'is-on' : '') + '" d="M0 ' + x.ty.toFixed(1) + 'C9 ' + x.ty.toFixed(1) + ' 9 ' + (x.cy + 44).toFixed(1) + ' 18 ' + (x.cy + 44).toFixed(1) + '"/>').join('') + '</svg>' +
        '<div class="cm-rewards">' + pos.map(x => rewardCard(x.m, x.cy, ev)).join('') + '</div></section></div>';
    main.querySelector('[data-cm-back]').addEventListener('click', nav.back);
    main.querySelectorAll('[data-cm-reward]').forEach(b => b.addEventListener('click', () => nav.market()));
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const f = main.querySelector('.cm-fill');
        if (f) f.style.height = f.style.getPropertyValue('--to');
    }));
}
function rewardCard(m, top, ev) {
    const left = Math.max(0, m.threshold - 0);
    const status = m.code ? '<em class="ok">Получено</em>' : m.reached ? (m.left ? '<em class="go">Забрать ›</em>' : '<em class="out">Тираж разобран</em>') :
        '<em class="lock">🔒 до ' + num(m.threshold) + '</em>';
    return '<button type="button" class="cm-reward ' + (m.reached ? 'is-reached' : 'is-locked') + (m.code ? ' is-claimed' : '') + '" data-cm-reward="' + e(m.id) + '" style="top:' + top.toFixed(1) + 'px">' +
        '<span class="cm-pic"><img src="' + e(img(m)) + '" alt="" loading="lazy"></span>' +
        '<span class="cm-info"><b>' + e(m.title) + '</b><small>' + e(priceText(m)) + ' · ' + num(m.left) + '/' + num(m.supply) + '</small>' + status + '</span></button>';
}

/* ---------- shop block ---------- */
function shop(data) {
    const ev = data.event, got = data.milestones.filter(m => m.reached);
    if (!got.length) {
        return '<section class="cm-shop"><div class="ny-section-title"><h2>Награды сообщества</h2><span>скоро</span></div>' +
            '<div class="cm-teaser">Награды появятся здесь, когда сообщество соберёт ' + num(data.milestones[0]?.threshold || ev.target) + ' ' + (NOUN[ev.metric] || '') + '.</div></section>';
    }
    return '<section class="cm-shop" id="cm-shop"><div class="ny-section-title"><h2>Награды сообщества</h2><span>' + got.length + ' шт.</span></div><div class="cm-shop-list">' +
        got.map(m => '<button type="button" class="cm-lot" data-cm-lot="' + e(m.id) + '"' + (!m.left && !m.code ? ' disabled' : '') + '>' +
            '<span class="cm-pic"><img src="' + e(img(m)) + '" alt="" loading="lazy"></span>' +
            '<span class="cm-info"><b>' + e(m.title) + '</b><small>' + e(rewardText(m)) + '</small>' +
            '<small class="cm-left">Тираж: осталось ' + num(m.left) + ' из ' + num(m.supply) + '</small></span>' +
            '<span class="cm-buy ' + (m.code ? 'is-own' : m.price_balls ? '' : 'is-free') + '">' + (m.code ? 'Мой код' : !m.left ? 'Разобрано' : priceText(m)) + '</span></button>').join('') +
        '</div></section>';
}
function bindShop(main, data, refresh) {
    main.querySelectorAll('[data-cm-lot]').forEach(b => b.addEventListener('click', () => claimSheet(data.milestones.find(m => m.id === b.dataset.cmLot), refresh)));
    if (window.crafterCmFocusShop) { window.crafterCmFocusShop = false; main.querySelector('#cm-shop')?.scrollIntoView({behavior: 'smooth', block: 'start'}); }
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
    if (m.code) { sheet('Награда сообщества', head + codeBlock(m.code)); bindCode(document.querySelector('#sheet-body'), m.code); return; }
    sheet('Награда сообщества', head +
        '<p class="cm-sheet-note">Тираж: осталось ' + num(m.left) + ' из ' + num(m.supply) + '. Вы получите уникальный промокод, который сможете активировать только вы.</p>' +
        '<button type="button" class="ny-action" id="cm-claim">' + (m.price_balls ? 'Получить за ' + num(m.price_balls) + ' шаров' : 'Получить бесплатно') + '</button>' +
        '<p class="purchase-error cm-claim-err" role="alert"></p>');
    const body = document.querySelector('#sheet-body'), btn = body.querySelector('#cm-claim');
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const r = await api('community/claim', {milestone_id: m.id, request_id: rid});
            if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(r.balance);
            m.code = r.code;
            body.innerHTML = head + codeBlock(r.code);
            bindCode(body, r.code);
            refresh?.();
        } catch (err) { body.querySelector('.cm-claim-err').textContent = err.message; btn.disabled = false; }
    });
}

/* ---------- ceremony ---------- */
const seenKey = () => 'crafter-cm-seen-' + uid();
function seen() { try { return JSON.parse(localStorage.getItem(seenKey()) || '[]'); } catch (_) { return []; } }
function remember(id) { try { const s = seen(); if (!s.includes(id)) { s.push(id); localStorage.setItem(seenKey(), JSON.stringify(s)); } } catch (_) {} }
let playing = false;
function checkCeremony(data, nav) {
    if (playing || !data?.event || !data.event.enabled) return;
    const done = seen();
    const fresh = data.milestones.find(m => m.reached && !done.includes(m.id));
    if (!fresh) return;
    const already = data.milestones.filter(m => m.reached && done.includes(m.id)).map(m => m.threshold);
    const from = Math.max(0, ...already, 0);
    playing = true; remember(fresh.id);
    const ev = data.event, H = 300;
    const box = document.createElement('div');
    box.className = 'cm-cele';
    box.innerHTML = '<div class="cm-cele-bg"></div><button type="button" class="cm-cele-x" aria-label="Закрыть">×</button>' +
        '<div class="cm-cele-bar"><small>' + e(ev.title) + '</small><div class="cm-bar-wrap">' + bar({event: ev, progress: from}, {height: H, instant: true, value: from}) +
        '<span class="cm-cele-tick" style="bottom:' + pct(fresh.threshold, ev.target).toFixed(1) + '%"><i></i><b>' + num(fresh.threshold) + '</b></span></div></div>' +
        '<div class="cm-cele-text"><h2>Цель события достигнута</h2><p>Вы получили</p>' +
        '<div class="cm-cele-prize"><img src="' + e(img(fresh)) + '" alt=""><b>' + e(fresh.title) + '</b><small>' + e(rewardText(fresh)) + '</small></div>' +
        '<button type="button" class="ny-action cm-take">Забрать</button></div>';
    document.body.appendChild(box);
    const close = go => { box.classList.add('is-out'); setTimeout(() => box.remove(), 350); playing = false; if (go) { window.crafterCmFocusShop = true; (nav?.market || (() => window.crafterNewYearShow?.('market')))(); } };
    box.querySelector('.cm-cele-x').addEventListener('click', () => close(false));
    box.querySelector('.cm-take').addEventListener('click', () => close(true));
    requestAnimationFrame(() => requestAnimationFrame(() => {
        box.classList.add('is-on');
        const f = box.querySelector('.cm-fill');
        if (f) { f.style.transition = 'height 2.4s cubic-bezier(.3,.7,.2,1)'; f.style.height = pct(fresh.threshold, ev.target) + '%'; }
        setTimeout(() => box.classList.add('is-hit'), 2500);
        setTimeout(() => box.classList.add('is-gone'), 3300);
        setTimeout(() => box.classList.add('is-text'), 4000);
    }));
}
setInterval(async () => {
    if (playing || state?.page !== 'new-year' || document.visibilityState === 'hidden') return;
    try { const d = await api('community'); checkCeremony(d, {market: () => window.crafterNewYearShow?.('market')}); } catch (_) {}
}, 30000);

/* ---------- administrator ---------- */
async function admin(content) {
    let r;
    try { r = await api('admin/new-year/community'); } catch (_) { return; }
    if (!content?.isConnected) return;
    const ev = r.event || {title: 'Крафтим вместе', description: '', metric: 'craft', target: 10000, enabled: false};
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section cm-admin';
    sec.innerHTML = '<h3>События сообщества</h3><p class="sub">Общая цель всех игроков и награды за её этапы. Награды попадают в новогодний маркет, когда этап пройден. Каждый покупатель получает свой промокод на одну активацию.</p>' +
        (r.event ? '<p class="sub"><b>Сейчас собрано: ' + num(r.progress) + ' из ' + num(ev.target) + '</b></p>' : '') +
        '<form id="cm-event-form"><div class="ny-admin-fields">' +
        '<label class="full">Название<input name="title" maxlength="80" required value="' + e(ev.title) + '"></label>' +
        '<label class="full">Описание<input name="description" maxlength="300" value="' + e(ev.description) + '"></label>' +
        '<label>Что считаем<select name="metric">' + Object.keys(METRIC_NAME).map(k => '<option value="' + k + '"' + (ev.metric === k ? ' selected' : '') + '>' + METRIC_NAME[k] + '</option>').join('') + '</select></label>' +
        '<label>Цель<input name="target" type="number" min="1" step="1" required value="' + e(ev.target) + '"></label>' +
        '<label class="full"><span><input type="checkbox" name="enabled"' + (ev.enabled ? ' checked' : '') + '> Показывать игрокам</span></label>' +
        '<label class="full"><span><input type="checkbox" name="restart"> Начать счёт заново</span></label></div>' +
        '<button class="primary" type="submit">Сохранить событие</button></form>' +
        (r.event ? '<h3 style="margin-top:18px">Награды</h3><div class="ny-admin-list">' + (r.milestones.map(m =>
            '<div class="ny-admin-row"><div><b>' + e(m.title) + '</b><small>от ' + num(m.threshold) + ' · ' + e(rewardText(m)) + ' · тираж ' + m.sold + '/' + m.supply + ' · ' + e(priceText(m)) + '</small></div>' +
            '<button type="button" data-cm-del="' + e(m.id) + '">Удалить</button></div>').join('') || '<p class="sub">Наград пока нет.</p>') + '</div>' +
        '<form id="cm-ms-form"><div class="ny-admin-fields">' +
        '<label class="full">Название награды<input name="title" maxlength="80" required placeholder="Промокод на 1 GRAM"></label>' +
        '<label>Порог (сколько собрать)<input name="threshold" type="number" min="1" step="1" required></label>' +
        '<label>Тираж<input name="supply" type="number" min="1" step="1" required value="100"></label>' +
        '<label>Тип награды<select name="reward_kind"><option value="GRAM">GRAM</option><option value="BALL">Новогодние шары</option></select></label>' +
        '<label>Размер награды<input name="reward_amount" required inputmode="decimal" value="1"></label>' +
        '<label>Цена в шарах (0 — бесплатно)<input name="price_balls" type="number" min="0" step="1" value="0"></label>' +
        '<label class="full">Картинка (PNG, ссылка https://)<input name="image_url" placeholder="https://…/reward.png"></label></div>' +
        '<button class="primary" type="submit">Добавить награду</button></form>' : '');
    content.appendChild(sec);
    const run = async (fn, ok) => { try { await fn(); toast(ok); content.innerHTML = ''; window.renderAdminNewYear?.(content); } catch (err) { toast(err.message); } };
    sec.querySelector('#cm-event-form').addEventListener('submit', ev2 => {
        ev2.preventDefault();
        const f = new FormData(ev2.target);
        run(() => api('admin/new-year/community', {title: f.get('title'), description: f.get('description'), metric: f.get('metric'),
            target: f.get('target'), enabled: f.get('enabled') === 'on', restart: f.get('restart') === 'on'}), 'Событие сохранено');
    });
    sec.querySelector('#cm-ms-form')?.addEventListener('submit', ev2 => {
        ev2.preventDefault();
        run(() => api('admin/new-year/community/milestones', Object.fromEntries(new FormData(ev2.target))), 'Награда добавлена');
    });
    sec.querySelectorAll('[data-cm-del]').forEach(b => b.addEventListener('click', () =>
        run(() => api('admin/new-year/community/milestones/' + b.dataset.cmDel + '/delete', {}), 'Награда удалена')));
}

window.crafterCommunity = {card, page, shop, bindShop, checkCeremony, marketArt, admin};
})();
