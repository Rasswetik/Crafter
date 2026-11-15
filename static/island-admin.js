/* Админка → «Остров сокровищ»: переключатель, цены билетов, жизни, таблицы добычи по глубине, награда за босса, призы «Капитанов».
   Каждая награда выбирается из реального каталога (паки, значки, ящики, дропы, шары, GRAM, подарки, NFT) тем же окном, что в пассе. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const TIERS = [['0', 'Мелкая добыча', 'ряды 1-3'], ['1', 'Средняя добыча', 'ряды 4-6'], ['2', 'Крупная добыча', 'ряды 7-8, лучшие находки']];

async function admin(content) {
    let data, packs = [], STARS = [], CHESTS = [], DROPS = [], COLS = [], EMOJIS = [];
    const MODELS = {};
    try { data = await api('admin/island'); } catch (_) { return; }
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
    sec.dataset.pane = 'island';

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
    /* where a prize list lives: b (boss) / l.<place> / t.<tier>.<entry> */
    const target = path => { const p = path.split('.'); const s = data.settings; return p[0] === 'b' ? s.boss_rewards : p[0] === 'l' ? (s.leader_rewards[p[1]] = s.leader_rewards[p[1]] || []) : s.loot[p[1]][+p[2]].reward; };

    const tierHTML = ([t, title, hint]) => '<div class="wa-card"><h4>' + title + ' <small>' + hint + '</small></h4><div class="wa-ms">' + (data.settings.loot[t] || []).map((en, i) =>
        '<div class="wa-place"><div class="wa-place-b"><label class="wa-inline">Вес (шанс)<input data-w="' + t + '.' + i + '" inputmode="numeric" value="' + e(en.weight) + '"></label>' + cells(en.reward, 't.' + t + '.' + i) + '</div>' +
        '<button type="button" data-ldel="' + t + '.' + i + '" title="Удалить строку">×</button></div>').join('') + '</div><button type="button" class="wa-add" data-ladd="' + t + '">+ Добавить вариант добычи</button></div>';
    const topHTML = () => {
        const s = data.settings, places = Number(s.leader_places) || 3;
        const paid = data.paid[data.prev_week] || [];
        return '<div class="wa-card"><h4>Капитаны недели <small>очки: глубина, победа, возвращение с добычей</small></h4>' +
            '<label class="wa-inline">Сколько мест получают награды<select data-s="leader_places">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => '<option value="' + n + '"' + (n === places ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
            '<div class="wa-places">' + Array.from({length: places}, (_, k) => '<div class="wa-place"><div class="wa-place-n">' + (k + 1) + '</div><div class="wa-place-b">' + cells((s.leader_rewards || {})[String(k + 1)] || [], 'l.' + (k + 1)) + '</div></div>').join('') + '</div>' +
            (paid.length ? '<div class="wa-paid"><b>Награды за ' + e(data.prev_week) + ' выданы</b>' + paid.map(p => '<span>' + p.place + ' место · ' + e(p.user_id) + ' · ' + num(p.score) + ' очк.</span>').join('') + '</div>' :
                '<div class="wa-pay"><div><b>Выдать награды за прошлую неделю (' + e(data.prev_week) + ')</b><small>В топе: ' + (data.top_prev.length ? data.top_prev.map(t => t.place + '. ' + t.user_id + ' (' + num(t.score) + ')').join(' · ') : 'никого') + '. Один раз; сохраните награды перед выдачей.</small></div><button type="button" class="primary" data-pay>Выдать</button></div>') + '</div>';
    };
    const draw = () => {
        const s = data.settings, st = data.stats;
        sec.innerHTML = '<div class="wa-hero is-' + (s.enabled ? 'on' : 'off') + '"><div><h3>Остров сокровищ</h3><p>' + (s.enabled ? 'Режим открыт для игроков.' : 'Выключено: игроки не могут начать экспедицию.') + ' Забегов: ' + st.runs + ', побед над боссом: ' + st.won + ', потеряно: ' + st.dead + ', с добычей: ' + st.cashed + '.</p><small>Страница: /island</small></div>' +
            '<label class="wa-switch"><input type="checkbox" data-s="enabled"' + (s.enabled ? ' checked' : '') + '><i></i><b>' + (s.enabled ? 'Включено' : 'Выключено') + '</b></label></div>' +
            '<div class="wa-card"><h4>Тексты</h4><div class="wa-grid"><label>Название<input data-s="title" value="' + e(s.title) + '"></label><label>Подпись<input data-s="subtitle" value="' + e(s.subtitle) + '"></label></div></div>' +
            '<div class="wa-card"><h4>Билеты и правила</h4><div class="wa-grid">' + [['ticket_price', 'Цена билета (шары)'], ['free_daily', 'Бесплатных билетов в день'], ['ticket_max', 'Копится бесплатных, максимум'], ['buy_max', 'Всего билетов у игрока, максимум'], ['lives', 'Жизней в забеге'], ['death_loss', 'Потеря добычи при гибели, %'],
                ['daily_balls_cap', 'Лимит шаров из режима на игрока в сутки'], ['price_heal', 'Торговец: жизнь, цена'], ['price_luck', 'Торговец: удача, цена'], ['price_relic', 'Торговец: реликвия, цена'], ['relic_dupe_balls', 'Шаров вместо повторной реликвии']].map(f => '<label>' + f[1] + '<input data-s="' + f[0] + '" inputmode="numeric" value="' + e(s[f[0]]) + '"></label>').join('') + '</div></div>' +
            TIERS.map(tierHTML).join('') +
            '<div class="wa-card"><h4>Награда за победу над боссом <small>выдаётся вместе с добычей</small></h4>' + cells(s.boss_rewards || [], 'b') + '</div>' + topHTML() +
            '<div class="wa-card"><h4>Игроки</h4><div class="wa-reset"><input data-tid inputmode="numeric" placeholder="Telegram ID"><input data-tn inputmode="numeric" value="1" style="max-width:80px"><button type="button" data-tickets>Выдать билеты</button><button type="button" data-void>Закрыть забег</button></div><small>Билеты: число может быть отрицательным. «Закрыть забег» снимает зависший забег без наград и возвращает билет.</small></div>' +
            '<div class="wa-card"><h4>Реликвии</h4><div class="wa-cells">' + data.relics.map(r => '<span class="wa-cell" title="' + e(r.text) + '"><img src="' + e(r.image) + '" alt=""><b>' + e(r.title) + '</b><small>' + e(r.rarity) + '</small></span>').join('') + '</div><small>Набор и эффекты реликвий зашиты в игру. Находятся в сундуках, у стражей, у торговца и за босса.</small></div>' +
            '<div class="wa-save"><button type="button" class="primary" data-save>Сохранить</button></div>';
        bind();
    };
    const pull = () => {
        const s = data.settings;
        sec.querySelectorAll('[data-s]').forEach(i => { s[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.value; });
        sec.querySelectorAll('[data-w]').forEach(i => { const [t, k] = i.dataset.w.split('.'); s.loot[t][+k].weight = i.value; });
    };
    const bind = () => {
        sec.querySelectorAll('[data-rwadd]').forEach(b => b.addEventListener('click', () => { pull(); const path = b.dataset.rwadd; window.crafterRewardPicker.open({emojis: EMOJIS, packs, chests: CHESTS, drops: DROPS, stars: STARS, cols: COLS, models: async cid => { await loadModels(cid); return MODELS[cid] || []; }}, x => { target(path).push(x); draw(); }); }));
        sec.querySelectorAll('[data-rwdel]').forEach(b => b.addEventListener('click', () => { pull(); const parts = b.dataset.rwdel.split('.'); const i = Number(parts.pop()); target(parts.join('.')).splice(i, 1); draw(); }));
        sec.querySelectorAll('[data-ladd]').forEach(b => b.addEventListener('click', () => { pull(); data.settings.loot[b.dataset.ladd].push({weight: 10, reward: [{kind: 'BALL', amount: '100', count: 1}]}); draw(); }));
        sec.querySelectorAll('[data-ldel]').forEach(b => b.addEventListener('click', () => { pull(); const [t, k] = b.dataset.ldel.split('.'); if (data.settings.loot[t].length < 2) { toast('Нужна хотя бы одна строка'); return; } data.settings.loot[t].splice(+k, 1); draw(); }));
        sec.querySelector('[data-s="enabled"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelector('[data-s="leader_places"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelector('[data-save]').addEventListener('click', async () => { pull(); try { data = await api('admin/island', data.settings); toast('Сохранено'); draw(); } catch (err) { toast(err.message); } });
        sec.querySelector('[data-pay]')?.addEventListener('click', async () => {
            pull();
            if (!confirm('Выдать награды лучшим капитанам за прошлую неделю? Это можно сделать только один раз.')) return;
            try { await api('admin/island', data.settings); data = await api('admin/island/payout', {week: data.prev_week}); toast('Награды выданы'); draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-tickets]').addEventListener('click', async () => {
            const id = sec.querySelector('[data-tid]').value.trim(), n = sec.querySelector('[data-tn]').value.trim();
            if (!id) return;
            try { const r = await api('admin/island/tickets', {user_id: id, amount: n}); toast('Теперь билетов: ' + r.tickets); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-void]').addEventListener('click', async () => {
            const id = sec.querySelector('[data-tid]').value.trim();
            if (!id || !confirm('Закрыть активный забег игрока ' + id + ' без наград?')) return;
            try { await api('admin/island/reset', {user_id: id}); toast('Забег закрыт, билет возвращён'); } catch (err) { toast(err.message); }
        });
    };
    draw();
    content.appendChild(sec);
}
window.crafterIslandAdmin = {admin};
})();
