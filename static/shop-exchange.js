/* Administrator: the exchange of the special market (sections of exchange, plates balls <-> GRAM) and author codes.
   Everything for the exchange is made in this one tab: no need to go to another tab to create a section. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const NAME = {BALLS: 'шаров', GRAM: 'GRAM'};
const DIRS = [['GRAM>BALLS', 'GRAM → Новогодние шары', 'Игрок платит GRAM и получает шары'], ['BALLS>GRAM', 'Новогодние шары → GRAM', 'Игрок платит шарами и получает GRAM']];

async function admin(content) {
    let r;
    try { r = await api('admin/new-year/exchange'); } catch (_) { return; }
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section';
    sec.dataset.pane = 'exchange';
    content.appendChild(sec);
    const F = () => window.crafterFestive, X = () => window.crafterFestiveExchange;
    const blank = () => ({id: '', section_id: (r.sections[0] || {}).id || '', group_title: '', dir: 'GRAM>BALLS', pay_amount: '', get_amount: '', bonus: '', image: '', per_user: '', stock: '', status: 'active'});
    let f = blank(), sf = null;
    const pay = () => f.dir.split('>')[0], get = () => f.dir.split('>')[1];
    const pull = () => sec.querySelectorAll('[data-x]').forEach(i => { f[i.dataset.x] = i.value; });
    const pullS = () => { const t = sec.querySelector('[data-sf-title]'); if (t && sf) sf.title = t.value; };
    const reload = async () => { try { r = await api('admin/new-year/exchange'); } catch (_) {} if (!r.sections.some(s => s.id === f.section_id)) f.section_id = (r.sections[0] || {}).id || ''; draw(); };
    const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); await reload(); } catch (err) { toast(err.message); } };
    const secName = id => (r.sections.find(s => s.id === id) || {}).title || '—';
    const field = (label, input, hint) => '<div class="adm-field"><label>' + label + '</label>' + input + (hint ? '<small class="sub">' + hint + '</small>' : '') + '</div>';
    const chips = (items, on, attr) => '<div class="adm-chips">' + items.map(([v, t]) => '<button type="button" class="' + (on === v ? 'is-on' : '') + '" ' + attr + '="' + e(v) + '">' + e(t) + '</button>').join('') + '</div>';
    const previewEx = () => ({id: 'p', section_id: f.section_id, group_title: f.group_title, pay_cur: pay(), pay_amount: f.pay_amount || '0', get_cur: get(), get_amount: f.get_amount || '0', bonus: f.bonus || '0', image: f.image, left: null, mine: 0, per_user: null});

    const sectionsStep = () => {
        const rows = r.sections.map(s => '<div class="fm-srow' + (s.enabled ? '' : ' is-off') + '"><span class="fm-sico">' + (F() ? F().iconHTML(s.icon) : '') + '</span><b>' + e(s.title) + '</b><small>раздел обмена · плиток: ' + r.exchanges.filter(x => x.section_id === s.id).length + (s.enabled ? '' : ' · скрыт от игроков') + '</small>' +
            '<span class="fm-sbt"><button type="button" data-xs-edit="' + e(s.id) + '">Изменить</button><button type="button" data-xs-toggle="' + e(s.id) + '">' + (s.enabled ? 'Скрыть' : 'Показать') + '</button><button type="button" data-xs-del="' + e(s.id) + '">Удалить</button></span></div>').join('');
        let form = '';
        if (sf) {
            const ic = F() ? F().icons : {}, icons = Object.keys(ic).filter((k, i, all) => all.findIndex(x => ic[x] === ic[k]) === i);
            form = '<div class="adm-step fm-sform"><h4>' + (sf.id ? 'Раздел обмена: изменить' : 'Новый раздел обмена') + '</h4>' +
                '<div class="adm-row3">' + field('Название кнопки', '<input data-sf-title maxlength="24" value="' + e(sf.title) + '" placeholder="Ресурсы">') + '</div>' +
                field('Значок', '<div class="fm-icons">' + icons.map(k => '<button type="button" class="fm-iconopt' + (sf.icon === 'builtin:' + k ? ' is-on' : '') + '" data-xs-icon="builtin:' + e(k) + '">' + F().iconHTML('builtin:' + k) + '</button>').join('') + '</div>') +
                field('Фон раздела', '<div class="fm-gal">' + (F() ? F().bgKeys : []).map(k => '<button type="button" class="fm-sw' + (sf.bg === k[0] ? ' is-on' : '') + '" data-xs-bg="' + e(k[0]) + '"><span class="fm-swp"><span class="fm-swc">' + (window.crafterScenes ? window.crafterScenes.render(k[0] === 'village' ? 'night' : k[0], {still: true}) : '') + '</span></span><em>' + e(k[1]) + '</em></button>').join('') + '</div>') +
                '<button class="primary" type="button" id="xs-save">Сохранить раздел</button> <button type="button" id="xs-cancel">Отмена</button></div>';
        }
        return '<div class="adm-step"><h4>1. Раздел обмена</h4><p class="sub">Это кнопка слева в маркете (например «Ресурсы»). В ней стоят плитки обмена и колонка «Поддержка автора контента».</p>' +
            (r.sections.length ? '<div class="fm-slist">' + rows + '</div>' : '<div class="si-editing">Разделов обмена пока нет. Создайте первый: это одно нажатие.</div>') +
            (sf ? '' : '<button type="button" class="primary" id="xs-add">+ Создать раздел обмена</button>') + '</div>' + form;
    };

    const tilesStep = () => {
        const groups = {};
        r.exchanges.forEach(x => { (groups[x.section_id] = groups[x.section_id] || []).push(x); });
        const list = Object.keys(groups).map(sid => '<h4 style="margin:18px 0 8px">Раздел «' + e(secName(sid)) + '»</h4><div class="ex-list">' + groups[sid].map(x =>
            '<div class="ex-row' + (x.status === 'hidden' ? ' is-off' : '') + '"><div class="ex-mini">' + (X() ? X().tile(x, {preview: true}) : '') + '</div><div class="ex-info"><b>' + e(x.group_title || 'Обмен') + '</b><small>Отдаёт ' + e(x.pay_amount) + ' ' + e(NAME[x.pay_cur]) + ' → получает ' + e(x.get_amount) + (Number(x.bonus) > 0 ? ' + ' + e(x.bonus) + ' бонус' : '') + ' ' + e(NAME[x.get_cur]) + '</small><small>' +
            (x.stock !== null ? 'Всего ' + x.stock + ', осталось ' + x.left : 'Без ограничений') + (x.per_user ? ' · по ' + x.per_user + ' на игрока' : '') + (x.status === 'hidden' ? ' · скрыта' : '') + '</small></div>' +
            '<span class="fm-sbt"><button type="button" data-ex-edit="' + e(x.id) + '">Изменить</button><button type="button" data-ex-hide="' + e(x.id) + '">' + (x.status === 'hidden' ? 'Показать' : 'Скрыть') + '</button><button type="button" data-ex-del="' + e(x.id) + '">Удалить</button></span></div>').join('') + '</div>').join('');
        if (!r.sections.length) return '<div class="adm-step"><h4>2. Плитки обмена</h4><p class="sub">Сначала создайте раздел обмена выше.</p></div>';
        const existing = [...new Set(r.exchanges.map(x => x.group_title).filter(Boolean))];
        return '<div class="adm-step"><h4>2. Плитки обмена' + (f.id ? ': изменить' : '') + '</h4>' +
            '<p class="sub">Плитка: сколько игрок платит и сколько получает. Бонус показывается красной полосой «5 000 + ещё 500».</p>' +
            (r.sections.length > 1 ? field('Раздел', chips(r.sections.map(s => [s.id, s.title]), f.section_id, 'data-fsec')) : '') +
            field('Направление', chips(DIRS.map(d => [d[0], d[1]]), f.dir, 'data-fdir'), DIRS.find(d => d[0] === f.dir)[2]) +
            field('Колонка (заголовок над плитками)', '<input data-x="group_title" maxlength="40" value="' + e(f.group_title) + '" placeholder="Например: Новогодние шары">' + (existing.length ? '<div class="adm-chips" style="margin-top:8px">' + existing.map(g => '<button type="button" data-fgroup="' + e(g) + '">' + e(g) + '</button>').join('') + '</div>' : '')) +
            '<div class="adm-row3">' + field('Игрок платит (' + NAME[pay()] + ')', '<input data-x="pay_amount" inputmode="decimal" value="' + e(f.pay_amount) + '" placeholder="Сколько">') +
            field('Игрок получает (' + NAME[get()] + ')', '<input data-x="get_amount" inputmode="decimal" value="' + e(f.get_amount) + '" placeholder="Сколько">') +
            field('Бонус сверху (' + NAME[get()] + ')', '<input data-x="bonus" inputmode="decimal" value="' + e(f.bonus) + '" placeholder="Без бонуса">') + '</div>' +
            '<div class="adm-row3">' + field('Сколько всего раз', '<input data-x="stock" type="number" min="0" value="' + e(f.stock) + '" placeholder="Без ограничений">') +
            field('На одного игрока', '<input data-x="per_user" type="number" min="0" value="' + e(f.per_user) + '" placeholder="Без ограничений">') +
            field('Показывать', chips([['active', 'Да'], ['hidden', 'Нет']], f.status, 'data-fstatus')) + '</div>' +
            field('Картинка плитки (PNG)', '<div class="ex-up">' + (f.image ? '<img src="' + e(f.image) + '" alt="">' : '<i class="sub">Не выбрана: будет значок валюты</i>') + '<label class="fm-upbtn">Загрузить PNG<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden data-x-file></label>' + (f.image ? '<button type="button" data-x-clear>Убрать</button>' : '') + '</div>') +
            '<div class="ex-prev"><div><b class="sub">Так плитка выглядит у игроков</b><div class="ex-mini ex-big">' + (X() ? X().tile(previewEx(), {preview: true}) : '') + '</div></div></div>' +
            '<button class="primary" type="button" id="ex-save">' + (f.id ? 'Сохранить плитку' : 'Добавить плитку') + '</button>' + (f.id ? ' <button type="button" id="ex-cancel">Отмена</button>' : '') +
            (list ? '<h3 style="margin:26px 0 0">Созданные плитки</h3>' + list : '') + '</div>';
    };

    const authorsStep = () => '<div class="adm-step"><h4>3. Коды авторов</h4>' +
        '<p class="sub">Код привязывается к игроку-автору. Когда другой игрок вводит код, указанный процент от всех его покупок (магазин, паки, обмен) начисляется автору в той же валюте. Сменить автора игрок может раз в 7 дней. Автор видит свою статистику в разделе «Автор» (под админ-панелью).</p>' +
        '<div class="adm-row3">' + field('Процент автору (0–50)', '<input id="ac-rate" inputmode="decimal" value="' + e(r.percent) + '">') + '<div class="adm-field"><label>&nbsp;</label><button type="button" id="ac-rate-save">Сохранить процент</button></div></div>' +
        '<div class="adm-row3">' + field('Новый код', '<input id="ac-code" maxlength="20" placeholder="VASYA" style="text-transform:uppercase">') + field('Telegram ID автора', '<input id="ac-owner" inputmode="numeric" placeholder="123456789">') + '<div class="adm-field"><label>&nbsp;</label><button class="primary" type="button" id="ac-add">Создать код</button></div></div>' +
        (r.codes.length ? '<table class="ex-codes"><tr><th>Код</th><th>Автор</th><th>Игроков</th><th>Заработал</th><th></th></tr>' + r.codes.map(c => '<tr' + (c.active ? '' : ' style="opacity:.5"') + '><td><b>' + e(c.code) + '</b></td><td>' + e(c.owner || '') + ' <small>' + c.owner_id + '</small></td><td>' + c.supporters + '</td><td>' + e(c.earned_balls) + ' шаров · ' + e(c.earned_gram) + ' GRAM</td><td class="fm-sbt"><button type="button" data-ac-toggle="' + e(c.code) + '">' + (c.active ? 'Выключить' : 'Включить') + '</button><button type="button" data-ac-del="' + e(c.code) + '">Удалить</button></td></tr>').join('') + '</table>' : '<p class="sub">Кодов пока нет.</p>') + '</div>';

    const draw = () => {
        sec.innerHTML = '<h3>Обмен и коды авторов</h3>' + sectionsStep() + tilesStep() + authorsStep();
        bind();
    };

    const bind = () => {
        // sections of exchange
        sec.querySelector('#xs-add')?.addEventListener('click', () => { sf = {title: 'Ресурсы', icon: 'builtin:gem', bg: 'fireworks', enabled: true}; draw(); sec.querySelector('.fm-sform')?.scrollIntoView({behavior: 'smooth', block: 'center'}); });
        sec.querySelector('#xs-cancel')?.addEventListener('click', () => { sf = null; draw(); });
        sec.querySelectorAll('[data-xs-edit]').forEach(b => b.addEventListener('click', () => { const s = r.sections.find(x => x.id === b.dataset.xsEdit); sf = {id: s.id, title: s.title, icon: s.icon, bg: s.bg, enabled: s.enabled}; draw(); sec.querySelector('.fm-sform')?.scrollIntoView({behavior: 'smooth', block: 'center'}); }));
        sec.querySelectorAll('[data-xs-icon]').forEach(b => b.addEventListener('click', () => { pullS(); sf.icon = b.dataset.xsIcon; draw(); }));
        sec.querySelectorAll('[data-xs-bg]').forEach(b => b.addEventListener('click', () => { pullS(); sf.bg = b.dataset.xsBg; draw(); }));
        sec.querySelector('#xs-save')?.addEventListener('click', () => { pullS(); const body = {...sf, kind: sf.id ? undefined : 'exchange'}; run(async () => { const out = await api('admin/new-year/shop-sections', body); if (!sf.id) f.section_id = out.id; sf = null; }, 'Раздел сохранён'); });
        sec.querySelectorAll('[data-xs-toggle]').forEach(b => b.addEventListener('click', () => { const s = r.sections.find(x => x.id === b.dataset.xsToggle); run(() => api('admin/new-year/shop-sections', {id: s.id, title: s.title, icon: s.icon, preview: s.preview || '', bg: s.bg, enabled: !s.enabled}), 'Готово'); }));
        sec.querySelectorAll('[data-xs-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Удалить раздел вместе со всеми его плитками?')) run(() => api('admin/new-year/shop-sections/' + b.dataset.xsDel + '/delete', {}), 'Раздел удалён'); }));
        // tiles
        sec.querySelectorAll('[data-fsec]').forEach(b => b.addEventListener('click', () => { pull(); f.section_id = b.dataset.fsec; draw(); }));
        sec.querySelectorAll('[data-fdir]').forEach(b => b.addEventListener('click', () => { pull(); f.dir = b.dataset.fdir; draw(); }));
        sec.querySelectorAll('[data-fgroup]').forEach(b => b.addEventListener('click', () => { pull(); f.group_title = b.dataset.fgroup; draw(); }));
        sec.querySelectorAll('[data-fstatus]').forEach(b => b.addEventListener('click', () => { pull(); f.status = b.dataset.fstatus; draw(); }));
        sec.querySelectorAll('[data-x]').forEach(i => i.addEventListener('input', () => { pull(); const p = sec.querySelector('.ex-big'); if (p && X()) p.innerHTML = X().tile(previewEx(), {preview: true}); }));
        sec.querySelector('[data-x-file]')?.addEventListener('change', async ev => {
            const file = ev.target.files[0]; if (!file) return;
            if (file.size > 15000000) { toast('Файл должен быть не больше 15 МБ'); return; }
            try { const body = new FormData(); body.append('file', file); pull(); f.image = (await api('admin/new-year/shop-media', body)).url; draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-x-clear]')?.addEventListener('click', () => { pull(); f.image = ''; draw(); });
        sec.querySelector('#ex-save')?.addEventListener('click', () => {
            pull();
            const body = {id: f.id, section_id: f.section_id, group_title: f.group_title, pay_cur: pay(), pay_amount: f.pay_amount, get_cur: get(), get_amount: f.get_amount, bonus: f.bonus, image: f.image, per_user: f.per_user, stock: f.stock, status: f.status};
            run(async () => { await api('admin/new-year/exchange', body); f = {...blank(), section_id: f.section_id, group_title: f.group_title, dir: f.dir}; }, 'Плитка сохранена');
        });
        sec.querySelector('#ex-cancel')?.addEventListener('click', () => { f = blank(); draw(); });
        sec.querySelectorAll('[data-ex-edit]').forEach(b => b.addEventListener('click', () => {
            const x = r.exchanges.find(y => y.id === b.dataset.exEdit); if (!x) return;
            f = {id: x.id, section_id: x.section_id, group_title: x.group_title, dir: x.pay_cur + '>' + x.get_cur, pay_amount: x.pay_amount, get_amount: x.get_amount, bonus: Number(x.bonus) ? x.bonus : '', image: x.image, per_user: x.per_user || '', stock: x.stock || '', status: x.status};
            draw(); sec.querySelector('.ex-prev')?.scrollIntoView({behavior: 'smooth', block: 'center'});
        }));
        sec.querySelectorAll('[data-ex-hide]').forEach(b => b.addEventListener('click', () => {
            const x = r.exchanges.find(y => y.id === b.dataset.exHide); if (!x) return;
            run(() => api('admin/new-year/exchange', {...x, status: x.status === 'hidden' ? 'active' : 'hidden', per_user: x.per_user || '', stock: x.stock || ''}), 'Готово');
        }));
        sec.querySelectorAll('[data-ex-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Удалить плитку?')) run(() => api('admin/new-year/exchange/' + b.dataset.exDel + '/delete', {}), 'Удалено'); }));
        // authors
        sec.querySelector('#ac-add')?.addEventListener('click', () => run(() => api('admin/new-year/author-codes', {code: sec.querySelector('#ac-code').value, owner_id: sec.querySelector('#ac-owner').value}), 'Код создан'));
        sec.querySelector('#ac-rate-save')?.addEventListener('click', () => run(() => api('admin/new-year/author-rate', {percent: sec.querySelector('#ac-rate').value}), 'Процент сохранён'));
        sec.querySelectorAll('[data-ac-toggle]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/author-codes/' + encodeURIComponent(b.dataset.acToggle) + '/toggle', {}), 'Готово')));
        sec.querySelectorAll('[data-ac-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Удалить код? Игроки, которые его вводили, перестанут его поддерживать.')) run(() => api('admin/new-year/author-codes/' + encodeURIComponent(b.dataset.acDel) + '/delete', {}), 'Код удалён'); }));
    };
    draw();
}

window.crafterExchange = {admin};
})();
