const adminSections = {
    banners: ['Баннеры', 'Публикация, кадрирование и карусель', 'market', renderAdminBanners],
    users: ['Пользователи', 'Баланс и инвентарь', 'gift', renderAdminUsers],
    portal: ['Portal Market', 'Каталог и модели подарков', 'grid', renderAdminPortal],
    'telegram-bot': ['Telegram-бот', 'Приветствие, уведомления и эмодзи', 'send', renderTelegramBotAdmin],
    'telegram-deposits': ['Telegram NFT', 'Подключение, мониторинг и история депозитов', 'gift', renderTelegramDeposits],
    tonconnect: ['TON Connect', 'Подключение кошельков и операции', 'wallet', renderTonAdmin],
};

async function renderAdmin() {
    const main = document.querySelector('#main');
    const section = adminSections[state.adminSection];
    if (!section) {
        main.innerHTML = `<h2>Выберите раздел</h2><div class="admin-section-grid">${Object.entries(adminSections).map(([id, [label, description, glyph]]) =>
            `<button type="button" class="admin-section-card" onclick="openAdminSection('${id}')">
                <span class="admin-section-icon">${icon(glyph)}</span><span><b>${label}</b><small>${description}</small></span><span aria-hidden="true">›</span>
            </button>`).join('')}</div>`;
        return;
    }
    main.innerHTML = `<button class="admin-back" onclick="openAdminSection('')">‹ Все разделы</button>
        <h2>${section[0]}</h2><div id="admin-content"><p class="sub" role="status">Загрузка…</p></div>`;
    const content = document.querySelector('#admin-content');
    try {
        await section[3](content);
    } catch (error) {
        if (content.isConnected) content.textContent = error.message;
    }
}

function openAdminSection(id) {
    closeSheet();
    state.adminSection = id;
    renderAdmin();
    window.scrollTo(0, 0);
}

(async () => {
    const main = document.querySelector('#main');
    try {
        tg?.ready();
        tg?.expand();
        state.me = await api('me');
        if (!state.me.is_admin) throw Error('Доступ только для администратора');
        state.page = 'admin';
        state.catalogReady = api('catalog').then(data => { state.catalog = data; }).catch(() => {});
        await renderAdmin();
    } catch (error) {
        main.textContent = error.message;
    }
})();
