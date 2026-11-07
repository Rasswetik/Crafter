(async()=>{
  function splashPhase(amount){
    const node=document.querySelector('#splash.splash-final .splash-progress');
    if(!node)return;
    const n=Math.max(0,Math.min(100,Number(amount)||0));
    node.setAttribute('aria-valuenow',String(n));
    const fill=node.querySelector('.splash-progress-fill');
    if(fill)fill.style.width=n+'%';
  }
  splashPhase(8);
  const splash=document.querySelector('#splash'), started=Date.now();
  try {
    const until=Date.now()+2500;
    while(!window.Telegram?.WebApp && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,50));
    splashPhase(20);
    tg=window.Telegram?.WebApp;
    tg?.ready();tg?.expand();tg?.setHeaderColor?.('#131313');tg?.setBackgroundColor?.('#131313');
    splashPhase(36);
    await boot();
    splashPhase(100);
    // Count a visit only after successful authentication and initial page startup.
    if (typeof crafterAnnouncementsOnEnter === 'function') {
      setTimeout(() => crafterAnnouncementsOnEnter(), 1550);
    }
  } catch(error) {
    document.querySelector('#main').innerHTML='<div class="empty"><h2>Не удалось загрузить приложение</h2><p>Проверьте соединение и попробуйте ещё раз.</p><button class="secondary" onclick="location.reload()">Повторить</button></div>';
  } finally {
    setTimeout(()=>{splash.classList.add('finished');setTimeout(()=>splash.remove(),400)},Math.max(0,1100-(Date.now()-started)));
  }
})();
