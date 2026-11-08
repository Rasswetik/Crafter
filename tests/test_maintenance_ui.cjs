/* Maintenance UI must not cause an infinite reload in normal operation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const js = fs.readFileSync('static/site-maintenance.js','utf8');
function classSet(initial=[]) {
  const items=new Set(initial);
  return {contains:n=>items.has(n), add:n=>items.add(n), remove:n=>items.delete(n)};
}
const overlay={classList:classSet(),setAttribute(){}};
const button={disabled:false,textContent:'Попробовать снова'};
const label={textContent:''};
const message={textContent:''};
const body={classList:classSet()};
let reloads=0, enabled=false;
const context={
  window:{},
  document:{
    readyState:'complete',hidden:false,body,
    getElementById(id){return ({
      'crafter-maintenance':overlay,
      'crafter-maintenance-status':label,
      'crafter-maintenance-retry':button,
      'crafter-maintenance-message':message
    })[id]||null;}
  },
  location:{reload(){reloads++;}},
  fetch:async()=>({ok:true,json:async()=>({enabled,message:'Ремонт'})}),
  setInterval(){},
};
vm.runInNewContext(js,context);
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reloads,0,'Normal app load must not trigger a reload');
  assert.equal(overlay.classList.contains('is-active'),false);
  enabled=true;
  context.fetch=async url=>url.endsWith('/access')
    ? {ok:true,json:async()=>({is_admin:false})}
    : {ok:true,json:async()=>({enabled,message:'Технические работы'})};
  await context.window.crafterRetryMaintenance();
  assert.equal(overlay.classList.contains('is-active'),true);
  assert.equal(message.textContent,'Технические работы');
  enabled=false;
  context.fetch=async()=>({ok:true,json:async()=>({enabled:false})});
  await context.window.crafterRetryMaintenance();
  assert.equal(reloads,1,'Only a previously locked maintenance screen may reload');
  console.log('Crafter maintenance retry/reload regression passed');
})().catch(error=>{console.error(error);process.exit(1)});
