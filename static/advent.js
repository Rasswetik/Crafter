/* Advent calendar: hub card, the calendar page (one free cell a day for channel subscribers) and the administrator tab. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ICON = {GRAM: '/static/assets/gram.svg', BALL: '/static/assets/new-year-ornament.svg', PACK: '/static/assets/packs/new-year-pack.webp', STAR: '/static/assets/stargifts/bear.svg', PROMO: '/static/assets/community-reward.svg'};
const KIND_NAME = {GRAM: 'GRAM на баланс', BALL: 'Новогодние шары', PACK: 'Карточный пак', STAR: 'Подарок Telegram', PROMO: 'Промокод'};
let STARS = [];
const SHAPE_NAME = {sq: 'Квадрат', wide: 'Широкая', tall: 'Высокая', big: 'Большая'};
const rimg = r => r.image_url || r.image || ICON[r.kind] || ICON.BALL;
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11) ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many;
/* More than a day away: "1 день 3 ч 25 мин"; under a day: "03:25:10". */
function leftText(s) {
    const p = n => String(n).padStart(2, '0'), days = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (days >= 1) return days + ' ' + plural(days, 'день', 'дня', 'дней') + ' ' + h + ' ч ' + p(m) + ' мин';
    return p(Math.floor(s / 3600)) + ':' + p(m) + ':' + p(s % 60);
}
const LOCK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.6" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const LOCKBIG = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="lk-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#e0911c"/></linearGradient></defs><path d="M7.6 10.4V7.8a4.4 4.4 0 0 1 8.8 0v2.6" fill="none" stroke="#eaf1ff" stroke-width="2.3" stroke-linecap="round"/><rect x="4.6" y="10" width="14.8" height="11" rx="3.2" fill="url(#lk-g)"/><circle cx="12" cy="14.8" r="1.7" fill="#6b3d08"/><rect x="11.2" y="15.4" width="1.6" height="3.2" rx=".8" fill="#6b3d08"/></svg>';
const BOW = '<svg class="adv-bow" viewBox="0 0 48 30" aria-hidden="true"><path d="M24 24C14 24 4 20 4 11S12 2 18 8l6 7 6-7c6-6 14-2 14 3s-10 13-20 13Z" fill="#ffe9a8" stroke="#d99a1f" stroke-width="1.6" stroke-linejoin="round"/><circle cx="24" cy="15" r="4.2" fill="#ffc14d" stroke="#d99a1f" stroke-width="1.4"/></svg>';
const SNOW = '<svg viewBox="-50 -50 100 100" aria-hidden="true"><g stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none">' + [0, 60, 120, 180, 240, 300].map(a => '<g transform="rotate(' + a + ')"><path d="M0 0V-42"/><path d="M0-18-10-28M0-18 10-28"/></g>').join('') + '</g></svg>';

/* ---------- hub card ---------- */
/* Four neighbouring cells: opened ones turn over one by one and show the real reward, ready ones blink,
   later ones stay dim. When more cells are opened the window moves on (1-4, then 3-6, then 5-8 ...). */
function card(state) {
    const days = state.days, opened = days.filter(d => d.state === 'opened').length;
    const start = Math.max(1, Math.min(opened - 1, Math.max(1, days.length - 3)));
    const view = days.slice(start - 1, start + 3);
    const minis = view.map((d, i) => {
        const cls = 'adv-mini c' + (d.day % 5) + ' is-' + (d.state === 'opened' ? 'opened' : d.state === 'ready' ? 'ready' : 'locked');
        return '<span class="' + cls + '" style="--i:' + i + '"><span class="adv-mini-in"><span class="adv-mini-front"><span class="adv-rib v"></span><span class="adv-rib h"></span>' + BOW + '<b>' + d.day + '</b></span>' +
            '<span class="adv-mini-back">' + (d.reward ? '<img src="' + e(rimg(d.reward)) + '" alt="">' : '') + '<i>' + d.day + '</i></span></span></span>';
    }).join('');
    const art = '<svg class="nyh-art" viewBox="0 0 400 170" preserveAspectRatio="xMaxYMid slice" aria-hidden="true"><defs><linearGradient id="ad-sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a0f3e"/><stop offset="1" stop-color="#6b1d4a"/></linearGradient><radialGradient id="ad-glow"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".6"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient></defs>' +
        '<rect width="400" height="170" fill="url(#ad-sky)"/><circle cx="300" cy="80" r="100" fill="url(#ad-glow)"/>' +
        Array.from({length: 26}, (_, i) => '<circle class="nyh-star" style="--i:' + i + '" cx="' + ((i * 53 + 17) % 400) + '" cy="' + ((i * 31 + 9) % 150) + '" r="' + (i % 4 ? .9 : 1.6) + '" fill="#fff"/>').join('') +
        '<path d="M0 152c80-10 160-4 240-2s110 2 160-6v24H0Z" fill="#f1e6ff" opacity=".9"/></svg>';
    return '<button type="button" class="nyh-card nyh-advent" data-nyh="advent" aria-label="Адвент-календарь">' + art +
        '<span class="nyh-copy"><strong>Адвент-календарь</strong><span class="nyh-mini"><span class="nyh-mini-bar"><i style="width:' + (opened / Math.max(1, days.length) * 100).toFixed(1) + '%"></i></span><em>Открыто ' + opened + ' из ' + days.length + '</em></span></span>' +
        '<span class="adv-minis" aria-hidden="true">' + minis + '</span></button>';
}

/* ---------- calendar page ---------- */
let ticker = 0;
function fmtDate(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'}) + ' · ' + d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
}
function cell(d, nowTs) {
    const cls = 'c' + (d.day % 5) + ' sh-' + (d.shape || 'sq');
    if (d.state === 'opened') {
        return '<button type="button" class="adv-cell is-opened ' + cls + '" data-day="' + d.day + '" aria-label="День ' + d.day + ', открыто"><img class="adv-prize" src="' + e(rimg(d.reward)) + '" alt="">' +
            '<span class="adv-ptitle">' + e(d.reward.title) + '</span><i class="adv-day">' + d.day + '</i><i class="adv-check">✓</i></button>';
    }
    const ready = d.state === 'ready';
    return '<button type="button" class="adv-cell ' + cls + (ready ? ' is-ready' : ' is-locked') + '" data-day="' + d.day + '" ' + (ready ? '' : 'aria-disabled="true"') + ' aria-label="День ' + d.day + '">' +
        '<span class="adv-rib v"></span><span class="adv-rib h"></span><span class="adv-lid"></span>' + BOW + '<span class="adv-snow">' + SNOW + '</span><b class="adv-num">' + d.day + '</b>' +
        (ready ? '<small class="adv-state">Открыть</small>' : '<small class="adv-state">' + fmtDate(d.unlock_at) + '</small>') + '</button>';
}
function page(main, state, nav) {
    clearInterval(ticker);
    const offset = state.now - Math.floor(Date.now() / 1000);
    const tag = 'UTC' + (state.tz >= 0 ? '+' : '') + state.tz;
    const needSub = state.require_sub && state.subscribed === false;
    main.innerHTML = '<div class="new-year-page adv-page"><button type="button" class="nyh-back" data-adv-back>‹ События</button>' +
        '<section class="adv-head"><div class="adv-head-snow" aria-hidden="true"></div><small>Подарок каждый день</small><h1>Адвент-календарь</h1>' +
        '<p>Новая ячейка открывается в ' + String(state.hour).padStart(2, '0') + ':00 (' + tag + '). Награды бесплатные.</p><div class="adv-next" id="adv-next"></div></section>' +
        (needSub ? '<section class="adv-sub"><div><b>Подпишитесь на канал</b><p>Ячейки открываются только подписчикам «' + e(state.channel.title) + '».</p></div>' +
            '<div class="adv-sub-actions"><button type="button" class="ny-action" data-adv-join>Подписаться</button><button type="button" class="secondary" data-adv-check>Я подписался</button></div></section>' : '') +
        '<div class="adv-grid">' + state.days.map(d => cell(d, state.now)).join('') + '</div></div>';
    const tick = () => {
        const now = Math.floor(Date.now() / 1000) + offset, next = state.days.find(d => d.state === 'locked' && d.unlock_at > now);
        const out = main.querySelector('#adv-next');
        if (!out) return clearInterval(ticker);
        const ready = state.days.filter(d => d.state === 'ready').length;
        if (ready) out.innerHTML = 'Можно открыть: <b>' + ready + '</b>';
        else if (next) { const s = Math.max(0, next.unlock_at - now); out.innerHTML = 'Следующая ячейка через <b>' + leftText(s) + '</b>'; if (s === 0) { clearInterval(ticker); nav.reload(); } }
        else out.textContent = 'Все ячейки открыты';
    };
    tick(); ticker = setInterval(tick, 1000);
    main.querySelector('[data-adv-back]').addEventListener('click', () => { clearInterval(ticker); nav.back(); });
    main.querySelector('[data-adv-join]')?.addEventListener('click', () => {
        const link = state.channel.link;
        if (!link) return toast('Ссылка на канал не задана');
        if (window.Telegram?.WebApp?.openTelegramLink && /t\.me/.test(link)) window.Telegram.WebApp.openTelegramLink(link); else window.open(link, '_blank', 'noopener');
    });
    main.querySelector('[data-adv-check]')?.addEventListener('click', () => nav.reload());
    main.querySelectorAll('.adv-cell').forEach(b => b.addEventListener('click', () => openCell(Number(b.dataset.day), state, b, nav)));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function cellNode(d, nowTs) {
    const t = document.createElement('template');
    t.innerHTML = cell(d, nowTs).trim();
    return t.content.firstElementChild;
}
async function openCell(day, state, button, nav) {
    const d = state.days.find(x => x.day === day);
    if (d.state === 'opened') return reward(d.reward, day);
    if (d.state === 'locked') {                                            // not yet: the gift just shakes, like a locked box
        button.classList.remove('is-shake'); void button.offsetWidth; button.classList.add('is-shake');
        setTimeout(() => button.classList.remove('is-shake'), 600);
        return toast('Откроется ' + fmtDate(d.unlock_at));
    }
    if (state.require_sub && state.subscribed === false) return toast('Сначала подпишитесь на канал');
    if (button.classList.contains('is-unwrapping')) return;
    button.classList.add('is-unwrapping');                                 // the number flies away, the bow unties, the ribbons slide off, the lid lifts
    try {
        const [r] = await Promise.all([api('advent/open', {day}), wait(1500)]);
        d.state = 'opened'; d.reward = r.reward;
        if (r.reward.balls !== undefined && typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance({balls: r.reward.balls});
        if (r.reward.gram_balance !== undefined && window.state?.me) state_me_balance(r.reward.gram_balance);
        const gem = document.createElement('button');                        // the prize lies inside and glows until it is taken
        gem.type = 'button'; gem.className = 'adv-gem'; gem.setAttribute('aria-label', 'Забрать награду');
        gem.innerHTML = '<img src="' + e(rimg(r.reward)) + '" alt="">';
        button.appendChild(gem);
        button.classList.add('is-prize');
        gem.addEventListener('click', ev => {
            ev.stopPropagation();
            if (gem.dataset.taken) return; gem.dataset.taken = '1';
            const from = gem.getBoundingClientRect(), img = gem.querySelector('img').cloneNode();
            img.className = 'adv-fly';
            Object.assign(img.style, {left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px'});
            document.body.appendChild(img);
            gem.style.visibility = 'hidden';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const dx = innerWidth / 2 - (from.left + from.width / 2), dy = innerHeight / 2 - (from.top + from.height / 2);
                img.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(2.4)';
                img.classList.add('is-going');
            }));
            setTimeout(() => {
                img.remove();
                const fresh = cellNode(d, state.now);
                fresh.classList.add('is-flip-in');
                fresh.addEventListener('click', () => reward(d.reward, day, () => nav.reload()));
                button.replaceWith(fresh);
                reward(r.reward, day, () => nav.reload());
            }, 800);
        });
    } catch (err) { button.classList.remove('is-unwrapping'); toast(err.message); if (/подпиш/i.test(err.message)) nav.reload(); }
}
function state_me_balance(v) { try { window.state.me.balance = v; if (typeof updateBalance === 'function') updateBalance(); } catch (_) {} }
function reward(r, day, after) {
    const extras = r.extras || [];
    const more = extras.length ? '<ul class="adv-more">' + extras.map(x => '<li><img src="' + e(rimg(x)) + '" alt=""><span>' + e(x.title) + (x.code ? ' · <code>' + e(x.code) + '</code>' : '') + '</span></li>').join('') + '</ul>' : '';
    const packIds = [].concat(r.pack_ids || [], ...extras.map(x => x.pack_ids || []));
    const head = '<div class="adv-reward"><div class="adv-reward-pic"><img src="' + e(rimg(r)) + '" alt=""></div><small>День ' + day + '</small><h3>' + e(r.title) + '</h3>' + (more ? '<p class="cm-sheet-note" style="text-align:center">И ещё в этой ячейке:</p>' + more : '');
    if (r.code) {
        sheet('Награда дня', head + window.crafterCommunity.codeBlock(r.code) + '</div>');
        window.crafterCommunity.bindCode(document.querySelector('#sheet-body'), r.code);
        return after && after();
    }
    if (packIds.length) {
        sheet('Награда дня', head + '<p class="cm-sheet-note" style="text-align:center">Добавлено в инвентарь: ' + packIds.length + ' ' + (packIds.length === 1 ? 'пак' : 'пака(ов)') + '.</p>' +
            '<button type="button" class="ny-action" id="adv-open-packs">' + (packIds.length > 1 ? 'Открыть все' : 'Открыть сейчас') + '</button><button type="button" class="secondary" id="adv-later" style="width:100%;margin-top:8px">Позже</button></div>');
        const body = document.querySelector('#sheet-body');
        body.querySelector('#adv-later').addEventListener('click', () => { closeSheet(); after && after(); });
        body.querySelector('#adv-open-packs').addEventListener('click', async () => { closeSheet(); await window.crafterPacks.openMany(packIds, after); });
        return;
    }
    sheet('Награда дня', head + '<p class="cm-sheet-note" style="text-align:center">' + (r.gram_balance !== undefined ? 'Зачислено на ваш баланс.' : 'Зачислено на баланс шаров.') + '</p><button type="button" class="ny-action" id="adv-ok">Отлично</button></div>');
    document.querySelector('#adv-ok').addEventListener('click', () => { closeSheet(); after && after(); });
}

/* ---------- administrator ---------- */
async function admin(content) {
    let r, packs = [];
    try { r = await api('admin/new-year/advent'); } catch (_) { return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) { STARS = []; }
    if (!content?.isConnected) return;
    const c = r.settings, ch = r.channel;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section adv-admin';
    sec.dataset.pane = 'advent';
    const sw = (name, label, on, hint) => '<label class="ny-admin-switch full"><span><b>' + label + '</b>' + (hint ? '<small class="sub" style="display:block;margin-top:4px">' + hint + '</small>' : '') + '</span><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '></label>';
    sec.innerHTML = '<h3>Адвент-календарь</h3><p class="sub">Одна бесплатная ячейка в день. Открывать могут только подписчики вашего канала.</p>' +
        '<form id="adv-settings"><div class="ny-admin-fields">' + sw('enabled', 'Календарь включён', c.enabled, 'Игроки видят его в разделе «Событие»') +
        '<div class="adm-field"><label>Первый день</label><input type="date" name="start" value="' + e(c.start) + '" required></div>' +
        '<div class="adm-field"><label>Дней в календаре</label><input type="number" name="days" min="1" max="31" value="' + e(c.days) + '"></div>' +
        '<div class="adm-field"><label>Час открытия (0–23)</label><input type="number" name="hour" min="0" max="23" value="' + e(c.hour) + '"></div>' +
        '<div class="adm-field"><label>Часовой пояс (UTC+3 — Москва)</label><input type="number" name="tz" min="-12" max="14" value="' + e(c.tz) + '"></div>' +
        sw('require_sub', 'Только для подписчиков канала', c.require_sub, 'Работает, когда канал привязан') + '</div>' +
        '<button class="primary" type="submit">Сохранить настройки</button></form>' +
        '<h3 style="margin-top:24px">Телеграм-канал</h3>' +
        (ch ? '<div class="adv-channel is-ok"><b>' + e(ch.title) + '</b><span>' + (ch.username ? '@' + e(ch.username) + ' · ' : '') + 'бот — администратор ✔</span></div>' : '<div class="adv-channel"><span>Канал не привязан — календарь открыт для всех.</span></div>') +
        '<form id="adv-channel" class="adv-channel-form"><div class="adm-field"><label>Канал</label><input name="channel" placeholder="@my_channel или https://t.me/my_channel"></div>' +
        '<div class="adv-channel-actions"><button class="primary" type="submit">Проверить и привязать</button>' + (ch ? '<button type="button" class="secondary" id="adv-unbind">Отвязать</button>' : '') + '</div>' +
        '<p class="sub">Сначала добавьте бота администратором канала, затем нажмите «Проверить и привязать».</p></form>' +
        '<h3 style="margin-top:24px">Сброс</h3><p class="sub">Начать календарь заново: все ячейки снова закрыты для игроков. Уже выданные награды не отзываются.</p>' +
        '<div class="adv-channel-actions"><button type="button" class="secondary" id="adv-reset">Сбросить прогресс игроков</button><button type="button" class="secondary" id="adv-reset-all">Сбросить прогресс и награды</button></div>' +
        '<h3 style="margin-top:24px">Награды по дням</h3><div class="adv-days">' + r.days.map(d => '<div class="adv-dayline"><button type="button" class="adv-dayrow" data-day="' + d.day + '"><b>' + d.day + '</b><img src="' + e(rimg({kind: d.kind === 'PROMO' ? 'PROMO' : d.kind, image_url: d.image_url})) + '" alt=""><span>' + e(d.title || d.auto_title) + (d.extra && d.extra.length ? ' <em>+' + d.extra.length + '</em>' : '') + '</span><small>' + (SHAPE_NAME[d.shape] || '') + '</small></button><span class="adv-move"><button type="button" data-adv-up="' + d.day + '" aria-label="Выше">↑</button><button type="button" data-adv-down="' + d.day + '" aria-label="Ниже">↓</button></span></div>').join('') + '</div>';
    content.appendChild(sec);
    const run = async (fn, ok) => { try { await fn(); toast(ok); content.innerHTML = ''; window.renderAdminNewYear?.(content); } catch (err) { toast(err.message); } };
    sec.querySelector('#adv-settings').addEventListener('submit', ev => {
        ev.preventDefault(); const f = new FormData(ev.target);
        run(() => api('admin/new-year/advent/settings', {enabled: f.get('enabled') === 'on', start: f.get('start'), days: f.get('days'), hour: f.get('hour'), tz: f.get('tz'), require_sub: f.get('require_sub') === 'on'}), 'Настройки сохранены');
    });
    sec.querySelector('#adv-channel').addEventListener('submit', ev => { ev.preventDefault(); run(() => api('admin/new-year/advent/channel', {channel: new FormData(ev.target).get('channel')}), 'Канал привязан'); });
    const reset = (rewards, text) => { if (confirm(text)) run(() => api('admin/new-year/advent/reset', {confirm: 'RESET_ADVENT', rewards}), 'Календарь сброшен'); };
    sec.querySelector('#adv-reset').addEventListener('click', () => reset(false, 'Сбросить прогресс всех игроков? Ячейки снова станут закрытыми.'));
    sec.querySelector('#adv-reset-all').addEventListener('click', () => reset(true, 'Сбросить прогресс игроков и вернуть стандартные награды во все ячейки?'));
    sec.querySelector('#adv-unbind')?.addEventListener('click', () => run(() => api('admin/new-year/advent/channel/clear', {}), 'Канал отвязан'));
    sec.querySelectorAll('[data-adv-up],[data-adv-down]').forEach(b => b.addEventListener('click', () => run(() => api('admin/new-year/advent/days/' + (b.dataset.advUp || b.dataset.advDown) + '/move', {direction: b.dataset.advUp ? 'up' : 'down'}), 'Порядок изменён')));
    sec.querySelectorAll('.adv-dayrow').forEach(b => b.addEventListener('click', () => editDay(r.days.find(d => d.day === Number(b.dataset.day)), packs, () => run(async () => {}, 'Сохранено'))));
}
function editDay(d, packs, done) {
    const f = {kind: d.kind, promo: d.promo_kind || 'GRAM', amount: d.amount, count: d.count || 1, title: d.title, image: d.image_url, shape: d.shape || 'sq', extra: (d.extra || []).map(x => ({kind: x.kind, amount: x.amount, count: x.count || 1}))};
    const box = document.createElement('div');
    box.className = 'adm-pick adv-edit';
    document.body.appendChild(box);
    const tile = (on, attr, img, title) => '<button type="button" class="adm-tile' + (on ? ' is-on' : '') + '" ' + attr + '><img src="' + e(img) + '" alt=""><b>' + title + '</b></button>';
    const eff = () => f.kind === 'PROMO' ? f.promo : f.kind;
    const draw = () => {
        const what = eff() === 'PACK'
            ? '<div class="adm-step"><h4>Какой пак</h4>' + window.crafterPacks.packTiles(packs, f.amount) + '</div><div class="adm-step"><div class="adm-field"><label>Сколько паков</label><input data-f="count" type="number" min="1" max="20" value="' + e(f.count) + '"></div></div>'
            : eff() === 'STAR'
            ? '<div class="adm-step"><h4>Какой подарок</h4><div class="adm-field"><select data-f="amount">' + window.crafterStarGifts.options(STARS, f.amount) + '</select></div></div><div class="adm-step"><div class="adm-field"><label>Сколько подарков</label><input data-f="count" type="number" min="1" max="20" value="' + e(f.count) + '"></div></div>'
            : '<div class="adm-step"><h4>' + (eff() === 'BALL' ? 'Сколько шаров' : 'Сколько GRAM') + '</h4><div class="adm-field"><input data-f="amount" inputmode="decimal" value="' + e(f.amount) + '"></div></div>';
        box.innerHTML = '<div class="adm-pick-win"><div class="adm-pick-head"><b>День ' + d.day + '</b><button type="button" class="adm-pick-x" aria-label="Закрыть">×</button></div><div class="adm-pick-grid adv-edit-body" style="display:block">' +
            '<div class="adm-step"><h4>Награда</h4><div class="adm-tiles">' + ['GRAM', 'BALL', 'PACK', 'STAR', 'PROMO'].filter(k => (k !== 'PACK' || packs.length) && (k !== 'STAR' || STARS.length)).map(k => tile(f.kind === k, 'data-kind="' + k + '"', ICON[k], KIND_NAME[k])).join('') + '</div></div>' +
            (f.kind === 'PROMO' ? '<div class="adm-step"><h4>Что даёт промокод</h4><div class="adm-tiles small">' + ['GRAM', 'BALL', 'PACK', 'STAR'].filter(k => (k !== 'PACK' || packs.length) && (k !== 'STAR' || STARS.length)).map(k => tile(f.promo === k, 'data-promo="' + k + '"', ICON[k], k === 'GRAM' ? 'GRAM' : k === 'BALL' ? 'Шары' : k === 'STAR' ? 'Подарок' : 'Пак')).join('') + '</div></div>' : '') + what +
            '<div class="adm-step"><h4>Форма ячейки в календаре</h4><div class="adv-shapes">' + Object.keys(SHAPE_NAME).map(k => '<button type="button" class="adv-shape sh-' + k + (f.shape === k ? ' is-on' : '') + '" data-shape="' + k + '"><i></i>' + SHAPE_NAME[k] + '</button>').join('') + '</div></div>' +
            '<div class="adm-step"><h4>Ещё награды в этой же ячейке</h4>' + f.extra.map((x, i) => '<div class="adv-extra"><select data-x="' + i + ':kind">' + ['GRAM', 'BALL', 'PACK', 'STAR'].filter(k => (k !== 'PACK' || packs.length) && (k !== 'STAR' || STARS.length)).map(k => '<option value="' + k + '"' + (x.kind === k ? ' selected' : '') + '>' + KIND_NAME[k] + '</option>').join('') + '</select>' +
                (x.kind === 'PACK' ? '<select data-x="' + i + ':amount">' + packs.map(p => '<option value="' + e(p.id) + '"' + (x.amount === p.id ? ' selected' : '') + '>' + e(p.title) + '</option>').join('') + '</select><input data-x="' + i + ':count" type="number" min="1" max="20" value="' + e(x.count) + '">' : x.kind === 'STAR' ? '<select data-x="' + i + ':amount">' + window.crafterStarGifts.options(STARS, x.amount) + '</select><input data-x="' + i + ':count" type="number" min="1" max="20" value="' + e(x.count) + '">' : '<input data-x="' + i + ':amount" inputmode="decimal" value="' + e(x.amount) + '" placeholder="' + (x.kind === 'BALL' ? 'шаров' : 'GRAM') + '">') +
                '<button type="button" data-x-del="' + i + '" aria-label="Убрать">×</button></div>').join('') + '<button type="button" class="secondary" id="adv-x-add">+ Добавить награду</button></div>' +
            '<details class="adm-more"' + (f.title || f.image ? ' open' : '') + '><summary>Название и картинка</summary><div class="adm-field"><label>Название</label><input data-f="title" value="' + e(f.title) + '" placeholder="' + e(d.auto_title) + '"></div><div class="adm-field" style="margin-top:8px"><label>Картинка (ссылка)</label><input data-f="image" value="' + e(f.image) + '"></div></details>' +
            '<button type="button" class="primary" id="adv-save" style="margin-top:16px;width:100%">Сохранить день</button></div></div>';
        const pull = () => { box.querySelectorAll('[data-f]').forEach(i => { f[i.dataset.f] = i.value; }); box.querySelectorAll('[data-x]').forEach(i => { const [n, key] = i.dataset.x.split(':'); if (f.extra[n]) f.extra[n][key] = i.value; }); };
        box.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => { pull(); f.shape = b.dataset.shape; draw(); }));
        box.querySelector('#adv-x-add')?.addEventListener('click', () => { pull(); if (f.extra.length < 6) f.extra.push({kind: 'BALL', amount: '50', count: 1}); draw(); });
        box.querySelectorAll('[data-x-del]').forEach(b => b.addEventListener('click', () => { pull(); f.extra.splice(Number(b.dataset.xDel), 1); draw(); }));
        box.querySelectorAll('select[data-x$=":kind"]').forEach(sel => sel.addEventListener('change', () => { pull(); const x = f.extra[Number(sel.dataset.x.split(':')[0])]; x.amount = x.kind === 'PACK' ? (packs[0]?.id || '') : x.kind === 'STAR' ? (STARS[0]?.key || 'bear') : x.kind === 'BALL' ? '50' : '0.1'; x.count = 1; draw(); }));
        box.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { pull(); f.kind = b.dataset.kind; f.amount = eff() === 'PACK' ? (packs[0]?.id || '') : eff() === 'STAR' ? (STARS[0]?.key || 'bear') : eff() === 'BALL' ? '100' : '1'; draw(); }));
        box.querySelectorAll('[data-promo]').forEach(b => b.addEventListener('click', () => { pull(); f.promo = b.dataset.promo; f.amount = eff() === 'PACK' ? (packs[0]?.id || '') : eff() === 'STAR' ? (STARS[0]?.key || 'bear') : eff() === 'BALL' ? '100' : '1'; draw(); }));
        box.querySelectorAll('[data-adm-pack]').forEach(b => b.addEventListener('click', () => { pull(); f.amount = b.dataset.admPack; draw(); }));
        box.querySelector('#adv-save').addEventListener('click', async () => {
            pull();
            try { await api('admin/new-year/advent/days/' + d.day, {kind: f.kind, promo_kind: f.promo, amount: f.amount, count: f.count, title: f.title, image_url: f.image, shape: f.shape, extra: f.extra.map(x => ({kind: x.kind, promo_kind: '', amount: x.amount, count: x.count}))}); box.remove(); done(); }
            catch (err) { toast(err.message); }
        });
    };
    box.addEventListener('click', ev => { if (ev.target === box || ev.target.closest('.adm-pick-x')) box.remove(); });
    draw();
}

window.crafterAdvent = {card, page, admin};
})();
