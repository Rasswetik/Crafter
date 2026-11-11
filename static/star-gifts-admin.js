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
                ${(info.report || []).length ? '<ul class="sg-report">' + info.report.map(x => '<li class="' + (x.ok ? 'is-ok' : 'is-no') + '"><i></i>' + esc(x.text) + '</li>').join('') + '</ul>' : ''}
                ${catalog.length ? '<div class="sg-catalog">' + catalog.map(i => '<div class="sg-item' + (i.synced ? '' : ' is-missing') + '"><img src="' + esc(i.image) + '" alt=""><b>' + esc(i.name) + '</b><small>' + i.stars + ' ★ · ' + esc(i.price) + ' GRAM</small><small>' + (i.telegram_gift_id ? 'ID ' + esc(i.telegram_gift_id) : 'не загружен') + '</small></div>').join('') + '</div>' : ''}
                            </div>
            <span class="admin-pill ${info.enabled ? 'is-good' : 'is-alert'}">${info.enabled ? 'Автовывод включён' : 'Автовывод выключен'}</span>
            <div class="admin-glass-action-grid">
                <button type="button" onclick="starGiftsAdmin('toggle', ${!info.enabled})">${info.enabled ? 'Выключить' : 'Включить'}</button>
                <button type="button" onclick="starGiftsAdmin('network')">Проверить доступ сервера к Telegram</button>
                <button type="button" onclick="starGiftsAdmin('check')">Проверить и загрузить из Telegram (ID, цены, PNG)</button>
                ${info.enabled ? '<button type="button" onclick="starGiftsAdmin(\'run\')">Обработать очередь сейчас</button>' : ''}
            </div>
            <form class="sg-grant" id="star-grant-form">
                <label><span>Выдать игроку (Telegram ID)</span><input name="user_id" inputmode="numeric" placeholder="123456789" required></label>
                <label><span>Подарок</span><select name="key">${(catalog || []).map(i => '<option value="' + esc(i.key) + '">' + esc(i.name + ' — ' + i.stars + '★') + '</option>').join('')}</select></label>
                <label><span>Количество</span><input name="count" type="number" min="1" max="50" value="1"></label>
                <button type="submit">Выдать</button>
            </form>
            ${info.jobs.length ? `<div class="star-gifts-jobs" style="margin-top:14px;display:grid;gap:8px">${info.jobs.map(job => `
                <div class="admin-user-fact" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                    <img src="${esc(job.image || '')}" alt="" style="width:38px;height:38px;object-fit:contain"><strong>${esc((job.gift_name || '') + ' · ' + (job.stars || '') + ' ★')}</strong>
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
            } else if (action === 'network') {
                const net = await api('admin/star-gifts/network', {});
                alert(net.report.map(x => (x.ok ? 'OK   ' : 'НЕТ  ') + x.text).join(String.fromCharCode(10)));
                return;
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
            return (list || []).map(i => '<option value="' + esc(i.key) + '"' + (i.key === selected ? ' selected' : '') + '>' + esc(i.name + ' — ' + i.stars + '★ = ' + i.price + ' GRAM') + '</option>').join('');
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

/* Admin → player → "Выдача": ordinary gifts and packs go straight to the inventory, an NFT only by its link. */
window.adminRenderGrant = async function (uid) {
    const box = document.querySelector('#admin-grant-box');
    if (!box) return;
    const stars = await (window.crafterStarGifts ? window.crafterStarGifts.catalog() : Promise.resolve([]));
    let packs = [];
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    if (!box.isConnected) return;
    const done = async (fn, ok) => { try { await fn(); toast(ok); } catch (error) { toast(error.message); } };
    box.innerHTML = `<h3>Выдача</h3>
        <p class="admin-small-warning">Обычные подарки и паки выдаются сразу. NFT выдаётся только по ссылке и только если он лежит на релейере или в инвентаре Thermos; иначе выдача отклоняется.</p>
        <div class="grant-block"><b>Обычный подарок Telegram</b>
            <div class="grant-row"><select class="field" id="grant-star">${(stars || []).map(i => '<option value="' + esc(i.key) + '">' + esc(i.name + ' — ' + i.stars + '★ = ' + i.price + ' GRAM') + '</option>').join('')}</select>
            <input class="field grant-count" id="grant-star-count" type="number" min="1" max="50" value="1" aria-label="Количество">
            <button type="button" id="grant-star-go">Выдать</button></div></div>
        <div class="grant-block"><b>Карточный пак</b>
            <div class="grant-row"><select class="field" id="grant-pack">${packs.map(p => '<option value="' + esc(p.id) + '">' + esc(p.title) + '</option>').join('')}</select>
            <input class="field grant-count" id="grant-pack-count" type="number" min="1" max="50" value="1" aria-label="Количество">
            <button type="button" id="grant-pack-go">Выдать</button></div></div>
        <div class="grant-block"><b>NFT по ссылке</b>
            <div class="grant-row is-link"><input class="field" id="grant-link" placeholder="https://t.me/nft/PlushPepe-1234" autocomplete="off">
            <button type="button" id="grant-link-go">Выдать</button></div></div>
        <div class="grant-block is-danger"><b>Очистка инвентаря</b>
            <p class="admin-small-warning">Удалит все подарки и паки игрока, снимет его лоты с продажи. Подарки в стейкинге, арене и выводе останутся.</p>
            <div class="grant-row is-link"><span></span><button type="button" class="grant-danger" id="grant-clear-go">Очистить инвентарь</button></div></div>`;
    box.querySelector('#grant-star-go').onclick = () => done(() => api('admin/star-gifts/grant', {user_id: uid, key: box.querySelector('#grant-star').value, count: box.querySelector('#grant-star-count').value}), 'Подарок выдан');
    box.querySelector('#grant-pack-go').onclick = () => done(() => api('admin/users/' + uid + '/packs', {pack_id: box.querySelector('#grant-pack').value, count: box.querySelector('#grant-pack-count').value}), 'Пак выдан');
    box.querySelector('#grant-clear-go').onclick = async () => {
        if (!confirm('Удалить ВЕСЬ инвентарь игрока ' + uid + '? Это нельзя отменить.')) return;
        if (prompt('Для подтверждения введите: ОЧИСТИТЬ') !== 'ОЧИСТИТЬ') return;
        try {
            const r = await api('admin/users/' + uid + '/inventory/clear', {confirm: 'CLEAR_INVENTORY'});
            toast('Удалено: ' + r.removed + (r.kept ? ', осталось в работе: ' + r.kept : ''));
            if (typeof renderAdminUserDetail === 'function') renderAdminUserDetail(uid);
        } catch (error) { toast(error.message); }
    };
    box.querySelector('#grant-link-go').onclick = () => done(async () => {
        const r = await api('admin/users/' + uid + '/nft-gift', {link: box.querySelector('#grant-link').value.trim()});
        box.querySelector('#grant-link').value = '';
        toast(r.source === 'relayer' ? 'NFT выдан (подарок на релейере)' : 'NFT выдан (подарок в Thermos)');
    }, 'Готово');
};
})();
