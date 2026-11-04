"""Build a self-contained preview with a persistent, browser-local test inventory."""
import base64,json,gzip
from pathlib import Path
from app import CRAFT_GIFT_LIMIT, DEMO_GIFTS
root=Path(__file__).parent
def build_preview():
    html=(root/'templates/index.html').read_text().replace('<script async src="https://telegram.org/js/telegram-web-app.js"></script>','')
    html = html.replace("{% include 'collection.html' %}", (root/'templates/collection.html').read_text())
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
     else if(route==='market/activity'){
        const params=new URLSearchParams(url.split('?')[1]||''), collectionIds=params.get('collections')?.split(',').filter(Boolean)||[];
        const items=demoState.history.filter(h=>['buy','sell','craft'].includes(h.kind)).flatMap(h=>{
          const gifts=h.kind==='sell'?h.data.gifts||[]:[h.data.gift||h.data];
          return gifts.filter(gift=>gift.name&&(!collectionIds.length||collectionIds.includes(gift.collection_id)))
              .map(gift=>({kind:h.kind,created:h.created,gift,price:h.kind==='buy'?h.data.price??gift.price:null}));
        });
        const models=[...new Set(items.map(item=>item.gift.model).filter(Boolean))],model=params.get('model');
        const filtered=model?items.filter(item=>item.gift.model===model):items;
        const buys=filtered.filter(item=>item.kind==='buy'),offset=Number(params.get('offset')||0);
        data={items:filtered.slice(offset,offset+35),models,purchases:buys.length,
          turnover:buys.reduce((total,item)=>total+Number(item.price||0),0),has_more:filtered.length>offset+35};
     }
     else if(route==='market')data={gifts:previewGifts.filter(gift => !demoState.luckySold?.includes(gift.id)),demo:true,source:'demo'};
     else if(route==='inventory')data={gifts:demoState.inventory,demo:true};
     else if(route==='history')data={items:demoState.history};
     else if(route==='wallet')data={balance:String(demoState.balance),withdrawable:'0',connected:null,
        config:{enabled:false,network:'testnet',gram_per_ton:'1',withdraw_enabled:false,withdraw_max:'2500'}};
     else if(route==='wallet/history'){
        const params=new URLSearchParams(url.split('?')[1]), kinds=params.get('types')?.split(',');
        const items=kinds?demoState.history.filter(item=>kinds.includes(item.kind)):demoState.history;
        const offset=Number(params.get('before')||0);
        data={items:items.slice(offset,offset+30),next_cursor:items.length>offset+30?String(offset+30):null};
     }
     else if(route==='catalog')data={collections:previewCatalog.collections,attributes:{},source:'snapshot'};
     else if(route.endsWith('/overview')&&route.startsWith('collections/')){
        const slug=decodeURIComponent(route.split('/')[1]),collection=previewCatalog.collections.find(c=>String(c.id)===slug);
        if(!collection){ok=false;data={error:'Коллекция не найдена'}}
        else{
            const buys=demoState.history.filter(h=>h.kind==='buy'&&(h.data.gift||h.data).name===collection.name);
            const total=rows=>rows.reduce((sum,h)=>sum+Number(h.data.price??h.data.gift?.price??0),0);
            data={collection,models:collection.models||[],volume_24h:total(buys.filter(h=>h.created>Date.now()/1000-86400)),volume_total:total(buys)};
        }
     }
     else if(route.startsWith('collections/')){let slug=decodeURIComponent(route.split('/')[1]);data={models:previewCatalog.collections.find(c=>c.id===slug)?.models||[]}}
     else if(route==='admin/users')data={users:[{id:5257227756,name:'Гошан',username:'goshan_wow',balance:String(demoState.balance),gifts:demoState.inventory.length}]};
     else if(route.endsWith('/balance')){demoState.balance=Number(body.balance);data={ok:true}}
     else if(route.startsWith('admin/users/')&&route.endsWith('/gifts')){let c=previewCatalog.collections.find(c=>c.id===body.collection_id),m=c?.models.find(x=>x.name===body.model);if(m){demoState.inventory.push({id:'grant-'+Date.now(),collection_id:c.id,name:c.name,model:m.name,image:m.image,price:m.price,status:'unlisted',number:''});data={ok:true}}else{ok=false;data={error:'Выберите модель'}}}
     else if (route === 'craft/quote') {
        const ids = body.gift_ids;
        const target = previewCatalog.collections.find(collection => collection.id === body.target_id);
        const listing = body.listing_id && previewGifts.find(gift => gift.id === body.listing_id && gift.name === target?.name &&
            !demoState.luckySold?.includes(gift.id));
        if (!Array.isArray(ids) || !ids.length || ids.length > GIFT_LIMIT || new Set(ids).size !== ids.length) {
            ok = false;
            data = {error: 'Выберите от 1 до 4 подарков'};
        } else if (!target || (body.listing_id && !listing) || !ids.every(id => demoState.inventory.some(gift => gift.id === id && gift.status === 'unlisted'))) {
            ok = false;
            data = {error: 'Подарок недоступен'};
        } else {
            const id = 'preview-' + Date.now() + '-' + nextPreviewQuote++;
            const expires = Date.now() / 1000 + 120;
            data = {quote_id: id, expires_at: expires, chance: ids.length * 20};
            previewQuotes.set(id, {...data, ids, target, listing});
        }
     }
     else if (route === 'craft') {
        const prior = demoState.requests[body.request_id];
        const quote = previewQuotes.get(body.quote_id);
        if (prior) data = prior;
        else if (!quote || quote.expires_at <= Date.now() / 1000) {
            ok = false;
            data = {error: 'Расчёт устарел. Повторите выбор.'};
        } else if (demoState.luckySold?.includes(quote.listing?.id) || !quote.ids.every(id => demoState.inventory.some(gift => gift.id === id && gift.status === 'unlisted'))) {
            ok = false;
            data = {error: 'Подарок недоступен'};
        } else {
            const {ids, target, chance, listing} = quote;
            const model = target.models?.[Math.floor(Math.random() * target.models.length)];
            const success = Math.random() * 100 < chance;
            const gift = success ? listing ? {...listing, source_id:listing.id, source_number:listing.number,
                id:'crafted-' + Date.now(), status:'unlisted', price_unit:'GRAM', crafted:true} : {id: 'crafted-' + Date.now(), collection_id: target.id,
                name: target.name, image: model?.image || target.photo_url, model: model?.name || '',
                price: target.floor_price, number: Math.floor(Math.random() * 999999) + 1,
                status: 'unlisted', price_unit: 'GRAM', crafted: true} : null;
            demoState.inventory = demoState.inventory.filter(item => !ids.includes(item.id));
            if (gift) {
                demoState.inventory.push(gift);
                if (listing) (demoState.luckySold ??= []).push(listing.id);
            }
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
     else if(route==='admin/telegram-bot' && !options.body)data={username:'',greeting:'Добро пожаловать в Crafter!',buttons:[{text:'Открыть Crafter',type:'web_app',url:''}],app_url:'',menu_text:'',token_configured:false,connected:false};
     else if(route.startsWith('admin/telegram-bot')){ok=false;data={error:'Подключение бота доступно на сервере Crafter.'}}
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
