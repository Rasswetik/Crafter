/* Exchange sections of the special market: plates grouped in columns (balls <-> GRAM, with a bonus «75 + ещё 5») and the column
   «Поддержка автора контента» where a player enters the code of a content author. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : '0'; };
const ORN = '<img class="fm-ball" src="/static/assets/new-year-ornament.svg" alt="">';
const GRM = '<img class="fm-ball" src="/static/assets/gram.svg" alt="">';
const icon = c => (c === 'BALLS' ? ORN : GRM);
const NAME = {BALLS: 'шаров', GRAM: 'GRAM'};
const art = ex => ex.image || (ex.get_cur === 'BALLS' ? '/static/assets/new-year-ornament.svg' : '/static/assets/gram.svg');
const total = ex => Number(ex.get_amount) + Number(ex.bonus || 0);
const gone = ex => (ex.left !== null && ex.left !== undefined && ex.left <= 0) || (ex.per_user && ex.mine >= ex.per_user);

function tile(ex, opts = {}) {
    const bonus = Number(ex.bonus) > 0;
    return '<button type="button" class="fm-ex g-' + e(String(ex.get_cur).toLowerCase()) + (gone(ex) ? ' is-gone' : '') + '" data-fm-ex="' + e(ex.id) + '"' + (opts.preview ? ' tabindex="-1"' : '') + '>' +
        '<b class="fm-exget">' + num(total(ex)) + '</b>' +
        '<span class="fm-exart"><img src="' + e(art(ex)) + '" alt="" draggable="false"></span>' +
        (bonus ? '<span class="fm-exbonus">' + icon(ex.get_cur) + num(ex.get_amount) + ' + ещё ' + num(ex.bonus) + '</span>' : '') +
        '<span class="fm-exprice">' + icon(ex.pay_cur) + '<b>' + num(ex.pay_amount) + '</b></span>' +
        (ex.left !== null && ex.left !== undefined ? '<i class="fm-exleft">Осталось ' + num(ex.left) + '</i>' : '') + '</button>';
}

function html(list, ctx) {
    const groups = [];
    list.forEach(x => { const t = x.group_title || 'Обмен'; let g = groups.find(y => y.t === t); if (!g) { g = {t, items: []}; groups.push(g); } g.items.push(x); });
    const a = ctx.shopState?.author || {code: '', percent: '5'};
    return '<div class="fm-exwrap"><div class="fm-excols">' +
        groups.map(g => '<div class="fm-excol"><h3 class="fm-exh">' + e(g.t) + '</h3><div class="fm-exgrid">' + g.items.map(x => tile(x)).join('') + '</div></div>').join('') +
        '<div class="fm-excol fm-excode"><h3 class="fm-exh">Поддержка автора контента</h3><div class="fm-codebody"><div class="fm-codelogo">C</div>' +
        '<p>Введи код автора контента, и каждая твоя покупка вернёт ему ' + e(a.percent) + '%.</p>' +
        (a.code ? '<p class="fm-codestate ok">Ты поддерживаешь автора:<b>' + e(a.code) + '</b></p>' : '<p class="fm-codestate bad">Ты не поддерживаешь никого из авторов контента.</p>') +
        '<button type="button" class="fm-codebtn" data-fm-code>' + (a.code ? 'Сменить код' : 'Ввод кода') + '</button></div></div></div></div>';
}

function overlay(inner, cls) {
    const el = document.createElement('div');
    el.className = cls + ' fm-xo';
    el.innerHTML = inner;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 220); document.removeEventListener('keydown', onKey); };
    const onKey = ev => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return {el, close};
}

function confirmExchange(ex, onYes) {
    const {el, close} = overlay('<div class="fm-cbox"><b>Обменять?</b><span class="fm-cwhat">' + icon(ex.pay_cur) + '<b>' + num(ex.pay_amount) + '</b> <i>→</i> ' + icon(ex.get_cur) + '<b>' + num(total(ex)) + '</b></span>' +
        '<button type="button" class="fm-yes" data-x-yes>ДА</button><button type="button" class="fm-no" data-x-no>Отмена</button></div>', 'fm-confirm');
    el.addEventListener('click', ev => { if (!ev.target.closest('.fm-cbox')) close(); });
    el.querySelector('[data-x-no]').addEventListener('click', close);
    el.querySelector('[data-x-yes]').addEventListener('click', async () => {
        const yes = el.querySelector('[data-x-yes]'); yes.disabled = true;
        try { await onYes(); close(); } catch (error) { yes.disabled = false; el.querySelector('.fm-cbox').insertAdjacentHTML('beforeend', '<p class="fm-xerr">' + e(error.message) + '</p>'); }
    });
}

function done(ex, res) {
    const {el, close} = overlay('<div class="fm-cbox fm-done"><i class="fm-tick">✓</i><b>Обмен выполнен</b><span class="fm-cwhat">Получено: ' + icon(res.got.currency) + '<b>' + num(res.got.amount) + '</b></span><button type="button" class="fm-yes" data-x-ok>Отлично</button></div>', 'fm-confirm');
    el.addEventListener('click', ev => { if (!ev.target.closest('.fm-cbox')) close(); });
    el.querySelector('[data-x-ok]').addEventListener('click', close);
}

function codeDialog(ctx, after) {
    const {el, close} = overlay('<button type="button" class="fm-back fm-codeback" data-x-back aria-label="Назад"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></button>' +
        '<h2>Поддержка автора контента</h2><p>Введи код автора:</p><div class="fm-coderow"><input type="text" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" data-x-code><button type="button" data-x-go>ВВОД</button></div><p class="fm-xerr" data-x-err></p>', 'fm-codedlg');
    const input = el.querySelector('[data-x-code]'), err = el.querySelector('[data-x-err]');
    setTimeout(() => input.focus(), 150);
    el.querySelector('[data-x-back]').addEventListener('click', close);
    const go = async () => {
        err.textContent = '';
        try {
            const res = await api('author-code', {code: input.value});
            if (ctx.shopState?.author) ctx.shopState.author.code = res.code;
            toast('Код принят: ' + res.code);
            close(); after();
        } catch (error) { err.textContent = error.message; }
    };
    el.querySelector('[data-x-go]').addEventListener('click', go);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
}

function bind(host, ctx, list, rerender) {
    host.querySelectorAll('[data-fm-ex]').forEach(btn => btn.addEventListener('click', () => {
        const ex = list.find(x => x.id === btn.dataset.fmEx);
        if (!ex || gone(ex) || ctx.preview) return;
        confirmExchange(ex, async () => {
            const rid = 'ex-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2));
            const res = await api('shop-exchange/buy', {exchange_id: ex.id, request_id: rid});
            if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(res.balance);
            if (res.gram_balance !== undefined && state?.me) { state.me.balance = res.gram_balance; if (typeof updateBalance === 'function') updateBalance(); }
            ex.mine = (ex.mine || 0) + 1; if (ex.left !== null && ex.left !== undefined) ex.left -= 1;
            rerender();
            done(ex, res);
        });
    }));
    host.querySelector('[data-fm-code]')?.addEventListener('click', () => codeDialog(ctx, () => rerender(true)));
}

window.crafterFestiveExchange = {html, bind, tile};
})();
