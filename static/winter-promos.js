/* Extra seasonal artwork for the live game pages.
   Preserves existing admin-uploaded banners and their editor. */
(()=>{
  'use strict';
  const titles={arena:'Ice Arena — зимняя битва',
    lucky:'Lucky Craft — новогодний крафт',
    leaders:'Leaders — призовые места'};
  let scheduled=false;
  async function openSeasonal(key){
    try{
      if(key==='arena')return await go('arena');
      if(key==='leaders')return await go('events');
      if(key==='lucky'){
        await go('market');
        if(typeof openBannerLuckyCraft==='function'){
          await openBannerLuckyCraft();
        }else if(typeof toast==='function'){
          toast('Откройте Lucky Craft из подарка на маркете');
        }
      }
    }catch(e){if(typeof toast==='function')toast(e.message||'Не удалось открыть режим');}
  }
  function item(key){
    const node=document.createElement('button');
    node.type='button';node.className='winter-promo';
    node.dataset.winterMode=key;node.setAttribute('aria-label',titles[key]);
    const visual=document.createElement('span');
    visual.className='winter-promo-art winter-promo-art-'+key;
    visual.setAttribute('aria-hidden','true');
    node.append(visual);node.addEventListener('click',()=>openSeasonal(key));
    return node;
  }
  function group(keys,extra=''){
    const node=document.createElement('section');
    node.className='winter-promos '+extra;
    node.setAttribute('aria-label','Зимние режимы Crafter');
    keys.forEach(key=>node.append(item(key)));
    return node;
  }
  function paint(){
    const main=document.getElementById('main');
    if(!main || typeof state === 'undefined' || !state.page)return;
    const hub=main.querySelector('.crafter-games');
    if(hub&&!hub.querySelector('.winter-promos')) hub.prepend(group(['arena','lucky','leaders'],'winter-promos-hub'));
    if(state.page==='market'&&!state.collectionPage&&main.querySelector('.search')&&!main.querySelector('.market-winter-promos')){
      main.prepend(group(['arena','lucky','leaders'],'market-winter-promos'));
    }
    const craft=main.querySelector('.craft-page');
    if(state.page==='craft'&&craft&&!craft.querySelector('.winter-promos')){
      const promo=group(['lucky'],'winter-promo-grouped');
      craft.insertBefore(promo,craft.querySelector('.forge')||craft.firstChild);
    }
    const arena=main.querySelector('.arena-page');
    if(state.page==='arena'&&arena&&!arena.querySelector('.winter-promos')){
      const after=arena.querySelector('#arena-event-banner');
      const promo=group(['arena'],'winter-promo-grouped');
      if(after)after.insertAdjacentElement('afterend',promo);else arena.prepend(promo);
    }
  }
  function schedule(){
    if(scheduled)return;scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;paint();});
  }
  const main=document.getElementById('main');
  if(main)new MutationObserver(schedule).observe(main,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',schedule,{once:true});
  schedule();
})();
