/* Admin: one search box for players and sections (also "/" or Ctrl+K), distinct menu icons, a saner section order. */
(function () {
    'use strict';

    // ---- icons: every section gets its own picture instead of five identical gifts ----
    const GLYPHS = {
        users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
        chart: 'M4 20V10m6 10V4m6 16v-8m6 8H2',
        clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
        ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
        wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6 2.2-2.2Z',
        diamond: 'M12 3 4 9l8 12 8-12-8-6ZM4 9h16',
        hexagon: 'M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5ZM12 12l8-4.5M12 12v9.5M12 12 4 7.5',
        bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
        antenna: 'M4 12a8 8 0 0 1 16 0M8 12a4 4 0 0 1 8 0M12 12.5V21',
        hammer: 'M14 4l6 6-3 3-6-6 3-3ZM11 7 3 15v3h3l8-8',
        sliders: 'M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2M12 4v4M8 10v4M16 16v4',
        percent: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9h.01M15 15h.01M15 9l-6 6',
        swords: 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2',
        trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H3v2a3 3 0 0 0 4 2.8M17 6h4v2a3 3 0 0 1-4 2.8',
        ticket: 'M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3v3ZM13 6v12',
        video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
        tag: 'M3 12V3h9l9 9-9 9-9-9ZM7.5 7.5h.01',
        image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9.5h.01',
        megaphone: 'M3 11v3h4l8 5V6L7 11H3ZM18 9a4 4 0 0 1 0 6',
        snow: 'M12 2v20M4 7l16 10M20 7 4 17M9 4l3 2 3-2M9 20l3-2 3 2',
        paper: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
        database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
        key: 'M15 7a4 4 0 1 1-3.2 6.4L4 21v-3l2-2h2v-2h2l1.8-1.8A4 4 0 0 1 15 7Z',
    };
    if (typeof paths === 'object') Object.assign(paths, GLYPHS);

    // [id, group, glyph] in the order they appear in the menu: overview, money, management, system.
    const LAYOUT = [
        ['finance', 'main', 'chart'], ['users', 'main', 'users'], ['audit', 'main', 'clock'], ['cancellations', 'main', 'ban'],
        ['ton_withdraw', 'money', 'diamond'], ['nft_withdraw', 'money', 'hexagon'], ['tonconnect', 'money', 'bolt'],
        ['relayer', 'money', 'antenna'], ['creators', 'money', 'video'],
        ['crafts', 'manage', 'hammer'], ['modes', 'manage', 'sliders'], ['new-year', 'manage', 'season'], ['pass', 'manage', 'ticket'], ['characters', 'manage', 'users'],
        ['events', 'manage', 'trophy'], ['arena', 'manage', 'swords'], ['staking', 'manage', 'percent'], ['promocodes', 'manage', 'tag'],
        ['banners', 'manage', 'image'], ['craft_banner', 'manage', 'image'], ['ice_banner', 'manage', 'image'],
        ['maintenance', 'system', 'wrench'], ['portal', 'system', 'market'], ['telegram-bot', 'system', 'paper'],
        ['announcements', 'system', 'megaphone'], ['snow', 'system', 'snow'], ['data-reset', 'system', 'database'], ['admins', 'system', 'key'],
    ];
    if (typeof adminSections === 'object') {
        const old = {...adminSections};
        Object.keys(adminSections).forEach(key => delete adminSections[key]);
        LAYOUT.forEach(([id, group, glyph]) => { if (old[id]) { adminSections[id] = {...old[id], group, glyph}; delete old[id]; } });
        Object.keys(old).forEach(id => { adminSections[id] = old[id]; });          // anything not listed stays, at the end
    }

    // ---- search ----
    const RECENT_KEY = 'crafter-admin-recent-users';
    const recent = {
        get() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 5); } catch (_) { return []; } },
        add(u) {
            try {
                const list = this.get().filter(x => x.id !== u.id);
                list.unshift({id: u.id, name: u.name || '', username: u.username || ''});
                localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
            } catch (_) { /* storage may be blocked */ }
        },
    };

    const canUsers = () => typeof adminCanOpenSection !== 'function' || adminCanOpenSection('users');
    const money = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 2}) : '—'; };

    function matchSections(q) {
        const needle = q.toLowerCase();
        return Object.entries(adminSections || {})
            .filter(([id, s]) => (typeof adminCanOpenSection !== 'function' || adminCanOpenSection(id)) &&
                (s.label + ' ' + s.detail).toLowerCase().includes(needle))
            .slice(0, 6).map(([id, s]) => ({id, ...s}));
    }

    function userItem(u) {
        const name = u.name || 'Пользователь';
        const meta = (u.username ? '@' + u.username + ' · ' : '') + 'ID ' + u.id;
        const extra = u.balance === undefined ? '' :
            '<span class="aq-extra">' + esc(money(u.balance)) + ' GRAM · ' + Number(u.gifts || 0) + ' подар.' + (u.banned ? ' · <b>блок</b>' : '') + '</span>';
        return '<button type="button" class="aq-item" data-user="' + Number(u.id) + '" data-name="' + esc(name) + '" data-username="' + esc(u.username || '') + '">' +
            '<span class="aq-ava">' + esc(name.slice(0, 1).toUpperCase()) + '</span>' +
            '<span class="aq-main"><b>' + esc(name) + '</b><small>' + esc(meta) + '</small></span>' + extra + '</button>';
    }

    function sectionItem(s) {
        return '<button type="button" class="aq-item" data-section="' + esc(s.id) + '">' +
            '<span class="aq-ico">' + icon(s.glyph) + '</span>' +
            '<span class="aq-main"><b>' + esc(s.label) + '</b><small>' + esc(s.detail) + '</small></span></button>';
    }

    function box() {
        const node = document.createElement('div');
        node.className = 'aq';
        node.setAttribute('role', 'search');
        node.innerHTML = '<label class="aq-box">' + icon('search') +
            '<input class="aq-input" type="search" autocomplete="off" spellcheck="false" ' +
            'placeholder="Найти игрока (имя, @username, ID) или раздел" aria-label="Поиск по админке">' +
            '<kbd class="aq-key" aria-hidden="true">/</kbd></label><div class="aq-results" hidden></div>';
        const input = node.querySelector('.aq-input');
        const out = node.querySelector('.aq-results');
        let seq = 0, timer = 0;

        const close = () => { out.hidden = true; };
        const show = html => { out.innerHTML = html; out.hidden = !html; };
        const group = (title, body) => body ? '<div class="aq-group"><span class="aq-title">' + title + '</span>' + body + '</div>' : '';

        async function run() {
            const q = input.value.trim();
            const ticket = ++seq;
            if (!q) {
                const last = recent.get();
                show(last.length ? group('Недавние игроки', last.map(userItem).join('')) : '<p class="aq-hint">Введите имя, @username или Telegram ID игрока, либо название раздела.</p>');
                return;
            }
            const sections = matchSections(q);
            show(group('Разделы', sections.map(sectionItem).join('')) + (canUsers() ? '<p class="aq-hint">Ищем игроков…</p>' : ''));
            if (!canUsers()) { if (!sections.length) show('<p class="aq-hint">Ничего не найдено</p>'); return; }
            try {
                const data = await api('admin/users?search=' + encodeURIComponent(q));
                if (ticket !== seq) return;
                const users = (data.users || []).slice(0, 8);
                const more = (data.users || []).length > users.length || data.has_more;
                show(group('Игроки', users.map(userItem).join('')) + group('Разделы', sections.map(sectionItem).join('')) +
                    (more ? '<p class="aq-hint">Показаны первые ' + users.length + '. Уточните запрос или откройте раздел «Пользователи».</p>' : '') +
                    (!users.length && !sections.length ? '<p class="aq-hint">Ничего не найдено. Проверьте написание или введите Telegram ID.</p>' : ''));
            } catch (error) {
                if (ticket === seq) show(group('Разделы', sections.map(sectionItem).join('')) + '<p class="aq-hint is-error">' + esc(error.message || 'Поиск недоступен') + '</p>');
            }
        }

        function pick(item) {
            if (!item) return;
            close();
            input.blur();
            if (item.dataset.user) {
                recent.add({id: Number(item.dataset.user), name: item.dataset.name, username: item.dataset.username});
                if (typeof openAdminUserPage === 'function') openAdminUserPage(Number(item.dataset.user));
            } else if (item.dataset.section && typeof openAdminSection === 'function') {
                openAdminSection(item.dataset.section);
            }
        }

        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
        input.addEventListener('focus', run);
        input.addEventListener('keydown', event => {
            const items = [...out.querySelectorAll('.aq-item')];
            const at = items.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') { event.preventDefault(); (items[at + 1] || items[0])?.focus(); }
            else if (event.key === 'Enter') { event.preventDefault(); pick(items[0]); }
            else if (event.key === 'Escape') { close(); input.blur(); }
        });
        out.addEventListener('keydown', event => {
            const items = [...out.querySelectorAll('.aq-item')];
            const at = items.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') { event.preventDefault(); (items[at + 1] || items[0]).focus(); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); (at > 0 ? items[at - 1] : input).focus(); }
            else if (event.key === 'Escape') { close(); input.focus(); }
        });
        out.addEventListener('click', event => pick(event.target.closest('.aq-item')));
        document.addEventListener('click', event => { if (!node.contains(event.target)) close(); });
        return node;
    }

    function mount() {
        if (document.querySelector('.aq')) return;
        const header = document.querySelector('.admin-workspace-header');
        const userPage = document.querySelector('.admin-user-page');
        if (header) header.insertAdjacentElement('beforebegin', box());
        else if (userPage) userPage.insertAdjacentElement('afterbegin', box());
    }

    document.addEventListener('keydown', event => {
        const tag = (event.target.tagName || '').toLowerCase();
        const typing = ['input', 'textarea', 'select'].includes(tag) || event.target.isContentEditable;
        if ((event.key === '/' && !typing && !event.ctrlKey && !event.metaKey) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
            const input = document.querySelector('.aq-input');
            if (input) { event.preventDefault(); input.focus(); input.select(); }
        }
    });

    // If the menu was already drawn in the old order (slow script load), draw it again.
    if (document.getElementById('admin-navigation') && typeof renderAdmin === 'function') renderAdmin();

    const main = document.getElementById('main');
    if (main) {
        new MutationObserver(mount).observe(main, {childList: true, subtree: true});
        mount();
    }
})();
