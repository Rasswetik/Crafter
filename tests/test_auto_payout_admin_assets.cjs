const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('templates/admin.html','utf8');
const wallet = fs.readFileSync('static/wallet.js','utf8');
const payout = fs.readFileSync('static/auto-payout-admin.js','utf8');
const css = fs.readFileSync('static/auto-payout-admin.css','utf8');
assert.ok(html.includes('/static/auto-payout-admin.css?v='),'Auto payout styles must be included in admin page');
const walletScript = html.indexOf('/static/wallet.js?');
const payoutScript = html.indexOf('/static/auto-payout-admin.js?');
const entryScript = html.indexOf('/static/admin-page.js?');
assert.ok(walletScript>=0 && payoutScript>walletScript && entryScript>payoutScript,
  'Auto payout script must load before admin entrypoint');
assert.match(payout,/async function renderAutoPayoutAdmin\s*\(/);
assert.match(wallet,/typeof renderAutoPayoutAdmin === 'function'/);
assert.match(wallet,/Дополнительные настройки автовыплат временно недоступны/);
assert.ok(css.includes('crafter-auto-setup'));
console.log('TON Connect admin payout module loads in correct order and has fallback.');
