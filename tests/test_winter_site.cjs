const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('templates/index.html','utf8');
const css=fs.readFileSync('static/winter-site.css','utf8');
const splash=fs.readFileSync('static/splash-approved.css','utf8');
const banners=fs.readFileSync('static/market-banners.js','utf8');
const canopy=fs.readFileSync('static/assets/crafter-top-canopy.svg','utf8');

// All original banner, inventory and Arena functionality is untouched.
assert.ok(html.includes('/static/market-banners.js'));
assert.ok(html.includes('/static/banner-carousel.js'));
assert.ok(html.includes('/static/arena.js'));
assert.ok(banners.includes('makeBannerCarousel'));
assert.ok(!html.includes('winter-promos'));
assert.ok(!fs.existsSync('static/winter-promos.js'));

// Garlands must decorate the existing header, never take layout height.
assert.ok(html.includes('</header><main id="main">'));
assert.ok(!html.includes('class="site-winter-garland"'));
assert.ok(css.includes('#app > header::before'));
assert.ok(css.includes('crafter-top-canopy.svg?v=1'));
assert.ok(html.includes('fullwidth-top-canopy-20261107-v8'));
assert.ok(css.includes('width:100%'));
assert.ok(css.includes('pointer-events:none!important'));
assert.ok(!css.includes('#app::before'));
assert.ok(!css.includes('#app::after'));
assert.ok(!css.includes('#app > header::after'));
assert.ok(!css.includes('crafter-side-vine.svg'));

// The new top arrangement consists of six different swags across 510 px.
assert.ok(canopy.includes('viewBox="0 0 510 64"'));
assert.equal((canopy.match(/stroke="#0e2c20"/g)||[]).length,6);
assert.equal((canopy.match(/<ellipse cx=/g)||[]).length,54);
assert.ok(canopy.includes('#ffd275'));

// Only small optional ornaments close to Arena board and Craft top.
assert.ok(css.includes('#app.arena-view .arena-board-frame::after'));
assert.ok(css.includes('#app.craft-view .craft-page::after'));
assert.ok(css.includes('pointer-events:none!important'));

// Preserve Craft info button and approved splash.
assert.ok(html.includes('class="craft-header"><button class="info-btn"'));
assert.ok(css.includes('#app.craft-view > header > .craft-header'));
assert.ok(splash.includes('object-fit:contain!important'));
console.log('Crafter winter canopy: 6 top swags, no side vines, unchanged menus.');
