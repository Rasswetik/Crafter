/* Games tab: the Arena tile shows a miniature of the real Arena board (the colour cells of the players, their avatars, the puck with its aim ring)
   instead of swords; the Events tile gets one neutral picture (no season theme); the Author tile gets a picture and the same «Открыть» button as the others.
   The tiles are built by staking.js, new-year.js and author.js; this file only dresses them, again whenever the hub is redrawn.
   A picture uploaded by an administrator for the Events tile is never replaced. */
(function () {
    'use strict';

    const ARENA = '<svg class="gt-arena" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' +
        '<defs>' +
        '<radialGradient id="gta-bg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#34293f"/><stop offset="1" stop-color="#131218"/></radialGradient>' +
        '<linearGradient id="gta-c1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b30054"/><stop offset="1" stop-color="#ff7748"/></linearGradient>' +
        '<linearGradient id="gta-c2" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4642d4"/><stop offset="1" stop-color="#776cfc"/></linearGradient>' +
        '<linearGradient id="gta-c3" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#15a65b"/><stop offset="1" stop-color="#5df574"/></linearGradient>' +
        '<linearGradient id="gta-c4" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c16b30"/><stop offset="1" stop-color="#ffd359"/></linearGradient>' +
        '<linearGradient id="gta-a1" x2="0" y2="1"><stop stop-color="#dbc000"/><stop offset="1" stop-color="#46b82b"/></linearGradient>' +
        '<linearGradient id="gta-a2" x2="0" y2="1"><stop stop-color="#a96cea"/><stop offset="1" stop-color="#7350ba"/></linearGradient>' +
        '<linearGradient id="gta-a3" x2="0" y2="1"><stop stop-color="#68d2af"/><stop offset="1" stop-color="#168a75"/></linearGradient>' +
        '<linearGradient id="gta-a4" x2="0" y2="1"><stop stop-color="#ffbd49"/><stop offset="1" stop-color="#e67631"/></linearGradient>' +
        '<radialGradient id="gta-gloss" cx=".2" cy=".1" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
        '<clipPath id="gta-clip"><rect x="5" y="5" width="110" height="110" rx="17"/></clipPath>' +
        '</defs>' +
        '<rect x="2" y="2" width="116" height="116" rx="20" fill="#241b33" stroke="#a98be6" stroke-opacity=".6" stroke-width="2"/>' +
        '<g clip-path="url(#gta-clip)">' +
        '<rect width="120" height="120" fill="url(#gta-bg)"/>' +
        '<g stroke="#131218" stroke-width="1.2" stroke-linejoin="round">' +
        '<polygon points="5,5 58,5 61,58 5,54" fill="url(#gta-c1)"/>' +
        '<polygon points="58,5 115,5 115,62 61,58" fill="url(#gta-c2)"/>' +
        '<polygon points="5,54 61,58 64,115 5,115" fill="url(#gta-c3)"/>' +
        '<polygon points="61,58 115,62 115,115 64,115" fill="url(#gta-c4)"/>' +
        '</g>' +
        '<g font-weight="800" font-size="9" text-anchor="middle" fill="#fff" font-family="inherit">' +
        '<circle cx="31" cy="29" r="9.5" fill="url(#gta-a1)" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/><text x="31" y="32.2">И</text>' +
        '<circle cx="89" cy="31" r="9.5" fill="url(#gta-a2)" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/><text x="89" y="34.2">А</text>' +
        '<circle cx="33" cy="87" r="9.5" fill="url(#gta-a3)" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/><text x="33" y="90.2">М</text>' +
        '<circle cx="91" cy="89" r="9.5" fill="url(#gta-a4)" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/><text x="91" y="92.2">К</text>' +
        '</g>' +
        '<g class="gt-puck"><g class="gt-aim" fill="none" stroke="#fff" stroke-width="1.2" opacity=".8">' +
        '<circle cx="61" cy="58" r="17" stroke-width=".8" stroke-dasharray="2 3.4" stroke-linecap="round"/></g>' +
        '<circle cx="61" cy="58" r="8" fill="#e9ffe3" fill-opacity=".9" stroke="#fff" stroke-width="1"/>' +
        '<circle cx="61" cy="58" r="5.2" fill="#27351e" fill-opacity=".62" stroke="#fff" stroke-width=".7"/>' +
        '<path d="M57.6 58h6.8M61 54.6v6.8" stroke="#fff" stroke-width=".8"/>' +
        '<path d="M62 41.2A17 17 0 0 1 78 58h6m-2.6-2.4 2.6 2.4-2.6 2.4" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></g>' +
        '<rect width="120" height="120" fill="url(#gta-gloss)"/>' +
        '</g></svg>';

    const spark = (x, y, s, cls, c) => '<path class="gt-tw ' + cls + '" fill="' + c + '" d="M' + x + ' ' + (y - s) + 'L' + (x + s * .28) + ' ' + (y - s * .28) + 'L' + (x + s) + ' ' + y + 'L' + (x + s * .28) + ' ' + (y + s * .28) + 'L' + x + ' ' + (y + s) + 'L' + (x - s * .28) + ' ' + (y + s * .28) + 'L' + (x - s) + ' ' + y + 'L' + (x - s * .28) + ' ' + (y - s * .28) + 'Z"/>';

    const EVENTS_PLAIN = '<svg class="gt-events" viewBox="0 0 160 120" aria-hidden="true" focusable="false">' +
        '<defs>' +
        '<radialGradient id="gtp-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#8f9bff" stop-opacity=".5"/><stop offset="1" stop-color="#8f9bff" stop-opacity="0"/></radialGradient>' +
        '<linearGradient id="gtp-gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff0b8"/><stop offset=".55" stop-color="#ffc94d"/><stop offset="1" stop-color="#c98512"/></linearGradient>' +
        '<linearGradient id="gtp-card" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#5a6bff"/><stop offset="1" stop-color="#2b2f94"/></linearGradient>' +
        '<linearGradient id="gtp-head" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ff7a8a"/><stop offset="1" stop-color="#ff4f7a"/></linearGradient>' +
        '</defs>' +
        '<circle cx="82" cy="62" r="58" fill="url(#gtp-glow)"/>' +
        '<g class="gt-sway">' +
        '<rect x="34" y="24" width="94" height="82" rx="14" fill="url(#gtp-card)"/>' +
        '<path d="M34 38a14 14 0 0 1 14-14h66a14 14 0 0 1 14 14v10H34Z" fill="url(#gtp-head)"/>' +
        '<rect x="54" y="14" width="8" height="20" rx="4" fill="#fff"/><rect x="100" y="14" width="8" height="20" rx="4" fill="#fff"/>' +
        '<g fill="#fff" fill-opacity=".28"><rect x="46" y="58" width="12" height="9" rx="3"/><rect x="66" y="58" width="12" height="9" rx="3"/><rect x="86" y="58" width="12" height="9" rx="3"/><rect x="106" y="58" width="12" height="9" rx="3"/>' +
        '<rect x="46" y="74" width="12" height="9" rx="3"/><rect x="66" y="74" width="12" height="9" rx="3"/><rect x="46" y="90" width="12" height="9" rx="3"/></g>' +
        '<path d="m97 70 3.9 7.9 8.700 1.300-6.300 6.100 1.500 8.700-7.800-4.100-7.800 4.100 1.500-8.700-6.300-6.100 8.700-1.300Z" fill="url(#gtp-gold)"/>' +
        '</g>' +
        spark(146, 22, 6, 'tw2', '#ffe3a6') + spark(144, 92, 4.5, 'tw3', '#fff') + spark(48, 8, 4, 'tw1', '#fff') +
        '</svg>';

    const AUTHOR = '<svg class="gt-author" viewBox="0 0 160 120" aria-hidden="true" focusable="false">' +
        '<defs>' +
        '<radialGradient id="gtu-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#5fe3b2" stop-opacity=".4"/><stop offset="1" stop-color="#5fe3b2" stop-opacity="0"/></radialGradient>' +
        '<linearGradient id="gtu-ticket" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7cf0c4"/><stop offset=".55" stop-color="#26b98a"/><stop offset="1" stop-color="#0f7766"/></linearGradient>' +
        '<linearGradient id="gtu-gold" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff0b8"/><stop offset=".55" stop-color="#ffc94d"/><stop offset="1" stop-color="#c98512"/></linearGradient>' +
        '</defs>' +
        '<circle cx="82" cy="58" r="56" fill="url(#gtu-glow)"/>' +
        '<g class="gt-sway" transform="rotate(-9 82 56)">' +
        '<path d="M20 34h120a6 6 0 0 1 6 6v12a8 8 0 0 0 0 16v12a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6V68a8 8 0 0 0 0-16V40a6 6 0 0 1 6-6Z" fill="url(#gtu-ticket)"/>' +
        '<path d="M106 38v52" stroke="#d9fff0" stroke-opacity=".7" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round"/>' +
        '<g fill="#d9fff0" fill-opacity=".85"><rect x="28" y="46" width="58" height="8" rx="4"/><rect x="28" y="60" width="44" height="8" rx="4" fill-opacity=".6"/><rect x="28" y="74" width="52" height="8" rx="4" fill-opacity=".6"/></g>' +
        '<text x="126" y="77" text-anchor="middle" font-size="30" font-weight="900" fill="#fff" font-family="inherit">%</text></g>' +
        '<g class="gt-coin"><ellipse cx="124" cy="104" rx="19" ry="7" fill="#a86a0d"/><path d="M105 98v6a19 7 0 0 0 38 0v-6Z" fill="#d99a24"/><ellipse cx="124" cy="98" rx="19" ry="7" fill="url(#gtu-gold)"/>' +
        '<ellipse cx="124" cy="91" rx="19" ry="7" fill="#d99a24"/><ellipse cx="124" cy="86" rx="19" ry="7" fill="url(#gtu-gold)"/></g>' +
        spark(24, 24, 7, 'tw1', '#fff') + spark(146, 34, 5, 'tw2', '#d9fff0') + spark(40, 104, 4.5, 'tw3', '#ffe3a6') +
        '</svg>';

    function dress(root) {
        if (!root) return;
        const arena = root.querySelector('.crafter-swords-tile');
        if (arena && !arena.classList.contains('gt-arena-tile')) {
            arena.classList.add('gt-arena-tile');
            const icon = arena.querySelector('.arena-tile-icon');
            if (icon) icon.innerHTML = ARENA;
        }
        const art = root.querySelector('.ny-game-tile .ny-art:not(.is-custom)');
        if (art && !art.dataset.gt) {
            art.dataset.gt = '1';
            art.innerHTML = EVENTS_PLAIN;
            art.closest('.ny-game-tile').classList.add('gt-events-tile');
        }
        const author = root.querySelector('.au-game-tile');
        if (author && !author.dataset.gt) {
            author.dataset.gt = '1';
            author.classList.add('gt-author-tile');
            author.querySelector('.crafter-game-label')?.insertAdjacentHTML('beforeend', '<span class="crafter-game-open">Открыть</span>');
            author.insertAdjacentHTML('beforeend', '<span class="gt-author-art" aria-hidden="true">' + AUTHOR + '</span>');
        }
    }

    function run() { dress(document.querySelector('#main .crafter-games')); }
    const main = document.getElementById('main');
    if (main) new MutationObserver(run).observe(main, {childList: true, subtree: true});
    document.addEventListener('DOMContentLoaded', run);
    run();
})();
