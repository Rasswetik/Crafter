/* The page of the event «Vice City: Розыск» (its own HTML template /season/wanted): the countdown to the release, the wanted level (0-5 stars) with sirens,
   seven missions that open one after another, the prizes of the stars, the badge «Day One» and the leaderboard «Король Вайс-Сити».
   Everything (dates, missions, prizes) is set in the admin section «Розыск»; the progress and the prizes are counted and given by the server. */
(function () {
'use strict';
const A = '/static/assets/wanted/';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) {} };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const CURR = (window.crafterCurrency || {name: 'Шары', gen: 'шаров'});
const BALL = '/static/assets/new-year-ornament.svg';
const p2 = n => String(Math.max(0, n)).padStart(2, '0');
const split = s => { s = Math.max(0, Math.floor(s)); return {d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60}; };

let S = null, L = null, tab = 'missions', root = null, tick = 0, off = 0;           // off: the difference between the server clock and this one
const now = () => Math.floor(Date.now() / 1000) + off;

const media = (em, cls) => !em ? '' : em.kind === 'video' ? '<video class="' + (cls || '') + '" src="' + e(em.media) + '" autoplay loop muted playsinline poster="' + e(em.poster || em.image || '') + '"></video>' : '<img class="' + (cls || '') + '" src="' + e(em.image || em.media) + '" alt="" draggable="false">';
const rewardChip = r => '<span class="wp-chip"><img src="' + e(r.image || BALL) + '" alt=""><b>' + e(r.title) + (r.count > 1 && r.kind !== 'BALL' ? ' ×' + r.count : '') + '</b></span>';

/* ---------- the pieces of the page ---------- */
function hero() {
    const state = !S.enabled ? 'Скоро' : S.active ? 'Событие идёт' : S.starts_at && now() < S.starts_at ? 'Скоро старт' : 'Событие завершено';
    return '<header class="wp-top"><button type="button" class="wp-back" data-back>‹ События</button><span class="wp-state' + (S.active ? ' is-on' : '') + '">' + e(state) + '</span></header>' +
        '<section class="wp-hero"><picture><source media="(max-width:720px)" srcset="' + A + 'key_art/banner_mobile.webp"><img src="' + A + 'key_art/banner_wide.webp" alt="" draggable="false"></picture>' +
        '<div class="wp-hero-text"><h1>' + e(S.title) + '</h1><p>' + e(S.subtitle || '') + '</p></div></section>';
}
function countdown() {
    if (!S.release_at) return '';
    const left = S.release_at - now();
    if (left <= 0) {
        const b = S.bonus && S.bonus.mult > 1 && S.bonus.until > now();
        return '<section class="wp-release"><img src="' + A + 'icons/i_star.webp" alt=""><div><b>Игра вышла!</b><span>' + (b ? 'Бонус дня: награды в шарах ×' + S.bonus.mult + ' ещё ' + clock(S.bonus.until - now()) : 'Спасибо, что были с нами с самого начала.') + '</span></div></section>';
    }
    const t = split(left);
    return '<section class="wp-count" aria-label="До выхода игры"><div class="wp-count-in"><img src="' + A + 'ui/countdown_frame.webp" alt="" draggable="false">' +
        [['d', 'дней', 14], ['h', 'часов', 38], ['m', 'минут', 62], ['s', 'секунд', 86]].map(x => '<div class="wp-cd" style="left:' + x[2] + '%"><b data-cd="' + x[0] + '">' + p2(t[x[0]]) + '</b><small>' + x[1] + '</small></div>').join('') + '</div><p>До выхода игры</p></section>';
}
const clock = s => { const t = split(s); return (t.d ? t.d + ' д ' : '') + p2(t.h) + ':' + p2(t.m) + ':' + p2(t.s); };
function wantedBar() {
    const lv = S.level;
    const glow = lv ? Math.min(1, .25 + lv * .17) : 0;
    return '<section class="wp-wanted' + (lv ? ' is-hot' : '') + '" style="--glow:' + glow + '"><img class="wp-siren r" src="' + A + 'stars/siren_red.webp" alt=""><img class="wp-siren b" src="' + A + 'stars/siren_blue.webp" alt="">' +
        '<div class="wp-bar"><img src="' + A + 'stars/wanted_bar_frame.webp" alt="" draggable="false">' +
        [14, 32, 50, 68, 86].map((x, i) => '<img class="wp-star' + (i < lv ? ' is-on' : '') + '" style="left:' + x + '%" src="' + A + 'stars/star_' + (i < lv ? 'on' : 'off') + '.webp" alt="" draggable="false">').join('') + '</div>' +
        '<p><b>Уровень розыска: ' + lv + ' из 5</b></p></section>';
}
function missionCard(m, i) {
    const lock = m.status === 'locked', done = m.status === 'claimed', ready = m.status === 'ready';
    const pct = Math.round(m.progress / Math.max(1, m.target) * 100);
    const stars = '★'.repeat(m.level_after) + '<i>' + '★'.repeat(5 - m.level_after) + '</i>';
    return '<article class="wp-mission is-' + m.status + '" style="--i:' + i + '"><div class="wp-m-art"><img src="' + e(m.image) + '" alt="" draggable="false">' + (lock ? '<img class="wp-lock" src="' + A + 'missions/locked_lock.webp" alt="">' : '') + '</div>' +
        '<div class="wp-m-body"><small>Миссия ' + (i + 1) + ' · розыск <span class="wp-m-stars">' + stars + '</span></small><h3>' + e(m.title) + '</h3><p>' + e(m.description) + '</p>' +
        '<div class="wp-m-rw">' + m.rewards.map(rewardChip).join('') + '</div>' +
        (done ? '<div class="wp-m-state is-done">Выполнено</div>' : lock ? '<div class="wp-m-state is-lock">Откроется после миссии ' + i + '</div>' :
            '<div class="wp-prog"><i style="width:' + pct + '%"></i><b>' + num(m.progress) + ' / ' + num(m.target) + '</b></div>' + (ready ? '<button type="button" class="wp-take" data-claim="' + e(m.id) + '">Получить награду</button>' : '')) + '</div>' +
        (lock ? '<img class="wp-tape" src="' + A + 'missions/locked_tape.webp" alt="">' : '') +
        (done ? '<div class="wp-passed"><img src="' + A + 'missions/passed_stamp.webp" alt=""><b>MISSION<br>PASSED</b></div>' : '') + '</article>';
}
function missionsTab() {
    if (!S.enabled || !S.missions.length) return '<div class="wp-empty"><img src="' + A + 'characters/goshan_run.webp" alt=""><h2>Миссии скоро откроются</h2><p>Событие ещё не началось. Загляните сюда позже: Гошан уже готовит сумку.</p></div>';
    return '<div class="wp-missions">' + S.missions.map(missionCard).join('') + '</div>' +
        (S.level >= 5 ? '<div class="wp-win"><img src="' + A + 'characters/nikolay_thumbs.webp" alt=""><div><b>Все дела закрыты!</b><span>Вы прошли событие и получили пять звёзд розыска.</span></div><img src="' + A + 'characters/goshan_thumbs.webp" alt=""></div>' : '');
}
function rewardsTab() {
    const d1 = S.day_one;
    return '<h2 class="wp-h">Награды за звёзды</h2><div class="wp-stars">' + S.stars.map(s => '<div class="wp-sr' + (s.got ? ' is-got' : '') + '"><div class="wp-sr-st">' + '★'.repeat(s.star) + '</div>' +
        '<div class="wp-sr-rw">' + (s.rewards.length ? s.rewards.map(r => (r.kind === 'EMOJI' ? '<span class="wp-chip big"><img src="' + e(r.image) + '" alt=""><b>' + e(r.title) + '</b></span>' : rewardChip(r))).join('') : '<span class="wp-none">—</span>') + '</div>' +
        (s.got ? '<img class="wp-ok" src="' + A + 'icons/i_check.webp" alt="">' : '') + '</div>').join('') + '</div>' +
        '<h2 class="wp-h">Day One</h2><div class="wp-d1' + (d1.got ? ' is-got' : '') + '"><img src="' + A + 'ui/dayone_poster.webp" alt=""><div><b>Значок «Day One»</b><p>Наберите хотя бы ' + d1.stars + ' ' + (d1.stars === 1 ? 'звезду' : d1.stars < 5 ? 'звезды' : 'звёзд') + ' розыска до выхода игры, и значок ваш навсегда.' + (S.bonus && S.bonus.mult > 1 ? ' В день релиза награды в шарах ×' + S.bonus.mult + '.' : '') + '</p>' +
        (d1.got ? '<span class="wp-got">Получен</span>' : S.released ? '<span class="wp-miss">К релизу не хватило звёзд</span>' : '<span class="wp-wait">До релиза: ' + clock(S.release_at - now()) + '</span>') + '</div>' + (d1.badge ? '<div class="wp-d1-badge">' + media(d1.badge, 'wp-bd') + '</div>' : '') + '</div>';
}
function leadersTab() {
    if (!L) return '<div class="wp-empty"><h2>Загрузка…</h2></div>';
    const medals = ['medal_gold', 'medal_silver', 'medal_bronze'];
    const rows = L.leaders.map(r => '<div class="wp-lr' + (r.rank <= 3 ? ' top' : '') + '">' + (r.rank <= 3 ? '<img class="wp-medal" src="' + A + 'ui/' + medals[r.rank - 1] + '.webp" alt="">' : '<b class="wp-rank">' + r.rank + '</b>') +
        (r.photo ? '<img class="wp-ava" src="' + e(r.photo) + '" alt="">' : '<span class="wp-ava">' + e((r.name || '?')[0]) + '</span>') + '<span class="wp-nm">' + e(r.name) + (r.emoji ? ' ' + media(r.emoji, 'wp-em') : '') + '</span><strong>' + num(r.points) + '</strong></div>').join('');
    const pz = L.prizes || {};
    const prizes = Object.keys(pz).filter(k => (pz[k] || []).length).map(k => '<div class="wp-pz"><span class="wp-pz-n">' + (Number(k) <= 3 ? '<img src="' + A + 'ui/' + medals[Number(k) - 1] + '.webp" alt="">' : '<b>' + k + '</b>') + '</span><span class="wp-pz-r">' + pz[k].map(rewardChip).join('') + '</span></div>').join('');
    return '<div class="wp-lead-head"><img src="' + A + 'ui/trophy.webp" alt=""><div><h2>Король Вайс-Сити</h2><p>Очки за активность во время события: раунд арены ×3, открытие пака, апгрейд и крафт ×2, покупки и продажи ×1.</p></div></div>' +
        (prizes ? '<h2 class="wp-h">Призы</h2><div class="wp-pzs">' + prizes + '</div>' + (L.paid ? '<p class="wp-none">Награды лидерам уже выданы.</p>' : '') : '') +
        (L.me ? '<div class="wp-me">Вы на ' + L.me.rank + ' месте · ' + num(L.me.points) + ' очков</div>' : '<div class="wp-me">Пока у вас нет очков: сыграйте или откройте пак.</div>') +
        '<div class="wp-lrows">' + (rows || '<p class="wp-none">Пока никого. Станьте первым!</p>') + '</div>';
}
function draw() {
    if (!root) return;
    root.innerHTML = hero() + countdown() + wantedBar() +
        '<nav class="wp-tabs">' + [['missions', 'Миссии'], ['rewards', 'Награды'], ['leaders', 'Лидеры']].map(t => '<button type="button" class="' + (tab === t[0] ? 'is-on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</nav>' +
        '<section class="wp-pane">' + (tab === 'missions' ? missionsTab() : tab === 'rewards' ? rewardsTab() : leadersTab()) + '</section><div class="wp-city" aria-hidden="true"></div>';
}

/* ---------- the screens of the prizes ---------- */
function starScreen(level) {
    return new Promise(done => {
        const el = document.createElement('div');
        el.className = 'wp-newstar';
        el.innerHTML = '<img class="wp-ns-glow" src="' + A + 'stars/star_glow.webp" alt=""><div class="wp-ns-burst"></div><img class="wp-ns-star" src="' + A + 'stars/star_on.webp" alt="">' +
            '<h2>НОВАЯ ЗВЕЗДА</h2><p>Уровень розыска: ' + level + ' из 5</p><button type="button" class="wp-take">Дальше</button>';
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('is-in'));
        el.querySelector('button').addEventListener('click', () => { el.classList.remove('is-in'); setTimeout(() => { el.remove(); done(); }, 250); });
    });
}
async function showGiven(res) {
    const g = res.given || res;
    if (g.chest_opens && window.crafterChests) await window.crafterChests.playMany(g.chest_opens, {bg: 'cozy', toast, refresh() {}});
    const items = g.items || [], F = window.crafterFestive;
    if (items.length && !F) toast('Награды получены');
    else if (items.length) {
        const packs = {}, shown = [];
        let balls = 0, gram = 0;
        items.forEach(i => {
            if (i.kind === 'BALL') balls += Number(i.amount) || 0;
            else if (i.kind === 'GRAM') gram += Number(i.amount) || 0;
            else if (i.kind === 'PACK' && (i.pack_ids || []).length) { (packs[i.amount] = packs[i.amount] || {i, ids: []}).ids.push(...i.pack_ids); }
            else shown.push(i);
        });
        const plan = [];
        Object.values(packs).forEach(p => plan.push({it: {kind: 'PACK', pack: {image: p.i.image, title: p.i.title}, image_url: p.i.image, bundle: p.ids.length}, result: {packIds: p.ids, count: p.ids.length, head: 'Награда миссии', title: 'Вы получили: <b>' + e(p.i.title) + (p.ids.length > 1 ? ' ×' + num(p.ids.length) : '') + '</b>'}}));
        if (gram) plan.push({it: {kind: 'GRAM', image_url: '/static/assets/gram.svg', rarity: 'res'}, result: {head: 'Награда миссии', title: 'Зачислено: ' + num(gram) + ' GRAM', text: 'Баланс уже обновлён.'}});
        if (balls) plan.push({it: {kind: 'BALL', image_url: BALL, rarity: 'res'}, result: {head: 'Награда миссии', title: 'Зачислено ' + CURR.gen + ': ' + num(balls), text: 'Баланс уже обновлён.'}});
        shown.forEach(i => plan.push({it: {kind: i.kind, image_url: i.image, rarity: 'res'}, result: {head: 'Награда миссии', title: 'Получено: ' + e(i.title) + (i.count > 1 ? ' ×' + i.count : ''), text: i.kind === 'EMOJI' ? 'Значок уже в вашем профиле.' : 'Награда уже у вас.'}}));
        for (const step of plan) await new Promise(done => { F.reveal({it: step.it}, step.result, {refresh: done}, () => {}); });
    }
    if (g.drop_granted && window.crafterDrops) window.crafterDrops.afterPurchase(g.drop_granted, {refresh() { load(); }});
}

/* ---------- actions ---------- */
async function load() {
    try {
        S = await api('wanted');
        off = S.now - Math.floor(Date.now() / 1000);
        draw();
        if (tab === 'leaders') loadLeaders();
    } catch (err) { if (root) root.innerHTML = '<div class="wp-empty"><h2>Не получилось загрузить</h2><p>' + e(err.message) + '</p></div>'; }
}
async function loadLeaders() { try { L = await api('wanted/leaders'); if (tab === 'leaders') draw(); } catch (err) { toast(err.message); } }
async function claim(id, btn) {
    btn.disabled = true;
    try {
        const res = await api('wanted/claim', {mission_id: id});
        await load();
        if (res.new_stars && res.new_stars.length) await starScreen(res.level_after);
        await showGiven(res);
        await load();
    } catch (err) { toast(err.message); await load(); }
}
function bind() {
    root.addEventListener('click', ev => {
        if (ev.target.closest('[data-back]')) { location.assign('/season'); return; }
        const t = ev.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; draw(); if (tab === 'leaders') loadLeaders(); return; }
        const c = ev.target.closest('[data-claim]');
        if (c) claim(c.dataset.claim, c);
    });
}
function tickOnce() {
    if (!root || !root.isConnected) { clearInterval(tick); return; }
    if (!S || !S.release_at) return;
    const left = S.release_at - now();
    if (left <= 0 && root.querySelector('.wp-count')) { draw(); return; }
    const t = split(left);
    root.querySelectorAll('[data-cd]').forEach(b => { b.textContent = p2(t[b.dataset.cd]); });
}
function show() {
    root = document.querySelector('#wp-app');
    if (!root) return;
    root.innerHTML = '<div class="wp-boot">Загрузка…</div>';
    bind();
    load();
    clearInterval(tick);
    tick = setInterval(tickOnce, 1000);
}
show();
})();
