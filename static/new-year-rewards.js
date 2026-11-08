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
    const verb=kind==='sale'?'Награда за продажу':'Награда за покупку';
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
})();
