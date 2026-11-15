/* Admin → Управление сезоном → «Розыск»: the switch and the dates of the event, the missions, the prizes of the stars and the prizes of the top «Король Вайс-Сити».
   Every prize is picked from the REAL catalog (packs, badges, chests, drops, balls, GRAM, gifts and NFT) in the same window as in the pass, and is shown as a card with a picture. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const fmt = ts => typeof ts === 'string' ? ts : ts ? new Date((ts + 3 * 3600) * 1000).toISOString().slice(0, 16) : '';          // numbers come from the server, strings are what the field holds          // «ГГГГ-ММ-ДДTЧЧ:ММ», Moscow time (the field of the date and time)

async function admin(content) {
    let data, open = new Set([0]), packs = [], STARS = [], CHESTS = [], DROPS = [], COLS = [], EMOJIS = [];
    const MODELS = {};
    try { data = await api('admin/wanted'); } catch (_) { return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    try { EMOJIS = (await api('admin/emojis')).emojis.filter(x => x.enabled).map(x => ({...x, image: x.image || '/static/assets/emoji/badge.svg'})); } catch (_) {}
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) {}
    try { CHESTS = (await api('admin/new-year/chests')).chests.map(c => c.chest); } catch (_) {}
    try { DROPS = (await api('admin/drops')).drops; } catch (_) {}
    try { COLS = (await api('admin/new-year/catalog')).collections; } catch (_) {}
    if (!content.isConnected) return;
    const loadModels = async cid => { if (MODELS[cid] !== undefined) return; MODELS[cid] = null; try { MODELS[cid] = (await api('admin/new-year/catalog/' + encodeURIComponent(cid) + '/models')).models; } catch (_) { MODELS[cid] = []; } };
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section wa-wrap';
    sec.dataset.pane = 'wanted';

    /* a prize as a card: the picture, the name, how many */
    const info = r => r.kind === 'PACK' ? {img: packs.find(p => p.id === r.amount)?.image || '', name: packs.find(p => p.id === r.amount)?.title || 'Пак', n: '×' + r.count}
        : r.kind === 'CHEST' ? {img: CHESTS.find(c => c.id === r.amount)?.image || '', name: CHESTS.find(c => c.id === r.amount)?.title || 'Ящик', n: '×' + r.count}
        : r.kind === 'DROP' ? {img: DROPS.find(c => c.id === r.amount)?.image || '', name: DROPS.find(c => c.id === r.amount)?.title || 'Дроп', n: '×' + r.count}
        : r.kind === 'EMOJI' ? {img: EMOJIS.find(c => c.id === r.amount)?.image || '/static/assets/emoji/badge.svg', name: 'Значок «' + (EMOJIS.find(c => c.id === r.amount)?.title || r.amount) + '»', n: ''}
        : r.kind === 'GRAM' ? {img: '/static/assets/gram.svg', name: 'GRAM', n: String(r.amount)} : r.kind === 'BALL' ? {img: '/static/assets/new-year-ornament.svg', name: (window.crafterCurrency || {name: 'Шары'}).name, n: num(r.amount)}
        : r.kind === 'STAR' ? {img: STARS.find(x => x.key === r.amount)?.image || '', name: STARS.find(x => x.key === r.amount)?.name || 'Подарок Telegram', n: '×' + r.count}
        : {img: '', name: String(r.amount).split(':').slice(1).join(':') || 'NFT', n: 'NFT'};
    const cells = (list, path) => '<div class="wa-cells">' + list.map((r, i) => { const v = info(r); return '<span class="wa-cell" title="' + e(v.name) + '"><button type="button" class="wa-x" data-rwdel="' + path + '.' + i + '" aria-label="Убрать">×</button>' +
        (v.img ? '<img src="' + e(v.img) + '" alt="">' : '<i class="wa-nft">NFT</i>') + '<b>' + e(v.name) + '</b>' + (v.n ? '<small>' + e(v.n) + '</small>' : '') + '</span>'; }).join('') +
        '<button type="button" class="wa-plus" data-rwadd="' + path + '"><span>+</span><small>Добавить</small></button></div>';
    /* where a prize list lives: m.<mission> / s.<star> / l.<place> */
    const target = path => { const [k, i] = path.split('.'); return k === 'm' ? data.missions[+i].reward : k === 's' ? data.stars.find(x => x.star === +i).reward : (data.settings.leader_rewards[i] = data.settings.leader_rewards[i] || []); };

    const status = s => !s.enabled ? ['off', 'Выключено', 'Игроки не видят событие. Включите, когда всё готово.'] :
        !s.starts_at ? ['soon', 'Включено', 'Старт будет поставлен на момент сохранения.'] : ['on', 'Идёт', 'Прогресс игроков считается с ' + fmt(s.starts_at).replace('T', ' ') + ' (МСК).'];
    const missionHTML = (m, i) => {
        const metric = (data.metrics.find(x => x.key === m.metric) || {title: m.metric}).title;
        const isOpen = open.has(i);
        return '<div class="wa-m' + (isOpen ? ' is-open' : '') + '" data-i="' + i + '"><div class="wa-m-h" data-toggle="' + i + '">' +
            '<span class="wa-m-n">' + (i + 1) + '</span>' + (m.image ? '<img src="' + e(m.image) + '" alt="">' : '<i></i>') +
            '<div><b>' + e(m.title) + '</b><small>' + e(metric) + ': ' + e(m.target) + ' · ★' + e(m.level_after) + ' · призов: ' + (m.reward || []).length + '</small></div>' +
            '<span class="wa-m-act"><button type="button" data-up="' + i + '" title="Выше">↑</button><button type="button" data-down="' + i + '" title="Ниже">↓</button><i class="wa-chev"></i></span></div>' +
            '<div class="wa-m-b"><div class="wa-grid">' +
            '<label>Название<input data-m="title" value="' + e(m.title) + '"></label><label>Описание для игрока<input data-m="description" value="' + e(m.description) + '"></label>' +
            '<label>Что считать<select data-m="metric">' + data.metrics.map(x => '<option value="' + e(x.key) + '"' + (x.key === m.metric ? ' selected' : '') + '>' + e(x.title) + '</option>').join('') + '</select></label>' +
            '<label>Сколько нужно<input data-m="target" inputmode="numeric" value="' + e(m.target) + '"></label>' +
            '<label>Звёзд розыска после миссии<select data-m="level_after">' + [0, 1, 2, 3, 4, 5].map(n => '<option value="' + n + '"' + (Number(m.level_after) === n ? ' selected' : '') + '>' + (n ? '★'.repeat(n) : 'без звезды') + '</option>').join('') + '</select></label>' +
            '<label>Картинка (ссылка)<input data-m="image" value="' + e(m.image) + '"></label></div>' +
            '<div class="wa-full"><span class="wa-lab">Награда за миссию</span>' + cells(m.reward || [], 'm.' + i) + '</div>' +
            '<input type="hidden" data-m="id" value="' + e(m.id) + '"><div class="wa-m-f"><button type="button" class="is-danger" data-del="' + i + '">Удалить миссию</button></div></div></div>';
    };
    const topHTML = () => {
        const s = data.settings, places = Number(s.leader_places) || 3;
        const paid = data.payouts || [];
        return '<div class="wa-card"><h4>Топ «Король Вайс-Сити» <small>очки считаются с начала события</small></h4>' +
            '<label class="wa-inline">Сколько мест получают награды<select data-s="leader_places">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => '<option value="' + n + '"' + (n === places ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
            '<div class="wa-places">' + Array.from({length: places}, (_, k) => '<div class="wa-place"><div class="wa-place-n">' + (k + 1) + '</div><div class="wa-place-b">' + cells((s.leader_rewards || {})[String(k + 1)] || [], 'l.' + (k + 1)) + '</div></div>').join('') + '</div>' +
            (paid.length ? '<div class="wa-paid"><b>Награды выданы</b>' + paid.map(p => '<span>' + p.place + ' место · ' + e(p.user_id) + ' · ' + num(p.points) + ' очк.</span>').join('') + '<button type="button" data-payreset>Очистить запись о выдаче</button></div>' :
                '<div class="wa-pay"><div><b>Выдать награды лидерам</b><small>Сейчас в топе: ' + ((data.top || []).length ? data.top.map(t => t.place + '. ' + t.user_id + ' (' + num(t.points) + ')').join(' · ') : 'пока никого') + '. Выдаётся один раз, сохраните награды перед выдачей.</small></div><button type="button" class="primary" data-pay>Выдать</button></div>') + '</div>';
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
            data.stars.map(x => '<div class="wa-star"><b>' + '★'.repeat(x.star) + '</b>' + cells(x.reward || [], 's.' + x.star) + '</div>').join('') + '</div></div>' +
            topHTML() +
            '<div class="wa-card"><h4>Сбросить прогресс игрока</h4><div class="wa-reset"><input data-rid inputmode="numeric" placeholder="Telegram ID"><button type="button" data-reset>Сбросить</button></div><small>Выданные награды не отбираются.</small></div>' +
            '<div class="wa-save"><button type="button" class="primary" data-save>Сохранить</button></div>';
        bind();
    };
    const pull = () => {
        const s = data.settings;
        sec.querySelectorAll('[data-s]').forEach(i => { s[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.value; });
        sec.querySelectorAll('.wa-m').forEach(row => { const m = data.missions[Number(row.dataset.i)]; row.querySelectorAll('[data-m]').forEach(i => { m[i.dataset.m] = i.value; }); });
    };
    const payload = () => { const s = data.settings; return {settings: {enabled: s.enabled, title: s.title, subtitle: s.subtitle, starts_at: s.starts_at, ends_at: s.ends_at, release_at: s.release_at, day_one_stars: s.day_one_stars, bonus_mult: s.bonus_mult, bonus_hours: s.bonus_hours, leader_places: s.leader_places, leader_rewards: s.leader_rewards}, missions: data.missions, stars: data.stars}; };
    const bind = () => {
        sec.querySelectorAll('[data-rwadd]').forEach(b => b.addEventListener('click', () => { pull(); const path = b.dataset.rwadd; window.crafterRewardPicker.open({emojis: EMOJIS, packs, chests: CHESTS, drops: DROPS, stars: STARS, cols: COLS, models: async cid => { await loadModels(cid); return MODELS[cid] || []; }}, x => { target(path).push(x); draw(); }); }));
        sec.querySelectorAll('[data-rwdel]').forEach(b => b.addEventListener('click', () => { pull(); const parts = b.dataset.rwdel.split('.'); const i = Number(parts.pop()); target(parts.join('.')).splice(i, 1); draw(); }));
        sec.querySelectorAll('[data-toggle]').forEach(h => h.addEventListener('click', ev => { if (ev.target.closest('button')) return; pull(); const i = Number(h.dataset.toggle); open.has(i) ? open.delete(i) : open.add(i); draw(); }));
        sec.querySelector('[data-add]').addEventListener('click', () => { pull(); data.missions.push({id: '', title: 'Новая миссия', description: '', metric: data.metrics[0].key, target: 1, level_after: 0, reward: [{kind: 'BALL', amount: '100', count: 1}], image: '', enabled: true}); open.add(data.missions.length - 1); draw(); });
        sec.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { pull(); if (confirm('Удалить миссию?')) { data.missions.splice(Number(b.dataset.del), 1); open = new Set(); draw(); } }));
        const swap = (i, j) => { pull(); if (j < 0 || j >= data.missions.length) return; [data.missions[i], data.missions[j]] = [data.missions[j], data.missions[i]]; open = new Set([j]); draw(); };
        sec.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => swap(Number(b.dataset.up), Number(b.dataset.up) - 1)));
        sec.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => swap(Number(b.dataset.down), Number(b.dataset.down) + 1)));
        sec.querySelector('[data-s="enabled"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelector('[data-s="leader_places"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelector('[data-save]').addEventListener('click', async () => {
            pull();
            try { data = await api('admin/wanted', payload()); toast('Сохранено'); draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-pay]')?.addEventListener('click', async () => {
            pull();
            if (!confirm('Выдать награды лучшим игрокам из топа? Это можно сделать только один раз.')) return;
            try { await api('admin/wanted', payload()); data = await api('admin/wanted/payout', {}); toast('Награды выданы'); draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-payreset]')?.addEventListener('click', async () => {
            if (!confirm('Очистить запись о выдаче? Выданные награды останутся у игроков, но выдачу можно будет повторить.')) return;
            try { data = await api('admin/wanted/payout/reset', {}); draw(); } catch (err) { toast(err.message); }
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
