/* Crafter Upgrade — liquid glass interface, real Craft Market targets, server-signed quotes. */
const upgradeUI = {
    mode: 'collection', stakeMode: 'balance', amount: '', giftId: '', collection: '',
    lotId: '', collectionSearch: '', collections: [], lots: [], inventory: [], info: null,
    quote: null, quoteError: '', loading: false, spinning: false, hasMore: false,
    pendingRequestId: null, timer: null, nonce: 0,
};
const ugText = x => esc(String(x ?? ''));
const ugMoney = x => money(x);
function ugArt(url, name, css) {
    const valid = imageURL(url);
    return valid ? '<img class="' + (css || '') + '" src="' + ugText(valid) + '" alt="' + ugText(name || '') + '" loading="lazy" decoding="async">' :
        '<span class="ug-placeholder" aria-hidden="true">◇</span>';
}
function ugCurrentLot() { return upgradeUI.lots.find(x => x.id === upgradeUI.lotId); }
function ugCurrentGift() { return upgradeUI.inventory.find(x => x.id === upgradeUI.giftId); }
function ugActualMode() {
    return upgradeUI.mode === 'gift' ? 'gift' :
        (upgradeUI.mode === 'collection' ? upgradeUI.stakeMode : 'ton');
}
function ugChoice(mode, label) {
    return '<button type="button" class="ug-switch' + (upgradeUI.mode === mode ? ' is-active' : '') +
        '" onclick="ugSetMode(' + arg(mode) + ')">' + label + '</button>';
}
function ugDataRow(title, val) {
    return '<span><small>' + title + '</small><b>' + ugText(val) + '</b></span>';
}
async function enterUpgrade(main) {
    upgradeUI.nonce += 1;
    const ticket = upgradeUI.nonce;
    upgradeUI.quote = null;
    upgradeUI.quoteError = '';
    upgradeUI.pendingRequestId = null;
    upgradeUI.spinning = false;
    main.innerHTML = crafterLoading('upgrade');
    try {
        const [info, collections, inventory] = await Promise.all([
            api('upgrade/info'), api('upgrade/collections'), api('inventory')
        ]);
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        upgradeUI.info = info;
        upgradeUI.collections = collections.collections || [];
        upgradeUI.inventory = (inventory.gifts || []).filter(g => g.status === 'unlisted' && !g.catalog_only);
        upgradeUI.lots = [];
        upgradeUI.lotId = '';
        upgradeUI.collection = '';
        ugRender();
    } catch (error) {
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        main.innerHTML = '<div class="ug-panel"><p class="error">' + ugText(error.message) + '</p>' +
            '<button type="button" class="ug-primary" onclick="go(\'upgrade\')">Повторить</button></div>';
    }
}
function ugSetMode(mode) {
    if (!['ton', 'gift', 'collection'].includes(mode) || upgradeUI.spinning) return;
    upgradeUI.mode = mode;
    if (mode === 'gift') upgradeUI.stakeMode = 'gift';
    if (mode === 'collection' && upgradeUI.stakeMode !== 'gift') upgradeUI.stakeMode = 'balance';
    ugInvalidate();
}
function ugSetStake(mode) {
    if (upgradeUI.spinning || !['balance', 'gift'].includes(mode)) return;
    upgradeUI.stakeMode = mode;
    ugInvalidate();
}
function ugSetAmount(value) {
    if (upgradeUI.spinning) return;
    upgradeUI.amount = String(value ?? '');
    ugInvalidate(false);
    ugRenderStakeFeedback();
}
function ugQuickAmount(value) {
    upgradeUI.amount = value === 'max' ? String(upgradeUI.info?.balance || 0) : String(value);
    ugInvalidate();
}
function ugPickGift(id) {
    if (upgradeUI.spinning) return;
    upgradeUI.giftId = id;
    ugInvalidate();
}
function ugInvalidate(redraw = true) {
    upgradeUI.nonce += 1;
    upgradeUI.quote = null;
    upgradeUI.quoteError = '';
    upgradeUI.pendingRequestId = null;
    clearTimeout(upgradeUI.timer);
    if (redraw) ugRender();
    ugRenderStakeFeedback();
    if (upgradeUI.lotId && ugActualMode() !== 'ton') {
        upgradeUI.timer = setTimeout(ugRequote, 350);
    }
}
function ugRenderStakeFeedback() {
    const quote = upgradeUI.quote;
    const chance = document.getElementById('ug-chance');
    const ring = document.querySelector('.ug-wheel');
    const button = document.getElementById('ug-submit');
    const message = document.getElementById('ug-message');
    const value = document.getElementById('ug-stake-value');
    const actual = ugActualMode();
    if (chance) chance.textContent = quote ? ugMoney(quote.chance) + '%' : '0%';
    if (ring) ring.style.setProperty('--ug-chance', (quote ? quote.chance : 0) + '%');
    if (button) button.disabled = !quote || !upgradeUI.info?.enabled || upgradeUI.spinning || actual === 'ton';
    if (value) value.textContent = quote ? ugMoney(quote.amount) + ' GRAM' :
        (actual === 'gift' ? (ugCurrentGift() ? ugMoney(ugCurrentGift().price) + ' GRAM*' : '—') :
        (upgradeUI.amount ? upgradeUI.amount + ' GRAM' : '—'));
    if (message) message.textContent = upgradeUI.quoteError || (actual === 'ton' ?
        'Прямые ставки TON пока недоступны: Craft Market работает с GRAM. Выберите Collection → GRAM или Gift.' :
        !upgradeUI.info?.enabled ? 'Режим просмотра. Для реальных ставок необходимо пополнить и подключить банк Upgrade.' :
        !upgradeUI.lotId ? 'Выберите коллекцию и целевой лот Craft Market.' :
        !quote ? 'Выберите ставку для точного расчёта шанса.' : 'Шанс рассчитан сервером. Цены указаны в GRAM.');
}
async function ugRequote() {
    const mode = ugActualMode();
    if (!upgradeUI.lotId || upgradeUI.spinning || mode === 'ton') return;
    const gift = ugCurrentGift();
    if (mode === 'gift' && !gift) return;
    if (mode === 'balance' && !/^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(upgradeUI.amount)) return;
    const ticket = ++upgradeUI.nonce;
    try {
        const quote = await api('upgrade/quote', {
            lot_id: upgradeUI.lotId, stake_mode: mode,
            amount: upgradeUI.amount, gift_id: upgradeUI.giftId,
        });
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        upgradeUI.quote = quote;
        upgradeUI.quoteError = '';
    } catch (error) {
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        upgradeUI.quote = null;
        upgradeUI.quoteError = error.message || 'Не удалось рассчитать шанс';
    }
    ugRenderStakeFeedback();
}
function ugSetCollectionSearch(value) {
    upgradeUI.collectionSearch = String(value || '');
    ugRenderCollections();
}
function ugRenderCollections() {
    const target = document.getElementById('ug-collections');
    if (!target) return;
    const query = upgradeUI.collectionSearch.trim().toLocaleLowerCase();
    const collections = upgradeUI.collections.filter(x =>
        String(x.name || '').toLocaleLowerCase().includes(query));
    target.innerHTML = collections.length ? collections.map(x =>
        '<button type="button" class="ug-collection-card' +
        (upgradeUI.collection === x.key ? ' selected' : '') +
        '" onclick="ugChooseCollection(' + arg(x.key) + ')">' +
        ugArt(x.image, x.name, 'ug-collection-image') +
        '<span class="ug-collection-copy"><strong>' + ugText(x.name) + '</strong>' +
        '<small>От ' + ugMoney(x.floor) + ' GRAM · ' + ugText(x.count) + ' лотов</small></span>' +
        '<span class="ug-chevron">›</span></button>').join('') :
        '<div class="ug-empty">Нет доступных коллекций Craft Market.</div>';
}
async function ugChooseCollection(key) {
    if (upgradeUI.spinning) return;
    upgradeUI.collection = key;
    upgradeUI.lotId = '';
    upgradeUI.lots = [];
    upgradeUI.hasMore = false;
    upgradeUI.loading = true;
    ugInvalidate();
    const ticket = ++upgradeUI.nonce;
    try {
        const result = await api('upgrade/lots?collection=' + encodeURIComponent(key));
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        upgradeUI.lots = result.lots || [];
        upgradeUI.hasMore = Boolean(result.has_more);
        upgradeUI.loading = false;
    } catch (error) {
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        upgradeUI.loading = false;
        upgradeUI.quoteError = error.message;
    }
    ugRender();
}
async function ugMore() {
    if (!upgradeUI.collection || !upgradeUI.hasMore || upgradeUI.loading) return;
    upgradeUI.loading = true;
    ugRender();
    const key = upgradeUI.collection;
    const ticket = ++upgradeUI.nonce;
    try {
        const data = await api('upgrade/lots?collection=' + encodeURIComponent(key) +
            '&offset=' + upgradeUI.lots.length);
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        upgradeUI.lots.push(...(data.lots || []));
        upgradeUI.hasMore = Boolean(data.has_more);
    } catch (error) {
        toast(error.message);
    } finally {
        if (state.page === 'upgrade' && ticket === upgradeUI.nonce) {
            upgradeUI.loading = false;
            ugRender();
        }
    }
}
function ugPickLot(id) {
    if (upgradeUI.spinning) return;
    upgradeUI.lotId = id;
    ugInvalidate();
}
function ugRender() {
    if (state.page !== 'upgrade') return;
    const root = document.querySelector('#main');
    if (!root) return;
    const chosen = ugCurrentLot(), selectedGift = ugCurrentGift();
    const actual = ugActualMode(), info = upgradeUI.info || {};
    const collectionName = upgradeUI.collections.find(x => x.key === upgradeUI.collection)?.name || '';
    const stakeTabs = upgradeUI.mode === 'collection' ?
        '<div class="ug-minitabs"><button type="button" class="' + (upgradeUI.stakeMode === 'balance' ? 'active' : '') +
        '" onclick="ugSetStake(\'balance\')">GRAM</button><button type="button" class="' +
        (upgradeUI.stakeMode === 'gift' ? 'active' : '') +
        '" onclick="ugSetStake(\'gift\')">Подарок</button></div>' : '';
    const amountBox = '<div class="ug-amount"><input id="ug-amount" inputmode="decimal" autocomplete="off" ' +
        'aria-label="Сумма ставки GRAM" type="text" placeholder="0.00" value="' + ugText(upgradeUI.amount) +
        '" oninput="ugSetAmount(this.value)"><span>GRAM</span></div>' +
        '<div class="ug-quick">' + ['0.5', '1', '2', '5', 'max'].map(v =>
        '<button type="button" onclick="ugQuickAmount(' + arg(v) + ')">' + (v === 'max' ? 'MAX' : v) + '</button>').join('') + '</div>' +
        '<p class="ug-hint">Доступно: ' + ugMoney(info.balance || 0) + ' GRAM</p>';
    const gifts = upgradeUI.inventory.map(g => '<button type="button" class="ug-gift' +
        (upgradeUI.giftId === g.id ? ' selected' : '') + '" onclick="ugPickGift(' + arg(g.id) + ')">' +
        ugArt(g.image, g.name, 'ug-gift-art') +
        '<span><b>' + ugText(g.name) + '</b><small>#' + ugText(g.number || '—') +
        ' · ' + ugMoney(g.price) + ' ' + ugText(g.price_unit || 'GRAM') + '</small></span></button>').join('');
    const stakeContent = actual === 'ton' ?
        '<div class="ug-disabled-ton"><strong>TON Connect</strong><p>Прямые ставки TON не включены: лоты Craft Market оцениваются в GRAM. ' +
        'Никакого скрытого обмена TON → GRAM нет.</p><button type="button" onclick="ugSetMode(\'collection\')">Перейти к ставке GRAM</button></div>' :
        (actual === 'gift' ? '<div class="ug-gift-grid">' +
        (gifts || '<div class="ug-empty">В инвентаре нет подходящих подарков.</div>') + '</div>' : amountBox);
    const lots = upgradeUI.loading && !upgradeUI.lots.length ?
        '<div class="ug-empty">Загружаем лоты...</div>' :
        upgradeUI.lots.length ? upgradeUI.lots.map(l =>
            '<button type="button" class="ug-lot' + (l.id === upgradeUI.lotId ? ' selected' : '') +
            '" onclick="ugPickLot(' + arg(l.id) + ')">' +
            ugArt(l.image, l.name, 'ug-lot-art') +
            '<span><strong>' + ugText(l.name) + ' #' + ugText(l.number || '—') +
            '</strong><small>' + ugText(l.model || 'Коллекционный подарок') + '</small></span>' +
            '<b>' + ugMoney(l.price) + ' GRAM</b></button>').join('') :
            '<div class="ug-empty">' + (upgradeUI.collection ? 'В этой коллекции нет активных лотов.' :
            'Сначала выберите коллекцию.') + '</div>';
    root.innerHTML = '<section class="ug-screen">' +
        '<div class="ug-top"><div><span class="ug-overline">CRAFTER / GAMES</span><h1>Upgrade <span>✦</span></h1>' +
        '<p>Выбирай ставку и охоться за коллекционными подарками.</p></div>' +
        '<button type="button" class="ug-info" onclick="ugRules()" aria-label="Правила">ⓘ</button></div>' +
        '<div class="ug-modes" role="group" aria-label="Режим Upgrade">' +
        ugChoice('ton', 'TON') + ugChoice('gift', 'Gift') + ugChoice('collection', 'Collection') + '</div>' +
        '<div class="ug-columns"><div class="ug-config">' +
        '<section class="ug-panel"><header><span class="ug-step">01</span><h2>Твоя ставка</h2></header>' +
        stakeTabs + stakeContent + '</section>' +
        '<section class="ug-panel"><header><span class="ug-step">02</span><h2>Выбери цель</h2></header>' +
        '<div class="ug-search"><span>⌕</span><input type="search" placeholder="Поиск коллекции" aria-label="Поиск коллекции" ' +
        'value="' + ugText(upgradeUI.collectionSearch) + '" oninput="ugSetCollectionSearch(this.value)"></div>' +
        '<div id="ug-collections" class="ug-collections"></div>' +
        (upgradeUI.collection ? '<div class="ug-section-sub"><b>' + ugText(collectionName) +
        '</b><span>Лоты Craft Market</span></div><div class="ug-lots">' + lots + '</div>' +
        (upgradeUI.hasMore ? '<button type="button" class="ug-more" onclick="ugMore()">Показать ещё</button>' : '') : '') +
        '</section></div>' +
        '<div class="ug-result"><section class="ug-panel ug-wheel-panel"><div class="ug-wheel-label">UPGRADE CHANCE</div>' +
        '<div class="ug-wheel" style="--ug-chance:' + (upgradeUI.quote?.chance || 0) + '%">' +
        '<div class="ug-wheel-dial"></div><div class="ug-wheel-needle" id="ug-needle"><i></i></div>' +
        '<div class="ug-wheel-center"><small>WIN CHANCE</small><b id="ug-chance">' +
        (upgradeUI.quote ? ugMoney(upgradeUI.quote.chance) : '0') + '%</b><span>✦</span></div></div>' +
        '<div class="ug-selected"><div class="ug-selected-art">' +
        (chosen ? ugArt(chosen.image, chosen.name, '') : '<span class="ug-placeholder">◇</span>') +
        '</div><div><small>Целевой подарок</small><strong>' +
        (chosen ? ugText(chosen.name + ' #' + (chosen.number || '')) : 'Не выбран') +
        '</strong><span>' + (chosen ? ugMoney(chosen.price) + ' GRAM' : 'Выберите лот') + '</span></div></div>' +
        '<div class="ug-metrics">' +
        ugDataRow('СТАВКА', upgradeUI.quote ? ugMoney(upgradeUI.quote.amount) + ' GRAM' :
            (selectedGift && actual === 'gift' ? ugMoney(selectedGift.price) + ' GRAM*' : '—')) +
        ugDataRow('ЦЕЛЬ', chosen ? ugMoney(chosen.price) + ' GRAM' : '—') +
        ugDataRow('ШАНС', upgradeUI.quote ? ugMoney(upgradeUI.quote.chance) + '%' : '—') +
        '</div><p id="ug-message" class="ug-message" aria-live="polite"></p>' +
        '<button id="ug-submit" type="button" class="ug-primary" onclick="ugPlay()">Upgrade <span>↗</span></button>' +
        '<small class="ug-disclaimer">*Оценка подарка окончательно определяется сервером по текущим лотам. ' +
        'Результат случаен. При проигрыше ставка теряется.</small></section></div></div>' +
        '<section class="ug-footer"><span>Liquid glass • Fair wheel</span><span>CRAFT MARKET / GRAM</span></section>' +
        '</section>';
    ugRenderCollections();
    ugRenderStakeFeedback();
}
function ugRules() {
    sheet('Правила Upgrade', '<div class="ug-rules"><p>Выберите ставку из внутреннего GRAM-баланса или ' +
        'подарок с проверенной оценкой, затем коллекцию и реальный лот Craft Market.</p>' +
        '<p>Шанс рассчитывается на сервере как стоимость ставки / цену цели, максимум 95%. ' +
        'Стоимость цели должна превышать ставку.</p>' +
        '<p>При выигрыше целевой лот передаётся в ваш инвентарь, а продавец получает оплату из ' +
        'банка режима. При проигрыше ставка списывается.</p>' +
        '<p>Результат определяется защищённым серверным генератором. Крутящаяся стрелка лишь ' +
        'показывает уже определённый результат.</p>' +
        '<p>Прямые ставки нативным TON пока не подключены: GRAM и TON не считаются одним активом.</p></div>');
}
async function ugPlay() {
    if (upgradeUI.spinning || !upgradeUI.quote || !upgradeUI.info?.enabled) return;
    upgradeUI.spinning = true;
    ugRenderStakeFeedback();
    const btn = document.getElementById('ug-submit');
    if (btn) btn.textContent = 'Крутим...';
    if (!upgradeUI.pendingRequestId) upgradeUI.pendingRequestId = 'ug' + crypto.randomUUID().replace(/-/g, '');
    let result;
    try {
        result = await api('upgrade/play', {
            quote_id: upgradeUI.quote.quote_id,
            request_id: upgradeUI.pendingRequestId
        });
    } catch (error) {
        upgradeUI.spinning = false;
        upgradeUI.quoteError = error.message || 'Ошибка запуска';
        ugRenderStakeFeedback();
        if (btn) btn.innerHTML = 'Повторить запрос ↗';
        return;
    }
    const needle = document.getElementById('ug-needle');
    const landing = Number(result.roll_bps || 0) / 10000 * 360;
    if (needle) {
        needle.style.transform = 'rotate(' + (1800 + landing) + 'deg)';
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await new Promise(resolve => setTimeout(resolve, reduced ? 100 : 4300));
    if (state.page !== 'upgrade') return;
    const success = Boolean(result.success);
    const prize = result.gift || {};
    sheet(success ? 'Upgrade successful ✦' : 'Upgrade failed',
        '<div class="ug-outcome ' + (success ? 'win' : 'lose') + '">' +
        (success ? ugArt(prize.image, prize.name, 'ug-prize-art') : '<div class="ug-outcome-mark">✕</div>') +
        '<h2>' + (success ? 'Поздравляем!' : 'Не повезло') + '</h2><p>' +
        (success ? 'Вы получили ' + ugText(prize.name || 'подарок') +
        (prize.number ? ' #' + ugText(prize.number) : '') :
        'Ставка потеряна. Результат определён сервером.') + '</p>' +
        '<button type="button" class="ug-primary" onclick="closeSheet();go(\'upgrade\')">Играть снова</button></div>');
    upgradeUI.spinning = false;
    upgradeUI.quote = null;
    upgradeUI.pendingRequestId = null;
    try {
        const [info, collections, inventory] = await Promise.all([
            api('upgrade/info'), api('upgrade/collections'), api('inventory')
        ]);
        if (state.page === 'upgrade') {
            upgradeUI.info = info;
            upgradeUI.collections = collections.collections || [];
            upgradeUI.inventory = (inventory.gifts || []).filter(g => g.status === 'unlisted' && !g.catalog_only);
            upgradeUI.collection = '';
            upgradeUI.lots = [];
            upgradeUI.lotId = '';
            upgradeUI.giftId = '';
            upgradeUI.quoteError = '';
            ugRender();
            if (typeof refreshMe === 'function') refreshMe().catch(() => {});
        }
    } catch (_) { if (state.page === 'upgrade') ugRender(); }
}
