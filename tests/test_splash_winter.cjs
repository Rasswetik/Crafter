const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('templates/index.html','utf8');
const backup=fs.readFileSync('templates/splash-classic-backup.html','utf8');
const css=fs.readFileSync('static/splash-winter.css','utf8');
const hat=fs.readFileSync('static/assets/splash-santa-hat.svg','utf8');
assert.match(backup,/id="splash" class="splash"/);
assert.match(backup,/splash-watch-platinum.png/);
assert.match(backup,/splash-ring-chrome.png/);
assert.match(backup,/splash-bonded-silver.png/);
assert.match(backup,/splash-magnate.png/);
assert.match(html,/id="splash" class="splash splash-winter"/);
assert.match(html,/src="\/static\/assets\/splash-magnate.png"/);
for (const gift of ['Ginger%20Cookie/png/Santa%20Claus.png','Snow%20Globe/png/Night%20Snow.png','Plush%20Pepe/png/Christmas.png']){
  assert.ok(html.includes(gift),gift+' should be featured as a real winter NFT model');
}
assert.equal((html.match(/class="splash-gift [^"]*splash-gift-classic"/g)||[]).length,3);
assert.equal((html.match(/class="splash-gift [^"]*splash-gift-winter"/g)||[]).length,3);
assert.match(html,/splash-santa-hat.svg/);
assert.match(html,/splash-winter.css/);
assert.match(html,/splash=|get\("splash"\)/);
assert.match(css,/prefers-reduced-motion/);
assert.match(css,/splash-winter-snowbank/);
assert.match(css,/splash-progress/);
assert.match(hat,/<svg /);
console.log('Original splash is preserved, the existing Pepe sprite is retained, and winter variant is reversible.');
