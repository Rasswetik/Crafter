/* Crafter UI preferences: saved locally, shared by Mini App and admin.
   App text is localized on the rendered nodes, not on API payloads or gift data. */
const crafterPrefsKey = 'crafter:ui-preferences:v1';
const crafterStoredPrefs = (() => {
    try { return JSON.parse(localStorage.getItem(crafterPrefsKey) || '{}'); }
    catch { return {}; }
})();
const crafterPrefs = {
    animations: crafterStoredPrefs.animations !== false,
    language: crafterStoredPrefs.language === 'en' ? 'en' : 'ru',
    theme: ['dark','light','system'].includes(crafterStoredPrefs.theme) ? crafterStoredPrefs.theme : 'dark'
};
const crafterPhrases = {
    craftSuccess: ['Крафт удался!', 'Craft successful!'],
    craftFailed: ['Крафт не удался', 'Craft failed'],
    giftInInventory: ['Подарок уже в вашем инвентаре', 'Your gift is now in your inventory'],
    giftsConsumed: ['Использованные подарки не возвращаются', 'The gifts used cannot be returned'],
    toInventory: ['В инвентарь', 'View inventory'],
    craftAgain: ['Крафтить ещё', 'Craft again'],
    usedInCraft: ['Использовано в крафте', 'Used in crafting'],
    openCollection: ['Открыть коллекцию', 'Open collection'],
    noReward: ['Награда не получена', 'No reward'],
    settings: ['Настройки', 'Settings'],
    appearance: ['Оформление', 'Appearance'],
    theme: ['Тема', 'Theme'],
    language: ['Язык', 'Language'],
    dark: ['Тёмная', 'Dark'],
    light: ['Светлая', 'Light'],
    system: ['Системная', 'System'],
    ru: ['Русский', 'Русский'],
    en: ['English', 'English']
};
function craftText(key) {
    const entry = crafterPhrases[key];
    return entry ? entry[crafterPrefs.language === 'en' ? 1 : 0] : key;
}
/* Source UI copy is Russian; reversing the dictionary restores it without a page reload. */
const crafterTranslationPairs = [
    ['Ваше предложение','Your offer'], ['Сделать оффер','Make offer'], ['Отправить оффер','Send offer'],
    ['Сумма оффера','Offer amount'], ['Комиссия за отправку','Posting fee'], ['Любой','Any'],
    ['Получено','Received'], ['Размещено','Placed'], ['Отозвать','Withdraw offer'],
    ['Отклонить','Decline'], ['Принять','Accept'], ['Награда стейкинга','Staking reward'],
    ['Изменение цены','Price update'], ['Изменена цена','Price updated'],
    ['Анимации','Animations'], ['Поддержка','Support'], ['Общий банк','Inventory bank'],
    ['Лучший выигрыш','Best win'], ['Топ 10 офферов','Top 10 offers'],
    ['Продай сейчас','Sell now'], ['Лучшее предложение','Best offer'],
    ['По коллекции','Collection offers'], ['По атрибутам','Attribute offers'],
    ['Офферов пока нет','No offers yet'], ['Создать оффер','Create offer'],
    ['Атрибуты','Attributes'], ['Количество','Quantity'], ['Окончание оффера','Offer expiry'],
    ['Бессрочно','No expiry'], ['24 часа','24 hours'], ['7 дней','7 days'],
    ['Доступный баланс','Available balance'], ['Общая цена','Total price'],
    ['Маркет','Market'],['Мои подарки','My gifts'],['Крафт','Craft'],
    ['Профиль','Profile'],['Настройки','Settings'],['Выберите раздел','Choose a section'],
    ['Светлая','Light'],['Тёмная','Dark'],['Системная','System'],
    ['Оформление','Appearance'],['Тема','Theme'],['Язык','Language'],
    ['В инвентарь','View inventory'],['Крафтить ещё','Craft again'],
    ['Крафт удался!','Craft successful!'],['Крафт не удался','Craft failed'],
    ['Подарок уже в вашем инвентаре','Your gift is now in your inventory'],
    ['Использованные подарки не возвращаются','The gifts used cannot be returned'],
    ['Использовано в крафте','Used in crafting'],['Награда не получена','No reward'],
    ['Добавить','Add'],['Подарки','Gifts'],['Гифты','Gifts'],['История','History'],['Офферы','Offers'],
    ['Добавить подарки для крафта','Add gifts for crafting'],['Выберите подарок','Choose a gift'],
    ['Скрафтить','Craft'],['Ещё раз','Try again'],['Мои подарки','My gifts'],
    ['Фильтры','Filters'],['Коллекция','Collection'],['Коллекции','Collections'],
    ['Модель','Model'],['Фон','Background'],['Узор','Pattern'],
    ['Цена','Price'],['Покупка','Purchase'],['Продажа','Sale'],
    ['Пополнить','Deposit'],['Пополнение','Deposit'],['Вывод','Withdraw'],['Продать','Sell'],
    ['Отправить','Send'],['Снять','Remove'],['Снять с продажи','Remove listing'],
    ['Поиск','Search'],['Поиск по истории','Search history'],['Быстрый поиск','Quick search'],
    ['Не выставл.','Not listed'],['Выставл.','Listed'],['Все','All'],
    ['Ничего не найдено','Nothing found'],['Нет подарков','No gifts'],
    ['Здесь появятся подарки, зачисленные в ваш инвентарь приложения.','Your Crafter inventory will appear here.'],
    ['В инвентаре','In inventory'],['Нет активных офферов','No active offers'],
    ['Предложения на ваши подарки появятся здесь','Offers for your gifts will appear here'],
    ['Открыть маркет','Open market'],['Показать ещё','Show more'],['Загрузка…','Loading…'],
    ['Подарок получен','Gift received'],['Подарок отправлен','Gift sent'],
    ['Подарок добавлен в инвентарь','Gift added to inventory'],['Подарок добавлен в «Мои подарки»','Gift added to My gifts'],
    ['Скрафтить','Craft'],['Выбрать','Select'],['Выберите подарки','Choose gifts'],
    ['Выполнено','Completed'],['Не удалось','Failed'],['Успешно','Successful'],['Изготовление','Crafting'],
    ['Полученные','Received'],['Отправленные','Sent'],['Сначала новые','Newest first'],
    ['Сначала старые','Oldest first'],['Все операции','All operations'],
    ['Статус','Status'],['Анонимно','Anonymous'],['Операция','Operation'],['Отмена','Cancel'],
    ['Назад','Back'],['Закрыть','Close'],['Готово','Done'],['Сохранить','Save'],
    ['Сбросить','Reset'],['Применить','Apply'],['Понятно','Got it'],
    ['Минимальная цена','Minimum price'],['Мин. цена','Floor price'],
    ['Стоимость инвентаря','Inventory value'],['Общий объём','Total volume'],
    ['Объём 24 ч','24h volume'],['Куплено / Продано','Bought / sold'],
    ['РЕФЕРАЛЬНАЯ ПРОГРАММА','REFERRAL PROGRAM'],['Пригласить друзей','Invite friends'],
    ['Приглашено друзей','Friends invited'],['УПРАВЛЕНИЕ','MANAGEMENT'],['Админ-панель','Admin panel'],
    ['Управление','Management'],['Пользователи','Users'],['Баланс и инвентарь','Balance and inventory'],
    ['Баннеры','Banners'],['Публикация, кадрирование и карусель','Publishing, cropping and carousel'],
    ['Каталог и модели подарков','Catalog and gift models'],
    ['Приветствие, уведомления и эмодзи','Welcome, notifications and emoji'],
    ['Подключение кошельков и операции','Wallet connections and transactions'],
    ['Подключение, мониторинг и история депозитов','Connection, monitoring and deposits'],
    ['Кошелёк','Wallet'],['Ваш кошелёк','Your wallet'],['К кошельку','Back to wallet'],
    ['Баланс','Balance'],['Доступно','Available'],['Проверить','Check'],['Повторить','Retry'],
    ['Проверить подключение','Check connection'],['Проверить пополнения','Check deposits'],
    ['Подключить','Connect'],['Отключить','Disconnect'],['Получить код','Get code'],
    ['Подтвердить код','Confirm code'],['Пароль двухэтапной проверки','Two-step verification password'],
    ['Настройки Telegram API','Telegram API settings'],['Номер Telegram','Telegram phone'],
    ['Сохранить настройки','Save settings'],['История пополнений','Deposit history'],
    ['Ключи заданы','Keys configured'],['Не подключён','Not connected'],['Подключён','Connected'],
    ['Первая сверка','Initial sync'],['Последняя проверка','Last check'],
    ['ДЕМО · тестовые цены и подарки','DEMO · test prices and gifts'],
    ['Оценка подарков','Gift valuation'],['Шанс','Chance'],['Максимальный шанс','Maximum chance'],
    ['Как работает крафт','How crafting works'],['Нужно выбрать подарок','Choose a gift'],
    ['Подарок','Gift'],['Подарки','Gifts'],['Нет активных заявок','No active requests'],
    ['Выберите коллекцию, модель и фон в строке фильтров. Кнопка ↕ сортирует подарки по цене.',
     'Choose collection, model and background. The ↕ button sorts gifts by price.'],
    ['Проверить перевод','Check transfer'],['Ваш инвентарь','Your inventory'],
    ['Полная история','Full history'],['Инвентарь','Inventory'],
    ['Тестовый инвентарь для проверки крафта.','Test inventory for crafting.'],
    ['Соберите свою первую коллекцию','Start your collection'],
    ['Ваши подарки будут здесь','Your gifts will appear here'],
    ['Подарки для крафта','Gifts for crafting'],
    ['Выставлено','Listed'],['Продажа подарков','Gift listing'],['Тип операции','Operation type'],
    ['Порядок по дате','Sort by date'],['История пуста','History is empty'],
    ['Сервер долго не отвечает. Попробуйте ещё раз.','Server timed out. Please retry.'],
    ['Изменить вид','Change view'],['Фильтры подарков','Gift filters'],
    ['Просмотреть подарок','View gift'],['Открыть подарок','Open gift'],
    ['Использовать для крафта','Use for crafting'],['Отправить подарок','Send gift'],
    ['Цвет','Color'],['По умолчанию','Default'],
    ['Крафтить','Craft'],['Подарки сгорят','Gifts will be lost'],
    ['Крафт не удался','Craft failed'],
    ['Добавьте до','Add up to'],['подарков','gifts'],['чтобы скрафтить','to craft'],
    ['Если крафт не удастся,','If crafting fails,'],['подарки сгорят','gifts will be lost'],
    ['Флор коллекции в TON','Collection floor in TON'],
    ['Сумма флоров / флор цели × 95%','Sum of floor prices / target floor × 95%'],
    ['Выбранные подарки списываются. При успехе результат появляется в инвентаре Crafter. Операция работает с подарками приложения; передачу NFT в Telegram она не выполняет.',
     'Selected gifts are consumed. If successful, the reward appears in your Crafter inventory. Crafting does not transfer NFTs in Telegram.'],
    ['Нет активных офферов','No active offers'],['Поиск по истории','Search history']
];
crafterTranslationPairs.push(
    ['Стейкинг','Staking'],['Игры','Games'],['Крафты','Crafts'],
    ['Выбирайте игровой режим','Choose a game mode'],
    ['Стейкинг подарков','Gift staking'],['Внести подарки','Stake gifts'],
    ['Получить','Claim'],['Всего заработано','Total earned'],
    ['Ваш стейк','Your stake'],['Лимит стейкинга','Staking limit'],
    ['Начисление за сутки','Daily reward'],['Выберите подарки','Select gifts'],
    ['Отправить в стейкинг','Stake selected gifts'],
    ['Правила стейкинга','Staking rules'],
    ['Вывести из стейкинга','Withdraw from staking'],
    ['Можно вывести','Ready to withdraw'],['Заблокирован','Locked'],
    // Wallet and on-chain confirmation states
    ['Подключённый кошелёк','Connected wallet'],
    ['Подключенный кошелёк','Connected wallet'],
    ['Переподключить','Reconnect wallet'],
    ['Отвязать кошелёк','Unlink wallet'],
    ['Ваш кошелёк','Your wallet'],
    ['Баланс недоступен','Balance unavailable'],
    ['Баланс кошелька','Wallet balance'],
    ['Копировать','Copy'],
    ['Адрес','Address'],
    ['Не подключён','Not connected'],
    ['Выберите кошелёк','Choose wallet'],
    ['Открыть кошелёк','Open wallet'],
    ['Отменить заявку','Cancel request'],
    ['Нет доступных средств для вывода','No funds available for withdrawal'],
    ['Суточный лимит вывода исчерпан','Daily withdrawal limit reached'],
    ['Сумма превышает лимит одной операции','Amount exceeds the per-transaction limit'],
    ['Сумма превышает подтверждённый доступный баланс','Amount exceeds the verified available balance'],
    ['Для вывода доступны только GRAM из подтверждённых пополнений TON.','Only GRAM from verified TON deposits can be withdrawn.'],
    ['Нет GRAM из подтверждённых TON-пополнений для вывода','No GRAM backed by verified TON deposits'],
    ['Подтверждённых средств для вывода сейчас нет.','No verified funds are available for withdrawal.'],
    ['TON на подключённом кошельке — отдельный баланс, он не равен GRAM внутри Crafter.','TON in the connected wallet is separate from the internal Crafter GRAM balance.'],
    ['Вывод доступен только для GRAM из подтверждённых пополнений TON','Withdrawals require GRAM backed by verified TON deposits'],
    ['Заявка отменена. GRAM возвращены на баланс Crafter.','Request cancelled. GRAM returned to your Crafter balance.'],
    ['Открыть историю','View history'],
    ['Лимит за операцию','Per-transaction limit'],
    ['Доступно к выводу','Available to withdraw'],
    ['Сумма вывода','Withdrawal amount'],
    ['Запросить вывод','Request withdrawal'],
    ['Подключить кошелёк','Connect wallet'],
    ['Получить адрес','Get address'],
    ['Проверить перевод','Verify transfer'],
    ['Перевести','Transfer'],
    ['Отключить кошелёк','Disconnect wallet'],
    ['Транзакции','Transactions'],
    ['История операций','Transaction history'],
    ['Заявка на вывод','Withdrawal request'],
    ['В очереди','Queued'],
    ['Обрабатывается','Processing'],
    ['Подтверждено','Confirmed'],
    ['Отменено','Cancelled'],
    ['Ошибка','Error'],
    ['Вывод подарка','Gift withdrawal'],
    ['Кошелёк не подключён','Wallet not connected'],
    // Gift/market controls, shortcuts and staking
    ['Сделать оффер','Make offer'],
    ['Купить подарок','Buy gift'],
    ['Управлять в инвентаре','Manage in inventory'],
    ['Готово','Done'],
    ['Вывод пока недоступен','Withdrawal is not available yet'],
    ['Цена продажи','Listing price'],
    ['Редактировать','Edit'],
    ['Снять с продажи','Delist'],
    ['Мин. цена','Floor price'],
    ['Источник','Source'],
    ['На маркете','On market'],
    ['Игры','Games'],
    ['Выберите игровой режим','Choose a game'],
    ['Соберите подарки и выберите цель','Combine gifts and choose a target'],
    ['Правила','Rules'],
    ['Ваш стейк','Your stake'],
    ['Отправить в стейкинг','Stake selected gifts'],
    ['Выбрано: 0','Selected: 0'],
    ['Лимит стейкинга','Staking limit'],
    ['Начисление за сутки','Daily reward'],
    ['Всего заработано','Total earned'],
    ['Получить','Claim'],
    ['Внести подарки','Stake gifts'],
    ['Выберите подарки','Select gifts'],
    ['Вносите подарки','Stake gifts'],
    ['Нет оценки для стейкинга','No staking valuation'],
    ['Недостаточно места в стейкинге','Not enough staking capacity'],
    ['Активен','Active'],
    ['Закрыт','Closed'],
    ['Удалить подарок','Remove gift'],
    ['Заблокировать','Ban user'],
    ['Разблокировать','Unban user'],
    ['Журнал действий','Activity log'],
    ['История пользователя','User history'],
    ['Управление подарками','Manage gifts'],
    ['Обновить','Refresh'],
    ['Активирован','Activated']
);
const crafterRuEn = new Map(crafterTranslationPairs);
const crafterEnRu = new Map(crafterTranslationPairs.map(pair=>[pair[1],pair[0]]));
const crafterTextCache = new WeakMap();
const crafterAttrCache = new WeakMap();
function crafterTranslateValue(raw) {
    const lang = crafterPrefs.language;
    const clean = raw.trim();
    const dict = lang === 'en' ? crafterRuEn : crafterEnRu;
    let output = dict.get(clean);
    if (output === undefined) {
        const variable = lang === 'en' ? [
          [/^Уровень рефералов (\d+)$/, n => 'Referral level ' + n],
          [/^До уровня (\d+)$/, n => 'Until level ' + n],
          [/^Добавьте до (\d+) подарков, чтобы скрафтить$/, n => 'Add up to ' + n + ' gifts to craft'],
          [/^Выбрано подарков: (\d+)$/, n => 'Gifts selected: ' + n]
        ] : [
          [/^Referral level (\d+)$/, n => 'Уровень рефералов ' + n],
          [/^Until level (\d+)$/, n => 'До уровня ' + n],
          [/^Add up to (\d+) gifts to craft$/, n => 'Добавьте до ' + n + ' подарков, чтобы скрафтить'],
          [/^Gifts selected: (\d+)$/, n => 'Выбрано подарков: ' + n]
        ];
        for (const [regex, transform] of variable) {
            const match = clean.match(regex);
            if (match) { output = transform(match[1]); break; }
        }
    }
    if (output === undefined) return raw;
    return raw.slice(0, raw.indexOf(clean)) + output + raw.slice(raw.indexOf(clean) + clean.length);
}
function crafterTranslateTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim() || node.parentElement?.closest('script,style,svg,textarea,code,pre,[contenteditable]')) return;
    let record = crafterTextCache.get(node);
    if (!record || record.displayed !== node.nodeValue)
        record = {source:node.nodeValue,displayed:node.nodeValue};
    const target = crafterTranslateValue(record.source);
    record.displayed = target;
    crafterTextCache.set(node,record);
    if (node.nodeValue !== target) node.nodeValue = target;
}
function crafterTranslateAttrs(element) {
    if (!(element instanceof Element) || element.closest('svg')) return;
    let records = crafterAttrCache.get(element);
    if (!records) { records = {}; crafterAttrCache.set(element, records); }
    for (const name of ['aria-label','placeholder','title']) {
        const actual = element.getAttribute(name);
        if (!actual) continue;
        let record = records[name];
        if (!record || record.displayed !== actual)
            record = {source:actual,displayed:actual};
        const desired = crafterTranslateValue(record.source);
        record.displayed = desired;
        records[name] = record;
        if (actual !== desired) element.setAttribute(name, desired);
    }
}
const crafterCrossSVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const crafterSettingsSVG = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.45 2.55h3.1l.57 2.15c.56.19 1.09.49 1.57.86l2.12-.68 2.19 2.19-.68 2.12c.37.48.67 1.01.86 1.57l2.15.57v3.1l-2.15.57c-.19.56-.49 1.09-.86 1.57l.68 2.12-2.19 2.19-2.12-.68c-.48.37-1.01.67-1.57.86l-.57 2.15h-3.1l-.57-2.15c-.56-.19-1.09-.49-1.57-.86l-2.12.68-2.19-2.19.68-2.12c-.37-.48-.67-1.01-.86-1.57L2 13.55v-3.1l2.15-.57c.19-.56.49-1.09.86-1.57l-.68-2.12 2.19-2.19 2.12.68c.48-.37 1.01-.67 1.57-.86l.24-.92Z"/><circle cx="12" cy="12" r="3.3"/></svg>';
function crafterReplaceClose(el) {
    if (!(el instanceof Element)) return;
    const candidates = el.matches?.('button.close, button[aria-label="Закрыть"], button[aria-label="Close"]') ?
        [el] : [...el.querySelectorAll?.('button.close, button[aria-label="Закрыть"], button[aria-label="Close"]') || []];
    for (const button of candidates) {
        if (/^[×✕✖xX]$/.test(button.textContent.trim()) && !button.querySelector('svg,img')) {
            button.innerHTML = crafterCrossSVG;
            button.classList.add('crafter-svg-close');
        }
    }
}
function crafterLocalizeTree(node) {
    if (!node || (node.nodeType!==1 && node.nodeType!==3 && node.nodeType!==11)) return;
    if (node.nodeType === 3) { crafterTranslateTextNode(node); return; }
    if (node.nodeType === 1) { crafterReplaceClose(node); crafterTranslateAttrs(node); }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) {
        if (current.nodeType === 3) crafterTranslateTextNode(current);
        else crafterTranslateAttrs(current);
    }
}
function crafterApplyTheme() {
    const systemLight = matchMedia('(prefers-color-scheme: light)').matches;
    const effective = crafterPrefs.theme === 'system' ? (systemLight ? 'light' : 'dark') : crafterPrefs.theme;
    document.documentElement.dataset.crafterTheme = effective;
    document.documentElement.dataset.crafterAnimations = crafterPrefs.animations ? 'on' : 'off';
    document.documentElement.style.colorScheme = effective;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effective === 'light' ? '#f6f7fa' : '#131313');
}
function crafterStorePrefs() {
    try { localStorage.setItem(crafterPrefsKey, JSON.stringify(crafterPrefs)); }
    catch {}
}
function crafterSetPreference(kind,value) {
    if (kind === 'theme' && ['dark','light','system'].includes(value)) crafterPrefs.theme = value;
    else if (kind === 'language' && ['ru','en'].includes(value)) crafterPrefs.language = value;
    else return;
    crafterStorePrefs();
    crafterApplyTheme();
    document.documentElement.lang = crafterPrefs.language;
    crafterLocalizeTree(document.body);
    document.querySelectorAll('.crafter-option[data-pref]').forEach(el => {
        const selected = crafterPrefs[el.dataset.pref] === el.dataset.value;
        el.classList.toggle('selected', selected);
        el.setAttribute('aria-pressed', String(selected));
    });
    const label = document.querySelector('#sheet-title');
    if (label && document.querySelector('#crafter-settings')) label.textContent = craftText('settings');
}
function crafterSettingsOption(key, value, title) {
    return `<button type="button" class="crafter-option ${crafterPrefs[key] === value ? 'selected' : ''}"
        data-pref="${key}" data-value="${value}" aria-pressed="${crafterPrefs[key]===value}"
        onclick="crafterSetPreference('${key}','${value}')">${title}</button>`;
}
const flagEN = '<svg class="language-flag" viewBox="0 0 19 10" aria-hidden="true"><rect width="19" height="10" fill="#fff"/><path d="M0 .385h19M0 1.923h19M0 3.462h19M0 5h19M0 6.538h19M0 8.077h19M0 9.615h19" stroke="#b31942" stroke-width=".77"/><path d="M0 0h7.6v5.385H0z" fill="#0a3161"/><path d="M1 .9h5.6M1 2.1h5.6M1 3.3h5.6M1 4.5h5.6" stroke="#fff" stroke-width=".55" stroke-linecap="round" stroke-dasharray=".01 1.05"/></svg>';
const flagRU = '<svg class="language-flag" viewBox="0 0 3 2" aria-hidden="true"><path d="M0 0h3v2H0z" fill="#fff"/><path d="M0 .667h3v1.333H0z" fill="#0039a6"/><path d="M0 1.333h3V2H0z" fill="#d52b1e"/></svg>';
function crafterOpenSettings() {
    sheet(craftText('settings'), `<div id="crafter-settings" class="crafter-settings crafter-settings-compact">
        <section class="crafter-settings-section">
            <h3>Язык</h3>
            <div class="crafter-options" role="group" aria-label="Язык">
                ${crafterSettingsOption('language','en',flagEN + '<span>EN</span>')}
                ${crafterSettingsOption('language','ru',flagRU + '<span>RU</span>')}
            </div>
        </section>
        <section class="crafter-settings-section">
            <label class="crafter-animation-setting"><span>Анимации</span>
                <input type="checkbox" role="switch" ${crafterPrefs.animations ? 'checked' : ''}>
            </label>
        </section>
        <button type="button" class="primary crafter-support" disabled>Поддержка</button>
    </div>`);
    const root = document.querySelector('#crafter-settings');
    root.querySelector('input[role="switch"]').onchange = event => {
        crafterPrefs.animations = event.target.checked;
        crafterStorePrefs();
        crafterApplyTheme();
    };
    crafterLocalizeTree(appSheet);
}
function crafterAddProfileSettings() {
    const root = document.querySelector('#main');
    const identity = root?.querySelector('.profile-identity');
    // Unified profile is used in Hub and outside it; inject exactly one settings button.
    if (!identity || identity.querySelector('.crafter-open-settings, .profile-settings-button')) return;
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'crafter-open-settings';
    control.setAttribute('aria-label', craftText('settings'));
    control.innerHTML = crafterSettingsSVG;
    control.onclick = crafterOpenSettings;
    identity.append(control);
}
const crafterRenderProfileBeforeSettings = renderProfile;
renderProfile = function(...args) {
    const outcome = crafterRenderProfileBeforeSettings.apply(this,args);
    crafterAddProfileSettings();
    crafterLocalizeTree(document.querySelector('#main'));
    return outcome;
};
document.documentElement.lang = crafterPrefs.language;
crafterApplyTheme();
const crafterUiObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
        if (mutation.type === 'characterData') crafterTranslateTextNode(mutation.target);
        else for (const added of mutation.addedNodes) crafterLocalizeTree(added);
    }
});
crafterUiObserver.observe(document.body, {childList:true,subtree:true,characterData:true});
crafterLocalizeTree(document.body);
const crafterSystemQuery = matchMedia('(prefers-color-scheme: light)');
if (crafterSystemQuery.addEventListener) crafterSystemQuery.addEventListener('change', crafterApplyTheme);
else if (crafterSystemQuery.addListener) crafterSystemQuery.addListener(crafterApplyTheme);
