/* Admin section «Пасс»: seasons of the pass, levels (XP and the free / plus reward of every level), quests, prices, colours, the end time. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) {} };
const KIND_TITLES = {mega: 'Мегаквест', daily: 'Квест дня', weekly: 'Квест недели', special: 'Особый квест', season: 'Квест сезона'};
const PATTERNS = [['snow', 'Снежинки'], ['stars', 'Звёзды'], ['dots', 'Точки'], ['diamonds', 'Ромбы'], ['none', 'Без узора']];

async function renderAdminPass(content = document.querySelector('#admin-content')) {
    if (!content) return;
    content.innerHTML = '<section class="ny-admin-section pa-wrap"><p class="sub">Загрузка…</p></section>';
    let R, packs = [], STARS = [], CHESTS = [], DROPS = [], COLS = [];
    const MODELS = {};
    try { R = await api('admin/pass'); } catch (err) { content.innerHTML = '<p class="sub">' + e(err.message) + '</p>'; return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) {}
    try { CHESTS = (await api('admin/new-year/chests')).chests.map(c => c.chest); } catch (_) {}
    try { DROPS = (await api('admin/drops')).drops; } catch (_) {}
    try { COLS = (await api('admin/new-year/catalog')).collections; } catch (_) {}
    let LIB = [];
    try { LIB = (await api('admin/new-year/shop-bg-library')).library || []; } catch (_) {}
    const sec = content.querySelector('.pa-wrap');
    let sel = R.seasons[0]?.id || '', tab = 'season', form = null;
    const metricTitle = k => (R.metrics.find(m => m.key === k) || {}).title || k;
    const uploadMedia = async file => { if (file.size > 15000000) throw new Error('Файл слишком большой (до 15 МБ)'); const b = new FormData(); b.append('file', file); return (await api('admin/new-year/shop-media', b)).url; };
    const loadModels = async cid => { if (MODELS[cid] !== undefined) return; MODELS[cid] = null; try { MODELS[cid] = (await api('admin/new-year/catalog/' + encodeURIComponent(cid) + '/models')).models; } catch (_) { MODELS[cid] = []; } };
    const toForm = s => JSON.parse(JSON.stringify({id: s.id, number: s.number, title: s.title, subtitle: s.subtitle, enabled: s.enabled, starts_at_msk: s.starts_at_msk, ends_at_msk: s.ends_at_msk, banner: s.banner, free_ticket: s.free_ticket.indexOf('/static/assets/pass/') === 0 ? '' : s.free_ticket,
        plus_ticket: s.plus_ticket.indexOf('/static/assets/pass/') === 0 ? '' : s.plus_ticket, theme: s.theme, plus_price: s.plus_price, plus_currency: s.plus_currency, level_price: s.level_price, level_currency: s.level_currency, levels: s.levels, quests: s.quests, players: s.players, plus_players: s.plus_players}));
    const fresh = () => {
        const n = (Math.max(0, ...R.seasons.map(s => s.number)) || 0) + 1, levels = [];
        for (let i = 1; i <= 20; i++) levels.push({xp: 100 + i * 20, free: i % 2 ? [{kind: 'BALL', amount: String(10 * i), count: 1}] : [], plus: [{kind: 'BALL', amount: String(25 * i), count: 1}]});
        return {id: '', number: n, title: 'Сезон ' + n, subtitle: '', enabled: false, starts_at_msk: '', ends_at_msk: '', banner: '', free_ticket: '', plus_ticket: '', theme: {c1: '#5b2cff', c2: '#c24fd8', c3: '#2a1170', pattern: 'snow', image: ''}, plus_price: 1000, plus_currency: 'BALL', level_price: 200, level_currency: 'BALL', levels, quests: [], players: 0, plus_players: 0};
    };
    const cur = () => R.seasons.find(s => s.id === sel);
    if (cur()) form = toForm(cur()); else form = fresh();
    const field = (label, input, hint) => '<div class="adm-field"><label>' + label + '</label>' + input + (hint ? '<small class="sub">' + hint + '</small>' : '') + '</div>';
    const inp = (k, v, extra) => '<input data-pf="' + k + '" value="' + e(v ?? '') + '" ' + (extra || '') + '>';
    const rwInfo = r => r.kind === 'PACK' ? {img: packs.find(p => p.id === r.amount)?.image || '', name: packs.find(p => p.id === r.amount)?.title || 'Пак', n: '×' + r.count}
        : r.kind === 'CHEST' ? {img: CHESTS.find(c => c.id === r.amount)?.image || '', name: CHESTS.find(c => c.id === r.amount)?.title || 'Ящик', n: '×' + r.count}
        : r.kind === 'DROP' ? {img: DROPS.find(c => c.id === r.amount)?.image || '/static/assets/drops/snowman.png', name: DROPS.find(c => c.id === r.amount)?.title || 'Дроп', n: '×' + r.count}
        : r.kind === 'GRAM' ? {img: '/static/assets/gram.svg', name: 'GRAM', n: String(r.amount)} : r.kind === 'BALL' ? {img: '/static/assets/new-year-ornament.svg', name: 'Шары', n: num(r.amount)}
        : r.kind === 'STAR' ? {img: STARS.find(x => x.key === r.amount)?.image || '', name: STARS.find(x => x.key === r.amount)?.name || 'Подарок', n: '×' + r.count}
        : {img: '', name: String(r.amount).split(':').slice(1).join(':') || 'NFT', n: 'NFT'};
    const cells = (list, path) => '<div class="pa-cells">' + list.map((r, i) => { const v = rwInfo(r); return '<span class="pa-cell" title="' + e(v.name) + '"><button type="button" class="pa-x" data-rwdel="' + path + '.' + i + '" aria-label="Убрать">×</button>' + (v.img ? '<img src="' + e(v.img) + '" alt="">' : '<i>NFT</i>') + '<b>' + e(v.n) + '</b></span>'; }).join('') +
        '<button type="button" class="pa-add" data-rwadd="' + path + '" aria-label="Добавить награду">+</button></div>';
    const target = path => { const [kind, i, side] = path.split('.'); return kind === 'lv' ? form.levels[+i][side] : form.quests[+i].reward; };

    const pull = () => {
        sec.querySelectorAll('[data-pf]').forEach(i => {
            const k = i.dataset.pf;
            const v = i.type === 'checkbox' ? i.checked : i.value;
            if (k.indexOf('theme.') === 0) form.theme[k.slice(6)] = v; else form[k] = v;
        });
        sec.querySelectorAll('[data-lvxp]').forEach(i => { form.levels[+i.dataset.lvxp].xp = Number(i.value) || 0; });
        sec.querySelectorAll('[data-qf]').forEach(i => { const [n, k] = i.dataset.qf.split('.'); const q = form.quests[+n]; if (q) q[k] = i.type === 'checkbox' ? i.checked : i.value; });
    };

    const seasonPane = () => {
        const t = form.theme;
        const up = (k, label, v, hint) => '<div class="pa-up"><b>' + label + '</b>' + (v ? '<img src="' + e(v) + '" alt="">' : '<span>по умолчанию</span>') + '<label class="pa-file">Загрузить<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" data-pup="' + k + '" hidden></label>' + (v ? '<button type="button" class="pa-link" data-pclear="' + k + '">Убрать</button>' : '') + (hint ? '<small>' + hint + '</small>' : '') + '</div>';
        return '<div class="adm-step"><h4>Сезон</h4><div class="adm-row3">' + field('Название сезона', inp('title', form.title, 'maxlength="80"')) + field('Номер сезона', inp('number', form.number, 'type="number" min="1"')) + field('Подпись', inp('subtitle', form.subtitle, 'maxlength="120"')) + '</div>' +
            '<div class="adm-row3">' + field('Начало (по Москве)', inp('starts_at_msk', form.starts_at_msk, 'type="datetime-local"'), 'Пусто — сразу') + field('Конец (по Москве)', inp('ends_at_msk', form.ends_at_msk, 'type="datetime-local"'), 'После конца сезон пропадает у игроков') +
            field('Показывать игрокам', '<label class="adm-check"><input type="checkbox" data-pf="enabled"' + (form.enabled ? ' checked' : '') + '> Сезон включён</label>') + '</div></div>' +
            '<div class="adm-step"><h4>Оформление</h4><div class="pa-ups">' + up('banner', 'Баннер сезона (слева сверху)', form.banner, 'Картинка за названием') + up('theme.image', 'Фон сезона', t.image, 'Пусто — цвета ниже') + up('free_ticket', 'Билет Free', form.free_ticket) + up('plus_ticket', 'Билет Pass Plus', form.plus_ticket) + '</div>' +
            '<div class="adm-row3">' + field('Цвет 1 (верх)', '<input type="color" data-pf="theme.c1" value="' + e(t.c1) + '">') + field('Цвет 2 (середина)', '<input type="color" data-pf="theme.c2" value="' + e(t.c2) + '">') + field('Цвет 3 (низ)', '<input type="color" data-pf="theme.c3" value="' + e(t.c3) + '">') + '</div>' +
            '<div class="adm-chips pa-pat">' + PATTERNS.map(p => '<button type="button" data-pat="' + p[0] + '"' + (t.pattern === p[0] ? ' class="is-on"' : '') + '>' + p[1] + '</button>').join('') + '</div>' +
            '<div class="pa-preview" style="background:linear-gradient(160deg,' + e(t.c1) + ',' + e(t.c2) + ' 60%,' + e(t.c3) + ')"><i class="sp-pat pat-' + e(t.pattern) + '"></i><span>' + e(form.title) + '</span></div></div>' +
            '<div class="adm-step"><h4>Цены</h4><div class="adm-row3">' + field('Цена Pass Plus', inp('plus_price', form.plus_price, 'type="number" min="0"')) +
            field('Валюта Pass Plus', '<select data-pf="plus_currency">' + R.currencies.map(c => '<option value="' + c.key + '"' + (form.plus_currency === c.key ? ' selected' : '') + '>' + e(c.title) + '</option>').join('') + '</select>') + '<div></div>' +
            field('Цена одного уровня', inp('level_price', form.level_price, 'type="number" min="0"'), '0 — докупать уровни нельзя') + field('Валюта уровней', '<select data-pf="level_currency">' + R.currencies.map(c => '<option value="' + c.key + '"' + (form.level_currency === c.key ? ' selected' : '') + '>' + e(c.title) + '</option>').join('') + '</select>') + '</div></div>';
    };

    const levelsPane = () => {
        let total = 0;
        const rows = form.levels.map((lv, i) => { total += Number(lv.xp) || 0; return '<tr><td class="pa-n">' + (i + 1) + '</td><td><input class="pa-xp" type="number" min="1" data-lvxp="' + i + '" value="' + e(lv.xp) + '"></td><td class="pa-sum">' + num(total) + '</td><td>' + cells(lv.free, 'lv.' + i + '.free') + '</td><td>' + cells(lv.plus, 'lv.' + i + '.plus') + '</td>' +
            '<td class="pa-act"><button type="button" data-lvup="' + i + '" title="Выше">↑</button><button type="button" data-lvdown="' + i + '" title="Ниже">↓</button><button type="button" data-lvcopy="' + i + '" title="Копия">⧉</button><button type="button" data-lvdel="' + i + '" title="Удалить">×</button></td></tr>'; }).join('');
        return '<div class="adm-step"><h4>Уровни</h4><p class="sub">Уровень растёт, когда накоплено столько XP, сколько стоят все уровни до него вместе. Награды Free лежат на нижней дороге, Plus — на верхней.</p>' +
            '<div class="pa-auto"><b>Быстро заполнить награды</b><label>Дорога<select id="pa-af-track"><option value="free">Free</option><option value="plus">Plus</option><option value="both">Обе</option></select></label><label>Награда<select id="pa-af-kind"><option value="BALL">Шары</option><option value="GRAM">GRAM</option></select></label><label>На первом уровне<input id="pa-af-start" type="number" step="any" value="10"></label><label>Прибавка за уровень<input id="pa-af-step" type="number" step="any" value="10"></label><label>Каждый N-й уровень<input id="pa-af-every" type="number" min="1" value="1"></label><label class="adm-check"><input id="pa-af-clear" type="checkbox"> очистить остальные</label><button type="button" data-autofill>Заполнить</button></div>' +
            '<div class="pa-gen"><label>Сколько уровней<input type="number" min="1" max="200" id="pa-gen-n" value="' + form.levels.length + '"></label><label>XP первого<input type="number" min="1" id="pa-gen-xp" value="' + (form.levels[0]?.xp || 100) + '"></label><label>Прибавка за уровень<input type="number" min="0" id="pa-gen-step" value="20"></label><button type="button" data-gen>Пересоздать XP</button></div>' +
            '<div class="pa-scroll"><table class="pa-table"><thead><tr><th>№</th><th>XP на уровень</th><th>Всего XP</th><th>Free (нижняя дорога)</th><th>Plus (верхняя дорога)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div><button type="button" class="pa-addlvl" data-addlvl>+ Добавить уровень</button></div>';
    };

    const questsPane = () => {
        const q = form.quests;
        const card = (x, i) => '<div class="pa-q"><div class="pa-q-top"><b>' + (i + 1) + '. ' + e(KIND_TITLES[x.kind]) + '</b><span><button type="button" data-qup="' + i + '">↑</button><button type="button" data-qdown="' + i + '">↓</button><button type="button" data-qdel="' + i + '">Удалить</button></span></div>' +
            '<div class="adm-row3">' + field('Тип', '<select data-qf="' + i + '.kind">' + R.kinds.map(k => '<option value="' + k + '"' + (x.kind === k ? ' selected' : '') + '>' + KIND_TITLES[k] + '</option>').join('') + '</select>') + field('Название (как видит игрок)', '<input data-qf="' + i + '.title" value="' + e(x.title) + '" maxlength="90">') +
            field('Что считать', '<select data-qf="' + i + '.metric">' + R.metrics.map(m => '<option value="' + m.key + '"' + (x.metric === m.key ? ' selected' : '') + '>' + e(m.title) + '</option>').join('') + '</select>') + '</div>' +
            '<div class="adm-row3">' + field('Сколько нужно', '<input type="number" min="1" data-qf="' + i + '.target" value="' + e(x.target) + '">') + field('XP за квест', '<input type="number" min="0" data-qf="' + i + '.xp" value="' + e(x.xp) + '">') + field('Только для Pass Plus', '<label class="adm-check"><input type="checkbox" data-qf="' + i + '.plus_only"' + (x.plus_only ? ' checked' : '') + '> Да</label>') + '</div>' +
            '<div class="pa-iconrow"><span class="pa-iconprev">' + (x.icon ? '<img src="' + e(x.icon) + '" alt="">' : '<em>по умолчанию</em>') + '</span><div><b>Картинка квеста</b><div class="pa-iconbtns"><label class="pa-file">Загрузить картинку<input type="file" accept="image/*" data-qiconfile="' + i + '" hidden></label>' + (x.icon ? '<button type="button" class="pa-link" data-qiconclear="' + i + '">Убрать</button>' : '') + '</div>' + (LIB.length ? '<div class="pa-lib">' + LIB.slice(0, 14).map(l => '<button type="button" class="' + (x.icon === l.url ? 'is-on' : '') + '" data-qiconpick="' + i + '" data-url="' + e(l.url) + '" title="' + e(l.name) + '"><img src="' + e(l.url) + '" alt=""></button>').join('') + '</div>' : '') + '</div></div>' +
            '<div class="adm-row3">' + field('Дополнительная награда', cells(x.reward, 'q.' + i)) + (['special', 'season', 'mega'].includes(x.kind) ? field('Откроется (по Москве)', '<input type="datetime-local" data-qf="' + i + '.starts_at_msk" value="' + e(x.starts_at_msk) + '">') + field('Закончится (по Москве)', '<input type="datetime-local" data-qf="' + i + '.ends_at_msk" value="' + e(x.ends_at_msk) + '">') : '<small class="sub">Квест дня обновляется каждый день в 00:00 по Москве, квест недели — в понедельник.</small>') + '</div></div>';
        return '<div class="adm-step"><h4>Квесты</h4><p class="sub">Порядок как на экране игрока. Квесты считают события из истории игры: апгрейды, крафты, покупки, пополнения и т. д. Мегаквесты открываются по цепочке: следующий — после предыдущего.</p>' + (q.map(card).join('') || '<p class="sub">Квестов пока нет.</p>') +
            '<div class="pa-addq">' + R.kinds.map(k => '<button type="button" data-addq="' + k + '">+ ' + KIND_TITLES[k] + '</button>').join('') + '</div></div>';
    };

    const playersPane = () => '<div class="adm-step"><h4>Игроки</h4><p class="sub">В сезоне: <b>' + form.players + '</b> игроков, Pass Plus у <b>' + form.plus_players + '</b>.</p><div class="adm-row3">' + field('Номер игрока (Telegram ID)', '<input id="pa-gx-id" inputmode="numeric">') + field('Выдать XP (можно со знаком минус)', '<input id="pa-gx-xp" inputmode="numeric" value="100">') + '<div class="adm-field"><label>&nbsp;</label><button type="button" class="primary" data-gx>Выдать XP</button></div></div></div>';

    const draw = () => {
        const list = R.seasons.map(s => '<button type="button" class="pa-s' + (s.id === sel ? ' is-on' : '') + '" data-sel="' + s.id + '"><b>Сезон ' + s.number + '</b><small>' + e(s.title) + (s.enabled ? '' : ' · скрыт') + '</small></button>').join('') + '<button type="button" class="pa-s pa-new' + (!sel ? ' is-on' : '') + '" data-new>+ Новый сезон</button>';
        const tabs = [['season', 'Сезон'], ['levels', 'Уровни'], ['quests', 'Квесты'], ['players', 'Игроки']].map(t => '<button type="button" class="' + (tab === t[0] ? 'is-on' : '') + '" data-ptab="' + t[0] + '"' + (t[0] === 'players' && !form.id ? ' disabled' : '') + '>' + t[1] + '</button>').join('');
        sec.innerHTML = '<h3>Сезонный пасс</h3><p class="sub">Сезон, дороги Free и Pass Plus, уровни, XP и квесты. Игроки видят пасс в разделе «Сезон».</p><div class="pa-seasons">' + list + '</div><div class="sb-tabs pa-tabs">' + tabs + '</div>' +
            (tab === 'season' ? seasonPane() : tab === 'levels' ? levelsPane() : tab === 'quests' ? questsPane() : playersPane()) +
            '<div class="pa-save"><a class="pa-look" href="/season" target="_blank" rel="noopener">Посмотреть страницу сезона</a><button type="button" class="primary" data-save>' + (form.id ? 'Сохранить сезон и уровни' : 'Создать сезон') + '</button>' + (tab === 'quests' && form.id ? '<button type="button" class="primary" data-saveq>Сохранить квесты</button>' : '') + (form.id ? '<button type="button" class="pa-danger" data-delseason>Удалить сезон</button>' : '') + '</div>';
        bind();
    };

    const reload = async keepId => { R = await api('admin/pass'); sel = keepId ?? sel; form = cur() ? toForm(cur()) : fresh(); draw(); };
    const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };

    function bind() {
        sec.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => { sel = b.dataset.sel; form = toForm(cur()); draw(); }));
        sec.querySelector('[data-new]')?.addEventListener('click', () => { sel = ''; form = fresh(); tab = 'season'; draw(); });
        sec.querySelectorAll('[data-ptab]').forEach(b => b.addEventListener('click', () => { pull(); tab = b.dataset.ptab; draw(); }));
        sec.querySelectorAll('[data-pat]').forEach(b => b.addEventListener('click', () => { pull(); form.theme.pattern = b.dataset.pat; draw(); }));
        sec.querySelectorAll('[data-pf^="theme.c"],[data-pf="title"]').forEach(i => i.addEventListener('input', () => { pull(); const p = sec.querySelector('.pa-preview'); if (p) { p.style.background = 'linear-gradient(160deg,' + form.theme.c1 + ',' + form.theme.c2 + ' 60%,' + form.theme.c3 + ')'; p.querySelector('span').textContent = form.title; } }));
        sec.querySelectorAll('[data-pup]').forEach(i => i.addEventListener('change', async () => { const f = i.files[0]; if (!f) return; pull(); try { const url = await uploadMedia(f); const k = i.dataset.pup; if (k.indexOf('theme.') === 0) form.theme[k.slice(6)] = url; else form[k] = url; draw(); } catch (err) { toast(err.message); } }));
        sec.querySelectorAll('[data-pclear]').forEach(b => b.addEventListener('click', () => { pull(); const k = b.dataset.pclear; if (k.indexOf('theme.') === 0) form.theme[k.slice(6)] = ''; else form[k] = ''; draw(); }));
        // prizes (levels and quests)
        sec.querySelectorAll('[data-rwadd]').forEach(b => b.addEventListener('click', () => { pull(); const path = b.dataset.rwadd; window.crafterRewardPicker.open({packs, chests: CHESTS, drops: DROPS, stars: STARS, cols: COLS, models: async cid => { await loadModels(cid); return MODELS[cid] || []; }}, x => { target(path).push(x); draw(); }); }));
        sec.querySelectorAll('[data-rwdel]').forEach(b => b.addEventListener('click', () => { pull(); const parts = b.dataset.rwdel.split('.'); const i = Number(parts.pop()); target(parts.join('.')).splice(i, 1); draw(); }));
        // levels
        sec.querySelector('[data-gen]')?.addEventListener('click', () => { pull(); const n = Math.max(1, Math.min(200, Number(sec.querySelector('#pa-gen-n').value) || 1)), x0 = Math.max(1, Number(sec.querySelector('#pa-gen-xp').value) || 100), st = Math.max(0, Number(sec.querySelector('#pa-gen-step').value) || 0); while (form.levels.length < n) form.levels.push({xp: 100, free: [], plus: []}); form.levels.length = n; form.levels.forEach((l, i) => { l.xp = x0 + i * st; }); draw(); });
        sec.querySelector('[data-autofill]')?.addEventListener('click', () => {
            pull();
            const tr = sec.querySelector('#pa-af-track').value, kind = sec.querySelector('#pa-af-kind').value, start = Number(sec.querySelector('#pa-af-start').value) || 0, step = Number(sec.querySelector('#pa-af-step').value) || 0, every = Math.max(1, Number(sec.querySelector('#pa-af-every').value) || 1), clear = sec.querySelector('#pa-af-clear').checked;
            if (start <= 0 && step <= 0) { toast('Впишите, сколько давать'); return; }
            let k = 0;
            form.levels.forEach((lv, i) => {
                const on = (i + 1) % every === 0;
                (tr === 'both' ? ['free', 'plus'] : [tr]).forEach(t => {
                    if (!on) { if (clear) lv[t] = []; return; }
                    const v = start + step * k; lv[t] = [{kind, amount: kind === 'BALL' ? String(Math.max(1, Math.round(v))) : String(Math.round(v * 1000) / 1000 || 0.1), count: 1}];
                });
                if (on) k++;
            });
            draw(); toast('Награды заполнены');
        });
        sec.querySelector('[data-addlvl]')?.addEventListener('click', () => { pull(); const last = form.levels[form.levels.length - 1]; form.levels.push({xp: last ? last.xp : 100, free: [], plus: []}); draw(); });
        sec.querySelectorAll('[data-lvup]').forEach(b => b.addEventListener('click', () => { pull(); move(form.levels, +b.dataset.lvup, -1); draw(); }));
        sec.querySelectorAll('[data-lvdown]').forEach(b => b.addEventListener('click', () => { pull(); move(form.levels, +b.dataset.lvdown, 1); draw(); }));
        sec.querySelectorAll('[data-lvcopy]').forEach(b => b.addEventListener('click', () => { pull(); const i = +b.dataset.lvcopy; form.levels.splice(i + 1, 0, JSON.parse(JSON.stringify(form.levels[i]))); draw(); }));
        sec.querySelectorAll('[data-lvdel]').forEach(b => b.addEventListener('click', () => { pull(); form.levels.splice(+b.dataset.lvdel, 1); draw(); }));
        // quests
        sec.querySelectorAll('[data-addq]').forEach(b => b.addEventListener('click', () => { pull(); const k = b.dataset.addq; form.quests.push({id: '', kind: k, title: 'Новый квест', icon: '', metric: 'upgrade', target: 5, xp: k === 'mega' ? 1500 : 200, reward: [], plus_only: false, enabled: true, starts_at_msk: '', ends_at_msk: ''}); draw(); }));
        sec.querySelectorAll('[data-qup]').forEach(b => b.addEventListener('click', () => { pull(); move(form.quests, +b.dataset.qup, -1); draw(); }));
        sec.querySelectorAll('[data-qdown]').forEach(b => b.addEventListener('click', () => { pull(); move(form.quests, +b.dataset.qdown, 1); draw(); }));
        sec.querySelectorAll('[data-qdel]').forEach(b => b.addEventListener('click', () => { pull(); form.quests.splice(+b.dataset.qdel, 1); draw(); }));
        sec.querySelectorAll('[data-qiconpick]').forEach(b => b.addEventListener('click', () => { pull(); form.quests[+b.dataset.qiconpick].icon = b.dataset.url; draw(); }));
        sec.querySelectorAll('[data-qiconclear]').forEach(b => b.addEventListener('click', () => { pull(); form.quests[+b.dataset.qiconclear].icon = ''; draw(); }));
        sec.querySelectorAll('[data-qiconfile]').forEach(i => i.addEventListener('change', async () => { const f = i.files[0]; if (!f) return; pull(); try { const url = await uploadMedia(f); form.quests[+i.dataset.qiconfile].icon = url; try { LIB = (await api('admin/new-year/shop-bg-library', {url, name: f.name.replace(/\.[^.]+$/, '')})).library || LIB; } catch (_) {} draw(); } catch (err) { toast(err.message); } }));
        sec.querySelectorAll('[data-qf$=".kind"]').forEach(i => i.addEventListener('change', () => { pull(); draw(); }));
        // save
        sec.querySelector('[data-save]')?.addEventListener('click', async () => {
            pull();
            try { const res = await api('admin/pass/season', {...form, quests: undefined}); toast('Сезон сохранён'); await reload(res.id); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-saveq]')?.addEventListener('click', async () => {
            pull();
            try { await api('admin/pass/quests', {season_id: form.id, quests: form.quests}); toast('Квесты сохранены'); await reload(form.id); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-delseason]')?.addEventListener('click', async () => {
            if (!confirm('Удалить сезон «' + form.title + '» вместе с уровнями, квестами и прогрессом игроков? Это нельзя отменить.')) return;
            try { await api('admin/pass/season/' + form.id + '/delete', {}); toast('Сезон удалён'); sel = ''; await reload(R.seasons.find(s => s.id !== form.id)?.id || ''); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-gx]')?.addEventListener('click', async () => {
            try { await api('admin/pass/grant-xp', {user_id: sec.querySelector('#pa-gx-id').value.trim(), xp: sec.querySelector('#pa-gx-xp').value.trim()}); toast('XP изменён'); } catch (err) { toast(err.message); }
        });
    }
    draw();
}
window.renderAdminPass = renderAdminPass;
})();
