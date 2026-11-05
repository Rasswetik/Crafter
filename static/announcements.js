/* In-app announcement/interstitial popup, also used by admin live previews. */
const CRAFTER_POPUP_FONTS={
  system:'-apple-system,BlinkMacSystemFont,"SF Pro Display",Arial,sans-serif',
  rounded:'ui-rounded,"SF Pro Rounded",-apple-system,Arial,sans-serif',
  display:'"SF Pro Display",-apple-system,Arial,sans-serif',
  heavy:'Impact,"Arial Black",sans-serif',
  bold:'"Arial Black",Arial,sans-serif',
  geometric:'"Trebuchet MS",Verdana,Arial,sans-serif',
  clean:'Verdana,Arial,sans-serif',
  classic:'Tahoma,Arial,sans-serif',
  mono:'ui-monospace,Menlo,Consolas,monospace',
  serif:'Georgia,"Times New Roman",serif',
  condensed:'"Arial Narrow",Arial,sans-serif',
  futuristic:'"Trebuchet MS",Arial,sans-serif'
};
let crafterPopupActive=null;
function crafterCloseAnnouncement(){
 const dialog=crafterPopupActive;
 if(!dialog)return;
 clearTimeout(dialog.crafterCloseTimer);
 dialog.classList.add('crafter-announcement-closing');
 dialog.addEventListener('animationend',()=>{
  if(dialog.open)dialog.close();
  dialog.remove();
  if(crafterPopupActive===dialog)crafterPopupActive=null;
 },{once:true});
 // Animation-disabled environments must still close.
 dialog.crafterCloseTimer=setTimeout(()=>{
  if(dialog.open)dialog.close();
  dialog.remove();
  if(crafterPopupActive===dialog)crafterPopupActive=null;
 },450);
}
function crafterShowAnnouncement(cfg,preview=false){
 if(!cfg||crafterPopupActive)return;
 const banner=document.createElement('dialog');
 banner.className='crafter-announcement'+(cfg.position==='bottom'?' crafter-announcement-bottom':'');
 banner.setAttribute('aria-label',cfg.title||'Объявление Crafter');
 banner.style.setProperty('--announcement-width',Math.min(560,Math.max(290,Number(cfg.max_width)||420))+'px');
 banner.style.setProperty('--announcement-radius',Math.min(45,Math.max(0,Number(cfg.radius)||27))+'px');
 banner.style.setProperty('--announcement-bg',cfg.background_color||'#242326');
 banner.style.setProperty('--announcement-title-color',cfg.title_color||'#fff');
 banner.style.setProperty('--announcement-desc-color',cfg.description_color||'#b7b2c0');
 banner.style.setProperty('--announcement-cta-bg',cfg.button_color||'#168bff');
 banner.style.setProperty('--announcement-cta-color',cfg.button_text_color||'#fff');
 banner.style.setProperty('--announcement-blur',Math.min(20,Math.max(0,Number(cfg.blur)||0))+'px');
 banner.style.setProperty('--announcement-title-size',Math.min(45,Math.max(14,Number(cfg.title_size)||23))+'px');
 banner.style.setProperty('--announcement-desc-size',Math.min(23,Math.max(10,Number(cfg.description_size)||13))+'px');
 banner.style.setProperty('--announcement-title-font',CRAFTER_POPUP_FONTS[cfg.title_font]||CRAFTER_POPUP_FONTS.rounded);
 banner.style.setProperty('--announcement-desc-font',CRAFTER_POPUP_FONTS[cfg.description_font]||CRAFTER_POPUP_FONTS.system);
 banner.style.setProperty('--announcement-media-height',Math.min(520,Math.max(120,Number(cfg.media_height)||290))+'px');
 const close=document.createElement('button');
 close.type='button';close.className='crafter-announcement-close';
 close.setAttribute('aria-label','Закрыть объявление');
 close.disabled=true;
 close.innerHTML='<svg class="crafter-announcement-ring" viewBox="0 0 44 44" aria-hidden="true">'+
  '<circle cx="22" cy="22" r="19" stroke="currentColor" fill="none" stroke-width="3" opacity=".24"/>'+
  '<circle class="crafter-announcement-ring-progress" cx="22" cy="22" r="19" stroke="currentColor" fill="none" stroke-width="3"/></svg>'+
  '<span aria-hidden="true">×</span>';
 const card=document.createElement('div');
 card.className='crafter-announcement-card';
 const media=document.createElement('div');media.className='crafter-announcement-media';
 const url=cfg.media||'';
 if(/^\/media\/ice-banner\/[0-9a-f]{32}\.(?:gif|webp)$/.test(url)){
  const image=document.createElement('img');
  image.src=url;image.alt='';
  image.loading='eager';image.decoding='async';
  media.append(image);
 }else{
  media.classList.add('crafter-announcement-no-image');
  const placeholder=document.createElement('div');
  placeholder.className='crafter-announcement-placeholder';
  placeholder.textContent='Crafter';
  media.append(placeholder);
 }
 const text=document.createElement('div');text.className='crafter-announcement-text';
 const title=document.createElement('h2');title.textContent=cfg.title||'Объявление Crafter';
 const description=document.createElement('p');description.textContent=cfg.description||'';
 text.append(title,description);
 const action=document.createElement('button');
 action.className='crafter-announcement-cta';
 action.type='button';
 action.textContent=cfg.button_text||'Продолжить';
 action.addEventListener('click',()=>{
  const target=cfg.button_url||'';
  crafterCloseAnnouncement();
  if(!target||preview)return;
  if(target.startsWith('https://')){
   if(window.Telegram?.WebApp?.openLink)window.Telegram.WebApp.openLink(target);
   else window.open(target,'_blank','noopener,noreferrer');
  }else if(target.startsWith('/')&&!target.startsWith('//')){
   window.location.assign(target);
  }
 });
 card.append(media,text,action);
 banner.append(close,card);
 const delay=Math.min(12,Math.max(1,Number(cfg.close_delay)||3));
 banner.style.setProperty('--announcement-close-delay',delay+'s');
 close.addEventListener('click',()=>{if(!close.disabled)crafterCloseAnnouncement();});
 banner.addEventListener('cancel',event=>{
  if(close.disabled){event.preventDefault();return;}
  event.preventDefault();crafterCloseAnnouncement();
 });
 banner.addEventListener('click',event=>{
  if(event.target===banner&&!close.disabled)crafterCloseAnnouncement();
 });
 document.body.append(banner);
 crafterPopupActive=banner;
 banner.showModal();
 const ring=close.querySelector('.crafter-announcement-ring-progress');
 ring.style.animationDuration=delay+'s';
 banner.crafterCloseTimer=setTimeout(()=>{
  if(!banner.isConnected)return;
  close.disabled=false;
  close.classList.add('crafter-announcement-close-ready');
 },delay*1000);
}
async function crafterAnnouncementsOnEnter(){
 try{
  const result=await api('announcements/entry',{});
  if(!result.announcement)return;
  // Allow the app to paint before the overlay opens.
  setTimeout(()=>crafterShowAnnouncement(result.announcement),350);
 }catch(_error){
  // Announcements never block the main site.
 }
}
