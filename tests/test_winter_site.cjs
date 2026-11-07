const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('templates/index.html','utf8');
const css=fs.readFileSync('static/winter-site.css','utf8');
const splash=fs.readFileSync('static/splash-approved.css','utf8');
const ordinaryBanners=fs.readFileSync('static/market-banners.js','utf8');
const topLights=fs.readFileSync('static/assets/crafter-hanging-lights.svg','utf8');
const sideLights=fs.readFileSync('static/assets/crafter-side-vine.svg','utf8');

// No winter promo injection; retain original banners and app navigation.
assert.doesNotMatch(html,/winter-promos\.js/);
assert.doesNotMatch(html,/winter-promos/);
assert.ok(!fs.existsSync('static/winter-promos.js'));
assert.ok(html.includes('/static/market-banners.js'));
assert.ok(html.includes('/static/banner-carousel.js'));
assert.ok(ordinaryBanners.includes('makeBannerCarousel'));
assert.ok(html.includes('/static/arena.js'));

// The old full-width strip is absent, and garlands never occupy a layout row.
assert.ok(!html.includes('class="site-winter-garland"'));
assert.ok(html.includes('</header><main id="main">'));
assert.ok(css.includes('#app > .site-winter-garland'));
assert.ok(css.includes('display:none!important'));
assert.ok(!fs.existsSync('static/assets/winter-garland.png'));
assert.ok(html.includes('restrained-four-garlands-20261107-v7'));

// Exactly two small top corners and two narrow side vines, with no injected JS.
assert.ok(css.includes('#app > header::before'));
assert.ok(css.includes('#app > header::after'));
assert.ok(css.includes('#app::before'));
assert.ok(css.includes('#app::after'));
assert.ok(css.includes('crafter-hanging-lights.svg?v=3'));
assert.ok(css.includes('crafter-side-vine.svg?v=1'));
assert.ok(css.includes('pointer-events:none!important'));
assert.ok(!css.includes('#app > header > * { position:relative'));
assert.ok(topLights.includes('<svg'));
assert.ok(sideLights.includes('<svg'));
assert.ok(topLights.includes('#ffd075'));
assert.ok(sideLights.includes('#ffd075'));

// Preserve Craft information button and original splash, don't move the layout.
assert.ok(html.includes('class="craft-header"><button class="info-btn"'));
assert.ok(css.includes('#app.craft-view > header > .craft-header'));
assert.ok(splash.includes('object-fit:contain!important'));
console.log('Garlands at four edge locations; original Crafter layout and banners preserved.');
