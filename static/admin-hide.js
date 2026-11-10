/* Hidden admin panel: while the switch is on the admin entries disappear; typing 777 in the top-up amount shows them again. */
(function () {
'use strict';
const KEY = 'crafter-admin-unhidden';
const unlocked = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch (_) { return false; } };
function apply() {
    const hide = Boolean(typeof state !== 'undefined' && state.me && state.me.admin_hidden) && !unlocked();
    document.documentElement.classList.toggle('admin-hidden', hide);
}
setInterval(apply, 700);
document.addEventListener('input', ev => {
    const t = ev.target;
    if (!t || t.id !== 'wallet-amount' || String(t.value).trim() !== '777') return;
    if (!(typeof state !== 'undefined' && state.me && state.me.is_admin)) return;
    try { sessionStorage.setItem(KEY, '1'); } catch (_) {}
    t.value = '';
    t.dispatchEvent(new Event('input', {bubbles: true}));
    apply();
    if (typeof toast === 'function') toast('Админ-панель открыта');
}, true);
})();
