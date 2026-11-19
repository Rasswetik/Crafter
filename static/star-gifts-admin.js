/* Admin → Relayer: auto-withdrawal of ordinary Telegram gifts (paid from the relayer's Stars). */
(function () {
    const STATUS = {queued: 'Ожидает', sending: 'Отправка', review: 'Проверить вручную', confirmed: 'Отправлено', failed: 'Не выполнено'};
    const COLOR = {confirmed: 'is-good', failed: 'is-alert', review: 'is-alert', sending: '', queued: ''};

    function when(ts) {
        return ts ? new Date(ts * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
    }

    function ago(ts) {
        if (!ts) return 'ещё не обновлялся';
        const sec = Math.max(0, Math.round(Date.now() / 1000 - ts));
        if (sec < 60) return 'только что';
        if (sec < 3600) return Math.round(sec / 60) + ' мин назад';
        return when(ts);
    }

    function balanceBlock(info) {
        const st = info.state || {};
        const known = st.stars !== undefined && st.stars !== null;
        const at = st.stars_at || st.checked;
        const low = known && Number(st.stars) < 15;
        const every = Math.round((info.balance_every || 120) / 60);
        return `<div class="rs-balance${low ? ' is-low' : ''}">
            <div class="rs-balance-main">
                <span class="rs-label">Баланс Stars релейера</span>
                <strong class="rs-stars">${known ? esc(Number(st.stars).toLocaleString('ru-RU')) + ' ★' : '—'}</strong>
                <span class="rs-note">${known ? '≈ ' + esc((Number(st.stars) / 100).toLocaleString('ru-RU', {maximumFractionDigits: 2})) + ' GRAM · ' : ''}обновлено: ${esc(ago(at))}</span>
                <span class="rs-note">Обновляется само каждые ${every} мин. ${low ? '<b>Stars почти нет: пополните релейер, иначе заявки будут ждать.</b>' : ''}</span>
            </div>
            <button type="button" class="rs-refresh" onclick="starGiftsAdmin('balance')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6M20 4v7h-7"/></svg>
                Обновить баланс звёзд
            </button>
        </div>`;
    }

    function jobRow(job) {
        const open = ['queued', 'review', 'sending'].includes(job.status);
        return `<div class="rs-job">
            <img src="${esc(job.image || '')}" alt="">
            <div class="rs-job-main">
                <b>${esc((job.gift_name || '') + ' · ' + (job.stars || '') + ' ★')}</b>
                <span>${esc(job.name || job.user_id)}${job.username ? ' · @' + esc(job.username) : ''} · ID ${esc(job.user_id)}</span>
                <small>${when(job.created)}${job.note ? ' · ' + esc(job.note) : ''}</small>
            </div>
            <span class="admin-pill ${COLOR[job.status] || ''}">${esc(STATUS[job.status] || job.status)}</span>
            ${open ? `<div class="rs-job-actions">
                <button type="button" onclick="starGiftsAdmin('resolve', ${arg(job.id)}, 'confirmed')">Отправлено вручную</button>
                <button type="button" onclick="starGiftsAdmin('resolve', ${arg(job.id)}, 'failed')">Вернуть игроку</button></div>` : ''}
        </div>`;
    }

    function panel(info) {
        const st = info.state || {};
        const catalog = info.catalog || [];
        const counts = info.counts || {};
        const stat = (n, t, cls) => `<div class="rs-stat ${cls || ''}"><strong>${n || 0}</strong><span>${t}</span></div>`;
        return `<section class="relayer-stars" id="star-gifts-admin">
            <div class="rs-head">
                <div><span class="rs-eyebrow">Обычные подарки Telegram</span><h3>Автовывод за Stars</h3></div>
                <span class="admin-pill ${info.enabled ? 'is-good' : 'is-alert'}">${info.enabled ? 'Автовывод включён' : 'Автовывод выключен'}</span>
            </div>
            <p class="rs-lead">Игрок нажимает «Вывести», релейер сразу отправляет ему настоящий подарок (Bear, Rose, Cake…) за свои Stars с подписью «${esc(info.message)}». Курс: 100 ★ = 1 GRAM. Если Stars не хватает, заявки ждут пополнения.</p>
            <div id="rs-balance-slot">${balanceBlock(info)}</div>
            <div class="rs-stats">
                ${stat(counts.queued, 'Ожидают')}${stat(counts.sending, 'Отправляются')}${stat(counts.review, 'Проверить вручную', counts.review ? 'is-alert' : '')}${stat(counts.confirmed, 'Отправлено', 'is-good')}
            </div>
            ${st.error ? '<p class="relayer-issue">' + esc(st.error) + '</p>' : ''}
            ${(info.report || []).length ? '<ul class="sg-report">' + info.report.map(x => '<li class="' + (x.ok ? 'is-ok' : 'is-no') + '"><i></i>' + esc(x.text) + '</li>').join('') + '</ul>' : ''}
            <div class="rs-actions">
                <button type="button" class="${info.enabled ? '' : 'rs-primary'}" onclick="starGiftsAdmin('toggle', ${!info.enabled})">${info.enabled ? 'Выключить автовывод' : 'Включить автовывод'}</button>
                ${info.enabled ? '<button type="button" onclick="starGiftsAdmin(\'run\')">Обработать очередь сейчас</button>' : ''}
                <button type="button" onclick="starGiftsAdmin('network')">Проверить доступ к Telegram</button>
                <button type="button" onclick="starGiftsAdmin('check')">Загрузить ID и картинки</button>
            </div>
            <details class="rs-fold">
                <summary>Каталог подарков <small>${catalog.filter(i => i.synced).length} из ${catalog.length} загружено</small></summary>
                ${catalog.length ? '<div class="sg-catalog">' + catalog.map(i => '<div class="sg-item' + (i.synced ? '' : ' is-missing') + '"><img src="' + esc(i.image) + '" alt=""><b>' + esc(i.name) + '</b><small>' + i.stars + ' ★ · ' + esc(i.price) + ' GRAM</small><small>' + (i.telegram_gift_id ? 'ID ' + esc(i.telegram_gift_id) : 'не загружен') + '</small></div>').join('') + '</div>' : ''}
            </details>
            <details class="rs-fold">
                <summary>Выдать подарок игроку</summary>
                <form class="sg-grant" id="star-grant-form">
                    <label><span>Telegram ID игрока</span><input name="user_id" inputmode="numeric" placeholder="123456789" required></label>
                    <label><span>Подарок</span><select name="key">${catalog.map(i => '<option value="' + esc(i.key) + '">' + esc(i.name + ' — ' + i.stars + '★') + '</option>').join('')}</select></label>
                    <label><span>Количество</span><input name="count" type="number" min="1" max="50" value="1"></label>
                    <button type="submit">Выдать</button>
                </form>
            </details>
            <h4 class="rs-subhead">Заявки на вывод <small>последние ${info.jobs.length}</small></h4>
            ${info.jobs.length ? '<div class="rs-jobs">' + info.jobs.map(jobRow).join('') + '</div>' : '<p class="rs-empty">Заявок на вывод пока нет.</p>'}
        </section>`;
    }

    async function paint(content) {
        let info;
        try { info = await api('admin/star-gifts'); } catch (error) { return; }
        if (!content.isConnected) return;
        content.querySelector('#star-gifts-admin')?.remove();
        const html = panel(info);
        const anchor = content.querySelector('.relayer-overview');
        if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else content.insertAdjacentHTML('afterbegin', html);
        content.querySelector('#star-grant-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            const f = Object.fromEntries(new FormData(event.target));
            try { await api('admin/star-gifts/grant', {user_id: f.user_id, key: f.key, count: f.count}); toast('Подарок выдан'); event.target.reset(); }
            catch (error) { toast(error.message); }
        });
        watchBalance();
    }

    // The server re-reads the balance from Telegram every couple of minutes; the open page just shows the fresh value.
    let watcher = null;
    function watchBalance() {
        if (watcher) return;
        watcher = setInterval(async () => {
            const slot = document.querySelector('#rs-balance-slot');
            if (!slot || !slot.isConnected) { clearInterval(watcher); watcher = null; return; }
            if (document.hidden) return;
            try { slot.innerHTML = balanceBlock(await api('admin/star-gifts')); } catch (_) {}
        }, 30000);
    }

    window.starGiftsAdmin = async function (action, a, b) {
        const content = document.querySelector('#admin-content');
        try {
            if (action === 'toggle') {
                if (!confirm((a ? 'Включить' : 'Выключить') + ' автовывод подарков Telegram за Stars?')) return;
                await api('admin/star-gifts', {enabled: a, confirm: 'SET_STAR_GIFTS'});
                toast('Автовывод подарков: ' + (a ? 'включён' : 'выключен'));
            } else if (action === 'balance') {
                const button = document.querySelector('#star-gifts-admin .rs-refresh');
                if (button) { button.disabled = true; button.classList.add('is-busy'); }
                toast('Запрашиваем баланс у Telegram…');
                const result = await api('admin/star-gifts/balance', {});
                toast(result.refreshed ? 'Баланс Stars обновлён' : (result.state && result.state.error) || 'Не удалось обновить баланс');
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

    // Every redraw of the Relayer section (including the buttons inside it) must bring the Stars panel back.
    if (typeof window.renderTelegramDeposits === 'function') {
        const baseRender = window.renderTelegramDeposits;
        window.renderTelegramDeposits = async function (content) {
            const target = content || document.querySelector('#admin-content');
            await baseRender(target);
            if (target) await paint(target);
        };
        if (typeof adminSections === 'object' && adminSections.relayer) adminSections.relayer.render = window.renderTelegramDeposits;
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
