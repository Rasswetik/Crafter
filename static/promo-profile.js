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
        feedback(form,true,'Получено: '+liveAmount(result.reward)+' GRAM');
        if(state.me){state.me.balance=result.balance;updateBalance();}
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
function referralMarkup(){
    const me=state.me||{};
    const rates=[5,6,7,8,10];
    const level=Math.max(1,Math.min(5,Number(me.referral_level)||1));
    const link=me.invite_link||'Ссылка недоступна';
    return '<section class="crafter-referral-glass">'+
        '<div class="crafter-referral-heading"><span>CRAFTER · РЕФЕРАЛЫ</span><h2>Приглашай друзей, получай GRAM</h2>'+
        '<p>До 10% от комиссии Crafter за игры и сделки приглашённых друзей.</p></div>'+
        '<div class="crafter-referral-tiers">'+rates.map((rate,i)=>
            '<div class="crafter-referral-tier'+(i+1===level?' is-current':'')+'"><small>'+String(i+1)+' ур.</small><strong>'+rate+'%</strong></div>'
        ).join('')+'</div>'+
        '<div class="crafter-referral-stats"><div><small>Рефералов</small><strong>'+Number(me.referrals||0)+'</strong></div>'+
        '<div><small>Ваш уровень</small><strong>'+level+' / 5</strong></div>'+
        '<div><small>До следующего</small><strong>'+(me.referral_until_next||0)+'</strong></div></div>'+
        '<div class="crafter-referral-link"><span>'+esc(link)+'</span>'+
        '<button type="button" id="crafter-referral-copy">Копировать</button></div>'+
        '<div class="crafter-referral-actions"><button type="button" id="crafter-referral-share">✈ Пригласить друзей</button>'+
        '<button type="button" id="crafter-referral-withdraw">Вывести баланс</button></div>'+
        '<div class="crafter-referral-earnings">Реферальный баланс <strong id="crafter-referral-balance">'+
        liveAmount(me.referral_balance)+' GRAM</strong></div>'+
        '<p class="crafter-referral-note">Минимум для перевода — 1 GRAM. Начисления поступают с оплаченных комиссий.</p>'+
        '</section>';
}
function enhanceProfile(){
    const root=document.querySelector('#main');
    const identity=root?.querySelector('.profile-identity');
    if(!identity)return;
    root.querySelector('.portal-referrals')?.remove();
    root.querySelector('.profile-invite')?.remove();
    root.querySelector('.crafter-referral-glass')?.remove();
    const profile=root.querySelector('.portal-profile');
    profile?.insertAdjacentHTML('afterend',referralMarkup());
    root.querySelector('#crafter-referral-copy')?.addEventListener('click',copyReferral);
    root.querySelector('#crafter-referral-share')?.addEventListener('click',shareReferral);
    root.querySelector('#crafter-referral-withdraw')?.addEventListener('click',withdrawReferral);
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
