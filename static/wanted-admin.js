/* Admin → Управление сезоном → «Розыск»: the switch and the dates of the event, the missions (what to do, how many, the prizes, the wanted level), the prizes of the stars,
   the leaders and the bonus day. Prizes are written as text («Шары 100; Пак vicecity ×2; Значок wisecraft-cash») and have buttons that add the pieces. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = ts => ts ? new Date((ts + 3 * 3600) * 1000).toISOString().slice(0, 16) : '';          // «ГГГГ-ММ-ДДTЧЧ:ММ», Moscow time (the field of the date and time)
const QUICK = [['Шары', 'Шары 100'], ['GRAM', 'GRAM 0.5'], ['Пак', 'Пак vicecity'], ['Ящик', 'Ящик vicecapsule'], ['Значок', 'Значок wisecraft-cash']];

async function admin(content) {
    let data, open = new Set([0]);
    try { data = await api('admin/wanted'); } catch (_) { return; }
    if (!content.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section wa-wrap';
    sec.dataset.pane = 'wanted';

    const status = s => !s.enabled ? ['off', 'Выключено', 'Игроки не видят событие. Включите, когда всё готово.'] :
        !s.starts_at ? ['soon', 'Включено', 'Старт будет поставлен на момент сохранения.'] : ['on', 'Идёт', 'Прогресс игроков считается с ' + fmt(s.starts_at).replace('T', ' ') + ' (МСК).'];
    const reward = (k, v, ph) => '<div class="wa-rw"><input data-' + k + ' value="' + e(v) + '" placeholder="' + e(ph) + '"><span>' + QUICK.map(q => '<button type="button" data-q="' + e(q[1]) + '">+ ' + q[0] + '</button>').join('') + '</span></div>';
    const missionHTML = (m, i) => {
        const metric = (data.metrics.find(x => x.key === m.metric) || {title: m.metric}).title;
        const isOpen = open.has(i);
        return '<div class="wa-m' + (isOpen ? ' is-open' : '') + '" data-i="' + i + '"><div class="wa-m-h" data-toggle="' + i + '">' +
            '<span class="wa-m-n">' + (i + 1) + '</span>' + (m.image ? '<img src="' + e(m.image) + '" alt="">' : '<i></i>') +
            '<div><b>' + e(m.title) + '</b><small>' + e(metric) + ': ' + e(m.target) + ' · ★' + e(m.level_after) + ' · ' + e(m.reward || 'без награды') + '</small></div>' +
            '<span class="wa-m-act"><button type="button" data-up="' + i + '" title="Выше">↑</button><button type="button" data-down="' + i + '" title="Ниже">↓</button><i class="wa-chev"></i></span></div>' +
            '<div class="wa-m-b"><div class="wa-grid">' +
            '<label>Название<input data-m="title" value="' + e(m.title) + '"></label>' +
            '<label>Описание для игрока<input data-m="description" value="' + e(m.description) + '"></label>' +
            '<label>Что считать<select data-m="metric">' + data.metrics.map(x => '<option value="' + e(x.key) + '"' + (x.key === m.metric ? ' selected' : '') + '>' + e(x.title) + '</option>').join('') + '</select></label>' +
            '<label>Сколько нужно<input data-m="target" inputmode="numeric" value="' + e(m.target) + '"></label>' +
            '<label>Звёзд розыска после миссии<select data-m="level_after">' + [0, 1, 2, 3, 4, 5].map(n => '<option value="' + n + '"' + (Number(m.level_after) === n ? ' selected' : '') + '>' + (n ? '★'.repeat(n) : 'без звезды') + '</option>').join('') + '</select></label>' +
            '<label>Картинка (ссылка)<input data-m="image" value="' + e(m.image) + '"></label></div>' +
            '<label class="wa-full">Награда<span class="wa-hint">пример: Шары 100; Пак vicecity ×2</span>' + reward('mr', m.reward, 'Шары 100') + '</label>' +
            '<input type="hidden" data-m="id" value="' + e(m.id) + '"><div class="wa-m-f"><button type="button" class="is-danger" data-del="' + i + '">Удалить миссию</button></div></div></div>';
    };
    const draw = () => {
        const s = data.settings, st = status(s);
        sec.innerHTML = '<div class="wa-hero is-' + st[0] + '"><div><h3>Розыск: Vice City</h3><p>' + e(st[2]) + '</p><small>Страница события: /season/wanted</small></div>' +
            '<label class="wa-switch"><input type="checkbox" data-s="enabled"' + (s.enabled ? ' checked' : '') + '><i></i><b>' + st[1] + '</b></label></div>' +
            '<div class="wa-card"><h4>Тексты и даты <small>время по Москве</small></h4><div class="wa-grid">' +
            '<label>Название<input data-s="title" value="' + e(s.title) + '"></label><label>Подпись под названием<input data-s="subtitle" value="' + e(s.subtitle) + '"></label>' +
            '<label>Старт события<input type="datetime-local" data-s="starts_at" value="' + fmt(s.starts_at) + '"></label><label>Конец (можно пусто)<input type="datetime-local" data-s="ends_at" value="' + fmt(s.ends_at) + '"></label>' +
            '<label>Выход игры (для отсчёта)<input type="datetime-local" data-s="release_at" value="' + fmt(s.release_at) + '"></label></div></div>' +
            '<div class="wa-card"><h4>День релиза</h4><div class="wa-grid">' +
            '<label>Звёзд для значка Day One<select data-s="day_one_stars">' + [1, 2, 3, 4, 5].map(n => '<option value="' + n + '"' + (Number(s.day_one_stars) === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
            '<label>Награды в шарах ×<input data-s="bonus_mult" inputmode="numeric" value="' + e(s.bonus_mult) + '"></label><label>Бонус длится, часов<input data-s="bonus_hours" inputmode="numeric" value="' + e(s.bonus_hours) + '"></label></div></div>' +
            '<div class="wa-card"><h4>Миссии <small>открываются по порядку сверху вниз</small></h4><div class="wa-ms">' + data.missions.map(missionHTML).join('') + '</div><button type="button" class="wa-add" data-add>+ Добавить миссию</button></div>' +
            '<div class="wa-card"><h4>Награды за звёзды <small>выдаются сами, когда уровень розыска дорастает до звезды</small></h4><div class="wa-stars">' +
            data.stars.map(x => '<label><b>' + '★'.repeat(x.star) + '</b>' + reward('sr' + x.star, x.reward, 'Значок wisecraft-wanted') + '</label>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>Призы «Короля Вайс-Сити» <small>показываются игрокам; выдайте их вручную после конца события</small></h4><div class="wa-grid">' +
            [0, 1, 2].map(i => '<label>' + (i + 1) + ' место<input data-lp="' + i + '" value="' + e((s.leader_prizes || [])[i] || '') + '"></label>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>Сбросить прогресс игрока</h4><div class="wa-reset"><input data-rid inputmode="numeric" placeholder="Telegram ID"><button type="button" data-reset>Сбросить</button></div><small>Выданные награды не отбираются.</small></div>' +
            '<div class="wa-save"><button type="button" class="primary" data-save>Сохранить</button></div>';
        bind();
    };
    const pull = () => {
        const s = data.settings;
        sec.querySelectorAll('[data-s]').forEach(i => { s[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.value; });
        s.leader_prizes = [0, 1, 2].map(i => sec.querySelector('[data-lp="' + i + '"]').value);
        sec.querySelectorAll('.wa-m').forEach(row => {
            const m = data.missions[Number(row.dataset.i)];
            row.querySelectorAll('[data-m]').forEach(i => { m[i.dataset.m] = i.value; });
            m.reward = row.querySelector('[data-mr]').value;
        });
        data.stars.forEach(x => { x.reward = sec.querySelector('[data-sr' + x.star + ']').value; });
    };
    const bind = () => {
        sec.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { const i = b.closest('.wa-rw').querySelector('input'); i.value = (i.value.trim() ? i.value.trim().replace(/;$/, '') + '; ' : '') + b.dataset.q; i.focus(); }));
        sec.querySelectorAll('[data-toggle]').forEach(h => h.addEventListener('click', ev => { if (ev.target.closest('button')) return; pull(); const i = Number(h.dataset.toggle); open.has(i) ? open.delete(i) : open.add(i); draw(); }));
        sec.querySelector('[data-add]').addEventListener('click', () => { pull(); data.missions.push({id: '', title: 'Новая миссия', description: '', metric: data.metrics[0].key, target: 1, level_after: 0, reward: 'Шары 100', image: '', enabled: true}); open.add(data.missions.length - 1); draw(); });
        sec.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { pull(); if (confirm('Удалить миссию?')) { data.missions.splice(Number(b.dataset.del), 1); open = new Set(); draw(); } }));
        const swap = (i, j) => { pull(); if (j < 0 || j >= data.missions.length) return; [data.missions[i], data.missions[j]] = [data.missions[j], data.missions[i]]; open = new Set([j]); draw(); };
        sec.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => swap(Number(b.dataset.up), Number(b.dataset.up) - 1)));
        sec.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => swap(Number(b.dataset.down), Number(b.dataset.down) + 1)));
        sec.querySelector('[data-s="enabled"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelector('[data-save]').addEventListener('click', async () => {
            pull();
            const s = data.settings;
            try {
                data = await api('admin/wanted', {settings: {enabled: s.enabled, title: s.title, subtitle: s.subtitle, starts_at: s.starts_at, ends_at: s.ends_at, release_at: s.release_at, day_one_stars: s.day_one_stars, bonus_mult: s.bonus_mult, bonus_hours: s.bonus_hours, leader_prizes: s.leader_prizes}, missions: data.missions, stars: data.stars});
                toast('Сохранено'); draw();
            } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-reset]').addEventListener('click', async () => {
            const id = sec.querySelector('[data-rid]').value.trim();
            if (!id || !confirm('Сбросить прогресс игрока ' + id + '?')) return;
            try { const r = await api('admin/wanted/reset', {user_id: id}); toast('Сброшено миссий: ' + r.removed); } catch (err) { toast(err.message); }
        });
    };
    draw();
    content.appendChild(sec);
}
window.crafterWantedAdmin = {admin};
})();
