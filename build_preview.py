"""Build a self-contained preview with a persistent, browser-local test inventory."""
import base64,json,gzip
from pathlib import Path
from app import CRAFT_GIFT_LIMIT, DEMO_GIFTS
root=Path(__file__).parent
def build_preview():
    html=(root/'templates/index.html').read_text().replace('<script async src="https://telegram.org/js/telegram-web-app.js"></script>','')
    html=html.replace('<link rel="stylesheet" href="/static/style.css">','<style>'+(root/'static/style.css').read_text()+'</style>')
    mock=r'''
    const previewGifts=GIFTS;
const previewCatalog=CATALOG_SEED;
    const previewQuotes = new Map();
    let nextPreviewQuote = 0;
    let demoState;
    try{demoState=JSON.parse(localStorage.getItem('crafter-v2'))}catch{}
    if(!demoState)demoState={inventory:previewGifts.map(x=>({...x,status:'unlisted'})),history:[],balance:100,selection:{},requests:{}};
    function persistDemo(){try{localStorage.setItem('crafter-v2',JSON.stringify(demoState))}catch{}}
    function demoHistory(kind,data){demoState.history.unshift({id:String(Date.now()),kind,data,created:Date.now()/1000})}
    const fetchExternal = window.fetch.bind(window);
    window.fetch=async (url,options={})=>{
     if(!url.startsWith('/api/'))return fetchExternal(url,options);
     const route=url.replace('/api/','').split('?')[0],body=JSON.parse(options.body||'{}');let data={},ok=true;
     if(route==='craft/targets')data={gifts:previewGifts,demo:true};
     else if(route==='me')data={user:{id:5257227756,first_name:'Гошан',username:'goshan_wow'},is_admin:true,demo:true,balance:String(demoState.balance),inventory_count:demoState.inventory.length,inventory_value:String(demoState.inventory.reduce((a,x)=>a+Number(x.price),0)),bought:demoState.history.filter(x=>x.kind==='buy').length,sold:0,volume:'0',referrals:0,referral_level:1,referral_progress:0,invite_link:null};
     else if(route==='market')data={gifts:previewGifts,demo:true,source:'demo'};
     else if(route==='inventory')data={gifts:demoState.inventory,demo:true};
     else if(route==='history')data={items:demoState.history};
     else if(route==='catalog')data={collections:previewCatalog.collections,attributes:{},source:'snapshot'};
     else if(route.startsWith('collections/')){let slug=decodeURIComponent(route.split('/')[1]);data={models:previewCatalog.collections.find(c=>c.id===slug)?.models||[]}}
     else if(route==='admin/users')data={users:[{id:5257227756,name:'Гошан',username:'goshan_wow',balance:String(demoState.balance),gifts:demoState.inventory.length}]};
     else if(route.endsWith('/balance')){demoState.balance=Number(body.balance);data={ok:true}}
     else if(route.startsWith('admin/users/')&&route.endsWith('/gifts')){let c=previewCatalog.collections.find(c=>c.id===body.collection_id),m=c?.models.find(x=>x.name===body.model);if(m){demoState.inventory.push({id:'grant-'+Date.now(),collection_id:c.id,name:c.name,model:m.name,image:m.image,price:m.price,status:'unlisted',number:''});data={ok:true}}else{ok=false;data={error:'Выберите модель'}}}
     else if (route === 'craft/quote') {
        const ids = body.gift_ids;
        const target = previewCatalog.collections.find(collection => collection.id === body.target_id);
        if (!Array.isArray(ids) || !ids.length || ids.length > GIFT_LIMIT || new Set(ids).size !== ids.length) {
            ok = false;
            data = {error: 'Выберите от 1 до 4 подарков'};
        } else if (!target || !ids.every(id => demoState.inventory.some(gift => gift.id === id && gift.status === 'unlisted'))) {
            ok = false;
            data = {error: 'Подарок недоступен'};
        } else {
            const id = 'preview-' + Date.now() + '-' + nextPreviewQuote++;
            const expires = Date.now() / 1000 + 120;
            data = {quote_id: id, expires_at: expires, chance: ids.length * 20};
            previewQuotes.set(id, {...data, ids, target});
        }
     }
     else if (route === 'craft') {
        const prior = demoState.requests[body.request_id];
        const quote = previewQuotes.get(body.quote_id);
        if (prior) data = prior;
        else if (!quote || quote.expires_at <= Date.now() / 1000) {
            ok = false;
            data = {error: 'Расчёт устарел. Повторите выбор.'};
        } else if (!quote.ids.every(id => demoState.inventory.some(gift => gift.id === id && gift.status === 'unlisted'))) {
            ok = false;
            data = {error: 'Подарок недоступен'};
        } else {
            const {ids, target, chance} = quote;
            const model = target.models?.[Math.floor(Math.random() * target.models.length)];
            const success = Math.random() * 100 < chance;
            const gift = success ? {id: 'crafted-' + Date.now(), collection_id: target.id,
                name: target.name, image: model?.image || target.photo_url, model: model?.name || '',
                price: target.floor_price, number: Math.floor(Math.random() * 999999) + 1,
                status: 'unlisted', price_unit: 'GRAM', crafted: true} : null;
            demoState.inventory = demoState.inventory.filter(item => !ids.includes(item.id));
            if (gift) demoState.inventory.push(gift);
            data = {demo: true, success, gift, consumed: ids};
            demoState.requests[body.request_id] = data;
            previewQuotes.delete(body.quote_id);
            demoHistory('craft', data);
        }
     }
     else if(route==='inventory/action'){
      let selected=demoState.inventory.filter(x=>body.gift_ids.includes(x.id));
      if(!selected.length||body.action==='sell'&&!(Number(body.price)>0)||body.action==='transfer'&&!body.recipient){ok=false;data={error:'Проверьте выбранные подарки и поля'}}
      else{if(body.action==='sell')selected.forEach(x=>{x.status='listed';x.price=body.price});else if(body.action==='unlist')selected.forEach(x=>x.status='unlisted');else demoState.inventory=demoState.inventory.filter(x=>!body.gift_ids.includes(x.id));demoHistory(body.action,{gifts:selected,demo:true});data={ok:true,demo:true}}
     }
     else if(route==='demo/buy'){let g=previewGifts.find(x=>x.id===body.id);if(!g||demoState.balance<Number(g.price)){ok=false;data={error:'Не хватает тестового баланса'}}else{let gift={...g,id:'bought-'+Date.now(),number:Math.floor(Math.random()*999999),status:'unlisted'};demoState.balance-=Number(g.price);demoState.inventory.push(gift);demoHistory('buy',gift);data={ok:true,gift,demo:true}}}
     else if(route==='admin/status')data={configured:false,updated_at:null,collections:114,users:1,mode:'public',sync:{running:false,completed:0,total:114,error:''},audit:[]};
     else if(route==='admin/selection'){if(options.body)demoState.selection=body.selection;data={selection:demoState.selection,ok:true}}
     else if(route.startsWith('admin/portal')){ok=false;data={error:'В HTML-превью нет доступа к Portal. Задайте Partner API-ключ в .env Flask-сервера.'}}
     persistDemo();return {ok,json:async()=>data};
    };
    '''.replace('GIFTS',json.dumps(DEMO_GIFTS,ensure_ascii=False)).replace('GIFT_LIMIT',str(CRAFT_GIFT_LIMIT)).replace('CATALOG_SEED',gzip.decompress((root/'data/catalog_seed.json.gz').read_bytes()).decode())
    for script in (root/'static').glob('*.js'):
        body = (mock + '\n' if script.name == 'app.js' else '') + script.read_text()
        html = html.replace(f'<script src="/static/{script.name}"></script>', '<script>' + body + '</script>')
    for file in (root/'static/assets').iterdir():
        if file.suffix in ('.webp', '.png') and '/static/assets/' + file.name in html:
            encoded = base64.b64encode(file.read_bytes()).decode()
            html = html.replace('/static/assets/' + file.name, f'data:image/{file.suffix[1:]};base64,{encoded}')
    html=html.replace('ДЕМО · тестовые цены и подарки','ТЕСТОВЫЙ РЕЖИМ')
    return html

if __name__=="__main__":
    html=build_preview()
    (root/"Gift_Market_Preview.html").write_text(html)
    (root/"Crafter_Preview.html").write_text(html)
    print("Crafter preview built")
