/* Administrators: custody queue for NFT gifts and TON Connect payouts. */
let withdrawalAdminTab='pending';
const withdrawalStatusLabel={queued:'В очереди',processing:'В обработке',confirmed:'Подтверждено',failed:'Не выполнено',cancelled:'Отменено'};
function withdrawalOwner(w){
    return w.username?'@'+w.username:(w.name?w.name+' · '+w.user_id:'ID '+w.user_id);
}
function withdrawalWhen(ts){
    return new Date(Number(ts)*1000).toLocaleString('ru-RU',{
        day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function drawTONWithdrawal(w){
    const el=document.createElement('article');el.className='withdrawals-entry';
    const title=document.createElement('strong');title.textContent=withdrawalOwner(w);
    const heading=document.createElement('div');heading.className='withdrawals-entry-top';heading.append(title);
    const badge=document.createElement('span');badge.className='withdrawals-pill';
    badge.textContent=withdrawalStatusLabel[w.status]||w.status;badge.dataset.status=w.status;
    heading.append(badge);el.append(heading);
    const amount=document.createElement('h4');amount.textContent=money(w.gram)+' GRAM / '+w.ton+' TON';el.append(amount);
    const info=document.createElement('p');info.className='withdrawals-meta';
    info.textContent=withdrawalWhen(w.created)+' · '+w.network;el.append(info);
    const address=document.createElement('p');address.className='withdrawals-address';
    address.textContent=w.receiver||'';el.append(address);
    if(w.status==='queued'||w.status==='processing'){
        const button=document.createElement('button');button.type='button';
        button.className=w.status==='queued'?'primary':'secondary';
        button.textContent=w.status==='queued'?'Отправить через TON Connect':'Проверить TON-перевод';
        button.onclick=()=>w.status==='queued'?sendAdminTonWithdrawal(w.id):checkAdminTonWithdrawal(w.id);
        el.append(button);
    }
    return el;
}
function drawGiftWithdrawal(w){
    const el=document.createElement('article');el.className='withdrawals-entry';
    const heading=document.createElement('div');heading.className='withdrawals-entry-top';
    const name=document.createElement('strong');name.textContent=withdrawalOwner(w);
    const badge=document.createElement('span');badge.className='withdrawals-pill';
    badge.dataset.status=w.status;badge.textContent=withdrawalStatusLabel[w.status]||w.status;
    heading.append(name,badge);el.append(heading);
    const gift=w.gift||{};
    const detail=document.createElement('div');detail.className='withdrawals-gift';
    const imgUrl=imageURL(gift.image);
    if(imgUrl){const img=document.createElement('img');img.src=imgUrl;img.alt='';detail.append(img);}
    const content=document.createElement('span');
    const giftName=document.createElement('b');giftName.textContent=(gift.name||'NFT')+(gift.number?' #'+gift.number:'');
    const to=document.createElement('small');
    to.textContent='Получатель: '+(w.receiver_username?'@'+w.receiver_username:'ID '+w.receiver_user_id);
    content.append(giftName,to);detail.append(content);el.append(detail);
    const info=document.createElement('p');info.className='withdrawals-meta';
    info.textContent=withdrawalWhen(w.created);el.append(info);
    const link=String(gift.telegram_url||'');
    if(/^https:\/\/(?:t\.me|telegram\.me)\/nft\/[a-z0-9]+-[1-9]\d*$/i.test(link)){
        const a=document.createElement('a');a.href=link;a.target='_blank';a.rel='noopener noreferrer';
        a.textContent='Посмотреть именно этот NFT в Telegram';el.append(a);
    }
    if(w.note){const p=document.createElement('p');p.className='withdrawals-meta';p.textContent=w.note;el.append(p);}
    if(w.status==='queued'){
        const buttons=document.createElement('div');buttons.className='withdrawals-actions';
        for(const [decision,label] of [['confirmed','Передан вручную'],['failed','Ошибка · вернуть']]){
            const button=document.createElement('button');button.type='button';
            button.className=decision==='confirmed'?'primary':'secondary';button.textContent=label;
            button.onclick=()=>resolveAdminGiftWithdrawal(w.id,decision);
            buttons.append(button);
        }
        el.append(buttons);
    }
    return el;
}
async function renderAdminWithdrawals(content=document.querySelector('#admin-content')){
    if(!content?.isConnected)return;
    const [items,ton]=await Promise.all([api('admin/withdrawals'),api('admin/tonconnect')]);
    if(!content.isConnected||state.adminSection!=='withdrawals')return;
    state.tonAdmin=ton;
    const pending=row=>['queued','processing'].includes(row.status);
    const giftPending=items.gifts.filter(pending),tonPending=items.ton.filter(pending);
    content.innerHTML='';
    const root=document.createElement('div');root.className='admin-withdrawals';
    const hero=document.createElement('section');hero.className='panel withdrawals-hero';
    const h=document.createElement('h3');h.textContent='Выводы TON / NFT';
    const sub=document.createElement('p');sub.className='sub';
    sub.textContent='Заявок в обработке: '+(giftPending.length+tonPending.length)+
        '. TON переводится через подтверждение кошелька; NFT нужно передать вручную до подтверждения заявки.';
    const bal=document.createElement('button');bal.type='button';bal.className='secondary';
    bal.textContent='Проверить баланс TON-кошелька сервиса';bal.onclick=loadAdminTONReceiverBalance;
    const balInfo=document.createElement('p');balInfo.id='admin-ton-receiver';
    balInfo.className='withdrawals-address';balInfo.textContent=ton.config.receiver||'Кошелёк не настроен';
    hero.append(h,sub,bal,balInfo);root.append(hero);
    const tabs=document.createElement('div');tabs.className='withdrawals-tabs';
    for(const [value,label] of [['pending','Активные'],['all','Все заявки']]){
        const tab=document.createElement('button');tab.type='button';tab.textContent=label;
        tab.className=withdrawalAdminTab===value?'active':'';
        tab.onclick=()=>{withdrawalAdminTab=value;renderAdminWithdrawals()};
        tabs.append(tab);
    }
    root.append(tabs);
    for(const [title,list,drawer] of [
        ['Выводы GRAM / TON',items.ton,drawTONWithdrawal],
        ['Выводы NFT-подарков',items.gifts,drawGiftWithdrawal]
    ]){
        const section=document.createElement('section');section.className='panel';
        const header=document.createElement('h3');header.textContent=title;section.append(header);
        const selected=list.filter(row=>withdrawalAdminTab==='all'||pending(row));
        if(!selected.length){const msg=document.createElement('p');msg.className='sub';
            msg.textContent='Заявок нет';section.append(msg);}
        else selected.forEach(item=>section.append(drawer(item)));
        root.append(section);
    }
    content.append(root);
}
async function loadAdminTONReceiverBalance(){
    const el=document.querySelector('#admin-ton-receiver');if(!el)return;
    el.textContent='Запрос к TON…';
    try{const r=await api('admin/tonconnect/receiver/balance');
        if(el.isConnected)el.textContent=money(r.balance_ton)+' TON · '+r.network+' · '+r.receiver;
    }catch(e){if(el.isConnected)el.textContent=e.message;}
}
async function sendAdminTonWithdrawal(id){
    if(!confirm('Подготовить перевод TON? Подписание потребуется в TON Connect.'))return;
    await processWithdrawal(id);
    if(state.adminSection==='withdrawals')await renderAdminWithdrawals();
}
async function checkAdminTonWithdrawal(id){
    await verifyWithdrawal(id);
    if(state.adminSection==='withdrawals')await renderAdminWithdrawals();
}
async function resolveAdminGiftWithdrawal(id,decision){
    const confirmed=decision==='confirmed';
    const note=prompt(confirmed?
        'Укажите ссылку/номер реального перевода NFT в Telegram. Он должен быть уже отправлен.':
        'Почему NFT возвращается в инвентарь?');
    if(note===null)return;
    if(confirmed&&note.trim().length<8)return toast('Введите подтверждение перевода NFT (8 символов)');
    if(!confirm(confirmed?'Этот конкретный NFT уже передан получателю?':'Вернуть NFT в инвентарь?'))return;
    try{await api('admin/withdrawals/gift/'+encodeURIComponent(id)+'/resolve',{decision,note:note.trim()});
        toast(confirmed?'Вывод NFT подтверждён':'Подарок возвращён');
        await renderAdminWithdrawals();
    }catch(e){toast(e.message);}
}
