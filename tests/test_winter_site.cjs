const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('templates/index.html','utf8');
const css=fs.readFileSync('static/winter-site.css','utf8');
const splash=fs.readFileSync('static/splash-approved.css','utf8');
const ordinaryBanners=fs.readFileSync('static/market-banners.js','utf8');
const hangingLights=fs.readFileSync('static/assets/crafter-hanging-lights.svg','utf8');

// No injected winter promo cards; ordinary Crafter banners are preserved.
assert.doesNotMatch(html,/\/static\/winter-promos\.js/);
assert.doesNotMatch(html,/<section class="winter-promos/);
assert.doesNotMatch(css,/\.winter-promos|\.winter-promo(?!-)/);
assert.doesNotMatch(css,/winter-banners-atlas\.avif/);
assert.ok(!fs.existsSync('static/winter-promos.js'));
assert.match(html,/\/static\/market-banners\.js/);
assert.match(html,/\/static\/banner-carousel\.js/);
assert.match(ordinaryBanners,/makeBannerCarousel/);
assert.match(html,/\/static\/arena\.js/);

// Garland lives inside the existing header, never as a block above the content.
assert.doesNotMatch(html,/class="site-winter-garland"/);
assert.match(html,/<\/header><main id="main">/);
assert.match(css,/#app > header::before/);
assert.match(css,/crafter-hanging-lights\\.svg\\?v=3/);
assert.match(css,/crafter-side-vine\\.svg\\?v=1/);
assert.match(css,/#app > header::after/);
assert.match(css,/#app::before/);
assert.match(css,/#app::after/);
assert.doesNotMatch(css,/#app > header > \\* \\{ position:relative/);
assert.match(css,/#app > \.site-winter-garland \{ display:none!important; \}/);
assert.match(css,/pointer-events:none/);
assert.doesNotMatch(css,/#app > \.site-winter-garland\s*\{[^}]*height:clamp/s);
assert.ok(!fs.existsSync('static/assets/winter-garland.png'),'Outdated horizontal strip asset must be gone');
assert.match(hangingLights,/<svg/);
assert.match(hangingLights,/#[0-9a-f]{6}/i);
assert.doesNotMatch(hangingLights,/bell/i);

// Existing Craft info button and splash stay intact.
assert.match(html,/class="craft-header"><button class="info-btn"/);
assert.match(css,/#app\.craft-view > header > \.craft-header/);
assert.match(splash,/object-fit:contain!important/);
console.log('Crafter header garland is nonblocking; standard banners and menus are unchanged.');
