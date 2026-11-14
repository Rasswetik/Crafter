/* Admin → Управление сезоном → Управление валютой: choose the currency of the site (balls, points, coins or an own one with a name and a picture),
   see what the recalculation does and press «Сделать перерасчёт». The players are told about it by themselves. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU') : String(v); };
const pic = u => '<img src="' + e(String(u || '') + (String(u || '').indexOf('?') < 0 ? '?i' : '')) + '" alt="">';        // a query keeps the picture from being swapped to the chosen currency
const KIND_NAME = {balls: 'Новогодние шары', points: 'Поинты', coins: 'Коины', custom: 'Своя валюта'};
const KIND_HINT = {balls: 'Праздничные шары', points: 'Обычные монеты', coins: 'Серебряные коины', custom: 'Своё название и картинка'};

async function admin(content) {
    let data;
    try { data = await api('admin/currency'); } catch (err) { return; }
    if (!content.isConnected) return;
    const cur = data.current;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section nys-currency';
    sec.dataset.pane = 'currency';
    const pick = {kind: cur.kind, name: cur.kind === 'custom' ? cur.name : '', gen: cur.kind === 'custom' ? cur.gen : '', icon: cur.kind === 'custom' ? cur.icon : '', rate: '1'};
    let preview = null, timer = 0;

    const draw = () => {
        const options = data.presets.map(p => ({kind: p.kind, name: p.name, icon: p.icon})).concat([{kind: 'custom', name: pick.name || 'Своя валюта', icon: pick.icon || '/static/assets/points.svg'}]);
        sec.innerHTML =
            '<h3>Текущая валюта</h3>' +
            '<div class="nys-now">' + pic(cur.icon) + '<div><b>' + e(cur.name) + '</b><small>Сейчас игроки видят «' + e(cur.name) + '» везде: в балансе, маркете, акциях, сезоне и наградах.</small></div>' +
            '<span>' + num(data.stats.before) + '<small>у ' + num(data.stats.holders) + ' игроков</small></span></div>' +
            '<h3>На что поменять</h3>' +
            '<div class="nys-opts">' + options.map(o => '<button type="button" class="nys-opt' + (pick.kind === o.kind ? ' is-on' : '') + '" data-kind="' + o.kind + '">' + pic(o.icon) + '<b>' + e(KIND_NAME[o.kind] && o.kind !== 'custom' ? KIND_NAME[o.kind] : o.name) + '</b><small>' + e(KIND_HINT[o.kind]) + '</small></button>').join('') + '</div>' +
            (pick.kind === 'custom' ? '<div class="nys-custom"><label>Название<input data-f="name" maxlength="24" value="' + e(pick.name) + '" placeholder="Например: Звёзды"></label>' +
                '<label>После числа (родительный падеж)<input data-f="gen" maxlength="24" value="' + e(pick.gen) + '" placeholder="звёзд"></label>' +
                '<div class="nys-up">' + (pick.icon ? pic(pick.icon) : '<span class="nys-noimg">нет картинки</span>') + '<label class="nys-file">Загрузить картинку<input type="file" data-f="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"></label></div></div>' : '') +
            '<h3>Курс перерасчёта</h3>' +
            '<div class="nys-rate"><span>1 «' + e(cur.name) + '» =</span><input data-f="rate" inputmode="decimal" value="' + e(pick.rate) + '"><span>новой валюты</span></div>' +
            '<p class="sub">1 — баланс остаётся тем же числом. Например, 2 — баланс каждого игрока удвоится, 0,5 — уменьшится вдвое (округление до целого).</p>' +
            '<div class="nys-sum" id="nys-sum">' + (preview ? sumHTML(preview) : '<span class="sub">Выберите валюту — здесь появится, что произойдёт.</span>') + '</div>' +
            '<button type="button" class="primary nys-go" id="nys-go"' + (preview && preview.changes ? '' : ' disabled') + '>Сделать перерасчёт</button>' +
            lastHTML();
        bind();
    };
    const sumHTML = p => !p.changes ? '<span class="sub">Валюта и курс те же — перерасчёт не нужен.</span>' :
        '<div class="nys-flow">' + pic(p.from.icon) + '<i>→</i>' + pic(p.to.icon) + '</div>' +
        '<p><b>' + e(p.from.name) + ' → ' + e(p.to.name) + '</b>, курс 1 : ' + e(String(p.rate).replace('.', ',')) + '</p>' +
        '<p>Игроков с балансом: <b>' + num(p.holders) + '</b>. Сумма было <b>' + num(p.before) + '</b> → станет <b>' + num(p.after) + '</b>.</p>' +
        '<p class="sub">Все игроки получат уведомление о перерасчёте: при заходе или в течение 30 секунд на открытой странице.</p>';
    const lastHTML = () => data.last ? '<h3>Последний перерасчёт</h3><p class="sub">' + e(data.last.from.name) + ' → ' + e(data.last.to.name) + ', курс 1 : ' + e(String(data.last.rate).replace('.', ',')) + ', ' + new Date(data.last.at * 1000).toLocaleString('ru-RU') + '</p>' : '';

    const payload = () => ({kind: pick.kind, name: pick.name, gen: pick.gen, icon: pick.icon, rate: pick.rate});
    const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const box = sec.querySelector('#nys-sum'), go = sec.querySelector('#nys-go');
            try { preview = await api('admin/currency/preview', payload()); } catch (err) { preview = null; if (box) box.innerHTML = '<span class="nys-err">' + e(err.message) + '</span>'; if (go) go.disabled = true; return; }
            if (box) box.innerHTML = sumHTML(preview);
            if (go) go.disabled = !preview.changes;
        }, 250);
    };
    const bind = () => {
        sec.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { pick.kind = b.dataset.kind; preview = null; draw(); refresh(); }));
        sec.querySelectorAll('[data-f="name"],[data-f="gen"],[data-f="rate"]').forEach(i => i.addEventListener('input', () => { pick[i.dataset.f] = i.value; refresh(); }));
        sec.querySelector('[data-f="file"]')?.addEventListener('change', async ev => {
            const file = ev.target.files[0]; if (!file) return;
            if (file.size > 15000000) { toast('Файл должен быть не больше 15 МБ'); return; }
            try { const body = new FormData(); body.append('file', file); pick.icon = (await api('admin/new-year/shop-media', body)).url; draw(); refresh(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('#nys-go')?.addEventListener('click', async ev => {
            const go = ev.currentTarget; go.disabled = true;
            try {
                const r = await api('admin/currency/apply', payload());
                toast('Перерасчёт сделан. Игроки получат уведомление.');
                window.crafterCurrency = r.current;
                await window.renderAdminNewYear(document.querySelector('#admin-content') || content);
            } catch (err) { toast(err.message); go.disabled = false; }
        });
    };
    draw();
    const points = [...content.children].find(x => x.dataset.pane === 'currency');
    if (points) content.insertBefore(sec, points); else content.appendChild(sec);
}
window.crafterCurrencyAdmin = {admin};
})();
