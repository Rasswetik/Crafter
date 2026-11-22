/* Admin → «Поставщики»: the accounts of markets (Thermos, Portals ...). A gift that arrives on the relayer from such an account
   belongs to the project at once and is not put into anybody's inventory. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const when = t => t ? new Date(t * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
const box = 'padding:16px 18px;margin:0 0 14px';
const field = 'width:100%;min-height:130px;padding:11px 13px;border-radius:14px;border:1px solid #303030;background:#1a1a1a;color:#fff;font:inherit;font-family:ui-monospace,Consolas,monospace';

function draw(content, d) {
    content.innerHTML =
        '<div class="admin-section-intro"><h3>Аккаунты поставщиков</h3><p>Здесь Telegram ID аккаунтов маркетов (Thermos, Portals и других). Когда от такого аккаунта на релейер приходит подарок, он сразу становится ничейным: принадлежит проекту и не попадает ни в чей инвентарь.</p></div>' +
        '<section class="admin-glass-panel" style="' + box + '"><h3 style="margin:0 0 8px">Telegram ID поставщиков</h3>' +
        '<p style="margin:0 0 10px;color:#87878b">По одному ID на строке или через запятую.</p>' +
        '<textarea data-ids style="' + field + '" placeholder="123456789">' + e(d.ids.join('\n')) + '</textarea>' +
        '<div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap"><button type="button" class="primary" data-save>Сохранить</button>' +
        '<span style="color:#87878b">Сейчас поставщиков: ' + d.ids.length + '</span></div></section>' +
        '<section class="admin-glass-panel" style="' + box + '"><h3 style="margin:0 0 8px">Подарки проекта</h3>' +
        '<p style="margin:0 0 10px;color:#87878b">Принято от поставщиков: ' + d.project_gifts + '</p>' +
        (d.recent.length ? '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#87878b"><th>Время</th><th>Подарок</th><th>Поставщик</th></tr></thead><tbody>' +
            d.recent.map(x => '<tr style="border-top:1px solid #303030"><td style="padding:8px 8px 8px 0;white-space:nowrap">' + when(x.received) + '</td><td>' + e((x.name || '') + ' #' + (x.number || '')) + '</td><td>' + e(x.sender_id) + '</td></tr>').join('') +
            '</tbody></table></div>' : '<p style="margin:0;color:#87878b">Пока ничего не приходило.</p>') + '</section>';
    content.querySelector('[data-save]').addEventListener('click', async () => {
        const ids = content.querySelector('[data-ids]').value.split(/[\s,;]+/).filter(Boolean);
        try { draw(content, await api('admin/suppliers', {ids, confirm: 'SET_SUPPLIERS'})); toast('Сохранено'); } catch (err) { toast(err.message); }
    });
}

window.renderAdminSuppliers = async function (content) {
    content.innerHTML = '<p class="admin-loading-panel">Загрузка…</p>';
    try { draw(content, await api('admin/suppliers')); } catch (err) { content.innerHTML = '<p class="admin-loading-panel">' + e(err.message) + '</p>'; }
};

if (typeof adminSections === 'object') {
    adminSections.suppliers = {label: 'Поставщики', detail: 'Аккаунты маркетов: их подарки ничейные', group: 'money', glyph: 'send', render: window.renderAdminSuppliers};
}
})();
