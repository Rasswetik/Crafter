/* Admin → «Термос»: everything the operator has to enter or check for the Thermos market. */
async function renderThermosAdmin(content) {
    const [th, relayer, buy] = await Promise.all([
        api('admin/thermos'),
        api('admin/auto-nft').catch(() => null),
        api('admin/purchase-mode').catch(() => null),
    ]);
    if (!content.isConnected) return;
    const yes = ok => `<span class="th-dot ${ok ? 'is-ok' : 'is-no'}">${ok ? 'есть' : 'нет'}</span>`;
    const live = th.backend === 'thermos';
    content.innerHTML = `<section class="admin-glass-panel th-card">
        <h3>Thermos — единый маркет</h3>
        <p>Thermos объединяет Portals, Tonnel и MRKT: цены, покупка и вывод подарков в TON. После включения каталог, покупки и проверки в играх идут через него.</p>
        <ol class="th-steps">
            <li>В Telegram откройте бота <b>@thermos</b> и отправьте <code>/api</code>. Лучше делать это с аккаунта, который подключён как Relayer.</li>
            <li>Вставьте полученный токен ниже и нажмите «Сохранить». Токен хранится зашифрованным и больше не показывается.</li>
            <li>Нажмите «Проверить»: появится баланс и адрес для пополнения. Переведите TON на этот адрес с указанным memo.</li>
            <li>Включите источник «Thermos». Для реальных покупок переключите режим покупок на РАБОТА.</li>
        </ol>
        <div class="th-status">
            <div>Токен ${yes(th.token_configured)}</div>
            <div>Шифрование (CRAFTER_PORTALS_FERNET_KEY) ${yes(th.encryption_ready)}</div>
            <div>Relayer подключён ${relayer ? yes(relayer.relayer_connected) : '<span class="th-dot">—</span>'}</div>
            <div>Режим покупок <b>${buy ? (buy.mode === 'work' ? 'РАБОТА' : 'ТЕСТ') : '—'}</b></div>
            <div>Источник маркета <b>${live ? 'THERMOS' : 'Portals'}</b></div>
        </div>
        <label class="th-field"><span>Токен Thermos</span>
            <input id="thermos-token" type="password" autocomplete="off" placeholder="Вставьте токен из @thermos"></label>
        <div class="th-actions">
            <button type="button" onclick="thermosAdmin('token')">Сохранить токен</button>
            <button type="button" onclick="thermosAdmin('check')">Проверить подключение и баланс</button>
            <button type="button" class="${live ? 'is-active' : ''}" onclick="thermosAdmin('${live ? 'portals' : 'thermos'}')">
                ${live ? 'Вернуть Portals' : 'Включить Thermos'}</button>
        </div>
        <div class="th-actions"><button type="button" class="${th.auto_withdraw ? 'is-active' : ''}" onclick="thermosAdmin('${th.auto_withdraw ? 'withdraw-off' : 'withdraw-on'}')">${th.auto_withdraw ? 'Автовывод TON включён — выключить' : 'Включить автовывод TON'}</button></div>
        <p class="th-note">Автовывод: заявки игроков на вывод TON уходят сами прямо с баланса Thermos на их кошельки (комиссия Thermos 0,1 TON за вывод). Никаких Render-кошельков и ручных подтверждений. На балансе Thermos должно хватать TON; если не хватает, заявка ждёт.</p>
        ${th.last_error ? `<p class="th-note">Последний отказ Thermos (${new Date(th.last_error.at * 1000).toLocaleString('ru-RU')}): <code>${esc(th.last_error.where)} → ${esc(th.last_error.code)} ${esc(th.last_error.answer)}</code> <button type="button" onclick="thermosAdmin('clear-error')">Стереть</button></p>` : ''}
        <h4 style="margin:14px 0 6px">Как выдавать NFT игрокам (переключается здесь)</h4>
        <div class="th-actions">
            <button type="button" class="${th.delivery === 'assign' ? 'is-active' : ''}" onclick="thermosAdmin('delivery-assign')">Напрямую: передать игроку внутри Thermos${th.delivery === 'assign' ? ' ✓' : ''}</button>
            <button type="button" class="${th.delivery !== 'assign' ? 'is-active' : ''}" onclick="thermosAdmin('delivery-relayer')">Через релейер: Thermos → релейер → игроку в Telegram${th.delivery !== 'assign' ? ' ✓' : ''}</button>
        </div>
        <p class="th-note"><b>Напрямую:</b> подарок мгновенно переходит игроку в Thermos без комиссии, игрок сам нажимает «Вывести» в @thermos (платит его комиссию). <b>Через релейер:</b> подарок выводится с Thermos на Telegram релейера (комиссия Thermos 0,1 TON), затем релейер отправляет его игроку в Telegram; если Telegram просит звёзды, релейер платит их сам (лимит ниже).</p>
        <div class="th-actions"><label>Релейер сам платит за перевод подарка до <input id="nft-max-stars" type="number" min="0" max="1000" value="25" style="width:80px"> ★ <button type="button" onclick="thermosAdmin('max-stars')">Сохранить</button></label></div>
        <p class="th-note">Для подарков, лежащих на релейере (игрок сам передал их релейеру): автовывод находит подарок на релейере и передаёт игроку. Если Telegram просит звёзды за перевод (около 25 ★), релейер заплатит их сам, но не больше указанного числа. 0 — никогда не платить (заявка уйдёт на ручную проверку).</p>
        <div id="thermos-info" class="th-info" role="status"></div>
        <p class="th-note">Комиссии Thermos: покупка 0,1 TON (0,2 TON при выводе на релейер), вывод подарка 0,1 TON. Лимит API — 2 запроса в секунду.</p>
    </section>`;
    api('admin/auto-nft').then(a => { const i = document.querySelector('#nft-max-stars'); if (i && a) i.value = a.max_stars || 0; }).catch(() => {});
    if (th.token_configured) thermosAdmin('check', true);       // show the live Thermos balance right away
    content.insertAdjacentHTML('beforeend', `<section class="admin-glass-panel th-card"><h3>Диагностика Thermos</h3>
        <p>Показывает, что именно отвечает Thermos (названия полей). Только чтение: ничего не отправляется и не покупается.</p>
        <div class="th-actions"><button type="button" onclick="thermosProbe('/gifts/me')">Мои подарки в Thermos</button><button type="button" onclick="thermosProbe('/gifts/me/on-sale')">Выставленные на продажу</button></div>
        <pre id="thermos-probe" class="th-info" style="white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto"></pre></section>`);
    content.insertAdjacentHTML('beforeend', `<section class="admin-glass-panel th-card"><h3>Очередь автовывода NFT</h3><p>Что делает автовывод с каждой заявкой и почему. Он сам проверяет очередь раз в полминуты; кнопка запускает проверку сразу.</p>
        <div class="th-actions"><button type="button" onclick="autoNftRun()">Запустить сейчас</button><button type="button" onclick="autoNftJobs()">Обновить список</button><button type="button" onclick="autoNftCheck()">Проверить вывод через релейер</button></div>
        <div id="auto-nft-jobs" class="th-info" style="white-space:pre-wrap"></div></section>`);
    content.insertAdjacentHTML('beforeend', `<section class="admin-glass-panel th-card"><h3>Очередь вывода TON</h3><p>Почему вывод TON уходит или стоит. Автовывод сам проверяет очередь раз в 20 секунд; кнопка проверяет сразу.</p>
        <div class="th-actions"><button type="button" onclick="tonWithdrawRun()">Проверить и отправить сейчас</button></div>
        <div id="ton-withdraw-state" class="th-info" style="white-space:pre-wrap"></div></section>`);
    tonWithdrawRun();
    autoNftJobs();
    renderHouseMarket(content);
}
async function tonWithdrawRun() {
    const box = document.querySelector('#ton-withdraw-state');
    try {
        const r = await api('admin/thermos/withdraw-run', {});
        const head = r.reasons.length ? 'ПРЕПЯТСТВИЯ:\n- ' + r.reasons.join('\n- ') + '\n\n' : 'Препятствий нет\n';
        const queue = r.queue.length ? r.queue.map(q => q.ton + ' TON → ' + q.receiver.slice(0, 10) + '… · ' + q.state).join('\n') : 'Заявок на вывод TON в очереди нет';
        box.textContent = head + 'Баланс Thermos: ' + (r.balance ?? '—') + ' TON · отправлено сейчас: ' + (r.sent || 0) + ' · завершено: ' + (r.settled || 0) + '\n' + queue;
    } catch (error) { if (box) box.textContent = error.message; }
}
async function autoNftJobs(extra) {
    const box = document.querySelector('#auto-nft-jobs');
    try {
        const a = await api('admin/auto-nft');
        const jobs = a.jobs.length ? a.jobs.map(j => new Date(j.updated * 1000).toLocaleTimeString('ru-RU') + ' · ' + j.source + ' · ' + j.stage + (j.note ? ' · ' + j.note : '')).join('\n') : 'Заявок пока нет';
        box.textContent = (extra ? extra + '\n' : '') + (a.enabled ? 'Автовывод включён' : 'Автовывод ВЫКЛЮЧЕН') + (a.relayer_connected ? ' · релейер подключён' : ' · релейер не подключён') + '\n' + jobs;
    } catch (error) { if (box) box.textContent = error.message; }
}
async function autoNftCheck() {
    const box = document.querySelector('#auto-nft-jobs');
    box.textContent = 'Проверяем…';
    try {
        const r = await api('admin/auto-nft/check', {});
        box.textContent = r.report.map(x => (x.ok ? 'OK  ' : 'НЕТ ') + x.text).join(String.fromCharCode(10));
    } catch (error) { box.textContent = error.message; }
}
async function autoNftRun() {
    try { const r = await api('admin/auto-nft/run', {}); await autoNftJobs('Проверено заявок: ' + (r.processed ?? 0)); }
    catch (error) { await autoNftJobs(error.message); }
}
async function thermosProbe(path) {
    const box = document.querySelector('#thermos-probe');
    try { const r = await api('admin/thermos/probe', {path}); box.textContent = path + ' (' + r.size + ' chars)\n' + r.raw; }
    catch (error) { box.textContent = error.message; }
}
async function renderHouseMarket(content) {
    let h;
    try { h = await api('admin/house-market'); } catch (_) { return; }
    if (!content.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'admin-glass-panel th-card';
    const when = ts => new Date(ts * 1000).toLocaleString('ru-RU');
    sec.innerHTML = `<h3>Маркет Crafter: сожжённые подарки</h3>
        <p>Когда игрок сжигает настоящий подарок (ставка в апгрейде, крафт), подарок остаётся на релейере и сразу выставляется на маркет от имени «Crafter relayer» по цене из оценки (флор). В апгрейдах такие лоты стоят первыми, и выигрыш выдаётся без покупки на Thermos. Передача другому игроку (арена) — не сжигание.</p>
        <div class="th-status"><div>Лотов в продаже <b>${h.active_count}</b></div><div>На сумму <b>${esc(h.active_value)} GRAM</b></div><div>Продано <b>${h.sold}</b></div><div>Баланс релейера <b>${esc(h.balance)} GRAM</b></div></div>
        <div class="th-actions"><label><input type="checkbox" id="hm-on" ${h.settings.enabled ? 'checked' : ''}> Выставлять сожжённые подарки</label>
        <label>Наценка, % <input id="hm-markup" type="number" step="1" min="-50" max="500" value="${esc(h.settings.markup_percent)}" style="width:80px"></label>
        <button type="button" id="hm-save">Сохранить</button></div>
        <div class="ny-admin-list">${h.lots.map(l => `<div class="ny-admin-row"><div><b>${esc(l.name)} #${esc(l.number)}</b><small>${esc(l.reason === 'upgrade' ? 'апгрейд' : 'крафт')} · игрок ${esc(l.burned_by)} · ${when(l.created)} · ${l.on_sale ? esc(l.price) + ' GRAM' : 'продан/снят'}</small></div>
            ${l.on_sale ? `<span><input data-hm-price="${esc(l.gift_id)}" value="${esc(l.price)}" style="width:90px"> <button type="button" data-hm-set="${esc(l.gift_id)}">Цена</button> <button type="button" data-hm-del="${esc(l.gift_id)}">Снять</button></span>` : ''}</div>`).join('') || '<p class="sub">Пока ничего не сожжено.</p>'}</div>`;
    content.appendChild(sec);
    const go = async (fn, ok) => { try { await fn(); toast(ok); content.innerHTML = ''; renderThermosAdmin(content); } catch (error) { toast(error.message); } };
    sec.querySelector('#hm-save').addEventListener('click', () => go(() => api('admin/house-market/settings', {enabled: sec.querySelector('#hm-on').checked, markup_percent: sec.querySelector('#hm-markup').value}), 'Сохранено'));
    sec.querySelectorAll('[data-hm-set]').forEach(b => b.addEventListener('click', () => go(() => api('admin/house-market/' + b.dataset.hmSet + '/price', {price: sec.querySelector('[data-hm-price="' + b.dataset.hmSet + '"]').value}), 'Цена изменена')));
    sec.querySelectorAll('[data-hm-del]').forEach(b => b.addEventListener('click', () => go(() => api('admin/house-market/' + b.dataset.hmDel + '/delist', {}), 'Лот снят')));
}

async function thermosAdmin(action, quiet = false) {
    const box = document.querySelector('#thermos-info');
    try {
        if (action === 'token') {
            const input = document.querySelector('#thermos-token');
            await api('admin/thermos/token', {token: input.value.trim()});
            input.value = '';
            toast('Токен сохранён');
        } else if (action === 'max-stars') {
            await api('admin/auto-nft/max-stars', {stars: Number(document.querySelector('#nft-max-stars').value || 0)});
            toast('Сохранено');
            return;
        } else if (action === 'clear-error') {
            await api('admin/thermos/clear-error', {});
        } else if (action === 'delivery-assign' || action === 'delivery-relayer') {
            await api('admin/thermos/delivery', {mode: action === 'delivery-assign' ? 'assign' : 'relayer'});
            toast(action === 'delivery-assign' ? 'NFT выдаются через Thermos' : 'NFT выдаются через релейер');
        } else if (action === 'withdraw-on' || action === 'withdraw-off') {
            await api('admin/thermos/auto-withdraw', {enabled: action === 'withdraw-on'});
            toast(action === 'withdraw-on' ? 'Автовывод TON включён' : 'Автовывод TON выключен');
        } else if (action === 'check') {
            if (box && !quiet) box.textContent = 'Проверяем…';
            const r = await api('admin/thermos/check', {});
            if (!box) return;
            box.innerHTML = `Подключено. Баланс: <b>${esc(r.balance_ton)} TON</b><br>Адрес пополнения: <code>${esc(r.deposit_address)}</code><br>Memo: <code>${esc(r.deposit_memo)}</code>`;
            return;
        } else {
            if (!confirm(action === 'thermos' ? 'Включить Thermos как источник маркета?' : 'Вернуть Portals?')) return;
            await api('admin/thermos/backend', {backend: action, confirm: 'SET_MARKET_BACKEND'});
            toast('Источник маркета изменён');
        }
        await renderAdmin();
    } catch (error) {
        if (box) box.textContent = error.message;
        if (!quiet) toast(error.message);
    }
}

async function renderAdminDataReset(content) {
    const info = await api('admin/data-reset');
    if (!content.isConnected) return;
    const real = !info.demo_mode;
    content.innerHTML = `<section class="admin-glass-panel th-card">
        <h3>Тип игр</h3>
        <p>Сейчас: <b>${real ? 'настоящий баланс' : 'ДЕМО-баланс'}</b>. Режим покупок: <b>${info.purchase_mode === 'work' ? 'РАБОТА' : 'ТЕСТ'}</b>.</p>
        ${real ? '' : '<div class="th-actions"><button type="button" onclick="adminDataReset(\'real\')">Перевести на настоящий баланс</button></div>'}
    </section>
    <section class="admin-glass-panel th-card">
        <h3>Сброс данных игроков</h3>
        <p>Аккаунтов: <b>${info.accounts}</b> · подарков в инвентарях: <b>${info.gifts_total}</b> · записей истории: <b>${info.history_rows}</b> · привязанных кошельков: <b>${info.wallets_kept}</b>.</p>
        <p><b>Удаляется всё:</b> балансы GRAM, инвентари, история покупок и операций, лоты и офферы, стейкинг, реферальные начисления, промокоды, шары, ставки и раунды Arena.</p>
        <p><b>Остаётся:</b> аккаунты, привязанные кошельки, баны и все настройки админки. Записи о блокчейн-пополнениях тоже остаются, чтобы старый перевод нельзя было зачесть второй раз.</p>
        <p><b>Подарки на релейере</b> вернутся тем, кто их передал: ${info.relayer_checked
            ? 'после сброса вернётся подарков: <b>' + (info.gifts_to_restore ?? 0) + '</b>'
            : '<span class="th-dot is-no">релейер не удалось проверить</span> — подарки, уже зачисленные с релейера, останутся у игроков, остальное будет удалено'}.</p>
        <div class="th-actions"><button type="button" class="is-danger" onclick="adminDataReset('reset')">Сбросить ВСЕ данные игроков</button></div>
        <div id="reset-info" class="th-info" role="status"></div>
    </section>`;
}

async function adminDataReset(kind) {
    const box = document.querySelector('#reset-info');
    try {
        if (kind === 'real') {
            if (!confirm('Перевести проект на настоящий баланс? Демо-режим будет выключен.')) return;
            await api('admin/game-type/real', {confirm: 'SWITCH_TO_REAL'});
            toast('Включён настоящий баланс');
        } else {
            if (!confirm('Сбросить ВСЕ данные игроков: балансы, инвентари, историю и стейкинг? Привязанные кошельки останутся. Действие необратимо.')) return;
            if (prompt('Для подтверждения введите: СБРОС') !== 'СБРОС') return;
            const r = await api('admin/data-reset', {confirm: 'RESET_ALL_PLAYER_DATA'});
            toast('Данные сброшены. Возвращено подарков с релейера: ' + r.restored_gifts);
        }
        await renderAdmin();
    } catch (error) {
        if (box) box.textContent = error.message;
        toast(error.message);
    }
}
