/* Admin → «BoostUp»: the deposits of Crafter players into BoostUp through the Crafter relayer.
   Switch, webhook address, the Crafter account of BoostUp that receives the gifts, the personal key of BoostUp (BUP/...), the signing secret and the list of deposits. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const when = t => t ? new Date(t * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
const BADGE = {offered: '', delivered: 'is-alert', credited: 'is-good', returned: ''};
const box = 'padding:16px 18px;margin:0 0 14px';
const field = 'width:100%;padding:11px 13px;border-radius:14px;border:1px solid #303030;background:#1a1a1a;color:#fff;font:inherit';
const row = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';

function secret(label, value, id) {
    return '<div style="margin:0 0 12px"><small style="color:#87878b">' + e(label) + '</small>' +
        '<div style="' + row + ';margin-top:5px"><code id="' + id + '" style="flex:1;min-width:220px;word-break:break-all;background:#1a1a1a;border:1px solid #303030;border-radius:12px;padding:10px 12px">' + e(value) + '</code>' +
        '<button type="button" class="secondary" data-copy="' + id + '">Копировать</button></div></div>';
}

function draw(content, d) {
    const s = d.settings, counts = d.counts || {};
    content.innerHTML =
        '<div class="admin-section-intro"><h3>BoostUp</h3><p>Игрок отправляет подарок на релейер Crafter, бот спрашивает «Куда отправить подарок?». При выборе «В BoostUp» и подтверждении в окне подарок сразу передаётся в инвентарь аккаунта BoostUp внутри Crafter, а BoostUp добавляет этот NFT игроку в свой инвентарь.</p></div>' +
        '<section class="admin-glass-panel" style="' + box + '"><div style="' + row + ';justify-content:space-between"><div><h3 style="margin:0 0 4px">Интеграция</h3>' +
        '<p style="margin:0;color:#87878b">' + (s.enabled ? 'Включена: бот задаёт вопрос после каждого пополнения через релейер.' : 'Выключена: бот отвечает, как обычно.') + '</p></div>' +
        '<button type="button" class="' + (s.enabled ? 'secondary' : 'primary') + '" data-toggle>' + (s.enabled ? 'Выключить' : 'Включить') + '</button></div></section>' +
        '<section class="admin-glass-panel" style="' + box + '"><h3 style="margin:0 0 12px">Настройки</h3>' +
        '<label style="display:block;margin:0 0 12px"><small style="color:#87878b">Адрес webhook BoostUp (https)</small><input data-f="webhook_url" style="' + field + '" value="' + e(s.webhook_url) + '" placeholder="https://boostup.example/crafter/webhook"></label>' +
        '<label style="display:block;margin:0 0 6px"><small style="color:#87878b">Аккаунт BoostUp в Crafter, в инвентарь которого передаются подарки (Telegram ID или @username)</small><input data-f="account" style="' + field + '" value="' + e(d.account ? (d.account.username ? '@' + d.account.username : d.account.telegram_id) : '') + '" placeholder="@boostup_relayer"></label>' +
        '<p style="margin:0 0 12px;color:#87878b;font-size:13px">' + (d.account ? 'Сейчас: ' + e(d.account.name || '') + ' · ID ' + e(d.account.telegram_id) + '. ' : 'Аккаунт не выбран. ') + 'Он должен хотя бы раз открыть Crafter. Свой обычный ключ Partner API (тот же, что у всех, команда /api в боте) он использует, чтобы работать с полученными подарками.</p>' +
        '<label style="display:block;margin:0 0 12px"><small style="color:#87878b">Стоимость на экране подтверждения, % от флора коллекции</small><input data-f="percent" style="' + field + '" inputmode="decimal" value="' + e(s.percent) + '"></label>' +
        '<div style="' + row + '"><button type="button" class="primary" data-save>Сохранить</button><button type="button" class="secondary" data-test>Отправить тестовый webhook</button><span data-note style="color:#87878b"></span></div></section>' +
        '<section class="admin-glass-panel" style="' + box + '"><h3 style="margin:0 0 6px">Личный ключ BoostUp</h3><p style="margin:0 0 12px;color:#87878b">Это второй ключ, только для подключения пополнения. Первый, обычный ключ Partner API, получает каждый через бота. Передайте BoostUp этот ключ, секрет подписи и ссылку на инструкцию. Ключ нельзя использовать в браузере.</p>' +
        secret('Ключ пополнения BoostUp (Authorization: Bearer BUP/…)', d.token, 'bu-token') + secret('Секрет подписи webhook', d.signing_secret, 'bu-secret') +
        '<p style="margin:0 0 12px">Инструкция для BoostUp: <a href="' + e(d.docs) + '" target="_blank" rel="noopener">' + e(d.docs) + '</a><br>Адрес API: <code>' + e(d.api) + '</code></p>' +
        '<button type="button" class="secondary" data-rotate>Заменить ключ и секрет</button></section>' +
        '<section class="admin-glass-panel" style="' + box + '"><h3 style="margin:0 0 10px">Пополнения</h3>' +
        '<p style="margin:0 0 12px;color:#87878b">' + ['delivered', 'credited', 'returned'].map(k => k + ': ' + (counts[k] || 0)).join(' · ') + '</p>' +
        (d.deposits.length ? '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#87878b"><th>Время</th><th>Игрок</th><th>Подарок</th><th>Статус</th><th></th></tr></thead><tbody>' +
            d.deposits.map(x => '<tr style="border-top:1px solid #303030"><td style="padding:9px 8px 9px 0;white-space:nowrap">' + when(x.created) + '</td><td>' + e(x.username ? '@' + x.username : x.telegram_id) + '</td>' +
                '<td>' + e(x.gift.name + ' #' + x.gift.number) + (x.value ? '<br><small style="color:#87878b">' + e(x.value.ton) + ' TON</small>' : '') + '</td>' +
                '<td><span class="admin-pill ' + (BADGE[x.status] || '') + '">' + e(x.status) + '</span><br><small style="color:#87878b">' + e(x.note || x.status_text) + (x.attempts ? ' · попыток: ' + x.attempts : '') + '</small></td>' +
                '<td style="white-space:nowrap">' + (x.status === 'delivered' ? '<button type="button" class="secondary" data-retry="' + e(x.deposit_id) + '">Повторить</button> <button type="button" class="secondary" data-return="' + e(x.deposit_id) + '">Вернуть игроку</button>' : '') + '</td></tr>').join('') +
            '</tbody></table></div>' : '<p style="color:#87878b;margin:0">Пока нет пополнений.</p>') + '</section>';
    bind(content, d);
}

function bind(content, d) {
    const note = text => { const n = content.querySelector('[data-note]'); if (n) n.textContent = text; };
    const read = () => {
        const out = {};
        content.querySelectorAll('[data-f]').forEach(i => { out[i.dataset.f] = i.value.trim(); });
        return out;
    };
    const save = async extra => {
        try {
            const next = await api('admin/boostup', {...read(), ...extra, confirm: 'SET_BOOSTUP'});
            if (next.warning) toast(next.warning); else toast('Сохранено');
            draw(content, next);
        } catch (err) { toast(err.message); }
    };
    content.querySelector('[data-save]')?.addEventListener('click', () => save({}));
    content.querySelector('[data-toggle]')?.addEventListener('click', () => {
        if (!d.settings.enabled && !confirm('Включить BoostUp? После каждого пополнения через релейер бот спросит игрока, куда отправить подарок.')) return;
        save({enabled: !d.settings.enabled});
    });
    content.querySelector('[data-test]')?.addEventListener('click', async () => {
        note('Отправляем…');
        try {
            const r = await api('admin/boostup/test', {});
            note(r.ok ? 'BoostUp ответил HTTP ' + r.status : (r.error || 'Ответ HTTP ' + r.status + ': ' + (r.answer || '')));
        } catch (err) { note(err.message); }
    });
    content.querySelector('[data-rotate]')?.addEventListener('click', async () => {
        if (!confirm('Заменить ключ и секрет подписи? Старые перестанут работать сразу, BoostUp нужно передать новые.')) return;
        try { draw(content, await api('admin/boostup/rotate', {confirm: 'ROTATE_BOOSTUP'})); toast('Ключ заменён'); } catch (err) { toast(err.message); }
    });
    content.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(content.querySelector('#' + b.dataset.copy).textContent); toast('Скопировано'); } catch (_) { toast('Выделите и скопируйте вручную'); }
    }));
    content.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', async () => {
        try { await api('admin/boostup/deposits/' + b.dataset.retry + '/retry', {}); toast('Повтор запущен'); draw(content, await api('admin/boostup')); } catch (err) { toast(err.message); }
    }));
    content.querySelectorAll('[data-return]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Вернуть подарок игроку в инвентарь Crafter? Он заберётся из инвентаря аккаунта BoostUp, если BoostUp его ещё не выставил и не вывел.')) return;
        try { await api('admin/boostup/deposits/' + b.dataset.return + '/return', {confirm: 'RETURN_BOOSTUP'}); toast('Подарок возвращён'); draw(content, await api('admin/boostup')); } catch (err) { toast(err.message); }
    }));
}

window.renderAdminBoostUp = async function (content) {
    content.innerHTML = '<p class="admin-loading-panel">Загрузка…</p>';
    try { draw(content, await api('admin/boostup')); } catch (err) { content.innerHTML = '<p class="admin-loading-panel">' + e(err.message) + '</p>'; }
};

if (typeof adminSections === 'object') {
    adminSections.boostup = {label: 'BoostUp', detail: 'Пополнение подарками через релейер', group: 'money', glyph: 'send', render: window.renderAdminBoostUp};
}
})();
