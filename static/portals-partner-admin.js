/* Key goes to authenticated server only; never persisted in a browser. */
async function renderPortalsPartnerAdmin(content=document.querySelector('#admin-content')) {
  let info;
  try {info=await api('admin/portal/partner');}catch(error){return;}
  if(!content?.isConnected||state.adminSection!=='portal')return;
  const section=document.createElement('section');
  section.className='panel portals-partner-admin';
  section.innerHTML=
    '<h3>Portals · Partner API</h3>'+
    '<p class="sub">Цены, каталог и наличие — публичные API и кеш. Ключ используется на сервере только для покупок, баланса и вывода.</p>'+
    '<p class="sub">Статус ключа: <b>'+(info.key_configured?'Подключён (скрыт)':'Не задан')+
    '</b> · Лимит: <b>1 запрос/сек</b> · Покупки: <b>'+(info.live_purchases?'Разрешены сервером':'Выключены до проверки')+'</b></p>'+
    '<label class="form-label" for="portals-partner-key">Partner API key Portals</label>'+
    '<div class="portals-partner-secret-row"><input class="field" id="portals-partner-key" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Вставьте ключ сотрудничества">'+
    '<button class="secondary" type="button" id="portals-partner-eye">Показать</button></div>'+
    '<p class="sub">Ключ не отображается после сохранения. Хранение — зашифрованная PostgreSQL. Требуется CRAFTER_PORTALS_FERNET_KEY в Render.</p>'+
    '<div class="portals-partner-actions"><button class="primary" type="button" id="portals-partner-save" '+(!info.encryption_ready||!info.durable_db?'disabled':'')+'>Сохранить ключ</button>'+
    '<button class="secondary" type="button" id="portals-partner-test" '+(!info.key_configured?'disabled':'')+'>Проверить баланс</button></div>'+
    '<p class="sub" id="portals-partner-result" role="status"></p>'+
    '<a href="https://docs.portals.tg/ru/developers/api/" target="_blank" rel="noopener noreferrer">Как получить ключ Portals</a>';
  content.insertBefore(section,content.firstElementChild);
  const input=section.querySelector('#portals-partner-key');
  const result=section.querySelector('#portals-partner-result');
  const save=section.querySelector('#portals-partner-save');
  const test=section.querySelector('#portals-partner-test');
  section.querySelector('#portals-partner-eye').onclick=()=>input.type=input.type==='password'?'text':'password';
  save.onclick=async()=>{
    if(!input.value.trim())return;
    if(!confirm('Заменить партнёрский ключ Portals?'))return;
    save.disabled=true;result.textContent='Сохраняем…';
    try {
      await api('admin/portal/partner/key',{key:input.value.trim()});
      input.value='';input.type='password';test.disabled=false;
      result.textContent='Ключ зашифрован и сохранён. Нажмите «Проверить баланс».';
    }catch(error){result.textContent=error.message;}
    finally{save.disabled=false;}
  };
  test.onclick=async()=>{
    test.disabled=true;result.textContent='Проверяем подключение…';
    try {
      const r=await api('admin/portal/partner/check',{});
      result.textContent='Portals подключён. Доступно '+r.balance+' GRAM, заморожено '+r.frozen_funds+' GRAM.';
    }catch(error){result.textContent=error.message;}
    finally{test.disabled=false;}
  };
}

async function renderPortalsLocalResetAdmin(content=document.querySelector('#admin-content')) {
  if(!content?.isConnected||state.adminSection!=='portal')return;
  let info;
  try {info=await api('admin/launch/readiness');}catch(e){return;}
  const section=document.createElement('section');section.className='panel portals-partner-admin';
  section.innerHTML='<h3>Подготовка к запуску</h3>'+
    '<p class="sub">Сброс только синтетических подарков. Реальные NFT и история платежей защищены. Сброс не возвращает NFT на Portals.</p>'+
    '<p>Тестовые: '+info.candidate_gifts+' · Реальные/защищённые: '+info.protected_gifts+' · Занятые: '+info.blocked_gifts+'</p>'+
    '<button class="secondary" type="button" id="portals-reset-preview">Предпросмотр сброса</button>'+
    '<div class="portals-reset-confirm" id="portals-reset-confirm" hidden></div>';
  content.append(section);
  section.querySelector('#portals-reset-preview').onclick=async()=>{
    try {
      const plan=await api('admin/launch/prepare',{});
      const box=section.querySelector('#portals-reset-confirm');
      box.hidden=false;
      box.innerHTML='<p>Кандидатов: '+plan.candidate_gifts+'. Требуется резервная копия базы.</p>'+
        '<label><input type="checkbox" data-ack="first_ack"> Резервная копия сделана</label>'+
        '<label><input type="checkbox" data-ack="second_ack"> Реальные NFT сохраняются</label>'+
        '<label><input type="checkbox" data-ack="third_ack"> Понимаю последствия</label>'+
        '<input class="field" id="portals-reset-phrase" placeholder="СБРОС ТЕСТОВЫХ ПОДАРКОВ" autocomplete="off">'+
        '<button type="button" class="secondary" id="portals-reset-run" '+(!info.reset_unlocked?'disabled':'')+'>Удалить только тестовые записи</button>'+
        (!info.reset_unlocked?'<p class="sub">Серверная блокировка: CRAFTER_ALLOW_LOCAL_RESET не включена.</p>':'');
      box.querySelector('#portals-reset-run').onclick=async()=>{
        const data={token:plan.token,confirmation:box.querySelector('#portals-reset-phrase').value};
        box.querySelectorAll('[data-ack]').forEach(x=>data[x.dataset.ack]=x.checked);
        if(!data.first_ack||!data.second_ack||!data.third_ack||data.confirmation!=='СБРОС ТЕСТОВЫХ ПОДАРКОВ'){
          toast('Заполните все три подтверждения и точную фразу');return;
        }
        if(!confirm('Последнее подтверждение. Удалить тестовые подарки?'))return;
        try{const result=await api('admin/launch/reset-local',data);
          toast('Удалено тестовых подарков: '+result.removed_local_gifts);
          await renderAdminPortal(content);
        }catch(e){toast(e.message);}
      };
    }catch(e){toast(e.message);}
  };
}
