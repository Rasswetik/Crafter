/* Страница казино «Diamond» (шаблон /season/diamond): колесо фортуны, общий джекпот, VIP-уровни, шансы и последние выигрыши.
   Результат прокрутки определяет сервер; колесо только красиво подкручивается к ответу. */
(function () {
'use strict';
const A = '/static/assets/diamond/';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) {} };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const CURR = (window.crafterCurrency || {name: 'Шары', gen: 'шаров'});
const BALL = '/static/assets/new-year-ornament.svg';
const u = n => A + n + '.webp';
const p2 = n => String(Math.max(0, n)).padStart(2, '0');
const VIP = ['Бронза', 'Серебро', 'Золото', 'Бриллиант'];
const TIER = {common: 'Обычный', rare: 'Редкий', epic: 'Эпический', jackpot: 'Джекпот'};
const COLORS = ['#ff4fa8', '#8a45ff', '#27d3ff'];

let S = null, root = null, tick = 0, off = 0, busy = false, rot = 0, shownPool = 0, odds = false;
const now = () => Math.floor(Date.now() / 1000) + off;
const nextReset = () => (Math.floor((now() + 10800) / 86400) + 1) * 86400 - 10800;
const clock = s => { s = Math.max(0, Math.floor(s)); return p2(Math.floor(s / 3600)) + ':' + p2(Math.floor(s % 3600 / 60)) + ':' + p2(s % 60); };
const chip = r => '<span class="dm-chip"><img src="' + e(r.image || BALL) + '" alt=""><b>' + e(r.title) + (r.count > 1 && r.kind !== 'BALL' ? ' ×' + r.count : '') + '</b></span>';
const chips = list => list && list.length ? '<span class="dm-chips">' + list.map(chip).join('') + '</span>' : '';

/* ---------- the wheel ---------- */
function pt(r, deg) { const a = deg * Math.PI / 180; return [(r * Math.sin(a)).toFixed(3), (-r * Math.cos(a)).toFixed(3)]; }
function sectorLabel(s) {
    if (s.jackpot) return 'ДЖЕКПОТ';
    const r = s.rewards[0];
    if (!r) return '';
    const t = r.kind === 'BALL' ? num(r.amount) : String(r.title || '').slice(0, 10) + (r.count > 1 ? ' ×' + r.count : '');
    return t + (s.rewards.length > 1 ? ' +' : '');
}
function wheelSVG() {
    const defs = [], parts = [];
    const grad = (id, c) => defs.push('<radialGradient id="' + id + '" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="' + c + '" stop-opacity=".55"/><stop offset=".45" stop-color="' + c + '"/><stop offset="1" stop-color="' + c + '"/></radialGradient>');
    COLORS.forEach((c, i) => grad('dmc' + i, c));
    grad('dmrare', '#ffc83a'); grad('dmepic', '#18b8d8'); grad('dmjack', '#ff9f1c');
    S.sectors.forEach((s, i) => {
        const a = pt(100, i * 30 - 15), b = pt(100, i * 30 + 15);
        const fill = s.jackpot ? 'dmjack' : s.tier === 'epic' ? 'dmepic' : s.tier === 'rare' ? 'dmrare' : 'dmc' + (i % 3);
        const img = s.jackpot ? A + 'diamond_big.webp' : (s.rewards[0] && s.rewards[0].image) || BALL;
        const size = s.jackpot ? 28 : 19;
        parts.push('<g class="dm-sec' + (s.jackpot ? ' is-jp' : '') + '" data-i="' + i + '"><path d="M0 0 L' + a[0] + ' ' + a[1] + ' A100 100 0 0 1 ' + b[0] + ' ' + b[1] + ' Z" fill="url(#' + fill + ')" stroke="#ffffff55" stroke-width=".7"/>' +
            '<g transform="rotate(' + i * 30 + ')"><image href="' + e(img) + '" x="' + (-size / 2) + '" y="' + (-52 - size / 2) + '" width="' + size + '" height="' + size + '"/>' +
            '<text y="-71" text-anchor="middle" font-size="' + (s.jackpot ? 6.6 : 7.6) + '" font-weight="900" fill="#fff" stroke="#14052e" stroke-width="2.2" paint-order="stroke" style="font-family:Inter,Arial,sans-serif">' + e(sectorLabel(s)) + '</text></g></g>');
    });
    return '<svg class="dm-wheel-svg" viewBox="-100 -100 200 200" aria-hidden="true"><defs>' + defs.join('') + '</defs><g id="dm-rot" style="transform:rotate(' + rot + 'deg)">' + parts.join('') + '</g></svg>';
}
function lamps() {
    return Array.from({length: 12}, (_, i) => { const a = i * 30 * Math.PI / 180; return '<img class="dm-lamp ' + (i % 2 ? 'b' : 'a') + '" src="' + u('lamp_on') + '" alt="" style="left:' + (50 + 39.5 * Math.sin(a)).toFixed(2) + '%;top:' + (50 - 39.5 * Math.cos(a)).toFixed(2) + '%">'; }).join('');
}
function stage() {
    const canFree = S.free_left > 0, canPaid = S.paid_left > 0 && S.balls >= S.price;
    const reset = clock(nextReset() - now());
    return '<section class="dm-stage"><img class="dm-host l" src="' + u('goshan_host') + '" alt="" draggable="false"><div class="dm-center">' +
        '<div class="dm-jp"><small class="dm-jp-l">ОБЩИЙ ДЖЕКПОТ</small><div class="dm-jp-box"><img src="' + u('jackpot_frame') + '" alt="" draggable="false"><b id="dm-pool" class="dm-jp-n">' + num(shownPool) + '</b></div></div>' +
        '<div class="dm-wheel" id="dm-wheel">' + wheelSVG() + '<img class="dm-rim" src="' + u('rim') + '" alt="" draggable="false">' + lamps() + '<img class="dm-hubcap" src="' + u('hub') + '" alt="" draggable="false"><img class="dm-pointer" src="' + u('pointer') + '" alt="" draggable="false"><img class="dm-burst" id="dm-burst" alt="" draggable="false"></div>' +
        '<div class="dm-actions"><button type="button" class="dm-btn" data-spin="free"' + (canFree && !busy ? '' : ' disabled') + '><span class="dm-t">Крутить бесплатно</span><small>осталось ' + S.free_left + ' из ' + S.free_total + '</small></button>' +
        '<button type="button" class="dm-btn pink" data-spin="paid"' + (canPaid && !busy ? '' : ' disabled') + '><span class="dm-t">Крутить за ' + num(S.price) + ' <img src="' + BALL + '" alt=""></span><small>' + (S.paid_left ? 'сегодня ещё ' + S.paid_left + ', у вас ' + num(S.balls) : 'лимит на сегодня исчерпан') + '</small></button></div>' +
        '<p class="dm-note">' + (!canFree && !S.paid_left ? 'Прокрутки на сегодня закончились. Новые через <b data-cd>' + reset + '</b>.' : !canFree ? 'Бесплатные прокрутки закончились, новые через <b data-cd>' + reset + '</b>.' : S.pity_left <= 3 && S.paid_left ? 'Гарантированный приз через ' + S.pity_left + ' платн. прокруток.' : 'Результат определяет сервер, шансы ниже.') + '</p></div>' +
        '<img class="dm-host r" src="' + u('nikolay_host') + '" alt="" draggable="false"></section>';
}
function vipPanel() {
    const v = S.vip, span = v.next ? Math.min(100, Math.round(v.xp / v.next * 100)) : 100;
    return '<section class="dm-sec-box"><div class="dm-vip-h"><img src="' + u('vip_' + (v.level + 1)) + '" alt=""><div><small>Ваш статус</small><b>' + VIP[v.level] + '</b></div></div>' +
        '<div class="dm-prog"><div class="dm-prog-h"><span>' + (v.next ? 'До уровня «' + VIP[v.level + 1] + '»' : 'Высший уровень') + '</span><span>' + (v.next ? num(v.xp) + ' / ' + num(v.next) : '') + '</span></div><div class="dm-meter"><i style="width:' + span + '%"></i></div></div>' +
        '<div class="dm-levels">' + v.levels.map((l, i) => '<div class="dm-lv' + (i === v.level ? ' on' : i < v.level ? ' done' : '') + '"><img src="' + u('vip_' + (i + 1)) + '" alt=""><b>' + VIP[i] + '</b><span>' + num(l.need) + ' оп.</span><span>' + l.free + ' беспл. в день</span>' + (l.discount ? '<span>скидка ' + l.discount + '%</span>' : '') + '</div>').join('') + '</div></section>';
}
function oddsPanel() {
    return '<section class="dm-sec-box"><button type="button" class="dm-fold" data-odds>Шансы выпадения <i>' + (odds ? '−' : '+') + '</i></button>' + (odds ? '<div class="dm-odds">' + S.sectors.map(s => '<div class="dm-od ' + s.tier + '"><span class="t">' + TIER[s.tier] + '</span><span class="r">' + (s.jackpot ? '<b>Весь джекпот</b>' + chips(s.rewards) : chips(s.rewards)) + '</span><b class="c">' + s.chance + '%</b></div>').join('') + '</div><p class="dm-note">Каждая десятая платная прокрутка гарантированно даёт редкий или эпический приз. Часть платных прокруток идёт в общий джекпот.</p>' : '') + '</section>';
}
function winsPanel() {
    const w = S.wins.map(x => '<div class="dm-win ' + x.tier + '"><span>' + e(x.name) + '</span>' + (x.jackpot ? '<b class="jp">Джекпот ' + num(x.jackpot) + '</b>' : chips(x.rewards)) + '</div>').join('');
    const mine = S.mine.map(x => '<div class="dm-win ' + x.tier + '"><span>' + (x.mode === 'free' ? 'Бесплатно' : 'За шары') + '</span>' + chips(x.rewards) + '</div>').join('');
    return '<section class="dm-sec-box"><h3>Крупные выигрыши</h3>' + (w || '<p class="dm-note">Пока крупных выигрышей не было.</p>') + '</section><section class="dm-sec-box"><h3>Ваши последние прокрутки</h3>' + (mine || '<p class="dm-note">Вы ещё не крутили колесо.</p>') + '</section>';
}
function draw() {
    if (!S) return;
    if (!S.enabled && !S.admin) { root.innerHTML = top() + '<section class="dm-sec-box"><h3>Казино скоро откроется</h3><p class="dm-note">Следите за новостями раздела «События».</p></section>'; return; }
    if (!shownPool) shownPool = S.jackpot;
    root.innerHTML = '<img class="dm-bg" src="' + u('bg') + '" onerror="this.remove()" alt="">' + top() + '<section class="dm-hero"><picture><source media="(max-width:720px)" srcset="' + u('hero_mobile') + '"><img class="dm-hero-img" fetchpriority="high" decoding="async" src="' + u('hero_wide') + '" onerror="this.closest(\'picture\').remove()" alt="" draggable="false"></picture>' +
        '<div class="dm-hero-text"><h1>' + e(S.title) + '</h1><p>' + e(S.subtitle || '') + '</p>' + (!S.enabled ? '<span class="dm-off">Выключено: видно только вам</span>' : '') + '</div></section>' + stage() +
        '<div class="dm-grid">' + vipPanel() + oddsPanel() + '</div><div class="dm-grid">' + winsPanel() + '</div>';
    if (rot) { const g = root.querySelector('#dm-rot'); if (g) g.style.transform = 'rotate(' + rot + 'deg)'; }
}
function top() {
    return '<header class="dm-top"><button type="button" class="dm-back" data-back>‹ События</button><div class="dm-chipsbar"><span class="dm-pill"><img src="' + BALL + '" alt=""><b>' + num(S.balls || 0) + '</b></span>' + (S.vip ? '<span class="dm-pill"><img src="' + u('vip_' + (S.vip.level + 1)) + '" alt=""><b>' + VIP[S.vip.level] + '</b></span>' : '') + '</div></header>';
}

/* ---------- spinning ---------- */
async function countTo(el, from, to, ms) {
    const t0 = performance.now();
    await new Promise(done => { const step = t => { const k = Math.min(1, (t - t0) / ms); el.textContent = num(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el.isConnected) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
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
        Object.values(packs).forEach(p => plan.push({it: {kind: 'PACK', pack: {image: p.i.image, title: p.i.title}, image_url: p.i.image, bundle: p.ids.length}, result: {packIds: p.ids, count: p.ids.length, head: 'Казино Diamond', title: 'Вы выиграли: <b>' + e(p.i.title) + (p.ids.length > 1 ? ' ×' + num(p.ids.length) : '') + '</b>'}}));
        if (gram) plan.push({it: {kind: 'GRAM', image_url: '/static/assets/gram.svg', rarity: 'res'}, result: {head: 'Казино Diamond', title: 'Зачислено: ' + num(gram) + ' GRAM', text: 'Баланс уже обновлён.'}});
        if (balls) plan.push({it: {kind: 'BALL', image_url: BALL, rarity: 'res'}, result: {head: 'Казино Diamond', title: 'Выигрыш ' + CURR.gen + ': ' + num(balls), text: 'Баланс уже обновлён.'}});
        shown.forEach(i => plan.push({it: {kind: i.kind, image_url: i.image, rarity: 'res'}, result: {head: 'Казино Diamond', title: 'Вы выиграли: ' + e(i.title) + (i.count > 1 ? ' ×' + i.count : ''), text: i.kind === 'EMOJI' ? 'Значок уже в вашем профиле.' : 'Награда уже у вас.'}}));
        for (const step of plan) { try { await Promise.race([new Promise(done => F.reveal({it: step.it}, step.result, {refresh: done}, () => {})), new Promise(r => setTimeout(r, 60000))]); } catch (_) {} }
        document.querySelectorAll('.fm-reveal').forEach(x => x.remove());
    }
    if (g.drop_granted && window.crafterDrops) window.crafterDrops.afterPurchase(g.drop_granted, {refresh() {}});
}
async function spin(mode) {
    if (busy) return;
    busy = true;
    root.querySelectorAll('[data-spin]').forEach(b => { b.disabled = true; });
    let res;
    try { res = await api('diamond/spin', {mode, request_id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).slice(0, 60)}); }
    catch (err) { toast(err.message); busy = false; await load(); return; }
    const g = root.querySelector('#dm-rot'), wheel = root.querySelector('#dm-wheel');
    const turn = 360 * (reduced() ? 1 : 6) + ((360 - res.sector * 30) % 360) + (Math.random() * 16 - 8);
    rot = Math.ceil(rot / 360) * 360 + turn;
    const ms = reduced() ? 400 : 5200;
    wheel.classList.add('is-spin');
    g.style.transition = 'transform ' + ms + 'ms cubic-bezier(.12,.62,.08,1)';
    g.style.transform = 'rotate(' + rot + 'deg)';
    const oldPool = shownPool;
    await sleep(ms + 150);
    wheel.classList.remove('is-spin');
    const burst = root.querySelector('#dm-burst');
    if (burst && res.tier !== 'common') { burst.src = u(res.tier === 'jackpot' ? 'jackpot_burst' : 'win_burst'); burst.className = 'dm-burst on ' + res.tier; await sleep(reduced() ? 100 : 1400); burst.className = 'dm-burst'; }
    S = res.state;
    try { await showGiven(res); } catch (err) { toast(err.message); }
    shownPool = S.jackpot;
    busy = false;
    draw();
    if (res.level_up) toast('Новый VIP-уровень: ' + VIP[S.vip.level] + '!');
    const pool = root.querySelector('#dm-pool');
    if (pool && oldPool !== S.jackpot) countTo(pool, oldPool, S.jackpot, 900);
}

/* ---------- loading ---------- */
async function load() {
    try { S = await api('diamond'); off = S.now - Math.floor(Date.now() / 1000); } catch (err) { root.innerHTML = '<div class="dm-boot">' + e(err.message) + '</div>'; return; }
    if (S.jackpot) shownPool = S.jackpot;
    draw();
}
function bind() {
    root.addEventListener('click', ev => {
        if (ev.target.closest('[data-back]')) { location.assign('/season'); return; }
        const s = ev.target.closest('[data-spin]');
        if (s && !s.disabled) { spin(s.dataset.spin); return; }
        if (ev.target.closest('[data-odds]')) { odds = !odds; draw(); }
    });
}
function tickOnce() {
    if (!root || !root.isConnected) { clearInterval(tick); return; }
    const el = root.querySelector('[data-cd]');
    if (el && S) { const l = nextReset() - now(); el.textContent = clock(l); if (l <= 0 && !busy) load(); }
}
function show() {
    root = document.querySelector('#dm-app');
    if (!root) return;
    bind();
    load();
    tick = setInterval(tickOnce, 1000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
