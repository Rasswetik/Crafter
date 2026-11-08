/* Admin-only user inspection. None of these actions transfer Telegram NFTs. */
function adminStamp(unix) {
  return new Date(Number(unix)*1000).toLocaleString('ru-RU');
}
function adminGiftLine(gift,uid) {
  const image=imageURL(gift.image)||'/static/assets/anvil-mark.webp';
  const label=(gift.name||'Gift')+(gift.number?' #'+gift.number:'');
  const eligible=gift.status==='unlisted'&&!gift.catalog_only;
  return '<div class="admin-gift-row"><img src="'+esc(image)+'" alt="" loading="lazy">'+
    '<div class="admin-gift-meta"><b>'+esc(label)+'</b><small>'+esc(gift.model||'')+' · '+esc(gift.status||'')+'</small></div>'+
    '<button type="button" class="admin-remove-gift" '+(eligible?'':'disabled title="Сначала снимите с продажи или стейкинга"')+
    ' onclick="adminRemoveGift('+uid+','+arg(gift.id)+')">Удалить</button></div>';
}
async function adminInspectGifts(uid,offset=0) {
  sheet('Инвентарь пользователя','<p class="sub">Загрузка подарков…</p>');
  const target=document.querySelector('#sheet-body');
  try {
    const data=await api('admin/users/'+uid+'/inventory?offset='+offset);
    if(!target.isConnected)return;
    target.innerHTML='<div class="admin-gift-list">'+
      (data.gifts.length?data.gifts.map(g=>adminGiftLine(g,uid)).join(''):'<p class="sub">Подарков нет</p>')+
      (offset>0?'<button class="secondary" onclick="adminInspectGifts('+uid+','+Math.max(0,offset-100)+')">Назад</button>':'')+
      (data.has_more?'<button class="secondary" onclick="adminInspectGifts('+uid+','+data.next_offset+')">Дальше</button>':'')+
      '</div><p class="sub">Удаление меняет только учёт Crafter, не Telegram NFT.</p>';
  }catch(e){if(target.isConnected)target.textContent=e.message;}
}
async function adminRemoveGift(uid,id) {
  if(!confirm('Удалить подарок из учёта Crafter? Это не переводит NFT из Relayer и может потребовать ручной сверки.'))return;
  try {
    await api('admin/users/'+uid+'/gifts/remove',{gift_id:id,confirm:'REMOVE_GIFT'});
    toast('Подарок удалён из учёта Crafter');
    await adminInspectGifts(uid);
  }catch(e){toast(e.message);}
}
async function adminInspectOffers(uid) {
  sheet('Офферы пользователя','<p class="sub">Загрузка офферов…</p>');
  const target=document.querySelector('#sheet-body');
  try{
    const data=await api('admin/users/'+uid+'/offers');
    if(!target.isConnected)return;
    target.innerHTML='<div class="admin-activity-list">'+
      (data.offers.length?data.offers.map(x=>
       '<div class="admin-activity-row"><b>'+esc(x.gift.name||'Gift')+(x.gift.number?' #'+esc(x.gift.number):'')+'</b>'+
       '<small>'+(x.type==='placed'?'Размещён':'Получен')+' · '+esc(x.status)+' · '+money(x.price)+' GRAM</small>'+
       '<small>'+adminStamp(x.created)+' · '+esc(x.remaining)+' / '+esc(x.quantity)+'</small></div>'
      ).join(''):'<p class="sub">Офферов нет</p>')+'</div>';
  }catch(e){if(target.isConnected)target.textContent=e.message;}
}
async function adminInspectLogs(uid) {
  sheet('История пользователя','<p class="sub">Загрузка журнала…</p>');
  const target=document.querySelector('#sheet-body');
  try{
    const data=await api('admin/logs?user_id='+uid+'&limit=100');
    if(!target.isConnected)return;
    target.innerHTML='<div class="admin-activity-list">'+
      (data.items.length?data.items.map(x=>'<div class="admin-activity-row"><b>'+
         esc(x.action||x.kind||x.type)+'</b><small>'+esc(x.gift?.name||'')+
         (x.gift?.number?' #'+esc(x.gift.number):'')+
         (x.amount?' · '+esc(x.amount)+' GRAM':'')+'</small><small>'+
         adminStamp(x.created)+'</small></div>').join(''):'<p class="sub">Записей нет</p>')+
      '</div>';
  }catch(e){if(target.isConnected)target.textContent=e.message;}
}
async function adminToggleBan(uid,banned) {
  if(!confirm(banned?'Заблокировать пользователя?':'Разблокировать пользователя?'))return;
  try{
    await api('admin/users/'+uid+'/ban',{banned,reason:banned?'Заблокирован администратором':''});
    closeSheet();await loadUsers('');
    toast(banned?'Пользователь заблокирован':'Пользователь разблокирован');
  }catch(e){toast(e.message);}
}

/* User settings: seasonal balls are a distinct admin-controlled balance. */
async function adminLoadUserNewYearBalls(uid){
    const target=document.querySelector('#admin-user-ny-balance');
    if(!target)return;
    try{
        const info=await api('admin/new-year/users/'+uid+'/wallet');
        if(target.isConnected)target.textContent=Number(info.balance.balls).toLocaleString('ru-RU')+' шаров';
    }catch(error){
        if(target.isConnected)target.textContent=error.message;
    }
}
async function adminAdjustUserNewYearBalls(uid){
    const input=document.querySelector('#admin-user-ny-delta');
    const button=document.querySelector('#admin-user-ny-save');
    const amount=Number(input?.value);
    if(!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>1000000000){
        toast('Укажите целое количество шаров (не 0)');
        return;
    }
    if(button)button.disabled=true;
    try{
        const result=await api('admin/new-year/wallet',{user_id:uid,balls:String(amount),donate:'0',tinsel:'0'});
        const target=document.querySelector('#admin-user-ny-balance');
        if(target)target.textContent=Number(result.balance.balls).toLocaleString('ru-RU')+' шаров';
        if(input)input.value='0';
        toast(amount>0?'Шары выданы пользователю':'Шары списаны');
    }catch(error){toast(error.message);}
    finally{if(button?.isConnected)button.disabled=false;}
}
