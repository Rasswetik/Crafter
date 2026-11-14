/* The season pass page (its own HTML template /season, script of the page): the road of levels with the free road below and the Pass Plus road above, XP from quests, mega quests.
   Only a «back to events» button, the balance and the level stand over it. Everything (season, levels, rewards, prices, quests, colours) is set in the admin section «Пасс».
   window.crafterSeasonPass = {show, hubCard} */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BALL = '/static/assets/new-year-ornament.svg';
const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) {} };
const left = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? d + 'д. ' + h + 'ч.' : h ? h + 'ч. ' + m + 'м.' : m + 'м.'; };
const thumb = (u, w) => /^\/(static\/assets\/(chests|packs)\/[\w.-]+\.(png|webp|jpe?g)|media\/shop\/[0-9a-f]{32})$/.test(u || '') ? '/thumb?u=' + encodeURIComponent(u) + '&w=' + w : u;
const CUR = {BALL: ['Шары', BALL], DONATE: ['Донат', '/static/assets/gram.svg']};
const KIND_TITLES = {mega: 'Мегаквесты', daily: 'Квесты дня', weekly: 'Квесты недели', special: 'Особые квесты', season: 'Квесты сезона'};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/* a padlock drawn as a picture (no emoji) */
const LOCK = '<svg class="sp-lockico" viewBox="0 0 24 28" aria-hidden="true"><path d="M6 12V8a6 6 0 0 1 12 0v4" fill="none" stroke="#14213f" stroke-width="5" stroke-linecap="round"/><path d="M6 12V8a6 6 0 0 1 12 0v4" fill="none" stroke="#cfd6f0" stroke-width="2.6" stroke-linecap="round"/><rect x="2" y="11" width="20" height="15" rx="4" fill="#ffc83c" stroke="#14213f" stroke-width="2.4"/><circle cx="12" cy="18" r="2.4" fill="#14213f"/></svg>';
const DEFAULT_ICON = {pack_open: '/static/assets/packs/new-year-pack.webp', pack_buy: '/static/assets/packs/new-year-pack.webp', shop_buy: '/static/assets/chests/gingerbread.png', balls_spent: BALL, deposit: '/static/assets/gram.svg',
    deposit_gram: '/static/assets/gram.svg', chain: '/static/assets/drops/snowman.png', freebie: '/static/assets/drops/snowman.png', stake: '/static/assets/gram.svg'};
const icon = (key, size, metric) => {
    const url = /^\/(media\/shop\/[0-9a-f]{32}|static\/assets\/[\w./-]+)$/.test(key || '') ? key : (DEFAULT_ICON[metric] || BALL);
    return '<span class="sp-ic" style="width:' + (size || 64) + 'px;height:' + (size || 64) + 'px"><img src="' + e(thumb(url, 240)) + '" alt="" loading="lazy"></span>';
};

let S = null, tab = 'rewards', root = null, tick = 0, enter = true, justClaimed = new Set(), lastLevel = null, bound = false;

function bgStyle(season) {
    const t = season.theme || {};
    const layers = [];
    if (t.image) layers.push('linear-gradient(rgba(20,10,60,.25),rgba(20,10,60,.55))', 'url(' + thumb(t.image, 1280) + ') center/cover');
    else layers.push('linear-gradient(160deg,' + (t.c1 || '#5b2cff') + ',' + (t.c2 || '#c24fd8') + ' 60%,' + (t.c3 || '#2a1170') + ')');
    return '--sp-c1:' + (t.c1 || '#5b2cff') + ';--sp-c2:' + (t.c2 || '#c24fd8') + ';--sp-c3:' + (t.c3 || '#2a1170') + ';background:' + layers.join(',') + ';';
}

const CHECK = '<i class="sp-check"><svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6" fill="none" stroke="#0d3a1c" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12.5l5 5L20 6" fill="none" stroke="#5dff86" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i>';

const rewardCell = (lv, track) => {
    const side = lv[track], me = S.me;
    const reached = me.level >= lv.level, plusOK = track === 'free' || me.plus;
    const state = side.claimed ? 'is-done' : reached && plusOK ? 'is-ready' : reached ? 'is-nplus' : 'is-locked';
    const rs = side.rewards;
    if (!rs.length) return '<div class="sp-rw is-empty ' + track + '"><span>—</span></div>';
    const main = rs[0], more = rs.slice(1, 3);
    const label = rs.length === 1 ? (main.kind === 'GRAM' ? num(main.amount) + ' GRAM' : main.kind === 'BALL' ? num(main.amount) : (main.count > 1 ? '×' + main.count + ' ' : '') + main.title) : rs.map(r => r.kind === 'BALL' || r.kind === 'GRAM' ? num(r.amount) : '×' + r.count).join(' + ');
    const fresh = justClaimed.has(lv.level + '.' + track);
    return '<button type="button" class="sp-rw ' + track + ' ' + state + (fresh ? ' is-fresh' : '') + '" data-lv="' + lv.level + '" data-track="' + track + '" title="' + e(rs.map(r => r.title + (r.count > 1 ? ' ×' + r.count : '')).join(', ')) + '">' +
        '<img class="sp-rw-img" src="' + e(thumb(main.image, 240)) + '" alt="" loading="lazy">' + more.map((r, k) => '<img class="sp-rw-more m' + k + '" src="' + e(thumb(r.image, 120)) + '" alt="">').join('') +
        '<b>' + e(label.trim()) + '</b>' + (side.claimed ? CHECK : state === 'is-locked' || state === 'is-nplus' ? '<i class="sp-lock">' + LOCK + '</i>' : '') + '</button>';
};

function questCard(q, big, i) {
    const pct = Math.max(q.progress > 0 ? 4 : 0, Math.min(100, Math.round(q.progress / q.target * 100)));
    const status = q.claimed ? 'is-claimed' : q.locked ? 'is-locked' : q.need_plus ? 'is-needplus' : q.done ? 'is-done' : '';
    const chips = q.reward.map(r => '<span class="qc-chip"><img src="' + e(thumb(r.image, 90)) + '" alt=""><b>' + (r.kind === 'BALL' || r.kind === 'GRAM' ? num(r.amount) : r.count > 1 ? num(r.count) : '1') + '</b></span>').join('');
    const tag = q.opens_in ? '<span class="qc-tag is-time"><i></i>Откроется через ' + left(q.opens_in) + '</span>' : q.need_plus ? '<span class="qc-tag is-plus">' + LOCK + 'Только с Pass Plus</span>' : q.ends_in && q.kind !== 'daily' && q.kind !== 'weekly' && q.ends_in < 86400 * 14 ? '<span class="qc-tag is-time"><i></i>До конца ' + left(q.ends_in) + '</span>' : '';
    const canTake = q.done && !q.claimed && !q.locked && !q.need_plus;
    const bar = q.claimed ? '<div class="qc-bar is-got"><b>ПОЛУЧЕНО</b></div>' : q.locked ? '<div class="qc-bar is-lock">' + LOCK + '</div>' : canTake ? '<button type="button" class="qc-take" data-take="' + e(q.id) + '">ЗАБРАТЬ</button>' : '<div class="qc-bar"><i style="--w:' + pct + '%"></i><b>' + num(q.progress) + '/' + num(q.target) + '</b></div>';
    const xp = '<span class="qc-xp"><i>XP</i><b>' + num(q.xp) + '</b></span>';
    const art = icon(q.icon, big ? 118 : 84, q.metric);
    if (big) {
        return '<div class="sp-q qc is-big ' + status + '" data-q="' + e(q.id) + '" style="--i:' + (i || 0) + '">' + tag + '<div class="qc-ic">' + art + '</div><div class="qc-title">' + e(q.title) + '</div>' + bar +
            '<div class="qc-prize">' + chips + (chips ? '<em>+</em>' : '') + xp + '</div></div>';
    }
    return '<div class="sp-q qc ' + status + '" data-q="' + e(q.id) + '" style="--i:' + (i || 0) + '">' + tag + '<div class="qc-ic">' + art + '</div><div class="qc-title">' + e(q.title) + '</div><div class="qc-row">' + bar + xp + '</div>' + (chips ? '<div class="qc-rw">' + chips + '</div>' : '') + '</div>';
}

function hasReady() { return Object.values(S.quests).flat().some(q => q.done && !q.claimed && !q.locked && !q.need_plus); }
function canClaimAny() { return S.levels.some(l => l.level <= S.me.level && ((l.free.rewards.length && !l.free.claimed) || (S.me.plus && l.plus.rewards.length && !l.plus.claimed))); }

function wallet() {
    const b = S.me.balance || {}, gram = S.me.gram !== undefined ? S.me.gram : null;
    return '<div class="sp-wallet"><span class="sp-w" title="Шары"><img src="' + BALL + '" alt=""><b>' + num(b.balls || 0) + '</b></span>' + (b.donate ? '<span class="sp-w" title="Донат"><img src="/static/assets/gram.svg" alt=""><b>' + num(b.donate) + '</b></span>' : '') +
        (gram !== null ? '<span class="sp-w is-gram" title="Баланс GRAM"><img src="/static/assets/gram.svg" alt=""><b>' + num(gram) + '</b><small>GRAM</small></span>' : '') + '</div>';
}

function head() {
    const s = S.season, me = S.me, cur = CUR[s.level_currency] || CUR.BALL;
    const pct = me.xp_for_next ? Math.min(100, Math.round(me.xp_in_level / me.xp_for_next * 100)) : 100;
    const next = S.levels.find(l => l.level === me.level + 1);
    const nextPic = next ? (next.plus.rewards[0] || next.free.rewards[0]) : null;
    return '<header class="sp-head"><button type="button" class="sp-back" data-back aria-label="К событиям"><i>‹</i><span>События</span></button>' +
        '<div class="sp-banner" ' + (s.banner ? 'style="background-image:linear-gradient(100deg,rgba(130,30,20,.5),rgba(20,10,60,.15)),url(' + e(thumb(s.banner, 800)) + ')"' : '') + '><small>СЕЗОН ' + s.number + '</small><h1>' + e(s.title) + '</h1></div>' +
        '<div class="sp-mid"><div class="sp-tabs"><button type="button" class="' + (tab === 'rewards' ? 'is-on' : '') + '" data-tab="rewards">Награды</button><button type="button" class="' + (tab === 'quests' ? 'is-on' : '') + '" data-tab="quests">Квесты' + (hasReady() ? '<i class="sp-dot"></i>' : '') + '</button></div>' +
        '<div class="sp-lvrow"><span class="sp-lvbadge" data-lvbadge title="Ваш уровень">' + me.level + '</span><div class="sp-xpwrap"><div class="sp-xp-track"><i style="--w:' + pct + '%"></i><b>' + (me.xp_for_next ? num(me.xp_in_level) + ' / ' + num(me.xp_for_next) + ' XP' : 'МАКСИМУМ') + '</b></div>' +
        (s.ends_at ? '<span class="sp-ends">Сезон закончится через <b>' + left(s.ends_at - S.now) + '</b></span>' : '') + '</div>' +
        (nextPic ? '<span class="sp-nextbox" title="Награда следующего уровня"><img class="sp-next" src="' + e(thumb(nextPic.image, 80)) + '" alt=""><small>Ур. ' + (me.level + 1) + '</small></span>' : '') + '</div></div>' +
        '<div class="sp-side">' + wallet() + '<div class="sp-tools">' + (s.level_price > 0 && me.level < me.max_level ? '<button type="button" class="sp-buylvl" data-buylvl>Купить уровень <span><img src="' + cur[1] + '" alt="">' + num(s.level_price) + '</span></button>' : '') + (canClaimAny() ? '<button type="button" class="sp-claimall" data-claimall>Забрать всё</button>' : '') + '</div></div></header>';
}

function rewardsTab() {
    const s = S.season, me = S.me, cur = CUR[s.plus_currency] || CUR.BALL;
    const cols = S.levels.map((lv, i) => '<div class="sp-col' + (lv.level === me.level ? ' is-cur' : '') + '" style="--i:' + Math.min(i, 14) + '">' + rewardCell(lv, 'plus') + '<div class="sp-lvl' + (me.level >= lv.level ? ' is-reached' : '') + '"><b>' + lv.level + '</b></div>' + rewardCell(lv, 'free') + '</div>').join('');
    const chevL = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>', chevR = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return '<div class="sp-road"><aside class="sp-tickets"><button type="button" class="sp-ticket plus' + (me.plus ? ' is-own' : '') + '" data-getplus><span class="sp-tk-img"><img src="' + e(thumb(s.plus_ticket, 240)) + '" alt=""></span><b>PASS PLUS</b>' + (me.plus ? '<i>Открыт</i>' : '<i><img src="' + cur[1] + '" alt="">' + num(s.plus_price) + '</i>') + '</button>' +
        '<div class="sp-lvmid"></div><div class="sp-ticket free"><span class="sp-tk-img"><img src="' + e(thumb(s.free_ticket, 240)) + '" alt=""></span><b>FREE</b></div></aside>' +
        '<div class="sp-trackwrap"><div class="sp-track" data-track>' + (cols || '<p class="sp-empty">В этом сезоне пока нет уровней</p>') + '</div></div></div>' +
        '<div class="sp-nav"><button type="button" class="sp-navbtn" data-scroll="-1" aria-label="Назад">' + chevL + '</button><input type="range" class="sp-slider" data-slider min="0" max="1000" value="0" aria-label="Прокрутка по уровням"><button type="button" class="sp-navbtn" data-scroll="1" aria-label="Вперёд">' + chevR + '</button><button type="button" class="sp-tocur" data-tocur>К моему уровню</button></div>';
}

function megaDeck() {
    const list = S.quests.mega || [];
    if (!list.length) return '';
    const idx = Math.max(0, list.findIndex(x => !x.claimed)), cur = list[idx] || list[list.length - 1];
    const behind = Math.min(4, list.length - idx - 1);
    const ends = S.season.ends_at ? S.season.ends_at - S.now : 0;
    const layers = Array.from({length: behind}, (_, k) => '<i class="sp-deck-l" style="--k:' + (k + 1) + '"></i>').join('');
    return '<section class="sp-mega"><header><h3><svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" fill="#fff" stroke="#14213f" stroke-width="2"/><path d="M8 12.5l3 3 5-6" fill="none" stroke="#e8203a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>Мегаквесты</h3>' + (ends > 0 ? '<small>Окончание через<b>' + left(ends) + '</b></small>' : '') + '</header>' +
        '<div class="sp-deck">' + layers + questCard(cur, true, 0) + '</div>' +
        '<div class="sp-mega-foot"><span>Квест ' + Math.min(idx + 1, list.length) + ' из ' + list.length + '</span>' + (list.length > 1 ? '<button type="button" class="sp-megaall" data-megaall>Все мегаквесты</button>' : '') + '</div></section>';
}

function megaAll() {
    const list = S.quests.mega || [];
    const m = modal('<button type="button" class="sp-x" data-close aria-label="Закрыть">×</button><h2>МЕГАКВЕСТЫ</h2><p>Проходите квесты по порядку: следующий откроется после награды за этот.</p><div class="sp-megarow">' +
        list.map((x, i) => (i ? '<i class="sp-mg-arrow"><svg viewBox="0 0 24 24"><path d="M5 6l7 6-7 6M13 6l7 6-7 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></i>' : '') + questCard(x, true, i)).join('') + '</div>');
    m.querySelector('.sp-modal-box').classList.add('sp-megabox');
    m.addEventListener('click', ev => { const t = ev.target.closest('[data-take]'); if (t) { m.remove(); takeQuest(t.dataset.take, t); } });
}

function questsTab() {
    const q = S.quests;
    const sec = (kind, extra) => q[kind].length ? '<section class="sp-qsec ' + kind + '"><header><h3>' + KIND_TITLES[kind] + '</h3>' + (extra || '') + '</header><div class="sp-qlist">' + q[kind].map((x, i) => questCard(x, false, i)).join('') + '</div></section>' : '';
    const cols = [[sec('daily', '<small>обновится через ' + left(S.refresh.daily_in) + '</small>'), sec('weekly', '<small>обновится через ' + left(S.refresh.weekly_in) + '</small>')].join(''), [sec('special'), sec('season')].join('')].filter(Boolean);
    const mega = megaDeck();
    if (!mega && !cols.length) return '<div class="sp-quests"><p class="sp-empty">Квестов пока нет</p></div>';
    return '<div class="sp-quests' + (mega ? ' has-mega' : '') + '">' + mega + '<div class="sp-qright cols-' + Math.max(1, cols.length) + '">' + cols.map(c => '<div class="sp-qcol">' + c + '</div>').join('') + '</div></div>';
}

function draw() {
    if (!root || !root.isConnected) return;
    const keep = root.querySelector('[data-track]')?.scrollLeft || 0, keepY = root.querySelector('.sp-quests')?.scrollTop || 0;
    if (S && !S.season) { location.replace('/'); return; }
    if (!S || !S.season) { root.className = 'sp-root'; root.innerHTML = '<button type="button" class="sp-back sp-back-solo" data-back>‹ События</button><div class="sp-none"><h2>Сезонного пасса пока нет</h2><p>Как только сезон начнётся, он появится здесь.</p></div>'; root.style.cssText = ''; return; }
    root.className = 'sp-root' + (enter ? ' is-enter' : '');
    root.style.cssText = bgStyle(S.season);
    root.innerHTML = '<i class="sp-pat pat-' + e((S.season.theme || {}).pattern || 'snow') + '"></i>' + ((S.season.theme || {}).image ? '<i class="sp-scrim"></i>' : '') + '<i class="sp-glow"></i>' + head() + '<div class="sp-body">' + (tab === 'rewards' ? rewardsTab() : questsTab()) + '</div>';
    // the bars fill from zero after the first paint
    requestAnimationFrame(() => requestAnimationFrame(() => root && root.classList.add('is-run')));
    const tr = root.querySelector('[data-track]');
    if (tr) {
        tr.scrollLeft = keep;
        if (!keep) { const cur = tr.querySelector('.sp-rw.is-ready') || tr.querySelector('.sp-col.is-cur'); if (cur) setTimeout(() => glide(tr, Math.max(0, (cur.closest('.sp-col') || cur).offsetLeft - 40)), 350); }
        wireTrack(tr);
    }
    const qs = root.querySelector('.sp-quests'); if (qs) qs.scrollTop = keepY;
    fitRoad();
    if (lastLevel !== null && S.me.level > lastLevel) levelUp(S.me.level);
    lastLevel = S.me.level;
    enter = false;
    justClaimed = new Set();
}

/* the two rows of cards take exactly the height that is left in the window */
function fitRoad() {
    if (!root) return;
    const road = root.querySelector('.sp-road');
    if (!road) return;
    const H = road.clientHeight;
    if (!H) return;
    const lh = Math.max(44, Math.min(60, (H - 16) / 2 * .3));
    const ch = Math.max(96, Math.min(250, Math.floor((H - lh - 10) / 2)));
    root.style.setProperty('--ch', ch + 'px');
    root.style.setProperty('--lh', Math.round(lh) + 'px');
}
window.addEventListener('resize', () => fitRoad());

/* the road scrolls by the wheel, by dragging with the mouse, by the arrows and by the keys */
/* the road glides to the place with easing instead of a jump; a touch or the wheel stops it */
let gliding = 0;
function glide(tr, to) {
    const max = Math.max(0, tr.scrollWidth - tr.clientWidth);
    to = Math.max(0, Math.min(max, to));
    if (reduced()) { tr.scrollLeft = to; return; }
    const from = tr.scrollLeft, dist = to - from, dur = Math.min(900, 380 + Math.abs(dist) * .35), t0 = performance.now(), id = ++gliding;
    tr.classList.add('is-glide');
    const step = now => {
        if (id !== gliding || !tr.isConnected) { tr.classList.remove('is-glide'); return; }
        const k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 4);
        tr.scrollLeft = from + dist * ease;
        if (k < 1) requestAnimationFrame(step); else tr.classList.remove('is-glide');
    };
    requestAnimationFrame(step);
}

/* the lots come to life as they enter the window: a short flip and a rise, one after another */
function revealCols(tr) {
    const cols = [...tr.querySelectorAll('.sp-col')];
    if (reduced() || !('IntersectionObserver' in window)) { cols.forEach(c => c.classList.add('is-seen')); return; }
    let batch = 0, timer = 0;
    const io = new IntersectionObserver(list => {
        list.filter(x => x.isIntersecting).sort((a, b) => a.boundingClientRect.left - b.boundingClientRect.left).forEach(x => {
            x.target.style.setProperty('--d', (batch++ * 55) + 'ms'); x.target.classList.add('is-seen'); io.unobserve(x.target);
        });
        clearTimeout(timer); timer = setTimeout(() => { batch = 0; }, 120);
    }, {root: tr, threshold: .15});
    cols.forEach(c => io.observe(c));
}

function wireTrack(tr) {
    revealCols(tr);
    tr.addEventListener('wheel', () => { gliding++; }, {passive: true});
    tr.addEventListener('touchstart', () => { gliding++; }, {passive: true});
    const wrap = tr.parentElement, sl = root.querySelector('[data-slider]');
    const upd = () => { wrap.classList.toggle('at-start', tr.scrollLeft < 8); wrap.classList.toggle('at-end', tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 8); if (sl && !sl.matches(':active')) { const max = Math.max(1, tr.scrollWidth - tr.clientWidth); sl.value = Math.round(tr.scrollLeft / max * 1000); sl.style.setProperty('--p', sl.value / 10 + '%'); } };
    tr.addEventListener('scroll', upd, {passive: true}); upd();
    if (sl) sl.addEventListener('input', () => { tr.scrollLeft = sl.value / 1000 * Math.max(1, tr.scrollWidth - tr.clientWidth); sl.style.setProperty('--p', sl.value / 10 + '%'); });
    tr.addEventListener('wheel', ev => { if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { tr.scrollLeft += ev.deltaY * 1.2; ev.preventDefault(); } }, {passive: false});
    let down = null, moved = false;
    tr.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'mouse' || ev.button !== 0) return; down = {x: ev.clientX, left: tr.scrollLeft}; moved = false; });
    const mv = ev => { if (!down) return; if (!tr.isConnected) { window.removeEventListener('pointermove', mv); return; } const dx = ev.clientX - down.x; if (Math.abs(dx) > 5) { moved = true; tr.classList.add('is-drag'); } if (moved) tr.scrollLeft = down.left - dx; };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', () => { if (down) { down = null; setTimeout(() => tr.classList.remove('is-drag'), 0); } });
    tr.addEventListener('click', ev => { if (moved) { ev.stopPropagation(); ev.preventDefault(); moved = false; } }, true);
}

async function load() {
    try { S = await api('pass'); } catch (err) { S = null; toast(err.message); }
    draw();
}

/* a burst of sparks from a card */
function burstAt(el) {
    if (reduced() || !el) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 14; i++) {
        const d = document.createElement('i');
        d.className = 'sp-spark';
        const a = Math.random() * Math.PI * 2, dist = 50 + Math.random() * 90;
        d.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;--dx:' + Math.cos(a) * dist + 'px;--dy:' + Math.sin(a) * dist + 'px;--s:' + (.6 + Math.random() * .9);
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 900);
    }
}

function levelUp(level) {
    if (reduced()) return;
    const el = document.createElement('div');
    el.className = 'sp-levelup';
    el.innerHTML = '<i class="sp-lu-ring"></i><i class="sp-lu-ring r2"></i><b>УРОВЕНЬ ' + level + '</b>';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
    root.querySelector('[data-lvbadge]')?.classList.add('is-pop');
}

/* what was given: the list of prizes, chests and drops open on the screen */
async function showGiven(res) {
    const g = res.given || res;
    if (g.chest_opens && window.crafterChests) await window.crafterChests.playMany(g.chest_opens, {bg: 'cozy', toast, refresh() {}});
    const items = g.items || [];
    const F = window.crafterFestive;
    if (items.length && !F) { toast('Награды получены'); }
    else if (items.length) {
        /* the same screen as after a purchase: packs fan out, currencies get their own plate */
        const packs = {}, shown = [];
        let balls = 0, gram = 0;
        items.forEach(i => {
            if (i.kind === 'BALL') balls += Number(i.amount) || 0;
            else if (i.kind === 'GRAM') gram += Number(i.amount) || 0;
            else if (i.kind === 'PACK' && (i.pack_ids || []).length) { (packs[i.amount] = packs[i.amount] || {i, ids: []}).ids.push(...i.pack_ids); }
            else shown.push(i);
        });
        const plan = [];
        Object.values(packs).forEach(p => plan.push({it: {kind: 'PACK', pack: {image: p.i.image, title: p.i.title}, image_url: p.i.image, bundle: p.ids.length}, result: {packIds: p.ids, count: p.ids.length, head: 'Награда сезона', title: 'Вы получили: <b>' + e(p.i.title) + (p.ids.length > 1 ? ' ×' + num(p.ids.length) : '') + '</b>'}}));
        if (gram) plan.push({it: {kind: 'GRAM', image_url: '/static/assets/gram.svg', rarity: 'res'}, result: {head: 'Награда сезона', title: 'Зачислено: ' + num(gram) + ' GRAM', text: 'Баланс уже обновлён.'}});
        if (balls) plan.push({it: {kind: 'BALL', image_url: BALL, rarity: 'res'}, result: {head: 'Награда сезона', title: 'Зачислено шаров: ' + num(balls), text: 'Баланс уже обновлён.'}});
        shown.forEach(i => plan.push({it: {kind: i.kind, image_url: i.image, rarity: 'res'}, result: {head: 'Награда сезона', title: 'Получено: ' + e(i.title) + (i.count > 1 ? ' ×' + i.count : ''), text: i.kind === 'NFT' ? 'Он уже в вашем инвентаре.' : 'Награда уже у вас.'}}));
        for (const step of plan) {
            await new Promise(done => { F.reveal({it: step.it}, step.result, {refresh: done}, () => {}); });
        }
        window.crafterNewYearUpdateBalance && S && load();
    }
    if (g.drop_granted && window.crafterDrops) window.crafterDrops.afterPurchase(g.drop_granted, {refresh() { load(); }});
}

/* Pass Plus unlocked: the ticket flies out of the dark with rays, the text and a flash */
async function unlocked() {
    const s = S.season, el = document.createElement('div');
    el.className = 'sp-unlock';
    el.innerHTML = '<i class="sp-un-rays"></i><i class="sp-un-flash"></i><h2>PASS PLUS ОТКРЫТ!</h2><img class="sp-un-ticket" src="' + e(thumb(s.plus_ticket, 520)) + '" alt="">' +
        Array.from({length: 22}, (_, i) => '<i class="sp-un-sp" style="--a:' + (i * 360 / 22) + 'deg;--d:' + (140 + (i * 53) % 200) + 'px;--t:' + (0.9 + (i % 5) * .15) + 's"></i>').join('') + '<p>Нажмите, чтобы продолжить</p>';
    document.body.appendChild(el);
    await sleep(80); el.classList.add('is-in');
    await new Promise(done => { setTimeout(() => el.addEventListener('click', () => { el.classList.remove('is-in'); setTimeout(() => { el.remove(); done(); }, 250); }, {once: true}), 900); });
}

function modal(html) {
    const el = document.createElement('div');
    el.className = 'sp-modal';
    el.innerHTML = '<div class="sp-modal-box">' + html + '</div>';
    el.addEventListener('click', ev => { if (ev.target === el || ev.target.closest('[data-close]')) el.remove(); });
    document.body.appendChild(el);
    return el;
}

function buyPlus() {
    if (S.me.plus) { toast('Pass Plus уже открыт'); return; }
    const s = S.season, cur = CUR[s.plus_currency] || CUR.BALL;
    const bal = s.plus_currency === 'DONATE' ? S.me.balance.donate : S.me.balance.balls;
    const m = modal('<button type="button" class="sp-x" data-close aria-label="Закрыть">×</button><h2>ПОЛУЧИТЬ PASS PLUS!</h2><div class="sp-buy-art"><img src="' + e(thumb(s.plus_ticket, 420)) + '" alt=""></div>' +
        '<p>Откройте награды Pass Plus, дополнительные квесты и верхнюю дорогу сезона «' + e(s.title) + '».</p><div class="sp-err" data-err></div><button type="button" class="sp-btn is-gold" data-pay><img src="' + cur[1] + '" alt="">' + num(s.plus_price) + '</button><small>У вас: ' + num(bal) + ' ' + cur[0].toLowerCase() + '</small>');
    m.querySelector('[data-pay]').addEventListener('click', async ev => {
        ev.target.disabled = true;
        try { await api('pass/buy-plus', {}); m.remove(); await load(); window.crafterNewYearUpdateBalance && S && window.crafterNewYearUpdateBalance(S.me.balance); await unlocked(); } catch (err) { m.querySelector('[data-err]').textContent = err.message; ev.target.disabled = false; }
    });
}

function buyLevel() {
    const s = S.season, cur = CUR[s.level_currency] || CUR.BALL, left_ = S.me.max_level - S.me.level;
    const m = modal('<button type="button" class="sp-x" data-close aria-label="Закрыть">×</button><h2>КУПИТЬ УРОВЕНЬ</h2><div class="sp-lvl-pick"><button type="button" data-n="1" class="is-on">+1</button>' + (left_ >= 3 ? '<button type="button" data-n="3">+3</button>' : '') + (left_ >= 5 ? '<button type="button" data-n="5">+5</button>' : '') + (left_ >= 10 ? '<button type="button" data-n="10">+10</button>' : '') + '</div>' +
        '<p data-sum></p><div class="sp-err" data-err></div><button type="button" class="sp-btn is-gold" data-pay></button>');
    let n = 1;
    const sync = () => { m.querySelector('[data-sum]').textContent = 'Вы перейдёте на уровень ' + Math.min(S.me.max_level, S.me.level + n) + ' и сразу сможете забрать награды.'; m.querySelector('[data-pay]').innerHTML = '<img src="' + cur[1] + '" alt="">' + num(s.level_price * n); m.querySelectorAll('[data-n]').forEach(b => b.classList.toggle('is-on', Number(b.dataset.n) === n)); };
    m.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => { n = Number(b.dataset.n); sync(); }));
    sync();
    m.querySelector('[data-pay]').addEventListener('click', async ev => {
        ev.target.disabled = true;
        try { const res = await api('pass/buy-level', {count: n}); m.remove(); window.crafterNewYearUpdateBalance && window.crafterNewYearUpdateBalance(res.balance); await load(); } catch (err) { m.querySelector('[data-err]').textContent = err.message; ev.target.disabled = false; }
    });
}

async function claim(body, card) {
    try {
        if (card) { card.classList.add('is-claiming'); burstAt(card); }
        const res = await api('pass/claim', body);
        window.crafterNewYearUpdateBalance && window.crafterNewYearUpdateBalance(res.balance);
        (res.taken || []).forEach(t => justClaimed.add(t.level + '.' + t.track));
        await sleep(card ? 260 : 0);
        await load();
        await showGiven(res);
    } catch (err) { card && card.classList.remove('is-claiming'); toast(err.message); }
}

async function takeQuest(id, btn) {
    try {
        const cardEl = btn && btn.closest('.sp-q');
        if (cardEl) { cardEl.classList.add('is-claiming'); burstAt(cardEl); }
        const res = await api('pass/quest/claim', {quest_id: id});
        await sleep(280);
        await load();
        toast('+' + res.xp + ' XP');
        if (res.given) await showGiven(res.given);
    } catch (err) { toast(err.message); await load(); }
}

function bind() {
    root.addEventListener('click', ev => {
        if (ev.target.closest('[data-back]')) { location.assign('/new-year'); return; }
        const t = ev.target.closest('[data-tab]');
        if (t) { if (tab !== t.dataset.tab) { tab = t.dataset.tab; enter = true; draw(); } return; }
        if (ev.target.closest('[data-getplus]')) { buyPlus(); return; }
        if (ev.target.closest('[data-buylvl]')) { buyLevel(); return; }
        if (ev.target.closest('[data-claimall]')) { claim({track: 'all'}); return; }
        const sc = ev.target.closest('[data-scroll]');
        if (ev.target.closest('[data-megaall]')) { megaAll(); return; }
        if (sc) { const tr = root.querySelector('[data-track]'); glide(tr, tr.scrollLeft + Number(sc.dataset.scroll) * Math.max(300, tr.clientWidth * .75)); return; }
        if (ev.target.closest('[data-tocur]')) { const tr = root.querySelector('[data-track]'), c = tr.querySelector('.sp-col.is-cur'); if (c) glide(tr, Math.max(0, c.offsetLeft - 40)); return; }
        const rw = ev.target.closest('.sp-rw[data-lv]');
        if (rw) {
            if (rw.classList.contains('is-ready')) claim({level: Number(rw.dataset.lv), track: rw.dataset.track}, rw);
            else if (rw.classList.contains('is-nplus')) buyPlus();
            else if (rw.classList.contains('is-locked')) toast('Уровень ' + rw.dataset.lv + ' ещё не достигнут');
            return;
        }
        const take = ev.target.closest('[data-take]');
        if (take) takeQuest(take.dataset.take, take);
        else { const q = ev.target.closest('.sp-q.is-needplus'); if (q) buyPlus(); }
    });
    root.addEventListener('keydown', ev => {
        const tr = root.querySelector('[data-track]');
        if (!tr) return;
        if (ev.key === 'ArrowRight') { tr.scrollBy({left: 260, behavior: 'smooth'}); ev.preventDefault(); }
        if (ev.key === 'ArrowLeft') { tr.scrollBy({left: -260, behavior: 'smooth'}); ev.preventDefault(); }
    });
}

async function show() {
    const main = document.querySelector('#sp-app');
    if (!main) return;
    main.innerHTML = '<div class="sp-page"><div class="sp-root" tabindex="0"></div></div>';
    root = main.querySelector('.sp-root');
    root.innerHTML = '<div class="sp-none"><h2>Загрузка…</h2></div>';
    enter = true; lastLevel = null;
    bind();
    await load();
    root.focus({preventScroll: true});
    clearInterval(tick);
    tick = setInterval(() => { if (!root || !root.isConnected) { clearInterval(tick); return; } if (S && S.now) { S.now += 30; S.refresh && (S.refresh.daily_in -= 30, S.refresh.weekly_in -= 30); } }, 30000);
}
show();
})();
