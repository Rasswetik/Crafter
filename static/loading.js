(async()=>{
  const splash=document.querySelector('#splash'), started=Date.now();
  try {
    const until=Date.now()+2500;
    while(!window.Telegram?.WebApp && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,50));
    tg=window.Telegram?.WebApp;
    tg?.ready();tg?.expand();tg?.setHeaderColor?.('#131313');tg?.setBackgroundColor?.('#131313');
    await boot();
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
