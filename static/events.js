/* Compact event leaderboard: title, countdown, and prize at each rank. */
let crafterEventClockTimer = null;
let crafterCurrentEvent = null;

function crafterEventDate(ts) {
    return new Date(Number(ts)*1000).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
}
function crafterEventDuration(seconds) {
    const t=Math.max(0,Math.floor(seconds));
    const pad=n=>String(n).padStart(2,'0');
    const days=Math.floor(t/86400);
    const hours=pad(Math.floor(t/3600)%24);
    const minutes=pad(Math.floor(t/60)%60);
    const secondsPart=pad(t%60);
    return (days?days+'д ':'')+hours+':'+minutes+':'+secondsPart;
}
function crafterEventUpdateClock() {
    const clocks=document.querySelectorAll('.crafter-event-countdown');
    if(!clocks.length||!crafterCurrentEvent)return;
    const now=Date.now()/1000,ev=crafterCurrentEvent;
    let label,target;
    if(now<ev.start_at){label='До начала';target=ev.start_at;}
    else if(now<ev.end_at){label='До конца';target=ev.end_at;}
    else{label='Завершён';target=now;}
    for(const clock of clocks){
        const labelNode=clock.querySelector('small'),timeNode=clock.querySelector('b');
        if(labelNode&&!clock.closest('.crafter-event-layout-timer'))labelNode.textContent=label;
        if(timeNode)timeNode.textContent=crafterEventDuration(target-now);
    }
}
function crafterEventStartClock(event) {
    clearInterval(crafterEventClockTimer);
    crafterCurrentEvent=event;
    crafterEventUpdateClock();
    crafterEventClockTimer=setInterval(()=>{
        if(state.page==='events'&&!document.hidden&&document.querySelector('.crafter-event-countdown'))
            crafterEventUpdateClock();
        else if(state.page!=='events'){
            clearInterval(crafterEventClockTimer);
            crafterEventClockTimer=null;
        }
    },1000);
}
function crafterEventPrizeVisual(prize) {
    if(!prize || prize.type==='none')return '';
    let image='';
    if(prize.type==='gram'){
        image='<img src="/static/assets/gram.svg" alt="GRAM" loading="lazy">';
    }else if(prize.type==='telegram'&&/^[A-Za-z][A-Za-z0-9]{1,70}-[0-9]{1,10}$/.test(prize.telegram_slug||'')){
        const slug=prize.telegram_slug.toLowerCase();
        image='<span class="crafter-event-nft-animation" data-event-nft="'+esc(slug)+'">'+
            '<img loading="lazy" src="https://nft.fragment.com/gift/'+esc(slug)+
            '.webp" alt="Telegram NFT" onerror="if(!this.dataset.fallback){this.dataset.fallback=1;this.src=this.src.replace(/\.webp$/,\'.medium.jpg\');}else{this.src=\'/static/assets/gifts-empty-market.webp\';this.onerror=null;}"></span>';
    }else if(prize.type==='collection'&&prize.collection){
        const collection=String(prize.collection).replace(/[^a-z0-9]/gi,'').toLowerCase();
        image='<img src="/media/collection/'+encodeURIComponent(collection)+
            '" loading="lazy" alt="Обычный PNG коллекции" onerror="this.src=\'/static/assets/gifts-empty-market.webp\';this.onerror=null;">';
    }else if(prize.type==='model'&&prize.collection&&prize.model){
        image='<img src="https://api.changes.tg/model/'+encodeURIComponent(prize.collection)+
            '/'+encodeURIComponent(prize.model)+'.png?size=128" loading="lazy" alt="Модель подарка" '+
            'onerror="this.src=\'/static/assets/gifts-empty-market.webp\';this.onerror=null;">';
    }else if(prize.image_url && /^\/media\/event\/[a-f0-9]{32}\/prize\//.test(prize.image_url)){
        image='<img loading="lazy" src="'+esc(prize.image_url)+'" alt="Награда">';
    }
    if(!image&&!prize.label)return '';
    const content='<span class="crafter-rank-prize-label">'+esc(prize.label||'Награда')+'</span>'+
        '<span class="crafter-rank-prize-art">'+image+'</span>';
    if(prize.type==='telegram' && /^https:\/\/t\.me\/nft\/[A-Za-z0-9-]+$/.test(prize.telegram_url||'')){
        return '<a class="crafter-rank-prize" href="'+esc(prize.telegram_url)+
            '" target="_blank" rel="noopener noreferrer" title="Информация о Telegram NFT">'+content+'</a>';
    }
    return '<span class="crafter-rank-prize" title="'+esc(prize.label||'Награда')+'">'+content+'</span>';
}
function crafterEventLeader(player,rank,prize) {
    const name=player?.name||'Место свободно';
    const photo=player?.photo_url?imageURL(player.photo_url):'';
    const avatar=photo?'<img src="'+esc(photo)+'" loading="lazy" alt="">':
        esc(Array.from(name)[0]||'?');
    const score=player?esc(player.score)+' <small>'+esc(crafterCurrentEvent.score_unit)+'</small>':'—';
    return '<article class="crafter-event-leader'+(rank<=3?' crafter-event-podium':'')+'">'+
        '<span class="crafter-event-rank">'+rank+'</span>'+
        '<span class="crafter-event-avatar">'+avatar+'</span>'+
        '<div class="crafter-event-leader-info"><strong>'+esc(name)+'</strong>'+
        '<span class="crafter-event-score">'+score+'</span></div>'+
        (prize?crafterEventPrizeVisual(prize):'')+'</article>';
}
async function renderEventsPage() {
    const main=document.querySelector('#main');
    if(!main||state.page!=='events')return;
    clearInterval(crafterEventClockTimer);
    main.innerHTML='<section class="crafter-events-page"><p class="sub">Загружаем события…</p></section>';
    try{
        const data=await api('events');
        if(state.page!=='events')return;
        const events=data.events||[];
        main.innerHTML='<section class="crafter-events-page crafter-events-list">'+
            (events.map(e=>'<button type="button" class="crafter-event-list-row" onclick="openCrafterEvent('+arg(e.id)+')">'+
                '<strong>'+esc(e.title)+'</strong><span>'+esc(e.metric_label)+
                '</span><small>'+crafterEventDate(e.end_at)+'</small></button>').join('')||
                '<p class="crafter-events-empty">Нет опубликованных событий.</p>')+'</section>';
    }catch(error){
        if(state.page==='events')main.innerHTML='<section class="crafter-events-page"><p>'+esc(error.message)+'</p></section>';
    }
}
async function openCrafterEvent(eventId,focusLeaderboard=false) {
    const main=document.querySelector('#main');
    if(!main||state.page!=='events')return;
    main.innerHTML='<section class="crafter-events-page"><p class="sub">Загружаем рейтинг…</p></section>';
    try{
        const [result,layout]=await Promise.all([
            api('events/'+encodeURIComponent(eventId)),
            api('events/'+encodeURIComponent(eventId)+'/page').catch(()=>({page:null}))
        ]);
        if(state.page!=='events')return;
        const event=result.event,leaders=result.leaders||[];
        crafterCurrentEvent=event;
        if(layout.page&&typeof crafterEventPageView==='function'){
            crafterEventPageView(main,event,leaders,layout.page);
            return;
        }
        const maxRank=Math.min(100,Math.max(leaders.length,(event.prizes||[]).length,3));
        const byRank=new Map(leaders.map(player=>[player.rank,player]));
        const prizes=new Map((event.prizes||[]).map(p=>[p.place,p]));
        main.innerHTML='<section class="crafter-events-page crafter-event-detail" style="--event-accent:'+esc(event.accent)+'">'+
            '<header class="crafter-event-header"><div class="crafter-event-name">'+
            '<h1>'+esc(event.title)+'</h1>'+
            (event.description?'<p>'+esc(event.description)+'</p>':'')+
            '</div><div class="crafter-event-countdown" id="crafter-event-clock" aria-live="off">'+
            '<small>До конца</small><b>00:00:00</b></div></header>'+
            '<div class="crafter-event-rank-list" id="crafter-event-ranking">'+
            (event.show_leaderboard?Array.from({length:maxRank},(_,i)=>crafterEventLeader(byRank.get(i+1),i+1,prizes.get(i+1))).join(''):
                '<p class="crafter-events-empty">Рейтинг временно скрыт.</p>')+'</div>'+
            '</section>';
        crafterEventStartClock(event);
        if(typeof crafterLoadEventNFTAnimations==='function')crafterLoadEventNFTAnimations(main);
        // Direct links from banners show the top immediately, no hero or jump animation.
    }catch(error){
        if(state.page==='events')main.innerHTML='<section class="crafter-events-page"><p>'+esc(error.message)+'</p></section>';
    }
}
