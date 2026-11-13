/* Drawn backgrounds of the special market: calm, layered illustrations in SVG (sky, hills, trees, soft light) with a few slow, small
   movements. The same scenes dress the sections, the cards, the window of a lot and the reveal after a purchase. */
(function () {
'use strict';
let counter = 0;
const rnd = seed => { let s = seed * 9301 + 49297; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const f = n => Number(n).toFixed(1);

const MAP = {                                    // keys of cards and sections -> scenes
    'ny-snow': 'snow', 'ny-candy': 'candy', 'ny-lights': 'garland', 'ny-frost': 'frost', 'ny-ginger': 'cozy', 'ny-bells': 'gold', 'ny-fire': 'lava', 'ny-aurora': 'aurora',
    'c-pink': 'rose', 'ny-gold': 'gold', 'ny-snowstorm': 'snowstorm', 'ny-fireworks': 'fireworks', 'ny-confetti': 'confetti', 'lights': 'garland', 'bells': 'gold', 'fire': 'lava', 'ginger': 'cozy',
};
const norm = key => { key = String(key || 'night'); if (MAP[key]) return MAP[key]; return key.replace(/^(ny|c)-/, ''); };

/* ---------- pieces ---------- */
const defs = (id, body) => '<defs>' + body + '</defs>';
const lin = (id, stops, x2 = 0, y2 = 1) => '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + x2 + '" y2="' + y2 + '">' + stops.map((s, i) => '<stop offset="' + (s[0]) + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('') + '</linearGradient>';
const rad = (id, stops, cx = .5, cy = .5, r = .5) => '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' + stops.map(s => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('') + '</radialGradient>';
const rect = fill => '<rect width="800" height="600" fill="' + fill + '"/>';
const blur = (id, n) => '<filter id="' + id + '" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="' + n + '"/></filter>';

function stars(n, seed, opts = {}) {
    const r = rnd(seed), top = opts.top || 0, h = opts.h || 420; let out = '';
    for (let i = 0; i < n; i++) {
        const x = r() * 800, y = top + r() * h, s = .6 + r() * (opts.size || 1.5), tw = r() < (opts.twinkle === undefined ? .35 : opts.twinkle);
        out += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(s) + '" fill="#fff" opacity="' + f(.35 + r() * .5) + '"' + (tw ? ' class="sc-tw" style="--d:-' + f(r() * 6) + 's;--t:' + f(4 + r() * 4) + 's"' : '') + '/>';
    }
    return out;
}
function sparkle(x, y, s, color, d) {
    return '<path class="sc-tw" style="--d:-' + d + 's;--t:5s" transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + color + '" d="M0-12C1.5-4 4-1.5 12 0 4 1.5 1.5 4 0 12-1.5 4-4 1.5-12 0-4-1.5-1.5-4 0-12Z"/>';
}
function snow(n, seed, opts = {}) {
    const r = rnd(seed); let out = '<g class="sc-anim">';
    for (let i = 0; i < n; i++) {
        const x = r() * 800, s = (opts.min || 1.2) + r() * (opts.max || 2.6);
        out += '<circle class="sc-fall" cx="' + f(x) + '" cy="0" r="' + f(s) + '" fill="#fff" opacity="' + f(.35 + r() * .5) + '" style="--t:' + f((opts.slow || 16) + r() * 14) + 's;--d:-' + f(r() * 30) + 's;--dx:' + Math.round(r() * 60 - 20) + 'px"/>';
    }
    return out + '</g>';
}
function hills(color, y, amp, seed, opacity = 1) {
    const r = rnd(seed); let d = 'M0 ' + y;
    for (let x = 0; x <= 800; x += 100) d += ' Q' + (x + 50) + ' ' + f(y - amp * (.4 + r())) + ' ' + (x + 100) + ' ' + f(y + (r() - .5) * amp * .4);
    return '<path d="' + d + ' L800 600 L0 600Z" fill="' + color + '" opacity="' + opacity + '"/>';
}
function pine(x, y, h, color, capColor) {
    const w = h * .42;
    let out = '<g transform="translate(' + f(x) + ' ' + f(y) + ')"><rect x="' + f(-w * .06) + '" y="' + f(-h * .08) + '" width="' + f(w * .12) + '" height="' + f(h * .1) + '" fill="#2a1a14"/>';
    for (let i = 0; i < 4; i++) {
        const ty = -h * (.1 + i * .22), bw = w * (1 - i * .2);
        out += '<path d="M' + f(-bw / 2) + ' ' + f(ty) + ' L0 ' + f(ty - h * .34) + ' L' + f(bw / 2) + ' ' + f(ty) + 'Z" fill="' + color + '"/>';
        if (capColor) out += '<path d="M' + f(-bw * .2) + ' ' + f(ty - h * .22) + ' L0 ' + f(ty - h * .34) + ' L' + f(bw * .2) + ' ' + f(ty - h * .22) + ' Q0 ' + f(ty - h * .18) + ' ' + f(-bw * .2) + ' ' + f(ty - h * .22) + 'Z" fill="' + capColor + '" opacity=".85"/>';
    }
    return out + '</g>';
}
function pineRow(color, y, h, seed, capColor, gap = 70) {
    const r = rnd(seed); let out = '';
    for (let x = -20; x < 840; x += gap * (.7 + r() * .6)) out += pine(x, y + r() * 14, h * (.75 + r() * .5), color, capColor);
    return out;
}
function bokeh(seed, n, color, max = 70, opacity = .08) {
    const r = rnd(seed); let out = '';
    for (let i = 0; i < n; i++) out += '<circle cx="' + f(r() * 800) + '" cy="' + f(r() * 600) + '" r="' + f(18 + r() * max) + '" fill="' + color + '" opacity="' + f(opacity * (.5 + r())) + '"/>';
    return out;
}
function burst(cx, cy, size, color, delay, t) {
    const n = 16; let rays = '', dots = '';
    for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, x1 = Math.cos(a) * size * .32, y1 = Math.sin(a) * size * .32, x2 = Math.cos(a) * size, y2 = Math.sin(a) * size;
        rays += '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '"/>';
        dots += '<circle cx="' + f(x2) + '" cy="' + f(y2) + '" r="3.2"/><circle cx="' + f(Math.cos(a + Math.PI / n) * size * .7) + '" cy="' + f(Math.sin(a + Math.PI / n) * size * .7) + '" r="2"/>';
    }
    return '<g transform="translate(' + cx + ' ' + cy + ')"><g class="sc-fw" style="--d:-' + delay + 's;--t:' + t + 's" fill="' + color + '" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round"><circle r="' + f(size * .1) + '" opacity=".55" stroke="none"/>' + rays + '<g stroke="none">' + dots + '</g></g></g>';
}
function flat(c1, c2, id) { return defs(id, lin(id, [[0, c1], [1, c2]])) + '<rect width="800" height="600" fill="url(#' + id + ')"/>'; }
function bokehScene(id, c1, c2, glow, seed, extra = '') {
    return defs(id, lin(id, [[0, c1], [1, c2]]) + rad(id + 'g', [[0, glow, .5], [1, glow, 0]], .5, .15, .7)) + '<rect width="800" height="600" fill="url(#' + id + ')"/><rect width="800" height="600" fill="url(#' + id + 'g)"/>' + bokeh(seed, 12, '#fff', 80, .07) + extra;
}
function pattern(id, w, h, inner, rot) { return '<pattern id="' + id + '" width="' + w + '" height="' + h + '" patternUnits="userSpaceOnUse"' + (rot ? ' patternTransform="rotate(' + rot + ')"' : '') + '>' + inner + '</pattern>'; }

/* ---------- the scenes ---------- */
const SCENES = {
    night: id => flat('#070a2e', '#2a2468', id) + '<circle cx="520" cy="130" r="120" fill="#6d7cff" opacity=".07"/>' + stars(70, 3),
    stars: id => defs(id, rad(id, [[0, '#3a45b8'], [.55, '#141a62'], [1, '#080a30']], .5, .4, .8)) + rect('url(#' + id + ')') + stars(110, 7, {size: 2.2, twinkle: .5}) + sparkle(200, 150, 1.1, '#fff', 1) + sparkle(610, 90, .8, '#cfd8ff', 3) + sparkle(430, 260, .6, '#fff', 2),
    moon: id => defs(id, lin(id, [[0, '#08123a'], [1, '#26337c']]) + rad(id + 'm', [[0, '#fff6cf', .55], [.3, '#fff6cf', .18], [1, '#fff6cf', 0]]) + blur(id + 'b', 14)) + rect('url(#' + id + ')') + stars(60, 11) +
        '<circle cx="560" cy="170" r="190" fill="url(#' + id + 'm)"/><circle cx="560" cy="170" r="62" fill="#fff6cf"/><circle cx="540" cy="154" r="14" fill="#f2e2a4" opacity=".6"/><circle cx="582" cy="188" r="9" fill="#f2e2a4" opacity=".6"/>' +
        '<g filter="url(#' + id + 'b)" fill="#9aa8ff" opacity=".28"><ellipse cx="260" cy="320" rx="190" ry="26"/><ellipse cx="640" cy="380" rx="220" ry="24"/></g>' + hills('#0b1544', 520, 60, 5) + hills('#070d33', 570, 40, 9),
    snow: id => flat('#1c3478', '#0a1646', id) + stars(26, 4, {top: 0, h: 260, twinkle: .3}) + hills('#5b79c4', 470, 50, 2, .55) + hills('#c9d8ff', 520, 36, 6, .9) + hills('#eaf2ff', 565, 26, 8) + snow(34, 21),
    snowstorm: id => flat('#6a8dc2', '#233a66', id) + (() => { const r = rnd(5); let s = '<g class="sc-anim" stroke="#fff" stroke-linecap="round">'; for (let i = 0; i < 46; i++) { const x = r() * 900, w = 1 + r() * 2; s += '<line class="sc-gust" x1="' + f(x) + '" y1="-20" x2="' + f(x - 50) + '" y2="30" stroke-width="' + f(w) + '" opacity="' + f(.25 + r() * .4) + '" style="--t:' + f(2.4 + r() * 2.2) + 's;--d:-' + f(r() * 5) + 's"/>'; } return s + '</g>'; })() + hills('#cfe0ff', 520, 30, 3, .75) + hills('#f1f6ff', 570, 22, 6),
    aurora: id => defs(id, lin(id, [[0, '#030820'], [1, '#0d2a52']]) + lin(id + 'a', [[0, '#3cf2b4', 0], [.5, '#3cf2b4', .75], [1, '#4aa8ff', 0]], 1, 0) + lin(id + 'p', [[0, '#9b6cff', 0], [.5, '#9b6cff', .6], [1, '#3cf2b4', 0]], 1, 0) + blur(id + 'b', 22)) + rect('url(#' + id + ')') + stars(60, 13, {h: 300}) +
        '<g filter="url(#' + id + 'b)" class="sc-breath"><path d="M-50 210 C150 60 320 320 520 150 S800 120 860 200 L860 330 C700 250 560 400 380 300 S100 330 -50 330Z" fill="url(#' + id + 'a)"/><path d="M-50 290 C200 200 380 380 600 230 S780 240 860 260 L860 360 C640 330 480 430 300 360 S60 380 -50 380Z" fill="url(#' + id + 'p)" opacity=".7"/></g>' + hills('#06142e', 500, 50, 4) + pineRow('#050d22', 560, 150, 12, null, 80),
    garland: id => flat('#103f2d', '#06170f', id) + defs(id + 'g', rad(id + 'g', [[0, '#fff', .9], [1, '#fff', 0]])) + (() => {
        const cols = ['#ff5c6e', '#ffd27a', '#6ac7ff', '#9be37f', '#c39bff']; let s = '';
        [[60, 80], [150, 120]].forEach(([y0, sag], row) => {
            s += '<path d="M-20 ' + y0 + ' Q200 ' + (y0 + sag) + ' 400 ' + (y0 + 6) + ' T820 ' + (y0 + 4) + '" fill="none" stroke="#0a2318" stroke-width="3"/>';
            for (let i = 0; i < 13; i++) { const t = i / 12, x = -10 + t * 830, y = y0 + (row ? 4 : 0) + Math.sin(t * Math.PI * 2) * sag * .62 + (t * 6), c = cols[(i + row * 2) % 5]; s += '<g class="sc-breath" style="animation-delay:-' + f(i * .6) + 's"><circle cx="' + f(x) + '" cy="' + f(y + 12) + '" r="22" fill="' + c + '" opacity=".22"/><ellipse cx="' + f(x) + '" cy="' + f(y + 12) + '" rx="6" ry="9" fill="' + c + '"/></g>'; }
        });
        return s;
    })() + pineRow('#0a2a1c', 600, 190, 7, null, 90) + snow(14, 5, {slow: 22}),
    frost: id => defs(id, lin(id, [[0, '#8ec2f5'], [1, '#2f62b8']]) + rad(id + 'g', [[0, '#fff', .5], [1, '#fff', 0]], .5, .1, .8)) + rect('url(#' + id + ')') + rect('url(#' + id + 'g)') + (() => {
        const r = rnd(9); let s = '<g stroke="#fff" stroke-linecap="round" fill="none" opacity=".6">';
        for (let i = 0; i < 9; i++) { const x = r() * 800, y = r() * 560, k = .5 + r() * 1.1; s += '<g transform="translate(' + f(x) + ' ' + f(y) + ') scale(' + f(k) + ') rotate(' + Math.round(r() * 60) + ')" stroke-width="3">'; for (let a = 0; a < 6; a++) s += '<g transform="rotate(' + a * 60 + ')"><line y2="-46"/><path d="M0-26 L-10-38 M0-26 L10-38 M0-12 L-8-22 M0-12 L8-22"/></g>'; s += '</g>'; }
        return s + '</g>';
    })() + hills('#e9f4ff', 575, 24, 4, .8),
    ice: id => defs(id, lin(id, [[0, '#63d4f2'], [1, '#1a62b0']])) + rect('url(#' + id + ')') + '<g fill="#fff"><path d="M0 600 L120 300 L210 600Z" opacity=".12"/><path d="M160 600 L330 220 L440 600Z" opacity=".16"/><path d="M380 600 L560 340 L700 600Z" opacity=".12"/><path d="M600 600 L740 250 L820 600Z" opacity=".17"/><path d="M-20 600 L60 420 L150 600Z" opacity=".1"/></g>' + stars(30, 8, {h: 300, twinkle: .5}) + hills('#dff6ff', 585, 22, 2, .85),
    candy: id => defs(id, lin(id, [[0, '#7c1233'], [1, '#340615']]) + pattern(id + 'p', 70, 70, '<rect width="35" height="70" fill="#fff" opacity=".1"/>', 35) + rad(id + 'v', [[.4, '#000', 0], [1, '#000', .55]])) + rect('url(#' + id + ')') + rect('url(#' + id + 'p)') + rect('url(#' + id + 'v)') + bokeh(4, 8, '#ffb3c1', 60, .09),
    village: id => '<rect width="800" height="600" fill="#0b1240"/>' + (window.crafterVillage ? window.crafterVillage() : ''),
    tree: id => flat('#0a2352', '#0a3a2c', id) + stars(40, 6, {h: 260}) + '<circle cx="650" cy="120" r="46" fill="#fff6cf" opacity=".9"/><circle cx="650" cy="120" r="120" fill="#fff6cf" opacity=".07"/>' + hills('#0c2b4a', 440, 50, 3, .9) + pineRow('#0d4a35', 500, 190, 3, '#e9f3ff', 70) + (() => {
        const r = rnd(8); let s = ''; for (let i = 0; i < 16; i++) s += '<circle class="sc-tw" cx="' + f(40 + r() * 720) + '" cy="' + f(330 + r() * 220) + '" r="3.4" fill="' + ['#ff6a7e', '#ffd27a', '#6ac7ff'][i % 3] + '" style="--d:-' + f(r() * 5) + 's;--t:3.6s"/>'; return s;
    })() + pineRow('#06281c', 590, 250, 9, '#e9f3ff', 110) + snow(18, 3, {slow: 20}),
    pine: id => flat('#173845', '#07131a', id) + stars(24, 2, {h: 200}) + '<g fill="#fff" opacity=".07" filter="url(#' + id + 'b)">' + '<rect x="-20" y="330" width="840" height="50"/><rect x="-20" y="410" width="840" height="40"/></g>' + defs(id + 'f', blur(id + 'b', 14)) + pineRow('#102a33', 430, 200, 4, null, 60) + pineRow('#0a1d25', 510, 260, 8, null, 90) + pineRow('#050f14', 600, 320, 11, null, 130),
    forest: id => defs(id, lin(id, [[0, '#4aa766'], [1, '#12482e']]) + rad(id + 'g', [[0, '#fff2b0', .6], [1, '#fff2b0', 0]], .7, .2, .5)) + rect('url(#' + id + ')') + rect('url(#' + id + 'g)') + hills('#2f8052', 400, 70, 2, .85) + hills('#1f6a40', 470, 60, 4) + pineRow('#0f4a2c', 560, 200, 6, null, 80) + pineRow('#083421', 610, 260, 10, null, 120),
    fireworks: id => defs(id, lin(id, [[0, '#080a2c'], [.7, '#231152'], [1, '#3b1a66']]) + blur(id + 'b', 10)) + rect('url(#' + id + ')') + stars(46, 12, {h: 320, twinkle: .3}) +
        '<g class="sc-anim">' + burst(210, 190, 84, '#ff7aa2', 1, 7.5) + burst(560, 140, 96, '#ffd166', 4, 8) + burst(400, 300, 70, '#6ee7ff', 2.5, 6.5) + burst(670, 330, 66, '#b794ff', 5.5, 7) + burst(110, 360, 58, '#7dffb3', 0, 6) + burst(330, 90, 52, '#ff9f5a', 3.2, 7.8) + '</g>' +
        '<g fill="#0b0720">' + (() => { const r = rnd(5); let s = '<path d="M0 600 L0 520 '; let x = 0; while (x < 800) { const w = 36 + r() * 50, h = 470 + r() * 90; s += 'L' + x + ' ' + f(h) + ' L' + (x + w) + ' ' + f(h) + ' '; x += w; } return s + 'L800 600Z"/>'; })() + '</g>' +
        (() => { const r = rnd(7); let s = ''; for (let i = 0; i < 26; i++) s += '<rect class="sc-tw" x="' + f(r() * 780) + '" y="' + f(530 + r() * 60) + '" width="4" height="5" fill="#ffd98a" style="--d:-' + f(r() * 6) + 's;--t:6s" opacity=".7"/>'; return s; })(),
    confetti: id => flat('#4b2a93', '#c2456e', id) + defs(id + 'g', rad(id + 'g', [[0, '#ffb86b', .35], [1, '#ffb86b', 0]], .5, 1, .8)) + '<rect width="800" height="600" fill="url(#' + id + 'g)"/>' + (() => {
        const r = rnd(14), cols = ['#ffd166', '#6ee7ff', '#ff7aa2', '#7dffb3', '#c39bff', '#fff']; let s = '<g class="sc-anim">';
        for (let i = 0; i < 26; i++) { const w = 7 + r() * 9; s += '<g class="sc-fall" style="--t:' + f(15 + r() * 14) + 's;--d:-' + f(r() * 28) + 's;--dx:' + Math.round(r() * 50 - 25) + 'px"><rect x="' + f(r() * 800) + '" y="0" width="' + f(w) + '" height="' + f(w * (.4 + r() * .6)) + '" rx="2" fill="' + cols[i % 6] + '" opacity="' + f(.55 + r() * .4) + '" transform="rotate(' + Math.round(r() * 180) + ')"/></g>'; }
        return s + '</g>';
    })(),
    galaxy: id => defs(id, rad(id + 'a', [[0, '#a24bff', .55], [1, '#a24bff', 0]]) + rad(id + 'b', [[0, '#3d7bff', .5], [1, '#3d7bff', 0]]) + rad(id + 'c', [[0, '#ff5fb0', .38], [1, '#ff5fb0', 0]])) + rect('#05041a') +
        '<ellipse cx="220" cy="190" rx="360" ry="220" fill="url(#' + id + 'a)"/><ellipse cx="610" cy="360" rx="380" ry="230" fill="url(#' + id + 'b)"/><ellipse cx="420" cy="520" rx="300" ry="160" fill="url(#' + id + 'c)"/>' + stars(100, 17, {size: 1.8, twinkle: .4}) + sparkle(160, 330, .9, '#fff', 1) + sparkle(640, 140, 1, '#e8d8ff', 2.5) + sparkle(470, 440, .6, '#fff', 4),
    neon: id => defs(id, lin(id, [[0, '#14062f'], [1, '#34105f']]) + lin(id + 's', [[0, '#ffe36e'], [1, '#ff3fa4']]) + blur(id + 'b', 8)) + rect('url(#' + id + ')') +
        '<circle cx="400" cy="300" r="150" fill="url(#' + id + 's)" opacity=".95"/><g fill="#14062f"><rect x="240" y="300" width="320" height="6"/><rect x="250" y="332" width="300" height="9"/><rect x="262" y="366" width="276" height="12"/><rect x="278" y="404" width="244" height="16"/></g>' +
        '<rect y="420" width="800" height="180" fill="#14062f"/><g stroke="#ff3fa4" stroke-width="2" opacity=".75">' + [420, 440, 466, 500, 545, 600].map(y => '<line x1="0" y1="' + y + '" x2="800" y2="' + y + '"/>').join('') + Array.from({length: 17}, (_, i) => '<line x1="' + (i * 50) + '" y1="600" x2="' + (400 + (i - 8) * 14) + '" y2="420"/>').join('') + '</g>',
    sunset: id => defs(id, lin(id, [[0, '#2b1b6b'], [.5, '#c8387a'], [.85, '#ff9a55'], [1, '#ffd27a']]) + rad(id + 's', [[0, '#fff1b0', .9], [.4, '#ffd27a', .35], [1, '#ffd27a', 0]])) + rect('url(#' + id + ')') + '<circle cx="400" cy="400" r="200" fill="url(#' + id + 's)"/><circle cx="400" cy="410" r="62" fill="#fff1b0"/>' + hills('#5a2a74', 470, 70, 3, .9) + hills('#3a1a5c', 520, 50, 6) + hills('#1f0f3a', 575, 34, 9),
    ocean: id => defs(id, lin(id, [[0, '#118bc8'], [1, '#062f66']]) + rad(id + 'g', [[0, '#fff', .35], [1, '#fff', 0]], .3, .0, .6)) + rect('url(#' + id + ')') + rect('url(#' + id + 'g)') + (() => {
        let s = ''; [[300, '#3fb0e8', .28, 12], [380, '#1f86d0', .4, 15], [460, '#0f60b0', .55, 18], [530, '#083f86', .75, 21]].forEach(([y, c, o, t], i) => { let d = 'M-120 ' + y; for (let x = -120; x < 960; x += 120) d += ' q60 ' + (i % 2 ? -26 : 26) + ' 120 0'; s += '<path class="sc-wave" style="--t:' + t + 's" d="' + d + ' V620 H-120Z" fill="' + c + '" opacity="' + o + '"/>'; }); return s;
    })(),
    mint: id => bokehScene(id, '#6fe3c4', '#1b8f7c', '#fff', 3),
    rose: id => bokehScene(id, '#ff86b6', '#a02464', '#fff', 5),
    steel: id => defs(id, lin(id, [[0, '#8b97b5'], [1, '#2a3350']]) + pattern(id + 'p', 46, 40, '<path d="M23 0 L46 10 V30 L23 40 L0 30 V10Z" fill="none" stroke="#fff" stroke-width="1" opacity=".1"/>')) + rect('url(#' + id + ')') + rect('url(#' + id + 'p)') + bokeh(2, 6, '#fff', 60, .06),
    lava: id => defs(id, lin(id, [[0, '#240705'], [1, '#6e1808']]) + lin(id + 'l', [[0, '#ffcf5a'], [.5, '#ff6a1a'], [1, '#c8200a']], 1, 0) + blur(id + 'b', 7)) + rect('url(#' + id + ')') +
        '<g filter="url(#' + id + 'b)" class="sc-breath"><path d="M-40 420 C160 360 300 470 460 410 S720 380 860 440 V520 C700 470 560 540 400 500 S120 470 -40 520Z" fill="url(#' + id + 'l)"/><path d="M-40 520 C200 470 360 560 560 520 S760 520 860 540 V600 H-40Z" fill="#ff7a22" opacity=".8"/></g>' + (() => { const r = rnd(6); let s = '<g class="sc-anim">'; for (let i = 0; i < 14; i++) s += '<circle class="sc-rise" cx="' + f(r() * 800) + '" cy="600" r="' + f(1.4 + r() * 2.2) + '" fill="#ffb25a" opacity=".8" style="--t:' + f(9 + r() * 8) + 's;--d:-' + f(r() * 14) + 's"/>'; return s + '</g>'; })(),
    blue: id => bokehScene(id, '#3c7cf0', '#0d2a7a', '#9ed0ff', 21),
    violet: id => bokehScene(id, '#8a52f0', '#2a1480', '#d8b8ff', 22),
    crimson: id => bokehScene(id, '#e63c58', '#6a0f26', '#ffb0bc', 23),
    emerald: id => bokehScene(id, '#22b873', '#07472f', '#a6ffd2', 24),
    gold: id => bokehScene(id, '#f2b640', '#8a4b0a', '#fff0b0', 25, sparkle(180, 160, 1.2, '#fff6cf', 0) + sparkle(600, 120, .9, '#fff6cf', 2) + sparkle(470, 330, .7, '#fff6cf', 4) + sparkle(110, 420, .6, '#fff6cf', 1.4) + sparkle(690, 470, 1, '#fff6cf', 3)),
    mitten: id => defs(id, lin(id, [[0, '#b52a3e'], [1, '#6a0f20']]) + pattern(id + 'p', 44, 44, '<path d="M22 6 L30 22 L22 38 L14 22Z" fill="#fff" opacity=".2"/><circle cx="0" cy="0" r="3" fill="#fff" opacity=".18"/><circle cx="44" cy="44" r="3" fill="#fff" opacity=".18"/>')) + rect('url(#' + id + ')') + rect('url(#' + id + 'p)') + '<rect y="0" width="800" height="30" fill="#fff" opacity=".1"/><rect y="570" width="800" height="30" fill="#fff" opacity=".1"/>' + defs(id + 'v', rad(id + 'v', [[.5, '#000', 0], [1, '#000', .5]])) + rect('url(#' + id + 'v)'),
    cozy: id => defs(id, lin(id, [[0, '#8e5836'], [1, '#33190d']]) + pattern(id + 'p', 60, 60, '<rect width="60" height="14" fill="#fff" opacity=".07"/><rect width="14" height="60" fill="#fff" opacity=".07"/><rect y="30" width="60" height="4" fill="#000" opacity=".1"/><rect x="30" width="4" height="60" fill="#000" opacity=".1"/>') + rad(id + 'g', [[0, '#ffa648', .55], [1, '#ffa648', 0]], .5, 1, .7)) + rect('url(#' + id + ')') + rect('url(#' + id + 'p)') + rect('url(#' + id + 'g)'),
    berry: id => defs(id, lin(id, [[0, '#6e1031'], [1, '#2a0513']]) + pattern(id + 'p', 80, 80, '<ellipse cx="20" cy="16" rx="14" ry="6" fill="#2c8a54" opacity=".5" transform="rotate(-30 20 16)"/><ellipse cx="34" cy="22" rx="14" ry="6" fill="#2c8a54" opacity=".5" transform="rotate(30 34 22)"/><circle cx="27" cy="24" r="7" fill="#ff4a6a"/><circle cx="25" cy="21" r="2" fill="#fff" opacity=".6"/><circle cx="62" cy="62" r="5" fill="#ff4a6a" opacity=".7"/>')) + rect('url(#' + id + ')') + '<rect width="800" height="600" fill="url(#' + id + 'p)" opacity=".55"/>',
    cocoa: id => defs(id, lin(id, [[0, '#744229'], [1, '#22100a']]) + blur(id + 'b', 4)) + rect('url(#' + id + ')') + (() => { const r = rnd(12); let s = ''; for (let i = 0; i < 14; i++) { const x = r() * 760, y = r() * 560, w = 34 + r() * 30; s += '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(w) + '" rx="' + f(w * .3) + '" fill="#fff" opacity="' + f(.1 + r() * .14) + '" transform="rotate(' + Math.round(r() * 60 - 30) + ' ' + f(x) + ' ' + f(y) + ')"/>'; } return s; })() + '<g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".12" filter="url(#' + id + 'b)"><path d="M300 560 C260 500 340 460 300 400 S340 320 300 270"/><path d="M420 570 C380 510 460 470 420 410 S460 330 420 280"/><path d="M540 560 C500 500 580 460 540 400"/></g>',
    polar: id => defs(id, lin(id, [[0, '#0a1f50'], [.6, '#2f7fc0'], [1, '#d6ecff']]) + lin(id + 'a', [[0, '#3cf2b4', 0], [.5, '#3cf2b4', .5], [1, '#9b6cff', 0]], 1, 0) + blur(id + 'b', 18)) + rect('url(#' + id + ')') + stars(40, 15, {h: 240}) + '<path class="sc-breath" filter="url(#' + id + 'b)" d="M-40 160 C200 40 380 240 600 110 S800 90 860 150 L860 240 C640 190 460 300 260 230 S40 240 -40 250Z" fill="url(#' + id + 'a)"/>' +
        '<path d="M0 520 L120 340 L210 470 L330 280 L470 480 L580 330 L700 470 L800 380 V600 H0Z" fill="#9cc4ea" opacity=".75"/><path d="M0 560 L150 440 L260 530 L400 400 L540 540 L690 430 L800 520 V600 H0Z" fill="#e6f3ff"/>',
};

SCENES.cabin = id => flat('#0b1340', '#1c2c70', id) + stars(46, 31, {h: 300}) + '<circle cx="620" cy="110" r="34" fill="#fff6cf" opacity=".9"/><circle cx="620" cy="110" r="90" fill="#fff6cf" opacity=".07"/>' + hills('#2a3f8a', 430, 50, 2, .8) + hills('#dfe9ff', 500, 34, 5) +
    '<g><rect x="520" y="300" width="22" height="70" fill="#3a2418"/><path class="sc-breath" d="M531 296 C520 270 548 250 536 218 C560 240 548 270 560 292Z" fill="#fff" opacity=".18"/>' +
    '<rect x="300" y="360" width="200" height="130" fill="#4a2c1c"/><path d="M280 366 L400 280 L520 366Z" fill="#2b1810"/><path d="M290 366 L400 290 L510 366 L500 372 L400 302 L300 372Z" fill="#fff"/>' +
    '<g class="sc-breath"><rect x="330" y="395" width="44" height="44" fill="#ffc861"/><rect x="430" y="395" width="44" height="44" fill="#ffc861"/><circle cx="352" cy="417" r="46" fill="#ffc861" opacity=".18"/><circle cx="452" cy="417" r="46" fill="#ffc861" opacity=".18"/></g><rect x="388" y="430" width="28" height="60" fill="#2b1810"/></g>' +
    pine(200, 520, 170, '#0f3f33', '#e9f3ff') + pine(650, 530, 210, '#0f3f33', '#e9f3ff') + pine(110, 560, 130, '#0a2e26', '#e9f3ff') + snow(20, 3, {slow: 20});
SCENES.bauble = id => flat('#0f4331', '#06190f', id) + (() => {
    const r = rnd(21), cols = [['#ff5c6e', '#a01a30'], ['#ffd27a', '#b8801a'], ['#6ac7ff', '#1f5fa8'], ['#c39bff', '#5a2fa8'], ['#fff', '#aab8d0']]; let s = '';
    for (let i = 0; i < 9; i++) { const x = 40 + i * 85 + r() * 30, len = 90 + r() * 260, rr = 28 + r() * 22, c = cols[i % 5]; s += '<g class="sc-bob" style="--d:-' + f(r() * 6) + 's"><line x1="' + f(x) + '" y1="0" x2="' + f(x) + '" y2="' + f(len) + '" stroke="#e8d7a0" stroke-width="1.6" opacity=".7"/><rect x="' + f(x - 7) + '" y="' + f(len) + '" width="14" height="10" rx="2" fill="#d9b24a"/><circle cx="' + f(x) + '" cy="' + f(len + 10 + rr) + '" r="' + f(rr) + '" fill="' + c[0] + '"/><circle cx="' + f(x) + '" cy="' + f(len + 10 + rr) + '" r="' + f(rr) + '" fill="' + c[1] + '" opacity=".35"/><ellipse cx="' + f(x - rr * .35) + '" cy="' + f(len + 10 + rr * .6) + '" rx="' + f(rr * .22) + '" ry="' + f(rr * .34) + '" fill="#fff" opacity=".55"/></g>'; }
    return s;
})() + hills('#0a2a1c', 560, 40, 6) + snow(12, 4, {slow: 22});
SCENES.gifts = id => defs(id, lin(id, [[0, '#1b3a8a'], [1, '#0a1546']]) + pattern(id + 'p', 150, 150, '<g transform="translate(20 22) rotate(-8)"><rect width="56" height="46" rx="4" fill="#e63c58"/><rect x="24" width="8" height="46" fill="#ffd27a"/><rect y="19" width="56" height="8" fill="#ffd27a"/></g><g transform="translate(92 84) rotate(10)"><rect width="46" height="40" rx="4" fill="#3fb0e8"/><rect x="19" width="8" height="40" fill="#fff"/><rect y="16" width="46" height="8" fill="#fff"/></g>')) + rect('url(#' + id + ')') + '<rect width="800" height="600" fill="url(#' + id + 'p)" opacity=".5"/>' + defs(id + 'v', rad(id + 'v', [[.5, '#000', 0], [1, '#000', .55]])) + rect('url(#' + id + 'v)');
SCENES.sparklers = id => flat('#090820', '#1c1450', id) + stars(40, 9, {h: 400}) + (() => {
    const r = rnd(4); let s = '';
    [[200, 300], [420, 220], [610, 340], [320, 460], [90, 430]].forEach(([x, y], k) => { s += '<g class="sc-breath" style="animation-delay:-' + k + 's"><circle cx="' + x + '" cy="' + y + '" r="60" fill="#ffd27a" opacity=".12"/><circle cx="' + x + '" cy="' + y + '" r="6" fill="#fff6cf"/></g>'; for (let i = 0; i < 14; i++) s += sparkle(f(x + (r() - .5) * 150), f(y + (r() - .5) * 150), f(.3 + r() * .5), '#ffd98a', f(r() * 5)); });
    return s;
})();
SCENES.champagne = id => flat('#1a1204', '#60400a', id) + defs(id + 'g', rad(id + 'g', [[0, '#ffd27a', .35], [1, '#ffd27a', 0]], .5, 1, .8)) + '<rect width="800" height="600" fill="url(#' + id + 'g)"/>' + (() => {
    const r = rnd(8); let s = '<g class="sc-anim">'; for (let i = 0; i < 26; i++) s += '<circle class="sc-rise" cx="' + f(r() * 800) + '" cy="610" r="' + f(3 + r() * 9) + '" fill="#ffe7a8" fill-opacity=".12" stroke="#ffe7a8" stroke-opacity=".7" stroke-width="1.5" style="--t:' + f(9 + r() * 9) + 's;--d:-' + f(r() * 16) + 's"/>'; return s + '</g>';
})() + sparkle(150, 160, 1, '#fff2c8', 0) + sparkle(640, 110, .8, '#fff2c8', 2) + sparkle(520, 260, .6, '#fff2c8', 4);
SCENES.northpole = id => defs(id, lin(id, [[0, '#14307a'], [1, '#07123a']]) + pattern(id + 'p', 90, 90, '<rect width="45" height="90" fill="#e63c58" opacity=".3"/><rect x="45" width="45" height="90" fill="#fff" opacity=".1"/>', 35)) + rect('url(#' + id + ')') + rect('url(#' + id + 'p)') + defs(id + 'v', rad(id + 'v', [[.35, '#000', 0], [1, '#000', .5]])) + rect('url(#' + id + 'v)') + stars(26, 5, {h: 260}) + hills('#cfdcff', 540, 30, 3) + hills('#f1f6ff', 580, 20, 5) + snow(24, 7);
SCENES.wreath = id => defs(id, lin(id, [[0, '#14583c'], [1, '#07261a']]) + pattern(id + 'p', 90, 90, '<ellipse cx="22" cy="30" rx="18" ry="7" fill="#37a46a" opacity=".6" transform="rotate(-35 22 30)"/><ellipse cx="46" cy="32" rx="18" ry="7" fill="#37a46a" opacity=".6" transform="rotate(35 46 32)"/><ellipse cx="34" cy="20" rx="18" ry="7" fill="#2a8a58" opacity=".6" transform="rotate(90 34 20)"/><circle cx="34" cy="34" r="7" fill="#ff4a5e"/><circle cx="32" cy="31" r="2.2" fill="#fff" opacity=".6"/><circle cx="70" cy="74" r="5" fill="#ff4a5e" opacity=".7"/>')) + rect('url(#' + id + ')') + '<rect width="800" height="600" fill="url(#' + id + 'p)" opacity=".6"/>' + defs(id + 'v', rad(id + 'v', [[.4, '#000', 0], [1, '#000', .45]])) + rect('url(#' + id + 'v)');
SCENES.skating = id => defs(id, lin(id, [[0, '#cdeeff'], [1, '#4d9ede']]) + rad(id + 'g', [[0, '#fff', .7], [1, '#fff', 0]], .5, .1, .8)) + rect('url(#' + id + ')') + rect('url(#' + id + 'g)') + '<g fill="none" stroke="#fff" stroke-linecap="round" opacity=".7"><path d="M-20 420 C200 330 420 520 820 360" stroke-width="3"/><path d="M-20 470 C240 400 440 560 820 430" stroke-width="2"/><path d="M60 560 C260 470 520 600 820 500" stroke-width="2"/><path d="M-20 360 C180 280 380 400 820 300" stroke-width="1.6" opacity=".6"/></g>' + bokeh(7, 8, '#fff', 70, .1) + snow(14, 9, {slow: 24});
SCENES.santa = id => defs(id, lin(id, [[0, '#d02a40'], [1, '#6e0f20']])) + rect('url(#' + id + ')') + bokeh(3, 7, '#ffb3c1', 60, .1) + '<path d="M0 0 H800 V70 Q760 100 720 70 T640 70 T560 70 T480 70 T400 70 T320 70 T240 70 T160 70 T80 70 T0 70Z" fill="#fff" opacity=".92"/><path d="M0 600 H800 V530 Q760 500 720 530 T640 530 T560 530 T480 530 T400 530 T320 530 T240 530 T160 530 T80 530 T0 530Z" fill="#fff" opacity=".92"/><rect x="340" y="250" width="120" height="100" rx="6" fill="none" stroke="#ffd27a" stroke-width="14" opacity=".9"/><rect x="372" y="282" width="56" height="36" fill="none" stroke="#ffd27a" stroke-width="8" opacity=".9"/>' + snow(12, 5, {slow: 22});
SCENES.sunrise = id => defs(id, lin(id, [[0, '#5a3a8a'], [.45, '#ff8c6b'], [.8, '#ffd9a8'], [1, '#fff1d0']]) + rad(id + 's', [[0, '#fff6cf', .95], [.45, '#ffe0a0', .4], [1, '#ffe0a0', 0]])) + rect('url(#' + id + ')') + '<circle cx="400" cy="440" r="220" fill="url(#' + id + 's)"/><circle cx="400" cy="450" r="64" fill="#fff6cf"/>' + hills('#d97a66', 470, 50, 3, .8) + hills('#a64a6e', 520, 44, 5) + hills('#5a2a60', 575, 30, 8);
SCENES.desert = id => defs(id, lin(id, [[0, '#7fc0e8'], [.55, '#ffd98a'], [1, '#e8a04a']])) + rect('url(#' + id + ')') + '<circle cx="610" cy="140" r="48" fill="#fff6cf" opacity=".95"/><circle cx="610" cy="140" r="110" fill="#fff6cf" opacity=".15"/>' + hills('#e8a85a', 430, 70, 3) + hills('#cf8640', 500, 60, 6) + hills('#a8622c', 560, 40, 9);
SCENES.jungle = id => flat('#0f5230', '#041c10', id) + (() => {
    const r = rnd(33); let s = ''; const cols = ['#1f8a50', '#2fa862', '#16703f', '#3dbb74'];
    for (let i = 0; i < 16; i++) { const x = r() < .5 ? r() * 220 : 580 + r() * 220, y = r() * 600, rx = 70 + r() * 90, ry = 20 + r() * 26, a = Math.round(r() * 180 - 90); s += '<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(rx) + '" ry="' + f(ry) + '" fill="' + cols[i % 4] + '" opacity="' + f(.45 + r() * .4) + '" transform="rotate(' + a + ' ' + f(x) + ' ' + f(y) + ')"/>'; }
    return s;
})() + defs(id + 'g', rad(id + 'g', [[0, '#d8ffb0', .3], [1, '#d8ffb0', 0]], .5, 0, .7)) + '<rect width="800" height="600" fill="url(#' + id + 'g)"/>';
SCENES.cherry = id => defs(id, lin(id, [[0, '#ffd8e6'], [1, '#ea84ae']])) + rect('url(#' + id + ')') + '<path d="M-20 140 C160 160 260 90 420 130 S700 100 830 60" fill="none" stroke="#5a2a3a" stroke-width="12" stroke-linecap="round"/>' + (() => {
    const r = rnd(5); let s = ''; for (let i = 0; i < 40; i++) { const x = r() * 800, y = 60 + r() * 140, k = 5 + r() * 9; s += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(k) + '" fill="' + (i % 3 ? '#fff' : '#ffb3cf') + '" opacity="' + f(.7 + r() * .3) + '"/>'; }
    s += '<g class="sc-anim">'; for (let i = 0; i < 14; i++) s += '<ellipse class="sc-fall" cx="' + f(r() * 800) + '" cy="0" rx="5" ry="3" fill="#fff" opacity=".85" style="--t:' + f(14 + r() * 12) + 's;--d:-' + f(r() * 24) + 's;--dx:' + Math.round(r() * 120 - 20) + 'px"/>'; return s + '</g>';
})() + hills('#e46a9a', 560, 36, 4, .55);
SCENES.space = id => defs(id, rad(id + 'p', [[0, '#ffb86b'], [.6, '#d6527a'], [1, '#5a1f80']], .35, .3, .75) + rad(id + 'n', [[0, '#6a4bff', .4], [1, '#6a4bff', 0]])) + rect('#03030f') + '<ellipse cx="600" cy="180" rx="320" ry="200" fill="url(#' + id + 'n)"/>' + stars(90, 19, {size: 1.8, twinkle: .4}) + '<circle cx="250" cy="360" r="120" fill="url(#' + id + 'p)"/><ellipse cx="250" cy="360" rx="210" ry="34" fill="none" stroke="#ffd9a8" stroke-width="7" opacity=".55" transform="rotate(-18 250 360)"/><circle cx="640" cy="130" r="22" fill="#cfd8ff" opacity=".9"/>';
SCENES.cyber = id => defs(id, lin(id, [[0, '#04101a'], [1, '#08283a']]) + blur(id + 'b', 4)) + rect('url(#' + id + ')') + '<g stroke="#19e0ff" stroke-width="1" opacity=".25">' + Array.from({length: 13}, (_, i) => '<line x1="' + (i * 66) + '" y1="0" x2="' + (i * 66) + '" y2="600"/>').join('') + Array.from({length: 10}, (_, i) => '<line x1="0" y1="' + (i * 66) + '" x2="800" y2="' + (i * 66) + '"/>').join('') + '</g>' +
    '<g fill="none" stroke="#19e0ff" stroke-width="3" filter="url(#' + id + 'b)" class="sc-breath"><path d="M0 420 H220 L260 380 H520 L560 420 H800"/><path d="M0 200 H140 L180 240 H420 L460 200 H800" stroke="#ff3fa4"/></g>';
SCENES.bubbles = id => defs(id, lin(id, [[0, '#8aeeff'], [1, '#1b7ac4']])) + rect('url(#' + id + ')') + (() => {
    const r = rnd(41); let s = ''; for (let i = 0; i < 22; i++) { const x = r() * 800, y = r() * 600, k = 12 + r() * 46; s += '<g' + (i % 4 === 0 ? ' class="sc-anim"' : '') + '><circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(k) + '" fill="#fff" fill-opacity=".1" stroke="#fff" stroke-opacity=".55" stroke-width="2"/><circle cx="' + f(x - k * .3) + '" cy="' + f(y - k * .3) + '" r="' + f(k * .2) + '" fill="#fff" opacity=".7"/></g>'; } return s;
})();
SCENES.storm = id => defs(id, lin(id, [[0, '#33405e'], [1, '#0b101e']]) + blur(id + 'b', 18)) + rect('url(#' + id + ')') + '<g filter="url(#' + id + 'b)" fill="#8fa0c8" opacity=".35"><ellipse cx="200" cy="140" rx="230" ry="70"/><ellipse cx="560" cy="110" rx="270" ry="80"/><ellipse cx="420" cy="230" rx="300" ry="60"/></g><path class="sc-tw" style="--t:6s" d="M430 230 L380 360 H430 L395 480 L500 320 H445 L480 230Z" fill="#fff6cf" opacity=".9"/><g stroke="#cfe0ff" stroke-width="1.2" opacity=".3">' + Array.from({length: 24}, (_, i) => '<line x1="' + (i * 36) + '" y1="' + (300 + (i * 37) % 120) + '" x2="' + (i * 36 - 18) + '" y2="' + (340 + (i * 37) % 120) + '"/>').join('') + '</g>';
SCENES.hex = id => defs(id, lin(id, [[0, '#1b4fd0'], [1, '#08164a']]) + pattern(id + 'p', 60, 52, '<path d="M30 0 L60 15 V37 L30 52 L0 37 V15Z" fill="none" stroke="#9ed0ff" stroke-width="1.2" opacity=".35"/>') + rad(id + 'g', [[0, '#7cc8ff', .5], [1, '#7cc8ff', 0]], .5, .3, .6)) + rect('url(#' + id + ')') + rect('url(#' + id + 'p)') + rect('url(#' + id + 'g)');

SCENES.nikolay = id => defs(id, lin(id, [[0, '#8fc6f2'], [.6, '#cfe8fb'], [1, '#f2f8ff']]) + rad(id + 'g', [[0, '#fff', .8], [1, '#fff', 0]], .7, .15, .5)) + rect('url(#' + id + ')') + '<circle cx="560" cy="120" r="160" fill="url(#' + id + 'g)"/>' +
    hills('#b9d6ee', 430, 40, 3, .8) + pineRow('#2f6a55', 470, 150, 4, '#fff', 60) +
    '<g><rect x="520" y="372" width="170" height="104" fill="#6b4a32"/><path d="M505 380 L605 306 L705 380Z" fill="#fff"/><path d="M515 380 L605 316 L695 380 L690 384 L605 326 L520 384Z" fill="#8a6a4a"/><g class="sc-breath"><rect x="545" y="404" width="34" height="34" fill="#ffc861"/><rect x="630" y="404" width="34" height="34" fill="#ffc861"/><circle cx="562" cy="421" r="40" fill="#ffc861" opacity=".22"/><circle cx="647" cy="421" r="40" fill="#ffc861" opacity=".22"/></g><rect x="595" y="428" width="26" height="48" fill="#4a2f1c"/></g>' +
    pineRow('#1d5240', 560, 230, 8, '#fff', 100) + hills('#ffffff', 580, 22, 5) + snow(22, 6, {slow: 20}) + '<rect x="0" y="0" width="800" height="600" fill="none" stroke="#c98a3a" stroke-width="10" opacity=".55"/>';
SCENES.goshan = id => defs(id, lin(id, [[0, '#081a4a'], [1, '#1f4aa0']])) + rect('url(#' + id + ')') + (() => {
    const r = rnd(41); const px = 16; let s = '<g shape-rendering="crispEdges">';
    for (let i = 0; i < 40; i++) s += '<rect class="sc-tw" x="' + Math.round(r() * 49) * px + '" y="' + Math.round(r() * 20) * px + '" width="4" height="4" fill="#fff" style="--d:-' + f(r() * 5) + 's;--t:4s"/>';
    s += '<rect x="640" y="64" width="64" height="64" fill="#fff2b0"/><rect x="624" y="80" width="16" height="32" fill="#fff2b0"/><rect x="704" y="80" width="16" height="32" fill="#fff2b0"/>';
    const steps = [[0, 400], [96, 368], [192, 336], [288, 368], [384, 320], [480, 352], [576, 384], [672, 352], [768, 400]];
    for (let i = 0; i < steps.length - 1; i++) s += '<rect x="' + steps[i][0] + '" y="' + steps[i][1] + '" width="' + (steps[i + 1][0] - steps[i][0]) + '" height="' + (600 - steps[i][1]) + '" fill="#2b4f9a"/>';
    for (let i = 0; i < steps.length - 1; i++) s += '<rect x="' + steps[i][0] + '" y="' + steps[i][1] + '" width="' + (steps[i + 1][0] - steps[i][0]) + '" height="16" fill="#e8f1ff"/>';
    s += '<rect y="464" width="800" height="136" fill="#1f6a3a"/><rect y="464" width="800" height="16" fill="#f4f8ff"/>';
    const tree = (x, y, h) => { let t = '<rect x="' + (x + 24) + '" y="' + (y + h - 16) + '" width="16" height="16" fill="#5a3a22"/>'; for (let i = 0; i < 4; i++) t += '<rect x="' + (x + i * 8) + '" y="' + (y + i * 24) + '" width="' + (64 - i * 16) + '" height="24" fill="#1d8a45"/><rect x="' + (x + i * 8) + '" y="' + (y + i * 24) + '" width="' + (64 - i * 16) + '" height="8" fill="#fff"/>'; return t; };
    [40, 160, 560, 700].forEach((x, k) => { s += tree(x, 340 + (k % 2) * 30, 110); });
    s += '<rect x="300" y="380" width="160" height="96" fill="#8a3a22"/><rect x="288" y="364" width="184" height="24" fill="#e84a3a"/><rect x="304" y="348" width="152" height="16" fill="#e84a3a"/><rect x="320" y="332" width="120" height="16" fill="#fff"/><rect class="sc-breath" x="324" y="408" width="32" height="32" fill="#ffd27a"/><rect class="sc-breath" x="404" y="408" width="32" height="32" fill="#ffd27a"/><rect x="368" y="424" width="24" height="52" fill="#4a2414"/>';
    for (let i = 0; i < 18; i++) s += '<rect class="sc-fall" x="' + Math.round(r() * 49) * px + '" y="0" width="6" height="6" fill="#fff" opacity=".9" style="--t:' + f(12 + r() * 10) + 's;--d:-' + f(r() * 20) + 's;--dx:0px"/>';
    return s + '</g>';
})();
SCENES.gifton = id => defs(id, lin(id, [[0, '#0b2d70'], [.55, '#2e73c8'], [1, '#8fd0ff']]) + lin(id + 'b', [[0, '#fff', 0], [.5, '#fff', .22], [1, '#fff', 0]], 1, 0)) + rect('url(#' + id + ')') +
    '<g><polygon points="120,0 220,0 520,600 380,600" fill="url(#' + id + 'b)"/><polygon points="420,0 480,0 760,600 680,600" fill="url(#' + id + 'b)" opacity=".7"/><polygon points="-40,0 40,0 240,600 140,600" fill="url(#' + id + 'b)" opacity=".5"/></g>' + (() => {
        const r = rnd(9); let s = '<g stroke="#fff" stroke-linecap="round" fill="none" opacity=".55">';
        for (let i = 0; i < 8; i++) { const x = r() * 800, y = r() * 520, k = .5 + r() * .9; s += '<g transform="translate(' + f(x) + ' ' + f(y) + ') scale(' + f(k) + ')" stroke-width="3">'; for (let a = 0; a < 6; a++) s += '<g transform="rotate(' + a * 60 + ')"><line y2="-44"/><path d="M0-24 L-9-35 M0-24 L9-35"/></g>'; s += '</g>'; }
        return s + '</g>';
    })() + sparkle(150, 140, 1.1, '#fff', 0) + sparkle(640, 90, .8, '#e6f4ff', 2) + sparkle(470, 340, .7, '#fff', 4) + hills('#cfe6ff', 540, 30, 3, .85) + hills('#f4faff', 580, 20, 6);
SCENES.collab = id => defs(id, lin(id, [[0, '#2a1470'], [1, '#0b2f7a']]) + rad(id + 'a', [[0, '#ff5fb0', .6], [1, '#ff5fb0', 0]]) + rad(id + 'b', [[0, '#4fd6ff', .6], [1, '#4fd6ff', 0]])) + rect('url(#' + id + ')') +
    '<circle cx="300" cy="300" r="260" fill="url(#' + id + 'a)"/><circle cx="520" cy="300" r="260" fill="url(#' + id + 'b)"/><circle cx="300" cy="300" r="170" fill="none" stroke="#ffb3d9" stroke-width="3" opacity=".6"/><circle cx="520" cy="300" r="170" fill="none" stroke="#a8ecff" stroke-width="3" opacity=".6"/>' +
    stars(60, 23, {h: 560}) + sparkle(410, 300, 1.8, '#fff', 0) + sparkle(220, 150, .8, '#ffd3ec', 2) + sparkle(610, 450, .9, '#c4f3ff', 3);
// aliases: card / section keys without a scene of their own
SCENES.pink = SCENES.rose;

const lite = () => matchMedia('(max-width:760px),(pointer:coarse)').matches;
const cache = new Map();
const STILL_CSS = '<style>.sc-fw{opacity:.8}.sc-tw{opacity:.75}.sc-fall,.sc-gust,.sc-rise{display:none}</style>';
function render(key, opts = {}) {
    const k = norm(key), make = SCENES[k] || SCENES.night;
    if (opts.still || lite()) {                                      // a still picture: it is drawn once by the browser and costs nothing afterwards
        let src = cache.get(k);
        if (!src) {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">' + STILL_CSS + make('s' + k) + '</svg>';
            src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            cache.set(k, src);
        }
        return '<img class="sc sc-img sc-' + k + '" src="' + src + '" alt="" draggable="false" decoding="async">';
    }
    const id = 'sc' + (++counter);
    return '<svg class="sc sc-' + k + '" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' + make(id) + '</svg>';
}
const LIGHT = new Set(['frost', 'ice', 'mint', 'rose', 'polar', 'sunset', 'gold', 'forest', 'skating', 'sunrise', 'desert', 'cherry', 'bubbles']);   // text on these needs a darker outline
window.crafterScenes = {render, norm, has: key => Boolean(SCENES[norm(key)]), light: key => LIGHT.has(norm(key))};
})();
