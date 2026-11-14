/* The page of the season is a separate document: it has its own small core (sign-in through Telegram or the web session, API calls, toasts)
   that the scripts of chests and drops expect as globals: api(), esc(), toast(). */
(function () {
'use strict';
var tg = null;
try { tg = window.Telegram && window.Telegram.WebApp; if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor && tg.setHeaderColor('#1a0f4a'); tg.setBackgroundColor && tg.setBackgroundColor('#1a0f4a'); } } catch (_) {}
var SESSION = 'crafter:telegram-session', WEB = 'crafter-web-session';
function headers() {
    var h = {'Content-Type': 'application/json'}, data = '';
    try { data = (tg && tg.initData) || sessionStorage.getItem(SESSION) || ''; } catch (_) {}
    if (data) h['X-Telegram-Init-Data'] = data;
    else { try { var w = localStorage.getItem(WEB); if (w) h['X-Crafter-Web-Session'] = w; } catch (_) {} }
    return h;
}
window.esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); };
window.api = async function (path, body) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
        var upload = typeof FormData !== 'undefined' && body instanceof FormData, h = headers();
        if (upload) delete h['Content-Type'];
        var response = await fetch('/api/' + path, {method: body === undefined ? 'GET' : 'POST', signal: controller.signal, headers: h, body: body === undefined ? undefined : (upload ? body : JSON.stringify(body))});
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) { var err = new Error(data.error || data.description || 'Ошибка запроса'); err.status = response.status; throw err; }
        return data;
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('Сервер не отвечает, попробуйте ещё раз');
        throw err;
    } finally { clearTimeout(timer); }
};
window.toast = function (message) {
    var box = document.getElementById('sp-toasts');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'sp-toast';
    el.textContent = message;
    box.appendChild(el);
    setTimeout(function () { el.classList.add('is-out'); setTimeout(function () { el.remove(); }, 300); }, 2600);
};
})();
