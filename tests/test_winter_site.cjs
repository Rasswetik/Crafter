const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('templates/index.html','utf8');
const css=fs.readFileSync('static/winter-site.css','utf8');
const splash=fs.readFileSync('static/splash-approved.css','utf8');
const ordinaryBanners=fs.readFileSync('static/market-banners.js','utf8');

// No winter promo script or auto-inserted mode cards on ANY page.
assert.doesNotMatch(html,/\/static\/winter-promos\.js/);
assert.doesNotMatch(html,/<section class="winter-promos/);
assert.doesNotMatch(css,/\.winter-promos|\.winter-promo(?!-)/);
assert.doesNotMatch(css,/winter-banners-atlas\.avif/);
assert.ok(!fs.existsSync('static/winter-promos.js'),'Remove the injected winter promo module');

// Keep the existing genuine game/market/event banner system.
assert.match(html,/\/static\/market-banners\.js/);
assert.match(html,/\/static\/banner-carousel\.js/);
assert.match(ordinaryBanners,/makeBannerCarousel/);
assert.match(html,/\/static\/arena\.js/);
assert.match(html,/class="craft-header"><button class="info-btn"/);

// Real transparent PNG garland, no generated promo panels.
assert.match(html,/<\/header><div class="site-winter-garland" aria-hidden="true"><\/div><main id="main">/);
assert.match(css,/winter-garland\.png/);
assert.match(css,/pointer-events:none/);
assert.match(css,/background-size:100% auto/);
assert.match(css,/#app\.craft-view > header > \.craft-header/);
assert.match(splash,/object-fit:contain!important/);
console.log('No injected winter banners. Existing banner system and transparent garland retained.');
