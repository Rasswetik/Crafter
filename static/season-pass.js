/* The season pass inside the application: the card «Сезон» in the hub of the event; a tap opens the separate page /season (its own HTML template). */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const thumb = (u, w) => /^\/(static\/assets\/(chests|packs)\/[\w.-]+\.(png|webp|jpe?g)|media\/shop\/[0-9a-f]{32})$/.test(u || '') ? '/thumb?u=' + encodeURIComponent(u) + '&w=' + w : u;
function open() {
    try { const tgw = window.Telegram && window.Telegram.WebApp; if (tgw && tgw.initData) sessionStorage.setItem('crafter:telegram-session', tgw.initData); } catch (_) {}   // the page has no hash of Telegram: it takes the data from here
    location.assign('/season');
}
/* the card «Сезон» in the hub of the event (new-year.js calls hubCard after it draws the hub): a clean card, the ticket only when the administrator uploaded his own */
async function hubCard(main) {
    let r;
    try { r = await api('pass'); } catch (_) { return; }
    const page = main.querySelector('.ny-hubpage');
    if (!page || !r.season || page.querySelector('.nyh-season')) return;
    const s = r.season, me = r.me, th = s.theme || {};
    const custom = s.plus_ticket && s.plus_ticket.indexOf('/static/assets/pass/') !== 0;
    const pct = me.xp_for_next ? Math.min(100, Math.round(me.xp_in_level / me.xp_for_next * 100)) : 100;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nyh-card nyh-season';
    b.setAttribute('aria-label', 'Сезонный пасс');
    b.style.cssText = '--sp-c1:' + (th.c1 || '#5b2cff') + ';--sp-c2:' + (th.c2 || '#c24fd8') + ';--sp-c3:' + (th.c3 || '#2a1170') + ';' + (s.banner ? 'background-image:linear-gradient(90deg,rgba(20,10,60,.55),rgba(20,10,60,.1)),url(' + thumb(s.banner, 900) + ')' : '');
    b.innerHTML = (custom ? '<img class="nyh-ticket" src="' + e(thumb(s.plus_ticket, 360)) + '" alt="">' : '<span class="nyh-lvl"><small>УРОВЕНЬ</small><b>' + me.level + '</b></span>') +
        '<span class="nyh-copy"><small>СЕЗОН ' + s.number + '</small><strong>' + e(s.title) + '</strong></span><i class="nyh-go" aria-hidden="true">›</i>';
    b.addEventListener('click', open);
    const market = page.querySelector('.nyh-market');
    if (market) market.after(b); else page.prepend(b);
}

const beforeGo = go;
go = async function (page, ...args) {
    if (page === 'season') return open();
    return beforeGo.call(this, page, ...args);
};
window.crafterSeasonPass = {hubCard, open};
})();
