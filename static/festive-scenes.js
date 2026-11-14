/* Live backgrounds of the New Year market. Every background is a stack of light layers (a gradient, soft glows, falling snow, stars, hills,
   garlands, drifting patterns) that move all the time: only transform and opacity are animated, so it is cheap on a phone too.
   The same scenes dress the sections, the cards, the window of a lot and the reveal after a purchase.
   A key is a scene and a palette; old keys that came from the first versions are mapped onto the same scenes. */
(function () {
'use strict';

/* palettes: [c1, c2, c3, accent, light]  (light = the text on it needs a darker outline) */
const PAL = {
    sunset: ['#32c8ff', '#c24df0', '#ff8ad0', '#ffe9a8'], ice: ['#1f8bff', '#2fd0ff', '#b8f2ff', '#ffffff', 1], aurora: ['#06122e', '#0f3a6b', '#2fe0b0', '#a06bff'],
    village: ['#0a1240', '#27408f', '#6fa8ff', '#fff2c0'], candy: ['#e8203a', '#ffffff', '#ff6a82', '#ffd0d8'], ornaments: ['#1b3fa8', '#6a3de0', '#2fb8ff', '#ffd25e'],
    gifts: ['#7a1ed8', '#e0307a', '#ff9a3d', '#ffe08a'], lights: ['#0a2a52', '#12467f', '#2a7fc8', '#ffd25e'], berry: ['#e0305a', '#7a1054', '#ff8aa8', '#ffd0dc'],
    gold: ['#f0a82a', '#b85a10', '#ffe08a', '#fff6cf', 1], emerald: ['#12a86a', '#0a4a52', '#7af0b8', '#d8ffe8'], violet: ['#5a2cff', '#1c0f6b', '#c24fd8', '#ffb0f0'],
    sky: ['#2f6fdc', '#0f2a66', '#8fd0ff', '#d8f0ff'], mint: ['#1fc8a8', '#0b5a6a', '#a8ffe8', '#ffffff', 1], rose: ['#ff6aa8', '#8a1f66', '#ffc0dc', '#ffffff', 1],
    ocean: ['#0f8fd0', '#06306a', '#7fe8ff', '#d8f8ff'], lilac: ['#9a6aff', '#3a1a8a', '#e0c8ff', '#ffffff'], ember: ['#ff7a2a', '#7a1208', '#ffd070', '#fff0c0'],
    cocoa: ['#a8683a', '#3a1c0c', '#f0c898', '#fff0dc'], pine: ['#1f9a5a', '#08382a', '#8fe8a8', '#e8ffe8'], slate: ['#5a6a82', '#161c2a', '#b8c8e0', '#ffffff'],
    night: ['#0b1340', '#1f3a8a', '#7fa8ff', '#fff6cf'], frost: ['#dff4ff', '#7fc8f0', '#ffffff', '#ffffff', 1], blue: ['#2a6cff', '#0a2a8a', '#6ad0ff', '#d8f0ff'],
    crimson: ['#e8203a', '#6a0a22', '#ff7a8a', '#ffd0d8'], violet2: ['#7a3cff', '#2a0f7a', '#ff6ad0', '#ffd0f8'], steel: ['#7d8aa6', '#2a3350', '#c8d4ee', '#ffffff'],
    neon: ['#ff2fd0', '#3a0fb8', '#2fe8ff', '#fff0ff'], space: ['#05051a', '#2a1470', '#ff6ad0', '#6ad0ff'], brand: ['#2a1470', '#0b2f7a', '#ff5fb0', '#4fd6ff'],
    goshan: ['#081a4a', '#1f4aa0', '#ff6a5a', '#ffd25e'], nikolay: ['#2f6a3a', '#12381f', '#e8403a', '#ffd25e'], gifton: ['#0b2d70', '#2e73c8', '#8fd0ff', '#ffffff'],
};

/* scenes of the new picker */
const LIVE = {
    'live-sunset': ['sunset', 'sunset'], 'live-ice': ['wave', 'ice'], 'live-aurora': ['aurora', 'aurora'], 'live-village': ['night', 'village'], 'live-candy': ['stripes', 'candy'],
    'live-ornaments': ['pattern', 'ornaments'], 'live-gifts': ['pattern', 'gifts'], 'live-lights': ['lights', 'lights'], 'live-berry': ['wave', 'berry'], 'live-gold': ['wave', 'gold'],
    'live-emerald': ['wave', 'emerald'], 'live-violet': ['wave', 'violet'],
};
/* keys of the first versions: they live on, drawn by the new scenes */
const OLD = {};
const put = (scene, list) => list.forEach(x => { const [k, p] = x.split(':'); OLD[k] = [scene, p || k]; });
put('wave', ['softsky:sky', 'softberry:berry', 'softmint:mint', 'softgold:gold', 'softnight:night', 'softrose:rose', 'softocean:ocean', 'softlilac:lilac', 'softember:ember', 'softcocoa:cocoa', 'softpine:pine', 'softslate:slate',
    'blue', 'violet', 'crimson', 'emerald', 'gold', 'rose', 'mint', 'steel', 'ocean', 'forest:pine', 'lava:ember', 'jungle:pine', 'champagne:gold', 'ice', 'pine', 'bubbles:ocean', 'sky', 'violet2']);
put('night', ['village', 'snow:village', 'night', 'stars:night', 'moon:night', 'frost', 'polar:village', 'cabin:village', 'snowstorm:slate', 'cozy:cocoa', 'skating:frost', 'storm:slate', 'fireworks:violet2', 'northpole:village']);
put('aurora', ['aurora', 'galaxy:space', 'space']);
put('lights', ['garland:lights', 'lights', 'tree:pine', 'bauble:crimson', 'wreath:pine', 'sparklers:violet2', 'bells:gold']);
put('stripes', ['candy', 'santa:crimson']);
put('pattern', ['gifts', 'mitten:ornaments', 'berry', 'cocoa', 'nikolay', 'goshan', 'gifton', 'collab:brand', 'hex:blue', 'confetti:gifts', 'neon', 'cyber:neon']);
put('sunset', ['sunrise:ember', 'desert:ember', 'cherry:rose', 'sunset']);
const MAP = {'ny-snow': 'snow', 'ny-candy': 'candy', 'ny-lights': 'garland', 'ny-frost': 'frost', 'ny-ginger': 'cozy', 'ny-bells': 'bells', 'ny-fire': 'lava', 'ny-aurora': 'aurora', 'c-pink': 'rose', 'ny-gold': 'gold', 'lights': 'garland', 'bells': 'gold', 'fire': 'lava', 'ginger': 'cozy'};
const norm = key => { key = String(key || 'night'); if (LIVE[key]) return key; if (MAP[key]) return MAP[key]; return key.replace(/^(ny|c)-/, ''); };
const resolve = key => { const k = norm(key); return LIVE[k] || OLD[k] || ['night', 'night']; };

/* ---------- pictures for patterns (drawn once, used as tiles) ---------- */
const uri = svg => "url('data:image/svg+xml;utf8," + encodeURIComponent(svg) + "')";
const TILE = uri('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<g transform="translate(34 36)"><path d="M0-14V14M-12-7 12 7M-12 7 12-7"/><path d="M-4-12 0-8 4-12M-4 12 0 8 4 12"/></g>' +
    '<g transform="translate(126 30) rotate(14)"><path d="M0-15 4.5-5 15-4 7 3 9 14 0 8.5-9 14-7 3-15-4-4.500-5Z"/></g>' +
    '<g transform="translate(90 96)"><circle r="14"/><path d="M-6-14v-5h12v5M-8-4q8-6 16 0"/></g>' +
    '<g transform="translate(30 140) rotate(-10)"><rect x="-13" y="-9" width="26" height="20" rx="2"/><path d="M0-9V11M-13 0H13M0-9q-8-9-12-4t12 4q8-9 12-4t-12 4"/></g>' +
    '<g transform="translate(142 132) rotate(8)"><path d="M0-14 12 10H-12Z"/><path d="M-6 3H6"/></g>' +
    '<circle cx="62" cy="14" r="2.5" fill="#fff" stroke="none"/><circle cx="160" cy="84" r="2.5" fill="#fff" stroke="none"/><circle cx="10" cy="90" r="2.5" fill="#fff" stroke="none"/></svg>');
const FIRS = uri('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><g fill="#0a1d3f"><path d="M20 120 38 50 56 120Z"/><path d="M28 80 38 36 48 80Z"/><path d="M80 120 104 30 128 120Z"/><path d="M90 70 104 20 118 70Z"/><path d="M160 120 178 60 196 120Z"/><path d="M168 86 178 44 188 86Z"/><path d="M206 120 220 76 234 120Z"/></g><g fill="#fff" opacity=".9"><path d="M38 36 44 52H32Z"/><path d="M104 20 112 42H96Z"/><path d="M178 44 184 60H172Z"/></g></svg>');
const SWAG = uri('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="64" viewBox="0 0 200 64"><path d="M0 4Q50 52 100 4T200 4" fill="none" stroke="#0d2a1e" stroke-width="5"/><path d="M0 4Q50 52 100 4T200 4" fill="none" stroke="#2f7a4f" stroke-width="3"/></svg>');
const BULBS = c => uri('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="64" viewBox="0 0 200 64"><g fill="' + c + '"><circle cx="25" cy="28" r="5"/><circle cx="75" cy="38" r="5"/><circle cx="125" cy="38" r="5"/><circle cx="175" cy="28" r="5"/></g><g fill="' + c + '" opacity=".35"><circle cx="25" cy="28" r="11"/><circle cx="75" cy="38" r="11"/><circle cx="125" cy="38" r="11"/><circle cx="175" cy="28" r="11"/></g></svg>');
const dots = (n, seed) => { let s = seed, out = []; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const x = s % 100; s = (s * 16807) % 2147483647; out.push([x, s % 100]); } return out; };
const dotLayer = (n, seed, r) => dots(n, seed).map(([x, y]) => 'radial-gradient(circle at ' + x + '% ' + y + '%,#fff 0 ' + r + 'px,transparent ' + (r + .6) + 'px)').join(',');
const SNOWS = [dotLayer(7, 11, 1.6), dotLayer(6, 23, 2.4), dotLayer(5, 37, 3.4)];
const STARS = dotLayer(14, 5, 1.2);

/* ---------- the layers of each scene ---------- */
const bokeh = n => Array.from({length: n}, (_, i) => '<i class="ls-bk" style="--x:' + ((i * 37 + 8) % 92) + '%;--s:' + (26 + (i * 13) % 40) + 'px;--t:' + (13 + (i * 3) % 9) + 's;--d:-' + ((i * 2.3) % 14).toFixed(1) + 's"></i>').join('');
const snow = n => '<i class="ls-snow s1"></i><i class="ls-snow s2"></i>' + (n > 2 ? '<i class="ls-snow s3"></i>' : '');
const SC = {
    wave: () => '<i class="ls-base"></i><i class="ls-blob b1"></i><i class="ls-blob b2"></i><i class="ls-blob b3"></i><i class="ls-sheen"></i>' + bokeh(6) + snow(2),
    night: () => '<i class="ls-base v"></i><i class="ls-stars"></i><i class="ls-stars b"></i><i class="ls-moon"></i><i class="ls-hill h1"></i><i class="ls-firs"></i><i class="ls-hill h2"></i><i class="ls-hill h3"></i>' + snow(3),
    aurora: () => '<i class="ls-base v"></i><i class="ls-stars"></i><i class="ls-stars b"></i><i class="ls-rib r1"></i><i class="ls-rib r2"></i><i class="ls-rib r3"></i><i class="ls-hill h3"></i>' + snow(2),
    stripes: () => '<i class="ls-base"></i><i class="ls-stripe"></i><i class="ls-blob b1"></i><i class="ls-blob b2"></i><i class="ls-vig"></i>' + bokeh(4) + snow(2),
    pattern: () => '<i class="ls-base"></i><i class="ls-blob b1"></i><i class="ls-blob b2"></i><i class="ls-pat"></i><i class="ls-pat p2"></i><i class="ls-sheen"></i>' + snow(2),
    sunset: () => '<i class="ls-base v"></i><i class="ls-sun"></i><i class="ls-cloud c1"></i><i class="ls-cloud c2"></i><i class="ls-cloud c3"></i><i class="ls-hill h1"></i><i class="ls-firs"></i><i class="ls-hill h3"></i>' + snow(2),
    lights: () => '<i class="ls-base v"></i><i class="ls-stars"></i><i class="ls-swag"></i><i class="ls-bulbs g0"></i><i class="ls-bulbs g1"></i><i class="ls-bulbs g2"></i>' + bokeh(5) + snow(2),
};

const cache = new Map();
function render(key, opts = {}) {
    const k = norm(key), [scene, pal] = resolve(k), p = PAL[pal] || PAL.night;
    let html = cache.get(scene);
    if (!html) { html = SC[scene](); cache.set(scene, html); }
    return '<div class="ls ls-' + scene + (opts.still ? ' is-still' : '') + '" style="--c1:' + p[0] + ';--c2:' + p[1] + ';--c3:' + p[2] + ';--c4:' + p[3] + '" aria-hidden="true">' + html + '</div>';
}
/* the pictures the scenes share are put into the page once */
const sheet = document.createElement('style');
sheet.textContent = '.ls{--tile:' + TILE + ';--firs:' + FIRS + ';--swag:' + SWAG + ';--sn1:' + SNOWS[0] + ';--sn2:' + SNOWS[1] + ';--sn3:' + SNOWS[2] + ';--stars:' + STARS + ';--b0:' + BULBS('#ff5a5a') + ';--b1:' + BULBS('#ffd25e') + ';--b2:' + BULBS('#5ccfff') + '}';
document.head.appendChild(sheet);
window.crafterScenes = {render, norm, has: key => Boolean(LIVE[norm(key)] || OLD[norm(key)]), light: key => Boolean((PAL[resolve(key)[1]] || [])[4]), keys: Object.keys(LIVE)};
})();
