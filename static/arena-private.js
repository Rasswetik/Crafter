/* Private Room 2 — invitation-only. The public Arena remains Room 1. */
const arenaPrivate = {inviteAcknowledged:false, info:null, pending:false, inviteToken:null};

function arenaInviteToken() {
    if (arenaPrivate.inviteAcknowledged) return null;
    const params = new URLSearchParams(location.search);
    const raw = params.get('arena_room') || params.get('tgWebAppStartParam') ||
        tg?.initDataUnsafe?.start_param || '';
    const token = raw.startsWith('arena_') ? raw.slice(6) : raw;
    return /^[A-Za-z0-9_-]{24}$/.test(token) ? token : null;
}

function arenaPrivateLink(info) {
    const fallback = state.me?.invite_link?.match(/^https:\/\/t\.me\/[a-z0-9_]+/i)?.[0];
    return info.telegram_link || (fallback ? fallback + '?startapp=arena_' + info.token :
        info.web_link || location.origin + '/?arena_room=' + info.token);
}

function arenaRoomTabs(active) {
    return '<div class="arena-room-tabs" role="group" aria-label="Комнаты арены">' +
        '<button type="button" aria-pressed="' + (active === 1) +
        '" onclick="arenaSwitchRoom(1)">Комната 1</button>' +
        '<button type="button" aria-pressed="' + (active === 2) +
        '" onclick="arenaSwitchRoom(2)">Комната 2</button></div>';
}

function arenaSwitchRoom(number) {
    arenaPrivate.inviteAcknowledged = true;
    if (number === 1) {
        leaveArena();
        enterArena(document.querySelector('#main'));
    } else {
        arenaOpenPrivateLobby();
    }
}

function arenaOpenPrivateLobby() {
    leaveArena();
    arena.privateToken = null;
    const main = document.querySelector('#main');
    if (!main || state.page !== 'arena') return;

    main.innerHTML = '<section class="arena-page arena-private-lobby">' +
        '<div class="arena-private-top"><div class="arena-private-top-title">' +
        '<small>ARENA · GROUPS</small><h2>Приватные комнаты</h2></div>' +
        arenaRoomTabs(2) + '</div>' +
        '<div class="arena-private-note"><span class="arena-private-note-icon">♙</span>' +
        '<div><strong>Только по приглашению</strong>' +
        '<p>Создайте группу или выберите ту, в которую вас пригласили.</p></div></div>' +
        '<div class="arena-private-list-head"><h3>Ваши группы</h3>' +
        '<span id="arena-private-total"></span></div>' +
        '<div id="arena-private-list" class="arena-private-group-list">' +
        '<p class="arena-private-muted">Загружаем группы…</p></div>' +
        '<div class="arena-dock arena-private-dock"><button class="arena-private-create" type="button" ' +
        'onclick="arenaNewRoomForm()"><span>+</span> Создать комнату</button></div></section>';
    const view = arena.view;
    api('arena/private').then(data => {
        if (view !== arena.view || state.page !== 'arena') return;
        const root = document.querySelector('#arena-private-list');
        if (!root) return;

        const total = document.querySelector('#arena-private-total');
        if (total) total.textContent = data.rooms.length + ' групп';
        root.innerHTML = data.rooms.length ? data.rooms.map(room => {
            const initial = esc([...room.name.trim()][0] || 'G').toUpperCase();
            return '<button class="arena-private-room-card" type="button" ' +
                'onclick="arenaEnterPrivateRoom(' + arg(room.token) + ')">' +
                '<span class="arena-private-room-icon">' + initial + '</span>' +
                '<span class="arena-private-room-body"><span class="arena-private-room-name">' +
                '<strong>' + esc(room.name) + '</strong><small class="arena-private-room-role">' +
                (room.is_owner ? 'Владелец' : 'Участник') + '</small></span>' +
                '<span class="arena-private-room-detail">' +
                '<span>' + room.members + '/' + room.max_players + ' игроков</span>' +
                '<span>' + room.bet_seconds + ' сек.</span>' +
                '<span>' + arenaFormat(room.min_bet) + '–' + arenaFormat(room.max_bet) +
                ' GRAM</span>' +
                (room.bot_enabled ? '<span class="arena-private-room-bot">Бот: ' +
                    esc(room.bot_name) + '</span>' : '') +
                '</span></span><span class="arena-private-room-arrow">›</span></button>';
        }).join('') : '<div class="arena-private-group-empty"><span>♙</span>' +
            '<strong>Здесь пока пусто</strong><p>Создайте комнату и отправьте ' +
            'приглашение друзьям.</p></div>';
    }).catch(error => {
        if (view === arena.view) {
            const root = document.querySelector('#arena-private-list');
            if (root) root.innerHTML = '<p class="arena-private-muted">' + esc(error.message) +
                '</p><button type="button" class="secondary" onclick="arenaOpenPrivateLobby()">Повторить</button>';
        }
    });
}

function arenaNewRoomForm() {
    sheet('Создать приватную комнату', '<form class="arena-private-form" onsubmit="arenaCreatePrivateRoom(event)">' +
        '<label>Имя группы<input name="name" type="text" maxlength="48" minlength="2" required ' +
        'placeholder="Например, Друзья Crafter"></label>' +
        '<label>Время отсчёта ставок<select name="bet_seconds">' +
        '<option value="15">15 секунд</option><option value="30" selected>30 секунд</option>' +
        '<option value="60">1 минута</option><option value="120">2 минуты</option>' +
        '<option value="300">5 минут</option></select></label>' +
        '<label>Максимум игроков<select name="max_players">' +
        '<option value="2">2 игрока</option><option value="4" selected>4 игрока</option>' +
        '<option value="8">8 игроков</option><option value="16">16 игроков</option>' +
        '<option value="32">32 игрока</option></select></label>' +
        '<div class="arena-private-limits">' +
        '<label>Мин. ставка, GRAM<input name="min_bet" inputmode="decimal" ' +
        'type="text" required value="0.1" placeholder="0.1"></label>' +
        '<label>Макс. ставка, GRAM<input name="max_bet" inputmode="decimal" ' +
        'type="text" required value="100" placeholder="100"></label></div>' +
        '<p>Отсчёт начинается после ставки второго игрока. GRAM и NFT учитываются ' +
        'по стоимости в GRAM.</p>' +
        '<button type="submit" class="arena-private-submit">Создать комнату</button></form>');
}

async function arenaCreatePrivateRoom(event) {
    event.preventDefault();
    if (arenaPrivate.pending) return;
    const form = event.currentTarget;
    const value = name => String(form.elements[name]?.value || '').trim().replace(',', '.');
    const min = Number(value('min_bet'));
    const max = Number(value('max_bet'));
    if (!(min > 0 && max >= min && max <= 1000000)) {
        return toast('Проверьте минимальную и максимальную ставку');
    }
    const body = {
        name:value('name'), bet_seconds:Number(value('bet_seconds')),
        max_players:Number(value('max_players')),
        min_bet:value('min_bet'), max_bet:value('max_bet'),
    };
    const button = form.querySelector('[type=submit]');
    arenaPrivate.pending = true;
    button.disabled = true;
    button.textContent = 'Создаём…';
    try {
        const info = await api('arena/private', body);
        closeSheet();
        arenaPrivate.info = info;
        arenaEnterPrivateRoom(info.token);
        // Display the join URL immediately after creating a group.
        arenaPrivateShareSheet(info);
    } catch(error) {
        toast(error.message);
    } finally {
        arenaPrivate.pending = false;
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = 'Создать комнату';
        }
    }
}

function arenaEnterPrivateRoom(token) {
    if (!/^[A-Za-z0-9_-]{24}$/.test(token) || state.page !== 'arena') return;
    arenaPrivate.inviteAcknowledged = true;
    leaveArena();
    enterArena(document.querySelector('#main'), token);
}

function arenaPrivateInfo() {
    const token = arena.privateToken;
    if (!token) return arenaRules();
    const view = arena.view;
    sheet('Инфо · Приватная арена', '<div class="arena-private-info-loading">Загружаем данные комнаты…</div>');
    return api('arena/private/' + token + '/invite').then(info => {
        if (arena.view !== view || arena.privateToken !== token || !appSheet.open) return;
        arenaPrivate.info = info;
        const data = arena.data?.private_room?.token === token ? arena.data : null;
        const phaseLabel = {
            waiting: 'Ожидание игроков', betting: 'Приём ставок',
            playing: 'Определение победителя', result: 'Раунд завершён'
        }[data?.phase] || 'Ожидание игроков';
        const created = info.created_at
            ? new Date(Number(info.created_at)).toLocaleDateString('ru-RU', {
                day: 'numeric', month: 'long', year: 'numeric'
            }) : '—';
        const row = (label, value) => '<div class="arena-private-detail-row"><span>' +
            label + '</span><strong>' + esc(String(value)) + '</strong></div>';
        const detail = '<div class="arena-private-info">' +
            '<div class="arena-private-info-hero"><span class="arena-private-info-symbol">♜</span>' +
            '<div class="arena-private-info-title"><small>ПРИВАТНАЯ ГРУППА</small><h3>' +
            esc(info.name) + '</h3><span>Только по приглашению</span></div></div>' +
            '<div class="arena-private-info-badges"><span class="arena-private-info-badge">' +
            '● ' + esc(phaseLabel) + '</span><span class="arena-private-info-badge">' +
            esc(String(info.members)) + ' / ' + esc(String(info.max_players)) + ' игроков</span></div>' +
            (info.bot_enabled ? '<div class="arena-private-info-bot">' +
                '<img src="' + esc(info.bot_photo || '/static/assets/arena-crafter-bot.jpg') +
                '" alt="Аватар бота"><div><strong>' + esc(info.bot_name) +
                '</strong><small>Бот · участник со своим банком</small></div></div>' : '') +
            '<div class="arena-private-info-card">' +
            row('Владелец', info.owner_name || 'Владелец') +
            row('Игровой раунд', '#' + (data?.round_id || info.round_no || 1)) +
            row('Общий банк', arenaFormat(data?.bank || '0') + ' GRAM') +
            row('Отсчёт ставок', info.bet_seconds + ' сек.') +
            row('Минимальная ставка', arenaFormat(info.min_bet) + ' GRAM') +
            row('Максимальная ставка', arenaFormat(info.max_bet) + ' GRAM') +
            row('Бот', info.bot_enabled ? (info.bot_name + ' · включён') : 'Выключен') +
            (info.is_owner ? row('Баланс бота', arenaFormat(info.bot_balance || '0') + ' GRAM') : '') +
            row('Комиссия', '8% с GRAM соперников') +
            row('Создана', created) + '</div>' +
            '<p class="arena-private-info-note">Ставки принимаются в GRAM и подарках NFT. ' +
            'Отсчёт начинается после ставки второго игрока. Шанс выигрыша ' +
            'пропорционален ставке; без соперника за 5 минут ставка возвращается. ' +
            (info.bot_enabled
                ? 'В этой группе играет бот «' + esc(info.bot_name) + '» с отдельным балансом, пополненным владельцем. ' +
                  'Если бот выигрывает NFT, подарки попадают в его инвентарь. Владелец может забрать их.</p>'
                : 'Бот в этой группе выключен.</p>') +
            '<div class="arena-private-info-actions">' +
            (info.is_owner ? '<button type="button" class="arena-private-info-primary" ' +
            'onclick="arenaPrivateSettings()">⚙ Настройки группы</button>' : '') +
            (info.is_owner ? '<button type="button" class="arena-private-info-secondary" ' +
            'onclick="arenaPrivateInventory()">🎁 Инвентарь бота</button>' : '') +
            '<button type="button" class="arena-private-info-secondary" ' +
            'onclick="arenaPrivateShareSheet(arenaPrivate.info)">Пригласить друзей</button>' +
            '<button type="button" class="arena-private-info-text" ' +
            'onclick="closeSheet();arenaOpenPrivateLobby()">Мои приватные группы</button>' +
            '</div></div>';
        sheet('Инфо · ' + info.name, detail);
    }).catch(error => {
        if (arena.view === view && arena.privateToken === token && appSheet.open) {
            sheet('Инфо · Приватная арена', '<div class="arena-private-info-loading">' +
                '<p>' + esc(error.message) + '</p>' +
                '<button type="button" class="arena-private-info-secondary" ' +
                'onclick="arenaPrivateInfo()">Повторить</button></div>');
        }
    });
}

function arenaPrivateSettings() {
    const info = arenaPrivate.info;
    if (!info?.is_owner || info.token !== arena.privateToken) {
        return toast('Настройки доступны только владельцу группы');
    }
    arenaPrivate.botImageReset = false;
    if (arenaPrivate.avatarPreviewUrl) URL.revokeObjectURL(arenaPrivate.avatarPreviewUrl);
    arenaPrivate.avatarPreviewUrl = null;
    const field = (label, name, value, extra) =>
        '<label>' + label + '<input name="' + name + '" value="' +
        esc(String(value)) + '" ' + extra + ' required></label>';
    sheet('Настройки · ' + info.name,
        '<form class="arena-private-form arena-private-edit-form" ' +
        'onsubmit="arenaSavePrivateSettings(event)">' +
        '<div class="arena-private-settings-head"><span>⚙</span><div>' +
        '<strong>Управление группой</strong><small>Доступно только создателю</small></div></div>' +
        field('Название группы', 'name', info.name,
              'type="text" maxlength="48" minlength="2"') +
        field('Время приёма ставок, сек.', 'bet_seconds', info.bet_seconds,
              'type="number" min="10" max="300" step="1"') +
        field('Максимальное количество игроков', 'max_players', info.max_players,
              'type="number" min="2" max="32" step="1"') +
        '<div class="arena-private-limits">' +
        field('Минимальная ставка, GRAM', 'min_bet', info.min_bet,
              'type="text" inputmode="decimal"') +
        field('Максимальная ставка, GRAM', 'max_bet', info.max_bet,
              'type="text" inputmode="decimal"') + '</div>' +
        '<section class="arena-private-bot-editor">' +
        '<div class="arena-private-bot-top"><div><strong>Бот в группе</strong>' +
        '<small>Автоматические ставки от имени бота</small></div>' +
        '<label class="arena-private-bot-switch"><input type="checkbox" name="bot_enabled" ' +
        (info.bot_enabled ? 'checked' : '') + '><span></span></label></div>' +
        '<div class="arena-private-bot-identity">' +
        '<img class="arena-private-bot-preview" id="arena-private-bot-preview" alt="Аватар бота" ' +
        'src="' + esc(info.bot_photo || '/static/assets/arena-crafter-bot.jpg') + '">' +
        '<div class="arena-private-bot-photo-actions">' +
        '<label class="arena-private-bot-upload">Загрузить аватар' +
        '<input name="bot_avatar" type="file" accept="image/*" ' +
        'onchange="arenaPrivateBotAvatarPreview(event)"></label>' +
        '<button type="button" onclick="arenaPrivateBotAvatarReset()">Сбросить</button>' +
        '</div></div>' +
        field('Имя бота', 'bot_name', info.bot_name || 'Crafter',
              'type="text" maxlength="24" minlength="2"') +
        '<p class="arena-private-info-note">Аватар виден участникам в ставках и результатах. ' +
        'Бот использует GRAM и NFT, переданные владельцем. Выигранные NFT хранятся в инвентаре бота, пока владелец не заберёт их.</p>' +
        '<button type="button" class="arena-private-bot-inventory-open" ' +
        'onclick="arenaPrivateInventory()">🎁 Инвентарь бота · Передать или забрать NFT</button>' +
        '<div class="arena-private-bot-bank"><div><span>Баланс бота</span>' +
        '<strong id="arena-private-bot-balance">' + arenaFormat(info.bot_balance || 0) +
        ' GRAM</strong></div>' +
        '<label>Сумма, GRAM<input name="bot_fund_amount" type="text" inputmode="decimal" ' +
        'value="1" placeholder="1"></label>' +
        '<div class="arena-private-bot-fund-actions">' +
        '<button type="button" onclick="arenaPrivateBotFunds(\'deposit\')">Пополнить</button>' +
        '<button type="button" onclick="arenaPrivateBotFunds(\'withdraw\')">Вернуть остаток</button>' +
        '</div></div></section>' +
        '<p class="arena-private-info-note">Настройки применяются к новым ставкам. ' +
        'При активных ставках изменение лимитов и таймера доступно после завершения раунда. ' +
        'Название можно менять в любое время.</p>' +
        '<button class="arena-private-submit" type="submit">Сохранить изменения</button>' +
        '<button class="arena-private-info-text" type="button" onclick="arenaPrivateInfo()">' +
        'Назад к информации</button></form>');
}

async function arenaSavePrivateSettings(event) {
    event.preventDefault();
    if (arenaPrivate.pending) return;
    const info = arenaPrivate.info;
    if (!info?.is_owner || info.token !== arena.privateToken) return;
    const form = event.currentTarget;
    const value = key => String(form.elements[key]?.value || '').trim().replace(',', '.');
    const minBet = Number(value('min_bet'));
    const maxBet = Number(value('max_bet'));
    if (!Number.isFinite(minBet) || minBet <= 0 ||
        !Number.isFinite(maxBet) || maxBet < minBet || maxBet > 1000000) {
        return toast('Проверьте минимальную и максимальную ставку');
    }
    const body = {
        name: value('name'),
        bet_seconds: Number(value('bet_seconds')),
        max_players: Number(value('max_players')),
        min_bet: value('min_bet'),
        max_bet: value('max_bet'),
        bot_enabled: Boolean(form.elements['bot_enabled'].checked),
        bot_name: value('bot_name')
    };
    const button = form.querySelector('[type=submit]');
    arenaPrivate.pending = true;
    button.disabled = true;
    button.textContent = 'Сохранение…';
    try {
        let updated = await api('arena/private/' + info.token + '/settings', body);
        const file = form.elements['bot_avatar']?.files?.[0];
        if (file || arenaPrivate.botImageReset) {
            const avatar = file ? await arenaPrivateBotFileToImage(file) : null;
            updated = {
                ...updated,
                ...await api('arena/private/' + info.token + '/bot-avatar', {image: avatar})
            };
        }
        if (arena.privateToken === info.token) {
            arenaPrivate.info = {...info, ...updated};
            if (arena.data?.private_room?.token === info.token) {
                arena.data.private_room = updated;
                arenaRenderControls();
            }
            toast('Настройки группы сохранены');
            await arenaPrivateInfo();
        }
    } catch(error) {
        toast(error.message);
    } finally {
        arenaPrivate.pending = false;
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = 'Сохранить изменения';
        }
    }
}


async function arenaPrivateInventory() {
    const info = arenaPrivate.info;
    if (!info?.is_owner || info.token !== arena.privateToken) return toast('Инвентарь доступен владельцу');
    arenaPrivate.inventoryMode = 'bot';
    arenaPrivate.inventorySelected = new Set();
    sheet('Инвентарь · ' + info.bot_name,
        '<div class="arena-private-info-loading">Загрузка инвентаря…</div>');
    await arenaPrivateInventoryReload(info.token);
}
async function arenaPrivateInventoryReload(token) {
    try {
        const response = await api('arena/private/' + token + '/bot-gifts');
        const data = {...response, owner_gifts: response.mine, bot_gifts: response.bot};
        if (token !== arena.privateToken || !appSheet.open) return;
        arenaPrivate.inventoryData = data;
        arenaPrivateInventoryRender();
    } catch (error) {
        if (token !== arena.privateToken || !appSheet.open) return;
        sheet('Инвентарь бота', '<p class="arena-private-inventory-error">' +
            esc(error.message) + '</p><button class="arena-private-info-secondary" ' +
            'onclick="arenaPrivateInventory()">Повторить</button>');
    }
}
function arenaPrivateInventoryTab(mode) {
    if (mode !== 'owner' && mode !== 'bot') return;
    arenaPrivate.inventoryMode = mode;
    arenaPrivate.inventorySelected = new Set();
    arenaPrivateInventoryRender();
}

function arenaPrivateInventoryRender() {
    const inv = arenaPrivate.inventoryData, info = arenaPrivate.info;
    if (!inv || !info?.is_owner || info.token !== arena.privateToken) return;
    const mine = arenaPrivate.inventoryMode === 'owner';
    const list = mine ? inv.owner_gifts : inv.bot_gifts;
    const chosen = arenaPrivate.inventorySelected || new Set();
    const locked = list.filter(item => item.status !== 'unlisted').length;
    const items = list.map(item => {
        const unavailable = item.status !== 'unlisted';
        const checked = chosen.has(item.id);
        return '<button type="button" class="arena-private-item ' +
            (checked ? 'is-selected ' : '') + (unavailable ? 'is-locked' : '') +
            '" data-gift-id="' + esc(item.id) + '" aria-pressed="' + checked + '" ' +
            (unavailable ? 'disabled' : 'onclick="arenaPrivateInventoryToggle(' + arg(item.id) + ')"') +
            '><span class="arena-private-item-image">' +
            '<img ' + giftPicture(item) + ' alt="" loading="lazy">' +
            '</span><span class="arena-private-item-name">' + esc(item.name) + '</span>' +
            '<span class="arena-private-item-model">' +
            esc(item.model || (item.number ? '#' + item.number : 'NFT')) + '</span>' +
            (unavailable ? '<span class="arena-private-item-status">В ставке</span>' :
                '<span class="arena-private-item-check">' + (checked ? '✓' : '+') + '</span>') +
            '</button>';
    }).join('');
    sheet('Инвентарь · ' + info.bot_name,
        '<div class="arena-private-inventory">' +
        '<div class="arena-private-inventory-balance">' +
        '<div><small>БАЛАНС БОТА</small><strong>' + arenaFormat(inv.bot_balance || 0) +
        ' GRAM</strong><span>' + esc(info.bot_name || 'Crafter') + '</span></div>' +
        '<span class="arena-private-inventory-symbol">◇</span></div>' +
        '<div class="arena-private-inventory-counts"><span>' + inv.bot_gifts.length +
        ' NFT у бота</span><span>' + inv.owner_gifts.length + ' ваших NFT</span></div>' +
        '<div class="arena-private-inventory-tabs" role="tablist">' +
        '<button type="button" role="tab" aria-selected="' + mine +
        '" onclick="arenaPrivateInventoryTab(&quot;owner&quot;)">Мои подарки</button>' +
        '<button type="button" role="tab" aria-selected="' + !mine +
        '" onclick="arenaPrivateInventoryTab(&quot;bot&quot;)">Инвентарь бота</button></div>' +
        '<p class="arena-private-inventory-hint">' +
        (mine ? 'Выберите подарки, которые хотите передать боту для ставок.' :
                'Выберите свободные подарки, которые хотите вернуть себе.') +
        (locked ? ' ' + locked + ' NFT сейчас в ставке.' : '') + '</p>' +
        '<div class="arena-private-inventory-grid">' +
        (items || '<div class="arena-private-inventory-empty">Пока нет подарков</div>') +
        '</div><div class="arena-private-inventory-bottom">' +
        '<button type="button" class="arena-private-inventory-transfer" disabled ' +
        'onclick="arenaPrivateInventoryMove()">' +
        (mine ? 'Передать боту' : 'Вернуть себе') + '</button>' +
        '<button type="button" class="arena-private-info-text" onclick="arenaPrivateSettings()">' +
        'Назад к настройкам</button></div></div>');
}

function arenaPrivateInventoryToggle(giftId) {
    const chosen = arenaPrivate.inventorySelected;
    const list = arenaPrivate.inventoryMode === 'owner'
        ? arenaPrivate.inventoryData?.owner_gifts : arenaPrivate.inventoryData?.bot_gifts;
    if (!chosen || !list?.some(gift => gift.id === giftId && gift.status === 'unlisted')) return;
    if (chosen.has(giftId)) chosen.delete(giftId);
    else {
        if (chosen.size >= 40) return toast('Можно выбрать максимум 40 NFT за раз');
        chosen.add(giftId);
    }
    document.querySelectorAll('.arena-private-item').forEach(button => {
        if (button.dataset.giftId !== giftId) return;
        const yes = chosen.has(giftId);
        button.classList.toggle('is-selected', yes);
        button.setAttribute('aria-pressed', String(yes));
        const check = button.querySelector('.arena-private-item-check');
        if (check) check.textContent = yes ? '✓' : '+';
    });
    const button = document.querySelector('.arena-private-inventory-transfer');
    if (button) {
        button.disabled = !chosen.size;
        button.textContent = (arenaPrivate.inventoryMode === 'owner'
            ? 'Передать боту' : 'Вернуть себе') + (chosen.size ? ' · ' + chosen.size + ' NFT' : '');
    }
}

async function arenaPrivateInventoryMove() {
    const info = arenaPrivate.info;
    const chosen = [...(arenaPrivate.inventorySelected || [])];
    if (!info?.is_owner || !chosen.length || arenaPrivate.pending) return;
    const action = arenaPrivate.inventoryMode === 'owner' ? 'deposit' : 'withdraw';
    const token = info.token;
    arenaPrivate.pending = true;
    const button = document.querySelector('.arena-private-inventory-transfer');
    if (button) {
        button.disabled = true;
        button.textContent = 'Передача…';
    }
    try {
        await api('arena/private/' + token + '/bot-gifts', {action, gift_ids: chosen});
        if (arena.privateToken !== token) return;
        arenaPrivate.inventorySelected = new Set();
        toast(action === 'deposit' ? 'Подарки переданы боту' : 'Подарки возвращены вам');
        await arenaPrivateInventoryReload(token);
    } catch (error) {
        toast(error.message);
        if (button?.isConnected) {
            button.disabled = false;
            button.textContent = action === 'deposit' ? 'Передать боту' : 'Вернуть себе';
        }
    } finally {
        arenaPrivate.pending = false;
    }
}
function arenaPrivateBotAvatarPreview(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
        input.value = '';
        return toast('Выберите изображение до 5 МБ');
    }
    if (arenaPrivate.avatarPreviewUrl) URL.revokeObjectURL(arenaPrivate.avatarPreviewUrl);
    arenaPrivate.avatarPreviewUrl = URL.createObjectURL(file);
    const preview = document.querySelector('#arena-private-bot-preview');
    if (preview) preview.src = arenaPrivate.avatarPreviewUrl;
    arenaPrivate.botImageReset = false;
}

function arenaPrivateBotAvatarReset() {
    const input = document.querySelector('.arena-private-edit-form [name="bot_avatar"]');
    if (input) input.value = '';
    if (arenaPrivate.avatarPreviewUrl) URL.revokeObjectURL(arenaPrivate.avatarPreviewUrl);
    arenaPrivate.avatarPreviewUrl = null;
    const preview = document.querySelector('#arena-private-bot-preview');
    if (preview) preview.src = '/static/assets/arena-crafter-bot.jpg';
    arenaPrivate.botImageReset = true;
}

function arenaPrivateBotFileToImage(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
            reject(Error('Выберите изображение до 5 МБ'));
            return;
        }
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            try {
                let dimension = 100;
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', {alpha: false});
                if (!context) throw Error('Ошибка подготовки изображения');
                let encoded = '';
                for (const size of [100, 88, 72]) {
                    dimension = size;
                    canvas.width = size;
                    canvas.height = size;
                    context.fillStyle = '#24242a';
                    context.fillRect(0, 0, size, size);
                    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
                    const width = image.naturalWidth * scale;
                    const height = image.naturalHeight * scale;
                    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
                    encoded = canvas.toDataURL('image/webp', .6);
                    if (encoded.startsWith('data:image/webp;base64,') && encoded.length <= 10500) {
                        resolve(encoded);
                        return;
                    }
                }
                throw Error('Не удалось сжать аватар — выберите другое фото');
            } catch(error) { reject(error); }
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(Error('Этот формат фото не поддерживается'));
        };
        image.src = objectUrl;
    });
}

async function arenaPrivateBotFunds(action) {
    const info = arenaPrivate.info;
    if (!info?.is_owner || !arena.privateToken || arenaPrivate.pending) return;
    const input = document.querySelector('.arena-private-edit-form [name="bot_fund_amount"]');
    if (!input) return;
    const amount = input.value.trim().replace(',', '.');
    const number = Number(amount);
    if (!/^[0-9]{1,7}(?:\.[0-9]{1,6})?$/.test(amount) ||
        !(number >= .000001 && number <= 1000000)) {
        return toast('Введите корректную сумму GRAM');
    }
    arenaPrivate.pending = true;
    const actions = document.querySelectorAll('.arena-private-bot-fund-actions button');
    actions.forEach(btn => btn.disabled = true);
    try {
        const result = await api('arena/private/' + info.token + '/bot-funds',
            {action, amount});
        arenaPrivate.info = {...info, ...result};
        if (result.owner_balance !== undefined) {
            state.me.balance = result.owner_balance;
            updateBalance();
        }
        const label = document.querySelector('#arena-private-bot-balance');
        if (label) label.textContent = arenaFormat(result.bot_balance) + ' GRAM';
        toast(action === 'deposit' ? 'Бот пополнен' : 'GRAM возвращены на ваш баланс');
    } catch(error) {
        toast(error.message);
    } finally {
        arenaPrivate.pending = false;
        actions.forEach(btn => btn.disabled = false);
    }
}

function arenaShowInvite(token) {
    leaveArena();
    arenaPrivate.inviteToken = token;
    const main = document.querySelector('#main');
    main.innerHTML = '<section class="arena-page arena-private-invite">' +
        '<div class="arena-private-loading">Проверяем приглашение…</div></section>';
    const view = arena.view;
    api('arena/private/' + token + '/invite').then(info => {
        if (view !== arena.view || state.page !== 'arena') return;
        arenaPrivate.info = info;
        main.innerHTML = '<section class="arena-page arena-private-invite">' +
            '<span class="arena-private-lock">♙</span>' +
            '<p class="arena-private-muted">Приглашение в приватную арену</p>' +
            '<h2>' + esc(info.name) + '</h2>' +
            '<p>' + info.members + ' из ' + info.max_players + ' участников</p>' +
            '<div class="arena-private-invite-rules">' +
            '<span>Отсчёт ставок<strong>' + info.bet_seconds + ' секунд</strong></span>' +
            '<span>Минимальная ставка<strong>' + arenaFormat(info.min_bet) + ' GRAM</strong></span>' +
            '<span>Максимальная ставка<strong>' + arenaFormat(info.max_bet) + ' GRAM</strong></span>' +
            '</div><button class="arena-private-join" onclick="arenaJoinPrivateRoom()" type="button">' +
            (info.joined ? 'Войти в группу' : 'Присоединиться к группе') + '</button>' +
            '<button type="button" class="arena-private-back" onclick="arenaSwitchRoom(1)">' +
            'Общая арена</button></section>';
    }).catch(error => {
        if (view !== arena.view) return;
        main.innerHTML = '<section class="arena-page arena-private-invite"><h2>Приглашение недоступно</h2>' +
            '<p>' + esc(error.message) + '</p>' +
            '<button class="arena-private-back" onclick="arenaSwitchRoom(1)">Вернуться в Арену</button></section>';
    });
}

async function arenaJoinPrivateRoom() {
    const token = arenaPrivate.inviteToken;
    if (!token || arenaPrivate.pending) return;
    arenaPrivate.pending = true;
    const button = document.querySelector('.arena-private-join');
    if (button) {
        button.disabled = true;
        button.textContent = 'Подключение…';
    }
    try {
        await api('arena/private/' + token + '/join', {});
        arenaPrivate.inviteAcknowledged = true;
        const url = new URL(location.href);
        url.searchParams.delete('arena_room');
        url.searchParams.delete('tgWebAppStartParam');
        history.replaceState(history.state, '', url);
        arenaEnterPrivateRoom(token);
    } catch(error) {
        toast(error.message);
        if (button) {
            button.disabled = false;
            button.textContent = 'Присоединиться к группе';
        }
    } finally {
        arenaPrivate.pending = false;
    }
}

async function arenaSharePrivateRoom() {
    const token = arena.privateToken;
    if (!token) return;
    try {
        const info = await api('arena/private/' + token + '/invite');
        if (arena.privateToken === token) arenaPrivateShareSheet(info);
    } catch(error) {
        toast(error.message);
    }
}

function arenaPrivateShareSheet(info) {
    arenaPrivate.info = info;
    const link = arenaPrivateLink(info);
    sheet('Пригласить в ' + info.name,
        '<div class="arena-private-share"><p>Группа доступна только по этой ссылке. ' +
        'Отправьте приглашение друзьям — они увидят экран вступления.</p>' +
        '<label>Ссылка для входа<input id="arena-private-share-link" type="text" ' +
        'readonly value="' + esc(link) + '"></label>' +
        '<button type="button" class="arena-private-submit" onclick="arenaCopyPrivateLink()">' +
        'Скопировать ссылку</button>' +
        '<button type="button" class="arena-private-share-telegram" ' +
        'onclick="arenaSharePrivateTelegram()">Поделиться в Telegram</button></div>');
}

async function arenaCopyPrivateLink() {
    const input = document.querySelector('#arena-private-share-link');
    if (!input) return;
    try {
        await navigator.clipboard.writeText(input.value);
        toast('Ссылка скопирована');
    } catch {
        input.select();
        const done = document.execCommand('copy');
        toast(done ? 'Ссылка скопирована' : 'Выделите ссылку и скопируйте');
    }
}

function arenaSharePrivateTelegram() {
    const info = arenaPrivate.info;
    if (!info) return;
    const link = arenaPrivateLink(info);
    const share = 'https://t.me/share/url?url=' + encodeURIComponent(link) +
        '&text=' + encodeURIComponent('Присоединяйся к нашей приватной арене «' + info.name + '»!');
    if (tg?.openTelegramLink) tg.openTelegramLink(share);
    else window.open(share, '_blank', 'noopener');
}
