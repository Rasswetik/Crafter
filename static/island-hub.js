/* Карточка режима «Остров сокровищ» в хабе раздела «Сезон»: открывает /island. Выключенный режим виден только администратору. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
async function hubCard(main) {
    let r;
    try { r = await api('island'); } catch (_) { return; }
    const page = main.querySelector('.ny-hubpage');
    if (!page || page.querySelector('.nyh-island') || (!r.enabled && !r.admin)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nyh-card nyh-island' + (r.enabled ? '' : ' is-off');
    b.setAttribute('aria-label', r.title);
    const info = r.run ? 'Экспедиция идёт: ' + r.run.depth + ' из 8' : !r.enabled ? 'Выключено: видно только вам' : 'Билетов: ' + r.tickets;
    b.innerHTML = '<span class="nyh-copy"><small>РЕЖИМ</small><strong>' + e(r.title) + '</strong><em>' + e(info) + '</em></span><span class="sh-open">Открыть <b>›</b></span>';
    b.addEventListener('click', () => location.assign('/island'));
    const anchor = page.querySelector('.nyh-wanted') || page.querySelector('.nyh-market');
    if (anchor) anchor.after(b); else page.querySelector('.sh-head')?.after(b);
}
window.crafterIsland = {hubCard};
})();
