/* Admin → Управление сезоном → Кнопка «События»: the texts, the picture (SVG / PNG / WebM or none) and the background (live or own) of the button on the games page. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

async function admin(content) {
    let cfg;
    try { cfg = (await api('events-tile')).tile; } catch (_) { return; }
    if (!content.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section et-wrap';
    sec.dataset.pane = 'eventstile';
    const keys = () => (window.crafterFestive && window.crafterFestive.bgKeys) || [];
    const draw = () => {
        sec.innerHTML = '<h3>Кнопка «События»</h3><p class="sub">Это большая кнопка на странице «Игры». Здесь меняется текст, рисунок и фон. Пустые поля остаются стандартными.</p>' +
            '<div class="et-preview" id="et-prev">' + (window.crafterEventsTileHTML ? window.crafterEventsTileHTML(cfg) : '') + '</div>' +
            '<div class="et-form"><label>Заголовок<input data-f="title" maxlength="40" value="' + e(cfg.title) + '" placeholder="События"></label>' +
            '<label>Подпись<input data-f="subtitle" maxlength="140" value="' + e(cfg.subtitle) + '" placeholder="Маркет акций, календарь подарков и события сообщества"></label>' +
            '<label>Текст кнопки<input data-f="button" maxlength="24" value="' + e(cfg.button) + '" placeholder="Открыть"></label></div>' +
            '<h4>Рисунок справа</h4><div class="et-row"><button type="button" class="et-opt' + (!cfg.art ? ' is-on' : '') + '" data-art="">Стандартный</button><button type="button" class="et-opt' + (cfg.art === 'none' ? ' is-on' : '') + '" data-art="none">Без рисунка</button>' +
            '<label class="et-file' + (cfg.art && cfg.art !== 'none' ? ' is-on' : '') + '">Загрузить свой (SVG, PNG, WebP, WebM)<input type="file" data-artfile accept=".svg,.png,.webp,.gif,.webm,image/*,video/webm"></label></div>' +
            '<h4>Фон кнопки</h4><div class="et-bgs"><button type="button" class="et-bg' + (!cfg.bg ? ' is-on' : '') + '" data-bg="">Стандартный</button>' +
            keys().map(k => '<button type="button" class="et-bg' + (cfg.bg === k[0] ? ' is-on' : '') + '" data-bg="' + e(k[0]) + '">' + e(k[1]) + '</button>').join('') +
            '<label class="et-file' + (cfg.bg && cfg.bg.startsWith('image:') ? ' is-on' : '') + '">Свой фон (картинка)<input type="file" data-bgfile accept=".png,.jpg,.jpeg,.webp,.gif,image/*"></label></div>' +
            '<label class="et-check"><input type="checkbox" data-shade' + (cfg.shade ? ' checked' : '') + '> Затемнение слева, чтобы текст читался</label>' +
            '<div class="et-actions"><button type="button" class="primary" data-save>Сохранить</button><button type="button" data-reset>Сбросить всё</button></div>';
        bind();
    };
    const pull = () => sec.querySelectorAll('[data-f]').forEach(i => { cfg[i.dataset.f] = i.value; });
    const repaint = () => { const p = sec.querySelector('#et-prev'); if (p && window.crafterEventsTileHTML) p.innerHTML = window.crafterEventsTileHTML(cfg); };
    const upload = async f => {
        if (f.size > 6000000) throw new Error('Файл должен быть не больше 6 МБ');
        const body = new FormData(); body.append('file', f);
        return api('admin/emojis/media', body);
    };
    const bind = () => {
        sec.querySelectorAll('[data-f]').forEach(i => i.addEventListener('input', () => { cfg[i.dataset.f] = i.value; repaint(); }));
        sec.querySelectorAll('[data-art]').forEach(b => b.addEventListener('click', () => { pull(); cfg.art = b.dataset.art; cfg.art_kind = ''; draw(); }));
        sec.querySelectorAll('[data-bg]').forEach(b => b.addEventListener('click', () => { pull(); cfg.bg = b.dataset.bg; draw(); }));
        sec.querySelector('[data-shade]')?.addEventListener('change', ev => { cfg.shade = ev.target.checked ? 1 : 0; repaint(); });
        sec.querySelector('[data-artfile]')?.addEventListener('change', async ev => { const f = ev.target.files[0]; if (!f) return; pull(); try { const r = await upload(f); cfg.art = r.url; cfg.art_kind = r.mime === 'video/webm' ? 'video' : 'image'; draw(); } catch (err) { toast(err.message); } });
        sec.querySelector('[data-bgfile]')?.addEventListener('change', async ev => { const f = ev.target.files[0]; if (!f) return; pull(); try { const r = await upload(f); if (r.mime === 'video/webm') throw new Error('Фон — картинка, не видео'); cfg.bg = 'image:' + r.url; draw(); } catch (err) { toast(err.message); } });
        sec.querySelector('[data-save]')?.addEventListener('click', async () => {
            pull();
            try { const r = await api('admin/events-tile', {title: cfg.title, subtitle: cfg.subtitle, button: cfg.button, bg: cfg.bg, art: cfg.art, shade: Boolean(cfg.shade)}); cfg = r.tile; window.crafterEventsTileReload?.(); toast('Кнопка сохранена'); draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-reset]')?.addEventListener('click', async () => {
            if (!confirm('Вернуть кнопку «События» к стандартному виду?')) return;
            try { const r = await api('admin/events-tile', {reset: true}); cfg = r.tile; window.crafterEventsTileReload?.(); toast('Сброшено'); draw(); } catch (err) { toast(err.message); }
        });
    };
    draw();
    content.appendChild(sec);
}
window.crafterEventsTileAdmin = {admin};
})();
