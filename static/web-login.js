/* Website sign-in through Telegram.
   Browser: "Sign in with Telegram" -> Telegram opens the Mini App -> "Confirm" -> Telegram opens the browser -> signed in.
   Mini App: shows the confirmation window when opened with startapp=login_<token>. */
(function () {
'use strict';
const SESSION_KEY = 'crafter-web-session', PENDING_KEY = 'crafter-web-login';
const inTelegram = () => Boolean(window.Telegram?.WebApp?.initData);
const esc2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const plane = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M21.9 4.1 2.8 11.5c-1 .4-1 1.2-.2 1.4l4.9 1.5 1.9 5.8c.2.6.4.8.9.8s.7-.2 1-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.7-.9l3.2-15.3c.3-1.3-.5-1.9-1.6-1.4ZM8.6 13.6l9.5-6c.4-.3.9-.1.5.3l-7.8 7.1-.3 3.2-1.9-4.6Z"/></svg>';

async function post(path, body) {
    const response = await fetch('/api/' + path, {method: 'POST', headers: {'Content-Type': 'application/json'},
                                                  body: JSON.stringify(body || {})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const e = Error(data.error || 'Ошибка запроса'); e.status = response.status; throw e; }
    return data;
}
function saveSession(value) { try { localStorage.setItem(SESSION_KEY, value); } catch (_) {} }
function readPending() { try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (_) { return null; } }
function savePending(value) { try { value ? sessionStorage.setItem(PENDING_KEY, JSON.stringify(value)) : sessionStorage.removeItem(PENDING_KEY); } catch (_) {} }

/* ---------- the browser side ---------- */
async function claimFromReturnLink() {
    const params = new URLSearchParams(location.search), token = params.get('login'), code = params.get('code');
    if (!token || !code) return;
    try {
        const result = await post('web-login/claim', {token, code});
        if (result.session) saveSession(result.session);
    } catch (_) { /* the starting tab may already have signed in */ }
    history.replaceState(null, '', location.pathname);
}

function shell(inner) {
    let root = document.querySelector('#crafter-web-login');
    if (!root) { root = document.createElement('div'); root.id = 'crafter-web-login'; document.body.append(root); }
    root.innerHTML = `<div class="cwl-card" role="dialog" aria-modal="true" aria-label="Вход в Crafter">${inner}</div>`;
    document.documentElement.classList.add('cwl-open');
    return root;
}

function loginScreen(message = '') {
    const root = shell(`
        <div class="cwl-mark" aria-hidden="true"><span>C</span></div>
        <h1>Добро пожаловать в Crafter</h1>
        <p>Войдите через Telegram, чтобы открыть маркет, игры и свой инвентарь. Пароль не нужен.</p>
        <button type="button" class="cwl-button" id="cwl-start">${plane}<span>Авторизоваться через Telegram</span></button>
        <small class="cwl-note">${message ? esc2(message) : 'Откроется Telegram, подтвердите вход одной кнопкой, и вы вернётесь на сайт.'}</small>`);
    root.querySelector('#cwl-start').onclick = startLogin;
}

function waitingScreen(link, appLink) {
    const root = shell(`
        <div class="cwl-spinner" aria-hidden="true"></div>
        <h1>Подтвердите вход в Telegram</h1>
        <p>Мы открыли Telegram. Нажмите «Подтвердить» в окне Crafter. После этого вы автоматически вернётесь на сайт.</p>
        <a class="cwl-button" href="${esc2(link)}" target="_blank" rel="noopener">${plane}<span>Открыть Telegram ещё раз</span></a>
        <a class="cwl-link" href="${esc2(appLink)}">Открыть в приложении Telegram</a>
        <button type="button" class="cwl-cancel" id="cwl-cancel">Отмена</button>`);
    root.querySelector('#cwl-cancel').onclick = () => { savePending(null); loginScreen(); };
}

let polling = 0;
async function poll(pending) {
    const run = ++polling;
    while (run === polling && Date.now() < pending.until) {
        try {
            const result = await post('web-login/claim', {token: pending.token, secret: pending.secret});
            if (result.session) { saveSession(result.session); savePending(null); location.replace('/'); return; }
        } catch (error) {
            if (error.status === 410) break;
            if (error.status === 409) {            // the return link already signed this browser in
                savePending(null);
                location.replace('/');
                return;
            }
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    if (run === polling) { savePending(null); loginScreen('Время подтверждения истекло. Попробуйте ещё раз.'); }
}

async function startLogin() {
    const button = document.querySelector('#cwl-start');
    if (button) button.disabled = true;
    try {
        const started = await post('web-login/start');
        const pending = {token: started.token, secret: started.secret, link: started.link, appLink: started.app_link,
                         until: Date.now() + started.expires_in * 1000};
        savePending(pending);
        window.open(started.link, '_blank', 'noopener');     // runs inside the click: popups are allowed
        waitingScreen(pending.link, pending.appLink);
        poll(pending);
    } catch (error) {
        loginScreen(error.message);
    }
}

/* Profile: "Sign out", shown on the website only (never inside the Telegram Mini App). */
const exitIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
async function signOut() {
    try { await fetch('/api/web-login/logout', {method: 'POST', headers: {'X-Crafter-Web-Session': crafterWebSession()}}); } catch (_) {}
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
    location.replace('/');
}
function profileLogout() {
    if (inTelegram()) return;
    const main = document.querySelector('#main');
    if (!main || main.querySelector('.cwl-profile-logout')) return;
    const user = state?.me?.user || {};
    const handle = user.username ? '@' + user.username : (user.first_name || user.name || '');
    const section = document.createElement('section');
    section.className = 'cwl-profile-logout';
    section.setAttribute('aria-label', 'Аккаунт на сайте');
    const idle = () => {
        section.innerHTML = `<div class="cwl-pl-info"><small>Вы вошли на сайте</small><b>${esc2(handle)}</b></div>
            <button type="button" class="cwl-pl-button" id="cwl-pl-ask">${exitIcon}<span>Выйти из аккаунта</span></button>`;
        section.querySelector('#cwl-pl-ask').onclick = ask;
    };
    const ask = () => {
        section.innerHTML = `<div class="cwl-pl-info"><b>Выйти из аккаунта?</b><small>Чтобы вернуться, понадобится снова войти через Telegram.</small></div>
            <div class="cwl-pl-actions"><button type="button" class="cwl-pl-stay" id="cwl-pl-stay">Остаться</button>
            <button type="button" class="cwl-pl-out" id="cwl-pl-out">Выйти</button></div>`;
        section.querySelector('#cwl-pl-stay').onclick = idle;
        section.querySelector('#cwl-pl-out').onclick = signOut;
    };
    idle();
    main.append(section);
}
if (typeof renderProfile === 'function') {
    const baseProfile = renderProfile;
    renderProfile = function () {
        const result = baseProfile.apply(this, arguments);
        try { profileLogout(); } catch (_) { /* the profile still works without the button */ }
        return result;
    };
}

/* ---------- the Mini App side ---------- */
function confirmWindow(info, token, error) {
    const root = shell(error ? `
        <h1>Вход недоступен</h1><p>${esc2(error)}</p>
        <button type="button" class="cwl-cancel" id="cwl-close">Закрыть</button>` : `
        <div class="cwl-mark" aria-hidden="true"><span>C</span></div>
        <h1>Подтвердите вход на сайт</h1>
        <p>Кто-то пытается войти в ваш аккаунт Crafter на сайте.</p>
        <div class="cwl-device">${esc2(info.device)}</div>
        <button type="button" class="cwl-button" id="cwl-confirm"><span>Подтвердить вход</span></button>
        <button type="button" class="cwl-cancel" id="cwl-close">Это не я, отмена</button>
        <small class="cwl-note">Подтверждайте, только если вход начали вы.</small>`);
    root.querySelector('#cwl-close').onclick = () => { root.remove(); document.documentElement.classList.remove('cwl-open'); window.Telegram?.WebApp?.close?.(); };
    const confirm = root.querySelector('#cwl-confirm');
    if (!confirm) return;
    confirm.onclick = async () => {
        confirm.disabled = true;
        try {
            const result = await api('web-login/confirm', {token});
            const back = location.origin + '/?login=' + encodeURIComponent(token) + '&code=' + encodeURIComponent(result.code);
            shell(`<div class="cwl-mark is-ok" aria-hidden="true"><span>✓</span></div><h1>Готово</h1>
                   <p>Возвращаем вас в браузер. Если он не открылся, нажмите кнопку ниже.</p>
                   <a class="cwl-button" href="${esc2(back)}" target="_blank" rel="noopener"><span>Вернуться в браузер</span></a>`);
            try { window.Telegram.WebApp.openLink(back); } catch (_) { window.open(back, '_blank'); }
            setTimeout(() => window.Telegram?.WebApp?.close?.(), 2500);
        } catch (e) {
            confirmWindow(null, token, e.message);
        }
    };
}

async function offerConfirmation() {
    const param = window.Telegram?.WebApp?.initDataUnsafe?.start_param || '';
    const match = /^login_([A-Za-z0-9_-]{16,40})$/.exec(param);
    if (!match) return;
    try { confirmWindow(await api('web-login/info?token=' + encodeURIComponent(match[1])), match[1]); }
    catch (error) { confirmWindow(null, match[1], error.message); }
}

/* ---------- hook into the existing start-up ---------- */
const originalBoot = boot;
boot = async function () {
    if (!inTelegram()) {
        await claimFromReturnLink();
        const headers = crafterWebSession() ? {'X-Crafter-Web-Session': crafterWebSession()} : {};
        let status = 200, maintenance = false, launch = false;
        try {
            const answer = await fetch('/api/me', {headers});
            status = answer.status;
            if (status === 503) {
                const info = await answer.json().catch(() => ({}));
                maintenance = Boolean(info.maintenance);
                launch = Boolean(info.launch);
                if (launch && typeof window.crafterShowLaunch === 'function') window.crafterShowLaunch(info.opens_at, info.now);
            }
        } catch (_) { /* offline: let the normal error show */ }
        // During maintenance a visitor without a session signs in first: administrators are let through afterwards.
        if (launch) return;                                   // the countdown screen is shown: nothing else to do until the opening
        if (status === 401 || (maintenance && !crafterWebSession())) {
            const pending = readPending();
            if (pending && Date.now() < pending.until) { waitingScreen(pending.link, pending.appLink); poll(pending); }
            else loginScreen();
            return;
        }
    }
    await originalBoot();
    if (inTelegram()) offerConfirmation();
};
})();
