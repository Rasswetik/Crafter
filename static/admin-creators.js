/* Administrators: creators applications ("Заявки по видео"): a list, a decision panel with a status picker and a support chat. */
let creatorsTab = '', creatorsQuery = '';
const CR_COLORS = {new: '#5aa9ff', review: '#8cc0ff', need_info: '#ffd36b', approved: '#4fd37a', paid: '#4fd37a', rejected: '#ff7a7a'};
const CR_QUICK = ['Приняли заявку в работу', 'Пришлите запись экрана со всей статистикой', 'Вставка не соответствует условиям', 'Выплата отправлена на ваш кошелёк'];
const crSvg = (path, cls) => '<svg class="' + (cls || "cra-ic") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
const CR_ICONS = {
    back: crSvg('<path d="M15 5l-7 7 7 7"/>'), link: crSvg('<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
    copy: crSvg('<rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'), down: crSvg('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'),
    send: '<svg class="cra-ic" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 11.3 20 4.1c.9-.4 1.8.5 1.4 1.4l-7.2 16.6c-.4.9-1.7.9-2 0l-2-5.8-5.8-2c-.9-.3-.9-1.6 0-2Z"/></svg>',
    check: crSvg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), search: crSvg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    user: crSvg('<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4.5-6 8-6s7 2 8 6"/>'), wallet: crSvg('<path d="M4 7a2 2 0 0 1 2-2h11v4"/><rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="16.5" cy="13.5" r="1.2" fill="currentColor"/>'),
    clock: crSvg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
};
const CR_TT = '<svg viewBox="0 0 48 48"><g transform="translate(-1.6 1.2)"><path fill="#25f4ee" d="M33 8c.6 3.9 2.9 6.3 6.7 6.7v5.2c-2.5 0-4.8-.7-6.7-2V30c0 6.2-4.4 10.4-10.2 10.4-5.7 0-10.1-4.2-10.1-9.9S17.2 21 22.8 21c.5 0 1 0 1.6.1v5.5c-.5-.2-1-.3-1.6-.3-2.5 0-4.4 1.8-4.4 4.2s1.9 4.2 4.3 4.2c2.7 0 4.4-1.9 4.4-4.9V8H33z"/></g><g transform="translate(1.6 -1.2)"><path fill="#fe2c55" d="M33 8c.6 3.9 2.9 6.3 6.7 6.7v5.2c-2.5 0-4.8-.7-6.7-2V30c0 6.2-4.4 10.4-10.2 10.4-5.7 0-10.1-4.2-10.1-9.9S17.2 21 22.8 21c.5 0 1 0 1.6.1v5.5c-.5-.2-1-.3-1.6-.3-2.5 0-4.4 1.8-4.4 4.2s1.9 4.2 4.3 4.2c2.7 0 4.4-1.9 4.4-4.9V8H33z"/></g><path fill="#fff" d="M33 8c.6 3.9 2.9 6.3 6.7 6.7v5.2c-2.5 0-4.8-.7-6.7-2V30c0 6.2-4.4 10.4-10.2 10.4-5.7 0-10.1-4.2-10.1-9.9S17.2 21 22.8 21c.5 0 1 0 1.6.1v5.5c-.5-.2-1-.3-1.6-.3-2.5 0-4.4 1.8-4.4 4.2s1.9 4.2 4.3 4.2c2.7 0 4.4-1.9 4.4-4.9V8H33z"/></svg>';
function creatorWhen(ts) { return new Date(Number(ts) * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}); }
function creatorAgo(ts) {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
    if (s < 60) return 'только что'; if (s < 3600) return Math.floor(s / 60) + ' мин назад'; if (s < 86400) return Math.floor(s / 3600) + ' ч назад'; return Math.floor(s / 86400) + ' дн назад';
}
function creatorAuthHeaders() {
    const h = {};
    const init = typeof telegramInitData === 'function' ? telegramInitData() : '';
    if (init) h['X-Telegram-Init-Data'] = init;
    else if (typeof crafterWebSession === 'function' && crafterWebSession()) h['X-Crafter-Web-Session'] = crafterWebSession();
    return h;
}

/* ---------------- the list ---------------- */
async function renderAdminCreators(content = document.querySelector('#admin-content')) {
    const data = await api('admin/creators/apps' + (creatorsTab ? '?status=' + creatorsTab : ''));
    if (!content?.isConnected) return;
    const labels = data.statuses, counts = data.counts, total = Object.values(counts).reduce((a, b) => a + b, 0);
    const tabs = [['', 'Все', total]].concat(Object.keys(labels).map(k => [k, labels[k], counts[k] || 0]));
    content.innerHTML = '<section class="cra"><div class="cra-head"><h3>Заявки по видео</h3><p>Выплаты авторам роликов. Откройте заявку, посмотрите запись, смените статус и ответьте игроку: сообщение придёт ему в бота.</p></div>' +
        '<div class="cra-tabs">' + tabs.map(([k, v, n]) => '<button type="button" class="cra-tab' + (k === creatorsTab ? ' is-on' : '') + '" data-tab="' + k + '">' + (k ? '<i style="background:' + CR_COLORS[k] + '"></i>' : '') + creatorEsc(v) + '<b>' + n + '</b></button>').join('') + '</div>' +
        '<label class="cra-search">' + CR_ICONS.search + '<input id="cra-q" type="search" placeholder="Поиск: номер, @юзернейм, ссылка" value="' + creatorEsc(creatorsQuery) + '" autocomplete="off"></label>' +
        '<div class="cra-list" id="cra-list"></div></section>';
    const draw = () => {
        const q = creatorsQuery.trim().toLowerCase().replace(/^@/, '');
        const rows = data.applications.filter(a => !q || String(a.number).includes(q) || (a.tg_username || '').toLowerCase().includes(q) || a.video_url.toLowerCase().includes(q) || String(a.user_id).includes(q));
        content.querySelector('#cra-list').innerHTML = rows.length ? rows.map((a, i) =>
            '<button type="button" class="cra-row" data-n="' + a.number + '" style="animation-delay:' + Math.min(i, 12) * 28 + 'ms"><span class="cra-av">' + CR_TT + '</span>' +
            '<span class="cra-mid"><b>№' + a.number + ' · ' + (a.tg_username ? '@' + creatorEsc(a.tg_username) : 'ID ' + a.user_id) + (a.waiting_reply ? ' <em class="cra-wait" title="Ждёт ответа"></em>' : '') + '</b>' +
            '<small>' + creatorEsc(a.video_url) + '</small><small>' + creatorAgo(a.created) + (a.amount ? ' · ' + creatorEsc(a.amount) + ' $' : '') + '</small></span>' +
            '<span class="cra-pill" style="--c:' + (CR_COLORS[a.status] || '#aaa') + '">' + creatorEsc(a.status_text) + '</span></button>').join('') : '<p class="cra-empty">Заявок нет.</p>';
        content.querySelectorAll('.cra-row').forEach(b => b.addEventListener('click', () => openAdminCreatorApp(Number(b.dataset.n), content)));
    };
    draw();
    content.querySelectorAll('.cra-tab').forEach(b => b.addEventListener('click', () => { creatorsTab = b.dataset.tab; renderAdminCreators(content); }));
    content.querySelector('#cra-q').addEventListener('input', ev => { creatorsQuery = ev.target.value; draw(); });
}
function creatorEsc(s) { return typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])); }

/* ---------------- one application ---------------- */
async function openAdminCreatorApp(number, content) {
    let timer = null, picked = null, lastCount = 0;
    const stop = () => clearInterval(timer);
    const bubbles = (msgs, a) => msgs.map((m, i) => {
        const mine = m.author !== 'user';
        return '<div class="cra-msg ' + (mine ? 'is-me' : 'is-user') + '"' + (i >= lastCount ? ' data-new="1"' : '') + '>' + (mine ? '' : '<span class="cra-ava">' + creatorEsc((a.tg_username || 'И')[0].toUpperCase()) + '</span>') +
            '<div><div class="b">' + creatorEsc(m.text) + '</div><small>' + (mine ? 'Поддержка' : (a.tg_username ? '@' + creatorEsc(a.tg_username) : 'Игрок')) + ' · ' + creatorWhen(m.created) + '</small></div></div>';
    }).join('');
    const draw = async first => {
        const d = await api('admin/creators/apps/' + number);
        if (!content.isConnected) { stop(); return; }
        const a = d.application, html = bubbles(d.messages, a);
        if (!first) {
            const log = content.querySelector('#cra-log');
            if (log && d.messages.length !== lastCount) { const bottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90; log.innerHTML = html; if (bottom) log.scrollTop = log.scrollHeight; }
            lastCount = d.messages.length;
            const pill = content.querySelector('#cra-top-pill'); if (pill) { pill.textContent = a.status_text; pill.style.setProperty('--c', CR_COLORS[a.status] || '#aaa'); }
            return;
        }
        picked = a.status; lastCount = d.messages.length;
        content.innerHTML = '<section class="cra cra-detail">' +
            '<div class="cra-bar"><button type="button" class="cra-back" id="cra-back" aria-label="К списку">' + CR_ICONS.back + '</button><div><h3>Заявка №' + a.number + '</h3><small>' + creatorWhen(a.created) + ' · ' + creatorEsc(a.platform_name) + '</small></div><span class="cra-pill" id="cra-top-pill" style="--c:' + (CR_COLORS[a.status] || '#aaa') + '">' + creatorEsc(a.status_text) + '</span></div>' +
            '<div class="cra-facts">' +
            '<div class="cra-fact">' + CR_ICONS.user + '<div><small>Игрок</small><b>' + (a.tg_username ? '@' + creatorEsc(a.tg_username) : '—') + '</b><span>ID ' + a.user_id + '</span></div></div>' +
            '<a class="cra-fact is-link" href="' + creatorEsc(a.video_url) + '" target="_blank" rel="noopener noreferrer">' + CR_ICONS.link + '<div><small>Ролик</small><b>Открыть в TikTok</b><span>' + creatorEsc(a.video_url.replace(/^https?:\/\/(www\.)?/, '')) + '</span></div></a>' +
            '<button type="button" class="cra-fact is-link" id="cra-copy">' + CR_ICONS.wallet + '<div><small>Кошелёк (Gram)</small><b id="cra-copy-t">Копировать адрес</b><span>' + creatorEsc(a.wallet.slice(0, 10) + '…' + a.wallet.slice(-8)) + '</span></div></button>' +
            (a.has_record ? '<button type="button" class="cra-fact is-link" id="cra-rec">' + CR_ICONS.down + '<div><small>Запись экрана</small><b id="cra-rec-t">Скачать</b><span>Статистика и аккаунт</span></div></button>' : '<div class="cra-fact">' + CR_ICONS.down + '<div><small>Запись экрана</small><b>Нет файла</b></div></div>') + '</div>' +
            '<div class="cra-card"><h4>Решение</h4><div class="cra-pick" id="cra-pick">' + Object.keys(d.statuses).map(k => '<button type="button" class="cra-opt' + (k === a.status ? ' is-on' : '') + '" data-s="' + k + '" style="--c:' + CR_COLORS[k] + '"><i></i>' + creatorEsc(d.statuses[k]) + '</button>').join('') + '</div>' +
            '<div class="cra-fields"><label><span>Просмотры на момент заявки</span><input id="cra-views" type="number" min="0" step="1" inputmode="numeric" value="' + a.views + '"></label>' +
            '<label><span>Сумма к выплате</span><div class="cra-money"><input id="cra-amount" maxlength="12" inputmode="decimal" placeholder="0,00" value="' + creatorEsc(a.amount) + '"><b>$</b></div></label></div>' +
            '<label class="cra-note"><span>Заметка (видна только администраторам)</span><input id="cra-note" maxlength="500" value="' + creatorEsc(a.admin_note) + '" placeholder="Например: проверено, статистика сходится"></label>' +
            '<button type="button" class="cra-save" id="cra-save"><span class="lbl">Сохранить решение</span></button></div>' +
            '<div class="cra-card cra-chat"><h4>Чат с игроком</h4><div class="cra-log" id="cra-log">' + html + '</div>' +
            '<div class="cra-quick" id="cra-quick">' + CR_QUICK.map(q => '<button type="button">' + creatorEsc(q) + '</button>').join('') + '</div>' +
            '<form class="cra-send" id="cra-send"><input name="text" maxlength="1500" placeholder="Сообщение игроку" autocomplete="off"><button type="submit" aria-label="Отправить">' + CR_ICONS.send + '</button></form></div></section>';
        const q = sel => content.querySelector(sel);
        q('#cra-log').scrollTop = q('#cra-log').scrollHeight;
        q('#cra-back').addEventListener('click', () => { stop(); renderAdminCreators(content); });
        q('#cra-pick').querySelectorAll('.cra-opt').forEach(b => b.addEventListener('click', () => { picked = b.dataset.s; q('#cra-pick').querySelectorAll('.cra-opt').forEach(x => x.classList.toggle('is-on', x === b)); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }));
        q('#cra-copy').addEventListener('click', () => { navigator.clipboard?.writeText(a.wallet); const t = q('#cra-copy-t'); t.textContent = 'Скопировано'; q('#cra-copy').classList.add('is-done'); setTimeout(() => { t.textContent = 'Копировать адрес'; q('#cra-copy').classList.remove('is-done'); }, 1600); });
        q('#cra-rec')?.addEventListener('click', async () => {
            const t = q('#cra-rec-t'); t.textContent = 'Загрузка…';
            try {
                const r = await fetch('/api/admin/creators/apps/' + number + '/record', {headers: creatorAuthHeaders()});
                if (!r.ok) throw new Error('Не удалось получить запись');
                const blob = await r.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
                link.href = url; link.download = 'creator-' + number + '.mp4'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); t.textContent = 'Готово';
            } catch (e) { t.textContent = 'Ошибка'; toast(e.message); }
            setTimeout(() => { t.textContent = 'Скачать'; }, 2200);
        });
        q('#cra-save').addEventListener('click', async ev => {
            const btn = ev.currentTarget, lbl = btn.querySelector('.lbl'); btn.disabled = true; btn.classList.add('is-busy'); lbl.textContent = 'Сохраняем…';
            try {
                await api('admin/creators/apps/' + number + '/status', {status: picked, views: Number(q('#cra-views').value || 0), amount: q('#cra-amount').value.trim(), note: q('#cra-note').value.trim()});
                btn.classList.remove('is-busy'); btn.classList.add('is-ok'); lbl.innerHTML = CR_ICONS.check + 'Сохранено, игрок уведомлён';
                setTimeout(() => { btn.classList.remove('is-ok'); btn.disabled = false; lbl.textContent = 'Сохранить решение'; }, 2000); draw(false);
            } catch (e) { btn.classList.remove('is-busy'); btn.disabled = false; lbl.textContent = 'Сохранить решение'; toast(e.message); }
        });
        const input = q('#cra-send input');
        q('#cra-quick').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { input.value = b.textContent; input.focus(); }));
        q('#cra-send').addEventListener('submit', async ev => {
            ev.preventDefault(); const text = input.value.trim(); if (!text) return; input.value = ''; const sendBtn = ev.currentTarget.querySelector('button'); sendBtn.disabled = true;
            try { await api('admin/creators/apps/' + number + '/message', {text}); lastCount = 0; await draw(false); const log = q('#cra-log'); log.scrollTop = log.scrollHeight; } catch (e) { input.value = text; toast(e.message); }
            sendBtn.disabled = false;
        });
    };
    await draw(true);
    timer = setInterval(() => { if (!content.isConnected) stop(); else if (!document.hidden) draw(false).catch(() => {}); }, 8000);
}
