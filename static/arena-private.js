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
        '<div class="arena-private-top"><h2>Приватные комнаты</h2>' + arenaRoomTabs(2) + '</div>' +
        '<div class="arena-private-intro"><span class="arena-private-lock">♙</span>' +
        '<h2>Создайте свою группу</h2>' +
        '<p>Только те, кому вы отправите ссылку, смогут присоединиться и делать ставки.</p></div>' +
        '<h3 class="arena-private-subheading">Ваши группы</h3>' +
        '<div id="arena-private-list"><p class="arena-private-muted">Загрузка…</p></div>' +
        '<div class="arena-dock arena-private-dock"><button class="arena-private-create" type="button" ' +
        'onclick="arenaNewRoomForm()">+ Создать комнату</button></div></section>';
    const view = arena.view;
    api('arena/private').then(data => {
        if (view !== arena.view || state.page !== 'arena') return;
        const root = document.querySelector('#arena-private-list');
        if (!root) return;
        root.innerHTML = data.rooms.length ? data.rooms.map(room =>
            '<button class="arena-private-room-card" type="button" onclick="arenaEnterPrivateRoom(' +
            arg(room.token) + ')">' +
            '<span><strong>' + esc(room.name) + '</strong>' +
            '<small>' + room.members + '/' + room.max_players +
            ' участников · ' + arenaFormat(room.min_bet) + '–' +
            arenaFormat(room.max_bet) + ' GRAM</small></span><b>Открыть ›</b></button>'
        ).join('') : '<p class="arena-private-muted">У вас пока нет групп. Создайте свою или перейдите по приглашению.</p>';
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

function arenaRenderPrivateMeta(info) {
    const root = document.querySelector('#arena-private-meta');
    const key = info.token + ':' + info.members;
    if (!root || root.dataset.roomKey === key) return;
    root.dataset.roomKey = key;
    root.hidden = false;
    root.innerHTML = '<div class="arena-private-heading"><span><strong>' + esc(info.name) +
        '</strong><small>Приватная группа · ' + info.members + '/' + info.max_players +
        ' игроков · ' + info.bet_seconds + ' с</small></span>' +
        '<button type="button" onclick="arenaSharePrivateRoom()">Пригласить ↗</button></div>' +
        '<div class="arena-private-stakes-range">Ставка ' + arenaFormat(info.min_bet) +
        '–' + arenaFormat(info.max_bet) + ' GRAM</div>';
    // The room itself has betting controls. Keep a permanent way to create
    // another private room or return to the Room 2 lobby without placing bets.
    const toolbar = document.querySelector('#arena-private-toolbar');
    if (toolbar) {
        toolbar.hidden = false;
        toolbar.innerHTML = '<span class="arena-private-current" title="' + esc(info.name) +
            '">' + esc(info.name) + '</span>' +
            '<button type="button" onclick="arenaOpenPrivateLobby()">Мои группы</button>' +
            '<button type="button" onclick="arenaNewRoomForm()">+ Создать комнату</button>';
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
