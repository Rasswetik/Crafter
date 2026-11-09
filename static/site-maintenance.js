/* Crafter maintenance. Glass overlay is a real site-wide UX, not a screenshot. */
(function(){
  let checking = false;
  const root = () => document.getElementById('crafter-maintenance');
  const status = () => document.getElementById('crafter-maintenance-status');

  function ensureWinterDecor() {
    const overlay=root();
    if(!overlay||typeof overlay.querySelector!=='function'||
       typeof document.createElement!=='function'||
       overlay.querySelector('.crafter-maintenance-snow'))return;
    const snow=document.createElement('div');
    snow.className='crafter-maintenance-snow';
    snow.setAttribute('aria-hidden','true');
    for(let i=0;i<37;i++){
      const flake=document.createElement('i');
      flake.style.setProperty('--x',((i*67+9)%100)+'%');
      flake.style.setProperty('--duration',(9+(i*7)%16)+'s');
      flake.style.setProperty('--delay',(-((i*5)%23))+'s');
      flake.style.setProperty('--drift',((i*29)%155-76)+'px');
      flake.style.setProperty('--flake-size',(2+(i*13)%5)+'px');
      snow.append(flake);
    }
    overlay.insertBefore(snow,overlay.firstChild);
  }
  window.crafterShowMaintenance = function(message) {
    const box = root();
    if (!box) return;
    ensureWinterDecor();
    box.classList.add('is-active');
    document.body.classList.add('maintenance-locked');
    box.setAttribute('aria-hidden','false');
    if (typeof message === 'string' && message.trim())
      document.getElementById('crafter-maintenance-message').textContent = message;
  };
  function hide(){
    const box = root();
    box?.classList.remove('is-active');
    box?.setAttribute('aria-hidden','true');
    document.body.classList.remove('maintenance-locked');
  }
  window.crafterRetryMaintenance = async function() {
    if(checking)return;
    checking=true;
    const b=document.getElementById('crafter-maintenance-retry');
    if(b){b.disabled=true;b.textContent='Проверяем…';}
    const label=status();
    if(label)label.textContent='Проверяем состояние сервиса';
    try {
      const response=await fetch('/api/site/maintenance',{cache:'no-store'});
      if(!response.ok)throw Error('Не удалось проверить состояние');
      const state=await response.json();
      if(!state.enabled) {
        if(root()?.classList.contains('is-active')) {
          if(label)label.textContent='Сервис снова доступен';
          location.reload();
        } else hide();
        return;
      }
      const header={'X-Telegram-Init-Data':typeof telegramInitData==='function' ?
        telegramInitData() : (window.Telegram?.WebApp?.initData || '')};
      if(!header['X-Telegram-Init-Data']){
        const site=typeof crafterWebSession==='function'?crafterWebSession():'';
        if(site)header['X-Crafter-Web-Session']=site;     // website visitors: signed-in administrators pass
      }
      const auth=await fetch('/api/site/maintenance/access',{headers:header,cache:'no-store'});
      const detail=auth.ok?await auth.json():null;
      if(detail?.is_admin) {
        hide();
      } else {
        window.crafterShowMaintenance(state.message);
        if(label)label.textContent='Сервис временно недоступен';
      }
    }catch(error) {
      if(label)label.textContent='Соединение не установлено. Повторите попытку.';
    }finally {
      checking=false;
      if(b){b.disabled=false;b.textContent='Попробовать снова';}
    }
  };
  if(document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded',()=>{ensureWinterDecor();window.crafterRetryMaintenance();},{once:true});
  }else{ensureWinterDecor();window.crafterRetryMaintenance();}
  // Active users are redirected to maintenance as soon as site status changes.
  setInterval(async()=>{
    if(document.hidden)return;
    try {
      const r=await fetch('/api/site/maintenance',{cache:'no-store'});
      if(!r.ok)return;
      const state=await r.json();
      if(state.enabled) {
        await window.crafterRetryMaintenance();
      }else if(root()?.classList.contains('is-active')){
        location.reload();
      }
    }catch(_){}
  },45000);
})();