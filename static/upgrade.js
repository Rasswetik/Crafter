/* Crafter Upgrade: wheel -> two picture cards -> inventory/collection sheets. */
const upgradeUI = {
    inventory: [], collections: [], lots: [], info: null,
    giftId: '', lotId: '', selectedLot: null, collection: '', collectionName: '',
    quote: null, quoteError: '', loading: false, loadingMore: false, hasMore: false,
    spinning: false, pendingRequestId: '', nonce: 0, modalNonce: 0,
    collectionFilter: '', pickerStep: 'collections', stakeValue: null, lotFilter: '', collectionSort: 'all'
};
const ugText = value => esc(String(value ?? ''));
const ugMoney = value => money(value);
function ugCurrentGift() {
    return upgradeUI.inventory.find(gift => String(gift.id) === upgradeUI.giftId);
}
function ugPicture(gift, extraClass, fullPoster = false) {
    if (!gift) return '<span class="ug-empty-art" aria-hidden="true">+</span>';
    const original = imageURL(gift.image);
    const base = typeof giftAnimationPath === 'function' ? giftAnimationPath(gift) : '';
    const fragment = typeof fragmentGiftPath === 'function' ? fragmentGiftPath(gift) : '';
    // The *specific numbered NFT* gets the full gift poster when available.
    // Inventory uses its transparent model PNG on the gift's own colored backdrop.
    const sources = fullPoster
        ? [fragment && fragment + '.large.jpg', fragment && fragment + '.webp',
           original, base && base + '.png', base && base + '.svg']
        : [base && base + '.png', original, base && base + '.svg',
           fragment && fragment + '.webp'];
    const urls = [...new Set(sources.filter(Boolean))];
    if (!urls.length) return '<span class="ug-empty-art" aria-hidden="true">◇</span>';
    return '<img class="' + ugText(extraClass || '') + '" src="' +
        ugText(urls.shift()) + '" data-gift-fallback="' +
        ugText(JSON.stringify(urls)) + '" onerror="nextGiftPicture(this)" alt="' +
        ugText(gift.name || 'Подарок') + '" loading="lazy" decoding="async" draggable="false">';
}
function ugArtFrame(gift, className) {
    const full = /ug-lot|ug-outcome|ug-target/.test(className);
    const backdrop = gift && typeof giftBackdrop === 'function' ? giftBackdrop(gift) : '';
    const pattern = gift && typeof giftPattern === 'function' ? giftPattern(gift) : '';
    const css = backdrop ? ' style="background:' + ugText(backdrop) + '"' : '';
    return '<span class="' + className + ' ug-nft-frame"' + css + '>' +
        (pattern || '') + ugPicture(gift, 'ug-picture', full) + '</span>';
}
function ugCollectionArt(collection) {
    const slug = typeof giftCollectionSlug === 'function' ?
        giftCollectionSlug(collection.name) : '';
    const image = typeof fragmentCollectionImage === 'function' ?
        fragmentCollectionImage(slug) : '';
    const direct = typeof directFragmentCollectionImage === 'function' ?
        directFragmentCollectionImage(slug) : '';
    // Never fall back to a random listed NFT model for a collection thumbnail.
    const sources = [...new Set([image, direct].filter(Boolean))];
    return '<span class="ug-picker-art ug-collection-art">' +
        (sources.length ? '<img src="' + ugText(sources.shift()) +
            '" data-gift-fallback="' + ugText(JSON.stringify(sources)) +
            '" onerror="nextGiftPicture(this)" alt="' + ugText(collection.name) +
            '" loading="lazy" decoding="async">' :
            '<span class="ug-collection-fallback">◇</span>') +
        '</span>';
}
function ugInvalidate() {
    upgradeUI.nonce++;
    upgradeUI.quote = null;
    upgradeUI.quoteError = '';
    upgradeUI.pendingRequestId = '';
}
async function enterUpgrade(main) {
    ugInvalidate();
    const ticket = upgradeUI.nonce;
    upgradeUI.spinning = false;
    upgradeUI.giftId = '';
    upgradeUI.stakeValue = null;
    upgradeUI.lotId = '';
    upgradeUI.selectedLot = null;
    upgradeUI.collection = '';
    upgradeUI.collectionName = '';
    upgradeUI.lots = [];
    upgradeUI.hasMore = false;
    main.innerHTML = crafterLoading('upgrade');
    try {
        const [info, collections, inventory, testInventory] = await Promise.all([
            api('upgrade/info'), api('upgrade/collections'), api('inventory'),
            api('upgrade/test-inventory')
        ]);
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        upgradeUI.info = info;
        upgradeUI.collections = collections.collections || [];
        upgradeUI.inventory = [
            ...(inventory.gifts || []).filter(gift => gift.status === 'unlisted' && !gift.catalog_only),
            ...((info.test_mode && testInventory.gifts) || []).filter(gift => gift.status === 'unlisted'),
        ];
        ugRender();
    } catch (error) {
        if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce) return;
        main.innerHTML = '<div class="ug-load-error"><p>' + ugText(error.message) +
            '</p><button type="button" onclick="go(\'upgrade\')">Повторить</button></div>';
    }
}
function ugRender() {
    if (state.page !== 'upgrade') return;
    const root = document.getElementById('main');
    if (!root) return;
    const stake = ugCurrentGift();
    const lot = upgradeUI.selectedLot;
    const stakePrice = stake ? ugMoney(upgradeUI.stakeValue ?? stake.price) + ' GRAM' : '';
    const quote = upgradeUI.quote;
    const winAngle = quote ? Math.min(342, Number(quote.chance) * 3.6) : 0;
    // Winter currency and GRAM remain in Crafter's existing header.
    root.innerHTML = '<section class="ug-screen">' +
        '<div class="ug-wheel-region">' +
        '<div class="ug-wheel" id="ug-wheel" style="--ug-win-angle:' + winAngle + 'deg">' +
        '<span class="ug-wheel-pointer" aria-hidden="true"></span>' +
        '<div class="ug-wheel-rotor" id="ug-wheel-rotor" aria-hidden="true">' +
        '<div class="ug-wheel-sectors"></div></div>' +
        '<div class="ug-wheel-center"><small>ШАНС ВЫИГРЫША</small>' +
        '<b id="ug-chance">' + (quote ? ugMoney(quote.chance) : '0') + '%</b>' +
        '<span aria-hidden="true">✦</span></div></div>' +
        '<div class="ug-wheel-caption">Шанс улучшения</div></div>' +
        '<div class="ug-selection-row">' +
        '<button type="button" class="ug-slot' + (stake ? ' ug-filled' : '') +
        '" onclick="ugOpenStakePicker()" aria-label="Выбрать подарок для ставки">' +
        '<span class="ug-slot-title">Ваша ставка</span>' +
        ugArtFrame(stake, 'ug-slot-art') +
        '<strong>' + (stake ? ugText(stake.name) : 'Выберите подарок') + '</strong>' +
        '<small>' + (stake ? '№' + ugText(stake.number || '—') : 'Из инвентаря') + '</small>' +
        '<span class="ug-slot-price">' + (stake ? stakePrice : 'Выбрать ставку') + '</span>' +
        '<span class="ug-slot-bottom">' + (stake ? 'Изменить ↗' : 'Выбрать +') + '</span></button>' +
        '<button type="button" class="ug-slot' + (lot ? ' ug-filled' : '') +
        '" onclick="ugOpenTargetPicker()" aria-label="Выбрать целевой подарок">' +
        '<span class="ug-slot-title">Целевой подарок</span>' +
        ugArtFrame(lot, 'ug-slot-art ug-target-art') +
        '<strong>' + (lot ? ugText(lot.name) : 'Выберите цель') + '</strong>' +
        '<small>' + (lot ? '№' + ugText(lot.number || '—') : 'Из Craft Market') + '</small>' +
        '<span class="ug-slot-price">' + (lot ? ugMoney(lot.price) + ' GRAM' : 'Выбрать цель') + '</span>' +
        '<span class="ug-slot-bottom">' + (lot ? 'Изменить ↗' : 'Выбрать +') + '</span></button>' +
        '</div>' +
        '<button type="button" id="ug-submit" class="ug-upgrade-button"' +
        ' onclick="ugPlay()" disabled>Улучшить <span aria-hidden="true">↗</span></button>' +
        '<p id="ug-status" class="ug-status" aria-live="polite"></p>' +
        (upgradeUI.info?.is_admin && !upgradeUI.info?.test_mode ?
            '<button type="button" class="ug-bank-link" onclick="ugOpenBankFund()">Банк сайта: ' +
            ugMoney(upgradeUI.info.bank_balance || 0) + ' GRAM · Пополнить</button>' : '') +
        '</section>';
    ugUpdate();
}
function ugUpdate() {
    if (state.page !== 'upgrade') return;
    const quote = upgradeUI.quote;
    const button = document.getElementById('ug-submit');
    const label = document.getElementById('ug-status');
    const chance = document.getElementById('ug-chance');
    const wheel = document.getElementById('ug-wheel');
    if (wheel) {
        const angle = quote ? Math.min(342, Math.max(0, Number(quote.chance) * 3.6)) : 0;
        wheel.style.setProperty('--ug-win-angle', angle + 'deg');
        wheel.setAttribute('aria-label', 'Шанс выигрыша ' + (quote ? quote.chance : 0) + '%');
    }
    if (chance) chance.textContent = (quote ? ugMoney(quote.chance) : '0') + '%';
    const ready = Boolean(quote && quote.playable && upgradeUI.info?.enabled && !upgradeUI.spinning);
    if (button) {
        button.disabled = !ready;
        button.classList.toggle('ug-ready', ready);
    }
    if (label) {
        label.textContent = upgradeUI.quoteError ||
            (!ugCurrentGift() ? 'Выберите подарок для ставки.' :
            upgradeUI.stakeValue == null ? 'Определяем стоимость подарка…' :
            !upgradeUI.selectedLot ? 'Выберите цель дороже вашей ставки.' :
            !upgradeUI.info?.enabled ? 'Временно недоступен банк выкупа.' :
            quote && !quote.playable ? 'Банк не покрывает стоимость выбранного лота.' :
            !quote ? 'Рассчитываем шанс…' :
            upgradeUI.info?.test_mode ? 'Демо · без списания GRAM и реальных NFT' :
            'Результат определяется сервером; при проигрыше ставка сгорает.');
    }
}
async function ugEnsureStakeValue() {
    const giftId = upgradeUI.giftId;
    if (!giftId) throw new Error('Выберите подарок для ставки');
    if (upgradeUI.stakeValue != null) return upgradeUI.stakeValue;
    const ticket = upgradeUI.nonce;
    const response = await api('upgrade/stake-value?gift_id=' + encodeURIComponent(giftId));
    if (state.page !== 'upgrade' || ticket !== upgradeUI.nonce ||
        upgradeUI.giftId !== giftId) return null;
    upgradeUI.stakeValue = Number(response.amount);
    return upgradeUI.stakeValue;
}
async function ugSelectStake(id) {
    if (upgradeUI.spinning) return;
    const gift = upgradeUI.inventory.find(item => String(item.id) === String(id));
    if (!gift) return;
    upgradeUI.giftId = String(id);
    upgradeUI.stakeValue = null;
    ugInvalidate();
    closeSheet();
    ugRender();
    const ticket = upgradeUI.nonce;
    try {
        const amount = await ugEnsureStakeValue();
        if (ticket !== upgradeUI.nonce || amount == null) return;
        if (upgradeUI.selectedLot && Number(upgradeUI.selectedLot.price) <= amount) {
            upgradeUI.lotId = '';
            upgradeUI.selectedLot = null;
            upgradeUI.collection = '';
            upgradeUI.lots = [];
            toast('Выберите цель дороже новой ставки');
        }
        ugRender();
        ugRefreshQuote();
    } catch (error) {
        if (ticket !== upgradeUI.nonce) return;
        upgradeUI.quoteError = error.message;
        ugUpdate();
    }
}
function ugSelectLot(id) {
    if (upgradeUI.spinning) return;
    const lot = upgradeUI.lots.find(item => String(item.id) === String(id));
    if (!lot) return;
    if (upgradeUI.stakeValue == null || Number(lot.price) <= upgradeUI.stakeValue) {
        toast('Цена цели должна быть выше стоимости ставки');
        return;
    }
    upgradeUI.lotId = String(id);
    upgradeUI.selectedLot = lot;
    ugInvalidate();
    closeSheet();
    ugRender();
    ugRefreshQuote();
}
async function ugRefreshQuote() {
    if (!upgradeUI.giftId || !upgradeUI.lotId || upgradeUI.spinning) {
        ugUpdate();
        return;
    }
    const ticket = ++upgradeUI.nonce;
    upgradeUI.quote = null;
    upgradeUI.quoteError = '';
    ugUpdate();
    try {
        const quote = await api('upgrade/quote', {
            stake_mode: 'gift', gift_id: upgradeUI.giftId, lot_id: upgradeUI.lotId
        });
        if (ticket !== upgradeUI.nonce || state.page !== 'upgrade') return;
        upgradeUI.quote = quote;
        upgradeUI.quoteError = '';
    } catch (error) {
        if (ticket !== upgradeUI.nonce || state.page !== 'upgrade') return;
        upgradeUI.quoteError = error.message;
    }
    ugUpdate();
}
function ugOpenStakePicker() {
    if (upgradeUI.spinning) return;
    const inventory = upgradeUI.inventory;
    const cards = inventory.map(gift =>
        '<button type="button" class="ug-picker-item' +
        (upgradeUI.giftId === String(gift.id) ? ' selected' : '') +
        '" onclick="ugSelectStake(' + arg(gift.id) + ')">' +
        ugArtFrame(gift, 'ug-picker-art ug-stake-art') +
        '<strong>' + ugText(gift.name) + '</strong><small>#' + ugText(gift.number || '—') +
        (gift.test_only ? ' · Тестовый подарок' : '') +
        '</small><span>' + ugMoney(gift.price) + ' ' +
        ugText(gift.price_unit || 'GRAM') + '</span></button>'
    ).join('');
    ugShowPicker('Выберите подарок', '<div class="ug-picker-intro">Выберите один подарок из вашего инвентаря для ставки.</div>' +
        '<div class="ug-picker-grid">' + (cards ||
        '<div class="ug-picker-empty">Нет доступных подарков. Подарки на продаже нельзя использовать для Upgrade.</div>') +
        '</div>');
}
function ugShowPicker(title, html) {
    sheet(title, '<div class="ug-picker-root">' + html + '</div>');
    appSheet.classList.add('ug-picker-sheet');
}
function ugOpenTargetPicker() {
    if (upgradeUI.spinning) return;
    upgradeUI.pickerStep = 'collections';
    upgradeUI.collectionFilter = '';
    ugShowPicker('Выберите коллекцию', '<div id="ug-picker-content"></div>');
    ugRenderCollections();
}
function ugFilterCollections(value) {
    upgradeUI.collectionFilter = String(value || '');
    const area = document.getElementById('ug-collection-results');
    if (area) area.innerHTML = ugCollectionCards();
}
function ugCollectionCards() {
    const term = upgradeUI.collectionFilter.trim().toLocaleLowerCase();
    const filtered = upgradeUI.collections.filter(item =>
        String(item.name || '').toLocaleLowerCase().includes(term));
    if (!filtered.length) {
        return '<div class="ug-picker-empty">В Craft Market нет подходящих активных коллекций.</div>';
    }
    return filtered.map(collection =>
        '<button type="button" class="ug-picker-item ug-collection-item" onclick="ugChooseCollection(' +
        arg(collection.key) + ')">' +
        ugCollectionArt(collection) +
        '<strong>' + ugText(collection.name) + '</strong>' +
        '<small>От ' + ugMoney(collection.floor) + ' GRAM</small>' +
        '<span>' + ugText(collection.count) + ' лотов</span></button>'
    ).join('');
}
function ugRenderCollections() {
    const content = document.getElementById('ug-picker-content');
    if (!content) return;
    content.innerHTML = '<div class="ug-picker-intro">Выберите коллекцию подарка</div>' +
        '<label class="ug-picker-search"><span>⌕</span><input type="search" placeholder="Поиск коллекции" ' +
        'aria-label="Поиск коллекции" value="' + ugText(upgradeUI.collectionFilter) +
        '" oninput="ugFilterCollections(this.value)"></label>' +
        '<div class="ug-picker-grid ug-collection-grid" id="ug-collection-results">' +
        ugCollectionCards() + '</div>';
}
async function ugChooseCollection(key) {
    if (upgradeUI.spinning) return;
    const chosen = upgradeUI.collections.find(item => item.key === key);
    if (!chosen) return;
    upgradeUI.collection = key;
    upgradeUI.collectionName = chosen.name;
    upgradeUI.lots = [];
    upgradeUI.hasMore = false;
    upgradeUI.pickerStep = 'lots';
    upgradeUI.loading = true;
    ugRenderLots();
    const ticket = ++upgradeUI.modalNonce;
    try {
        const result = await api('upgrade/lots?collection=' + encodeURIComponent(key));
        if (ticket !== upgradeUI.modalNonce || state.page !== 'upgrade' ||
            !appSheet.open || upgradeUI.pickerStep !== 'lots') return;
        upgradeUI.lots = result.lots || [];
        upgradeUI.hasMore = Boolean(result.has_more);
    } catch (error) {
        if (ticket !== upgradeUI.modalNonce || state.page !== 'upgrade') return;
        upgradeUI.quoteError = error.message;
        toast(error.message);
    } finally {
        if (ticket === upgradeUI.modalNonce) {
            upgradeUI.loading = false;
            ugRenderLots();
        }
    }
}
function ugRenderLots() {
    const title = document.getElementById('sheet-title');
    if (title) title.textContent = 'Выберите лот';
    const content = document.getElementById('ug-picker-content');
    if (!content) return;
    const cards = upgradeUI.lots.map(lot =>
        '<button type="button" class="ug-picker-item ug-lot-item' +
        (upgradeUI.lotId === lot.id ? ' selected' : '') +
        '" onclick="ugSelectLot(' + arg(lot.id) + ')">' +
        ugArtFrame(lot, 'ug-picker-art ug-lot-art') +
        '<strong>' + ugText(lot.name) + '</strong>' +
        '<small>#' + ugText(lot.number || '—') + (lot.model ? ' · ' + ugText(lot.model) : '') + '</small>' +
        '<span>' + ugMoney(lot.price) + ' GRAM</span></button>'
    ).join('');
    content.innerHTML = '<div class="ug-lots-top"><button type="button" onclick="ugBackToCollections()">‹ Коллекции</button>' +
        '<strong>' + ugText(upgradeUI.collectionName) + '</strong></div>' +
        '<div class="ug-picker-intro">Выберите конкретный лот Craft Market</div>' +
        '<div class="ug-picker-grid">' +
        (cards || '<div class="ug-picker-empty">' + (upgradeUI.loading ?
        'Загрузка лотов...' : 'В этой коллекции нет доступных лотов.') + '</div>') + '</div>' +
        (upgradeUI.hasMore ? '<button type="button" class="ug-picker-more" onclick="ugLoadMore()">Показать ещё</button>' : '');
}
function ugBackToCollections() {
    const title = document.getElementById('sheet-title');
    if (title) title.textContent = 'Выберите коллекцию';
    upgradeUI.modalNonce++;
    upgradeUI.pickerStep = 'collections';
    upgradeUI.loading = false;
    ugRenderCollections();
}
async function ugLoadMore() {
    if (!upgradeUI.hasMore || upgradeUI.loading) return;
    upgradeUI.loading = true;
    const ticket = ++upgradeUI.modalNonce;
    const key = upgradeUI.collection;
    try {
        const result = await api('upgrade/lots?collection=' + encodeURIComponent(key) +
            '&offset=' + upgradeUI.lots.length);
        if (ticket !== upgradeUI.modalNonce || !appSheet.open || upgradeUI.pickerStep !== 'lots') return;
        upgradeUI.lots.push(...(result.lots || []));
        upgradeUI.hasMore = Boolean(result.has_more);
    } catch (error) {
        if (ticket === upgradeUI.modalNonce) toast(error.message);
    } finally {
        if (ticket === upgradeUI.modalNonce) {
            upgradeUI.loading = false;
            ugRenderLots();
        }
    }
}
function ugOpenBankFund() {
    if (!upgradeUI.info?.is_admin || upgradeUI.info.test_mode || upgradeUI.spinning) return;
    const available = ugMoney(upgradeUI.info.balance || 0);
    sheet('Банк Upgrade', '<div class="ug-bank-modal">' +
        '<p>Реальные выигрыши выкупаются за GRAM из банка сайта. Пополнение переводит ваши GRAM ' +
        'во внутренний банк; это настоящая операция, а не бесплатное начисление.</p>' +
        '<p>Ваш баланс: <b>' + available + ' GRAM</b> · Банк: <b>' +
        ugMoney(upgradeUI.info.bank_balance || 0) + ' GRAM</b></p>' +
        '<label for="ug-bank-amount">Сумма пополнения, GRAM</label>' +
        '<input id="ug-bank-amount" type="text" inputmode="decimal" autocomplete="off" ' +
        'placeholder="Например, 150.00">' +
        '<button id="ug-bank-confirm" type="button" onclick="ugFundBank()">Пополнить банк</button>' +
        '<small>Вы можете пополнять банк только со своего подтверждённого баланса.</small></div>');
}
async function ugFundBank() {
    if (!upgradeUI.info?.is_admin) return;
    const input = document.getElementById('ug-bank-amount');
    const button = document.getElementById('ug-bank-confirm');
    if (!input || !button || button.disabled) return;
    const amount = input.value.trim().replace(',', '.');
    if (!/^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(amount) || Number(amount) <= 0) {
        toast('Введите сумму GRAM с точностью до сотых');
        return;
    }
    if (Number(amount) > Number(upgradeUI.info.balance || 0)) {
        toast('Недостаточно GRAM на вашем балансе');
        return;
    }
    button.disabled = true;
    button.textContent = 'Подтверждаем перевод…';
    try {
        await api('upgrade/bank/fund', {amount, request_id: ugNewRequestId()});
        const info = await api('upgrade/info');
        upgradeUI.info = info;
        closeSheet();
        ugRender();
        ugRefreshQuote();
        if (typeof refreshMe === 'function') refreshMe().catch(() => {});
        toast('Банк Upgrade пополнен');
    } catch (error) {
        toast(error.message);
        button.disabled = false;
        button.textContent = 'Пополнить банк';
    }
}
function ugRules() {
    sheet('Upgrade — правила', '<div class="ug-rules">' +
        '<p>1. Выберите один доступный подарок из инвентаря. Затем выберите коллекцию и точный лот Craft Market.</p>' +
        '<p>2. Шанс равен оценке ставки, делённой на цену цели (максимум 95%). Оценку подтверждает сервер.</p>' +
        '<p>3. При выигрыше сайт оплачивает выбранный лот из своего банка, продавец получает оплату, ' +
        'а подарок переходит в ваш инвентарь. Ваш исходный подарок поступает в банк сайта.</p>' +
        '<p>4. При проигрыше исходный подарок также поступает в банк сайта, целевой подарок не выдается.</p>' +
        '<p>Покупка возможна только при наличии средств у банка сайта. ' +
        'Участие с неподтвержденным финансированием отключено.</p></div>');
}
function ugNewRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return 'upgrade-' + crypto.randomUUID();
    }
    return 'upgrade-' + Date.now() + '-' + Math.random().toString(36).slice(2, 14);
}
async function ugPlay() {
    if (upgradeUI.spinning || !upgradeUI.quote || !upgradeUI.quote.playable || !upgradeUI.info?.enabled) return;
    const btn = document.getElementById('ug-submit');
    upgradeUI.spinning = true;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Upgrade...';
    }
    if (!upgradeUI.pendingRequestId) upgradeUI.pendingRequestId = ugNewRequestId();
    let result;
    try {
        result = await api('upgrade/play', {
            request_id: upgradeUI.pendingRequestId,
            quote_id: upgradeUI.quote.quote_id
        });
    } catch (error) {
        upgradeUI.spinning = false;
        upgradeUI.quoteError = error.message;
        if (btn) {
            btn.textContent = 'Повторить Upgrade';
            btn.disabled = false;
        }
        ugUpdate();
        toast(error.message);
        return;
    }
    const needle = document.getElementById('ug-needle');
    if (needle) needle.style.transform = 'rotate(' +
        (2160 + Number(result.roll_bps || 0) / 10000 * 360) + 'deg)';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await new Promise(resolve => setTimeout(resolve, reduced ? 80 : 4300));
    if (state.page !== 'upgrade') return;
    const prize = result.gift || {};
    const successful = Boolean(result.success);
    const simulated = Boolean(result.test_mode);
    sheet(simulated ? (successful ? 'Тестовый выигрыш ✦' : 'Тестовый проигрыш') :
        (successful ? 'Upgrade successful ✦' : 'Upgrade failed'),
        '<div class="ug-outcome ' + (successful ? 'ug-win' : 'ug-loss') + '">' +
        (successful ? ugArtFrame(prize, 'ug-outcome-art') : '<div class="ug-outcome-symbol">✕</div>') +
        '<h2>' + (successful ? 'Улучшение успешно!' : 'Улучшение не удалось') + '</h2>' +
        '<p>' + (successful ?
            (simulated ? 'Тестовый приз добавлен в инвентарь Upgrade: ' :
                'Вы получили ') + ugText(prize.name || 'подарок') +
            (prize.number ? ' #' + ugText(prize.number) : '') + '.' :
            (simulated ? 'Проигрыш только в тесте. Ваш настоящий подарок остался в инвентаре.' :
                'Ваш подарок отправлен в банк сайта.')) + '</p>' +
        '<button type="button" class="ug-modal-cta" onclick="closeSheet();go(\'upgrade\')">Играть снова</button></div>');
    upgradeUI.spinning = false;
    upgradeUI.quote = null;
    upgradeUI.pendingRequestId = '';
    try {
        const [info, collections, inventory, testInventory] = await Promise.all([
            api('upgrade/info'), api('upgrade/collections'), api('inventory'),
            api('upgrade/test-inventory')
        ]);
        if (state.page !== 'upgrade') return;
        upgradeUI.info = info;
        upgradeUI.collections = collections.collections || [];
        upgradeUI.inventory = [
            ...(inventory.gifts || []).filter(item => item.status === 'unlisted' && !item.catalog_only),
            ...((info.test_mode && testInventory.gifts) || []).filter(item => item.status === 'unlisted')
        ];
        upgradeUI.giftId = '';
        upgradeUI.stakeValue = null;
        upgradeUI.lotId = '';
        upgradeUI.selectedLot = null;
        upgradeUI.lots = [];
        upgradeUI.quoteError = '';
        ugRender();
        if (typeof refreshMe === 'function') refreshMe().catch(() => {});
    } catch (_) {
        if (state.page === 'upgrade') ugRender();
    }
}
appSheet.addEventListener('close', () => {
    appSheet.classList.remove('ug-picker-sheet');
    upgradeUI.modalNonce++;
});
