/* Admin → Новый год: when each section of the New Year page opens. Until then its button is grey with a countdown. */
(function () {
'use strict';
const NAMES = {market: 'Новогодний маркет', community: 'События сообщества', advent: 'Адвент-календарь'};
const local = ts => { if (!ts) return ''; const d = new Date(ts * 1000), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
async function admin(content) {
    let r;
    try { r = await api('admin/new-year/locks'); } catch (_) { return; }
    if (!content.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section';
    sec.dataset.pane = 'main';
    sec.innerHTML = '<h3>Закрыть разделы до времени</h3><p class="sub">Пока время не наступило, кнопка раздела на странице «Новый год» серая и пишет «Откроется через …» с обратным отсчётом. Пустое поле — раздел открыт.</p>' +
        r.sections.map(k => '<div class="adm-field" style="margin-bottom:10px"><label>' + NAMES[k] + '</label><div style="display:flex;gap:8px"><input type="datetime-local" data-lock="' + k + '" value="' + local(r.locks[k]) + '" style="flex:1"><button type="button" class="secondary" data-lock-clear="' + k + '">Открыть сейчас</button></div></div>').join('') +
        '<button type="button" class="primary" id="ny-locks-save">Сохранить</button>';
    content.appendChild(sec);
    sec.querySelectorAll('[data-lock-clear]').forEach(b => b.addEventListener('click', () => { sec.querySelector('[data-lock="' + b.dataset.lockClear + '"]').value = ''; }));
    sec.querySelector('#ny-locks-save').addEventListener('click', async () => {
        const locks = {};
        sec.querySelectorAll('[data-lock]').forEach(i => { if (i.value) locks[i.dataset.lock] = Math.floor(new Date(i.value).getTime() / 1000); });
        try { await api('admin/new-year/locks', {locks}); toast('Сохранено'); } catch (err) { toast(err.message); }
    });
}
window.crafterNyLocks = {admin};
})();
