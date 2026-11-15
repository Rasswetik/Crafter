/* Admin → Управление сезоном → «Розыск»: the switch and the dates of the event, the release date for the countdown, the missions (what to do, how many, the prizes, the wanted level),
   the prizes of the stars, the prizes of the leaders and the bonus day. Prizes are written as text: «Шары 100; Пак vicecity ×2; Значок wisecraft-cash». */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = ts => ts ? new Date((ts + 3 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ') : '';

async function admin(content) {
    let data;
    try { data = await api('admin/wanted'); } catch (_) { return; }
    if (!content.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section wa-wrap';
    sec.dataset.pane = 'wanted';
    const draw = () => {
        const s = data.settings;
        const f = (k, label, v, ph, extra) => '<label>' + label + '<input data-s="' + k + '" value="' + e(v) + '" placeholder="' + e(ph || '') + '"' + (extra || '') + '></label>';
        sec.innerHTML = '<h3>Розыск: Vice City</h3><p class="sub">Игрок проходит миссии по порядку и получает до 5 звёзд розыска. Прогресс считается с момента старта события. Страница события: <b>/season/wanted</b>. Даты пишутся по Москве: ГГГГ-ММ-ДД ЧЧ:ММ.</p>' +
            '<label class="wa-check"><input type="checkbox" data-s="enabled"' + (s.enabled ? ' checked' : '') + '> Событие включено (при первом включении старт ставится на «сейчас»)</label>' +
            '<div class="wa-grid">' + f('title', 'Название', s.title) + f('subtitle', 'Подпись', s.subtitle) + f('starts_at', 'Старт события', fmt(s.starts_at), '2026-11-15 12:00') + f('ends_at', 'Конец (пусто, если без конца)', fmt(s.ends_at), '') +
            f('release_at', 'Дата выхода игры (для отсчёта)', fmt(s.release_at), '2026-11-19 00:00') + f('day_one_stars', 'Звёзд для значка Day One', s.day_one_stars) + f('bonus_mult', 'Бонус дня релиза: награды в шарах ×', s.bonus_mult) + f('bonus_hours', 'Сколько часов длится бонус', s.bonus_hours) + '</div>' +
            '<h4>Призы лидеров «Король Вайс-Сити»</h4><div class="wa-grid">' + [0, 1, 2].map(i => '<label>' + (i + 1) + ' место<input data-lp="' + i + '" value="' + e((s.leader_prizes || [])[i] || '') + '"></label>').join('') + '</div>' +
            '<p class="sub">Призы лидеров только показываются игрокам, выдавать их нужно вручную после конца события.</p>' +
            '<h4>Миссии (открываются по порядку сверху вниз)</h4><div class="wa-ms">' + data.missions.map((m, i) => missionHTML(m, i)).join('') + '</div><button type="button" data-add>+ Миссия</button>' +
            '<h4>Награды за звёзды</h4><p class="sub">Выдаются сами, когда миссия поднимает уровень розыска до этой звезды. Пример: Значок wisecraft-wanted</p><div class="wa-grid">' +
            data.stars.map(x => '<label>★ ' + x.star + '<input data-star="' + x.star + '" value="' + e(x.reward) + '" placeholder="Шары 100; Значок wisecraft-cash"></label>').join('') + '</div>' +
            '<div class="wa-actions"><button type="button" class="primary" data-save>Сохранить</button></div>' +
            '<h4>Сбросить прогресс игрока</h4><div class="wa-grid"><label>Telegram ID<input data-rid inputmode="numeric"></label><button type="button" data-reset>Сбросить</button></div>';
        bind();
    };
    const missionHTML = (m, i) => '<div class="wa-m" data-i="' + i + '"><div class="wa-m-h"><b>Миссия ' + (i + 1) + '</b><span><button type="button" data-up="' + i + '">↑</button><button type="button" data-down="' + i + '">↓</button><button type="button" class="is-danger" data-del="' + i + '">Удалить</button></span></div>' +
        '<div class="wa-grid"><label>Название<input data-m="title" value="' + e(m.title) + '"></label><label>Описание<input data-m="description" value="' + e(m.description) + '"></label>' +
        '<label>Что считать<select data-m="metric">' + data.metrics.map(x => '<option value="' + e(x.key) + '"' + (x.key === m.metric ? ' selected' : '') + '>' + e(x.title) + '</option>').join('') + '</select></label>' +
        '<label>Сколько<input data-m="target" inputmode="numeric" value="' + e(m.target) + '"></label><label>Звёзд после миссии (0-5)<input data-m="level_after" inputmode="numeric" value="' + e(m.level_after) + '"></label>' +
        '<label>Награда<input data-m="reward" value="' + e(m.reward) + '" placeholder="Шары 100; Пак vicecity"></label><label>Картинка (ссылка)<input data-m="image" value="' + e(m.image) + '"></label></div>' +
        '<input type="hidden" data-m="id" value="' + e(m.id) + '"></div>';
    const pull = () => {
        const s = data.settings;
        sec.querySelectorAll('[data-s]').forEach(i => { s[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.value; });
        s.leader_prizes = [0, 1, 2].map(i => sec.querySelector('[data-lp="' + i + '"]').value);
        sec.querySelectorAll('.wa-m').forEach(row => { const m = data.missions[Number(row.dataset.i)]; row.querySelectorAll('[data-m]').forEach(i => { m[i.dataset.m] = i.value; }); });
        sec.querySelectorAll('[data-star]').forEach(i => { data.stars.find(x => x.star === Number(i.dataset.star)).reward = i.value; });
    };
    const bind = () => {
        sec.querySelector('[data-add]').addEventListener('click', () => { pull(); data.missions.push({id: '', title: 'Новая миссия', description: '', metric: data.metrics[0].key, target: 1, level_after: 0, reward: 'Шары 100', image: '', enabled: true}); draw(); });
        sec.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { pull(); if (confirm('Удалить миссию?')) { data.missions.splice(Number(b.dataset.del), 1); draw(); } }));
        sec.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => { pull(); const i = Number(b.dataset.up); if (i > 0) { [data.missions[i - 1], data.missions[i]] = [data.missions[i], data.missions[i - 1]]; draw(); } }));
        sec.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => { pull(); const i = Number(b.dataset.down); if (i < data.missions.length - 1) { [data.missions[i + 1], data.missions[i]] = [data.missions[i], data.missions[i + 1]]; draw(); } }));
        sec.querySelector('[data-save]').addEventListener('click', async () => {
            pull();
            const s = data.settings;
            try { data = await api('admin/wanted', {settings: {enabled: s.enabled, title: s.title, subtitle: s.subtitle, starts_at: s.starts_at, ends_at: s.ends_at, release_at: s.release_at, day_one_stars: s.day_one_stars, bonus_mult: s.bonus_mult, bonus_hours: s.bonus_hours, leader_prizes: s.leader_prizes}, missions: data.missions, stars: data.stars}); toast('Сохранено'); draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-reset]').addEventListener('click', async () => {
            const id = sec.querySelector('[data-rid]').value.trim();
            if (!id || !confirm('Сбросить прогресс игрока ' + id + '? Выданные награды не отбираются.')) return;
            try { const r = await api('admin/wanted/reset', {user_id: id}); toast('Сброшено миссий: ' + r.removed); } catch (err) { toast(err.message); }
        });
    };
    draw();
    content.appendChild(sec);
}
window.crafterWantedAdmin = {admin};
})();
