/* "Мои заявки": a messenger. The list of applications (every one is its own chat) is a column on a desktop and a drawer on a phone. */
(function () {
    var $ = CR.$, esc = CR.esc, apps = [], current = 0, poll = null, listPoll = null;
    var shell = $('mshell'), drawer = $('mlist'), veil = $('mveil');

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
                    pane.innerHTML = '<div class="chat-head"><img src="/static/icons/crafter-192.png" alt=""><div><b>Поддержка Crafter</b><small>Заявка №' + a.number + ' · ' + esc(a.platform_name) + '</small></div><span class="pill back" data-s="' + a.status + '" id="chat-status">' + esc(a.status_text) + '</span></div>' +
                        '<div class="chat-meta"><span>Кошелёк (Gram): <b>' + esc(a.wallet.slice(0, 6) + '…' + a.wallet.slice(-6)) + '</b></span><span id="chat-sum">' + (a.amount ? 'К выплате: <b>' + esc(a.amount) + ' $</b>' : '') + '</span><a href="' + esc(a.video_url) + '" target="_blank" rel="noopener noreferrer">Ролик ↗</a></div>' +
                        '<div class="chat-log" id="chat-log">' + msgs + '</div>' +
                        '<form class="chat-form" id="chat-form"><input type="text" id="chat-text" maxlength="1500" placeholder="Сообщение по заявке №' + a.number + '" autocomplete="off"><button type="submit" aria-label="Отправить">➤</button></form>';
                    $('chat-log').scrollTop = 1e9;
                    $('chat-form').addEventListener('submit', function (e) {
                        e.preventDefault(); var inp = $('chat-text'), text = inp.value.trim(); if (!text) return; inp.value = '';
                        CR.api('/api/creators/apps/' + number + '/message', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: text})}).then(function () { draw(false); loadList(); }).catch(function (er) { inp.value = text; alert(er.message); });
                    });
                } else {
                    log.innerHTML = msgs; if (atBottom) log.scrollTop = 1e9;
                    var st = $('chat-status'); if (st) { st.dataset.s = a.status; st.textContent = a.status_text; }
                    var sm = $('chat-sum'); if (sm) sm.innerHTML = a.amount ? 'К выплате: <b>' + esc(a.amount) + ' $</b>' : '';
                }
            }).catch(function (e) { if (first) pane.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
        }
        draw(true);
        poll = setInterval(function () { if (!document.hidden && current === number && $('chat-log')) draw(false); }, 6000);
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
