/* The card of the event «Vice City: Розыск» in the hub of the section «Season»: the picture, the countdown to the release and the wanted stars. It opens /season/wanted. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
async function hubCard(main) {
    let r;
    try { r = await api('wanted'); } catch (_) { return; }
    const page = main.querySelector('.ny-hubpage');
    if (!page || page.querySelector('.nyh-wanted') || (!r.enabled && !r.admin)) return;      // a switched-off event is shown only to the administrator
    const left = r.release_at - r.now;
    const days = Math.floor(left / 86400), hours = Math.floor(left % 86400 / 3600);
    const when = !r.enabled ? 'Выключено: видно только вам' : left > 0 ? 'До выхода игры: ' + (days ? days + ' дн. ' : '') + hours + ' ч.' : 'Игра вышла!';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nyh-card nyh-wanted' + (r.enabled ? '' : ' is-off');
    b.setAttribute('aria-label', r.title);
    b.innerHTML = '<span class="nyh-copy"><small>СОБЫТИЕ</small><strong>' + e(r.title) + '</strong><em>' + e(when) + '</em>' +
        '<span class="nyh-wstars" aria-label="Уровень розыска ' + r.level + ' из 5">' + [1, 2, 3, 4, 5].map(i => '<i class="' + (i <= r.level ? 'on' : '') + '">★</i>').join('') + '</span></span><span class="sh-open">Открыть <b>›</b></span>';
    b.addEventListener('click', () => location.assign('/season/wanted'));
    const market = page.querySelector('.nyh-market');                                       // right under the market button
    if (market) market.after(b); else page.querySelector('.sh-head')?.after(b);
}
window.crafterWanted = {hubCard};
})();
