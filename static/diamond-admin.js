/* Админка → «Казино Diamond»: переключатель, четыре колеса (цены, лимиты, 12 секторов с наградами из каталога), слоты (ставки, выплаты, отдача), VIP-уровни и джекпот.
   Награды выбираются из реального каталога тем же окном, что в пассе: шары, GRAM, паки, значки, ящики, дропы, подарки Telegram и NFT. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const TIERS = [['common', 'Обычный'], ['rare', 'Редкий'], ['epic', 'Эпический'], ['jackpot', 'Джекпот']];
const VIPN = ['Бронза', 'Серебро', 'Золото', 'Бриллиант'];
const GLOBAL = [['jackpot_start', 'Стартовый джекпот'], ['jackpot_rake', 'Доля платной прокрутки колеса в джекпот, %'], ['xp_free', 'VIP-опыт за бесплатную прокрутку'], ['xp_paid', 'VIP-опыт за платную прокрутку']];
const WNUMS = [['free_daily', 'Бесплатных прокруток в день'], ['max_paid', 'Платных прокруток в день'], ['price_base', 'Цена первой платной (шары)'], ['price_step', 'Рост цены за каждую следующую'], ['pity_every', 'Гарантированный приз каждые N платных']];
const SYMN = {coin: 'Монета', cyan: 'Голубая фишка', pink: 'Розовая фишка', gold: 'Золотая фишка', silver: 'Серебряный знак', crown: 'Золотой знак', badge: 'Знак Бриллиант', diamond: 'Бриллиант (джекпот)'};
function slotRtp(sym) {
    const tot = sym.reduce((a, s) => a + Math.max(0, Number(s.weight) || 0), 0) || 1, p = {}, by = {};
    sym.forEach(s => { p[s.id] = Math.max(0, Number(s.weight) || 0) / tot; by[s.id] = s; });
    let r = 0;
    for (const a of sym) for (const b of sym) for (const c of sym) {
        const pr = p[a.id] * p[b.id] * p[c.id];
        const pay = a.id === b.id && b.id === c.id ? (a.id === 'diamond' ? 0 : Number(a.pay3) || 0) : a.id === b.id ? Number(a.pay2) || 0 : 0;
        r += pr * pay;
    }
    return Math.round(r * 1000) / 10;
}

async function admin(content) {
    let data, widx = 0, packs = [], STARS = [], CHESTS = [], DROPS = [], COLS = [], EMOJIS = [];
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
    const target = path => data.settings.wheels[widx].sectors[+path.split('.')[1]].reward;

    const wheelHTML = () => {
        const s = data.settings, w = s.wheels[widx], total = w.sectors.reduce((a, x) => a + (Number(x.weight) || 0), 0) || 1;
        return '<div class="wa-card"><h4>Колёса <small>у каждого свои цены, лимиты и призы</small></h4><div class="wa-grid">' + s.wheels.map((x, i) => '<button type="button" data-widx="' + i + '" class="' + (i === widx ? 'primary' : '') + '">' + e(x.title) + '</button>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>Колесо «' + e(w.title) + '»</h4><div class="wa-grid"><label>Название<input data-w="title" value="' + e(w.title) + '"></label>' +
            '<label>Открывается с VIP-уровня<select data-w="vip_min">' + VIPN.map((n, i) => '<option value="' + i + '"' + (Number(w.vip_min) === i ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
            WNUMS.map(f => '<label>' + f[1] + '<input data-w="' + f[0] + '" inputmode="numeric" value="' + e(w[f[0]]) + '"></label>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>12 секторов колеса «' + e(w.title) + '» <small>сектор 1 вверху, дальше по часовой стрелке. Нужен хотя бы один джекпот и один редкий или эпический. Любой сектор может содержать GRAM, NFT, подарок Telegram, пак, ящик и т.д.</small></h4><div class="wa-places">' +
            w.sectors.map((x, i) => '<div class="wa-place"><div class="wa-place-n">' + (i + 1) + '</div><div class="wa-place-b"><div class="wa-grid"><label>Уровень<select data-t="' + i + '">' + TIERS.map(t => '<option value="' + t[0] + '"' + (x.tier === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('') + '</select></label>' +
                '<label>Вес (шанс ' + (Math.round((Number(x.weight) || 0) / total * 10000) / 100) + '%)<input data-sw="' + i + '" inputmode="numeric" value="' + e(x.weight) + '"></label></div>' +
                (x.tier === 'jackpot' ? '<small>Джекпот отдаёт весь общий банк. Награда ниже нужна, только если хотите добавить к банку что-то ещё.</small>' : '') + cells(x.reward, 's.' + i) + '</div></div>').join('') + '</div></div>';
    };
    const slotsHTML = () => {
        const sl = data.settings.slots, rtp = slotRtp(sl.symbols);
        return '<div class="wa-card"><h4>Слоты <small>три барабана: три одинаковых, или две одинаковых слева</small></h4><div class="wa-grid">' +
            '<label>Слоты включены<select data-sl="enabled"><option value="1"' + (sl.enabled ? ' selected' : '') + '>Да</option><option value="0"' + (!sl.enabled ? ' selected' : '') + '>Нет</option></select></label>' +
            '<label>Ставки через запятую (до 6)<input data-sl="bets" value="' + e(sl.bets.join(', ')) + '"></label>' +
            [['max_spins', 'Прокруток в день на игрока'], ['daily_bet_cap', 'Лимит ставок в день на игрока'], ['rake', 'Доля ставки в джекпот, %'], ['xp', 'VIP-опыт за прокрутку']].map(f => '<label>' + f[1] + '<input data-sl="' + f[0] + '" inputmode="numeric" value="' + e(sl[f[0]]) + '"></label>').join('') + '</div>' +
            '<div class="wa-places" style="margin-top:14px">' + sl.symbols.map((x, i) => '<div class="wa-place"><div class="wa-place-b"><b>' + e(SYMN[x.id] || x.id) + '</b><div class="wa-grid"><label>Вес<input data-sym="' + i + '.weight" inputmode="decimal" value="' + e(x.weight) + '"></label>' +
                (x.id === 'diamond' ? '<small>Три бриллианта в ряд отдают весь джекпот.</small>' : '<label>Три в ряд, множитель ставки<input data-sym="' + i + '.pay3" inputmode="decimal" value="' + e(x.pay3) + '"></label><label>Две слева, множитель<input data-sym="' + i + '.pay2" inputmode="decimal" value="' + e(x.pay2) + '"></label>') + '</div></div></div>').join('') + '</div>' +
            '<div class="wa-paid"><b>Теоретическая отдача: ' + rtp + '%</b><span>Это доля ставок, которая в среднем возвращается игрокам без джекпота. Ниже 100% казино в плюсе. Больше 150% сохранить нельзя.</span></div></div>';
    };
    const draw = () => {
        const s = data.settings, st = data.stats;
        sec.innerHTML = '<div class="wa-hero is-' + (s.enabled ? 'on' : 'off') + '"><div><h3>Казино Diamond</h3><p>' + (s.enabled ? 'Казино открыто для игроков.' : 'Выключено: игроки не видят казино.') + ' Прокруток колёс: ' + num(st.spins) + ' (платных ' + num(st.paid) + '), слотов: ' + num(st.slot_spins) + ', ставок в слотах: ' + num(st.slot_bets) + ', выплат: ' + num(st.slot_wins) + '. Джекпот: ' + num(data.pool) + '.</p><small>Страница: /season/diamond</small></div>' +
            '<label class="wa-switch"><input type="checkbox" data-s="enabled"' + (s.enabled ? ' checked' : '') + '><i></i><b>' + (s.enabled ? 'Включено' : 'Выключено') + '</b></label></div>' +
            '<div class="wa-card"><h4>Тексты и общий джекпот</h4><div class="wa-grid"><label>Название<input data-s="title" value="' + e(s.title) + '"></label><label>Подпись<input data-s="subtitle" value="' + e(s.subtitle) + '"></label>' +
            GLOBAL.map(f => '<label>' + f[1] + '<input data-s="' + f[0] + '" inputmode="numeric" value="' + e(s[f[0]]) + '"></label>').join('') + '</div></div>' +
            '<div class="wa-card"><h4>VIP-уровни <small>' + VIPN.join(', ') + '</small></h4><div class="wa-grid">' +
            [['vip_xp', 'Нужно опыта'], ['vip_extra_free', 'Бонусных бесплатных в день'], ['vip_discount', 'Скидка на платные, %']].map(g => '<div class="wa-full"><span class="wa-lab">' + g[1] + '</span><div style="display:flex;gap:6px">' + s[g[0]].map((v, i) => '<input data-v="' + g[0] + '.' + i + '" inputmode="numeric" value="' + e(v) + '"' + (g[0] === 'vip_xp' && i === 0 ? ' disabled' : '') + '>').join('') + '</div></div>').join('') + '</div></div>' +
            wheelHTML() + slotsHTML() +
            '<div class="wa-card"><h4>Банк джекпота</h4><div class="wa-reset"><input data-pool inputmode="numeric" placeholder="Новый банк"><button type="button" data-setpool>Поставить</button></div>' +
            (data.jackpots.length ? '<div class="wa-paid"><b>Последние джекпоты</b>' + data.jackpots.map(j => '<span>' + e(j.name || j.user_id) + ': ' + num(j.amount) + '</span>').join('') + '</div>' : '') + '</div>' +
            '<div class="wa-save"><button type="button" class="primary" data-save>Сохранить</button></div>';
        bind();
    };
    const pull = () => {
        const s = data.settings, w = s.wheels[widx], sl = s.slots;
        sec.querySelectorAll('[data-s]').forEach(i => { s[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.value; });
        sec.querySelectorAll('[data-v]').forEach(i => { const [k, n] = i.dataset.v.split('.'); s[k][+n] = i.value; });
        sec.querySelectorAll('[data-w]').forEach(i => { w[i.dataset.w] = i.value; });
        sec.querySelectorAll('[data-t]').forEach(i => { w.sectors[+i.dataset.t].tier = i.value; });
        sec.querySelectorAll('[data-sw]').forEach(i => { w.sectors[+i.dataset.sw].weight = i.value; });
        sec.querySelectorAll('[data-sl]').forEach(i => { const k = i.dataset.sl; sl[k] = k === 'enabled' ? i.value === '1' : k === 'bets' ? i.value.split(/[,\s]+/).filter(Boolean) : i.value; });
        sec.querySelectorAll('[data-sym]').forEach(i => { const [n, k] = i.dataset.sym.split('.'); sl.symbols[+n][k] = i.value; });
    };
    const bind = () => {
        sec.querySelectorAll('[data-rwadd]').forEach(b => b.addEventListener('click', () => { pull(); const path = b.dataset.rwadd; window.crafterRewardPicker.open({emojis: EMOJIS, packs, chests: CHESTS, drops: DROPS, stars: STARS, cols: COLS, models: async cid => { await loadModels(cid); return MODELS[cid] || []; }}, x => { target(path).push(x); draw(); }); }));
        sec.querySelectorAll('[data-rwdel]').forEach(b => b.addEventListener('click', () => { pull(); const parts = b.dataset.rwdel.split('.'); const i = Number(parts.pop()); target(parts.join('.')).splice(i, 1); draw(); }));
        sec.querySelectorAll('[data-widx]').forEach(b => b.addEventListener('click', () => { pull(); widx = Number(b.dataset.widx); draw(); }));
        sec.querySelector('[data-s="enabled"]').addEventListener('change', () => { pull(); draw(); });
        sec.querySelectorAll('[data-t],[data-sw],[data-sym]').forEach(i => i.addEventListener('change', () => { pull(); draw(); }));
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
