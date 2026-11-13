/* Administrator: the freebies (gift boxes that open by time). Events with pictures, gifts with time, size, colour and reward. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const toMsk = epoch => new Date((epoch + 3 * 3600) * 1000).toISOString().slice(0, 16);
const IMG = [['preview_bg', 'Фон иконки события', 'Картинка на плитке в разделе «Событие» (камин)', true], ['preview_gift', 'Подарок на иконке', 'Что лежит поверх фона на плитке', false],
    ['page_bg', 'Фон страницы', 'Фон страницы с подарками (красный узор)', true], ['gift_regular', 'Обычный подарок', 'Коробка обычного подарка', false], ['gift_gold', 'Золотой подарок', 'Коробка золотого подарка', false]];
const KINDS = [['GRAM', 'GRAM'], ['BALL', 'Новогодние шары'], ['PACK', 'Пак'], ['STAR', 'Подарок Telegram']];

async function admin(content) {
    let r;
    try { r = await api('admin/new-year/freebies'); } catch (_) { return; }
    let packs = [], STARS = [];
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) {}
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section';
    sec.dataset.pane = 'freebies';
    content.appendChild(sec);
    let sel = r.events[0]?.id || '', ef = null, gf = null, sf = null;
    const reload = async () => { try { r = await api('admin/new-year/freebies'); } catch (_) {} if (!r.events.some(x => x.id === sel)) sel = r.events[0]?.id || ''; draw(); };
    const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); await reload(); } catch (err) { toast(err.message); } };
    const F = () => window.crafterFreebies;
    const field = (label, input, hint) => '<div class="adm-field"><label>' + label + '</label>' + input + (hint ? '<small class="sub">' + hint + '</small>' : '') + '</div>';
    const chips = (items, on, attr) => '<div class="adm-chips">' + items.map(([v, t]) => '<button type="button" class="' + (String(on) === String(v) ? 'is-on' : '') + '" ' + attr + '="' + e(v) + '">' + e(t) + '</button>').join('') + '</div>';
    const rewardText = x => x.kind === 'GRAM' ? x.amount + ' GRAM' : x.kind === 'BALL' ? Number(x.amount).toLocaleString('ru-RU') + ' шаров' : x.kind === 'PACK' ? (packs.find(p => p.id === x.amount)?.title || 'Пак') + (x.count > 1 ? ' ×' + x.count : '') : (STARS.find(s => s.key === x.amount)?.name || 'Подарок') + (x.count > 1 ? ' ×' + x.count : '');
    const uploadMedia = async file => { if (file.size > 600000) throw new Error('Файл должен быть не больше 600 КБ'); const b = new FormData(); b.append('file', file); return (await api('admin/new-year/shop-media', b)).url; };
    const pull = () => sec.querySelectorAll('[data-fx]').forEach(i => { (i.dataset.fx.startsWith('e.') ? ef : i.dataset.fx.startsWith('g.') ? gf : sf)[i.dataset.fx.slice(2)] = i.value; });

    const rewardPicker = (o, p) => {
        const k = o.kind, cnt = k === 'PACK' || k === 'STAR';
        return field('Награда', chips(KINDS, k, 'data-' + p + 'kind')) +
            (k === 'PACK' ? field('Какой пак', '<select data-fx="' + p + '.amount">' + packs.map(x => '<option value="' + e(x.id) + '"' + (o.amount === x.id ? ' selected' : '') + '>' + e(x.title) + '</option>').join('') + '</select>')
                : k === 'STAR' ? field('Какой подарок', '<select data-fx="' + p + '.amount">' + (window.crafterStarGifts ? window.crafterStarGifts.options(STARS, o.amount) : '') + '</select>')
                : field(k === 'BALL' ? 'Сколько шаров' : 'Сколько GRAM', '<input data-fx="' + p + '.amount" inputmode="decimal" value="' + e(o.amount) + '" placeholder="Например: ' + (k === 'BALL' ? '500' : '0.5') + '">')) +
            (cnt ? field('Сколько штук', '<input data-fx="' + p + '.count" type="number" min="1" max="20" value="' + e(o.count) + '">') : '');
    };
    const setKind = (o, k) => { o.kind = k; o.amount = k === 'PACK' ? (packs[0]?.id || '') : k === 'STAR' ? (STARS[0]?.key || '') : (k === 'BALL' ? '500' : '0.5'); o.count = 1; };

    const eventsStep = () => {
        const rows = r.events.map(ev => '<div class="fba-ev' + (ev.enabled ? '' : ' is-off') + '">' + (F() ? F().card({...ev, now: r.now, ready: 0, claimed: 0}) : '') +
            '<div class="fba-info"><b>' + e(ev.title) + '</b><small>Подарков: ' + ev.total + ' · открыто: ' + ev.gifts.filter(x => x.opened).length + (ev.ends_at ? ' · до ' + new Date(ev.ends_at * 1000).toLocaleString('ru-RU', {timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + ' МСК' : '') + (ev.enabled ? '' : ' · скрыто от игроков') + '</small></div>' +
            '<span class="fm-sbt"><button type="button" data-ev-pick="' + e(ev.id) + '"' + (sel === ev.id ? ' class="is-on"' : '') + '>Подарки</button><button type="button" data-ev-edit="' + e(ev.id) + '">Изменить</button><button type="button" data-ev-toggle="' + e(ev.id) + '">' + (ev.enabled ? 'Скрыть' : 'Показать') + '</button><button type="button" data-ev-del="' + e(ev.id) + '">Удалить</button></span></div>').join('');
        let form = '';
        if (ef) {
            form = '<div class="adm-step"><h4>' + (ef.id ? 'Событие: изменить' : 'Новое событие') + '</h4>' + field('Заголовок', '<input data-fx="e.title" maxlength="40" value="' + e(ef.title) + '" placeholder="Подарки Нового года">') +
                field('Показывать игрокам', chips([['1', 'Да'], ['0', 'Нет']], ef.enabled ? '1' : '0', 'data-ev-on')) +
                '<div class="adm-row3">' + field('Событие появится (по Москве)', '<input type="datetime-local" data-fx="e.starts_at_msk" value="' + e(ef.starts_at_msk || '') + '">', 'Пусто: сразу') +
                field('Событие закончится (по Москве)', '<input type="datetime-local" data-fx="e.ends_at_msk" value="' + e(ef.ends_at_msk || '') + '">', 'Пусто: без конца. До этого момента подарки можно забирать, даже когда все коробки уже открылись.') + '</div>' +
                '<div class="fba-imgs">' + IMG.map(([k, name, hint, cover]) => '<div class="fba-img"><b>' + name + '</b><div class="pv' + (cover ? ' cover' : '') + '" style="background-image:url(' + e(ef[k] || r.defaults[k]) + ')"></div><small>' + hint + (ef[k] ? '' : ' (сейчас по умолчанию)') + '</small>' +
                    '<div class="ex-up"><label class="fm-upbtn">Загрузить<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden data-ev-file="' + k + '"></label>' + (ef[k] ? '<button type="button" data-ev-reset="' + k + '">По умолчанию</button>' : '') + '</div></div>').join('') + '</div>' +
                '<button class="primary" type="button" id="ev-save">Сохранить событие</button> <button type="button" id="ev-cancel">Отмена</button></div>';
        }
        return '<div class="adm-step"><h4>1. События с подарками</h4><p class="sub">Каждое событие появляется плиткой первым в разделе «Акции» Особого маркета, по нажатию открывается окно с подарками. Картинки можно загрузить свои или оставить по умолчанию.</p>' +
            (r.events.length ? '<div class="fba-events">' + rows + '</div>' : '<div class="si-editing">Событий пока нет. Создайте первое.</div>') +
            (ef ? '' : '<button type="button" class="primary" id="ev-add">+ Создать событие</button>') + '</div>' + form;
    };

    const giftsStep = () => {
        const ev = r.events.find(x => x.id === sel);
        if (!ev) return '';
        const rows = ev.gifts.map(x => '<div class="fba-row' + (x.golden ? ' is-gold' : '') + '"><img class="fba-g" src="' + e(x.golden ? ev.gift_gold : ev.gift_regular) + '" alt=""><span><b>' + e(x.label || '—') + '</b><br><small>' + (x.golden ? 'золотая коробка' : 'обычная коробка') + '</small></span><span>' + new Date(x.unlock_at * 1000).toLocaleString('ru-RU', {timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + ' МСК<br><small>' + (x.opened ? 'открыт' : 'ещё закрыт') + '</small></span><span>' + (x.taken || 0) + ' забрали</span><span>' + e(rewardText(x)) + '</span><span class="fm-sbt"><button type="button" data-g-edit="' + e(x.id) + '">Изменить</button><button type="button" data-g-del="' + e(x.id) + '">Удалить</button></span></div>').join('');
        let form = '';
        if (gf) {
            form = '<div class="adm-step"><h4>' + (gf.id ? 'Подарок: изменить' : 'Новый подарок') + '</h4><div class="adm-row3">' + field('Надпись на коробке', '<input data-fx="g.label" maxlength="24" value="' + e(gf.label) + '" placeholder="День 1">') +
                field('Откроется (по Москве)', '<input type="datetime-local" data-fx="g.unlock_at_msk" value="' + e(gf.unlock_at_msk) + '">') + '</div>' +
                '<div class="adm-row3">' + field('Коробка', chips([['0', 'Обычная'], ['1', 'Золотая']], gf.golden ? '1' : '0', 'data-g-gold')) + '</div>' +
                rewardPicker(gf, 'g') + '<button class="primary" type="button" id="g-save">Сохранить подарок</button> <button type="button" id="g-cancel">Отмена</button></div>';
        }
        let series = '';
        if (sf) {
            series = '<div class="adm-step"><h4>Серия подарков</h4><p class="sub">Первый откроется в указанное время, остальные через равные промежутки. Награда у всех одинаковая, потом её можно поменять у каждого.</p><div class="adm-row3">' +
                field('Первый откроется (МСК)', '<input type="datetime-local" data-fx="s.start_msk" value="' + e(sf.start_msk) + '">') + field('Сколько подарков', '<input data-fx="s.number" type="number" min="1" max="60" value="' + e(sf.number) + '">') + field('Шаг, часов', '<input data-fx="s.step_hours" inputmode="decimal" value="' + e(sf.step_hours) + '">', '24 = каждый день') + '</div>' +
                '<div class="adm-row3">' + field('Подпись', '<input data-fx="s.label_prefix" maxlength="16" value="' + e(sf.label_prefix) + '">', 'Получится «День 1», «День 2»…') + field('Каждый какой золотой', '<input data-fx="s.golden_every" type="number" min="0" max="60" value="' + e(sf.golden_every) + '">', '0 = без золотых') + '</div>' +
                rewardPicker(sf, 's') + '<button class="primary" type="button" id="s-save">Создать серию</button> <button type="button" id="s-cancel">Отмена</button></div>';
        }
        return '<div class="adm-step"><h4>2. Подарки события «' + e(ev.title) + '»</h4>' + (ev.gifts.length ? '<div class="fba-rows">' + rows + '</div>' : '<p class="sub">Подарков пока нет.</p>') +
            (gf || sf ? '' : '<button type="button" class="primary" id="g-add">+ Добавить подарок</button> <button type="button" id="s-add">+ Серия подарков</button>') + '</div>' + form + series;
    };

    const draw = () => { sec.innerHTML = '<h3>Подарки по дням</h3>' + eventsStep() + giftsStep(); bind(); };
    const newGift = () => ({id: '', label: '', unlock_at_msk: toMsk(Math.floor(Date.now() / 1000) + 3600), golden: false, size: 'normal', kind: 'BALL', amount: '500', count: 1});
    const bind = () => {
        // events
        sec.querySelector('#ev-add')?.addEventListener('click', () => { ef = {title: 'Подарки Нового года', enabled: true, preview_bg: '', preview_gift: '', page_bg: '', gift_regular: '', gift_gold: ''}; draw(); sec.querySelector('#ev-save')?.scrollIntoView({behavior: 'smooth', block: 'center'}); });
        sec.querySelector('#ev-cancel')?.addEventListener('click', () => { ef = null; draw(); });
        sec.querySelectorAll('[data-ev-edit]').forEach(b => b.addEventListener('click', () => { const x = r.events.find(y => y.id === b.dataset.evEdit); ef = {id: x.id, title: x.title, enabled: x.enabled, starts_at_msk: x.starts_at ? toMsk(x.starts_at) : '', ends_at_msk: x.ends_at ? toMsk(x.ends_at) : '', preview_bg: x.preview_bg_custom, preview_gift: x.preview_gift_custom, page_bg: x.page_bg_custom, gift_regular: x.gift_regular_custom, gift_gold: x.gift_gold_custom}; draw(); sec.querySelector('#ev-save')?.scrollIntoView({behavior: 'smooth', block: 'center'}); }));
        sec.querySelectorAll('[data-ev-on]').forEach(b => b.addEventListener('click', () => { pull(); ef.enabled = b.dataset.evOn === '1'; draw(); }));
        sec.querySelectorAll('[data-ev-file]').forEach(i => i.addEventListener('change', async () => { const f = i.files[0]; if (!f) return; try { pull(); ef[i.dataset.evFile] = await uploadMedia(f); draw(); } catch (err) { toast(err.message); } }));
        sec.querySelectorAll('[data-ev-reset]').forEach(b => b.addEventListener('click', () => { pull(); ef[b.dataset.evReset] = ''; draw(); }));
        sec.querySelector('#ev-save')?.addEventListener('click', () => { pull(); run(async () => { const out = await api('admin/new-year/freebies/event', ef); sel = out.id; ef = null; }, 'Событие сохранено'); });
        sec.querySelectorAll('[data-ev-pick]').forEach(b => b.addEventListener('click', () => { sel = b.dataset.evPick; gf = null; sf = null; draw(); sec.querySelector('#g-add, .fba-rows')?.scrollIntoView({behavior: 'smooth', block: 'center'}); }));
        sec.querySelectorAll('[data-ev-toggle]').forEach(b => b.addEventListener('click', () => { const x = r.events.find(y => y.id === b.dataset.evToggle); run(() => api('admin/new-year/freebies/event', {id: x.id, title: x.title, enabled: !x.enabled, starts_at_msk: x.starts_at ? toMsk(x.starts_at) : '', ends_at_msk: x.ends_at ? toMsk(x.ends_at) : '', preview_bg: x.preview_bg_custom, preview_gift: x.preview_gift_custom, page_bg: x.page_bg_custom, gift_regular: x.gift_regular_custom, gift_gold: x.gift_gold_custom}), 'Готово'); }));
        sec.querySelectorAll('[data-ev-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Удалить событие вместе со всеми подарками?')) run(() => api('admin/new-year/freebies/event/' + b.dataset.evDel + '/delete', {}), 'Событие удалено'); }));
        // gifts
        sec.querySelector('#g-add')?.addEventListener('click', () => { gf = newGift(); draw(); sec.querySelector('#g-save')?.scrollIntoView({behavior: 'smooth', block: 'center'}); });
        sec.querySelector('#g-cancel')?.addEventListener('click', () => { gf = null; draw(); });
        sec.querySelectorAll('[data-g-edit]').forEach(b => b.addEventListener('click', () => { const ev = r.events.find(y => y.id === sel), x = ev.gifts.find(y => y.id === b.dataset.gEdit); gf = {id: x.id, label: x.label, unlock_at_msk: toMsk(x.unlock_at), golden: x.golden, size: x.size, kind: x.kind, amount: x.amount, count: x.count}; sf = null; draw(); sec.querySelector('#g-save')?.scrollIntoView({behavior: 'smooth', block: 'center'}); }));
        sec.querySelectorAll('[data-g-gold]').forEach(b => b.addEventListener('click', () => { pull(); gf.golden = b.dataset.gGold === '1'; draw(); }));
        sec.querySelectorAll('[data-g-size]').forEach(b => b.addEventListener('click', () => { pull(); gf.size = b.dataset.gSize; draw(); }));
        sec.querySelectorAll('[data-gkind]').forEach(b => b.addEventListener('click', () => { pull(); setKind(gf, b.dataset.gkind); draw(); }));
        sec.querySelector('#g-save')?.addEventListener('click', () => { pull(); run(async () => { await api('admin/new-year/freebies/gift', {...gf, event_id: sel}); gf = null; }, 'Подарок сохранён'); });
        sec.querySelectorAll('[data-g-del]').forEach(b => b.addEventListener('click', () => { if (confirm('Удалить подарок?')) run(() => api('admin/new-year/freebies/gift/' + b.dataset.gDel + '/delete', {}), 'Подарок удалён'); }));
        // series
        sec.querySelector('#s-add')?.addEventListener('click', () => { sf = {start_msk: toMsk(Math.floor(Date.now() / 1000) + 3600), number: '7', step_hours: '24', label_prefix: 'День', golden_every: '0', size: 'normal', kind: 'BALL', amount: '500', count: 1}; gf = null; draw(); sec.querySelector('#s-save')?.scrollIntoView({behavior: 'smooth', block: 'center'}); });
        sec.querySelector('#s-cancel')?.addEventListener('click', () => { sf = null; draw(); });
        sec.querySelectorAll('[data-s-size]').forEach(b => b.addEventListener('click', () => { pull(); sf.size = b.dataset.sSize; draw(); }));
        sec.querySelectorAll('[data-skind]').forEach(b => b.addEventListener('click', () => { pull(); setKind(sf, b.dataset.skind); draw(); }));
        sec.querySelector('#s-save')?.addEventListener('click', () => { pull(); run(async () => { await api('admin/new-year/freebies/series', {...sf, event_id: sel}); sf = null; }, 'Серия создана'); });
    };
    draw();
}

window.crafterFreebiesAdmin = {admin};
})();
