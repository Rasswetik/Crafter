/* Админка → «Войны банд»: переключатель, названия банд, потолок очков, множитель меньшей банды и все награды (победа, район, уровни вклада, топ).
   Каждая награда выбирается из реального каталога тем же окном, что в пассе и «Розыске». */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };

async function admin(content) {
    let data, packs = [], STARS = [], CHESTS = [], DROPS = [], COLS = [], EMOJIS = [];
    const MODELS = {};
    try { data = await api('admin/gangs'); } catch (_) { return; }
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
    sec.dataset.pane = 'gangs';

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
    /* where a prize list lives: w (win) / l (lose) / d (district) / t.<tier> / p.<place> */
    const target = path => { const [k, i] = path.split('.'); const s = data.settings; return k === 'w' ? s.win_reward : k === 'l' ? s.lose_reward : k === 'd' ? s.district_reward : k === 't' ? s.tiers[+i].reward : (s.top_rewards[i] = s.top_rewards[i] || []); };

    const draw = () => {
        const s = data.settings, places = Number(s.top_places) || 0, cnt = data.counts || {};
        sec.innerHTML = '<div class="wa-hero is-' + (s.enabled ? 'on' : 'off') + '"><div><h3>Войны банд</h3><p>' + (s.enabled ? 'Событие идёт: война ' + e(data.war) + '.' : 'Выключено: игроки не видят событие.') + ' Игроков: ' + e(s.gangs.goshan.name) + ' ' + (cnt.goshan || 0) + ', ' + e(s.gangs.nikolay.name) + ' ' + (cnt.nikolay || 0) + '.</p><small>Страница: /season/gangs</small></div>' +
            '<label class="wa-switch"><input type="checkbox" data-s="enabled"' + (s.enabled ? ' checked' : '') + '><i></i><b>' + (s.enabled ? 'Включено' : 'Выключено') + '</b></label></div>' +
            '<div class="wa-card"><h4>Тексты и банды</h4><div class="wa-grid"><label>Название<input data-s="title" value="' + e(s.title) + '"></label><label>Подпись<input data-s="subtitle" value="' + e(s.subtitle) + '"></label>' +
            ['goshan', 'nikolay'].map(id => '<label>Банда: название<input data-g="' + id + '.name" value="' + e(s.gangs[id].name) + '"></label><label>Банда: девиз<input data-g="' + id + '.slogan" value="' + e(s.gangs[id].slogan) + '"></label>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>Правила</h4><div class="wa-grid"><label>Потолок очков одного игрока в сутки (0 = без потолка)<input data-s="daily_cap" inputmode="numeric" value="' + e(s.daily_cap) + '"></label>' +
            '<label>Максимальный множитель меньшей банды, % (100 = без поддержки)<input data-s="underdog_max" inputmode="numeric" value="' + e(s.underdog_max) + '"></label><label>Очков для получения наград<input data-s="min_points" inputmode="numeric" value="' + e(s.min_points) + '"></label></div></div>' +
            '<div class="wa-card"><h4>Награды недели <small>выдаются, когда игрок нажимает «Забрать» после конца войны</small></h4>' +
            '<div class="wa-full"><span class="wa-lab">Победа банды</span>' + cells(s.win_reward, 'w') + '</div><div class="wa-full"><span class="wa-lab">Если банда проиграла (утешительная)</span>' + cells(s.lose_reward, 'l') + '</div>' +
            '<div class="wa-full"><span class="wa-lab">За каждый район своей банды</span>' + cells(s.district_reward, 'd') + '</div></div>' +
            '<div class="wa-card"><h4>Уровни личного вклада <small>берётся самый высокий достигнутый</small></h4><div class="wa-places">' + s.tiers.map((t, i) => '<div class="wa-place"><div class="wa-place-b"><label class="wa-inline">Очков<input data-t="' + i + '" inputmode="numeric" value="' + e(t.points) + '"></label>' + cells(t.reward, 't.' + i) + '</div></div>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>Общий топ недели</h4><label class="wa-inline">Сколько мест получают награды<select data-s="top_places">' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => '<option value="' + n + '"' + (n === places ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
            '<div class="wa-places">' + Array.from({length: places}, (_, k) => '<div class="wa-place"><div class="wa-place-n">' + (k + 1) + '</div><div class="wa-place-b">' + cells(s.top_rewards[String(k + 1)] || [], 'p.' + (k + 1)) + '</div></div>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>Прошедшие войны</h4>' + (data.wars.length ? data.wars.map(w => '<div class="wa-paid"><span>' + e(w.war) + ': победа ' + (w.winner ? e(s.gangs[w.winner].name) : 'ничья') + ' (' + e(s.gangs.goshan.name) + ' ' + num(w.gangs.goshan) + ', ' + e(s.gangs.nikolay.name) + ' ' + num(w.gangs.nikolay) + ')</span></div>').join('') : '<small>Пока ни одна война не завершилась.</small>') + '</div>' +
            '<div class="wa-card"><h4>Убрать игрока из банды</h4><div class="wa-reset"><input data-rid inputmode="numeric" placeholder="Telegram ID"><button type="button" data-remove>Убрать</button></div></div>' +
            '<div class="wa-save"><button type="button" class="primary" data-save>Сохранить</button></div>';
        bind();
    };
    const pull = () => {
        const s = data.settings;
        sec.querySelectorAll('[data-s]').forEach(i => { s[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.value; });
        sec.querySelectorAll('[data-g]').forEach(i => { const [id, k] = i.dataset.g.split('.'); s.gangs[id][k] = i.value; });
        sec.querySelectorAll('[data-t]').forEach(i => { s.tiers[+i.dataset.t].points = i.value; });
    };
    const bind = () => {
        sec.querySelectorAll('[data-rwadd]').forEach(b => b.addEventListener('click', () => { pull(); const path = b.dataset.rwadd; window.crafterRewardPicker.open({emojis: EMOJIS, packs, chests: CHESTS, drops: DROPS, stars: STARS, cols: COLS, models: async cid => { await loadModels(cid); return MODELS[cid] || []; }}, x => { target(path).push(x); draw(); }); }));
        sec.querySelectorAll('[data-rwdel]').forEach(b => b.addEventListener('click', () => { pull(); const parts = b.dataset.rwdel.split('.'); const i = Number(parts.pop()); target(parts.join('.')).splice(i, 1); draw(); }));
        sec.querySelector('[data-s="enabled"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelector('[data-s="top_places"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelector('[data-save]').addEventListener('click', async () => { pull(); try { data = await api('admin/gangs', data.settings); toast('Сохранено'); draw(); } catch (err) { toast(err.message); } });
        sec.querySelector('[data-remove]').addEventListener('click', async () => {
            const id = sec.querySelector('[data-rid]').value.trim();
            if (!id || !confirm('Убрать игрока ' + id + ' из банды?')) return;
            try { const r = await api('admin/gangs/remove', {user_id: id}); toast(r.removed ? 'Игрок убран' : 'Игрок не в банде'); } catch (err) { toast(err.message); }
        });
    };
    draw();
    content.appendChild(sec);
}
window.crafterGangsAdmin = {admin};
})();
