/* "Мои заявки": a messenger. The list of applications (every one is its own chat) is a column on a desktop and a drawer on a phone. */
(function () {
    var $ = CR.$, esc = CR.esc, apps = [], current = 0, poll = null, listPoll = null;
    var shell = $('mshell'), veil = $('mveil');
    var SVG = function (path, extra) { return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '>' + path + '</svg>'; };
    var IC_WALLET = SVG('<path d="M4 7a2 2 0 0 1 2-2h11v4"/><rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="16.5" cy="13.5" r="1.2" fill="currentColor"/>');
    var IC_SUM = SVG('<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.4-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.8 0 2.5 5.2 1.2 5.2 3.8 0 1.2-1.2 1.9-2.7 1.9-1.2 0-2.3-.5-2.7-1.4M12 6.5V8M12 16v1.5"/>');
    var IC_LINK = SVG('<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>');
    var IC_INFO = SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r=".7" fill="currentColor"/>');
    var IC_COPY = SVG('<rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>');
    var IC_SEND = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 11.3 20 4.1c.9-.4 1.8.5 1.4 1.4l-7.2 16.6c-.4.9-1.7.9-2 0l-2-5.8-5.8-2c-.9-.3-.9-1.6 0-2Z"/></svg>';

    function openDrawer(on) { shell.classList.toggle('is-open', on); veil.hidden = !on; }
    $('m-menu').addEventListener('click', function () { openDrawer(!shell.classList.contains('is-open')); });
    veil.addEventListener('click', function () { openDrawer(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') openDrawer(false); });

    function renderList() {
        var box = $('mlist-body');
        if (!apps.length) { box.innerHTML = '<p class="empty">Заявок пока нет.<br><a href="/creators?apply=1">Подать заявку</a></p>'; return; }
        box.innerHTML = apps.map(function (a) {
            return '<button type="button" class="mitem' + (a.number === current ? ' is-on' : '') + '" data-n="' + a.number + '"><span class="logo-tt">' + CR.TT + '</span>' +
                '<span class="mi"><b>Заявка №' + a.number + (a.unread ? ' <i class="dot"></i>' : '') + '</b><small>' + esc(a.last_text || a.video_url) + '</small></span>' +
                '<span class="pill" data-s="' + a.status + '">' + esc(a.status_text) + '</span></button>';
        }).join('');
        box.querySelectorAll('.mitem').forEach(function (b) { b.addEventListener('click', function () { openChat(Number(b.dataset.n)); openDrawer(false); }); });
    }
    function loadList() {
        return CR.loadMe().then(function (d) { apps = d.applications; renderList(); return d; });
    }

    function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }
    function openChat(number) {
        current = number; stopPoll(); renderList();
        try { history.replaceState(null, '', '/creators/my?app=' + number); } catch (e) {}
        var pane = $('mchat');
        function draw(first) {
            CR.api('/api/creators/apps/' + number).then(function (d) {
                var a = d.application, log = $('chat-log'), atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 90;
                var msgs = d.messages.map(function (m) {
                    var mine = m.author === 'user';
                    return '<div class="msg' + (mine ? ' me' : '') + '">' + (mine ? '' : '<img src="/static/icons/crafter-192.png" alt="">') + '<div><div class="b">' + esc(m.text) + '</div><small>' + (mine ? 'Вы' : 'Поддержка Crafter') + ' · ' + CR.when(m.created) + '</small></div></div>';
                }).join('');
                if (first || !log) {
                    pane.innerHTML = '<div class="chat-head"><img src="/static/icons/crafter-192.png" alt=""><div class="ch-title"><b>Поддержка Crafter</b><small>Заявка №' + a.number + ' · ' + esc(a.platform_name) + '</small></div><button type="button" class="info-btn" id="info-btn" aria-label="Информация о заявке">' + IC_INFO + '<span>Инфо</span></button></div>' +
                        '<div class="chat-log" id="chat-log">' + msgs + '</div>' +
                        '<form class="chat-form" id="chat-form"><input type="text" id="chat-text" maxlength="1500" placeholder="Сообщение по заявке №' + a.number + '" autocomplete="off"><button type="submit" aria-label="Отправить">' + IC_SEND + '</button></form>';
                    $('chat-log').scrollTop = 1e9;
                    $('info-btn').addEventListener('click', function () { showInfo(number); });
                    $('chat-form').addEventListener('submit', function (e) {
                        e.preventDefault(); var inp = $('chat-text'), text = inp.value.trim(); if (!text) return; inp.value = '';
                        CR.api('/api/creators/apps/' + number + '/message', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: text})}).then(function () { draw(false); loadList(); }).catch(function (er) { inp.value = text; alert(er.message); });
                    });
                } else {
                    log.innerHTML = msgs; if (atBottom) log.scrollTop = 1e9;
                }
            }).catch(function (e) { if (first) pane.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
        }
        draw(true);
        poll = setInterval(function () { if (!document.hidden && current === number && $('chat-log')) draw(false); }, 6000);
    }

    function showInfo(number) {
        CR.api('/api/creators/apps/' + number).then(function (d) {
            var a = d.application;
            var row = function (k, v) { return '<div class="inf-row"><dt>' + k + '</dt><dd>' + v + '</dd></div>'; };
            CR.openModal('<h3>Заявка №' + a.number + '</h3><p class="hint">Вся информация по заявке.</p><dl class="inf">' +
                row('Статус', '<span class="pill" data-s="' + a.status + '">' + esc(a.status_text) + '</span>') +
                row('Платформа', esc(a.platform_name)) +
                row('Telegram', a.tg_username ? '@' + esc(a.tg_username) : '—') +
                row('Ролик', '<a href="' + esc(a.video_url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.video_url) + '</a>') +
                row('Просмотры', a.views ? Number(a.views).toLocaleString('ru-RU') : 'пока не подтверждены') +
                row('К выплате', a.amount ? esc(a.amount) + ' $' : 'пока не назначена') +
                row('Кошелёк (сеть Gram)', '<span class="wallet" id="inf-wallet">' + esc(a.wallet) + '</span><button type="button" class="copy" id="inf-copy" aria-label="Копировать адрес">' + IC_COPY + 'Копировать</button>') +
                row('Подана', CR.when(a.created)) +
                row('Обновлена', CR.when(a.updated)) + '</dl>');
            var copy = $('inf-copy');
            if (copy) copy.addEventListener('click', function () {
                var done = function () { copy.classList.add('is-done'); copy.lastChild.nodeValue = 'Скопировано'; };
                if (navigator.clipboard) navigator.clipboard.writeText(a.wallet).then(done).catch(done); else done();
            });
        }).catch(function (e) { CR.openModal('<h3>Ошибка</h3><p class="hint">' + esc(e.message) + '</p>'); });
    }

    function start() {
        loadList().then(function (d) {
            var wanted = Number(new URLSearchParams(location.search).get('app') || 0);
            var pick = d.applications.find(function (a) { return a.number === wanted; }) || d.applications[0];
            if (pick) openChat(pick.number); else $('mchat').innerHTML = '<p class="empty">Здесь будут ваши заявки и чаты с поддержкой.<br><a href="/creators?apply=1">Подать первую заявку</a></p>';
            if (!listPoll) listPoll = setInterval(function () { if (!document.hidden) loadList(); }, 15000);
        }).catch(function (e) {
            if (e.status === 401 || e.status === 403) CR.loginModal(start);
            else $('mchat').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
        });
    }
    start();
})();
