/* Seasonal and GRAM/TON promo code management. */
async function renderAdminPromocodes(content=document.querySelector('#admin-content')){
    const data=await api('admin/promocodes');
    if(!content?.isConnected)return;
    const unit=currency=>currency==='BALL'?'шаров':currency==='PACK'?'(пак)':'GRAM';
    let packs=[];try{packs=(await api('admin/new-year/packs')).packs||[];}catch(_){}
    const list=data.codes.length?data.codes.map(row=>
        '<div class="ny-admin-row"><div><b>'+esc(row.code)+'</b><small>'+
        esc(String(row.reward))+' '+unit(row.currency)+' · '+row.used+' / '+row.uses_limit+
        ' активаций</small></div><button type="button" data-promo-code="'+esc(row.code)+
        '" data-next="'+(row.active?'0':'1')+'">'+(row.active?'Выключить':'Включить')+
        '</button></div>').join(''):'<p class="sub">Промокодов пока нет.</p>';
    content.innerHTML=
      '<section class="ny-admin-section"><h3>Создать промокод</h3>'+
      '<p class="sub">Выберите награду — внутренний TON/GRAM-баланс Crafter или новогодние шары. Один игрок может использовать один и тот же код только раз.</p>'+
      '<form id="crafter-promo-admin-form" class="ny-admin-fields">'+
      '<label class="full">Название (необязательно)<input name="code" maxlength="32" autocomplete="off" placeholder="Случайный 8-значный код"></label>'+
      '<label class="full">Тип награды<select name="currency" id="crafter-promo-currency" class="field">'+
      '<option value="GRAM">TON / GRAM — основной баланс</option>'+
      '<option value="BALL">Новогодние шары</option>'+(packs.length?'<option value="PACK">Карточный пак</option>':'')+'</select></label>'+
      '<label id="crafter-promo-pack-label" hidden>Пак<select name="reward_pack" class="field">'+packs.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.title)+'</option>').join('')+'</select></label>'+
      '<label id="crafter-promo-amount-label">Сумма награды<input name="reward" id="crafter-promo-amount" type="number" min="0.000001" max="100000" step="0.000001" required placeholder="0.1"></label>'+
      '<label>Число активаций<input name="limit" type="number" min="1" max="1000000" step="1" required placeholder="100"></label>'+
      '<button type="submit" class="primary full">Создать промокод</button></form>'+
      '<div id="crafter-promo-created" class="promo-result" role="status" hidden></div></section>'+
      '<section class="ny-admin-section"><h3>Промокоды</h3><div class="ny-admin-list">'+list+'</div></section>';
    const form=content.querySelector('#crafter-promo-admin-form');
    const type=form.elements.currency,amount=form.elements.reward;
    type.addEventListener('change',()=>{
        const isPack=type.value==='PACK';
        form.querySelector('#crafter-promo-pack-label').hidden=!isPack;
        form.querySelector('#crafter-promo-amount-label').hidden=isPack;
        amount.required=!isPack;
        const ball=type.value==='BALL';
        amount.min=ball?'1':'0.000001';
        amount.max=ball?'1000000000':'100000';
        amount.step=ball?'1':'0.000001';
        amount.placeholder=ball?'100':'0.1';
        amount.value='';
        amount.setCustomValidity('');
    });
    form.addEventListener('submit',async event=>{
        event.preventDefault();
        const button=form.querySelector('button[type=submit]');
        button.disabled=true;
        try{
            const payload=Object.fromEntries(new FormData(form));
            if(payload.currency==='PACK')payload.reward=payload.reward_pack;
            const result=await api('admin/promocodes',payload);
            await renderAdminPromocodes(content);
            const status=content.querySelector('#crafter-promo-created');
            if(status){
                status.hidden=false;
                status.innerHTML='<strong>Создан код '+esc(result.code)+'</strong> · '+
                    esc(String(result.reward))+' '+unit(result.currency)+' · '+
                    result.limit+' активаций <button class="secondary" type="button">Скопировать</button>';
                status.querySelector('button')?.addEventListener('click',()=>
                    navigator.clipboard.writeText(result.code).then(()=>toast('Код скопирован')).catch(()=>toast(result.code)));
            }
            toast('Промокод создан');
        }catch(error){toast(error.message);}
        finally{if(button.isConnected)button.disabled=false;}
    });
    content.querySelectorAll('[data-promo-code]').forEach(button=>button.addEventListener('click',async()=>{
        button.disabled=true;
        try{
            await api('admin/promocodes/'+encodeURIComponent(button.dataset.promoCode)+'/status',
                      {active:button.dataset.next==='1'});
            await renderAdminPromocodes(content);
            toast('Статус промокода изменён');
        }catch(error){toast(error.message);button.disabled=false;}
    }));
}
