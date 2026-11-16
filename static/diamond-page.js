/* Страница казино «Diamond» (шаблон /season/diamond): четыре колеса фортуны, слоты, общий джекпот, VIP-уровни, шансы и выигрыши.
   Результат прокрутки определяет сервер; колесо и барабаны только красиво показывают ответ. */
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
const PALETTE = {classic: ['#ff4fa8', '#8a45ff', '#27d3ff'], gold: ['#e8a400', '#b45309', '#7c3aed'], diamond: ['#0ea5e9', '#6366f1', '#a5b4fc'], royal: ['#b91c1c', '#3b0764', '#d97706']};
const WCHIP = {classic: 'chip_cyan', gold: 'chip_gold', diamond: 'chip_pink', royal: 'vip_4'};
const SYM = {coin: BALL, cyan: u('chip_cyan'), pink: u('chip_pink'), gold: u('chip_gold'), silver: u('vip_2'), crown: u('vip_3'), badge: u('vip_4'), diamond: u('diamond_big')};

let S = null, root = null, tick = 0, off = 0, busy = false, shownPool = 0, odds = false;
let tab = 'wheels', wheelId = 'classic', bet = 0, rots = {}, lastWin = null, lastSlot = null, reels = ['diamond', 'coin', 'gold'];
const now = () => Math.floor(Date.now() / 1000) + off;
const nextReset = () => (Math.floor((now() + 10800) / 86400) + 1) * 86400 - 10800;
const clock = s => { s = Math.max(0, Math.floor(s)); return p2(Math.floor(s / 3600)) + ':' + p2(Math.floor(s % 3600 / 60)) + ':' + p2(s % 60); };
const chip = r => '<span class="dm-chip"><img src="' + e(r.image || BALL) + '" alt=""><b>' + e(r.title) + (r.count > 1 && r.kind !== 'BALL' ? ' ×' + r.count : '') + '</b></span>';
const chips = list => list && list.length ? '<span class="dm-chips">' + list.map(chip).join('') + '</span>' : '';
const W = () => S.wheels.find(w => w.id === wheelId) || S.wheels[0];

/* ---------- the wheel ---------- */
function pt(r, deg) { const a = deg * Math.PI / 180; return [(r * Math.sin(a)).toFixed(3), (-r * Math.cos(a)).toFixed(3)]; }
function sectorLabel(s) {
    if (s.jackpot) return 'ДЖЕКПОТ';
    const r = s.rewards[0];
    if (!r) return '';
    const t = r.kind === 'BALL' ? num(r.amount) : r.kind === 'GRAM' ? num(r.amount) + ' GRAM' : String(r.title || '').slice(0, 10) + (r.count > 1 ? ' ×' + r.count : '');
    return t + (s.rewards.length > 1 ? ' +' : '');
}
function wheelSVG(w) {
    const defs = [], parts = [], pal = PALETTE[w.id] || PALETTE.classic;
    const grad = (id, c) => defs.push('<radialGradient id="' + id + '" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="' + c + '" stop-opacity=".55"/><stop offset=".45" stop-color="' + c + '"/><stop offset="1" stop-color="' + c + '"/></radialGradient>');
    pal.forEach((c, i) => grad('dmc' + i, c));
    grad('dmrare', '#ffc83a'); grad('dmepic', '#18b8d8'); grad('dmjack', '#ff9f1c');
    w.sectors.forEach((s, i) => {
        const a = pt(100, i * 30 - 15), b = pt(100, i * 30 + 15);
        const fill = s.jackpot ? 'dmjack' : s.tier === 'epic' ? 'dmepic' : s.tier === 'rare' ? 'dmrare' : 'dmc' + (i % 3);
        const img = s.jackpot ? A + 'diamond_big.webp' : (s.rewards[0] && s.rewards[0].image) || BALL;
        const size = s.jackpot ? 28 : 19;
        parts.push('<g class="dm-sec' + (s.jackpot ? ' is-jp' : '') + '" data-i="' + i + '"><path d="M0 0 L' + a[0] + ' ' + a[1] + ' A100 100 0 0 1 ' + b[0] + ' ' + b[1] + ' Z" fill="url(#' + fill + ')" stroke="#ffffff55" stroke-width=".7"/>' +
            '<g transform="rotate(' + i * 30 + ')"><image href="' + e(img) + '" x="' + (-size / 2) + '" y="' + (-52 - size / 2) + '" width="' + size + '" height="' + size + '"/>' +
            '<text y="-71" text-anchor="middle" font-size="' + (s.jackpot ? 6.6 : sectorLabel(s).length > 12 ? 5.2 : sectorLabel(s).length > 9 ? 6.2 : 7.6) + '" font-weight="900" fill="#fff" stroke="#14052e" stroke-width="2.2" paint-order="stroke" style="font-family:Inter,Arial,sans-serif">' + e(sectorLabel(s)) + '</text></g></g>');
    });
    return '<svg class="dm-wheel-svg" viewBox="-100 -100 200 200" aria-hidden="true"><defs>' + defs.join('') + '</defs><g id="dm-rot" style="transform:rotate(' + (rots[w.id] || 0) + 'deg)">' + parts.join('') + '</g></svg>';
}
function lamps() {
    return Array.from({length: 12}, (_, i) => { const a = i * 30 * Math.PI / 180; return '<img class="dm-lamp ' + (i % 2 ? 'b' : 'a') + '" src="' + u('lamp_on') + '" alt="" style="left:' + (50 + 39.5 * Math.sin(a)).toFixed(2) + '%;top:' + (50 - 39.5 * Math.cos(a)).toFixed(2) + '%">'; }).join('');
}
function jackpotBoard() {
    const last = S.wins.find(x => x.jackpot);
    return '<div class="dm-jp"><small class="dm-jp-l">ОБЩИЙ ДЖЕКПОТ</small><div class="dm-jp-box"><i class="sp s1"></i><i class="sp s2"></i><i class="sp s3"></i><i class="sp s4"></i><img src="' + u('jackpot_frame') + '" alt="" draggable="false"><b id="dm-pool" class="dm-jp-n">' + num(shownPool) + '</b></div>' +
        '<p class="dm-jp-last">' + (last ? 'Последний джекпот: ' + e(last.name) + ', ' + num(last.jackpot) : 'Джекпот растёт с каждой платной прокруткой и ставкой') + '</p></div>';
}
function wheelSelector() {
    return '<div class="dm-wsel">' + S.wheels.map(w => '<button type="button" class="dm-wcard ' + w.id + (w.id === wheelId ? ' on' : '') + (w.locked ? ' lock' : '') + '" data-wheel="' + w.id + '"><img src="' + u(WCHIP[w.id] || 'chip_cyan') + '" alt=""><b>' + e(w.title) + '</b><small>' +
        (w.locked ? 'с VIP «' + VIP[w.vip_min] + '»' : w.free_left > 0 ? 'бесплатно ' + w.free_left : 'от ' + num(w.price)) + '</small></button>').join('') + '</div>';
}
function wheelStage() {
    const w = W();
    const canFree = !w.locked && w.free_left > 0, canPaid = !w.locked && w.paid_left > 0 && S.balls >= w.price;
    const reset = clock(nextReset() - now());
    const note = w.locked ? 'Это колесо откроется с VIP-уровня «' + VIP[w.vip_min] + '». Крутите колёса попроще, чтобы набрать опыт.' :
        !canFree && !w.paid_left ? 'Прокрутки на этом колесе на сегодня закончились. Новые через <b data-cd>' + reset + '</b>.' : !canFree && w.free_total ? 'Бесплатные прокрутки закончились, новые через <b data-cd>' + reset + '</b>.' :
        w.pity_left <= 3 && w.paid_left ? 'Гарантированный приз через ' + w.pity_left + ' платн. прокруток.' : 'Результат определяет сервер, шансы ниже.';
    const win = lastWin && lastWin.wheel === w.id ? '<div class="dm-result ' + lastWin.tier + '"><small>' + (lastWin.jackpot ? 'ДЖЕКПОТ' : 'ВЫПАЛО') + '</small><div>' + chips(lastWin.rewards) + '</div></div>' : '';
    return '<div class="dm-theme-' + w.id + '"><div class="dm-wheel" id="dm-wheel">' + wheelSVG(w) + '<img class="dm-rim" src="' + u('rim') + '" alt="" draggable="false">' + lamps() + '<img class="dm-hubcap" src="' + u('hub') + '" alt="" draggable="false"><img class="dm-pointer" src="' + u('pointer') + '" alt="" draggable="false"><img class="dm-burst" id="dm-burst" alt="" draggable="false"></div></div>' +
        win + '<div class="dm-actions">' + (w.free_total ? '<button type="button" class="dm-btn" data-spin="free"' + (canFree && !busy ? '' : ' disabled') + '><span class="dm-t">Крутить бесплатно</span><small>осталось ' + w.free_left + ' из ' + w.free_total + '</small></button>' : '') +
        '<button type="button" class="dm-btn pink" data-spin="paid"' + (canPaid && !busy ? '' : ' disabled') + '><span class="dm-t">Крутить за ' + num(w.price) + ' <img src="' + BALL + '" alt=""></span><small>' + (w.paid_left ? 'сегодня ещё ' + w.paid_left + ', у вас ' + num(S.balls) : 'лимит на сегодня исчерпан') + '</small></button></div><p class="dm-note">' + note + '</p>';
}

/* ---------- the slots ---------- */
function reelHTML(sym) { return '<div class="dm-reel"><div class="dm-strip"><div class="dm-cell"><img src="' + SYM[sym] + '" alt="" draggable="false"></div></div></div>'; }
function slotStage() {
    const sl = S.slots;
    if (!sl.enabled) return '<p class="dm-note">Слоты сейчас закрыты.</p>';
    if (!bet || !sl.bets.includes(bet)) bet = sl.bets[Math.min(1, sl.bets.length - 1)];
    const ok = sl.spins_left > 0 && sl.bet_left >= bet && S.balls >= bet && !busy;
    const ln = lastSlot;
    return '<div class="dm-slot"><div class="dm-slot-top">' + Array.from({length: 9}, (_, i) => '<i class="' + (i % 2 ? 'b' : 'a') + '"></i>').join('') + '<b>VICE SLOTS</b>' + Array.from({length: 9}, (_, i) => '<i class="' + (i % 2 ? 'a' : 'b') + '"></i>').join('') + '</div>' +
        '<div class="dm-reels" id="dm-reels">' + reels.map(reelHTML).join('') + '<span class="dm-payline"></span></div>' +
        '<div class="dm-slotwin ' + (ln ? (ln.jackpot ? 'jp' : ln.win ? 'win' : 'lose') : '') + '" id="dm-slotwin">' + (ln ? (ln.jackpot ? 'ДЖЕКПОТ ' + num(ln.jackpot) : ln.win ? 'Выигрыш ' + num(ln.win) + ' (×' + ln.mult + ')' : 'В этот раз без выигрыша') : 'Выберите ставку и крутите') + '</div></div>' +
        '<div class="dm-bets">' + sl.bets.map(b => '<button type="button" class="dm-bet' + (b === bet ? ' on' : '') + '" data-bet="' + b + '">' + num(b) + '</button>').join('') + '</div>' +
        '<div class="dm-actions"><button type="button" class="dm-btn pink" data-slot' + (ok ? '' : ' disabled') + '><span class="dm-t">Крутить за ' + num(bet) + ' <img src="' + BALL + '" alt=""></span><small>осталось прокруток ' + sl.spins_left + ', у вас ' + num(S.balls) + '</small></button></div>' +
        '<p class="dm-note">' + (sl.spins_left <= 0 ? 'Прокрутки слотов на сегодня закончились. Новые через <b data-cd>' + clock(nextReset() - now()) + '</b>.' : sl.bet_left < bet ? 'Дневной лимит ставок почти исчерпан.' : 'Две одинаковые слева или три в ряд выигрывают. Три бриллианта это весь джекпот.') + '</p>';
}
function paytable() {
    const sl = S.slots;
    if (!sl.enabled) return '';
    return '<div class="dm-pay">' + sl.symbols.map(s => '<div class="dm-pr"><img src="' + SYM[s.id] + '" alt=""><span>' + (s.jackpot ? '<b>Три в ряд: весь джекпот</b>' : '<b>×' + s.pay3 + '</b> три в ряд, <b>×' + s.pay2 + '</b> две слева') + '</span><i>' + s.chance + '%</i></div>').join('') + '</div><p class="dm-note">Теоретическая отдача слотов: ' + sl.return.rtp + '%, выигрывает примерно каждая ' + Math.max(1, Math.round(100 / Math.max(0.1, sl.return.hit))) + '-я прокрутка.</p>';
}

/* ---------- panels ---------- */
function vipPanel() {
    const v = S.vip, span = v.next ? Math.min(100, Math.round(v.xp / v.next * 100)) : 100;
    const opens = S.wheels.filter(w => w.vip_min > 0);
    return '<section class="dm-sec-box"><div class="dm-vip-h"><img src="' + u('vip_' + (v.level + 1)) + '" alt=""><div><small>Ваш статус</small><b>' + VIP[v.level] + '</b></div></div>' +
        '<div class="dm-prog"><div class="dm-prog-h"><span>' + (v.next ? 'До уровня «' + VIP[v.level + 1] + '»' : 'Высший уровень') + '</span><span>' + (v.next ? num(v.xp) + ' / ' + num(v.next) : '') + '</span></div><div class="dm-meter"><i style="width:' + span + '%"></i></div></div>' +
        '<div class="dm-levels">' + v.levels.map((l, i) => '<div class="dm-lv' + (i === v.level ? ' on' : i < v.level ? ' done' : '') + '"><img src="' + u('vip_' + (i + 1)) + '" alt=""><b>' + VIP[i] + '</b><span>' + num(l.need) + ' оп.</span><span>' + l.free + ' беспл. в день</span>' + (l.discount ? '<span>скидка ' + l.discount + '%</span>' : '') + opens.filter(w => w.vip_min === i).map(w => '<span class="op">колесо «' + e(w.title) + '»</span>').join('') + '</div>').join('') + '</div></section>';
}
function oddsPanel() {
    const w = W();
    const body = tab === 'slots' ? paytable() : '<div class="dm-odds">' + w.sectors.map(s => '<div class="dm-od ' + s.tier + '"><span class="t">' + TIER[s.tier] + '</span><span class="r">' + (s.jackpot ? '<b>Весь джекпот</b>' + chips(s.rewards) : chips(s.rewards)) + '</span><b class="c">' + s.chance + '%</b></div>').join('') + '</div><p class="dm-note">Каждая ' + w.pity_every + '-я платная прокрутка этого колеса даёт редкий или эпический приз. Часть платных прокруток идёт в общий джекпот.</p>';
    return '<section class="dm-sec-box"><button type="button" class="dm-fold" data-odds>' + (tab === 'slots' ? 'Таблица выплат' : 'Шансы колеса «' + e(w.title) + '»') + ' <i>' + (odds ? '−' : '+') + '</i></button>' + (odds ? body : '') + '</section>';
}
function winsPanel() {
    const w = S.wins.map(x => '<div class="dm-win ' + x.tier + '"><span>' + e(x.name) + (x.where === 'slots' ? ' · слоты' : '') + '</span>' + (x.jackpot ? '<b class="jp">Джекпот ' + num(x.jackpot) + '</b>' : chips(x.rewards)) + '</div>').join('');
    const mine = S.mine.map(x => '<div class="dm-win ' + x.tier + '"><span>' + (x.mode === 'free' ? 'Бесплатно' : 'За ' + e(CURR.gen)) + '</span>' + chips(x.rewards) + '</div>').join('');
    return '<section class="dm-sec-box"><h3>Крупные выигрыши</h3>' + (w || '<p class="dm-note">Пока крупных выигрышей не было.</p>') + '</section><section class="dm-sec-box"><h3>Ваши последние прокрутки колёс</h3>' + (mine || '<p class="dm-note">Вы ещё не крутили колёса.</p>') + '</section>';
}
function top() {
    return '<header class="dm-top"><button type="button" class="dm-back" data-back>‹ События</button><div class="dm-chipsbar"><span class="dm-pill"><img src="' + BALL + '" alt=""><b>' + num(S.balls || 0) + '</b></span>' + (S.vip ? '<span class="dm-pill"><img src="' + u('vip_' + (S.vip.level + 1)) + '" alt=""><b>' + VIP[S.vip.level] + '</b></span>' : '') + '</div></header>';
}
function draw() {
    if (!S) return;
    if (!S.enabled && !S.admin) { root.innerHTML = top() + '<section class="dm-sec-box"><h3>Казино скоро откроется</h3><p class="dm-note">Следите за новостями раздела «События».</p></section>'; return; }
    if (!shownPool) shownPool = S.jackpot;
    const slotsOn = S.slots && S.slots.enabled;
    if (tab === 'slots' && !slotsOn) tab = 'wheels';
    root.innerHTML = '<img class="dm-bg" src="' + u('bg') + '" onerror="this.remove()" alt="">' + top() + '<section class="dm-hero"><picture><source media="(max-width:720px)" srcset="' + u('hero_mobile') + '"><img class="dm-hero-img" fetchpriority="high" decoding="async" src="' + u('hero_wide') + '" onerror="this.closest(\'picture\').remove()" alt="" draggable="false"></picture>' +
        '<div class="dm-hero-text"><h1>' + e(S.title) + '</h1><p>' + e(S.subtitle || '') + '</p>' + (!S.enabled ? '<span class="dm-off">Выключено: видно только вам</span>' : '') + '</div></section>' +
        '<nav class="dm-tabs"><button type="button" data-tab="wheels" class="' + (tab === 'wheels' ? 'on' : '') + '">Колёса фортуны</button>' + (slotsOn ? '<button type="button" data-tab="slots" class="' + (tab === 'slots' ? 'on' : '') + '">Слоты</button>' : '') + '</nav>' +
        '<section class="dm-stage"><img class="dm-host l" src="' + u('goshan_host') + '" alt="" draggable="false"><div class="dm-center">' + jackpotBoard() + (tab === 'wheels' ? wheelSelector() + wheelStage() : slotStage()) + '</div><img class="dm-host r" src="' + u('nikolay_host') + '" alt="" draggable="false"></section>' +
        '<div class="dm-grid">' + vipPanel() + oddsPanel() + '</div><div class="dm-grid">' + winsPanel() + '</div>';
}

/* ---------- the effects ---------- */
async function countTo(el, from, to, ms) {
    const t0 = performance.now();
    await new Promise(done => { const step = t => { const k = Math.min(1, (t - t0) / ms); el.textContent = num(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el.isConnected) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
}
function confetti(box, ms) {
    if (reduced()) return () => {};
    const cv = document.createElement('canvas');
    cv.className = 'dm-confetti';
    cv.width = box.clientWidth; cv.height = box.clientHeight;
    box.appendChild(cv);
    const ctx = cv.getContext('2d'), cols = ['#ff4fa8', '#27d3ff', '#ffc83a', '#8a45ff', '#ffffff', '#38e08a'];
    const ps = Array.from({length: 170}, () => ({x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.6, vx: Math.random() * 2 - 1, vy: 2 + Math.random() * 4, s: 5 + Math.random() * 7, r: Math.random() * 6, vr: Math.random() * .3 - .15, c: cols[Math.floor(Math.random() * cols.length)], k: Math.random() < .5}));
    let on = true;
    const t0 = performance.now();
    const loop = t => {
        if (!on || !cv.isConnected) return;
        ctx.clearRect(0, 0, cv.width, cv.height);
        const live = t - t0 < ms;
        ps.forEach(p => { p.x += p.vx + Math.sin(p.r) * .8; p.y += p.vy; p.r += p.vr; if (p.y > cv.height + 20 && live) { p.y = -20; p.x = Math.random() * cv.width; } ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; if (p.k) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); else { ctx.beginPath(); ctx.arc(0, 0, p.s / 3, 0, 6.3); ctx.fill(); } ctx.restore(); });
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { on = false; cv.remove(); };
}
/* the jackpot ceremony: rays, confetti, a big counting number */
function jackpotShow(amount) {
    return new Promise(done => {
        const ov = document.createElement('div');
        ov.className = 'dm-jpov';
        ov.innerHTML = '<img class="rays" src="' + u('jackpot_burst') + '" alt=""><div class="in"><img class="gem" src="' + u('diamond_big') + '" alt=""><h2>ДЖЕКПОТ!</h2><div class="amt"><b id="dm-jpnum">0</b> <img src="' + BALL + '" alt=""></div><p>Вы сорвали весь общий банк</p><button type="button" class="dm-btn">Забрать</button></div>';
        document.body.appendChild(ov);
        const stop = confetti(ov, 7000);
        countTo(ov.querySelector('#dm-jpnum'), 0, amount, reduced() ? 200 : 2600);
        ov.querySelector('button').addEventListener('click', () => { stop(); ov.remove(); done(); });
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
        Object.values(packs).forEach(p => plan.push({it: {kind: 'PACK', pack: {image: p.i.image, title: p.i.title}, image_url: p.i.image, bundle: p.ids.length}, result: {packIds: p.ids, count: p.ids.length, head: 'Казино Diamond', title: 'Вы выиграли: <b>' + e(p.i.title) + (p.ids.length > 1 ? ' ×' + num(p.ids.length) : '') + '</b>'}}));
        if (gram) plan.push({it: {kind: 'GRAM', image_url: '/static/assets/gram.svg', rarity: 'res'}, result: {head: 'Казино Diamond', title: 'Зачислено: ' + num(gram) + ' GRAM', text: 'Баланс уже обновлён.'}});
        if (balls) plan.push({it: {kind: 'BALL', image_url: BALL, rarity: 'res'}, result: {head: 'Казино Diamond', title: 'Выигрыш ' + CURR.gen + ': ' + num(balls), text: 'Баланс уже обновлён.'}});
        shown.forEach(i => plan.push({it: {kind: i.kind, image_url: i.image, rarity: 'res'}, result: {head: 'Казино Diamond', title: 'Вы выиграли: ' + e(i.title) + (i.count > 1 ? ' ×' + i.count : ''), text: i.kind === 'EMOJI' ? 'Значок уже в вашем профиле.' : 'Награда уже у вас.'}}));
        for (const step of plan) { try { await Promise.race([new Promise(done => F.reveal({it: step.it}, step.result, {refresh: done}, () => {})), new Promise(r => setTimeout(r, 60000))]); } catch (_) {} }
        document.querySelectorAll('.fm-reveal').forEach(x => x.remove());
    }
    if (g.drop_granted && window.crafterDrops) window.crafterDrops.afterPurchase(g.drop_granted, {refresh() {}});
}
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).slice(0, 60);
async function afterWin(res, oldPool) {
    S = res.state;
    shownPool = S.jackpot;
    draw();
    if (res.level_up) toast('Новый VIP-уровень: ' + VIP[S.vip.level] + '!');
    const pool = root.querySelector('#dm-pool');
    if (pool && oldPool !== S.jackpot) countTo(pool, oldPool, S.jackpot, 900);
}

/* ---------- a spin of the wheel ---------- */
async function spin(mode) {
    if (busy) return;
    busy = true;
    const w = W();
    root.querySelectorAll('[data-spin]').forEach(b => { b.disabled = true; });
    let res;
    try { res = await api('diamond/spin', {mode, wheel: w.id, request_id: rid()}); }
    catch (err) { toast(err.message); busy = false; await load(); return; }
    const g = root.querySelector('#dm-rot'), wheel = root.querySelector('#dm-wheel');
    const turn = 360 * (reduced() ? 1 : 6) + ((360 - res.sector * 30) % 360) + (Math.random() * 16 - 8);
    rots[w.id] = Math.ceil((rots[w.id] || 0) / 360) * 360 + turn;
    const ms = reduced() ? 400 : 5200;
    wheel.classList.add('is-spin');
    g.style.transition = 'transform ' + ms + 'ms cubic-bezier(.12,.62,.08,1)';
    g.style.transform = 'rotate(' + rots[w.id] + 'deg)';
    const oldPool = shownPool;
    await sleep(ms + 150);
    wheel.classList.remove('is-spin');
    const burst = root.querySelector('#dm-burst');
    if (burst && res.tier !== 'common') { burst.src = u(res.tier === 'jackpot' ? 'jackpot_burst' : 'win_burst'); burst.className = 'dm-burst on ' + res.tier; await sleep(reduced() ? 100 : 1300); burst.className = 'dm-burst'; }
    lastWin = {wheel: w.id, tier: res.tier, jackpot: res.jackpot, rewards: res.rewards};
    if (res.jackpot) await jackpotShow(res.jackpot);
    try { await showGiven(res); } catch (err) { toast(err.message); }
    busy = false;
    await afterWin(res, oldPool);
}

/* ---------- a spin of the slots ---------- */
function runReel(reel, final, ms) {
    const strip = reel.querySelector('.dm-strip'), size = reel.clientHeight;
    const ids = Object.keys(SYM);
    const cells = Array.from({length: 18}, () => ids[Math.floor(Math.random() * ids.length)]);
    cells.push(final);
    strip.innerHTML = cells.map(c => '<div class="dm-cell"><img src="' + SYM[c] + '" alt="" draggable="false"></div>').join('');
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    void strip.offsetHeight;
    strip.style.transition = 'transform ' + ms + 'ms cubic-bezier(.15,.7,.15,1)';
    strip.style.transform = 'translateY(' + (-(cells.length - 1) * size) + 'px)';
}
async function spinSlot() {
    if (busy) return;
    busy = true;
    root.querySelectorAll('[data-slot],[data-bet]').forEach(b => { b.disabled = true; });
    let res;
    try { res = await api('diamond/slots/spin', {bet, request_id: rid()}); }
    catch (err) { toast(err.message); busy = false; await load(); return; }
    const box = root.querySelector('#dm-reels'), rs = [...box.querySelectorAll('.dm-reel')];
    box.classList.remove('hit');
    const oldPool = shownPool;
    rs.forEach((r, i) => runReel(r, res.reels[i], reduced() ? 100 : 1300 + i * 450));
    await sleep(reduced() ? 200 : 1300 + 2 * 450 + 250);
    reels = res.reels;
    lastSlot = {win: res.win, jackpot: res.jackpot, mult: res.mult};
    const w = root.querySelector('#dm-slotwin');
    if (w) { w.className = 'dm-slotwin ' + (res.jackpot ? 'jp' : res.win ? 'win' : 'lose'); w.textContent = res.jackpot ? 'ДЖЕКПОТ ' + num(res.jackpot) : res.win ? 'Выигрыш ' + num(res.win) + ' (×' + res.mult + ')' : 'В этот раз без выигрыша'; }
    if (res.win || res.jackpot) box.classList.add('hit');
    if (res.jackpot) { await jackpotShow(res.jackpot); await sleep(100); }
    else if (res.win) await sleep(reduced() ? 50 : 700);
    busy = false;
    await afterWin(res, oldPool);
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
        const t = ev.target.closest('[data-tab]');
        if (t && !busy) { tab = t.dataset.tab; draw(); return; }
        const wc = ev.target.closest('[data-wheel]');
        if (wc && !busy) { wheelId = wc.dataset.wheel; draw(); return; }
        const s = ev.target.closest('[data-spin]');
        if (s && !s.disabled) { spin(s.dataset.spin); return; }
        const b = ev.target.closest('[data-bet]');
        if (b && !busy) { bet = Number(b.dataset.bet); draw(); return; }
        const sl = ev.target.closest('[data-slot]');
        if (sl && !sl.disabled) { spinSlot(); return; }
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
