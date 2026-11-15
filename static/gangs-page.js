/* Страница события «Войны банд» (шаблон /season/gangs): две банды, шкала противостояния, шесть районов, мой вклад, награды и топ.
   Очки, районы и награды считает сервер; здесь только показ и выбор банды. Картинки берутся из набора «Розыска» и из /static/assets/gangs/ (если он есть). */
(function () {
'use strict';
const W = '/static/assets/wanted/', G = '/static/assets/gangs/';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) {} };
const CURR = (window.crafterCurrency || {name: 'Шары', gen: 'шаров'});
const BALL = '/static/assets/new-year-ornament.svg';
const p2 = n => String(Math.max(0, n)).padStart(2, '0');
const COLOR = {goshan: '#27d3ff', nikolay: '#ff4fa8'};
const ICON = {beach: 'icons/i_pack', downtown: 'icons/i_trophy', havana: 'icons/i_car', port: 'icons/i_wrench', island: 'icons/i_cash', point: 'icons/i_gift'};
/* a picture of the new set if it exists, the picture of the old set otherwise */
const pic = (name, fallback, cls) => '<img class="' + (cls || '') + '" src="' + G + name + '" onerror="this.onerror=null;this.src=\'' + W + fallback + '\'" alt="" draggable="false">';
const art = name => G + name;

let S = null, L = null, tab = 'prizes', root = null, tick = 0, off = 0, busy = false;
const now = () => Math.floor(Date.now() / 1000) + off;
const gang = id => S.gangs.find(x => x.id === id);
const rewardChip = r => '<span class="gp-chip"><img src="' + e(r.image || BALL) + '" alt=""><b>' + e(r.title) + (r.count > 1 && r.kind !== 'BALL' ? ' ×' + r.count : '') + '</b></span>';
const chips = list => list && list.length ? '<span class="gp-chips">' + list.map(rewardChip).join('') + '</span>' : '<span class="gp-none">нет награды</span>';
function left(s) { s = Math.max(0, Math.floor(s)); return {d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60}; }
const clock = s => { const t = left(s); return (t.d ? t.d + ' дн ' : '') + p2(t.h) + ':' + p2(t.m) + ':' + p2(t.s); };

/* ---------- the pieces ---------- */
function top() {
    return '<header class="gp-top"><button type="button" class="gp-back" data-back>‹ События</button>' +
        (S.war ? '<span class="gp-state">Война ' + e(S.war.id) + ' · до конца <b data-cd>' + clock(S.war.ends - now()) + '</b></span>' : '<span class="gp-state">Скоро</span>') + '</header>';
}
function gangCard(x, side) {
    const mine = S.me && S.me.gang === x.id;
    const other = gang(x.id === 'goshan' ? 'nikolay' : 'goshan');
    const crowd = x.members > other.members;
    return '<article class="gp-gang is-' + x.id + (mine ? ' is-mine' : '') + '" style="--gc:' + x.color + '">' +
        '<div class="gp-gang-art">' + pic(x.id + '_crossed.png', 'characters/' + x.id + '_point.webp', 'ch') + '</div>' +
        '<div class="gp-gang-body"><span class="gp-tag">' + (mine ? 'Ваша банда' : 'Банда') + '</span><h2>' + e(x.name) + '</h2><p>' + e(x.slogan || '') + '</p>' +
        '<div class="gp-score"><b>' + num(x.points) + '</b><small>очков</small></div>' +
        '<div class="gp-meta"><span>' + num(x.members) + ' игроков' + (crowd ? '' : '') + '</span>' + (x.mult > 1 ? '<span class="gp-boost" title="Меньшая банда получает множитель очков">×' + x.mult + ' поддержка</span>' : '') + '</div>' +
        (mine ? '' : S.enabled ? '<button type="button" class="gp-join" data-join="' + x.id + '"' + (S.me && !S.me.can_switch ? ' disabled' : '') + '>' + (S.me ? 'Перейти' : 'Вступить') + '</button>' : '') + '</div></article>';
}
function versus() {
    const a = gang('goshan'), b = gang('nikolay');
    const share = a.share;
    return '<section class="gp-vs">' + gangCard(a) + '<div class="gp-mid"><div class="gp-vsmark">VS</div><div class="gp-weeknote">Неделя: с понедельника до воскресенья</div></div>' + gangCard(b) + '</section>' +
        '<div class="gp-tug" aria-label="Перевес банд"><i class="l" style="width:' + share + '%"></i><i class="r" style="width:' + (100 - share) + '%"></i><span class="spark" style="left:' + share + '%"></span>' +
        '<b class="pl">' + share + '%</b><b class="pr">' + (Math.round((100 - share) * 10) / 10) + '%</b></div>';
}
function districts() {
    return '<section class="gp-sec"><h3>Районы Вайс-Сити <small>район получает та банда, у которой в нём больше очков</small></h3><div class="gp-dist">' + S.districts.map(d => {
        const total = d.goshan + d.nikolay, pl = total ? Math.round(d.goshan / total * 100) : 50;
        return '<article class="gp-d' + (d.owner ? ' own-' + d.owner : '') + '"><img class="art" src="' + G + 'district_' + d.key + '.webp" onerror="this.remove()" alt=""><div class="gp-d-top"><img src="' + W + ICON[d.key] + '.webp" alt=""><div><b>' + e(d.title) + '</b><small>' + e(d.hint) + '</small></div>' +
            '<span class="gp-owner' + (d.owner ? ' is-' + d.owner : '') + '">' + (d.owner ? e(gang(d.owner).name) : 'Свободен') + '</span></div>' +
            '<div class="gp-bar"><i class="l" style="width:' + (total ? pl : 50) + '%"></i><i class="r" style="width:' + (total ? 100 - pl : 50) + '%"></i></div>' +
            '<div class="gp-d-n"><span style="color:' + COLOR.goshan + '">' + num(d.goshan) + '</span><span style="color:' + COLOR.nikolay + '">' + num(d.nikolay) + '</span></div></article>';
    }).join('') + '</div></section>';
}
function mine() {
    const m = S.me;
    if (!m) return '<section class="gp-sec gp-me"><h3>Вступите в банду</h3><p class="gp-lead">Выберите сторону: Гошан или Николай. Банду можно сменить, пока вы ещё не набрали очков в текущей войне.</p></section>';
    const g0 = gang(m.gang), nxt = m.rank.next;
    const pct = nxt ? Math.min(100, Math.round(m.points / nxt.need * 100)) : 100;
    return '<section class="gp-sec gp-me is-' + m.gang + '" style="--gc:' + g0.color + '"><div class="gp-me-h"><div class="gp-rank">' + pic('rank_' + m.gang + '_' + m.rank.level + '.png', 'icons/i_star.webp', 'ic') + '<div><small>' + e(g0.name) + ', ваш ранг</small><b>' + e(m.rank.title) + '</b></div></div>' +
        '<div class="gp-pts"><b>' + num(m.points) + '</b><small>очков за войну' + (m.rank_in_gang ? ', #' + m.rank_in_gang + ' в банде' : '') + '</small></div></div>' +
        '<div class="gp-prog"><div class="gp-prog-h"><span>' + (nxt ? 'До ранга «' + e(nxt.title) + '»' : 'Высший ранг') + '</span><span>' + (nxt ? num(m.points) + ' / ' + num(nxt.need) : '') + '</span></div><div class="gp-meter"><i style="width:' + pct + '%"></i></div></div>' +
        (m.cap ? '<div class="gp-prog"><div class="gp-prog-h"><span>Очков сегодня (потолок ' + num(m.cap) + ')</span><span>' + num(m.today) + '</span></div><div class="gp-meter day"><i style="width:' + Math.min(100, Math.round(m.today / m.cap * 100)) + '%"></i></div></div>' : '') +
        '<div class="gp-tiers">' + m.tiers.map(t => '<div class="gp-tier' + (t.reached ? ' on' : '') + '"><b>' + num(t.points) + ' очков</b>' + chips(t.reward) + (t.reached ? '<i>✓</i>' : '') + '</div>').join('') + '</div></section>';
}
function claims() {
    const rows = S.claims.filter(c => !c.claimed && c.rewards.length);
    if (!rows.length) return '';
    return rows.map(c => '<section class="gp-claim is-' + c.gang + '" style="--gc:' + COLOR[c.gang] + '"><img src="' + W + 'ui/reward_crate.webp" alt=""><div><b>Война ' + e(c.war) + ' завершена: ' + (c.draw ? 'ничья' : c.won ? 'ваша банда победила!' : 'ваша банда проиграла, но вклад засчитан') + '</b><small>Очков: ' + num(c.points) + (c.districts ? ', районов: ' + c.districts : '') + (c.top ? ', место в топе: ' + c.top : '') + '</small>' + chips(c.rewards) + '</div>' +
        '<button type="button" class="gp-btn" data-claim="' + e(c.war) + '">Забрать</button></section>').join('');
}
function prizesTab() {
    const p = S.prizes;
    return '<section class="gp-sec"><h3>Награды недели</h3><div class="gp-prz"><div><b>Победа банды</b>' + chips(p.win) + '</div><div><b>Если не повезло</b>' + chips(p.lose) + '</div><div><b>За каждый район своей банды</b>' + chips(p.district) + '</div>' +
        Object.keys(p.top).map(k => '<div><b>' + k + ' место в общем топе</b>' + chips(p.top[k]) + '</div>').join('') + '</div><p class="gp-lead">Чтобы получить награды, нужно набрать не меньше ' + num(p.min_points) + ' очков. Забрать их можно после конца войны кнопкой «Забрать».</p></section>';
}
function leadersTab() {
    if (!L) return '<section class="gp-sec"><div class="gp-boot">Загрузка…</div></section>';
    const medal = i => i === 0 ? '<img src="' + W + 'ui/medal_gold.webp" alt="">' : i === 1 ? '<img src="' + W + 'ui/medal_silver.webp" alt="">' : i === 2 ? '<img src="' + W + 'ui/medal_bronze.webp" alt="">' : '<b>' + (i + 1) + '</b>';
    const row = (r, i) => '<div class="gp-ld is-' + r.gang + '"><span class="rk">' + medal(i) + '</span><span class="nm">' + (r.photo ? '<img class="av" src="' + e(r.photo) + '" alt="">' : '<i class="av"></i>') + '<span><b>' + e(r.name) + '</b><small>' + e(r.title) + '</small></span></span><span class="sc">' + num(r.points) + '</span></div>';
    const col = id => '<div class="gp-col is-' + id + '" style="--gc:' + COLOR[id] + '"><h4>' + e(gang(id).name) + '</h4>' + ((L.gangs[id] || []).map((r, i) => row(r, i)).join('') || '<p class="gp-none">Пока никого</p>') + '</div>';
    return '<section class="gp-sec"><h3>Общий топ недели</h3><div class="gp-lead-list">' + (L.top.map((r, i) => row(r, i)).join('') || '<p class="gp-none">Пока никто не набрал очков</p>') + '</div>' + (L.me ? '<p class="gp-lead">Ваше место: ' + L.me.rank + ', очков: ' + num(L.me.points) + '</p>' : '') + '</section>' +
        '<section class="gp-sec"><h3>Лучшие в каждой банде</h3><div class="gp-cols">' + col('goshan') + col('nikolay') + '</div></section>';
}
function rulesTab() {
    const W2 = S.weights;
    return '<section class="gp-sec"><h3>Как это работает</h3><ol class="gp-rules"><li>Вступите в одну из двух банд. Сменить её можно, пока в этой войне у вас ещё нет очков.</li><li>Очки даёт всё, что вы и так делаете: арена (' + W2.arena_result + ' за раунд), открытие пака (' + W2.pack_open + '), апгрейд (' + W2.upgrade + '), крафт (' + W2.craft + '), покупки и продажи (' + W2.buy + '), цепочки и подарки (' + W2.chain_claim + ').</li>' +
        '<li>В сутки один игрок приносит банде не больше ' + num(S.daily_cap) + ' очков, чтобы войну решали все, а не один.</li><li>Если в одной банде игроков больше, меньшая получает множитель очков (до ×1,5).</li><li>Каждое действие относится к своему району: паки к Оушен-Бичу, арена к Даунтауну, апгрейды к Малой Гаване, крафт к Порту, магазин и рынок к Стар-Айленду, цепочки и подарки к Вайс-Пойнту. Район достаётся банде с большим числом очков в нём.</li>' +
        '<li>В воскресенье в полночь по Москве война заканчивается, в понедельник начинается новая. Награды забираются кнопкой на этой странице.</li></ol></section>';
}
function draw() {
    if (!S) return;
    if (!S.enabled && !S.admin) { root.innerHTML = top() + '<section class="gp-sec"><h3>Войны банд скоро начнутся</h3><p class="gp-lead">Следите за новостями раздела «События».</p></section>'; return; }
    const tabs = [['prizes', 'Награды'], ['leaders', 'Топ'], ['rules', 'Правила']];
    root.innerHTML = '<img class="gp-bg" src="' + G + 'bg.webp" onerror="this.remove()" alt="">' + top() + '<section class="gp-hero"><picture><source media="(max-width:720px)" srcset="' + G + 'versus_mobile.webp"><img class="gp-hero-img" src="' + G + 'versus_wide.webp" onerror="this.closest(\'picture\').remove()" alt="" draggable="false"></picture><div class="gp-hero-text"><h1>' + e(S.title) + '</h1><p>' + e(S.subtitle || '') + '</p>' + (!S.enabled ? '<span class="gp-off">Выключено: видно только вам</span>' : '') + '</div></section>' +
        claims() + versus() + districts() + mine() + '<nav class="gp-tabs">' + tabs.map(t => '<button type="button" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</nav>' +
        (tab === 'prizes' ? prizesTab() : tab === 'leaders' ? leadersTab() : rulesTab());
}

/* ---------- actions ---------- */
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
        Object.values(packs).forEach(p => plan.push({it: {kind: 'PACK', pack: {image: p.i.image, title: p.i.title}, image_url: p.i.image, bundle: p.ids.length}, result: {packIds: p.ids, count: p.ids.length, head: 'Награда банды', title: 'Вы получили: <b>' + e(p.i.title) + (p.ids.length > 1 ? ' ×' + num(p.ids.length) : '') + '</b>'}}));
        if (gram) plan.push({it: {kind: 'GRAM', image_url: '/static/assets/gram.svg', rarity: 'res'}, result: {head: 'Награда банды', title: 'Зачислено: ' + num(gram) + ' GRAM', text: 'Баланс уже обновлён.'}});
        if (balls) plan.push({it: {kind: 'BALL', image_url: BALL, rarity: 'res'}, result: {head: 'Награда банды', title: 'Зачислено ' + CURR.gen + ': ' + num(balls), text: 'Баланс уже обновлён.'}});
        shown.forEach(i => plan.push({it: {kind: i.kind, image_url: i.image, rarity: 'res'}, result: {head: 'Награда банды', title: 'Получено: ' + e(i.title) + (i.count > 1 ? ' ×' + i.count : ''), text: i.kind === 'EMOJI' ? 'Значок уже в вашем профиле.' : 'Награда уже у вас.'}}));
        for (const step of plan) { try { await Promise.race([new Promise(done => F.reveal({it: step.it}, step.result, {refresh: done}, () => {})), new Promise(r => setTimeout(r, 60000))]); } catch (_) {} }
        document.querySelectorAll('.fm-reveal').forEach(x => x.remove());
    }
    if (g.drop_granted && window.crafterDrops) window.crafterDrops.afterPurchase(g.drop_granted, {refresh() { load(); }});
}
async function load() {
    try { S = await api('gangs'); off = S.now - Math.floor(Date.now() / 1000); } catch (err) { root.innerHTML = '<div class="gp-boot">' + e(err.message) + '</div>'; return; }
    draw();
    if (tab === 'leaders') loadLeaders();
}
async function loadLeaders() { try { L = await api('gangs/leaders'); if (tab === 'leaders') draw(); } catch (err) { toast(err.message); } }
async function join(id) {
    if (busy) return;
    const sw = S.me && S.me.gang !== id;
    if (sw && !confirm('Перейти в другую банду? Это можно сделать, пока у вас нет очков в этой войне.')) return;
    busy = true;
    try { S = await api('gangs/join', {gang: id}); toast('Вы в банде «' + gang(id).name + '»'); draw(); } catch (err) { toast(err.message); } finally { busy = false; }
}
async function claim(war, btn) {
    if (busy) return;
    busy = true; btn.disabled = true;
    try { const res = await api('gangs/claim', {war}); await showGiven(res); } catch (err) { toast(err.message); } finally { busy = false; await load(); }
}
function bind() {
    root.addEventListener('click', ev => {
        if (ev.target.closest('[data-back]')) { location.assign('/season'); return; }
        const t = ev.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; draw(); if (tab === 'leaders') loadLeaders(); return; }
        const j = ev.target.closest('[data-join]');
        if (j) { join(j.dataset.join); return; }
        const c = ev.target.closest('[data-claim]');
        if (c) claim(c.dataset.claim, c);
    });
}
function tickOnce() {
    if (!root || !root.isConnected) { clearInterval(tick); return; }
    const el = root.querySelector('[data-cd]');
    if (el && S && S.war) { const l = S.war.ends - now(); el.textContent = clock(l); if (l <= 0 && !busy) load(); }
}
function show() {
    root = document.querySelector('#gp-app');
    if (!root) return;
    bind();
    load();
    tick = setInterval(tickOnce, 1000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
