/* Карточка казино «Diamond» в хабе раздела «Сезон»: джекпот и уровень VIP. Открывает /season/diamond. Выключенное казино видит только администратор. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => Number(v).toLocaleString('ru-RU');
async function hubCard(main) {
    let r;
    try { r = await api('diamond'); } catch (_) { return; }
    const page = main.querySelector('.ny-hubpage');
    if (!page || page.querySelector('.nyh-diamond') || (!r.enabled && !r.admin)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nyh-card nyh-diamond' + (r.enabled ? '' : ' is-off');
    b.setAttribute('aria-label', r.title);
    const info = !r.enabled ? 'Выключено: видно только вам' : r.free_left > 0 ? 'Бесплатная прокрутка ждёт' : 'Бесплатные прокрутки на сегодня закончились';
    b.innerHTML = '<span class="nyh-copy"><small>КАЗИНО</small><strong>' + e(r.title) + '</strong><em>' + e(info) + '</em>' + (r.jackpot ? '<span class="nyh-jp">Джекпот <b>' + num(r.jackpot) + '</b></span>' : '') + '</span><span class="sh-open">Открыть <b>›</b></span>';
    b.addEventListener('click', () => location.assign('/season/diamond'));
    const anchor = page.querySelector('.nyh-gangs') || page.querySelector('.nyh-wanted') || page.querySelector('.nyh-market');
    if (anchor) anchor.after(b); else page.querySelector('.sh-head')?.after(b);
}
window.crafterDiamond = {hubCard};
})();
