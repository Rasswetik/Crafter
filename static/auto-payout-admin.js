
/* TON auto payouts: admin policy only; no secrets accepted in the browser. */
async function renderAutoPayoutAdmin(target=document.querySelector('#admin-content')){
  if(!target?.isConnected)return;
  const info=await api('admin/tonconnect/auto');
  if(!target.isConnected)return;
  target.querySelector('#crafter-auto-payout-panel')?.remove();
  const p=info.policy, durable=Boolean(info.durable_db);
  const panel=document.createElement('section');
  panel.id='crafter-auto-payout-panel';
  panel.className='panel';
  const status=(info.payouts||[]).map(item=>
    '<div class="wallet-auto-row"><b>'+esc(item.withdrawal_id)+'</b>'+
    '<span>'+esc(item.status)+'</span></div>').join('');
  panel.innerHTML=
    '<h3>Автоматический вывод TON</h3>'+
    '<p class="sub">Без ручной подписи каждой заявки, через отдельный платёжный кошелёк. Выключено по умолчанию.</p>'+
    '<p class="sub">Требуется общий PostgreSQL и Render Cron Job с ключами только в Environment. Никогда не вводите seed-фразу здесь или в чат.</p>'+
    '<p class="sub">База: <b>'+(durable?'PostgreSQL подключён':'Нет общего PostgreSQL — запуск заблокирован')+
    '</b> · Сеть: '+esc(info.network)+'</p>'+
    '<form id="crafter-auto-payout-form">'+
      '<label class="wallet-setting"><input type="checkbox" name="enabled"'+(p.enabled?' checked':'')+
      (durable?'':' disabled')+'> Разрешить автоматические выплаты по новым заявкам</label>'+
      '<label class="form-label">Максимум за транзакцию, TON</label>'+
      '<input class="field" name="max_ton" type="number" min="0.001" step="0.001" value="'+esc(p.max_ton)+'" required>'+
      '<label class="form-label">Лимит за 24 часа, TON</label>'+
      '<input class="field" name="daily_ton" type="number" min="0.001" step="0.001" value="'+esc(p.daily_ton)+'" required>'+
      '<label class="form-label">Резерв на кошельке, TON</label>'+
      '<input class="field" name="reserve_ton" type="number" min="0.001" step="0.001" value="'+esc(p.reserve_ton)+'" required>'+
      '<button class="primary" type="submit">Сохранить настройки автовывода</button></form>'+
    '<p class="sub">Существующие заявки останутся ручными. При неопределённом результате TON-транзакции обработчик остановит новые выплаты до проверки.</p>'+
    '<h4>История автоматических выплат</h4>'+
    '<div class="crafter-auto-payout-list">'+(status||'<p class="sub">Автоматических операций ещё нет.</p>')+'</div>';
  target.append(panel);
  const form=panel.querySelector('form');
  form.addEventListener('submit', async event=>{
    event.preventDefault();
    const obj={
      enabled:form.elements.enabled.checked,
      max_ton:form.elements.max_ton.value,
      daily_ton:form.elements.daily_ton.value,
      reserve_ton:form.elements.reserve_ton.value
    };
    if(obj.enabled&&!confirm('После настройки отдельного платёжного кошелька и Cron Job реальные TON будут переводиться игрокам автоматически. Разрешить обработку новых заявок?'))return;
    const btn=form.querySelector('[type=submit]');btn.disabled=true;
    try{
      await api('admin/tonconnect/auto',obj);
      toast('Лимиты сохранены');
      await renderAutoPayoutAdmin(target);
    }catch(e){toast(e.message);btn.disabled=false;}
  });
}
