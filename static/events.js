/* Public image-backed Crafter events and genuine leaderboards. */
const crafterEventStatus = {
    active:'ИДЁТ СЕЙЧАС',upcoming:'СКОРО',finished:'ЗАВЕРШЁН'
};

function crafterEventDate(seconds) {
    return new Date(Number(seconds)*1000).toLocaleDateString('ru-RU', {
        day:'numeric',month:'short',year:'numeric'
    });
}
function crafterEventPhoto(url) {
    return typeof url === 'string' && url.startsWith('/media/event/') ? esc(url) : '';
}
function crafterEventStyle(event) {
    return '--event-accent:'+esc(event.accent || '#9366dd');
}
function crafterEventCard(event) {
    return `<button type="button" class="crafter-event-card" style="${crafterEventStyle(event)}"
        onclick="openCrafterEvent('${esc(event.id)}')">
        <span class="crafter-event-cover"><img loading="lazy" src="${crafterEventPhoto(event.image_url)}" alt="">
            <span class="crafter-event-status">${crafterEventStatus[event.status] || ''}</span></span>
        <span class="crafter-event-caption"><strong>${esc(event.title)}</strong>
            <small>${esc(event.metric_label)} · ${crafterEventDate(event.start_at)} — ${crafterEventDate(event.end_at)}</small>
            <span class="crafter-event-view">Подробнее ›</span>
        </span></button>`;
}
async function renderEventsPage() {
    const main=document.querySelector('#main');
    if (!main || state.page !== 'events') return;
    main.innerHTML='<section class="crafter-events-page"><h1>Лидерборды и ивенты</h1><p class="sub">Загружаем события…</p></section>';
    try {
        const response=await api('events');
        if (state.page !== 'events') return;
        const events=response.events || [];
        main.innerHTML=`<section class="crafter-events-page">
            <div class="crafter-events-heading"><button type="button" onclick="go('games')" aria-label="Назад к играм">‹</button>
                <div><small>CRAFTER · EVENTS</small><h1>Лидерборды и ивенты</h1></div></div>
            <div class="crafter-events-grid">
                ${events.map(crafterEventCard).join('') || '<div class="crafter-events-empty">Пока нет опубликованных событий. Новые ивенты появятся здесь.</div>'}
            </div>
        </section>`;
    } catch(error) {
        if(state.page==='events') main.innerHTML='<section class="crafter-events-page"><p class="sub">'+esc(error.message)+'</p><button class="secondary" onclick="renderEventsPage()">Повторить</button></section>';
    }
}
async function openCrafterEvent(eventId, focusLeaderboard = false) {
    const main=document.querySelector('#main');
    if(!main || state.page!=='events')return;
    main.innerHTML='<section class="crafter-events-page"><p class="sub">Загружаем лидерборд…</p></section>';
    try {
        const {event,leaders}=await api('events/'+encodeURIComponent(eventId));
        if(state.page!=='events')return;
        const visible=event.show_leaderboard;
        main.innerHTML=`<section class="crafter-events-page crafter-event-detail" style="${crafterEventStyle(event)}">
            <button class="crafter-event-back" type="button" onclick="renderEventsPage()">‹ Все ивенты</button>
            <div class="crafter-event-hero">
                <img src="${crafterEventPhoto(event.image_url)}" alt="">
                <span class="crafter-event-status">${crafterEventStatus[event.status] || ''}</span>
            </div>
            <div class="crafter-event-title"><small>CRAFTER · EVENT</small><h1>${esc(event.title)}</h1>
                <p>${esc(event.description || '')}</p>
                <span>${crafterEventDate(event.start_at)} — ${crafterEventDate(event.end_at)}</span></div>
            <section class="crafter-event-section">
                <h2>Награды</h2>
                <div class="crafter-event-prizes">
                    ${event.prizes.filter(p=>p.label||p.image_url).map(prize=>`<div class="crafter-event-prize">
                        <span class="crafter-event-place">№${prize.place}</span>
                        ${prize.image_url ? `<img src="${crafterEventPhoto(prize.image_url)}" alt="">` : '<span class="crafter-event-prize-empty">★</span>'}
                        <strong>${esc(prize.label || 'Награда')}</strong>
                    </div>`).join('') || '<p class="sub">Награды появятся после объявления организатора.</p>'}
                </div>
            </section>
            <section class="crafter-event-section" id="crafter-event-ranking">
                <h2>${esc(event.metric_label)} <small>Топ игроков</small></h2>
                ${visible ? `<div class="crafter-event-leaderboard">
                    ${leaders.map(player=>`<div class="crafter-event-leader">
                        <span class="crafter-event-rank">${player.rank}</span>
                        <span class="crafter-event-avatar">
                            ${imageURL(player.photo_url) ? `<img loading="lazy" src="${esc(imageURL(player.photo_url))}" alt="">` : esc(Array.from(player.name || '?')[0].toUpperCase())}
                        </span>
                        <strong>${esc(player.name)}</strong>
                        <b>${esc(player.score)} <small>${esc(event.score_unit)}</small></b>
                    </div>`).join('') || '<p class="crafter-events-empty">Участников пока нет. Рейтинг появится после первых результатов.</p>'}
                    </div>` : '<p class="sub">Организатор пока скрыл рейтинг этого события.</p>'}
            </section>
        </section>`;
        if(focusLeaderboard){
            const ranking=main.querySelector('#crafter-event-ranking');
            if(ranking)requestAnimationFrame(()=>{
                if(state.page==='events'&&ranking.isConnected)
                    ranking.scrollIntoView({behavior:'smooth',block:'start'});
            });
        }
    } catch(error) {
        if(state.page==='events') main.innerHTML='<section class="crafter-events-page"><button class="crafter-event-back" onclick="renderEventsPage()">‹ Все ивенты</button><p>'+esc(error.message)+'</p></section>';
    }
}
