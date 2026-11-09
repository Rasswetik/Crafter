/* Crafter promo redemption, five-tier referrals and live balances. */
(function(){
'use strict';
const TICKET='<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4V5Z"/><path d="M12 5v2m0 3v2m0 3v2m0 2v-1"/></svg>';
const CHECK='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"/></svg>';
let redeeming=false;
let balanceInFlight=false;
let lastReferralWithdrawal=null;
function liveAmount(number){const n=Number(number);return Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:6}):'0';}
function promoForm(id){
    return '<form id="'+id+'" class="crafter-promo-form" autocomplete="off">'+
           '<input type="text" name="code" maxlength="32" required placeholder="Введите промокод" aria-label="Введите промокод">'+
           '<button type="submit" aria-label="Применить промокод">'+CHECK+'</button>'+
           '</form><div class="crafter-promo-feedback" role="status" aria-live="polite"></div>';
}
function feedback(form,success,message){
    const area=form.nextElementSibling;
    form.classList.toggle('is-success',success);
    form.classList.toggle('is-error',!success);
    if(area)area.textContent=message;
}
async function submitPromo(form){
    if(redeeming)return;
    const code=form.elements.code.value.trim();
    if(!code)return feedback(form,false,'Введите промокод');
    const button=form.querySelector('button');
    redeeming=true;
    button.disabled=true;
    try{
        const result=await api('promocodes/redeem',{code});
        const balls=result.currency==='BALL';
        feedback(form,true,'Получено: '+liveAmount(result.reward)+(balls?' шаров':' GRAM'));
        if(state.me){state.me.balance=result.balance;updateBalance();}
        if(balls&&typeof window.crafterNewYearUpdateBalance==='function')
            window.crafterNewYearUpdateBalance(result.new_year_balance);
        refreshLiveBalance();
    }catch(error){feedback(form,false,error.message||'Промокод неверный');}
    finally{redeeming=false;if(button.isConnected)button.disabled=false;}
}
function bindPromo(container){
    container.querySelectorAll('.crafter-promo-form').forEach(form=>{
        form.addEventListener('submit',event=>{event.preventDefault();submitPromo(form);});
    });
}
function promoSheet(){
    sheet('Промокод','<div class="crafter-promo-modal">'+promoForm('crafter-promo-sheet-form')+'</div>');
    bindPromo(document.querySelector('#sheet-body'));
}
window.crafterOpenPromo=promoSheet;
function shareReferral(){
    const link=state.me?.invite_link;
    if(!link)return toast('Реферальная ссылка недоступна: настройте BOT_USERNAME');
    const message='🎁 Crafter — выигрывай NFT-подарки каждый день! Делай крафты, получай бесплатные промокоды и участвуй в событиях. Присоединяйся!';
    const target='https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent(message);
    if(tg?.openTelegramLink)tg.openTelegramLink(target);
    else window.open(target,'_blank','noopener');
}
async function copyReferral(){
    const link=state.me?.invite_link;
    if(!link)return toast('Реферальная ссылка пока недоступна');
    try{await navigator.clipboard.writeText(link);toast('Реферальная ссылка скопирована');}
    catch(_){toast(link);}
}
window.crafterShareReferral=shareReferral;
window.crafterCopyReferral=copyReferral;
async function withdrawReferral(){
    if(lastReferralWithdrawal)return toast('Дождитесь проверки предыдущего вывода');
    if(!confirm('Перевести реферальный баланс на основной GRAM-баланс? Минимум 1 GRAM.'))return;
    const key='crafter-referral-withdraw:'+state.me.user.id;
    let rid;
    try{rid=sessionStorage.getItem(key);}
    catch(_){}
    if(!rid){rid=crypto.randomUUID();try{sessionStorage.setItem(key,rid);}catch(_){}}
    lastReferralWithdrawal=rid;
    const button=document.querySelector('#crafter-referral-withdraw');
    if(button)button.disabled=true;
    try{
        const result=await api('referrals/withdraw',{request_id:rid});
        try{sessionStorage.removeItem(key);}catch(_){}
        state.me.referral_balance=result.referral_balance;
        state.me.balance=result.balance;
        updateBalance();
        const value=document.querySelector('#crafter-referral-balance');
        if(value)value.textContent='0 GRAM';
        toast('Переведено '+liveAmount(result.amount)+' GRAM');
    }catch(error){toast(error.message);}
    finally{lastReferralWithdrawal=null;if(button?.isConnected)button.disabled=false;}
}
window.crafterWithdrawReferral=withdrawReferral;
function referralButtonMarkup(){
    const me=state.me||{};
    const rates=[5,6,7,8,10];
    const level=Math.max(1,Math.min(5,Number(me.referral_level)||1));
    return '<button type="button" class="rf-open" id="crafter-referral-open" aria-label="Реферальная система">'+
        '<span class="rf-open-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 5.5a3 3 0 0 1 0 5.8M18.5 14.4c1.6.7 2.8 2.3 2.8 4.1"/></svg></span>'+
        '<span class="rf-open-text"><b>Реферальная система</b><small>'+level+' ур. · '+rates[level-1]+'% · '+liveAmount(me.referral_balance)+' GRAM</small></span>'+
        '<span class="rf-open-chevron" aria-hidden="true">›</span></button>';
}
function openReferralSheet(){
    sheet('Реферальная система',referralMarkup());
    const box=document.querySelector('#sheet');
    box?.querySelector('#crafter-referral-copy')?.addEventListener('click',copyReferral);
    box?.querySelector('#crafter-referral-share')?.addEventListener('click',shareReferral);
    box?.querySelector('#crafter-referral-withdraw')?.addEventListener('click',withdrawReferral);
}
function referralMarkup(){
    const me=state.me||{};
    const rates=[5,6,7,8,10];
    const level=Math.max(1,Math.min(5,Number(me.referral_level)||1));
    const link=me.invite_link||'Ссылка недоступна';
    const have=Number(me.referrals||0),left=Math.max(0,Number(me.referral_until_next)||0);
    const pct=level>=5?100:Math.round(100*have/Math.max(1,have+left));
    return '<section class="rf-card" id="crafter-referral-panel" aria-label="Реферальная система">'+
        '<div class="rf-top"><div class="rf-title"><small>CRAFTER · РЕФЕРАЛЫ</small>'+
        '<p>До 10% от комиссии Crafter за игры и сделки приглашённых друзей.</p></div>'+
        '<div class="rf-badge" style="--rf-pct:'+pct+'"><span><b>'+level+'</b><small>уровень</small></span></div></div>'+
        '<div class="rf-balance"><div><small>Реферальный баланс</small>'+
        '<strong id="crafter-referral-balance">'+liveAmount(me.referral_balance)+' GRAM</strong></div>'+
        '<button type="button" id="crafter-referral-withdraw">Вывести</button></div>'+
        '<div class="rf-progress"><div class="rf-progress-head"><span>Ваша ставка: <b>'+rates[level-1]+'%</b></span>'+
        '<span>'+(level>=5?'Максимальный уровень':'До '+(level+1)+' ур. · ещё '+left)+'</span></div>'+
        '<div class="rf-bar"><i style="width:'+pct+'%"></i></div></div>'+
        '<div class="rf-steps">'+rates.map((rate,i)=>
            '<div class="rf-step'+(i+1<level?' is-done':'')+(i+1===level?' is-current':'')+'"><b>'+rate+'%</b><small>'+(i+1)+' ур.</small></div>'
        ).join('')+'</div>'+
        '<div class="rf-stats"><div><small>Рефералов</small><strong>'+have+'</strong></div>'+
        '<div><small>Уровень</small><strong>'+level+' / 5</strong></div>'+
        '<div><small>До следующего</small><strong>'+(level>=5?'—':left)+'</strong></div></div>'+
        '<div class="rf-link"><span>'+esc(link)+'</span><button type="button" id="crafter-referral-copy">Копировать</button></div>'+
        '<button type="button" class="rf-invite" id="crafter-referral-share">✈ Пригласить друзей</button>'+
        '<p class="rf-note">Минимум для перевода — 1 GRAM. Начисления поступают с оплаченных комиссий.</p></section>';
}
function enhanceProfile(){
    const root=document.querySelector('#main');
    const identity=root?.querySelector('.profile-identity');
    if(!identity)return;
    root.querySelector('.portal-referrals')?.remove();
    root.querySelector('.profile-invite')?.remove();
    root.querySelector('.crafter-referral-glass')?.remove();root.querySelector('.rf-card')?.remove();
    root.querySelector('.rf-open')?.remove();
    const profile=root.querySelector('.portal-profile');
    profile?.insertAdjacentHTML('afterend',referralButtonMarkup());
    root.querySelector('#crafter-referral-open')?.addEventListener('click',openReferralSheet);
    const gear=identity.querySelector('.crafter-open-settings,.profile-settings-button');
    const promo=document.createElement('button');
    promo.className='crafter-profile-promo';
    promo.type='button';promo.title='Промокоды';promo.setAttribute('aria-label','Ввести промокод');
    promo.innerHTML=TICKET;promo.addEventListener('click',promoSheet);
    if(gear)gear.before(promo);else identity.append(promo);
    const desktop=document.createElement('div');
    desktop.className='crafter-profile-desktop-promo';
    desktop.innerHTML='<span>ПРОМОКОД</span>'+promoForm('crafter-promo-desktop-form');
    if(gear)gear.before(desktop);else identity.append(desktop);
    bindPromo(desktop);
}
const previousProfile=renderProfile;
renderProfile=function(...args){
    const answer=previousProfile.apply(this,args);
    enhanceProfile();
    return answer;
};
async function refreshLiveBalance(){
    if(balanceInFlight||!state?.me||document.visibilityState==='hidden')return;
    balanceInFlight=true;
    try{
        const balance=await api('balance');
        if(!state.me||String(state.me.user.id)!==String(balance.user_id))return;
        if(!state.buying&&!state.cartBuying)state.me.balance=balance.balance;
        state.me.referral_balance=balance.referral_balance;
        updateBalance();
        const ref=document.querySelector('#crafter-referral-balance');
        if(ref)ref.textContent=liveAmount(balance.referral_balance)+' GRAM';
        if(typeof window.crafterNewYearUpdateBalance==='function')
            window.crafterNewYearUpdateBalance(balance.new_year);
        else {
            const ornament=document.querySelector('.winter-currency-balance b');
            if(ornament)ornament.textContent=liveAmount(balance.new_year?.balls||0);
        }
    }catch(_){}
    finally{balanceInFlight=false;}
}
window.crafterRefreshLiveBalance=refreshLiveBalance;
setInterval(refreshLiveBalance,12000);
document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')refreshLiveBalance();
});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(refreshLiveBalance,1700),{once:true});
else setTimeout(refreshLiveBalance,1700);
})();
