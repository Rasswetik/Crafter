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
async function renderAdminEvents(content = document.querySelector('#admin-content')) {
    const data = await api('admin/events');
    if (!content || !content.isConnected) return;
    crafterAdminEvents = data;
    const status = {active:'Идёт',upcoming:'Скоро',finished:'Завершён'};
    content.innerHTML = `<div class="crafter-events-admin">
        <section class="panel">
            <h3>Лидерборды и ивенты</h3>
            <p class="sub">Создавайте события с PNG-обложками и изображениями наград. Укажите сроки, цвет, показатель топа и видимость. Результаты строятся по реальным операциям Crafter.</p>
            <button type="button" class="primary crafter-event-add" data-new>+ Создать ивент</button>
        </section>
        <section class="panel">
            <h3>События <small>${data.events.length}</small></h3>
            <div class="crafter-admin-event-list">
                ${data.events.map(item => `<article class="crafter-admin-event-card">
                    <img class="crafter-admin-event-cover" src="${esc(item.image_url)}" loading="lazy" alt="">
                    <div class="crafter-admin-event-info">
                        <strong>${esc(item.title)}</strong>
                        <span>${esc(item.metric_label)} · ${crafterEventAdminDate(item.start_at)} – ${crafterEventAdminDate(item.end_at)}</span>
                        <small>${item.enabled ? status[item.status] : 'Скрыто'} · ${item.show_leaderboard ? 'Рейтинг включён' : 'Рейтинг скрыт'}</small>
                    </div>
                    <button type="button" class="secondary" data-edit="${esc(item.id)}">Изменить</button>
                </article>`).join('') || '<p class="sub">Пока нет событий. Создайте первое, чтобы оно появилось в разделе «Игры».</p>'}
            </div>
        </section>
        <section class="panel crafter-event-editor" data-event-editor hidden></section>
    </div>`;
    content.querySelector('[data-new]').onclick = () => crafterEditEvent(null);
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
            <label>Обложка события (PNG, WebP или JPEG до 5 МБ)
                <input type="file" name="image" accept="image/png,image/jpeg,image/webp" ${item ? '' : 'required'}>
            </label>
            ${item ? `<img class="crafter-event-admin-hero" src="${esc(event.image_url)}" alt="">` : ''}
            <label>Название<input class="field" name="title" maxlength="90" required value="${esc(event.title)}"></label>
            <label>Приветствие и описание (до 700 символов)
                <textarea class="field" name="description" rows="3" maxlength="700" placeholder="Описание события и правила участия">${esc(event.description)}</textarea>
            </label>
            <div class="crafter-event-form-grid">
                <label>Показатель рейтинга<select class="field" name="metric">
                    ${crafterAdminEvents.metrics.map(metric => `<option value="${esc(metric.value)}" ${metric.value===event.metric?'selected':''}>${esc(metric.label)}</option>`).join('')}
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
            <h4>Награды и изображения для мест 1–3</h4>
            <p class="sub">Награды здесь отображаются визуально. Выдача GRAM/NFT выполняется отдельно, автоматически ничего не списывается.</p>
            <div class="crafter-event-prize-grid">
            ${[1,2,3].map(place => {
                const prize = event.prizes[place-1] || {};
                return `<div class="crafter-event-prize-edit">
                    <strong>Место №${place}</strong>
                    ${prize.image_url ? `<img src="${esc(prize.image_url)}" alt="Награда ${place}">` : '<div class="crafter-event-image-empty">PNG награды</div>'}
                    <label>Награда<input class="field" name="prize_${place}" maxlength="120" value="${esc(prize.label || '')}" placeholder="Например, NFT или 100 GRAM"></label>
                    <label>PNG награды<input type="file" accept="image/png,image/jpeg,image/webp" name="prize_image_${place}"></label>
                    ${prize.image_url ? `<label class="crafter-event-remove-image"><input type="checkbox" name="remove_prize_image_${place}" value="1"> Убрать изображение</label>` : ''}
                </div>`;
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
    form.addEventListener('submit', async submit => {
        submit.preventDefault();
        if (!form.reportValidity()) return;
        const start = Date.parse(form.elements.start_local.value);
        const end = Date.parse(form.elements.end_local.value);
        if (!Number.isFinite(start)||!Number.isFinite(end)||end<=start) {
            return toast('Проверьте даты события');
        }
        const body = new FormData(form);
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
