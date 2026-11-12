/* One address per section: /market, /gifts, /hub, /craft, /upgrade, /arena, /staking, /profile, /new-year, /wallet ...
   Moving between sections updates the address, a refresh or a shared link opens the same section, Back and Forward work. */
(function () {
'use strict';
const MAP = {market: '/market', gifts: '/gifts', games: '/hub', craft: '/craft', upgrade: '/upgrade', arena: '/arena', staking: '/staking',
             profile: '/profile', 'new-year': '/new-year', wallet: '/wallet', deposit: '/deposit', withdraw: '/withdraw', cart: '/cart', auctions: '/auctions'};
const REV = Object.fromEntries(Object.entries(MAP).map(([page, path]) => [path, page]));
const deep = () => /^\/(collections|auctions)\//.test(location.pathname);
const clean = () => location.pathname.replace(/\/+$/, '') || '/';
window.crafterRouteView = () => REV[clean()] || null;
window.crafterPagePath = () => MAP[state.page] || '/';
let silent = false;
const before = go;
go = async function (page, ...rest) {
    const result = await before.call(this, page, ...rest);
    try {
        const path = MAP[state.page];
        if (!silent && path && !deep() && clean() !== path) {
            const keep = path === '/new-year' ? location.search : '';
            history[location.pathname === '/' ? 'replaceState' : 'pushState']({crafterPage: state.page}, '', path + keep);
        }
    } catch (_) { /* the address is a convenience: never break the app because of it */ }
    return result;
};
// the first section is shown by the start-up code: once the splash screen is gone its address is put into the bar
const settle = setInterval(() => {
    if (document.querySelector('#splash')) return;
    clearInterval(settle);
    const path = MAP[state.page];
    if (path && clean() !== path && !deep()) {
        try { history.replaceState({crafterPage: state.page}, '', path); } catch (_) {}
    }
}, 300);
setTimeout(() => clearInterval(settle), 30000);
window.addEventListener('popstate', () => {
    const page = window.crafterRouteView();
    if (!page || page === state.page || deep()) return;
    silent = true;
    Promise.resolve(go(page)).finally(() => { silent = false; });
});
})();
