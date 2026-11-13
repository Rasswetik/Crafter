/* Administrator: exchange plates (balls <-> GRAM) of the special market and author codes. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const NAME = {BALLS: 'Новогодние шары', GRAM: 'GRAM'};

async function admin(content) {
    let r;
    try { r = await api('admin/new-year/exchange'); } catch (_) { return; }
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section';
    sec.dataset.pane = 'exchange';
    content.appendChild(sec);
    const blank = () => ({id: '', section_id: (r.sections[0] || {}).id || '', group_title: '', pay_cur: 'GRAM', pay_amount: '', get_cur: 'BALLS', get_amount: '', bonus: '', image: '', per_user: '', stock: '', status: 'active'});
    let f = blank();
    const X = () => window.crafterFestiveExchange;
    const cur = (name, val) => '<select data-x="' + name + '"><option value="BALLS"' + (val === 'BALLS' ? ' selected' : '') + '>Новогодние шары</option><option value="GRAM"' + (val === 'GRAM' ? ' selected' : '') + '>GRAM</option></select>';
    const pull = () => sec.querySelectorAll('[data-x]').forEach(i => { f[i.dataset.x] = i.value; });
    const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); await reload(); } catch (err) { toast(err.message); } };
    const reload = async () => { try { r = await api('admin/new-year/exchange'); } catch (_) {} draw(); };
    const secName = id => (r.sections.find(s => s.id === id) || {}).title || '—';
    const preview = () => {
        const ex = {id: 'p', section_id: f.section_id, group_title: f.group_title, pay_cur: f.pay_cur, pay_amount: f.pay_amount || '0', get_cur: f.get_cur, get_amount: f.get_amount || '0', bonus: f.bonus || '0', image: f.image, left: null, mine: 0, per_user: null};
        return X() ? X().tile(ex, {preview: true}) : '';
    };
    const draw = () => {
        const groups = {};
        r.exchanges.forEach(x => { (groups[x.section_id] = groups[x.section_id] || []).push(x); });
        const list = Object.keys(groups).map(sid => '<h4 style="margin:18px 0 6px">Раздел: ' + e(secName(sid)) + '</h4><div class="ex-list">' + groups[sid].map(x =>
            '<div class="ex-row' + (x.status === 'hidden' ? ' is-off' : '') + '"><div class="ex-mini">' + (X() ? X().tile(x, {preview: true}) : '') + '</div><div class="ex-info"><b>' + e(x.group_title || 'Обмен') + '</b><small>Отдаёт ' + e(x.pay_amount) + ' ' + e(NAME[x.pay_cur]) + ' → получает ' + e(x.get_amount) + (Number(x.bonus) > 0 ? ' + ' + e(x.bonus) : '') + ' ' + e(NAME[x.get_cur]) + '</small><small>' +
            (x.stock !== null ? 'Всего ' + x.stock + ', осталось ' + x.left : 'Без ограничений') + (x.per_user ? ' · по ' + x.per_user + ' на игрока' : '') + (x.status === 'hidden' ? ' · скрыт' : '') + '</small></div>' +
            '<span><button type="button" data-ex-edit="' + e(x.id) + '">Изменить</button> <button type="button" data-ex-hide="' + e(x.id) + '">' + (x.status === 'hidden' ? 'Показать' : 'Скрыть') + '</button> <button type="button" data-ex-del="' + e(x.id) + '">Удалить</button></span></div>').join('') + '</div>').join('');
        const groupsHint = [...new Set(r.exchanges.map(x => x.group_title).filter(Boolean))];
        sec.innerHTML = '<h3>Обмен: шары и GRAM</h3>' +
            '<p class="sub">Плитки обмена стоят в разделе типа «Обмен»: создайте его в «Магазин → Разделы маркета» кнопкой «+ Раздел обмена». Плитки группируются в колонки по заголовку («Новогодние шары», «GRAM»…). Бонус показывается красной полосой «75 + ещё 5».</p>' +
            (r.sections.length ? '' : '<div class="si-editing">Пока нет ни одного раздела обмена. Создайте его во вкладке «Магазин», потом вернитесь сюда.</div>') +
            list +
            '<h4 style="margin:22px 0 4px">' + (f.id ? 'Изменить плитку' : 'Новая плитка') + '</h4>' +
            '<div class="ex-form">' +
            '<label>Раздел<select data-x="section_id">' + r.sections.map(s => '<option value="' + e(s.id) + '"' + (f.section_id === s.id ? ' selected' : '') + '>' + e(s.title) + '</option>').join('') + '</select></label>' +
            '<label>Колонка (заголовок)<input data-x="group_title" list="ex-groups" maxlength="40" value="' + e(f.group_title) + '" placeholder="Новогодние шары"><datalist id="ex-groups">' + groupsHint.map(g => '<option value="' + e(g) + '">').join('') + '</datalist></label>' +
            '<label>Игрок отдаёт<div style="display:flex;gap:6px">' + cur('pay_cur', f.pay_cur) + '<input data-x="pay_amount" inputmode="decimal" value="' + e(f.pay_amount) + '" placeholder="Сколько"></div></label>' +
            '<label>Игрок получает<div style="display:flex;gap:6px">' + cur('get_cur', f.get_cur) + '<input data-x="get_amount" inputmode="decimal" value="' + e(f.get_amount) + '" placeholder="Сколько"></div></label>' +
            '<label>Бонус (ещё сверху)<input data-x="bonus" inputmode="decimal" value="' + e(f.bonus) + '" placeholder="Без бонуса"></label>' +
            '<label>Сколько всего<input data-x="stock" type="number" min="0" value="' + e(f.stock) + '" placeholder="Без ограничений"></label>' +
            '<label>На одного игрока<input data-x="per_user" type="number" min="0" value="' + e(f.per_user) + '" placeholder="Без ограничений"></label>' +
            '<label>Показывать<select data-x="status"><option value="active"' + (f.status === 'active' ? ' selected' : '') + '>Да</option><option value="hidden"' + (f.status === 'hidden' ? ' selected' : '') + '>Нет</option></select></label></div>' +
            '<div class="ex-prev"><div><div class="ex-up">' + (f.image ? '<img src="' + e(f.image) + '" alt="">' : '<i>Своя картинка не выбрана: будет значок валюты</i>') +
            '<label class="fm-upbtn">Загрузить PNG<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden data-x-file></label>' + (f.image ? '<button type="button" data-x-clear>Убрать</button>' : '') + '</div></div>' +
            '<div class="ex-mini" style="width:156px;height:236px">' + preview() + '</div></div>' +
            '<button class="primary" type="button" id="ex-save">' + (f.id ? 'Сохранить плитку' : 'Добавить плитку') + '</button>' + (f.id ? ' <button type="button" id="ex-cancel">Отмена</button>' : '') +
            '<h3 style="margin-top:34px">Коды авторов</h3>' +
            '<p class="sub">Код привязывается к игроку-автору. Когда другой игрок вводит код, процент от всех его покупок (магазин, паки, обмен) начисляется автору. Сменить автора игрок может раз в 7 дней.</p>' +
            '<div class="ex-form"><label>Процент автору (0–50)<input id="ac-rate" inputmode="decimal" value="' + e(r.percent) + '"></label><div style="align-self:end"><button type="button" id="ac-rate-save">Сохранить процент</button></div></div>' +
            '<div class="ex-form"><label>Новый код<input id="ac-code" maxlength="20" placeholder="VASYA" style="text-transform:uppercase"></label><label>Telegram ID автора<input id="ac-owner" inputmode="numeric" placeholder="123456789"></label><div style="align-self:end"><button class="primary" type="button" id="ac-add">Создать код</button></div></div>' +
            (r.codes.length ? '<table class="ex-codes"><tr><th>Код</th><th>Автор</th><th>Игроков</th><th>Заработал</th><th></th></tr>' + r.codes.map(c => '<tr' + (c.active ? '' : ' style="opacity:.5"') + '><td><b>' + e(c.code) + '</b></td><td>' + e(c.owner || '') + ' <small>' + c.owner_id + '</small></td><td>' + c.supporters + '</td><td>' + e(c.earned_balls) + ' шаров · ' + e(c.earned_gram) + ' GRAM</td><td><button type="button" data-ac-toggle="' + e(c.code) + '">' + (c.active ? 'Выключить' : 'Включить') + '</button> <button type="button" data-ac-del="' + e(c.code) + '">Удалить</button></td></tr>').join('') + '</table>' : '<p class="sub">Кодов пока нет.</p>');
        bind();
    };
    const bind = () => {
        sec.querySelectorAll('[data-x]').forEach(i => i.addEventListener('change', () => { pull(); const p = sec.querySelector('.ex-prev .ex-mini'); if (p) p.innerHTML = preview(); }));
        sec.querySelector('[data-x-file]')?.addEventListener('change', async ev => {
            const file = ev.target.files[0]; if (!file) return;
            if (file.size > 600000) { toast('Файл должен быть не больше 600 КБ'); return; }
            try { const body = new FormData(); body.append('file', file); pull(); f.image = (await api('admin/new-year/shop-media', body)).url; draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-x-clear]')?.addEventListener('click', () => { pull(); f.image = ''; draw(); });
        sec.querySelector('#ex-save')?.addEventListener('click', () => { pull(); run(async () => { await api('admin/new-year/exchange', f); f = blank(); }, 'Плитка сохранена'); });
        sec.querySelector('#ex-cancel')?.addEventListener('click', () => { f = blank(); draw(); });
        sec.querySelectorAll('[data-ex-edit]').forEach(b => b.addEventListener('click', () => {
            const x = r.exchanges.find(y => y.id === b.dataset.exEdit); if (!x) return;
            f = {id: x.id, section_id: x.section_id, group_title: x.group_title, pay_cur: x.pay_cur, pay_amount: x.pay_amount, get_cur: x.get_cur, get_amount: x.get_amount, bonus: Number(x.bonus) ? x.bonus : '', image: x.image, per_user: x.per_user || '', stock: x.stock || '', status: x.status};
            draw(); sec.querySelector('.ex-form')?.scrollIntoView({behavior: 'smooth', block: 'center'});
        }));
        sec.querySelectorAll('[data-ex-hide]').forEach(b => b.addEventListener('click', () => {
            const x = r.exchanges.find(y => y.id === b.dataset.exHide); if (!x) return;
            run(() => api('admin/new-year/exchange', {...x, bonus: x.bonus, status: x.status === 'hidden' ? 'active' : 'hidden', per_user: x.per_user || '', stock: x.stock || ''}), 'Готово');
        }));
        sec.querySelectorAll('[data-ex-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Удалить плитку?')) run(() => api('admin/new-year/exchange/' + b.dataset.exDel + '/delete', {}), 'Удалено'); }));
        sec.querySelector('#ac-add')?.addEventListener('click', () => run(() => api('admin/new-year/author-codes', {code: sec.querySelector('#ac-code').value, owner_id: sec.querySelector('#ac-owner').value}), 'Код создан'));
        sec.querySelector('#ac-rate-save')?.addEventListener('click', () => run(() => api('admin/new-year/author-rate', {percent: sec.querySelector('#ac-rate').value}), 'Процент сохранён'));
        sec.querySelectorAll('[data-ac-toggle]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/author-codes/' + encodeURIComponent(b.dataset.acToggle) + '/toggle', {}), 'Готово')));
        sec.querySelectorAll('[data-ac-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Удалить код? Игроки, которые его вводили, перестанут его поддерживать.')) run(() => api('admin/new-year/author-codes/' + encodeURIComponent(b.dataset.acDel) + '/delete', {}), 'Код удалён'); }));
    };
    draw();
}

window.crafterExchange = {admin};
})();
