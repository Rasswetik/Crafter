/* The card of the event «Vice City: Розыск» in the hub of the section «Season»: the picture, the countdown to the release and the wanted stars. It opens /season/wanted. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
async function hubCard(main) {
    let r;
    try { r = await api('wanted'); } catch (_) { return; }
    const page = main.querySelector('.ny-hubpage');
    if (!page || !r.enabled || page.querySelector('.nyh-wanted')) return;
    const left = r.release_at - r.now;
    const when = left > 0 ? 'До выхода игры: ' + (Math.floor(left / 86400) ? Math.floor(left / 86400) + ' дн. ' : '') + Math.floor(left % 86400 / 3600) + ' ч.' : 'Игра вышла';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nyh-card nyh-wanted';
    b.setAttribute('aria-label', r.title);
    b.innerHTML = '<img class="nyh-wanted-art" src="/static/assets/wanted/key_art/tile_art.webp" alt="" draggable="false"><span class="nyh-copy"><small>СОБЫТИЕ · РОЗЫСК</small><strong>' + e(r.title) + '</strong><em>' + e(when) + '</em>' +
        '<span class="nyh-wstars">' + [1, 2, 3, 4, 5].map(i => '<i class="' + (i <= r.level ? 'on' : '') + '">★</i>').join('') + '</span></span><span class="sh-open">Открыть <b>›</b></span>';
    b.addEventListener('click', () => location.assign('/season/wanted'));
    const first = page.querySelector('.nyh-card');
    if (first) first.before(b); else page.prepend(b);
}
window.crafterWanted = {hubCard};
})();
