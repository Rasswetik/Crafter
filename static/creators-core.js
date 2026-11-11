/* Creators pages: shared helpers (sign-in through Telegram, API calls, the modal window). */
window.CR = (function () {
    var CR = {};
    var tg = null;
    try { tg = window.Telegram && window.Telegram.WebApp; if (tg) { tg.ready(); tg.expand(); } } catch (e) {}
    var SESSION_KEY = 'crafter-web-session';
    CR.$ = function (id) { return document.getElementById(id); };
    CR.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); };
    CR.when = function (ts) { return new Date(ts * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}); };
    CR.TT = '<svg viewBox="0 0 48 48" aria-hidden="true"><g transform="translate(-1.6 1.2)"><path fill="#25f4ee" d="M33 8c.6 3.9 2.9 6.3 6.7 6.7v5.2c-2.5 0-4.8-.7-6.7-2V30c0 6.2-4.4 10.4-10.2 10.4-5.7 0-10.1-4.2-10.1-9.9S17.2 21 22.8 21c.5 0 1 0 1.6.1v5.5c-.5-.2-1-.3-1.6-.3-2.5 0-4.4 1.8-4.4 4.2s1.9 4.2 4.3 4.2c2.7 0 4.4-1.9 4.4-4.9V8H33z"/></g><g transform="translate(1.6 -1.2)"><path fill="#fe2c55" d="M33 8c.6 3.9 2.9 6.3 6.7 6.7v5.2c-2.5 0-4.8-.7-6.7-2V30c0 6.2-4.4 10.4-10.2 10.4-5.7 0-10.1-4.2-10.1-9.9S17.2 21 22.8 21c.5 0 1 0 1.6.1v5.5c-.5-.2-1-.3-1.6-.3-2.5 0-4.4 1.8-4.4 4.2s1.9 4.2 4.3 4.2c2.7 0 4.4-1.9 4.4-4.9V8H33z"/></g><path fill="#fff" d="M33 8c.6 3.9 2.9 6.3 6.7 6.7v5.2c-2.5 0-4.8-.7-6.7-2V30c0 6.2-4.4 10.4-10.2 10.4-5.7 0-10.1-4.2-10.1-9.9S17.2 21 22.8 21c.5 0 1 0 1.6.1v5.5c-.5-.2-1-.3-1.6-.3-2.5 0-4.4 1.8-4.4 4.2s1.9 4.2 4.3 4.2c2.7 0 4.4-1.9 4.4-4.9V8H33z"/></svg>';

    CR.headers = function (extra) {
        var h = extra || {};
        if (tg && tg.initData) h['X-Telegram-Init-Data'] = tg.initData;
        else { try { var s = localStorage.getItem(SESSION_KEY); if (s) h['X-Crafter-Web-Session'] = s; } catch (e) {} }
        return h;
    };
    CR.api = function (path, options) {
        options = options || {};
        options.headers = CR.headers(options.headers);
        return fetch(path, options).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                if (!r.ok) { var e = new Error(data.error || data.description || data.message || ('Ошибка ' + r.status)); e.status = r.status; throw e; }
                return data;
            });
        });
    };
    CR.me = null;
    CR.loadMe = function () { return CR.api('/api/creators/me').then(function (d) { CR.me = d; if (CR.onMe) CR.onMe(d); return d; }); };

    var modal = CR.$('modal'), body = CR.$('modal-body'), loginTimer = null;
    function stopLogin() { if (loginTimer) { clearInterval(loginTimer); loginTimer = null; } }
    CR.openModal = function (html) { body.innerHTML = html; modal.hidden = false; };
    CR.closeModal = function () { modal.hidden = true; body.innerHTML = ''; stopLogin(); };
    if (modal) {
        CR.$('modal-x').addEventListener('click', CR.closeModal);
        modal.addEventListener('click', function (e) { if (e.target === modal) CR.closeModal(); });
    }

    CR.loginModal = function (then) {
        CR.openModal('<h3>Авторизируйтесь в Telegram</h3><p class="hint">Заявка привязывается к вашему аккаунту Telegram: так мы напишем вам в бот и покажем статус. Нажмите кнопку, подтвердите вход в боте и вернитесь на эту страницу.</p>' +
            '<button type="button" class="btn big" id="login-go">Войти через Telegram</button><p class="err" id="login-err"></p>');
        CR.$('login-go').addEventListener('click', function () {
            var btn = this; btn.disabled = true; btn.textContent = 'Ждём подтверждения…';
            fetch('/api/web-login/start', {method: 'POST'}).then(function (r) { return r.json(); }).then(function (d) {
                if (!d.token) throw new Error(d.error || 'Не удалось начать вход');
                window.open(d.link, '_blank');
                var tries = 0;
                loginTimer = setInterval(function () {
                    tries++;
                    fetch('/api/web-login/claim', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token: d.token, secret: d.secret})})
                        .then(function (r) { return r.json(); }).then(function (c) {
                            if (c.status === 'ok' && c.session) { try { localStorage.setItem(SESSION_KEY, c.session); } catch (e) {} stopLogin(); CR.loadMe().then(function () { CR.closeModal(); then(); }); }
                        }).catch(function () {});
                    if (tries > 150) { stopLogin(); btn.disabled = false; btn.textContent = 'Войти через Telegram'; CR.$('login-err').textContent = 'Время вышло. Попробуйте ещё раз.'; }
                }, 2000);
            }).catch(function (e) { btn.disabled = false; btn.textContent = 'Войти через Telegram'; CR.$('login-err').textContent = e.message; });
        });
    };
    /* runs `then` when the player is signed in; otherwise asks to sign in with Telegram first */
    CR.withLogin = function (then) {
        CR.loadMe().then(then).catch(function (e) {
            if (e.status === 401 || e.status === 403) CR.loginModal(then);
            else CR.openModal('<h3>Ошибка</h3><p class="hint">' + CR.esc(e.message) + '</p>');
        });
    };
    return CR;
})();
