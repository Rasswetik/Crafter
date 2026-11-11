/* Administrators: creators applications ("Заявки по видео"): statuses and the support chat. */
let creatorsTab = '';
const creatorStatusClass = {new: 'is-new', review: 'is-new', need_info: 'is-warn', approved: 'is-ok', paid: 'is-ok', rejected: 'is-bad'};
function creatorWhen(ts) { return new Date(Number(ts) * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}); }
function creatorAuthHeaders() {
    const h = {};
    const init = typeof telegramInitData === 'function' ? telegramInitData() : '';
    if (init) h['X-Telegram-Init-Data'] = init;
    else if (typeof crafterWebSession === 'function' && crafterWebSession()) h['X-Crafter-Web-Session'] = crafterWebSession();
    return h;
}
async function renderAdminCreators(content = document.querySelector('#admin-content')) {
    const data = await api('admin/creators/apps' + (creatorsTab ? '?status=' + creatorsTab : ''));
    if (!content?.isConnected) return;
    const labels = data.statuses, counts = data.counts;
    const tabs = [['', 'Все']].concat(Object.keys(labels).map(k => [k, labels[k]]));
    const rows = data.applications.map(a =>
        '<button type="button" class="ny-admin-row cr-row" data-n="' + a.number + '"><div><b>№' + a.number + ' · ' + esc(a.platform_name) + ' · ' + (a.tg_username ? '@' + esc(a.tg_username) : 'ID ' + a.user_id) + '</b>' +
        '<small>' + esc(a.video_url) + '</small><small>' + creatorWhen(a.created) + (a.amount ? ' · ' + esc(a.amount) + ' $' : '') + '</small></div>' +
        '<span class="cr-pill ' + (creatorStatusClass[a.status] || '') + '">' + esc(a.status_text) + (a.waiting_reply ? ' · ждёт ответа' : '') + '</span></button>').join('');
    content.innerHTML = '<section class="ny-admin-section"><h3>Заявки по видео</h3><p class="sub">Заявки авторов роликов на выплату. Откройте заявку, посмотрите запись экрана, смените статус и ответьте в чате: игрок получит сообщение в боте.</p>' +
        '<div class="cr-tabs">' + tabs.map(([k, v]) => '<button type="button" class="cr-tab' + (k === creatorsTab ? ' is-on' : '') + '" data-tab="' + k + '">' + esc(v) + (k ? ' <i>' + (counts[k] || 0) + '</i>' : '') + '</button>').join('') + '</div>' +
        '<div class="ny-admin-list">' + (rows || '<p class="sub">Заявок нет.</p>') + '</div></section>';
    content.querySelectorAll('.cr-tab').forEach(b => b.addEventListener('click', () => { creatorsTab = b.dataset.tab; renderAdminCreators(content); }));
    content.querySelectorAll('.cr-row').forEach(b => b.addEventListener('click', () => openAdminCreatorApp(Number(b.dataset.n), content)));
}
async function openAdminCreatorApp(number, content) {
    let timer = null;
    const draw = async first => {
        const d = await api('admin/creators/apps/' + number);
        if (!content.isConnected) { clearInterval(timer); return; }
        const a = d.application;
        const msgs = d.messages.map(m => '<div class="cr-msg ' + (m.author === 'user' ? 'is-user' : 'is-support') + '"><div class="b">' + esc(m.text) + '</div><small>' + (m.author === 'user' ? (a.tg_username ? '@' + esc(a.tg_username) : 'Игрок') : 'Поддержка') + ' · ' + creatorWhen(m.created) + '</small></div>').join('');
        if (!first) { const log = content.querySelector('#cr-log'); if (log) { const bottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.innerHTML = msgs; if (bottom) log.scrollTop = 1e9; } return; }
        content.innerHTML = '<section class="ny-admin-section"><button type="button" class="secondary" id="cr-back">← К списку</button>' +
            '<h3>Заявка №' + a.number + ' · ' + esc(a.platform_name) + '</h3>' +
            '<div class="cr-info"><p><b>Игрок:</b> ' + (a.tg_username ? '@' + esc(a.tg_username) : '') + ' · ID ' + a.user_id + '</p><p><b>Ролик:</b> <a href="' + esc(a.video_url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.video_url) + '</a></p>' +
            '<p><b>Кошелёк (Gram):</b> <code id="cr-wallet">' + esc(a.wallet) + '</code> <button type="button" class="secondary" id="cr-copy">Копировать</button></p><p><b>Подана:</b> ' + creatorWhen(a.created) + '</p>' +
            (a.has_record ? '<p><button type="button" class="secondary" id="cr-rec">Скачать запись экрана</button></p>' : '<p>Записи экрана нет.</p>') + '</div>' +
            '<h3>Решение</h3><form id="cr-status" class="ny-admin-fields"><label>Статус<select name="status" class="field">' + Object.keys(d.statuses).map(k => '<option value="' + k + '"' + (k === a.status ? ' selected' : '') + '>' + esc(d.statuses[k]) + '</option>').join('') + '</select></label>' +
            '<label>Просмотры на момент заявки<input name="views" type="number" min="0" step="1" value="' + a.views + '"></label><label>Сумма к выплате, $<input name="amount" maxlength="12" placeholder="12,50" value="' + esc(a.amount) + '"></label>' +
            '<label class="full">Заметка (видна только администраторам)<input name="note" maxlength="500" value="' + esc(a.admin_note) + '"></label><button type="submit" class="primary full">Сохранить статус</button></form>' +
            '<h3>Чат с игроком</h3><div class="cr-log" id="cr-log">' + msgs + '</div><form id="cr-send" class="cr-send"><input name="text" maxlength="1500" placeholder="Сообщение игроку (придёт в бота)" autocomplete="off"><button type="submit" class="primary">Отправить</button></form></section>';
        content.querySelector('#cr-log').scrollTop = 1e9;
        content.querySelector('#cr-back').addEventListener('click', () => { clearInterval(timer); renderAdminCreators(content); });
        content.querySelector('#cr-copy').addEventListener('click', () => { navigator.clipboard?.writeText(a.wallet); toast('Адрес скопирован'); });
        content.querySelector('#cr-rec')?.addEventListener('click', async ev => {
            ev.target.disabled = true; ev.target.textContent = 'Загрузка…';
            try {
                const r = await fetch('/api/admin/creators/apps/' + number + '/record', {headers: creatorAuthHeaders()});
                if (!r.ok) throw new Error('Не удалось получить запись');
                const blob = await r.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
                link.href = url; link.download = 'creator-' + number + '.mp4'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch (e) { toast(e.message); }
            ev.target.disabled = false; ev.target.textContent = 'Скачать запись экрана';
        });
        content.querySelector('#cr-status').addEventListener('submit', async ev => {
            ev.preventDefault(); const f = new FormData(ev.target);
            try { await api('admin/creators/apps/' + number + '/status', {status: f.get('status'), views: Number(f.get('views') || 0), amount: f.get('amount'), note: f.get('note')}); toast('Статус сохранён'); draw(false); } catch (e) { toast(e.message); }
        });
        content.querySelector('#cr-send').addEventListener('submit', async ev => {
            ev.preventDefault(); const input = ev.target.elements.text, text = input.value.trim(); if (!text) return; input.value = '';
            try { await api('admin/creators/apps/' + number + '/message', {text}); draw(false); } catch (e) { input.value = text; toast(e.message); }
        });
    };
    await draw(true);
    timer = setInterval(() => { if (!content.isConnected) clearInterval(timer); else if (!document.hidden) draw(false).catch(() => {}); }, 8000);
}
