/* Режим «Остров сокровищ»: страница игры (шаблон /island). Остров, исходы встреч, добычу и награды считает сервер, здесь только показ и выбор места. */
(function () {
'use strict';
const A = '/static/assets/island/';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) {} };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const CURR = (window.crafterCurrency || {name: 'Шары', gen: 'шаров'});
const BALL = '/static/assets/new-year-ornament.svg';
const u = p => A + p + '.webp';
const im = (p, cls) => '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + u(p) + '" alt="" draggable="false">';
const pad = n => String(Math.max(0, n)).padStart(2, '0');

const TYPE = {chest: ['Сундук', 'Добыча по глубине. Бывают мимики.'], trap: ['Ловушка', 'Отнимает жизнь, если не повезёт.'], merchant: ['Торговец', 'Жизнь, удача или реликвия за ' + CURR.gen + '.'],
    camp: ['Костёр', 'Лечит и добавляет удачи.'], riddle: ['Загадка', 'Три двери: награда, пусто или ловушка.'], event: ['Событие', 'История с выбором и разными исходами.'],
    elite: ['Страж', 'Сильный враг: риск, но двойная добыча.'], boss: ['Босс', 'Хозяин глубин. Его надо ударить три раза.']};
const SHEETS = {chest: {f: 'fx/chest_open_sheet', cols: 4, rows: 2, t: [140, 90, 80, 70, 100, 130, 80, 250]}, trap: {f: 'fx/trap_sheet', cols: 4, rows: 2, t: [140, 70, 60, 80, 100, 100, 90, 220]},
    heart: {f: 'fx/heart_break_sheet', cols: 4, rows: 1, t: [140, 100, 100, 220]}};
const FR = {common: 'relics/frame_common', rare: 'relics/frame_rare', epic: 'relics/frame_epic'};
const RARITY = {common: 'Обычная', rare: 'Редкая', epic: 'Эпическая'};
const XS = {1: [52], 2: [36, 66], 3: [28, 52, 76]};
const nx = n => XS[n.of][n.col], ny = n => n.row === 8 ? 19 : 82 - (n.row - 1) * 8.6;
const START = {x: 40, y: 92}, FIN = {x: 52, y: 7};

let H = null, tab = 'play', L = null, root = null, busy = false, off = 0, lastBoat = null, tick = 0;
const now = () => Math.floor(Date.now() / 1000) + off;

const rw = r => '<span class="is-rw"><img src="' + e(r.image || BALL) + '" alt=""><b>' + e(r.title) + (r.count > 1 && r.kind !== 'BALL' ? ' ×' + r.count : '') + '</b></span>';
const rwLine = (r, cls) => '<div class="is-line ' + (cls || 'good') + '"><img src="' + e(r.image || BALL) + '" alt="">' + e(r.title) + (r.count > 1 && r.kind !== 'BALL' ? ' ×' + r.count : '') + '</div>';

/* ---------- sprites ---------- */
function spriteHTML(key) {
    const s = SHEETS[key];
    return '<div class="is-spr" data-spr="' + key + '" style="background-image:url(' + u(s.f) + ');background-size:' + s.cols * 100 + '% ' + s.rows * 100 + '%;background-position:' + pos(s, 0) + '"></div>';
}
function pos(s, i) { const c = i % s.cols, r = Math.floor(i / s.cols); return (s.cols > 1 ? c / (s.cols - 1) * 100 : 0) + '% ' + (s.rows > 1 ? r / (s.rows - 1) * 100 : 0) + '%'; }
async function playSprites(box) {
    for (const el of box.querySelectorAll('[data-spr]')) {
        const s = SHEETS[el.dataset.spr];
        (async () => {
            for (let i = 0; i < s.t.length && el.isConnected; i++) { el.style.backgroundPosition = pos(s, i); await sleep(reduced() ? 10 : s.t[i]); }
        })();
    }
}

/* ---------- windows ---------- */
function overlay(html, wide) {
    const ov = document.createElement('div');
    ov.className = 'is-ov';
    ov.innerHTML = '<div class="is-card' + (wide ? ' wide' : '') + '">' + html + '</div>';
    document.body.appendChild(ov);
    playSprites(ov);
    return ov;
}
function scene(o) {
    return new Promise(done => {
        const btns = (o.buttons || [{id: 'ok', label: 'Дальше'}]).map(b => '<button type="button" class="is-btn ' + (b.cls || '') + '" data-act="' + e(b.id) + '"' + (b.off ? ' disabled' : '') + '>' + e(b.label) + '</button>').join(' ');
        const ov = overlay((o.art ? '<div class="is-art' + (o.small ? ' sm' : '') + '">' + o.art + '</div>' : '') + '<h3>' + e(o.title || '') + '</h3>' + (o.text ? '<p>' + e(o.text) + '</p>' : '') + (o.body || '') +
            '<div class="is-lines">' + (o.lines || []).join('') + '</div><div>' + btns + '</div>', o.wide);
        if (o.shake) ov.querySelector('.is-card').classList.add('is-shake');
        ov.addEventListener('click', ev => { const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return; ov.remove(); done(b.dataset.act); });
        if (o.pick) o.pick(ov, v => { ov.remove(); done(v); });
    });
}
function linesOf(log) {
    const out = [];
    for (const l of log || []) {
        if (l.t === 'loot') l.items.forEach(it => out.push(rwLine(it)));
        else if (l.t === 'life') out.push('<div class="is-line ' + (l.v < 0 ? 'bad' : 'good') + '">' + im(l.v < 0 ? 'ui/heart_empty' : 'ui/heart_full') + (l.v < 0 ? 'Потеряна жизнь' : l.v ? '+' + l.v + ' жизнь' : 'Жизни полные') + '</div>');
        else if (l.t === 'luck') out.push('<div class="is-line ' + (l.v < 0 ? 'bad' : 'good') + '">' + im('ui/luck_clover') + 'Удача ' + (l.v > 0 ? '+' : '') + l.v + '</div>');
        else if (l.t === 'save') out.push('<div class="is-line good">' + im('icons/i_relic') + e(l.text) + '</div>');
    }
    return out;
}
const lostLife = log => (log || []).some(l => l.t === 'life' && l.v < 0);

/* ---------- the hub ---------- */
function hero() {
    return '<header class="is-top"><button type="button" class="is-back" data-back>‹ События</button><div class="is-chips"><span class="is-chip">' + im('ui/ticket') + '<b>' + H.tickets + '</b></span><span class="is-chip"><img src="' + BALL + '" alt=""><b>' + num(H.balls) + '</b></span></div></header>' +
        '<section class="is-hero"><picture><source media="(max-width:720px)" srcset="' + u('key_art/banner_mobile') + '"><img src="' + u('key_art/banner_wide') + '" alt="" draggable="false"></picture>' +
        '<div class="is-hero-text"><h1>' + e(H.title) + '</h1><p>' + e(H.subtitle || '') + '</p></div></section>';
}
function playPanel() {
    const can = H.enabled && H.tickets > 0;
    const next = H.tickets < H.ticket_max ? '<span>Следующий бесплатный через <b data-cd>' + clock(H.next_free - now()) + '</b></span>' : '<span>Билеты накоплены полностью</span>';
    const lv = H.xp_next ? '<div class="is-lvl"><div class="is-lvl-h"><span>Исследователь, уровень ' + H.level + '</span><span>' + num(H.xp) + ' / ' + num(H.xp_next) + '</span></div><div class="is-bar"><i style="width:' + Math.min(100, Math.round(H.xp / H.xp_next * 100)) + '%"></i></div></div>' :
        '<div class="is-lvl"><div class="is-lvl-h"><span>Исследователь, максимальный уровень</span></div></div>';
    return '<section class="is-panel"><div class="is-play"><div><div class="is-tk">' + im('ui/ticket') + '<div><b>Билетов: ' + H.tickets + ' из ' + H.ticket_max + '</b>' + next + '</div></div>' + lv +
        '<div class="is-lvl-h" style="margin-top:10px"><span>Лучшая глубина: ' + H.best_depth + ' из 8</span><span>Побед над боссом: ' + H.wins + '</span></div></div>' +
        '<div class="is-cta">' + (!H.enabled ? '<span class="is-chip">' + (H.admin ? 'Выключено: видно только вам' : 'Скоро открытие') + '</span>' : '') +
        '<button type="button" class="is-btn" data-start' + (can ? '' : ' disabled') + '>В экспедицию</button>' +
        (H.enabled && H.tickets < H.buy_max ? '<button type="button" class="is-btn teal sm" data-buy>Билет · ' + num(H.ticket_price) + ' ' + e(CURR.gen) + '</button>' : '') + '</div></div></section>';
}
function rulesTab() {
    const rules = ['chest', 'trap', 'merchant', 'camp', 'riddle', 'event', 'elite', 'boss'].map(t => '<div class="is-rule">' + im('icons/i_' + (t === 'camp' ? 'camp' : t)) + '<div><b>' + TYPE[t][0] + '</b><span>' + TYPE[t][1] + '</span></div></div>').join('');
    return '<section class="is-panel"><h2 class="is-h2">Как играть</h2><p style="margin:0 0 12px;font-size:14px;line-height:1.5;opacity:.92">Остров каждый раз новый. Выбирайте путь снизу вверх: у вас ' + H.rules.lives + ' жизни, удача и рюкзак с добычей. После каждого места можно уйти с добычей или идти дальше за большим. ' +
        'Если жизни кончатся, вы потеряете ' + H.rules.death_loss + '% добычи. Реликвии остаются с вами навсегда.</p><div class="is-rules">' + rules + '</div></section>' +
        '<section class="is-panel"><h2 class="is-h2">Награда за босса</h2><div class="is-chipline">' + (H.boss_rewards.length ? H.boss_rewards.map(rw).join('') : 'Пока не назначена') + '</div></section>';
}
function relicsTab() {
    const have = H.relics.filter(r => r.owned).length;
    return '<section class="is-panel"><h2 class="is-h2">Реликвии ' + have + ' из ' + H.relics.length + '</h2><div class="is-slots">В экспедицию берутся реликвии из слотов: ' + H.equipped.length + ' из ' + H.slots + '. Слоты растут с уровнем исследователя. Нажмите на найденную реликвию, чтобы надеть или снять.</div><div class="is-relics">' +
        H.relics.map(r => '<button type="button" class="is-rel' + (H.equipped.includes(r.id) ? ' on' : '') + (r.owned ? '' : ' lock') + '" data-relic="' + r.id + '"><div class="pic"><img class="it" src="' + e(r.image) + '" alt="">' + im(FR[r.rarity], 'fr') + (r.owned ? '' : im('icons/i_lock', 'lk')) + '</div>' +
            '<span class="rar rar-' + r.rarity + '">' + RARITY[r.rarity] + '</span><b>' + e(r.owned ? r.title : '???') + '</b><span>' + e(r.owned ? r.text : 'Ещё не найдена') + '</span></button>').join('') + '</div></section>';
}
function leadersTab() {
    if (!L) return '<section class="is-panel"><div class="is-boot">Загрузка…</div></section>';
    const medal = i => i === 0 ? im('ui/medal_gold') : i === 1 ? im('ui/medal_silver') : i === 2 ? im('ui/medal_bronze') : '<b>' + (i + 1) + '</b>';
    const prizes = Object.keys(L.prizes).map(k => '<div><b>' + k + ' место</b>' + (L.prizes[k].length ? L.prizes[k].map(rw).join('') : '<span style="opacity:.7">нет приза</span>') + '</div>').join('');
    return '<section class="is-panel"><h2 class="is-h2">Капитаны недели <small style="opacity:.7;font-weight:700"> · до конца ' + clock(L.ends - now(), true) + '</small></h2><div class="is-prz">' + prizes + '</div><div class="is-lead">' +
        (L.leaders.length ? L.leaders.map((l, i) => '<div class="is-ld' + (L.me && L.me.rank === l.rank ? ' me' : '') + '"><span class="rk">' + medal(i) + '</span><span class="nm">' + (l.photo ? '<img class="av" src="' + e(l.photo) + '" alt="">' : '<img class="av" src="' + u('characters/goshan_explore') + '" alt="">') + '<b>' + e(l.name) + '</b></span><span class="sc">' + num(l.score) + '<small>глубина ' + l.depth + '</small></span></div>').join('') : '<p style="opacity:.8">На этой неделе ещё никто не вернулся с острова.</p>') +
        '</div>' + (L.me ? '<p style="margin:12px 0 0;font-weight:800">Ваше место: ' + L.me.rank + ', очки: ' + num(L.me.score) + '</p>' : '') + '</section>';
}
function clock(s, days) {
    s = Math.max(0, Math.floor(s));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return days && d ? d + ' дн. ' + h + ' ч.' : pad(h + d * 24) + ':' + pad(m) + ':' + pad(x);
}
function drawHub() {
    root.innerHTML = hero() + '<div class="is-cols"><div class="is-colL">' + playPanel() + '</div><div class="is-colR"><nav class="is-tabs">' + [['play', 'Экспедиция'], ['relics', 'Реликвии'], ['leaders', 'Капитаны']].map(t => '<button type="button" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</nav>' +
        (tab === 'play' ? rulesTab() : tab === 'relics' ? relicsTab() : leadersTab()) + '</div></div>';
}

/* ---------- the run ---------- */
function mapSVG(run) {
    const by = Object.fromEntries(run.nodes.map(n => [n.id, n]));
    const P = n => [nx(n), ny(n) * 16 / 9];
    const paths = [];
    const cur = by[run.pos];
    const open = new Set(run.nodes.filter(n => n.state === 'open').map(n => n.id));
    const curve = (a, b) => { const my = (a[1] + b[1]) / 2; return 'M' + a[0] + ' ' + a[1] + ' C' + a[0] + ' ' + my + ' ' + b[0] + ' ' + my + ' ' + b[0] + ' ' + b[1]; };
    const st = [START.x, START.y * 16 / 9];
    run.nodes.filter(n => n.row === 1).forEach(n => paths.push([curve(st, P(n)), !cur && open.has(n.id) ? 'lit' : n.state === 'done' ? 'done' : '']));
    run.nodes.forEach(n => n.next.forEach(id => { const t = by[id]; const cls = n.state === 'done' && t.state === 'done' ? 'done' : (cur && cur.id === n.id && open.has(id)) ? 'lit' : ''; paths.push([curve(P(n), P(t)), cls]); }));
    const boss = run.nodes.find(n => n.type === 'boss');
    paths.push([curve(P(boss), [FIN.x, FIN.y * 16 / 9]), boss.state === 'done' ? 'done' : '']);
    return '<svg viewBox="0 0 100 177.78" preserveAspectRatio="none">' + paths.map(p => '<path class="' + p[1] + '" d="' + p[0] + '"/>').join('') + '</svg>';
}
function sidePanels(run, curRow) {
    const hearts = Array.from({length: run.max_lives}, (_, i) => im(i < run.lives ? 'ui/heart_full' : 'ui/heart_empty')).join('');
    const relics = run.relics.length ? run.relics.map(r => '<span class="is-mini" title="' + e(r.title + ': ' + r.text) + '"><img class="it" src="' + e(r.image) + '" alt="">' + im(FR[r.rarity], 'fr') + '</span>').join('') : '<span class="is-none">Реликвий нет: они находятся в экспедициях и надеваются на главной странице.</span>';
    const bag = run.bag.length ? run.bag.map(r => rw(r)).join('') : '<span class="is-none">Пока пусто. Откройте сундук!</span>';
    const legend = ['chest', 'trap', 'merchant', 'camp', 'riddle', 'event', 'elite', 'boss'].map(t => '<div class="is-lg">' + im('icons/i_' + t) + '<span><b>' + TYPE[t][0] + '</b>' + TYPE[t][1] + '</span></div>').join('');
    return '<aside class="is-side is-l"><button type="button" class="is-back" data-back>‹ Выйти</button>' +
        '<div class="is-sc is-who"><img class="ch" src="' + u('characters/goshan_explore') + '" alt=""><div><small>Экспедиция</small><b>Уровень ' + Math.min(8, curRow + 1) + ' из 8</b><span>Идите вверх: выберите светящееся место.</span></div></div>' +
        '<div class="is-sc"><h4>Жизни <b>' + run.lives + ' из ' + run.max_lives + '</b></h4><div class="is-hearts big">' + hearts + '</div></div>' +
        '<div class="is-sc"><h4>Удача <b>' + run.luck + '%</b></h4><div class="is-bar lucky"><i style="width:' + run.luck + '%"></i></div><small>Удача улучшает добычу и спасает от ловушек.</small></div>' +
        '<div class="is-sc"><h4>Реликвии</h4><div class="is-minis">' + relics + '</div></div></aside>' +
        '<aside class="is-side is-r"><div class="is-sc"><h4>Рюкзак <b>' + (run.bag_value ? num(run.bag_value) + ' ' + e(CURR.gen) : '') + '</b></h4><div class="is-chipline col">' + bag + '</div>' +
        (run.bag.length ? '<small>Если жизни кончатся, вы потеряете около ' + run.death_loss + '% добычи.</small>' : '') + '</div>' +
        '<button type="button" class="is-btn big" data-cashout' + (run.can_cashout ? '' : ' disabled') + '>Забрать добычу</button>' +
        '<div class="is-sc"><h4>Что где</h4><div class="is-legend">' + legend + '</div></div></aside>';
}
function drawRun() {
    const run = H.run;
    const by = Object.fromEntries(run.nodes.map(n => [n.id, n]));
    const cur = by[run.pos];
    const spot = cur ? {x: nx(cur), y: ny(cur)} : START;
    const nodes = run.nodes.map(n => '<button type="button" class="is-node ' + n.state + (n.type === 'boss' ? ' big' : '') + '" data-node="' + n.id + '" style="left:' + nx(n) + '%;top:' + ny(n) + '%"' + (n.state === 'open' ? '' : ' tabindex="-1"') + ' aria-label="' + TYPE[n.type][0] + '">' +
        im('nodes/' + n.type + '_' + (n.state === 'done' ? 'done' : 'open'), 'n') + (n.state !== 'done' ? '<span class="lb">' + TYPE[n.type][0] + '</span>' : '') + '</button>').join('');
    const curRow = cur ? cur.row : 0;
    const rows = Array.from({length: 8}, (_, i) => '<span class="is-rn' + (i === 7 ? ' boss' : '') + (i === curRow ? ' cur' : '') + '" style="top:' + (i === 7 ? 19 : 82 - i * 8.6) + '%">' + (i === 7 ? 'Босс' : i + 1) + '</span>').join('');
    const hearts = Array.from({length: run.max_lives}, (_, i) => im(i < run.lives ? 'ui/heart_full' : 'ui/heart_empty')).join('');
    const from = lastBoat || spot;
    root.innerHTML = '<div class="is-run"><div class="is-hud"><div class="is-hearts">' + hearts + '</div><span class="is-depth">Уровень ' + Math.min(8, curRow + 1) + ' из 8</span><div class="is-luck">' + im('ui/luck_bar_frame', 'fr') + '<div class="fill"><i style="width:' + run.luck + '%"></i></div>' + im('ui/luck_clover', 'cl') + '</div>' +
        '<button type="button" class="is-bagbtn" data-bag aria-label="Рюкзак">' + im('ui/backpack_icon') + '<b>' + (run.bag.length ? num(run.bag_value) || run.bag.length : 0) + '</b></button><button type="button" class="is-exit" data-back>Выйти</button></div>' +
        sidePanels(run, curRow) +
        '<div class="is-scroll"><div class="is-canvas" id="is-canvas">' + mapSVG(run) + rows + '<img class="is-compass" src="' + u('map/compass') + '" alt="" draggable="false"><img class="is-clouds" src="' + u('map/clouds') + '" alt="" draggable="false">' +
        '<div class="is-node done start" style="left:' + START.x + '%;top:' + START.y + '%;pointer-events:none">' + im('nodes/start_open', 'n') + '</div>' +
        '<div class="is-node ' + (run.status === 'won' ? 'done' : 'locked') + ' big" style="left:' + FIN.x + '%;top:' + FIN.y + '%;pointer-events:none">' + im('nodes/finish_open', 'n') + '</div>' + nodes +
        '<div class="is-boat" id="is-boat" style="left:' + from.x + '%;top:' + from.y + '%">' + im('map/boat') + '</div></div></div>' +
        '<div class="is-dock"><p>Идите вверх по острову: выберите светящееся место. Рюкзак: ' + (run.bag.length ? num(run.bag_value) + ' ' + e(CURR.gen) + (run.bag.some(i => i.kind !== 'BALL') ? ' и другое' : '') : 'пока пусто') + '.</p>' +
        '<button type="button" class="is-btn" data-cashout' + (run.can_cashout ? '' : ' disabled') + '>Забрать добычу</button></div></div>';
    const boat = root.querySelector('#is-boat');
    lastBoat = spot;
    if (from !== spot) { requestAnimationFrame(() => requestAnimationFrame(() => { boat.style.left = spot.x + '%'; boat.style.top = spot.y + '%'; })); }
    const sc = root.querySelector('.is-scroll'), cv = root.querySelector('#is-canvas');
    sc.style.scrollBehavior = 'auto';
    sc.scrollTop = Math.max(0, spot.y / 100 * cv.offsetHeight - sc.clientHeight * 0.62);
    sc.style.scrollBehavior = '';
}
async function moveBoat(id) {
    const boat = root.querySelector('#is-boat'), el = root.querySelector('[data-node="' + id + '"]');
    if (!boat || !el) return;
    boat.style.left = el.style.left; boat.style.top = el.style.top;
    lastBoat = {x: parseFloat(el.style.left), y: parseFloat(el.style.top)};
    const sc = root.querySelector('.is-scroll'), cv = root.querySelector('#is-canvas');
    sc.scrollTo({top: Math.max(0, lastBoat.y / 100 * cv.offsetHeight - sc.clientHeight * 0.62)});
    await sleep(reduced() ? 50 : 950);
}

/* ---------- meetings ---------- */
function encounter(p) {
    const base = {title: p.title, text: p.text, wide: true};
    if (p.type === 'riddle') {
        return scene({...base, art: im('icons/i_riddle', 'big'), small: true, buttons: [], body: '<div class="is-doors">' + [0, 1, 2].map(i => '<button type="button" class="is-door' + (p.revealed === i ? ' warn' : '') + '" data-door="' + i + '">' + (i + 1) + '</button>').join('') + '</div>' + (p.revealed != null ? '<p>Фонарь подсвечивает опасную дверь.</p>' : ''),
            pick: (ov, fin) => ov.querySelectorAll('[data-door]').forEach(b => b.addEventListener('click', () => fin(Number(b.dataset.door))))});
    }
    if (p.type === 'merchant') {
        return scene({...base, art: im('icons/i_merchant', 'big'), small: true, buttons: [{id: 'leave', label: 'Уйти', cls: 'teal sm'}],
            body: '<div class="is-offers">' + p.offers.map(o => '<button type="button" class="is-offer" data-offer="' + o.id + '"' + (H.balls < o.price ? ' disabled' : '') + '>' + im(o.image) + '<span><b>' + e(o.title) + '</b><small>' + e(o.text) + '</small></span><span class="pr"><img src="' + BALL + '" alt="">' + num(o.price) + '</span></button>').join('') + '</div><p style="font-size:12px">У вас: ' + num(H.balls) + ' ' + e(CURR.gen) + '</p>',
            pick: (ov, fin) => ov.querySelectorAll('[data-offer]').forEach(b => b.addEventListener('click', () => fin(b.dataset.offer)))}).then(v => v);
    }
    if (p.type === 'event') {
        return scene({...base, art: im(p.image, 'big'), small: true, buttons: [], body: '<div class="is-opts">' + p.options.map((o, i) => '<button type="button" class="is-btn sm ' + (i ? 'teal' : '') + '" data-opt="' + i + '">' + e(o) + '</button>').join('') + '</div>',
            pick: (ov, fin) => ov.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => fin(Number(b.dataset.opt))))});
    }
    return scene({...base, art: im('boss/boss_' + (p.hp < p.max_hp ? 'angry' : 'idle'), 'big'), body: '<div class="is-bossbar">' + Array.from({length: p.max_hp}, (_, i) => im('ui/heart_full', i < p.hp ? '' : 'off')).join('') + '</div><p>Жизней у вас: ' + H.run.lives + '. Попадите три раза.</p>',
        buttons: [{id: 'hit', label: 'Атаковать', cls: 'red'}]});
}
async function showResult(r, p) {
    const lines = linesOf(r.log);
    const heart = lostLife(r.log) ? '<div class="fx is-spr" data-spr="heart" style="background-image:url(' + u('fx/heart_break_sheet') + ');background-size:400% 100%;background-position:0 0"></div>' : '';
    let o = null;
    const sheet = k => spriteHTML(k) + heart;
    switch (r.type) {
        case 'chest': o = r.mimic ? {title: 'Мимик!', text: 'Сундук оказался живым и укусил вас.', art: im('boss/mimic', 'big') + heart, shake: true} : {title: 'Сундук открыт!', art: sheet('chest')}; break;
        case 'trap': o = r.saved ? {title: 'Ловушка обойдена', text: r.saved === 'shield' ? 'Ракушка-щит приняла удар.' : 'Удача спасла вас.', art: spriteHTML('trap')} : {title: 'Ловушка!', text: 'Шипы выскочили из земли.', art: sheet('trap'), shake: true}; break;
        case 'camp': o = {title: 'Привал', text: r.healed ? 'Вы отдохнули и залечили раны.' : 'Жизни полные, но на душе спокойнее.', art: im('nodes/camp_open', 'big')}; break;
        case 'elite': o = r.won ? {title: 'Страж повержен!', text: 'Шанс на победу был ' + r.chance + '%.', art: im('boss/elite_hit', 'big')} : {title: 'Страж оказался сильнее', text: 'Шанс на победу был ' + r.chance + '%.', art: im('boss/elite_idle', 'big') + heart, shake: true}; break;
        case 'riddle': o = r.what === 'loot' ? {title: 'Награда за дверью!', art: im('loot/chest_small', 'big')} : r.what === 'trap' ? {title: 'Ловушка за дверью', art: sheet('trap'), shake: true} : {title: 'Здесь пусто', text: 'Иногда за дверью только эхо.', art: im('icons/i_riddle', 'big')}; break;
        case 'event': o = {title: (p && p.title) || 'Событие', text: r.msg, art: im((p && p.image) || 'icons/i_event', 'big')}; break;
        case 'merchant': if (r.left) return; o = {title: 'Сделка', art: im('icons/i_merchant', 'big')}; break;
        case 'boss': o = r.defeated ? {title: 'Босс повержен!', text: 'Хозяин глубин сдался.', art: im('boss/boss_defeated', 'big')} : r.hit ? {title: 'Удар!', text: 'Шанс был ' + r.chance + '%.', art: im('boss/boss_hit', 'big')} : {title: 'Промах!', text: 'Шанс был ' + r.chance + '%.', art: im('boss/boss_angry', 'big') + heart, shake: true}; break;
    }
    if (o && (o.text || o.title || lines.length)) await scene({...o, small: true, lines});
    for (const l of r.log || []) if (l.t === 'relic') await relicScene(l.relic);
}
function relicScene(rel) {
    return scene({title: 'Новая реликвия!', text: rel.title + ': ' + rel.text, body: '<div class="is-relic-pop"><img class="it" src="' + e(rel.image) + '" alt="">' + im(FR[rel.rarity]) + '</div>', buttons: [{id: 'ok', label: 'Отлично'}]});
}

/* ---------- the end ---------- */
async function showGiven(g) {
    g = g || {};
    if (g.chest_opens && window.crafterChests) await window.crafterChests.playMany(g.chest_opens, {bg: 'cozy', toast, refresh() {}});
    const items = g.items || [], F = window.crafterFestive;
    if (items.length && F) {
        const packs = {}, shown = [];
        let balls = 0, gram = 0;
        items.forEach(i => {
            if (i.kind === 'BALL') balls += Number(i.amount) || 0;
            else if (i.kind === 'GRAM') gram += Number(i.amount) || 0;
            else if (i.kind === 'PACK' && (i.pack_ids || []).length) { (packs[i.amount] = packs[i.amount] || {i, ids: []}).ids.push(...i.pack_ids); }
            else shown.push(i);
        });
        const plan = [];
        Object.values(packs).forEach(p => plan.push({it: {kind: 'PACK', pack: {image: p.i.image, title: p.i.title}, image_url: p.i.image, bundle: p.ids.length}, result: {packIds: p.ids, count: p.ids.length, head: 'Добыча экспедиции', title: 'Вы получили: <b>' + e(p.i.title) + (p.ids.length > 1 ? ' ×' + num(p.ids.length) : '') + '</b>'}}));
        if (gram) plan.push({it: {kind: 'GRAM', image_url: '/static/assets/gram.svg', rarity: 'res'}, result: {head: 'Добыча экспедиции', title: 'Зачислено: ' + num(gram) + ' GRAM', text: 'Баланс уже обновлён.'}});
        if (balls) plan.push({it: {kind: 'BALL', image_url: BALL, rarity: 'res'}, result: {head: 'Добыча экспедиции', title: 'Зачислено ' + CURR.gen + ': ' + num(balls), text: 'Баланс уже обновлён.'}});
        shown.forEach(i => plan.push({it: {kind: i.kind, image_url: i.image, rarity: 'res'}, result: {head: 'Добыча экспедиции', title: 'Получено: ' + e(i.title) + (i.count > 1 ? ' ×' + i.count : ''), text: 'Награда уже у вас.'}}));
        for (const step of plan) await new Promise(done => { F.reveal({it: step.it}, step.result, {refresh: done}, () => {}); });
    }
    if (g.drop_granted && window.crafterDrops) window.crafterDrops.afterPurchase(g.drop_granted, {refresh() {}});
}
async function ending(end) {
    const won = end.status === 'won', dead = end.status === 'dead';
    const who = Math.random() < 0.5 ? 'goshan' : 'nikolay';
    await scene({title: won ? 'Клад ваш!' : dead ? 'Экспедиция сорвалась' : 'Вы вовремя ушли с добычей', text: won ? 'Хозяин глубин повержен, остров покорён.' : dead ? 'Жизни кончились, часть добычи потеряна.' : 'Мудрое решение: добыча с вами.',
        art: '<img class="is-end-char" src="' + u('characters/' + who + '_' + (dead ? 'worried' : 'cheer')) + '" alt="" style="width:auto;height:100%;margin:0">',
        body: '<div class="is-score"><div>' + end.score + '<small>очки недели</small></div><div>+' + end.xp + '<small>опыт</small></div></div>', lines: end.kept.length ? end.kept.map(r => rwLine(r)) : ['<div class="is-line bad">Добыча потеряна</div>'], buttons: [{id: 'ok', label: 'Забрать'}]});
    try { await Promise.race([showGiven(end.given), sleep(90000)]); } catch (err) { toast(err.message); }
    document.querySelectorAll('.fm-reveal').forEach(x => x.remove());
    lastBoat = null;
    await load();
}

/* ---------- actions ---------- */
async function load() {
    try { H = await api('island'); off = H.now - Math.floor(Date.now() / 1000); } catch (err) { root.innerHTML = '<div class="is-boot">' + e(err.message) + '</div>'; return; }
    draw();
    if (H.run && H.run.pending && !busy) {                // the page was closed in the middle of a meeting: it goes on
        busy = true;
        try { await interact(); } catch (err) { toast(err.message); await load(); } finally { busy = false; }
    }
}
function draw() {
    if (!root) return;
    document.querySelectorAll('.is-ov').forEach(x => x.remove());
    if (H.run) drawRun(); else drawHub();
    document.body.style.overflow = H.run ? 'hidden' : '';
}
async function interact() {
    while (H.run && H.run.pending) {
        const p = H.run.pending;
        const choice = await encounter(p);
        const res = await api('island/choose', {choice});
        H = res.state;
        await showResult(res.result, p);
        if (res.end) { await ending(res.end); return; }
    }
    lastBoat = H.run ? lastBoat : null;
    draw();
}
async function onNode(id) {
    if (busy) return;
    busy = true;
    try {
        const res = await api('island/step', {node: id});
        H = res.state;
        await moveBoat(id);
        if (res.result.pending && H.run && H.run.pending) await interact();
        else { await showResult(res.result); if (res.end) await ending(res.end); else draw(); }
    } catch (err) { toast(err.message); await load(); } finally { busy = false; }
}
async function cashout() {
    const run = H.run;
    const pick = await scene({title: 'Забрать добычу?', text: 'Экспедиция закончится, а всё из рюкзака достанется вам.', lines: run.bag.map(r => rwLine(r)), buttons: [{id: 'yes', label: 'Забрать', cls: ''}, {id: 'no', label: 'Идти дальше', cls: 'teal sm'}]});
    if (pick !== 'yes') return;
    busy = true;
    try { const res = await api('island/cashout', {}); H = res.state; await ending(res.end); } catch (err) { toast(err.message); await load(); } finally { busy = false; }
}
async function openBag() {
    const run = H.run;
    await scene({title: 'Рюкзак', text: run.bag.length ? 'При гибели вы потеряете около ' + run.death_loss + '% добычи.' : 'Пока пусто. Найдите сундук!', art: im('ui/backpack_icon', 'big'), small: true, lines: run.bag.map(r => rwLine(r)), buttons: [{id: 'ok', label: 'Закрыть', cls: 'teal sm'}]});
}
async function start() {
    busy = true;
    try { H = await api('island/start', {}); lastBoat = null; draw(); } catch (err) { toast(err.message); await load(); } finally { busy = false; }
}
async function buy() {
    try { H = await api('island/ticket', {}); draw(); toast('Билет куплен'); } catch (err) { toast(err.message); }
}
async function equip(id) {
    const r = H.relics.find(x => x.id === id);
    if (!r || !r.owned) { toast('Эту реликвию ещё не нашли'); return; }
    const ids = H.equipped.includes(id) ? H.equipped.filter(x => x !== id) : [...H.equipped, id];
    try { H = await api('island/equip', {ids}); draw(); } catch (err) { toast(err.message); }
}
async function loadLeaders() { try { L = await api('island/leaders'); if (tab === 'leaders' && !H.run) draw(); } catch (err) { toast(err.message); } }
function bind() {
    root.addEventListener('click', ev => {
        if (ev.target.closest('[data-back]')) { location.assign('/season'); return; }
        const t = ev.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; draw(); if (tab === 'leaders') loadLeaders(); return; }
        if (ev.target.closest('[data-start]')) { start(); return; }
        if (ev.target.closest('[data-buy]')) { buy(); return; }
        const rl = ev.target.closest('[data-relic]');
        if (rl) { equip(rl.dataset.relic); return; }
        const n = ev.target.closest('[data-node]');
        if (n && n.classList.contains('open')) { onNode(n.dataset.node); return; }
        if (ev.target.closest('[data-cashout]')) { cashout(); return; }
        if (ev.target.closest('[data-bag]')) { openBag(); }
    });
}
function tickOnce() {
    if (!root || !root.isConnected) { clearInterval(tick); return; }
    const c = root.querySelector('[data-cd]');
    if (c && H) {
        const left = H.next_free - now();
        c.textContent = clock(left);
        if (left <= -1 && !busy) load();
    }
}
function show() {
    root = document.querySelector('#is-app');
    if (!root) return;
    bind();
    load();
    tick = setInterval(tickOnce, 1000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
