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
/* Launch countdown: a full-page screen with days / hours / minutes / seconds; at zero the site opens by itself. */
(function () {
  let timer = null;
  const pad = n => String(n).padStart(2, '0');
  window.crafterShowLaunch = function (opensAt, serverNow) {
    const box = document.getElementById('crafter-launch-screen');
    if (!box || !opensAt) return;
    const offset = (serverNow || Math.floor(Date.now() / 1000)) - Math.floor(Date.now() / 1000);
    const cells = {};
    box.querySelectorAll('[data-u]').forEach(b => { cells[b.dataset.u] = b; });
    const when = document.getElementById('crafter-launch-date');
    if (when) when.textContent = new Date(opensAt * 1000).toLocaleString('ru-RU', {day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'});
    if (!box.querySelector('.crafter-maintenance-snow')) {                 // the same snow as on the maintenance screen
      const snow = document.createElement('div');
      snow.className = 'crafter-maintenance-snow';
      snow.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 46; i++) {
        const flake = document.createElement('i');
        flake.style.setProperty('--x', ((i * 67 + 9) % 100) + '%');
        flake.style.setProperty('--duration', (9 + (i * 7) % 16) + 's');
        flake.style.setProperty('--delay', (-((i * 5) % 23)) + 's');
        flake.style.setProperty('--drift', ((i * 29) % 155 - 76) + 'px');
        flake.style.setProperty('--flake-size', (2 + (i * 13) % 5) + 'px');
        snow.append(flake);
      }
      box.insertBefore(snow, box.firstChild);
    }
    box.classList.add('is-active'); box.setAttribute('aria-hidden', 'false'); document.body.classList.add('launch-locked');
    clearInterval(timer);
    const put = (key, value) => { const b = cells[key]; if (b && b.textContent !== value) { b.textContent = value; b.classList.remove('is-tick'); void b.offsetWidth; b.classList.add('is-tick'); } };
    const tick = () => {
      const left = Math.max(0, opensAt - (Math.floor(Date.now() / 1000) + offset));
      put('d', pad(Math.floor(left / 86400))); put('h', pad(Math.floor(left % 86400 / 3600)));
      put('m', pad(Math.floor(left % 3600 / 60))); put('s', pad(left % 60));
      if (left === 0) { clearInterval(timer); setTimeout(() => location.reload(), 1200); }
    };
    tick();
    timer = setInterval(tick, 1000);
  };
  // the screen also appears on a plain page load, before any request fails
  fetch('/api/site/launch', {cache: 'no-store'}).then(r => r.json()).then(s => { if (s.active) window.crafterShowLaunch(s.opens_at, s.now); }).catch(() => {});
})();
