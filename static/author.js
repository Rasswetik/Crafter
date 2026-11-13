/* The page of an author (a content creator with an author code): how many players entered the code, how many purchases they
   made, how much was earned in balls and GRAM. It exists only for people who own a code; it stands under the admin panel. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img class="au-ico" src="/static/assets/new-year-ornament.svg" alt="">';
const GRM = '<img class="au-ico" src="/static/assets/gram.svg" alt="">';
const ICON = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>';
let info = null, checked = false;

async function check() {
    if (checked || !state?.me) return;
    checked = true;
    try { info = await api('author/stats'); } catch (_) { info = null; }
    if (info?.has_code) refreshNav();
}
function refreshNav() { if (typeof nav === 'function') nav(); window.crafterDesktopNavRefresh?.(); }

function navAuthor() {
    if (!info?.has_code) return;
    const side = document.querySelector('#crafter-desktop-sidebar');
    if (side && !side.querySelector('.au-nav-link')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'desktop-sidebar-secondary au-nav-link' + (state.page === 'author' ? ' is-active' : '');
        button.innerHTML = '<span class="desktop-sidebar-link-icon">' + ICON + '</span>Автор';
        button.addEventListener('click', () => go('author'));
        const admin = [...side.querySelectorAll('.desktop-sidebar-secondary')].find(b => /Админ/.test(b.textContent));
        const last = [...side.querySelectorAll('.desktop-sidebar-secondary')].pop();
        (admin || last)?.after(button);
        if (!admin && !last) side.querySelector('.desktop-sidebar-menu')?.after(button);
    }
}
function addTile() {                                              // on the phone: a tile in the Games section, next to the event
    const wrap = document.querySelector('#main .crafter-games');
    if (!wrap || !info?.has_code || wrap.querySelector('.au-game-tile')) return;
    wrap.insertAdjacentHTML('beforeend', '<button class="crafter-game-tile au-game-tile" type="button" onclick="go(\'author\')"><span class="crafter-game-label"><strong>Автор</strong><span>Статистика вашего кода</span></span></button>');
}

function dayLabel(d) { return d.slice(8, 10) + '.' + d.slice(5, 7); }
function tile(label, value, sub, cls) { return '<div class="au-tile ' + (cls || '') + '"><small>' + label + '</small><b>' + value + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>'; }
function chart(series) {
    const max = Math.max(1, ...series.map(s => s.n));
    return '<div class="au-chart">' + series.map(s => '<div class="au-bar" title="' + dayLabel(s.day) + ': покупок ' + s.n + ', заработано ' + num(s.balls) + ' шаров и ' + num(s.gram) + ' GRAM"><i style="height:' + Math.max(s.n ? 8 : 2, Math.round(s.n / max * 100)) + '%"></i><em>' + (s.n || '') + '</em><small>' + dayLabel(s.day) + '</small></div>').join('') + '</div>';
}
function time(ts) { const d = new Date(ts * 1000); return d.toLocaleDateString('ru-RU', {day: '2-digit', month: '2-digit'}) + ' ' + d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}); }

function draw(main) {
    const d = info;
    main.innerHTML = '<div class="au-page"><div class="au-bg" aria-hidden="true"><i></i></div><div class="au-body">' +
        '<div class="au-head"><h1>Раздел автора</h1><p>Игроки вводят ваш код в Особом маркете, и ' + e(d.percent) + '% от всех их покупок возвращается вам: шарами за шары и GRAM за GRAM.</p></div>' +
        '<div class="au-codes">' + d.codes.map(c => '<div class="au-code' + (c.active ? '' : ' is-off') + '"><small>Ваш код</small><b>' + e(c.code) + '</b><span>' + c.supporters + ' игроков поддерживают' + (c.active ? '' : ' · выключен') + '</span><button type="button" data-au-copy="' + e(c.code) + '">Скопировать</button></div>').join('') + '</div>' +
        '<div class="au-tiles">' +
        tile('Ввели код', num(d.entries), 'за неделю: ' + num(d.entries_week)) +
        tile('Сейчас поддерживают', num(d.supporters), 'покупателей: ' + num(d.buyers)) +
        tile('Покупок по коду', num(d.purchases.total), 'за шары: ' + num(d.purchases.BALLS) + ' · за GRAM: ' + num(d.purchases.GRAM)) +
        tile('Куплено на сумму', ORN + num(d.spent.BALLS) + '<br>' + GRM + num(d.spent.GRAM), '', 'au-money') +
        tile('Вы заработали', ORN + num(d.earned.BALLS) + '<br>' + GRM + num(d.earned.GRAM), '', 'au-money au-gold') + '</div>' +
        '<div class="au-card"><h3>Покупки за 14 дней</h3>' + chart(d.series) + '</div>' +
        '<div class="au-card"><h3>Последние начисления</h3>' + (d.recent.length ? '<div class="au-table"><div class="au-tr au-th"><span>Когда</span><span>Игрок</span><span>Что</span><span>Купил на</span><span>Вам</span></div>' + d.recent.map(x => '<div class="au-tr"><span>' + time(x.time) + '</span><span>' + e(x.buyer) + '</span><span>' + e(x.what) + '</span><span>' + (x.currency === 'BALLS' ? ORN : GRM) + num(x.base) + '</span><span class="au-plus">+' + (x.currency === 'BALLS' ? ORN : GRM) + num(x.amount) + '</span></div>').join('') + '</div>' : '<p class="au-empty">Пока никто не покупал по вашему коду. Расскажите о нём аудитории.</p>') + '</div>' +
        '</div></div>';
    main.querySelectorAll('[data-au-copy]').forEach(b => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.auCopy); toast('Код скопирован'); } catch (_) { toast(b.dataset.auCopy); } }));
}

const prevGo = go;
go = async function (page, ...rest) {
    if (page !== 'author') {
        document.querySelector('#app')?.classList.remove('author-view');
        return prevGo.call(this, page, ...rest);
    }
    if (state.crafting) return;
    if (!info?.has_code) { await check(); if (!info?.has_code) toast('Раздел автора есть только у авторов с кодом'); return prevGo.call(this, 'market'); }
    if (state.page === 'arena' && typeof leaveArena === 'function') leaveArena();
    state.page = 'author'; state.gamesMode = false;
    const app = document.querySelector('#app');
    app?.classList.remove('craft-view', 'cart-view', 'staking-view', 'arena-view', 'games-view', 'new-year-view', 'fm-full', 'auctions-view');
    app?.classList.add('author-view');
    app?.querySelector(':scope > .ny-bgblur')?.remove();
    document.querySelector('#cart-float')?.remove();
    nav(); if (typeof updateBalance === 'function') updateBalance();
    const main = document.querySelector('#main');
    main.innerHTML = '<div class="au-page"><div class="au-bg"><i></i></div><div class="au-body"><div class="au-head"><h1>Раздел автора</h1></div><div class="au-skel"></div></div></div>';
    try { info = await api('author/stats'); } catch (error) { main.innerHTML = '<div class="empty"><h2>Не удалось загрузить</h2><p>' + e(error.message) + '</p></div>'; return; }
    if (state.page === 'author') draw(main);
};
const beforeNav = nav;
nav = function () { beforeNav.apply(this, arguments); navAuthor(); };
if (typeof window.crafterDesktopNavRefresh === 'function') {
    const original = window.crafterDesktopNavRefresh;
    window.crafterDesktopNavRefresh = function () { original(); navAuthor(); };
}
if (typeof renderGamesHub === 'function') {
    const hubBefore = renderGamesHub;
    renderGamesHub = function () { hubBefore.apply(this, arguments); addTile(); };
}
const wait = setInterval(() => { if (state?.me) { clearInterval(wait); check(); } }, 600);
setTimeout(() => clearInterval(wait), 60000);
window.crafterAuthor = {check};
})();
