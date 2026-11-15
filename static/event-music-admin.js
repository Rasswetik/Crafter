/* Admin → Управление сезоном → Музыка ивента: which music plays (New Year, Vice City or none) and how loud. Players can still switch it off in their settings. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

async function admin(content) {
    let cfg;
    try { cfg = (await api('event-music')).music; } catch (_) { return; }
    if (!content.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section em-wrap';
    sec.dataset.pane = 'eventmusic';
    let audio = null;
    const stop = () => { if (audio) { audio.pause(); audio = null; } };
    const draw = () => {
        const opts = [['newyear', 'Новый год', 'Колокольчики «Jingle Bells». Играет, пока включён Новый год.'], ['vice', 'Ивент Vice City', 'Синтвейв «Neon Boulevard» в духе GTA Vice City: бас, арпеджио, эпичный припев. Играет всё время, пока выбран этот режим.'], ['off', 'Без музыки', 'Музыка выключена для всех.']];
        sec.innerHTML = '<h3>Музыка ивента</h3><p class="sub">Выберите, что играет в приложении. Игрок может выключить музыку у себя в настройках; музыка начинается после первого касания экрана.</p>' +
            '<div class="em-modes">' + opts.map(o => '<button type="button" class="em-mode' + (cfg.mode === o[0] ? ' is-on' : '') + '" data-mode="' + o[0] + '"><b>' + o[1] + '</b><small>' + o[2] + '</small></button>').join('') + '</div>' +
            '<label class="em-vol">Громкость: <b data-vl>' + cfg.volume + '%</b><input type="range" min="5" max="100" step="5" value="' + cfg.volume + '" data-vol></label>' +
            '<div class="em-actions"><button type="button" class="primary" data-save>Сохранить</button><button type="button" data-prev>' + (audio ? '■ Остановить' : '▶ Послушать Vice City') + '</button></div>';
        sec.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { cfg.mode = b.dataset.mode; draw(); }));
        sec.querySelector('[data-vol]').addEventListener('input', ev => { cfg.volume = Number(ev.target.value); sec.querySelector('[data-vl]').textContent = cfg.volume + '%'; if (audio) audio.volume = cfg.volume / 100; });
        sec.querySelector('[data-prev]').addEventListener('click', () => {
            if (audio) { stop(); draw(); return; }
            const t = (cfg.tracks || []).find(x => x.id === 'vice');
            if (!t) return;
            audio = new Audio(t.url); audio.volume = cfg.volume / 100; audio.loop = true; audio.play().catch(() => {}); draw();
        });
        sec.querySelector('[data-save]').addEventListener('click', async () => {
            try { const r = await api('admin/event-music', {mode: cfg.mode, volume: cfg.volume}); cfg = r.music; toast('Музыка сохранена'); window.crafterNYSound?.reload?.(); draw(); } catch (err) { toast(err.message); }
        });
    };
    draw();
    content.appendChild(sec);
}
window.crafterEventMusicAdmin = {admin};
})();
