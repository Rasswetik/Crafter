/* Administrator: chests. The picture, the 3D model, the background and the table of what is inside (with chances). */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const KINDS = [['BALL', 'Шары'], ['GRAM', 'GRAM'], ['PACK', 'Пак'], ['STAR', 'Подарок Telegram']];

async function admin(content) {
    let r, packs = [], STARS = [];
    try { r = await api('admin/new-year/chests'); } catch (_) { return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) {}
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section';
    sec.dataset.pane = 'chests';
    content.appendChild(sec);
    let sel = r.chests[0]?.chest.id || '', form = null;
    const reload = async () => { try { r = await api('admin/new-year/chests'); } catch (_) {} draw(); };
    const run = async (fn, ok) => { try { const out = await fn(); if (ok) toast(ok); await reload(); return out; } catch (err) { toast(err.message); } };
    const field = (label, input, hint) => '<div class="adm-field"><label>' + label + '</label>' + input + (hint ? '<small class="sub">' + hint + '</small>' : '') + '</div>';
    const upload = async (file, endpoint, limit) => {
        if (file.size > limit) throw new Error('Файл слишком большой');
        const b = new FormData(); b.append('file', file);
        return (await api(endpoint, b)).url;
    };
    const fresh = () => ({id: '', title: 'Новый ящик', enabled: true, bg: 'cozy', image: '', model: '', model_mobile: '', rolls: {1: '', 2: '', 3: '50', 4: '30', 5: '15', 6: '5'}, settings: {guaranteed: {GRAM: true, BALL: true, PACK: true, STAR: false}, bonus: {GRAM: '60', BALL: '30', PACK: '10', STAR: ''}, bg_open: '', bg_reward: ''},
        loot: [{kind: 'GRAM', amount: '0.1', cmin: 1, cmax: 1, weight: '1'}, {kind: 'BALL', amount: '5', cmin: 1, cmax: 1, weight: '1'}, {kind: 'PACK', amount: packs[0]?.id || '', cmin: 1, cmax: 1, weight: '1'}]});
    const edit = c => ({id: c.chest.id, title: c.chest.title, enabled: c.enabled, bg: c.chest.bg, image: c.custom.image, model: c.custom.model, model_mobile: c.custom.model_mobile,
        rolls: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [n, c.rolls_raw[n] ? String(c.rolls_raw[n]) : ''])),
        settings: {guaranteed: Object.fromEntries(KINDS.map(([k]) => [k, (c.settings_raw.guaranteed || []).includes(k)])), bonus: Object.fromEntries(KINDS.map(([k]) => [k, c.settings_raw.bonus[k] ? String(c.settings_raw.bonus[k]) : ''])), bg_open: c.settings_raw.bg_open || '', bg_reward: c.settings_raw.bg_reward || ''},
        loot: c.loot_raw.map(x => ({...x, cmin: x.cmin, cmax: x.cmax, weight: String(x.weight)}))});
    const pull = () => {
        sec.querySelectorAll('[data-cf]').forEach(i => { form[i.dataset.cf] = i.value; });
        sec.querySelectorAll('[data-cr]').forEach(i => { form.rolls[i.dataset.cr] = i.value; });
        sec.querySelectorAll('[data-cb]').forEach(i => { form.settings.bonus[i.dataset.cb] = i.value; });
        sec.querySelectorAll('[data-cl]').forEach(i => { const [n, k] = i.dataset.cl.split('.'); if (form.loot[+n]) form.loot[+n][k] = i.value; });
    };
    const pct = (v, all) => all > 0 ? (v / all * 100).toFixed(v / all < .1 ? 2 : 1) + '%' : '—';
    const lootRow = (x, i, per) => {
        const k = x.kind;
        const what = k === 'PACK' ? '<select data-cl="' + i + '.amount">' + packs.map(p => '<option value="' + e(p.id) + '"' + (x.amount === p.id ? ' selected' : '') + '>' + e(p.title) + '</option>').join('') + '</select>'
            : k === 'STAR' ? '<select data-cl="' + i + '.amount">' + (window.crafterStarGifts ? window.crafterStarGifts.options(STARS, x.amount) : '') + '</select>'
            : '<input data-cl="' + i + '.amount" value="' + e(x.amount) + '" placeholder="' + (k === 'BALL' ? '100-250' : '0.1-0.3') + '" title="Число или диапазон: игроку выпадет случайное значение">';
        const cnt = k === 'PACK' || k === 'STAR' ? '<span class="cxa-cnt">штук <input data-cl="' + i + '.cmin" type="number" min="1" max="20" value="' + e(x.cmin) + '"> – <input data-cl="' + i + '.cmax" type="number" min="1" max="20" value="' + e(x.cmax) + '"></span>' : '';
        return '<div class="cxa-row"><select data-cl-kind="' + i + '">' + KINDS.map(([v, t]) => '<option value="' + v + '"' + (k === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' + what + cnt +
            '<label class="cxa-w">Вес <input data-cl="' + i + '.weight" type="number" min="0" step="any" value="' + e(x.weight) + '"></label><b class="cxa-pct">' + pct(Number(x.weight) || 0, per[x.kind] || 0) + '</b>' +
            '<button type="button" class="danger" data-cl-del="' + i + '" aria-label="Убрать">×</button></div>';
    };
    const draw = () => {
        const cur = r.chests.find(c => c.chest.id === sel);
        const list = r.chests.map(c => '<button type="button" class="cxa-pick' + (c.chest.id === sel && !form ? ' is-on' : '') + '" data-pick="' + e(c.chest.id) + '"><img src="' + e(c.chest.image) + '" alt=""><span>' + e(c.chest.title) + (c.enabled ? '' : ' · выключен') + '</span></button>').join('');
        let html = '<h3>Ящики</h3><p class="sub">Ящик не продаётся и не хранится: он открывается сразу после покупки, из подарка или по промокоду. Что в нём лежит — решаете вы: шаров, GRAM, паки, подарки Telegram, с шансами.</p><div class="cxa-list">' + list + '<button type="button" class="cxa-pick cxa-new" data-new>+ Новый ящик</button></div>';
        if (!form && cur) {
            html += '<div class="cxa-card"><div class="cxa-head"><img src="' + e(cur.chest.image) + '" alt=""><div><b>' + e(cur.chest.title) + '</b><small class="sub">id: ' + e(cur.chest.id) + ' · предметов в таблице: ' + cur.loot.length + '</small></div></div>' +
                '<div class="cxa-loot">' + cur.loot.map(x => '<span><img src="' + e(x.image || '/static/assets/new-year-ornament.svg') + '" alt="">' + e(x.title) + ' ' + e(String(x.amount).replace('-', '–')) + ' · ' + x.chance + '%</span>').join('') + '</div>' +
                '<div class="adm-chips"><button type="button" class="primary" data-edit>Изменить</button><button type="button" data-test>Проверить открытие</button><button type="button" data-copy>Скопировать id</button><button type="button" class="danger" data-del>Удалить</button></div>' +
                '<p class="sub">Чтобы продать ящик: «Магазин» → «Новый товар» → «Ящик». Подарок по дням и промокод тоже умеют выдавать ящик.</p></div>';
        }
        if (form) {
            const per = {}; form.loot.forEach(x => { per[x.kind] = (per[x.kind] || 0) + (Number(x.weight) || 0); });
            const rt = Object.values(form.rolls).reduce((s, v) => s + (Number(v) || 0), 0);
            html += '<div class="cxa-card"><h4>' + (form.id ? 'Изменить ящик' : 'Новый ящик') + '</h4>' +
                '<div class="adm-row3">' + field('Название', '<input data-cf="title" maxlength="40" value="' + e(form.title) + '">') +
                field('Показывать игрокам', '<div class="adm-chips">' + [['1', 'Да'], ['0', 'Нет']].map(([v, t]) => '<button type="button" class="' + ((form.enabled ? '1' : '0') === v ? 'is-on' : '') + '" data-c-on="' + v + '">' + t + '</button>').join('') + '</div>') + '</div>' +
                '<div class="adm-row3">' + field('Картинка (для плитки)', '<input type="file" accept="image/png,image/webp" data-up="image">', form.image ? 'Загружена своя. Пусто — пряничный ящик.' : 'PNG/WebP до 15 МБ') +
                field('Модель .glb', '<input type="file" accept=".glb" data-up="model">', form.model ? 'Загружена своя модель' : 'Пусто — пряничный ящик. До 9 МБ') +
                field('Облегчённая модель .glb (для телефонов)', '<input type="file" accept=".glb" data-up="model_mobile">', form.model_mobile ? 'Загружена своя' : 'Необязательно') + '</div>' +
                '<div class="adm-row3">' + [['bg_open', 'Фон, пока ящик закрыт', 'Тёмный фон с свечением (по умолчанию стоит ваш)'], ['bg_reward', 'Фон, когда листаются награды', 'Оранжевый с наковальнями (по умолчанию)']].map(([k, t, h]) =>
                    field(t, '<input type="file" accept="image/png,image/webp,image/jpeg" data-up-bg="' + k + '">', form.settings[k] ? 'Загружен свой фон. <a href="#" data-bg-reset="' + k + '">Вернуть стандартный</a>' : h)).join('') + '</div>' +
                '<h4>Сколько наград выпадет всего</h4><p class="sub">Вес — относительный: 50 и 30 значат 50% и 30%. Пустое поле — такого количества не бывает. Одна награда — одна выдача: сумма GRAM, пачка шаров или один пак.</p>' +
                '<div class="cxa-rolls">' + [1, 2, 3, 4, 5, 6].map(n => '<label>' + n + ' <input data-cr="' + n + '" type="number" min="0" step="any" value="' + e(form.rolls[n]) + '"><b>' + pct(Number(form.rolls[n]) || 0, rt) + '</b></label>').join('') + '</div>' +
                '<h4>Гарантированные награды и бонусы</h4><p class="sub">Гарантированные выдаются в каждом ящике (по одной). Остальные награды (всего минус гарантированные) — бонусные: их тип выбирается по шансам ниже. Если ничего не отмечено и шансов нет — награды берутся из всей таблицы сразу.</p>' +
                '<div class="cxa-rolls">' + KINDS.map(([k, t]) => '<label>' + t + ' <input type="checkbox" data-c-sure="' + k + '"' + (form.settings.guaranteed[k] ? ' checked' : '') + '> гарант. <input data-cb="' + k + '" type="number" min="0" step="any" value="' + e(form.settings.bonus[k]) + '" placeholder="бонус %"></label>').join('') + '</div>' +
                '<h4>Что может лежать внутри</h4><p class="sub">Шары и GRAM: число или диапазон (100-250). Для паков и подарков — сколько штук. Вес считается внутри своего типа: проценты справа — шанс именно в этом типе.</p>' +
                '<div class="cxa-rows">' + form.loot.map((x, i) => lootRow(x, i, per)).join('') + '</div><button type="button" data-loot-add>+ Добавить предмет</button>' +
                '<div class="adm-chips" style="margin-top:14px"><button type="button" class="primary" data-save>Сохранить</button><button type="button" data-cancel>Отмена</button></div></div>';
        }
        sec.innerHTML = html;
        bind();
    };
    const bind = () => {
        sec.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { form = null; sel = b.dataset.pick; draw(); }));
        sec.querySelector('[data-new]')?.addEventListener('click', () => { form = fresh(); draw(); });
        sec.querySelector('[data-edit]')?.addEventListener('click', () => { form = edit(r.chests.find(c => c.chest.id === sel)); draw(); });
        sec.querySelector('[data-copy]')?.addEventListener('click', () => { navigator.clipboard?.writeText(sel); toast('Скопировано: ' + sel); });
        sec.querySelector('[data-del]')?.addEventListener('click', () => { if (confirm('Удалить ящик?')) run(() => api('admin/new-year/chests/' + sel + '/delete', {}), 'Ящик удалён'); });
        sec.querySelector('[data-test]')?.addEventListener('click', async () => {
            try { const res = await api('admin/new-year/chests/' + sel + '/preview', {}); window.crafterChests.play(res, {toast, refresh() {}}); } catch (err) { toast(err.message); }
        });
        if (!form) return;
        sec.querySelectorAll('[data-c-sure]').forEach(i => i.addEventListener('change', () => { pull(); form.settings.guaranteed[i.dataset.cSure] = i.checked; draw(); }));
        sec.querySelectorAll('[data-c-on]').forEach(b => b.addEventListener('click', () => { pull(); form.enabled = b.dataset.cOn === '1'; draw(); }));
        sec.querySelectorAll('[data-up-bg]').forEach(i => i.addEventListener('change', async () => { const f = i.files[0]; if (!f) return; pull(); try { form.settings[i.dataset.upBg] = await upload(f, 'admin/new-year/shop-media', 15000000); toast('Фон загружен'); draw(); } catch (err) { toast(err.message); } }));
        sec.querySelectorAll('[data-bg-reset]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); pull(); form.settings[a.dataset.bgReset] = ''; draw(); }));
        sec.querySelectorAll('[data-cl-kind]').forEach(s => s.addEventListener('change', () => { pull(); const x = form.loot[+s.dataset.clKind]; x.kind = s.value; x.amount = s.value === 'PACK' ? (packs[0]?.id || '') : s.value === 'STAR' ? (STARS[0]?.key || '') : s.value === 'BALL' ? '100-250' : '0.1-0.3'; x.cmin = 1; x.cmax = 1; draw(); }));
        sec.querySelectorAll('[data-cl-del]').forEach(b => b.addEventListener('click', () => { pull(); form.loot.splice(+b.dataset.clDel, 1); draw(); }));
        sec.querySelector('[data-loot-add]')?.addEventListener('click', () => { pull(); form.loot.push({kind: 'BALL', amount: '100-250', cmin: 1, cmax: 1, weight: '10'}); draw(); });
        sec.querySelectorAll('[data-cl$=".weight"],[data-cr]').forEach(i => i.addEventListener('change', () => { pull(); draw(); }));
        sec.querySelectorAll('[data-up]').forEach(i => i.addEventListener('change', async () => {
            const f = i.files[0]; if (!f) return; pull();
            try {
                form[i.dataset.up] = await upload(f, i.dataset.up === 'image' ? 'admin/new-year/shop-media' : 'admin/new-year/chest-model', i.dataset.up === 'image' ? 15000000 : 9000000);
                toast('Файл загружен'); draw();
            } catch (err) { toast(err.message); }
        }));
        sec.querySelector('[data-cancel]')?.addEventListener('click', () => { form = null; draw(); });
        sec.querySelector('[data-save]')?.addEventListener('click', async () => {
            pull();
            const out = await run(() => api('admin/new-year/chests', {id: form.id || undefined, title: form.title, enabled: form.enabled, bg: form.bg, image: form.image, model: form.model, model_mobile: form.model_mobile,
                rolls: Object.fromEntries(Object.entries(form.rolls).filter(([, v]) => Number(v) > 0)),
                settings: {guaranteed: KINDS.map(([k]) => k).filter(k => form.settings.guaranteed[k]), bonus: Object.fromEntries(Object.entries(form.settings.bonus).filter(([, v]) => Number(v) > 0)), bg_open: form.settings.bg_open, bg_reward: form.settings.bg_reward},
                loot: form.loot.map(x => ({kind: x.kind, amount: x.amount, cmin: x.cmin, cmax: x.cmax, weight: x.weight}))}), 'Ящик сохранён');
            if (out) { sel = out.id; form = null; draw(); }
        });
    };
    draw();
}

window.crafterChestsAdmin = {admin};
})();
