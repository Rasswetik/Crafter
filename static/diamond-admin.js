/* Админка → «Казино Diamond»: переключатель, цены и лимиты прокруток, 12 секторов колеса (награда из каталога, вес, уровень), VIP-уровни и джекпот.
   Награды выбираются из реального каталога тем же окном, что в пассе и в «Розыске». */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const TIERS = [['common', 'Обычный'], ['rare', 'Редкий'], ['epic', 'Эпический'], ['jackpot', 'Джекпот']];
const NUMS = [['free_daily', 'Бесплатных прокруток в день'], ['max_paid', 'Платных прокруток в день'], ['price_base', 'Цена первой платной (шары)'], ['price_step', 'Рост цены за каждую следующую'], ['pity_every', 'Гарантированный приз каждые N платных'],
    ['jackpot_start', 'Стартовый джекпот'], ['jackpot_rake', 'Доля платной прокрутки в джекпот, %'], ['xp_free', 'VIP-опыт за бесплатную'], ['xp_paid', 'VIP-опыт за платную']];

async function admin(content) {
    let data, packs = [], STARS = [], CHESTS = [], DROPS = [], COLS = [], EMOJIS = [];
    const MODELS = {};
    try { data = await api('admin/diamond'); } catch (_) { return; }
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
    sec.dataset.pane = 'diamond';

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
    const target = path => data.settings.sectors[+path.split('.')[1]].reward;

    const draw = () => {
        const s = data.settings, st = data.stats, total = s.sectors.reduce((a, x) => a + (Number(x.weight) || 0), 0) || 1;
        sec.innerHTML = '<div class="wa-hero is-' + (s.enabled ? 'on' : 'off') + '"><div><h3>Казино Diamond</h3><p>' + (s.enabled ? 'Казино открыто для игроков.' : 'Выключено: игроки не видят казино.') + ' Прокруток: ' + num(st.spins) + ', платных: ' + num(st.paid) + ', выручка: ' + num(st.income) + '. Джекпот сейчас: ' + num(data.pool) + '.</p><small>Страница: /season/diamond</small></div>' +
            '<label class="wa-switch"><input type="checkbox" data-s="enabled"' + (s.enabled ? ' checked' : '') + '><i></i><b>' + (s.enabled ? 'Включено' : 'Выключено') + '</b></label></div>' +
            '<div class="wa-card"><h4>Тексты</h4><div class="wa-grid"><label>Название<input data-s="title" value="' + e(s.title) + '"></label><label>Подпись<input data-s="subtitle" value="' + e(s.subtitle) + '"></label></div></div>' +
            '<div class="wa-card"><h4>Прокрутки и джекпот</h4><div class="wa-grid">' + NUMS.map(f => '<label>' + f[1] + '<input data-s="' + f[0] + '" inputmode="numeric" value="' + e(s[f[0]]) + '"></label>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>VIP-уровни <small>Бронза, Серебро, Золото, Бриллиант</small></h4><div class="wa-grid">' +
            [['vip_xp', 'Нужно опыта'], ['vip_extra_free', 'Бонусных бесплатных в день'], ['vip_discount', 'Скидка на платные, %']].map(g => '<div class="wa-full"><span class="wa-lab">' + g[1] + '</span><div style="display:flex;gap:6px">' + s[g[0]].map((v, i) => '<input data-v="' + g[0] + '.' + i + '" inputmode="numeric" value="' + e(v) + '"' + (g[0] === 'vip_xp' && i === 0 ? ' disabled' : '') + '>').join('') + '</div></div>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>12 секторов колеса <small>порядок: сектор 1 вверху, дальше по часовой стрелке. Нужен хотя бы один сектор джекпота и один редкий или эпический (для гарантии)</small></h4><div class="wa-places">' +
            s.sectors.map((x, i) => '<div class="wa-place"><div class="wa-place-n">' + (i + 1) + '</div><div class="wa-place-b"><div class="wa-grid"><label>Уровень<select data-t="' + i + '">' + TIERS.map(t => '<option value="' + t[0] + '"' + (x.tier === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('') + '</select></label>' +
                '<label>Вес (шанс ' + (Math.round((Number(x.weight) || 0) / total * 10000) / 100) + '%)<input data-w="' + i + '" inputmode="numeric" value="' + e(x.weight) + '"></label></div>' +
                (x.tier === 'jackpot' ? '<small>Джекпот отдаёт весь банк, награда ниже нужна только если хотите добавить к банку что-то ещё.</small>' : '') + cells(x.reward, 's.' + i) + '</div></div>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>Банк джекпота</h4><div class="wa-reset"><input data-pool inputmode="numeric" placeholder="Новый банк"><button type="button" data-setpool>Поставить</button></div>' +
            (data.jackpots.length ? '<div class="wa-paid"><b>Последние джекпоты</b>' + data.jackpots.map(j => '<span>' + e(j.name || j.user_id) + ': ' + num(j.amount) + '</span>').join('') + '</div>' : '') + '</div>' +
            '<div class="wa-save"><button type="button" class="primary" data-save>Сохранить</button></div>';
        bind();
    };
    const pull = () => {
        const s = data.settings;
        sec.querySelectorAll('[data-s]').forEach(i => { s[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.value; });
        sec.querySelectorAll('[data-v]').forEach(i => { const [k, n] = i.dataset.v.split('.'); s[k][+n] = i.value; });
        sec.querySelectorAll('[data-t]').forEach(i => { s.sectors[+i.dataset.t].tier = i.value; });
        sec.querySelectorAll('[data-w]').forEach(i => { s.sectors[+i.dataset.w].weight = i.value; });
    };
    const bind = () => {
        sec.querySelectorAll('[data-rwadd]').forEach(b => b.addEventListener('click', () => { pull(); const path = b.dataset.rwadd; window.crafterRewardPicker.open({emojis: EMOJIS, packs, chests: CHESTS, drops: DROPS, stars: STARS, cols: COLS, models: async cid => { await loadModels(cid); return MODELS[cid] || []; }}, x => { target(path).push(x); draw(); }); }));
        sec.querySelectorAll('[data-rwdel]').forEach(b => b.addEventListener('click', () => { pull(); const parts = b.dataset.rwdel.split('.'); const i = Number(parts.pop()); target(parts.join('.')).splice(i, 1); draw(); }));
        sec.querySelector('[data-s="enabled"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelectorAll('[data-t],[data-w]').forEach(i => i.addEventListener('change', () => { pull(); draw(); }));
        sec.querySelector('[data-save]').addEventListener('click', async () => { pull(); try { data = await api('admin/diamond', data.settings); toast('Сохранено'); draw(); } catch (err) { toast(err.message); } });
        sec.querySelector('[data-setpool]').addEventListener('click', async () => {
            const v = sec.querySelector('[data-pool]').value.trim();
            if (!v || !confirm('Поставить банк джекпота ' + v + '?')) return;
            try { data = await api('admin/diamond/pool', {amount: v}); toast('Банк обновлён'); draw(); } catch (err) { toast(err.message); }
        });
    };
    draw();
    content.appendChild(sec);
}
window.crafterDiamondAdmin = {admin};
})();
