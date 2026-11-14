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
    const pct = Math.round(q.progress / q.target * 100);
    const status = q.claimed ? 'is-claimed' : q.locked ? 'is-locked' : q.need_plus ? 'is-needplus' : q.done ? 'is-done' : '';
    const rewardChips = q.reward.map(r => '<span class="sp-chip"><img src="' + e(thumb(r.image, 80)) + '" alt="">' + (r.kind === 'BALL' || r.kind === 'GRAM' ? num(r.amount) : '×' + r.count) + '</span>').join('');
    const timer = q.opens_in ? '<small class="sp-timer">Откроется через ' + left(q.opens_in) + '</small>' : q.ends_in && q.kind !== 'daily' && q.kind !== 'weekly' && q.ends_in < 86400 * 14 ? '<small class="sp-timer">До конца ' + left(q.ends_in) + '</small>' : '';
    return '<div class="sp-q ' + (big ? 'is-big ' : '') + status + '" data-q="' + e(q.id) + '" style="--i:' + (i || 0) + '">' + (q.plus_only ? '<em class="sp-plusonly">ТОЛЬКО С PASS PLUS</em>' : '') + timer +
        '<div class="sp-q-art">' + icon(q.icon, big ? 120 : 68, q.metric) + '</div><div class="sp-q-body"><h4>' + e(q.title) + '</h4>' +
        (q.locked ? '<div class="sp-bar is-lock">' + LOCK + '</div>' : '<div class="sp-bar"><i style="--w:' + pct + '%"></i><span>' + num(q.progress) + '/' + num(q.target) + '</span></div>') +
        '<div class="sp-q-foot"><span class="sp-xp"><b>XP</b>' + num(q.xp) + '</span>' + rewardChips + (q.done && !q.claimed && !q.locked && !q.need_plus ? '<button type="button" class="sp-take" data-take="' + e(q.id) + '">Забрать</button>' : q.claimed ? '<span class="sp-got">Получено</span>' : '') + '</div></div></div>';
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
    return '<div class="sp-road"><aside class="sp-tickets"><button type="button" class="sp-ticket plus' + (me.plus ? ' is-own' : '') + '" data-getplus><span>PASS PLUS</span><img src="' + e(thumb(s.plus_ticket, 320)) + '" alt="">' + (me.plus ? '<i>Открыт</i>' : '<i><img src="' + cur[1] + '" alt="">' + num(s.plus_price) + '</i>') + '</button>' +
        '<div class="sp-lvmid"></div><div class="sp-ticket free"><span>FREE</span><img src="' + e(thumb(s.free_ticket, 320)) + '" alt=""></div></aside>' +
        '<div class="sp-trackwrap"><button type="button" class="sp-arrow l" data-scroll="-1" aria-label="Назад">‹</button><div class="sp-track" data-track>' + (cols || '<p class="sp-empty">В этом сезоне пока нет уровней</p>') + '</div><button type="button" class="sp-arrow r" data-scroll="1" aria-label="Вперёд">›</button>' +
        '<button type="button" class="sp-tocur" data-tocur>К моему уровню</button></div></div>';
}

function questsTab() {
    const q = S.quests, block = (kind, extra) => q[kind].length ? '<section class="sp-qsec ' + kind + '"><header><h3>' + KIND_TITLES[kind] + '</h3>' + (extra || '') + '</header><div class="sp-qlist">' + q[kind].map((x, i) => questCard(x, kind === 'mega', i)).join('') + '</div></section>' : '';
    const out = block('mega') + block('daily', '<small>До обновления ' + left(S.refresh.daily_in) + '</small>') + block('weekly', '<small>До обновления ' + left(S.refresh.weekly_in) + '</small>') + block('special') + block('season');
    return '<div class="sp-quests">' + (out || '<p class="sp-empty">Квестов пока нет</p>') + '</div>';
}

function draw() {
    if (!root || !root.isConnected) return;
    const keep = root.querySelector('[data-track]')?.scrollLeft || 0, keepY = root.querySelector('.sp-quests')?.scrollTop || 0;
    if (!S || !S.season) { root.className = 'sp-root'; root.innerHTML = '<button type="button" class="sp-back sp-back-solo" data-back>‹ События</button><div class="sp-none"><h2>Сезонного пасса пока нет</h2><p>Как только сезон начнётся, он появится здесь.</p></div>'; root.style.cssText = ''; return; }
    root.className = 'sp-root' + (enter ? ' is-enter' : '');
    root.style.cssText = bgStyle(S.season);
    root.innerHTML = '<i class="sp-pat pat-' + e((S.season.theme || {}).pattern || 'snow') + '"></i><i class="sp-glow"></i>' + head() + '<div class="sp-body">' + (tab === 'rewards' ? rewardsTab() : questsTab()) + '</div>';
    // the bars fill from zero after the first paint
    requestAnimationFrame(() => requestAnimationFrame(() => root && root.classList.add('is-run')));
    const tr = root.querySelector('[data-track]');
    if (tr) {
        tr.scrollLeft = keep;
        if (!keep) { const cur = tr.querySelector('.sp-rw.is-ready') || tr.querySelector('.sp-col.is-cur'); if (cur) tr.scrollTo({left: Math.max(0, (cur.closest('.sp-col') || cur).offsetLeft - 40), behavior: reduced() ? 'auto' : 'smooth'}); }
        wireTrack(tr);
    }
    const qs = root.querySelector('.sp-quests'); if (qs) qs.scrollTop = keepY;
    if (lastLevel !== null && S.me.level > lastLevel) levelUp(S.me.level);
    lastLevel = S.me.level;
    enter = false;
    justClaimed = new Set();
}

/* the road scrolls by the wheel, by dragging with the mouse, by the arrows and by the keys */
function wireTrack(tr) {
    const wrap = tr.parentElement;
    const upd = () => { wrap.classList.toggle('at-start', tr.scrollLeft < 8); wrap.classList.toggle('at-end', tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 8); };
    tr.addEventListener('scroll', upd, {passive: true}); upd();
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
    if (items.length) {
        const el = document.createElement('div');
        el.className = 'sp-modal';
        el.innerHTML = '<div class="sp-modal-box sp-gotbox"><h2>Получено!</h2><div class="sp-gotlist">' + items.map((i, k) => '<div class="sp-got-it" style="--i:' + k + '"><img src="' + e(thumb(i.image, 200)) + '" alt=""><b>' + e(i.kind === 'GRAM' ? num(i.amount) + ' GRAM' : i.kind === 'BALL' ? num(i.amount) + ' шаров' : i.title + (i.count > 1 ? ' ×' + i.count : '')) + '</b></div>').join('') + '</div><button type="button" class="sp-btn" data-ok>Отлично</button></div>';
        document.body.appendChild(el);
        await new Promise(done => { el.addEventListener('click', ev => { if (ev.target === el || ev.target.closest('[data-ok]')) { el.remove(); done(); } }); });
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
        if (sc) { const tr = root.querySelector('[data-track]'); tr.scrollBy({left: Number(sc.dataset.scroll) * Math.max(300, tr.clientWidth * .75), behavior: 'smooth'}); return; }
        if (ev.target.closest('[data-tocur]')) { const tr = root.querySelector('[data-track]'), c = tr.querySelector('.sp-col.is-cur'); if (c) tr.scrollTo({left: Math.max(0, c.offsetLeft - 40), behavior: 'smooth'}); return; }
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
