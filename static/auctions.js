/* Gift auctions: a grid of lots with a countdown, a bid sheet, filters and "put a gift up" form. */
(function () {
'use strict';
const ui = {
    view: 'all', sort: 'ending', items: [], lookup: new Map(), collections: [], offset: 0, timer: 0, poll: 0, detailTimer: 0, busy: false,
    filters: {search: '', collections: new Set(), min: '', max: '', number: ''},
};
const VIEWS = [['all', 'Все'], ['favorites', 'Избранное'], ['bids', 'Мои ставки'], ['mine', 'Мои лоты']];
const SORTS = [['ending', 'Скоро завершится'], ['new', 'Недавно добавлены'], ['price', 'Цена: по возрастанию'],
               ['price_desc', 'Цена: по убыванию'], ['bids', 'Больше ставок']];
const PRESETS = [[30, '30 мин'], [60, '1 час'], [360, '6 часов'], [1440, '24 часа'], [4320, '3 дня'], [10080, '7 дней'], [43200, '30 дней']];
const nowSec = () => Math.floor(Date.now() / 1000) + ui.offset;
const gram = value => `${typeof gramIcon === 'function' ? gramIcon() : ''}<b>${money(value)}</b>`;
const two = n => String(n).padStart(2, '0');
const heart = on => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.8 8 3.4 4.8 6.6 4.5c2-.2 3.8.9 5.4 3 1.6-2.1 3.4-3.2 5.4-3 3.2.3 4.8 3.5 3.8 6.6-1.7 4.8-9.2 9.4-9.2 9.4Z" fill="${on ? '#ff5d73' : 'none'}" stroke="${on ? '#ff5d73' : 'currentColor'}" stroke-width="2" stroke-linejoin="round"/></svg>`;

const feeText = () => String(Number(ui.feePercent || 4));
function remaining(auction) { return Math.max(0, auction.ends_at - nowSec()); }
function shortTime(left) {
    const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
    return d ? `${d}д ${two(h)}ч ${two(m)}м` : `${two(h)}ч ${two(m)}м ${two(s)}с`;
}
function artOf(gift, bare, aid) {
    /* backdrop colours stretched over the whole area + the symbol pattern + the model itself at its normal size */
    const pictureGift = {...gift, image: ''};      // the transparent model, not a poster with a baked background
    return `<span class="auc-art" data-aid="${esc(aid || '')}" style="background:${giftBackdrop(gift)}">` +
        `${typeof giftPattern === 'function' ? giftPattern(gift) : ''}` +
        `<img class="auc-art-main" ${giftPicture(pictureGift)} alt="" loading="lazy" draggable="false"></span>`;
}
function hydrateArts(scope) {
    if (typeof prepareGiftBackdrop !== 'function') return;
    scope.querySelectorAll('.auc-art[data-aid]').forEach(art => {
        const a = ui.lookup.get(art.dataset.aid);
        if (!a) return;
        const img = art.querySelector('.auc-art-main'), original = typeof imageURL === 'function' ? imageURL(a.gift.image) : '';
        if (img && original) {            // the poster of the gift is the last resort when the bare model does not exist
            const list = JSON.parse(img.dataset.giftFallback || '[]');
            if (!list.includes(original)) { list.push(original); img.dataset.giftFallback = JSON.stringify(list); }
        }
        prepareGiftBackdrop(art, a.gift).catch(() => {});
    });
}
function animateHero() {
    /* the gift plays its own animation in the centre when a lot is opened (the same player as in the gift card) */
    const art = document.querySelector('.auc-hero .auc-art'), a = ui.current;
    if (!art || !a || art.dataset.animated === a.id || typeof mountGiftAnimation !== 'function') return;
    art.dataset.animated = a.id;
    try { mountGiftAnimation(art, a.gift, null, true); } catch (_) {}
}
function collectionIcon(gift) {
    try {
        const c = typeof giftCollection === 'function' ? giftCollection(gift) : null;
        const url = c?.photo_url ? imageURL(c.photo_url) : '';
        return url ? `<img class="auc-coll" src="${esc(url)}" alt="" loading="lazy" draggable="false" onerror="this.remove()">` : '';
    } catch { return ''; }
}
function params() {
    const f = ui.filters, q = new URLSearchParams({view: ui.view, sort: ui.sort});
    if (f.search) q.set('search', f.search);
    if (f.collections.size) q.set('collection', [...f.collections].join(','));
    if (f.min) q.set('min_price', f.min.replace(',', '.'));
    if (f.max) q.set('max_price', f.max.replace(',', '.'));
    if (f.number) q.set('number', f.number.replace('#', ''));
    return q.toString();
}
function filterCount() {
    const f = ui.filters;
    return (f.search ? 1 : 0) + f.collections.size + (f.min ? 1 : 0) + (f.max ? 1 : 0) + (f.number ? 1 : 0);
}

function cardHTML(a, index = 0) {
    const price = a.current_bid ?? a.start_price;
    const label = a.own ? 'Ваш лот' : a.leading ? 'Лидируете' : 'Ставка';
    return `<article class="auc-card" data-auc="${esc(a.id)}" style="--i:${Math.min(index, 12)};background:${giftBackdrop(a.gift)}">
        <button type="button" class="auc-open" data-open="${esc(a.id)}" aria-label="${esc(a.gift.name)}">
            ${artOf(a.gift, true, a.id)}
            <span class="auc-timer${remaining(a) < 300 ? ' hot' : ''}" data-auc-end="${a.ends_at}">${shortTime(remaining(a))}</span>
            <span class="auc-name"><b>${esc(a.gift.name)}</b><i>${a.gift.number ? '#' + esc(a.gift.number) : ''}</i></span>
        </button>
        <button type="button" class="auc-heart" data-heart="${esc(a.id)}" aria-pressed="${a.favorite}" aria-label="В избранное">${heart(a.favorite)}</button>
        <button type="button" class="auc-bid${a.leading ? ' leading' : ''}" data-open="${esc(a.id)}">
            ${label} ${gram(price)}
        </button>
    </article>`;
}

function render() {
    const main = document.querySelector('#main');
    if (!main || state.page !== 'auctions') return;
    const count = filterCount();
    main.innerHTML = `<section class="auc-page">
        <div class="auc-head"><h1>Аукционы</h1><button type="button" class="auc-create" id="auc-create">+ Выставить</button></div>
        <div class="auc-tabs" role="tablist">${VIEWS.map(([key, label]) =>
            `<button type="button" role="tab" aria-selected="${ui.view === key}" data-view="${key}">${label}</button>`).join('')}</div>
        <div class="auc-toolbar">
            <button type="button" class="auc-filter" id="auc-filter"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>Фильтры${count ? ` <em>${count}</em>` : ''}</button>
            <div class="auc-sort"><button type="button" id="auc-sort-btn" aria-haspopup="listbox" aria-expanded="false"><span>${esc(SORTS.find(s => s[0] === ui.sort)?.[1] || '')}</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
                <ul class="auc-menu" id="auc-menu" role="listbox" hidden>${SORTS.map(([key, label]) =>
                `<li role="option" data-sort="${key}" aria-selected="${ui.sort === key}">${label}</li>`).join('')}</ul></div>
        </div>
        <div class="auc-grid" id="auc-grid">${gridHTML()}</div>
    </section>`;
}
function gridHTML() {
    if (ui.items === null) return '<div class="auc-empty">Загрузка…</div>';
    if (!ui.items.length) {
        const text = {all: 'Сейчас нет активных аукционов. Выставите свой подарок первым.', favorites: 'Нажмите на сердечко на карточке, и лот появится здесь.',
                      bids: 'Вы ещё не делали ставок в идущих аукционах.', mine: 'У вас нет активных аукционов.'}[ui.view];
        return `<div class="auc-empty">${filterCount() ? 'Ничего не найдено по этим фильтрам.' : text}</div>`;
    }
    return ui.items.map((a, index) => cardHTML(a, index)).join('');
}
function paintGrid() {
    const grid = document.querySelector('#auc-grid');
    if (grid) { grid.innerHTML = gridHTML(); hydrateArts(grid); }
}

async function load(silent) {
    if (ui.loading) return;
    ui.loading = true;
    if (!silent) { ui.items = null; paintGrid(); }
    try {
        const data = await api('auctions?' + params());
        ui.offset = data.now - Math.floor(Date.now() / 1000);
        ui.items = data.auctions;
        data.auctions.forEach(a => ui.lookup.set(a.id, a));
        ui.collections = data.collections || [];
        ui.feePercent = data.fee_percent;
        if (typeof state.me === 'object' && state.me && data.balance != null) { state.me.balance = data.balance; updateBalance(); }
    } catch (error) {
        if (!silent) { ui.items = []; toast(error.message); }
    } finally {
        ui.loading = false;
    }
    if (state.page === 'auctions') paintGrid();
}

function tick() {
    if (state.page !== 'auctions' && !document.querySelector('.auc-detail')) return;
    let ended = false;
    document.querySelectorAll('[data-auc-end]').forEach(el => {
        const left = Math.max(0, Number(el.dataset.aucEnd) - nowSec());
        if (el.classList.contains('auc-timer')) {
            el.textContent = left ? shortTime(left) : 'Завершён';
            el.classList.toggle('hot', left > 0 && left < 300);
        } else if (el.dataset.part) {
            const parts = {d: Math.floor(left / 86400), h: Math.floor(left % 86400 / 3600), m: Math.floor(left % 3600 / 60), s: left % 60};
            const text = two(parts[el.dataset.part]);
            if (el.textContent !== text) {
                el.textContent = text;
                if (el.dataset.part === 's' || left < 60) { el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); }
            }
            el.classList.toggle('hot', left > 0 && left < 300);
        }
        if (!left) ended = true;
    });
    if (ended && !ui.endedReload) {
        ui.endedReload = true;
        setTimeout(() => { ui.endedReload = false; if (state.page === 'auctions') load(true); if (ui.openId) openDetail(ui.openId, true); }, 2500);
    }
}
function start() {
    stop();
    ui.timer = setInterval(tick, 1000);
    ui.poll = setInterval(() => { if (state.page === 'auctions' && !document.hidden && !appSheet.open) load(true); }, 15000);
}
function stop() { clearInterval(ui.timer); clearInterval(ui.poll); clearInterval(ui.detailTimer); ui.timer = ui.poll = ui.detailTimer = 0; }

/* ---------- detail ---------- */
function timeBlocks(a) {
    const left = remaining(a);
    const parts = left >= 86400 ? [['d', 'д'], ['h', 'ч'], ['m', 'м']] : [['h', 'ч'], ['m', 'м'], ['s', 'с']];
    return `<div class="auc-ends"><span>Закончится через</span>${parts.map(([key, label]) =>
        `<b data-auc-end="${a.ends_at}" data-part="${key}">00</b><u>${label}</u>`).join('')}</div>`;
}
function traitRow(label, value, rarity) {
    if (!value) return '';
    const pct = Number(rarity);
    return `<div class="auc-trait"><span>${label}</span><b>${esc(value)}${pct > 0 ? ` <small>(${money(pct / 10)}%)</small>` : ''}</b></div>`;
}
function timeAgo(ts) {
    const diff = Math.max(0, nowSec() - ts);
    if (diff < 60) return 'только что';
    if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
    if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
    return new Date(ts * 1000).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'});
}
function detailHTML(a) {
    const g = a.gift, r = g.rarity || {};
    const ended = a.status !== 'active' || remaining(a) === 0;
    let action;
    if (ended) action = '<button type="button" class="auc-main" disabled>Аукцион завершён</button>';
    else if (a.own) action = a.can_cancel
        ? '<button type="button" class="auc-main danger" id="auc-cancel">Снять аукцион</button>'
        : '<button type="button" class="auc-main" disabled>Есть ставка — снять нельзя</button>';
    else if (a.leading) action = '<button type="button" class="auc-main" disabled>Ваша ставка лидирует</button>';
    else action = '<button type="button" class="auc-main" id="auc-bid">Сделать ставку</button>';
    return `<div class="auc-detail" data-detail="${esc(a.id)}">
        <div class="auc-hero">${artOf(g, true, a.id)}<button type="button" class="auc-heart on-hero" data-heart="${esc(a.id)}" aria-pressed="${a.favorite}" aria-label="В избранное">${heart(a.favorite)}</button></div>
        ${ended ? '<div class="auc-ends"><span>Аукцион завершён</span></div>' : timeBlocks(a)}
        <div class="auc-title"><h2>${esc(g.name)}${collectionIcon(g)}</h2><i>${g.number ? '#' + esc(g.number) : ''}</i></div>
        <div class="auc-traits">${traitRow('Модель', g.model, r.model)}${traitRow('Фон', g.backdrop, r.backdrop)}${traitRow('Символ', g.symbol, r.symbol)}</div>
        <div class="auc-price-row"><span>${a.current_bid ? 'Текущая ставка' : 'Стартовая цена'}</span><b>${gram(a.current_bid ?? a.start_price)}</b></div>
        ${ended ? '' : `<div class="auc-price-row dim"><span>Минимальная ставка</span><b>${gram(a.min_bid)}</b></div>`}
        <h3>История ставок</h3>
        <div class="auc-bids">${(a.bids || []).length ? a.bids.map(b => `<div class="auc-bidrow${b.mine ? ' mine' : ''}">
            <span>${esc(b.user)}${b.mine ? ' (вы)' : ''}</span><b>${gram(b.amount)}</b><small>${timeAgo(b.created)}</small></div>`).join('')
            : '<div class="auc-bidrow none">Ставок пока нет</div>'}</div>
        <p class="auc-note">Ставка списывается сразу и возвращается, если её перебьют. Ставка в последние 10 минут продлевает аукцион на 1 минуту. Комиссия продавца — ${feeText()}%.</p>
        <div class="auc-action">${action}</div>
    </div>`;
}
async function openDetail(id, quiet) {
    ui.openId = id;
    try {
        const data = await api('auctions/' + encodeURIComponent(id));
        ui.offset = data.now - Math.floor(Date.now() / 1000);
        const html = detailHTML(data.auction);
        if (quiet && !appSheet.open) return;
        if (!appSheet.open || !document.querySelector('.auc-detail')) {
            sheet('', html);
            appSheet.classList.add('auction-sheet');
            appSheet.classList.remove('auc-celebrate');
        } else {
            const body = document.querySelector('#sheet-body'), top = body.scrollTop;
            body.innerHTML = html;
            body.scrollTop = top;
        }
        ui.current = data.auction;
        ui.lookup.set(data.auction.id, data.auction);
        hydrateArts(document.querySelector('#sheet-body'));
        animateHero();
        try { if (location.pathname !== '/auctions/' + id) history.replaceState({crafterPage: 'auctions'}, '', '/auctions/' + id); } catch (_) {}
        tick();
        clearInterval(ui.detailTimer);
        ui.detailTimer = setInterval(() => {
            if (!appSheet.open || !document.querySelector('.auc-detail') || document.querySelector('.auc-modal')) return;
            openDetail(id, true);
        }, 6000);
    } catch (error) {
        if (!quiet) toast(error.message);
    }
}
function openBidModal(a) {
    document.querySelector('.auc-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'auc-modal';
    modal.innerHTML = `<div class="auc-modal-box" role="dialog" aria-label="Ставка">
        <header><b>${esc(a.gift.name)} <i>${a.gift.number ? '#' + esc(a.gift.number) : ''}</i></b><button type="button" class="auc-x" aria-label="Закрыть">×</button></header>
        <label class="auc-field"><input id="auc-amount" inputmode="decimal" maxlength="10" value="${esc(String(a.min_bid).replace('.', ','))}" aria-label="Ставка в GRAM"><span>GRAM</span></label>
        <p class="auc-hint">Минимум ${money(a.min_bid)} GRAM · на балансе ${money(state.me?.balance || 0)} GRAM</p>
        <p class="auc-error" role="alert" hidden></p>
        <button type="button" class="auc-main" id="auc-send">Сделать ставку</button>
    </div>`;
    appSheet.append(modal);
    const input = modal.querySelector('#auc-amount');
    input.focus(); input.select();
    const close = () => modal.remove();
    modal.addEventListener('click', event => { if (event.target === modal || event.target.closest('.auc-x')) close(); });
    const send = async () => {
        const button = modal.querySelector('#auc-send'), error = modal.querySelector('.auc-error');
        const amount = input.value.trim().replace(',', '.');
        if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount)) { error.hidden = false; error.textContent = 'Введите сумму с точностью до двух знаков'; return; }
        if (button.disabled) return;
        button.disabled = true; error.hidden = true;
        ui.requests = ui.requests || {};
        const key = a.id + ':' + amount;
        const requestId = ui.requests[key] ||= 'bid-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        try {
            const data = await api(`auctions/${encodeURIComponent(a.id)}/bid`, {amount, request_id: requestId});
            delete ui.requests[key];
            if (state.me) { state.me.balance = data.balance; updateBalance(); }
            close();
            toast('Ставка принята');
            appSheet.classList.remove('auc-celebrate'); void appSheet.offsetWidth; appSheet.classList.add('auc-celebrate');
            openDetail(a.id, true);
            load(true);
        } catch (e) {
            error.hidden = false; error.textContent = e.message;
            if (e.status && e.status < 500) delete ui.requests[key];
            button.disabled = false;
        }
    };
    modal.querySelector('#auc-send').onclick = send;
    input.addEventListener('keydown', event => { if (event.key === 'Enter') send(); });
}

/* ---------- filters ---------- */
function openFilters() {
    const f = ui.filters;
    sheet('Фильтры', `<div class="auc-filters">
        <input class="auc-input" id="af-search" placeholder="Поиск по имени и атрибутам" value="${esc(f.search)}" maxlength="100">
        <div class="auc-two"><label>Цена от<input class="auc-input" id="af-min" inputmode="decimal" value="${esc(f.min)}" maxlength="10"></label>
            <label>до<input class="auc-input" id="af-max" inputmode="decimal" value="${esc(f.max)}" maxlength="10"></label></div>
        <label>ID подарка<input class="auc-input" id="af-number" inputmode="numeric" placeholder="#" value="${esc(f.number)}" maxlength="10"></label>
        <h3>Коллекции <small>${f.collections.size || ''}</small></h3>
        <div class="auc-chips">${ui.collections.length ? ui.collections.map(c =>
            `<button type="button" class="auc-chip" data-collection="${esc(c.name)}" aria-pressed="${f.collections.has(c.name)}">${esc(c.name)} <small>${c.count}</small></button>`).join('')
            : '<span class="auc-hint">Сейчас нет активных лотов</span>'}</div>
        <div class="auc-action two"><button type="button" class="auc-main ghost" id="af-reset">Сбросить</button><button type="button" class="auc-main" id="af-done">Готово</button></div>
    </div>`);
    const root = document.querySelector('#sheet-body');
    root.querySelectorAll('[data-collection]').forEach(chip => chip.onclick = () => {
        const name = chip.dataset.collection;
        f.collections.has(name) ? f.collections.delete(name) : f.collections.add(name);
        chip.setAttribute('aria-pressed', f.collections.has(name));
    });
    root.querySelector('#af-reset').onclick = () => {
        ui.filters = {search: '', collections: new Set(), min: '', max: '', number: ''};
        closeSheet(); render(); load();
    };
    root.querySelector('#af-done').onclick = () => {
        f.search = root.querySelector('#af-search').value.trim();
        f.min = root.querySelector('#af-min').value.trim();
        f.max = root.querySelector('#af-max').value.trim();
        f.number = root.querySelector('#af-number').value.trim();
        closeSheet(); render(); load();
    };
}

/* ---------- create ---------- */
async function openCreate(preselect) {
    let inventory;
    try { inventory = (await api('inventory')).gifts; } catch (e) { return toast(e.message); }
    const gifts = inventory.filter(g => g.status === 'unlisted' && !g.catalog_only && !g.star_gift);
    if (!gifts.length) return toast('Нет подарков, которые можно выставить на аукцион');
    if (preselect && !gifts.some(g => g.id === preselect)) return toast('Этот подарок нельзя поставить на аукцион');
    if (preselect) gifts.sort((a, b) => (b.id === preselect) - (a.id === preselect));
    const draft = {id: gifts[0].id, minutes: 1440, custom: false};
    sheet('Выставить на аукцион', `<div class="auc-create-form">
        <div class="auc-pick">${gifts.map((g, i) => `<label class="auc-pick-row"><input type="radio" name="auc-gift" value="${esc(g.id)}"${i ? '' : ' checked'}>
            <span class="auc-mini" style="background:${giftBackdrop(g)}"><img ${giftPicture(g)} alt="" loading="lazy"></span>
            <span><b>${esc(g.name)}</b><small>${g.number ? '#' + esc(g.number) : ''}${g.model ? ' · ' + esc(g.model) : ''}</small></span></label>`).join('')}</div>
        <label class="auc-lab">Стартовая цена, GRAM<input class="auc-input" id="ac-price" inputmode="decimal" maxlength="10" placeholder="Например, 25"></label>
        <div class="auc-lab">Длительность</div>
        <div class="auc-chips" id="ac-presets">${PRESETS.map(([m, label]) => `<button type="button" class="auc-chip" data-minutes="${m}" aria-pressed="${m === draft.minutes}">${label}</button>`).join('')}
            <button type="button" class="auc-chip" data-minutes="custom" aria-pressed="false">Своя</button></div>
        <div class="auc-two" id="ac-custom" hidden><label>Значение<input class="auc-input" id="ac-value" inputmode="numeric" maxlength="5" value="2"></label>
            <label>Единицы<select class="auc-input" id="ac-unit"><option value="1">минут</option><option value="60">часов</option><option value="1440" selected>дней</option></select></label></div>
        <p class="auc-hint">От 30 минут до 30 дней. Подарок будет заблокирован до конца аукциона. Снять аукцион можно только до первой ставки. Комиссия с продажи — ${feeText()}%.</p>
        <p class="auc-error" role="alert" hidden></p>
        <div class="auc-action"><button type="button" class="auc-main" id="ac-send">Выставить на аукцион</button></div>
    </div>`);
    const root = document.querySelector('#sheet-body');
    const minutesNow = () => draft.custom ? Math.round(Number(root.querySelector('#ac-value').value) * Number(root.querySelector('#ac-unit').value)) : draft.minutes;
    root.querySelectorAll('[data-minutes]').forEach(chip => chip.onclick = () => {
        draft.custom = chip.dataset.minutes === 'custom';
        if (!draft.custom) draft.minutes = Number(chip.dataset.minutes);
        root.querySelectorAll('[data-minutes]').forEach(c => c.setAttribute('aria-pressed', c === chip));
        root.querySelector('#ac-custom').hidden = !draft.custom;
    });
    root.querySelector('#ac-send').onclick = async () => {
        const button = root.querySelector('#ac-send'), error = root.querySelector('.auc-error');
        const price = root.querySelector('#ac-price').value.trim().replace(',', '.');
        const minutes = minutesNow();
        const fail = text => { error.hidden = false; error.textContent = text; };
        if (!/^\d{1,7}(\.\d{1,2})?$/.test(price) || Number(price) < 0.01) return fail('Введите стартовую цену, например 25 или 12,50');
        if (!Number.isInteger(minutes) || minutes < 30 || minutes > 43200) return fail('Длительность — от 30 минут до 30 дней');
        const gift = root.querySelector('input[name="auc-gift"]:checked')?.value;
        if (!gift || button.disabled) return;
        button.disabled = true; error.hidden = true;
        draft.request ||= 'auc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        try {
            await api('auctions', {gift_id: gift, start_price: price, minutes, request_id: draft.request});
            closeSheet();
            toast('Аукцион запущен');
            ui.view = 'mine';
            if (state.page === 'auctions') { render(); load(); } else go('auctions');
        } catch (e) {
            draft.request = null;
            fail(e.message); button.disabled = false;
        }
    };
}

/* ---------- events ---------- */
document.addEventListener('click', async event => {
    const t = event.target;
    const menu = document.querySelector('#auc-menu');
    if (menu && !menu.hidden && !t.closest('.auc-sort')) { menu.hidden = true; document.querySelector('#auc-sort-btn')?.setAttribute('aria-expanded', 'false'); }
    if (t.closest('#auc-sort-btn')) {
        menu.hidden = !menu.hidden;
        t.closest('#auc-sort-btn').setAttribute('aria-expanded', String(!menu.hidden));
        return;
    }
    const pick = t.closest('#auc-menu [data-sort]');
    if (pick) { ui.sort = pick.dataset.sort; render(); return load(); }
    const heartButton = t.closest('[data-heart]');
    if (heartButton) {
        event.preventDefault(); event.stopPropagation();
        const id = heartButton.dataset.heart;
        try {
            const result = await api(`auctions/${encodeURIComponent(id)}/favorite`, {});
            document.querySelectorAll(`[data-heart="${CSS.escape(id)}"]`).forEach(b => {
                b.setAttribute('aria-pressed', result.favorite); b.innerHTML = heart(result.favorite);
                b.classList.remove('pop'); void b.offsetWidth; if (result.favorite) b.classList.add('pop');
            });
            const item = ui.items?.find(a => a.id === id);
            if (item) item.favorite = result.favorite;
            if (ui.view === 'favorites' && !result.favorite && state.page === 'auctions') { ui.items = ui.items.filter(a => a.id !== id); paintGrid(); }
        } catch (e) { toast(e.message); }
        return;
    }
    if (state.page === 'auctions') {
        const open = t.closest('.auc-card [data-open]');
        if (open) return openDetail(open.dataset.open);
        const tab = t.closest('.auc-tabs [data-view]');
        if (tab) { ui.view = tab.dataset.view; render(); return load(); }
        if (t.closest('#auc-filter')) return openFilters();
        if (t.closest('#auc-create')) return openCreate();
    }
    if (t.closest('#auc-bid') && ui.current) return openBidModal(ui.current);
    if (t.closest('#auc-cancel') && ui.current) {
        if (!confirm('Снять аукцион? Подарок вернётся в инвентарь.')) return;
        try {
            await api(`auctions/${encodeURIComponent(ui.current.id)}/cancel`, {});
            closeSheet(); toast('Аукцион снят'); load(true);
        } catch (e) { toast(e.message); openDetail(ui.current.id, true); }
    }
});
document.addEventListener('change', event => {
    if (event.target.id === 'auc-sort') { ui.sort = event.target.value; load(); }
});
appSheet.addEventListener('close', () => {
    try { if (/^\/auctions\//.test(location.pathname)) history.replaceState({crafterPage: 'auctions'}, '', '/auctions'); } catch (_) {}
    appSheet.classList.remove('auction-sheet');
    document.querySelector('.auc-modal')?.remove();
    clearInterval(ui.detailTimer); ui.detailTimer = 0; ui.openId = null; ui.current = null;
});

/* ---------- routing ---------- */
const previousGo = go;
go = async function (page, ...rest) {
    if (page !== 'auctions') {
        stop();
        document.querySelector('#app')?.classList.remove('auctions-view');
        return previousGo.call(this, page, ...rest);
    }
    if (state.crafting) return;
    state.page = 'auctions';
    state.gamesMode = false;
    const app = document.querySelector('#app');
    app?.classList.remove('craft-view', 'cart-view', 'staking-view', 'arena-view', 'games-view');
    app?.classList.add('auctions-view');
    document.querySelector('#cart-float')?.remove();
    nav(); updateBalance();
    render();
    start();
    await load();
    const lot = (location.pathname.match(/^\/auctions\/(auction-[0-9a-f]{32})$/) || [])[1];
    if (lot && !ui.deepDone) { ui.deepDone = true; openDetail(lot); }
};
const baseTabs = resaleMarketTabs;
resaleMarketTabs = function () {
    return baseTabs().replace(/<\/div>\s*$/, `<button type="button" aria-pressed="false" onclick="go('auctions')">Аукционы</button></div>`);
};
window.openAuctions = () => go('auctions');
window.startAuctionFromGift = id => openCreate(id);
})();
