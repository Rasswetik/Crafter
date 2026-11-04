const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');

const root=path.join(__dirname,'..');
const share=fs.readFileSync(path.join(root,'static/gift-share.js'),'utf8');
const catalog=fs.readFileSync(path.join(root,'static/catalog-ui.js'),'utf8');
const offers=fs.readFileSync(path.join(root,'static/offers.js'),'utf8');
const modalCSS=fs.readFileSync(path.join(root,'static/gift-dialog-polish.css'),'utf8');
const template=fs.readFileSync(path.join(root,'templates/index.html'),'utf8');
const calls=[];
const state={me:{invite_link:'https://t.me/crafter_robot?startapp=ref_42'},
    detailGift:{id:'nft-77',name:'Lucky Locket',number:5469,
        telegram_url:'https://t.me/nft/luckylocket-5469'},
    catalog:{collections:[]},gifts:[],inventory:[]};
const sandbox={state,Promise,console,
    tg:{openTelegramLink:url=>calls.push(url)},
    telegramGiftLink:gift=>gift.telegram_url||'',
    boot:async()=>{},window:{open:url=>calls.push(url)},
    location:{search:''},api:async()=>({}),showGiftDetail:()=>{},
    toast:message=>calls.push('toast:'+message),
    navigator:{clipboard:{writeText:async()=>{}}}
};
vm.createContext(sandbox);
vm.runInContext(share,sandbox,{filename:'gift-share.js'});
const exec=expression=>vm.runInContext(expression,sandbox);
assert.equal(exec('crafterShareBotBase()'),'https://t.me/crafter_robot');
assert.equal(exec('crafterGiftShareParam(state.detailGift)'),'nft_luckylocket-5469');
assert.equal(exec('crafterGiftFromParam("nft_luckylocket-5469").number'),'5469');
assert.equal(exec('crafterGiftFromParam("nft_<script>-1")'),null);
assert.equal(exec('crafterGiftFromParam("lot_../../admin")'),null);
assert.equal(exec('crafterGiftFromParam("nft_no-0")'),null);
assert.match(exec('crafterGiftEyeSVG()'),/viewBox="0 0 14 10"/);
assert.match(exec('crafterGiftShareSVG()'),/viewBox="0 0 21 20"/);
assert.match(exec('crafterTelegramPlaneSVG()'),/viewBox="0 0 24 24"/);
assert.match(catalog,/class="gift-detail-tool gift-send-tool"/);
assert.match(modalCSS,/#sheet\.catalog-sheet \.sheet-head > \.close \{display:none!important;\}/);

assert.match(exec('crafterLuckyActionSVG()'),/viewBox="0 0 24 24"/);
assert.match(catalog,/class="gift-detail-tool gift-eye-tool"/);
assert.match(catalog,/class="gift-detail-tool gift-share-tool"/);
assert.ok(catalog.indexOf('class="lucky-craft"')<catalog.indexOf('class="market-offer-primary"'),
    'Lucky Craft must remain above offer and buy buttons');
assert.ok(!catalog.includes('<span>Источник</span>'), 'gift dialog must not display Source');
assert.match(offers,/appSheet\.classList\.add\('offer-sheet'\)/);
assert.match(offers,/if \(gift\) state\.detailGift = null/);
assert.match(modalCSS,/#sheet\.purchase-sheet\[open\]/);
assert.match(modalCSS,/#sheet\.offer-sheet\[open\]/);
assert.match(modalCSS,/pointer-events:auto/);
assert.ok(template.includes('gift-dialog-polish.css')&&template.indexOf('gift-share.js')<template.indexOf('loading.js'));
(async()=>{
  await exec('shareDetailGift()');
  assert.equal(calls.length,1);
  const shared=new URL(calls[0]);
  assert.equal(shared.origin,'https://t.me');
  assert.equal(shared.pathname,'/share/url');
  assert.equal(shared.searchParams.get('url'),'https://t.me/crafter_robot?startapp=nft_luckylocket-5469');
  console.log('Gift SVGs, floating offers, and Telegram deep-link sharing: PASS');
})().catch(err=>{console.error(err);process.exitCode=1});
