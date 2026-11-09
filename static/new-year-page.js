/* Event page ("Событие"): festive decoration injected into the hero and empty state. Decorative only. */
(function () {
'use strict';
const CRYSTAL = `<svg class="nyp-crystal" viewBox="-50 -50 100 100" aria-hidden="true">
  <defs><linearGradient id="nyp-ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#8fd0ff"/></linearGradient></defs>
  <g stroke="url(#nyp-ice)" stroke-width="2.3" stroke-linecap="round" fill="none">
    ${[0, 60, 120, 180, 240, 300].map(a => `<g transform="rotate(${a})"><path d="M0 0V-44"/><path d="M0-14-8-22M0-14 8-22"/><path d="M0-26-10-35M0-26 10-35"/><path d="M0-38-5-43M0-38 5-43"/></g>`).join('')}
  </g><circle r="3.6" fill="#fff"/></svg>`;

function baubles() {
    const spec = [['7%', 16, '#ff5a6a', '#b8192b', 0], ['27%', 26, '#ffd36b', '#c88a14', -1.1], ['70%', 20, '#6cc3ff', '#2a6fb8', -2.1], ['91%', 28, '#ff8fd0', '#b83d8a', -.6]];
    return spec.map(([x, len, a, b, delay]) => `<i class="nyp-bauble" style="--x:${x};--len:${len}px;--a:${a};--b:${b};--delay:${delay}s"><u></u><b></b></i>`).join('');
}
function flakes(n) {
    let out = '';
    for (let i = 0; i < n; i++) {
        out += `<i class="nyp-flake" style="--x:${(i * 53 + 7) % 100}%;--s:${(2 + (i * 7) % 5)}px;--t:${(7 + (i * 5) % 9)}s;--d:${-((i * 3) % 11)}s;--w:${(i * 17) % 40 - 20}px"></i>`;
    }
    return out;
}
function decorate() {
    const hero = document.querySelector('.new-year-page .ny-hero:not([data-fest])');
    if (hero) {
        hero.dataset.fest = '1';
        hero.insertAdjacentHTML('afterbegin',
            `<div class="nyp-aurora" aria-hidden="true"></div><div class="nyp-stars" aria-hidden="true"></div>${CRYSTAL}
             <div class="nyp-snow" aria-hidden="true">${flakes(18)}</div><div class="nyp-icicles" aria-hidden="true"></div>${baubles()}`);
    }
    const empty = document.querySelector('.new-year-page .ny-empty:not([data-fest])');
    if (empty) {
        empty.dataset.fest = '1';
        empty.insertAdjacentHTML('afterbegin', `<div class="nyp-snow" aria-hidden="true">${flakes(12)}</div>`);
    }
}
setInterval(decorate, 600);
new MutationObserver(decorate).observe(document.documentElement, {childList: true, subtree: true});
})();
