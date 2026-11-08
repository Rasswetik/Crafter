/* New Year rewards: an estimate only; actual balls are credited by the server
   on verified settled trades (not from clicking, listing or preview purchases). */
(function(){
'use strict';
const ICON='<img src="/static/assets/new-year-ornament.svg" alt="" aria-hidden="true">';
function user(){return typeof state!=='undefined'?state.me:null;}
function enabled(){return Boolean(user()?.new_year_enabled);}
function value(amount,unit='GRAM'){
    const amountNumber=Number(amount),ratio=Number(user()?.new_year_gram_per_ton||0);
    if(!enabled()||!Number.isFinite(amountNumber)||amountNumber<=0)return null;
    if(unit!=='TON'&&(!Number.isFinite(ratio)||ratio<=0))return null;
    const ton=unit==='TON'?amountNumber:amountNumber/ratio;
    if(!Number.isFinite(ton)||ton<=0)return null;
    return Math.floor(ton*10+1e-8);
}
function fromFloor(gift){
    const str=typeof window.productFloor==='function'?window.productFloor(gift):'';
    const num=Number(String(str).replace(/\s/g,'').match(/^\d+(?:[.,]\d+)?/)?.[0].replace(',','.'));
    const unit=/\bTON\b/i.test(str)?'TON':/\bGRAM\b/i.test(str)?'GRAM':null;
    if(!unit||!Number.isFinite(num)||num<=0)return null;
    return {amount:num,unit};
}
function row(kind,amount,unit='GRAM',note=''){
    if(!enabled())return '';
    const count=value(amount,unit);
    if(count===null)return '';
    const verb=kind==='craft'?'Награда за крафт':kind==='sale'?'Награда за продажу':'Награда за покупку';
    const explanation=note||'После завершённой сделки · 1 TON = 10 шаров';
    return '<div class="crafter-season-reward" data-season-kind="'+kind+'">'+
        '<div><span>'+verb+'</span><small>'+explanation+'</small></div>'+
        '<strong><span data-season-amount>'+count.toLocaleString('ru-RU')+'</span> '+ICON+'</strong></div>';
}
window.crafterSeasonRewardFor=value;
window.crafterSeasonRewardHTML=row;
window.crafterSeasonRewardForFloor=function(gift){
    const floor=fromFloor(gift);
    return floor?row('sale',floor.amount,floor.unit,'Предварительно по флору · начисляется после продажи'):'';
};
window.crafterSeasonRewardUpdate=function(container,amount,unit='GRAM'){
    const label=container?.querySelector('[data-season-amount]');
    if(!label)return;
    const number=value(amount,unit);
    label.textContent=number===null?'—':number.toLocaleString('ru-RU');
};
window.crafterSeasonRewardIcon=()=>ICON;
window.crafterSeasonBalanceRefresh=async function(){
    try{
        const info=await api('balance');
        if(info?.new_year && typeof window.crafterNewYearUpdateBalance==='function')
            window.crafterNewYearUpdateBalance(info.new_year);
        return info?.new_year;
    }catch(_){return null;}
};
window.openPreviewGiftSale=function(giftId){
    const item=state?.inventory?.find(g=>g.id===giftId&&g.test_only&&
        ['market-test','demo-craft'].includes(g.origin)&&g.status==='unlisted');
    if(!item||!state.me?.market_test_purchases){
        toast('Тестовый подарок недоступен для демо-продажи');return;
    }
    const price=Number(item.source_price||0);
    const unit=item.source_price_unit==='TON'?'TON':'GRAM';
    const shown=Number.isFinite(price)&&price>0?Math.min(price,1000000):1;
    sheet('Демо-продажа','<div class="crafter-preview-sale">'+
        '<p><strong>'+esc(item.name)+'</strong> #'+esc(item.number||'—')+'</p>'+
        '<p class="sub">Только тестовая продажа. GRAM не начисляются, реальные NFT не передаются.</p>'+
        '<label>Цена, '+unit+'<input id="preview-sale-price" type="number" min="0.01" max="1000000" step="0.01"'+
        ' inputmode="decimal" value="'+String(shown)+'" required></label>'+
        row('sale',shown,unit,'Начисляется после подтверждения демо-продажи')+
        '<button id="preview-sale-confirm" type="button" class="primary">Завершить демо-продажу</button>'+
        '<p id="preview-sale-error" role="alert" class="purchase-error"></p></div>');
    const form=document.querySelector('#sheet-body .crafter-preview-sale');
    const input=form?.querySelector('#preview-sale-price');
    const btn=form?.querySelector('#preview-sale-confirm');
    input?.addEventListener('input',()=>window.crafterSeasonRewardUpdate(form,Number(input.value),unit));
    btn?.addEventListener('click',async()=>{
        if(btn.disabled)return;
        const priceText=input.value.trim(),numeric=Number(priceText);
        if(!/^\d+(?:\.\d{1,2})?$/.test(priceText)||numeric<0.01||numeric>1e6){
            form.querySelector('#preview-sale-error').textContent='Укажите корректную демо-цену';
            return;
        }
        btn.disabled=true;
        try{
            const request_id=paymentRequestId('demo-sale:'+state.me.user.id+':'+giftId);
            await api('market/test/sell',{gift_id:giftId,price:priceText,request_id});
            state.inventory=state.inventory.filter(g=>g.id!==giftId);
            state.me.inventory_count=Math.max(0,Number(state.me.inventory_count||1)-1);
            await window.crafterSeasonBalanceRefresh();
            closeSheet();
            await go('gifts');
            toast('Демо-продажа завершена · шары начислены');
        }catch(error){
            const label=form.querySelector('#preview-sale-error');
            if(label)label.textContent=error.message;
            if(btn.isConnected)btn.disabled=false;
        }
    });
};
})();
