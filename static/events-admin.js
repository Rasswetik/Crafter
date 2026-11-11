/* Admin: images, schedules and genuine score-based Crafter events. */
let crafterAdminEvents = {events:[], metrics:[]};

function crafterEventLocalTime(unix) {
    const date = new Date(Number(unix) * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
function crafterEventAdminDate(unix) {
    return new Date(Number(unix) * 1000).toLocaleDateString('ru-RU', {
        day:'2-digit',month:'short',year:'numeric'
    });
}
let crafterAdminSeasons={active:null,seasons:[]};

function crafterSeasonPanel(events, seasons){
    const arena=events.filter(item=>item.metric==='arena_wins');
    const craft=events.filter(item=>item.metric==='craft_wins');
    const linked=(seasons.seasons||[]).find(item=>item.active);
    const label=id=>events.find(e=>e.id===id)?.title||'Ранее выбранный лидерборд';
    const options=items=>items.map(item=>
        '<option value="'+esc(item.id)+'">'+esc(item.title)+' · '+crafterEventAdminDate(item.start_at)+
        ' – '+crafterEventAdminDate(item.end_at)+'</option>').join('');
    return '<section class="panel crafter-unified-season-panel">'+
        '<div class="crafter-season-heading"><span class="crafter-season-symbol">✦</span>'+
        '<div><small>ARENA × CRAFT</small><h3>Общий сезон</h3></div></div>'+
        '<p class="sub">Объедините два существующих лидерборда в один рейтинг. Победа в Arena и успешный крафт дают по 1 очку. Для каждой игры учитывается период выбранного ивента; история и призы старых событий сохраняются.</p>'+
        (linked?'<div class="crafter-season-active"><strong>'+esc(linked.title)+'</strong>'+
          '<span>'+esc(label(linked.arena_event_id))+' + '+esc(label(linked.craft_event_id))+'</span>'+
          '<small>Баннеры Arena и Крафтов привязаны к одному сезону.</small></div>'+
          '<div class="crafter-season-buttons">'+
          '<button type="button" class="primary" data-season-edit="'+esc(linked.season_event_id)+'">Открыть сезон и призы</button>'+
          '<button type="button" class="secondary" data-season-unlink="'+esc(linked.season_event_id)+'">Разъединить баннеры</button></div>':
          '<form class="crafter-season-form" data-season-form>'+
          '<label>Название сезона<input class="field" name="title" maxlength="90" required value="Общий сезон Arena + Крафты"></label>'+
          '<label>Лидерборд Arena<select class="field" name="arena_event_id" required>'+
          (arena.length?options(arena):'<option value="">Нет лидербордов по победам Arena</option>')+'</select></label>'+
          '<label>Лидерборд Крафтов<select class="field" name="craft_event_id" required>'+
          (craft.length?options(craft):'<option value="">Нет лидербордов по успешным крафтам</option>')+'</select></label>'+
          '<p class="crafter-season-preview">Один сезон → одна таблица игроков → общие NFT-награды. Изображения обоих баннеров останутся прежними.</p>'+
          '<button type="submit" class="primary"'+(!arena.length||!craft.length?' disabled':'')+'>Объединить лидерборды и оба баннера</button>'+
          ((!arena.length||!craft.length)?'<p class="sub">Сначала создайте отдельные события с показателями «Победы в Arena» и «Успешные крафты».</p>':'')+
          '</form>')+
        '</section>';
}

async function renderAdminEvents(content = document.querySelector('#admin-content')) {
    const [data,seasons]=await Promise.all([api('admin/events'),api('admin/seasons')]);
    if (!content || !content.isConnected) return;
    crafterAdminEvents=data;crafterAdminSeasons=seasons;
    const status = {active:'Идёт',upcoming:'Скоро',finished:'Завершён'};
    content.innerHTML = `<div class="crafter-events-admin">
        <section class="panel">
            <h3>Лидерборды и ивенты</h3>
            <button class="secondary" type="button" onclick="openAdminSection('ice_banner')">Редактор баннера над Ice Arena</button>
            <button class="secondary" type="button" onclick="openAdminSection('craft_banner')">Редактор баннера над Крафтами</button>
            <p class="sub">Создавайте события с PNG-обложками и изображениями наград. Укажите сроки, цвет, показатель топа и видимость. Результаты строятся по реальным операциям Crafter.</p>
            <button type="button" class="primary crafter-event-add" data-new>+ Создать ивент</button>
        </section>
        ${crafterSeasonPanel(data.events,seasons)}
        <section class="panel">
            <h3>События <small>${data.events.length}</small></h3>
            <div class="crafter-admin-event-list">
                ${data.events.map(item => `<article class="crafter-admin-event-card">
                    ${item.image_url?'<img class="crafter-admin-event-cover" src="'+esc(item.image_url)+'" loading="lazy" alt="">':'<span class="crafter-admin-event-cover crafter-admin-event-no-cover">#</span>'}
                    <div class="crafter-admin-event-info">
                        <strong>${esc(item.title)}</strong>
                        <span>${esc(item.metric_label)} · ${crafterEventAdminDate(item.start_at)} – ${crafterEventAdminDate(item.end_at)}</span>
                        <small>${item.enabled ? status[item.status] : 'Скрыто'} · ${item.show_leaderboard ? 'Рейтинг включён' : 'Рейтинг скрыт'}</small>
                    </div>
                    <div class="crafter-admin-event-actions">
                     <button type="button" class="secondary" data-edit="${esc(item.id)}">Изменить</button>
                     <button type="button" class="secondary" data-studio-open="${esc(item.id)}">Баннеры и таймер</button>
                     <button type="button" class="primary" data-leader-editor="${esc(item.id)}">♛ Редактор лидеров</button>
                     <button type="button" class="secondary" data-event-prizes="${esc(item.id)}">NFT-награды (${(item.prizes||[]).filter(p=>p.type==='collection'||p.type==='model').length})</button>
                    </div>
                </article>`).join('') || '<p class="sub">Пока нет событий. Создайте первое для Arena или Крафтов.</p>'}
            </div>
        </section>
        <section class="panel crafter-event-editor" data-event-editor hidden></section>
    </div>`;
    content.querySelector('[data-new]').onclick = () => crafterEditEvent(null);
    const seasonForm=content.querySelector('[data-season-form]');
    seasonForm?.addEventListener('submit',async event=>{
        event.preventDefault();
        if(!seasonForm.reportValidity())return;
        const data=new FormData(seasonForm);
        const payload={title:String(data.get('title')||'').trim(),
            arena_event_id:String(data.get('arena_event_id')||''),
            craft_event_id:String(data.get('craft_event_id')||'')};
        if(!confirm('Создать общий сезон? Будет один рейтинг и общие баннеры Arena и Крафтов. Старые рейтинги останутся доступны.'))return;
        const button=seasonForm.querySelector('[type="submit"]');button.disabled=true;
        try{
            const result=await api('admin/seasons/merge',payload);
            toast('Сезон создан. Оба баннера ведут к общему топу.');
            await renderAdminEvents(content);
            await crafterOpenEventPrizes(result.id);
        }catch(error){toast(error.message);if(button.isConnected)button.disabled=false;}
    });
    content.querySelectorAll('[data-season-edit]').forEach(button=>{
        button.onclick=()=>crafterOpenEventPrizes(button.dataset.seasonEdit);
    });
    content.querySelectorAll('[data-season-unlink]').forEach(button=>{
        button.onclick=async()=>{
            if(!confirm('Разъединить баннеры? Старый сезон, его рейтинг и награды останутся доступны.'))return;
            button.disabled=true;
            try{
                await api('admin/seasons/unlink',{season_event_id:button.dataset.seasonUnlink});
                toast('Баннеры разъединены, настройки предыдущих событий восстановлены.');
                await renderAdminEvents(content);
            }catch(error){toast(error.message);if(button.isConnected)button.disabled=false;}
        };
    });
    content.querySelectorAll('[data-event-prizes]').forEach(button=>{
        button.onclick=()=>crafterOpenEventPrizes(button.dataset.eventPrizes);
    });
    content.querySelectorAll('[data-leader-editor]').forEach(button=>{
        button.onclick=()=>crafterOpenEventLeaders(button.dataset.leaderEditor);
    });
    content.querySelectorAll('[data-studio-open]').forEach(button=>{
        button.onclick=()=>crafterOpenEventStudio(button.dataset.studioOpen);
    });
    content.querySelectorAll('[data-edit]').forEach(button => {
        button.onclick = () => crafterEditEvent(data.events.find(item => item.id === button.dataset.edit));
    });
}

function crafterEditEvent(item) {
    const content = document.querySelector('#admin-content');
    const editor = content?.querySelector('[data-event-editor]');
    if (!editor) return;
    const now = Math.floor(Date.now()/1000);
    const event = item || {
        title:'',description:'',metric:'arena_wins',accent:'#9164e9',
        start_at:now,end_at:now+7*86400,sort_order:10,enabled:false,show_leaderboard:true,
        prizes:[{label:''},{label:''},{label:''}]
    };
    editor.hidden = false;
    editor.innerHTML = `<h3>${item ? 'Изменить ивент' : 'Новый ивент'}</h3>
        <form class="crafter-event-form">
            <label>Необязательная обложка (на странице топа не показывается)
                <input type="file" name="image" accept="image/png,image/jpeg,image/webp">
            </label>
            ${item&&event.image_url ? `<img class="crafter-event-admin-hero" src="${esc(event.image_url)}" alt="">` : ''}
            <label>Название<input class="field" name="title" maxlength="90" required value="${esc(event.title)}"></label>
            <label>Приветствие и описание (до 700 символов)
                <textarea class="field" name="description" rows="3" maxlength="700" placeholder="Описание события и правила участия">${esc(event.description)}</textarea>
            </label>
            <div class="crafter-event-form-grid">
                <label>Показатель рейтинга<select class="field" name="metric">
                    ${crafterAdminEvents.metrics.filter(metric=>metric.value!=='season_points'||item?.metric==='season_points').map(metric => `<option value="${esc(metric.value)}" ${metric.value===event.metric?'selected':''}>${esc(metric.label)}</option>`).join('')}
                </select></label>
                <label>Цвет кнопок и оформления
                    <input type="color" name="accent" value="${esc(event.accent)}">
                </label>
                <label>Начало<input class="field" name="start_local" type="datetime-local" required value="${crafterEventLocalTime(event.start_at)}"></label>
                <label>Окончание<input class="field" name="end_local" type="datetime-local" required value="${crafterEventLocalTime(event.end_at)}"></label>
                <label>Порядок<input class="field" name="sort_order" type="number" min="0" max="999" required value="${event.sort_order}"></label>
            </div>
            <div class="crafter-event-checks">
                <label><input name="enabled" type="checkbox" value="1" ${event.enabled?'checked':''}> Показывать событие в приложении</label>
                <label><input name="show_leaderboard" type="checkbox" value="1" ${event.show_leaderboard?'checked':''}> Показывать рейтинг игроков</label>
            </div>
            <h4>Награды для мест 1–3</h4>
            <p class="sub">Можно указать целую коллекцию NFT (например, Plush Pepe), без выбора улучшенной модели. После завершения лидерборда администратор подтверждает покупку самого дешёвого подходящего подарка с Craft Market, и настоящий NFT поступает победителю.</p>
            ${item?'<button type="button" class="primary" data-open-studio-prizes>Выбрать NFT по коллекции из каталога</button>':''}
            <div class="crafter-event-prize-grid">
            ${[1,2,3].map(place=>{
                const prize=event.prizes[place-1]||{};
                return '<div class="crafter-event-prize-edit"><strong>Место №'+place+'</strong>'+
                    ((prize.type==='collection'&&prize.collection)?
                      '<img src="/media/collection/'+encodeURIComponent(prize.collection.replace(/[^a-z0-9]/gi,'').toLowerCase())+'" alt="PNG коллекции '+place+'">' :
                      prize.image_url?'<img src="'+esc(prize.image_url)+'" alt="Награда '+place+'">':
                        '<div class="crafter-event-image-empty">Награда</div>')+
                    '<label>Тип награды<select class="field" name="prize_type_'+place+'">'+
                    [['none','Без награды'],['gram','GRAM · SVG'],['image','PNG / GIF'],['telegram','Telegram NFT по ссылке'],['collection','Обычная коллекция из маркета'],['model','Определённая модель коллекции']].map(([type,label])=>
                      '<option value="'+type+'" '+((prize.type||'none')===type?'selected':'')+'>'+label+'</option>').join('')+
                    '</select></label>'+
                    '<label>Описание / сумма<input class="field" name="prize_'+place+'" maxlength="120" value="'+esc(prize.label||'')+'" placeholder="Например, 100 GRAM"></label>'+
                    '<label>Название коллекции<input class="field" name="prize_collection_'+place+'" value="'+esc(prize.collection||'')+'" placeholder="Plush Pepe"></label>'+
                    '<label>Модель (пусто = любой NFT коллекции)<input class="field" name="prize_model_'+place+'" value="'+esc(prize.model||'')+'" placeholder="Любая модель"></label>'+
                    '<label>Telegram NFT (t.me/nft/Название-номер)<input class="field" type="url" name="prize_link_'+place+'" value="'+esc(prize.telegram_url||'')+'" placeholder="https://t.me/nft/PlushPepe-171"></label>'+
                    '<label>Загрузить PNG / WebP / GIF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" name="prize_image_'+place+'"></label>'+
                    (prize.image_url?'<label class="crafter-event-remove-image"><input type="checkbox" name="remove_prize_image_'+place+'" value="1"> Удалить загруженную картинку</label>':'')+
                '</div>';
            }).join('')}
            </div>
            <p class="crafter-event-save-state" role="status"></p>
            <div class="crafter-event-form-actions">
                <button class="primary" type="submit">Сохранить ивент</button>
                <button class="secondary" type="button" data-cancel>Отмена</button>
                ${item ? '<button class="secondary crafter-event-delete" type="button" data-delete>Удалить</button>' : ''}
            </div>
        </form>`;
    const form = editor.querySelector('form');
    form.querySelector('[data-cancel]').onclick = () => {editor.hidden=true;};
    form.querySelector('[data-open-studio-prizes]')?.addEventListener('click',()=>crafterOpenEventPrizes(item.id));
    form.addEventListener('submit', async submit => {
        submit.preventDefault();
        if (!form.reportValidity()) return;
        const start = Date.parse(form.elements.start_local.value);
        const end = Date.parse(form.elements.end_local.value);
        if (!Number.isFinite(start)||!Number.isFinite(end)||end<=start) {
            return toast('Проверьте даты события');
        }
        const body = new FormData(form);
        // Preserve all 100 prizes when editing the event's general details.
        // The quick editor handles the first three; the visual studio handles all ranks.
        const prizes=(event.prizes||[]).map(p=>({
            type:p.type||'none',label:p.label||'',telegram_url:p.telegram_url||'',
            collection:p.collection||'',model:p.model||''
        }));
        for(let place=1;place<=3;place++){
            const row=prizes[place-1]||{type:'none',label:'',telegram_url:'',collection:'',model:''};
            row.label=String(form.elements['prize_'+place]?.value||'').trim();
            row.telegram_url=String(form.elements['prize_link_'+place]?.value||'').trim();
            row.type=form.elements['prize_type_'+place]?.value||'none';
            row.collection=String(form.elements['prize_collection_'+place]?.value||'').trim();
            row.model=String(form.elements['prize_model_'+place]?.value||'').trim();
            if(row.type==='telegram'&&/^https:\/\/(?:t\.me|telegram\.me)\/nft\//i.test(row.telegram_url))
               row.type='telegram';
            prizes[place-1]=row;
        }
        body.set('prizes_json',JSON.stringify(prizes));
        body.set('start_at',String(Math.floor(start/1000)));
        body.set('end_at',String(Math.floor(end/1000)));
        body.delete('start_local');
        body.delete('end_local');
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        try {
            await api('admin/events'+(item?'/'+item.id:''),body);
            toast('Событие сохранено');
            await renderAdminEvents();
        } catch (error) {
            form.querySelector('.crafter-event-save-state').textContent = error.message;
            toast(error.message);
        } finally {
            if (button.isConnected) button.disabled = false;
        }
    });
    if (item) {
        form.querySelector('[data-delete]').onclick = async () => {
            if (!confirm('Удалить событие и изображения наград?')) return;
            const button = form.querySelector('[data-delete]');
            button.disabled=true;
            try {
                await api('admin/events/'+item.id+'/delete',{});
                toast('Событие удалено');
                await renderAdminEvents();
            } catch (error) {toast(error.message);}
            finally {if(button.isConnected)button.disabled=false;}
        };
    }
    editor.scrollIntoView({behavior:'smooth',block:'start'});
}
