/* Карточка события «Войны банд» в хабе раздела «Сезон»: перевес банд и твоя сторона. Открывает /season/gangs. Выключенное событие видит только администратор. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
async function hubCard(main) {
    let r;
    try { r = await api('gangs'); } catch (_) { return; }
    const page = main.querySelector('.ny-hubpage');
    if (!page || page.querySelector('.nyh-gangs') || (!r.enabled && !r.admin)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nyh-card nyh-gangs' + (r.enabled ? '' : ' is-off');
    b.setAttribute('aria-label', r.title);
    const a = r.gangs ? r.gangs[0] : null, c = r.gangs ? r.gangs[1] : null;
    const info = !r.enabled ? 'Выключено: видно только вам' : r.me ? 'Вы в банде «' + (r.gangs.find(x => x.id === r.me.gang) || {}).name + '»' : 'Выберите сторону';
    b.innerHTML = '<span class="nyh-copy"><small>СОБЫТИЕ</small><strong>' + e(r.title) + '</strong><em>' + e(info) + '</em>' +
        (a ? '<span class="nyh-gtug"><i class="l" style="width:' + a.share + '%"></i><i class="r" style="width:' + (100 - a.share) + '%"></i></span><span class="nyh-gnames"><b style="color:#27d3ff">' + e(a.name) + '</b><b style="color:#ff4fa8">' + e(c.name) + '</b></span>' : '') + '</span><span class="sh-open">Открыть <b>›</b></span>';
    b.addEventListener('click', () => location.assign('/season/gangs'));
    const anchor = page.querySelector('.nyh-wanted') || page.querySelector('.nyh-market');
    if (anchor) anchor.after(b); else page.querySelector('.sh-head')?.after(b);
}
window.crafterGangs = {hubCard};
})();
