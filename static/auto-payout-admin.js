/* Crafter: one-screen auto-payout setup, no hot-wallet secrets on the website. */
function crafterAutoBadge(ok, positive='Готово', negative='Не настроено'){
  return '<span class="crafter-auto-state '+(ok?'is-ready':'is-missing')+'">'+
    '<span class="crafter-auto-state-dot" aria-hidden="true"></span>'+
    (ok?positive:negative)+'</span>';
}
function crafterAutoState(value){
  const labels={
    prepared:'Подписан, ожидает отправки',
    broadcast:'Отправлен, ожидает подтверждения',
    review:'Требуется ручная проверка',
    confirmed:'Подтверждён',
  };
  return labels[value]||String(value||'—');
}
function crafterAutoCheckHtml(data){
  const rows=[
    ['Постоянная база PostgreSQL',data.database],
    ['Кошелёк указан',data.wallet_address],
    ['Кошелёк V4R2',data.wallet_v4r2],
    ['TON на резерв',data.balance_ok],
    ['Обработчик и подпись',data.worker?.ready],
    ['Приём депозитов',data.funding],
    ['Заявки на вывод',data.withdrawals],
    ['Нет незавершённых переводов',data.unsettled===0],
  ];
  const val=data.balance_ton==null?'Баланс не получен':
    'На платёжном кошельке: '+esc(data.balance_ton)+' TON';
  return '<div class="crafter-auto-checks">'+rows.map(([name,ok])=>
    '<div><span>'+esc(name)+'</span>'+crafterAutoBadge(Boolean(ok),'OK','Проверить')+'</div>').join('')+
    '</div><p class="crafter-auto-message">'+val+
    ' · Заявок в очереди: '+Number(data.queued||0)+
    (data.worker?.state==='stale'?' · Обработчик давно не запускался':'')+
    (data.wallet_error?' · '+esc(data.wallet_error):'')+
    '</p><p class="crafter-auto-message">'+(data.ready?
      'Проверка пройдена. Для реальных выплат дополнительно должно быть включено разрешение на автовывод.':
      'Остались незавершённые настройки. Проверка не отправляет TON и не изменяет баланс.')+
    '</p>';
}
async function renderAutoPayoutAdmin(target=document.querySelector('#admin-content')){
  if(!target?.isConnected)return;
  const info=await api('admin/tonconnect/auto');
  if(!target.isConnected || state.adminSection!=='tonconnect')return;
  target.querySelector('#crafter-auto-payout-panel')?.remove();
  const p=info.policy||{}, durable=Boolean(info.durable_db);
  const worker=info.worker||{};
  const hasWorker=Boolean(worker.ready);
  const opAddress=String(p.payout_address||info.operator_address||'');
  const records=(info.payouts||[]).map(item=>
    '<div class="crafter-auto-history-item">'+
       '<strong>'+esc(crafterAutoState(item.status))+'</strong>'+
       '<small>'+esc(item.withdrawal_id)+'</small>'+
       (item.confirmed_tx?
          '<a target="_blank" rel="noopener noreferrer" href="'+
           (info.network==='testnet'?'https://testnet.tonscan.org/tx/':'https://tonscan.org/tx/')+
           encodeURIComponent(item.confirmed_tx)+'">Проверить в Tonscan</a>':
          '<small>Без подтверждённого хеша</small>')+
     '</div>').join('');
  const panel=document.createElement('section');
  panel.id='crafter-auto-payout-panel';
  panel.className='panel crafter-auto-setup';
  panel.innerHTML=
    '<div class="crafter-auto-heading"><div class="crafter-auto-icon">↗</div>'+
       '<div><small>ТОN / ВЫПЛАТЫ</small><h3>Автоматический вывод</h3>'+
       '<p class="sub">Всё управление выплатами — в одном разделе</p></div></div>'+
    '<div class="crafter-auto-statusbar">'+
       '<div><small>Режим</small><strong>'+(p.enabled?'Разрешён':'Выключен')+'</strong></div>'+
       '<div><small>База данных</small>'+crafterAutoBadge(durable,'Подключена','Не подключена')+'</div>'+
       '<div><small>Платёжный обработчик</small>'+crafterAutoBadge(hasWorker,'Подключён','Не подключён')+'</div>'+
     '</div>'+
    '<div class="crafter-auto-notice">Для реальных автоматических переводов нужен <b>отдельный TON-кошелёк</b> с небольшим резервом. Сид-фраза основного кошелька в Crafter не нужна и не вводится.</div>'+
    '<form id="crafter-auto-payout-form" autocomplete="off">'+
       '<div class="crafter-auto-step"><span>1</span><div><strong>Платёжный кошелёк</strong><small>Публичный адрес отдельного V4R2</small></div></div>'+
       '<label class="form-label" for="crafter-auto-address">TON-адрес кошелька выплат</label>'+
       '<input class="field" name="payout_address" id="crafter-auto-address" type="text" spellcheck="false" maxlength="128" value="'+esc(opAddress)+'" placeholder="UQ... или 0:..." autocomplete="off">'+
       '<p class="sub">Сеть: <b>'+esc(info.network)+'</b>. Для смены сети используйте настройки TON Connect выше.</p>'+
       '<div class="crafter-auto-step"><span>2</span><div><strong>Лимиты и безопасность</strong><small>Сколько можно выплатить автоматически</small></div></div>'+
       '<div class="crafter-auto-grid">'+
         '<label>На одну выплату, TON<input class="field" name="max_ton" type="number" min="0.000000001" max="1000" step="0.000000001" value="'+esc(p.max_ton)+'" required></label>'+
         '<label>За 24 часа, TON<input class="field" name="daily_ton" type="number" min="0.000000001" max="1000" step="0.000000001" value="'+esc(p.daily_ton)+'" required></label>'+
         '<label class="crafter-auto-grid-wide">Неприкосновенный резерв для комиссий, TON<input class="field" name="reserve_ton" type="number" min="0.000000001" max="1000" step="0.000000001" value="'+esc(p.reserve_ton)+'" required></label>'+
       '</div>'+
       '<div class="crafter-auto-step"><span>3</span><div><strong>Запуск автоматических выплат</strong><small>Разрешение можно выключить в любой момент</small></div></div>'+
       '<label class="crafter-auto-switch"><input type="checkbox" name="enabled"'+(p.enabled?' checked':'')+
          (!p.enabled&&(!durable||!hasWorker)?' disabled':'')+'>'+
          '<span><b>Разрешить автовыплаты</b><small>'+(
            !durable?'Сначала нужен постоянный PostgreSQL':
            !hasWorker&&!p.enabled?'Сначала подключите отдельный платёжный обработчик':
            'Новые заявки смогут отправляться без ручной подписи')+'</small></span></label>'+
       '<div class="crafter-auto-buttons">'+
         '<button class="primary" type="submit">Сохранить настройки</button>'+
         '<button class="secondary" type="button" id="crafter-auto-check">Проверить подключение</button>'+
       '</div>'+
    '</form>'+
    '<div class="crafter-auto-check-result" id="crafter-auto-check-result" aria-live="polite">'+
       '<p class="sub">Проверка покажет TON-баланс, тип кошелька, работу сервиса выплат и наличие зависших заявок. Деньги не переводятся.</p>'+
     '</div>'+
    '<div class="crafter-auto-instructions"><h4>Что ещё требуется для автоматической подписи?</h4>'+
       '<p>Ключ нового платёжного кошелька хранится отдельно, в секретных настройках Render Cron Job, а не в общедоступном приложении. После подключения обработчик появится выше как «Подключён».</p>'+
       '<div class="crafter-auto-buttons">'+
        '<a href="https://github.com/Rasswetik/Crafter/blob/main/AUTO_PAYOUT_SETUP.md" target="_blank" rel="noopener noreferrer">Инструкция настройки</a>'+
        '<a href="https://dashboard.render.com/" target="_blank" rel="noopener noreferrer">Открыть Render</a>'+
       '</div></div>'+
    '<div class="crafter-auto-history"><h4>Последние автоматические переводы</h4>'+
       (records||'<p class="sub">Автоматических переводов пока не было.</p>')+'</div>';
  const first=target.querySelector(':scope > section.panel');
  if(first)first.insertAdjacentElement('afterend',panel);else target.append(panel);
  const form=panel.querySelector('form'),button=panel.querySelector('#crafter-auto-check');
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    const payload={
      payout_address:form.elements.payout_address.value.trim(),
      enabled:form.elements.enabled.checked,
      max_ton:form.elements.max_ton.value,
      daily_ton:form.elements.daily_ton.value,
      reserve_ton:form.elements.reserve_ton.value,
    };
    if(payload.enabled&&!confirm(
       'Включить автоматические выплаты? При наличии отдельного подписывающего обработчика новые заявки будут оплачены в TON без ручного подтверждения.'))return;
    const submit=form.querySelector('[type="submit"]');
    submit.disabled=true;
    try{
       await api('admin/tonconnect/auto',payload);
       toast('Настройки автовывода сохранены');
       await renderAutoPayoutAdmin(target);
    }catch(error){toast(error.message);submit.disabled=false;}
  });
  button.addEventListener('click',async()=>{
    button.disabled=true;button.textContent='Проверяем…';
    try{
      const result=await api('admin/tonconnect/auto/preflight');
      panel.querySelector('#crafter-auto-check-result').innerHTML=crafterAutoCheckHtml(result);
    }catch(error){
      panel.querySelector('#crafter-auto-check-result').textContent='Ошибка проверки: '+error.message;
    }finally{button.disabled=false;button.textContent='Проверить подключение';}
  });
}
