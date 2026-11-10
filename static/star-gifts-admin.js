/* Admin → Relayer: auto-withdrawal of ordinary Telegram gifts (paid from the relayer's Stars). */
(function () {
    const STATUS = {queued: 'Ожидает', sending: 'Отправка', review: 'Проверить вручную', confirmed: 'Отправлено', failed: 'Не выполнено'};
    const COLOR = {confirmed: 'is-good', failed: 'is-alert', review: 'is-alert', sending: '', queued: ''};

    function when(ts) {
        return ts ? new Date(ts * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
    }

    function panel(info) {
        const st = info.state || {};
        const gifts = st.gifts || {};
        const catalog = info.catalog || [];
        const counts = info.counts || {};
        const open = (counts.queued || 0) + (counts.sending || 0) + (counts.review || 0);
        const stars = st.stars === undefined ? '—' : String(st.stars) + ' ★';
        return `<section class="admin-glass-panel admin-purchase-mode" id="star-gifts-admin">
            <div>
                <h3>Автовывод подарков Telegram (Stars)</h3>
                <p>Обычные подарки (Bear, Rose, Cake…) выводятся так: игрок нажимает «Вывести», релейер сразу отправляет ему настоящий Telegram-подарок за Stars со своей подписью «${esc(info.message)}». Курс: 100 ★ = 1 GRAM. Автовывод выключен, пока вы его не включите. Если Stars не хватает, заявки ждут, пока вы пополните релейер.</p>
                <p>Релейер: <b>${info.relayer_connected ? 'подключён' : 'не подключён'}</b> · Баланс Stars: <b>${esc(stars)}</b>${st.checked ? ' <small>(проверено ' + when(st.checked) + ')</small>' : ''} · Заявок в работе: <b>${open}</b></p>
                ${st.error ? '<p class="admin-mode-missing">' + esc(st.error) + '</p>' : ''}
                ${catalog.length ? '<p>Каталог: ' + catalog.map(i => (i.synced ? '✅ ' : '⚠️ ') + esc(i.emoji + ' ' + i.name + ' · ' + i.stars + '★ = ' + i.price + ' GRAM · ID ' + (i.telegram_gift_id || 'не загружен'))).join('<br>') + '</p>' : ''}
                ${st.pngs !== undefined ? '<p>PNG-картинок загружено из Telegram: <b>' + st.pngs + '</b> из ' + catalog.length + '. Остальные показываются встроенными иконками.</p>' : ''}
            </div>
            <span class="admin-pill ${info.enabled ? 'is-good' : 'is-alert'}">${info.enabled ? 'Автовывод включён' : 'Автовывод выключен'}</span>
            <div class="admin-glass-action-grid">
                <button type="button" onclick="starGiftsAdmin('toggle', ${!info.enabled})">${info.enabled ? 'Выключить' : 'Включить'}</button>
                <button type="button" onclick="starGiftsAdmin('check')">Проверить и загрузить из Telegram (ID, цены, PNG)</button>
                ${info.enabled ? '<button type="button" onclick="starGiftsAdmin(\'run\')">Обработать очередь сейчас</button>' : ''}
            </div>
            <form class="admin-glass-action-grid" id="star-grant-form" style="margin-top:14px;align-items:end">
                <label>Выдать подарок игроку (Telegram ID)<input name="user_id" inputmode="numeric" placeholder="123456789" required></label>
                <label>Подарок<select name="key">${(catalog || []).map(i => '<option value="' + esc(i.key) + '">' + esc(i.emoji + ' ' + i.name + ' — ' + i.stars + '★') + '</option>').join('')}</select></label>
                <label>Количество<input name="count" type="number" min="1" max="50" value="1"></label>
                <button type="submit">Выдать</button>
            </form>
            ${info.jobs.length ? `<div class="star-gifts-jobs" style="margin-top:14px;display:grid;gap:8px">${info.jobs.map(job => `
                <div class="admin-user-fact" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                    <strong>${esc((job.emoji || '') + ' ' + (job.gift_name || '') + ' ' + (job.stars || '') + '★')}</strong>
                    <span>${esc(job.name || job.user_id)}${job.username ? ' @' + esc(job.username) : ''}</span>
                    <span class="admin-pill ${COLOR[job.status] || ''}">${esc(STATUS[job.status] || job.status)}</span>
                    <small>${when(job.created)}${job.note ? ' · ' + esc(job.note) : ''}</small>
                    ${['queued', 'review', 'sending'].includes(job.status) ? `<span style="margin-left:auto;display:flex;gap:6px">
                        <button type="button" onclick="starGiftsAdmin('resolve', ${arg(job.id)}, 'confirmed')">Отправлено вручную</button>
                        <button type="button" onclick="starGiftsAdmin('resolve', ${arg(job.id)}, 'failed')">Вернуть игроку</button></span>` : ''}
                </div>`).join('')}</div>` : '<p style="margin-top:12px">Заявок на вывод пока нет.</p>'}
        </section>`;
    }

    async function paint(content) {
        let info;
        try { info = await api('admin/star-gifts'); } catch (error) { return; }
        if (!content.isConnected) return;
        content.querySelector('#star-gifts-admin')?.remove();
        content.insertAdjacentHTML('afterbegin', panel(info));
        content.querySelector('#star-grant-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            const f = Object.fromEntries(new FormData(event.target));
            try { await api('admin/star-gifts/grant', {user_id: f.user_id, key: f.key, count: f.count}); toast('Подарок выдан'); event.target.reset(); }
            catch (error) { toast(error.message); }
        });
    }

    window.starGiftsAdmin = async function (action, a, b) {
        const content = document.querySelector('#admin-content');
        try {
            if (action === 'toggle') {
                if (!confirm((a ? 'Включить' : 'Выключить') + ' автовывод подарков Telegram за Stars?')) return;
                await api('admin/star-gifts', {enabled: a, confirm: 'SET_STAR_GIFTS'});
                toast('Автовывод подарков: ' + (a ? 'включён' : 'выключен'));
            } else if (action === 'check') {
                toast('Подключаемся к Telegram…');
                await api('admin/star-gifts/check', {});
            } else if (action === 'run') {
                await api('admin/star-gifts/run', {});
                toast('Очередь обработана');
            } else if (action === 'resolve') {
                if (!confirm(b === 'confirmed' ? 'Подарок отправлен игроку вручную? Он будет списан из инвентаря.' : 'Вернуть подарок игроку в инвентарь?')) return;
                await api('admin/star-gifts/' + a + '/resolve', {decision: b, note: 'решение администратора'});
            }
        } catch (error) { toast(error.message); }
        if (content) await paint(content);
    };

    // Shared by the reward editors (promo codes, advent, shop, community goals).
    let catalogCache = null;
    window.crafterStarGifts = {
        async catalog() {
            if (!catalogCache) { try { catalogCache = (await api('star-gifts/catalog')).gifts || []; } catch (e) { catalogCache = []; } }
            return catalogCache;
        },
        options(list, selected) {
            return (list || []).map(i => '<option value="' + esc(i.key) + '"' + (i.key === selected ? ' selected' : '') + '>' + esc(i.emoji + ' ' + i.name + ' — ' + i.stars + '★ = ' + i.price + ' GRAM') + '</option>').join('');
        },
    };

    if (typeof adminSections === 'object' && adminSections.relayer) {
        const original = adminSections.relayer.render;
        adminSections.relayer.render = async function (content) {
            const target = content || document.querySelector('#admin-content');
            await original(target);
            if (target) await paint(target);
        };
    }
})();
