let tonUI, tonLibrary, tonInitialization;
let walletLinkQueue = Promise.resolve();
let walletChanging = false;
let walletView = 0;
let walletBalanceRequest = 0;
let walletHistoryRequest = 0;
let walletHistoryItems = [];
let walletHistoryCursor;
const walletHistoryFiltersState = {};
const walletGroups = {
    balance: {label:'Баланс', kinds:['deposit','withdraw_funds','balance_adjustment','stake_claim','event_award_paid','arena_stake','arena_refund','arena_result','arena_bot_fund']},
    gifts: {label:'Подарки', kinds:['buy','sale','sell','listing_price','unlist','withdraw','transfer','craft','gift_granted','gift_received','gift_withdraw_requested','gift_withdraw_failed']},
    offers: {label:'Офферы', kinds:['offer_received','offer_created','offer_cancelled','offer_withdrawn','offer_accepted']},
};
const walletEventNames = {
    deposit:'Пополнение', withdraw_funds:'Вывод', balance_adjustment:'Корректировка баланса', stake_claim:'Награда стейкинга', event_award_paid:'Покупка приза лидерборда',
    arena_stake:'Ставка Arena', arena_refund:'Возврат ставки Arena', arena_result:'Результат Arena', arena_bot_fund:'Пополнение банка бота Arena',
    buy:'Покупка подарка', sale:'Продажа подарка', sell:'Выставление на продажу', listing_price:'Изменение цены',
    unlist:'Снятие с продажи', withdraw:'Вывод подарка', gift_withdraw_requested:'Заявка на вывод NFT',
    gift_withdraw_failed:'Вывод NFT не выполнен', transfer:'Отправка подарка',
    gift_granted:'Получен подарок', gift_received:'Подарок получен', craft:'Крафт', offer_received:'Получен оффер',
    offer_created:'Оффер создан', offer_cancelled:'Оффер отменён', offer_withdrawn:'Оффер отозван', offer_accepted:'Оффер принят',
};
const walletStatuses = {
    pending:'Ожидает подтверждения', confirmed:'Подтверждено', queued:'В очереди', processing:'Обрабатывается',
    cancelled:'Отменено',
};
const walletPages = ['wallet', 'deposit', 'withdraw'];

function loadTonUI() {
    if (window.TON_CONNECT_UI) return Promise.resolve(window.TON_CONNECT_UI);
    if (!tonLibrary) {
        tonLibrary = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@tonconnect/ui@5.0.1/dist/tonconnect-ui.min.js';
            script.onload = () => window.TON_CONNECT_UI ? resolve(window.TON_CONNECT_UI) : reject(Error('TON Connect недоступен'));
            script.onerror = () => reject(Error('Не удалось загрузить TON Connect'));
            document.head.appendChild(script);
        }).catch(error => {
            tonLibrary = null;
            throw error;
        });
    }
    return tonLibrary;
}

function walletAccount(connection) {
    const account = connection?.wallet?.account || connection?.account;
    if (!account) return null;
    const network = {'-239':'mainnet', '-3':'testnet'}[String(account.chain)];
    return {address:account.address, network};
}

function sameWallet(a, b) {
    return !!a && !!b && a.address === b.address && a.network === b.network;
}

async function verifyTonManifest(manifestUrl) {
    // Wallets retrieve the manifest without the Telegram session. Check the
    // same public JSON and icon before opening the wallet chooser.
    const url = new URL(manifestUrl);
    if (url.protocol !== 'https:') {
        throw Error('TON Connect: манифест должен быть доступен через HTTPS');
    }
    let response;
    try {
        response = await fetch(url.href, {cache:'no-store',credentials:'omit'});
    } catch {
        throw Error('TON Connect: манифест недоступен. Проверьте соединение.');
    }
    if (!response.ok) throw Error('TON Connect: ошибка загрузки манифеста (' + response.status + ')');
    let manifest;
    try { manifest=await response.json(); }
    catch { throw Error('TON Connect: сервер вернул некорректный манифест'); }
    if (!manifest || !manifest.name || !manifest.url || !manifest.iconUrl) {
        throw Error('TON Connect: в манифесте не хватает данных приложения');
    }
    try {
        const homepage=new URL(manifest.url), icon=new URL(manifest.iconUrl);
        if (homepage.origin !== url.origin || icon.origin !== url.origin ||
            icon.protocol !== 'https:' || !icon.pathname.toLowerCase().endsWith('.png')) {
            throw Error('manifest fields');
        }
        const image=await fetch(icon.href,{method:'HEAD',cache:'no-store',credentials:'omit'});
        if (!image.ok) throw Error('icon missing');
    } catch {
        throw Error('TON Connect: иконка или адрес приложения в манифесте недоступны');
    }
    return manifest;
}

async function walletSDK() {
    if (!tonInitialization) {
        tonInitialization = (async () => {
            const info = state.walletInfo || await api('wallet');
            if (!info.manifest_url) throw Error('Подключение кошелька доступно в Crafter');
            await verifyTonManifest(info.manifest_url);
            const lib = await loadTonUI();
            const ui = new lib.TonConnectUI({manifestUrl:info.manifest_url, uiPreferences:{theme:'DARK'}});
            await ui.connectionRestored;
            tonUI = ui;
            let previous = walletAccount(ui);
            ui.onStatusChange(wallet => {
                const before = previous;
                previous = walletAccount(wallet);
                if (walletChanging) return;
                const next = previous;
                walletLinkQueue = walletLinkQueue.then(async () => {
                    const info = await api('wallet');
                    if (next) {
                        if (next.network !== info.config.network) {
                            throw Error('Выберите кошелёк сети ' + walletNetworkName(info.config.network));
                        }
                        if (!sameWallet(info.connected, next)) await api('wallet/connect', next);
                    } else if (sameWallet(info.connected, before)) {
                        await api('wallet/disconnect', {address:before.address, network:before.network});
                    }
                    await refreshWalletView();
                }).catch(error => {
                    walletError(error);
                    if (state.page === 'deposit') walletAmountChanged();
                });
            });
            if (state.page === 'deposit') walletAmountChanged();
            return ui;
        })().catch(error => {
            tonInitialization = null;
            throw error;
        });
    }
    return tonInitialization;
}

function walletNetworkName(network) {
    return network === 'testnet' ? 'Testnet' : 'Mainnet';
}

function shortWallet(address) {
    return address ? address.slice(0, 6) + '…' + address.slice(-5) : 'Не подключён';
}

function nativeWalletAmount(value) {
    return Number(value).toLocaleString('ru-RU', {maximumFractionDigits:9}) + ' TON';
}

function externalWalletText(connected) {
    const balance = state.externalWalletBalance;
    if (!sameWallet(balance, connected)) return 'Загрузка…';
    if (balance.unavailable) return 'Баланс недоступен';
    return nativeWalletAmount(balance.balance_ton);
}

function renderExternalWalletBalance() {
    const connected = state.walletInfo?.connected;
    if (!connected) return;
    const value = externalWalletText(connected);
    document.querySelectorAll('[data-external-wallet-balance]').forEach(el => { el.textContent = value; });
    if (state.page === 'deposit') walletAmountChanged();
}

async function refreshExternalWalletBalance() {
    const request = ++walletBalanceRequest;
    const connected = state.walletInfo?.connected;
    if (!connected) {
        state.externalWalletBalance = null;
        return;
    }
    let balance;
    try {
        balance = await api('wallet/balance');
        if (!sameWallet(connected, balance)) return;
    } catch {
        balance = {...connected, unavailable:true};
    }
    if (request !== walletBalanceRequest || !sameWallet(connected, state.walletInfo?.connected)) return;
    state.externalWalletBalance = balance;
    renderExternalWalletBalance();
}

async function connectTonWallet() {
    if (walletChanging) return;
    try {
        const ui = await walletSDK();
        if (ui.connected) {
            const account = walletAccount(ui);
            const info = state.walletInfo || await api('wallet');
            if (account?.network === info.config.network) {
                await api('wallet/connect', account);
                await refreshWalletView();
                return;
            }
            await disconnectTon(true);
            return;
        }
        await ui.openModal();
    } catch (error) {
        walletError(error);
    }
}

function openWalletDetails() {
    const wallet = state.walletInfo?.connected;
    if (!wallet) {
        connectTonWallet();
        return;
    }
    sheet('Ваш кошелёк', `
        <div class="wallet-details">
            <span>Баланс · ${walletNetworkName(wallet.network)}</span>
            <strong data-external-wallet-balance>${esc(externalWalletText(wallet))}</strong>
            <button class="wallet-detail-address" onclick="copyWalletAddress()">
                <span>Адрес</span><b>${esc(wallet.display_address || wallet.address)}</b><small>Копировать</small>
            </button>
            <button class="primary" onclick="disconnectTon(true)">Переподключить</button>
            <button class="secondary wallet-unlink" onclick="disconnectTon()">Отвязать кошелёк</button>
        </div>`);
    if (!sameWallet(wallet, state.externalWalletBalance) || state.externalWalletBalance.unavailable) {
        refreshExternalWalletBalance();
    }
}

async function copyWalletAddress() {
    const wallet = state.walletInfo?.connected;
    if (!wallet) return;
    try {
        await navigator.clipboard.writeText(wallet.display_address || wallet.address);
        toast('Адрес скопирован');
    } catch {
        toast('Не удалось скопировать адрес');
    }
}

async function disconnectTon(reconnect = false) {
    if (walletChanging || state.walletBusy) return;
    walletChanging = true;
    try {
        await walletLinkQueue;
        const linked = state.walletInfo?.connected;
        const ui = reconnect ? await walletSDK() : tonUI;
        if (ui?.connected) await ui.disconnect();
        await api('wallet/disconnect', linked ? {address:linked.address, network:linked.network} : {});
        state.externalWalletBalance = null;
        await refreshWalletView();
        if (reconnect) {
            // Let the native app sheet close before opening the TON Connect picker.
            closeSheet();
            await new Promise(resolve => setTimeout(resolve, 190));
            walletChanging = false;
            await ui.openModal();
        } else {
            closeSheet();
            toast('Кошелёк отвязан');
        }
    } catch (error) {
        walletError(error);
    } finally {
        walletChanging = false;
    }
}

function walletIdentity(w) {
    const linked = w.connected;
    const name = linked ? shortWallet(linked.display_address || linked.address) : 'Подключить кошелёк';
    return `<button type="button" class="wallet-connected ${linked ? '' : 'wallet-connect-cta'}" onclick="openWalletDetails()" aria-label="${linked ? 'Открыть данные кошелька' : name}">
        <span class="wallet-identity">
            <span class="wallet-identity-icon">${icon('wallet')}</span>
            <span><small>${linked ? 'Подключённый кошелёк' : 'TON Connect'}</small><b>${esc(name)}</b></span>
        </span>
        <span class="wallet-identity-end">
            ${linked ? `<span class="wallet-external-pill" data-external-wallet-balance>${esc(externalWalletText(linked))}</span>` : `<span class="wallet-network">${walletNetworkName(w.config.network)}</span>`}
            ${icon('walletChevron')}
        </span>
    </button>`;
}

Object.assign(paths, {
    wallet:'M20 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2M3 7h15m2 2h-5a3 3 0 0 0 0 6h5a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1zm-5 3h.01',
    walletChevron:'m9 6 6 6-6 6',
    walletAdd:'M12 5v14M5 12h14',
    walletUp:'M12 20V4m-6 6 6-6 6 6',
    walletDown:'M12 4v16m-6-6 6 6 6-6',
});

async function refreshWalletView() {
    if (state.page === 'wallet') await renderWallet();
    else if (walletPages.includes(state.page)) await renderWalletAmount(state.page);
}

async function loadWalletView(page) {
    const view = ++walletView;
    const info = await api('wallet');
    if (state.page !== page || view !== walletView) return null;
    state.walletInfo = info;
    return info;
}

async function renderWallet() {
    const w = await loadWalletView('wallet');
    if (!w) return;
    document.querySelector('#main').innerHTML = `<div class="wallet-glass-summary">${walletIdentity(w)}
        <section class="wallet-balance-card"><span>Баланс кошелька Crafter</span>
            <h1>${money(w.balance)} <em>GRAM</em></h1>
            <div class="wallet-balance-actions"><button onclick="go('deposit')">${icon('walletAdd')}<span>Пополнить</span></button><button onclick="go('withdraw')">${icon('walletUp')}<span>Вывод</span></button></div>
        </section></div>
        <div class="wallet-history-filters">
            <button class="circle" aria-label="Сбросить фильтры" onclick="resetWalletHistoryFilters()">${icon('filter')}</button>
            ${Object.entries(walletGroups).map(([key, group]) => `<button data-wallet-filter="${key}" onclick="walletHistoryFilters('${key}')">${group.label}${icon('chevron')}</button>`).join('')}
        </div>
        <div class="wallet-history-title"><h2>История</h2></div>
        <div id="wallet-history" aria-live="polite"></div>`;
    loadWalletHistory();
    walletSDK().catch(() => {});
    refreshExternalWalletBalance();
}

function walletHistoryFilters(groupKey) {
    const group = walletGroups[groupKey];
    const selected = walletHistoryFiltersState[groupKey] || [];
    sheet(group.label, `
        <div class="wallet-filter-options">${group.kinds.map(kind =>
            `<label><input type="checkbox" value="${kind}" ${selected.includes(kind)?'checked':''}>${walletEventNames[kind]}</label>`
        ).join('')}</div>
        <div class="wallet-filter-actions">
            <button class="secondary" onclick="applyWalletHistoryFilters('${groupKey}', true)">Сбросить</button>
            <button class="primary" onclick="applyWalletHistoryFilters('${groupKey}')">Применить</button>
        </div>`);
    appSheet.classList.add('wallet-filter-sheet');
}

function applyWalletHistoryFilters(group, reset = false) {
    walletHistoryFiltersState[group] = reset ? [] : Array.from(
        document.querySelectorAll('#sheet-body .wallet-filter-options input:checked'), input => input.value);
    closeSheet();
    loadWalletHistory();
}

function resetWalletHistoryFilters() {
    Object.keys(walletGroups).forEach(group => { delete walletHistoryFiltersState[group]; });
    loadWalletHistory();
}

async function loadWalletHistory(append = false) {
    const list = document.querySelector('#wallet-history');
    if (!list || (append && !walletHistoryCursor)) return;
    const request = ++walletHistoryRequest;
    const types = Object.values(walletHistoryFiltersState).flat();
    const params = new URLSearchParams();
    if (types.length) params.set('types', types.join(','));
    if (append) {
        params.set('before', walletHistoryCursor);
        list.querySelector('.wallet-history-more').disabled = true;
    } else {
        walletHistoryItems = [];
        walletHistoryCursor = null;
        list.innerHTML = crafterLoading('wallet');
        document.querySelectorAll('[data-wallet-filter]').forEach(button => {
            button.classList.toggle('active', !!walletHistoryFiltersState[button.dataset.walletFilter]?.length);
        });
    }
    try {
        const data = await api('wallet/history?' + params);
        if (request !== walletHistoryRequest || !list.isConnected) return;
        walletHistoryItems.push(...data.items);
        walletHistoryCursor = data.next_cursor;
        renderWalletHistory(list);
    } catch (error) {
        if (request !== walletHistoryRequest || !list.isConnected) return;
        if (append) {
            list.querySelector('.wallet-history-more').disabled = false;
            toast(error.message);
        } else {
            list.innerHTML = `<div class="error">${esc(error.message)}</div><button class="secondary" onclick="loadWalletHistory()">Повторить</button>`;
        }
    }
}

function walletHistoryRow(item) {
    const {kind, data, status} = item;
    const gift = data.gift || data.gifts?.[0] || (kind === 'buy' ? data : null);
    // Sales credit net proceeds, purchases debit the actual paid price.
    // For listing and offer creation there is no additional wallet credit.
    const amount = Number(kind === 'buy' ? -(data.price ?? gift?.price) :
        kind === 'sale' ? data.proceeds :
        kind === 'withdraw_funds' ? -data.gram :
        kind === 'offer_cancelled' ? data.amount :
        kind === 'offer_created' ? -(data.amount || 0) : data.gram);
    const showAmount = Number.isFinite(amount) && amount !== 0;
    const cancelled = kind === 'withdraw_funds' && status === 'cancelled';
    const sender = data.sender;
    const recipient = data.recipient;
    const person = who => who?.username ? '@' + who.username :
        who?.name || (who ? 'Telegram user' : 'Anonymous');
    const title = kind === 'gift_received' ? 'Receive from ' + person(sender) :
        kind === 'transfer' ? 'Sent to ' + person(recipient) :
        gift?.name || walletEventNames[kind] || 'Операция';
    const time = new Date(item.created * 1000).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
    const activity = kind === 'craft' && data.mode === 'lucky' ? 'Lucky Craft' : walletEventNames[kind];
    const details = [
        gift && activity,
        kind === 'sale' && data.price != null && 'Продано за ' + money(data.price) + ' GRAM',
        kind === 'sale' && data.proceeds != null && 'После комиссии: ' + money(data.proceeds) + ' GRAM',
        data.gifts?.length > 1 && `${data.gifts.length} шт.`,
        kind === 'craft' && (data.success ? 'Успешно' : 'Не удалось'),
        kind === 'arena_result' && (data.success ? 'Победа' : 'Раунд завершён'),
        kind === 'arena_result' && Number(data.fee_gram) > 0 && 'Комиссия ' + money(data.fee_gram) + ' GRAM',
        walletStatuses[status], time].filter(Boolean).join(' · ');
    const balanceDetail = data.balance_after != null ? 'Баланс: ' + money(data.balance_after) + ' GRAM' : '';
    return `<div class="wallet-history-row">
        <span class="wallet-history-icon">${gift ? `<img ${giftPicture(gift)} alt="" loading="lazy">` :
            icon(kind === 'deposit' ? 'walletDown' : kind === 'withdraw_funds' ? 'walletUp' : kind === 'craft' ? 'craft' : 'gift')}</span>
        <div class="wallet-history-description"><b>${esc(title)}</b><small>${esc(details)}</small>
            ${kind === 'deposit' && status === 'pending' ? `<button class="wallet-check-deposit" onclick="checkDeposit(${arg(item.id)}, this)">Проверить перевод</button>` : ''}
            ${balanceDetail ? `<small class="wallet-history-balance">${esc(balanceDetail)}</small>` : ''}
            ${kind === 'withdraw_funds' && status === 'queued' ? `<button class="wallet-cancel-withdraw" onclick="cancelQueuedWithdrawal(${arg(item.id)}, this)">Отменить заявку</button>` : ''}
        </div>
        ${showAmount ? `<strong class="${cancelled ? 'wallet-cancelled-amount' : status === 'pending' ? 'pending' : amount > 0 ? 'positive' : 'negative'}">${cancelled ? '' : status === 'pending' ? '' : amount > 0 ? '+' : '−'}${money(Math.abs(amount))} GRAM</strong>` : ''}
    </div>`;
}

function renderWalletHistory(list) {
    const days = new Map();
    for (const item of walletHistoryItems) {
        const day = new Date(item.created * 1000).toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric'});
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(item);
    }
    list.innerHTML = days.size ? [...days].map(([day, items]) =>
        `<section class="wallet-history-day"><h3>${esc(day)}</h3>${items.map(walletHistoryRow).join('')}</section>`
    ).join('') : '<div class="inventory-empty"><h2>История пуста</h2></div>';
    if (walletHistoryCursor) list.insertAdjacentHTML('beforeend',
        '<button class="secondary wallet-history-more" onclick="loadWalletHistory(true)">Показать ещё</button>');
}

async function renderWalletAmount(kind) {
    const w = await loadWalletView(kind);
    if (!w) return;
    const value = document.querySelector('#wallet-amount')?.value || '';
    const c = w.config;
    const deposit = kind === 'deposit';
    const available = Math.max(0, Number(w.withdrawable) || 0);
    const dailyLeft = Math.max(0, Number(w.withdraw_daily_remaining) || 0);
    document.querySelector('#main').innerHTML = `<section class="wallet-funding">
        <button type="button" class="wallet-back" onclick="go('wallet')">${icon('walletChevron')} К кошельку</button>
        <h1 class="wallet-page-title">${deposit ? 'Пополнение' : 'Вывод'}</h1>
        ${deposit ? `<button type="button" class="wallet-deposit-connect" onclick="openWalletDetails()">${w.connected ? 'Кошелёк подключён · Изменить' : 'Подключить TON-кошелёк'}</button>` : walletIdentity(w)}
        <section class="wallet-amount-card">
            <label class="wallet-amount-label" for="wallet-amount">${deposit ? 'Сумма пополнения' : 'Сумма вывода'}</label>
            <div class="wallet-amount"><input id="wallet-amount" aria-label="Сумма в GRAM" placeholder="0" inputmode="decimal" type="text" pattern="[0-9]+([.,][0-9]{1,2})?" maxlength="16" autocomplete="off" spellcheck="false" value="${esc(value)}" oninput="walletAmountChanged()"><b>GRAM</b></div>
            ${deposit?`<div class="wallet-presets">${[10,50,100].map(n=>`<button onclick="setWalletAmount(${n})">${gramIcon()} ${n}</button>`).join('')}</div>`:
                `<button class="wallet-max" onclick="setWalletAmount(${Math.floor(Math.max(0, Math.min(available, Number(c.withdraw_max))) * 100) / 100})" ${available > 0 ? '' : 'disabled title="Нет доступного баланса GRAM"'}>Макс.</button>
                <div class="wallet-limits"><div>Лимит за операцию<b>${money(c.withdraw_max)} GRAM</b></div><div>Доступно к выводу<b>${money(available)} GRAM</b></div></div>
`}
            <p class="wallet-quote" id="wallet-quote" hidden></p>
            <button class="primary" id="wallet-submit" onclick="${deposit?'sendDeposit()':'requestWithdrawal()'}" disabled>${deposit ? 'Пополнить баланс' : 'Запросить вывод'}</button>
            <p class="wallet-error" id="wallet-error" role="status"></p>
        </section>
    </section>`;
    walletAmountChanged();
    if (w.manifest_url) walletSDK().catch(() => {});
    refreshExternalWalletBalance();
}

function normalizeWalletAmount(value) {
    // Telegram mobile keyboards use either comma or dot for decimals.
    return String(value ?? '').trim().replace(',', '.');
}

function walletAmountIsValid(value) {
    return /^[0-9]{1,10}(?:\.[0-9]{1,2})?$/.test(value) &&
        Number(value) > 0 && Number.isFinite(Number(value));
}

function setWalletAmount(value) {
    const input = document.querySelector('#wallet-amount');
    if (!input) return;
    input.value = Number(value).toFixed(2).replace(/\.00$/, '');
    walletAmountChanged();
}

function walletAmountChanged() {
    const input = document.querySelector('#wallet-amount');
    if (!input) return;
    // Keep the number's width fitted to its content so the full "0 GRAM"
    // phrase, not a padded input field, is centered in the card.
    const digitCount=Math.max(1,Math.min(input.maxLength||16,(input.value||'').trim().length));
    input.closest('.wallet-amount')?.style.setProperty('--wallet-amount-digits',String(digitCount));
    const w = state.walletInfo;
    const c = w.config;
    const normalized = normalizeWalletAmount(input.value);
    const n = Number(normalized);
    const deposit = state.page === 'deposit';
    const ton = n / Number(c.gram_per_ton);
    const active = c.enabled && c.receiver && (deposit || c.withdraw_enabled);
    const connected = w.connected?.network === c.network;
    const amountValid = walletAmountIsValid(normalized);
    const withinDepositLimits = ton >= Number(c.min_deposit) && ton <= Number(c.max_deposit);

    let issue = '';
    if (!active) issue = deposit ? 'Пополнение пока недоступно' : 'Вывод пока недоступен';
    else if (!connected) issue = 'Подключите кошелёк сети ' + walletNetworkName(c.network);
    else if (deposit && amountValid && !withinDepositLimits) issue = 'Допустимая сумма от ' + nativeWalletAmount(c.min_deposit) + ' до ' + nativeWalletAmount(c.max_deposit);
    else if (deposit && amountValid && sameWallet(w.connected, state.externalWalletBalance) &&
        ton > Number(state.externalWalletBalance.balance_ton)) issue = 'Недостаточно TON в кошельке';
    else if (!deposit && Number(w.withdrawable) <= 0) {
        issue = Number(w.balance) <= 0
            ? 'Недостаточно GRAM на балансе Crafter'
            : Number(w.withdraw_daily_remaining) <= 0
                ? 'Суточный лимит вывода исчерпан'
                : 'Нет доступных средств для вывода';
    }
    else if (!deposit && n > Number(c.withdraw_max)) issue = 'Сумма превышает лимит одной операции';
    else if (!deposit && n > Number(w.balance)) issue = 'Недостаточно GRAM на балансе Crafter';
    else if (!deposit && n > Number(w.withdrawable)) issue = 'Сумма превышает суточный лимит вывода';

    document.querySelector('#wallet-submit').disabled = state.walletBusy || !amountValid || !!issue;
    const quote = document.querySelector('#wallet-quote');
    quote.hidden = !deposit || !active || !amountValid || !withinDepositLimits || !!(connected && issue);
    quote.textContent = quote.hidden ? '' : 'К отправке ' + nativeWalletAmount(ton);
    const status = document.querySelector('#wallet-error');
    status.textContent = issue;
    status.classList.toggle('wallet-error-muted', !active || !connected);
}

function walletError(error) {
    const message = error.message || String(error);
    const el = document.querySelector('#wallet-error');
    if (el) {
        el.textContent = message;
        el.classList.remove('wallet-error-muted');
    } else toast(message);
}

async function sendDeposit() {
    if (state.walletBusy) return;
    const gram = normalizeWalletAmount(document.querySelector('#wallet-amount').value);
    const connected = state.walletInfo.connected;
    state.walletBusy = true;
    walletAmountChanged();
    let failure;
    try {
        const ui = await walletSDK();
        const account = walletAccount(ui);
        if (!sameWallet(connected, account)) {
            throw Error('Переподключите кошелёк этой сети, чтобы подтвердить перевод');
        }
        const intent = await api('wallet/deposit', {gram, sender:account.address});
        await ui.sendTransaction(intent.transaction);
        toast('Перевод отправлен. Ожидает подтверждения');
        if (state.page === 'deposit') await go('wallet');
        await checkDeposit(intent.id, null, true);
    } catch (error) {
        failure = error;
    } finally {
        state.walletBusy = false;
        if (state.page === 'deposit') walletAmountChanged();
        if (failure) walletError(failure);
    }
}

async function checkDeposit(id, button, poll = false) {
    if (button) button.disabled = true;
    try {
        const path = 'wallet/deposit/' + encodeURIComponent(id) + '/check';
        const attempts = poll ? 4 : 1;
        for (let i = 0; i < attempts; i++) {
            if (i) {
                await new Promise(resolve => setTimeout(resolve, 2500));
                if (state.page !== 'wallet') return;
            }
            const result = await api(path, {});
            if (result.status === 'confirmed') {
                await refreshMe();
                if (state.page === 'wallet') await renderWallet();
                toast('Пополнение подтверждено');
                return;
            }
        }
        if (!poll) toast('Перевод ещё не подтверждён');
    } catch (error) {
        walletError(error);
    } finally {
        if (button) button.disabled = false;
    }
}

let walletCancellationBusy = false;
async function cancelQueuedWithdrawal(id, button) {
    if (walletCancellationBusy || state.walletBusy) return;
    if (!confirm('Отменить заявку на вывод? Зарезервированные GRAM вернутся на баланс Crafter.')) return;
    walletCancellationBusy = true;
    if (button) button.disabled = true;
    try {
        const result = await api('wallet/withdraw/' + encodeURIComponent(id) + '/cancel', {});
        if (result.status !== 'cancelled') throw Error('Не удалось отменить заявку');
        await refreshMe();
        if (state.page === 'wallet') await renderWallet();
        toast('Заявка отменена. GRAM возвращены на баланс Crafter.');
    } catch (error) {
        walletError(error);
    } finally {
        walletCancellationBusy = false;
        if (button?.isConnected) button.disabled = false;
    }
}

async function requestWithdrawal() {
    if (state.walletBusy || document.querySelector('#wallet-submit')?.disabled) return;
    state.walletBusy = true;
    walletAmountChanged();
    let failure;
    try {
        const gram = normalizeWalletAmount(document.querySelector('#wallet-amount').value);
        const outcome = await api('wallet/withdraw', {gram, request_id:paymentRequestId('withdraw:'+state.me.user.id+':'+gram+':'+state.withdrawSession)});
        if (outcome.status !== 'queued') {
            throw Error(outcome.status === 'cancelled'
                ? 'Эта заявка уже отменена. Откройте страницу вывода заново.'
                : 'Заявка уже обрабатывается. Проверьте её статус в истории.');
        }
        await refreshMe();
        if (state.page === 'withdraw') go('wallet');
        toast('Заявка на вывод создана');
    } catch (error) {
        failure = error;
    } finally {
        state.walletBusy = false;
        if (state.page === 'withdraw') walletAmountChanged();
        if (failure) walletError(failure);
    }
}

const walletGo = go;
go = async function(page) {
    if (!walletPages.includes(page)) return walletGo(page);
    if (state.crafting) return;
    state.page = page;
    if (page === 'withdraw') state.withdrawSession = Date.now();
    document.querySelector('#app').classList.remove('cart-view','craft-view');
    document.querySelector('#cart-float')?.remove();
    nav();
    document.querySelector('#main').innerHTML = '<div class="loader">Загрузка…</div>';
    try {
        await refreshWalletView();
    } catch (error) {
        if (state.page !== page) return;
        document.querySelector('#main').innerHTML = `<div class="error">${esc(error.message)}</div><button class="secondary" onclick="go('${page}')">Повторить</button>`;
    }
};
async function renderTonAdmin(content = document.querySelector('#admin-content')) {
    const data = await api('admin/tonconnect'), c = data.config;
    if (!content?.isConnected || state.adminSection !== 'tonconnect') return;
    state.tonAdmin = data;
    content.innerHTML = `<section class="panel"><h3>TON Connect</h3><label class="wallet-setting"><input id="ton-enabled" type="checkbox" ${c.enabled?'checked':''}> Включить пополнения</label><label class="form-label">Сеть</label><select id="ton-network" class="field"><option value="testnet" ${c.network==='testnet'?'selected':''}>Testnet</option><option value="mainnet" ${c.network==='mainnet'?'selected':''}>Mainnet</option></select>${[['app_name','Название приложения'],['public_url','Публичный HTTPS адрес приложения'],['receiver','Адрес приёма TON'],['gram_per_ton','Сколько GRAM начислять за 1 TON'],['min_deposit','Минимальное пополнение, TON'],['max_deposit','Максимальное пополнение, TON'],['withdraw_max','Лимит вывода за операцию, GRAM'],['withdraw_daily','Лимит вывода за 24 часа, GRAM']].map(([k,n])=>`<label class="form-label">${n}</label><input class="field" id="ton-${k}" value="${esc(c[k])}">`).join('')}<label class="wallet-setting"><input id="ton-withdraw_enabled" type="checkbox" ${c.withdraw_enabled?'checked':''}> Разрешить заявки на вывод</label><label class="form-label">Toncenter API key ${data.rpc_key_configured?'(задан)':''}</label><input class="field" type="password" id="ton-rpc_key" placeholder="Оставьте пустым, чтобы сохранить"><button class="primary" onclick="saveTonSettings()">Сохранить</button><p class="sub">Ключи и seed-фразы кошелька не требуются. Переводы подписываются в кошельке.</p></section><section class="panel"><h3>Хранение данных</h3><p>${data.storage.durable?'Постоянное хранилище подключено':'Временное хранилище: нужен постоянный диск для сохранения после перезапуска Render'}</p><p class="sub">${esc(data.storage.path)}</p>${data.storage.engine==='sqlite'?'<button class="secondary" onclick="downloadDatabaseBackup()">Скачать резервную копию SQLite</button>':''}</section><section class="panel"><h3>Заявки на вывод</h3>${data.withdrawals.map(w=>`<div class="withdraw-admin"><b>${w.user_id} · ${money(w.gram)} GRAM / ${money(w.ton)} TON</b><small>${esc(w.receiver)}</small>${w.status==='queued'?`<button class="secondary" onclick="processWithdrawal(${arg(w.id)})">Перевести через кошелёк</button>`:''}<button class="secondary" onclick="verifyWithdrawal(${arg(w.id)})">Проверить перевод</button></div>`).join('')||'<p class="sub">Нет заявок</p>'}</section>`;
    if(typeof renderAutoPayoutAdmin === 'function'){
        try { await renderAutoPayoutAdmin(content); }
        catch(error){
            if(content.isConnected){
                const notice=document.createElement('p');
                notice.className='sub';notice.setAttribute('role','alert');
                notice.textContent='Дополнительные настройки автовыплат временно недоступны: '+error.message;
                content.append(notice);
            }
        }
    }else if(content.isConnected){
        const notice=document.createElement('p');
        notice.className='sub';notice.setAttribute('role','alert');
        notice.textContent='Модуль автовыплат не загрузился. Переоткройте управление, чтобы обновить файлы.';
        content.append(notice);
    }
}
async function saveTonSettings(){const data={enabled:document.querySelector('#ton-enabled').checked,withdraw_enabled:document.querySelector('#ton-withdraw_enabled').checked};for(const key of ['network','app_name','public_url','receiver','gram_per_ton','min_deposit','max_deposit','withdraw_max','withdraw_daily','rpc_key'])data[key]=document.querySelector('#ton-'+key).value;try{await api('admin/tonconnect',data);toast('Настройки сохранены');await renderTonAdmin()}catch(e){toast(e.message)}}
async function processWithdrawal(id){try{const ui=await walletSDK();if(!ui.connected){await ui.openModal();return}const account=ui.wallet?.account||ui.account,w=state.tonAdmin.withdrawals.find(w=>w.id===id);if(!w||account.address.toLowerCase()!==w.sender.toLowerCase())throw Error('Подключите кошелёк адреса приёма TON');const p=await api('admin/tonconnect/withdraw/'+encodeURIComponent(id)+'/prepare',{});await ui.sendTransaction(p.transaction);toast('Перевод отправлен. Проверьте подтверждение сети.')}catch(e){toast(e.message)}finally{await renderTonAdmin()}}
async function verifyWithdrawal(id){try{const r=await api('admin/tonconnect/withdraw/'+encodeURIComponent(id)+'/check',{});toast(r.status==='confirmed'?'Перевод подтверждён':'Ожидается подтверждение');await renderTonAdmin()}catch(e){toast(e.message)}}
const walletBalanceButton = document.querySelector('.balance');
if (walletBalanceButton) walletBalanceButton.onclick = () => go('wallet');

async function downloadDatabaseBackup(){try{const r=await fetch('/api/admin/database/backup',{headers:{'X-Telegram-Init-Data':tg?.initData||''}});if(!r.ok)throw Error('Не удалось создать резервную копию');const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='crafter-backup.sqlite3';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}catch(e){toast(e.message)}}
