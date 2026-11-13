/* Chains of offers in the market: a wide tile among the offers and a window with a row of steps (the main gift first, then the next steps with arrows).
   A step is free («ПОДАРОК») or costs balls; the next step opens when the previous one is taken. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const num = n => Number(n).toLocaleString('ru-RU');
const ORN = '<img class="chn-ball" src="/static/assets/new-year-ornament.svg" alt="">';
const ARROW = '<svg viewBox="0 0 48 48" width="42" height="42" aria-hidden="true"><path d="M8 18h18v-9l16 15-16 15v-9H8z" fill="#fff" stroke="#16143a" stroke-width="3" stroke-linejoin="round"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2ZM9 7a3 3 0 0 1 6 0v2H9V7Z"/></svg>';
const bgStyle = ch => ch.bg && ch.bg.indexOf('image:') === 0 ? 'background-image:url(' + e(ch.bg.slice(6)) + ')' : '';

/* ---------- the tile ---------- */
function card(ch) {
    const next = ch.steps.find(s => s.state === 'ready'), first = ch.steps[0] || {};
    const free = next && next.price_balls === 0;
    return '<div class="fm-card fm-chaincard r-special fm-s-wide' + (free ? ' has-ready' : '') + '" data-fm="ch:' + e(ch.id) + '" style="--u:2" tabindex="0" role="button" aria-label="' + e(ch.title) + '">' +
        (next ? '<span class="fm-tab fb-tab' + (free ? ' is-ready' : '') + '">' + (free ? 'Забрать!' : 'Шаг ' + (ch.done + 1) + ' из ' + ch.total) + '</span>' : '<span class="fm-tab">Собрано</span>') +
        '<div class="fm-body chn-tile' + (ch.bg ? ' has-bg' : '') + '" style="' + bgStyle(ch) + '"><h3 class="chn-t-title">' + e(ch.title) + '</h3>' + (ch.subtitle ? '<small class="chn-t-sub">' + e(ch.subtitle) + '</small>' : '') +
        '<img class="chn-t-main" src="' + e(first.image) + '" alt="" draggable="false">' +
        '<div class="chn-t-steps">' + ch.steps.slice(0, 6).map(s => '<i class="chn-dot is-' + e(s.state || 'locked') + '"><img src="' + e(s.image) + '" alt="" draggable="false"></i>').join('') + (ch.steps.length > 6 ? '<b>+' + (ch.steps.length - 6) + '</b>' : '') + '</div></div></div>';
}

/* ---------- a step ---------- */
function step(s, i) {
    const main = i === 0, state = s.state || 'locked', free = s.price_balls === 0;
    const foot = state === 'done' ? '<span class="chn-done">Куплено</span>'
        : state === 'locked' ? '<span class="chn-lock">' + LOCK + '</span>'
        : free ? '<button type="button" class="chn-take is-free" data-chn-take="' + e(s.id) + '">ПОДАРОК</button>'
        : '<button type="button" class="chn-take" data-chn-take="' + e(s.id) + '">' + ORN + '<b>' + num(s.price_balls) + '</b></button>';
    return '<div class="chn-step ' + (main ? 'is-main' : 'is-small') + ' st-' + state + '" data-chn-step="' + e(s.id) + '"><div class="chn-label">' + e(s.label) + '</div>' +
        '<div class="chn-pic"><img src="' + e(s.image) + '" alt="" draggable="false"></div>' +
        '<div class="chn-name"><b>' + e(s.reward_title) + '</b>' + (s.caption ? '<small>' + e(s.caption) + '</small>' : '') + '</div><div class="chn-foot">' + foot + '</div></div>';
}

/* ---------- the window ---------- */
function stage(ch, ctx) {
    document.querySelector('.fm-chainstage')?.remove();
    const el = document.createElement('div');
    el.className = 'fm-stage fm-chainstage';
    if (ch.bg && ch.bg.indexOf('image:') === 0) el.style.backgroundImage = 'url(' + ch.bg.slice(6) + ')';
    const bal = () => num(ctx.balance ? ctx.balance() : 0);
    const draw = () => {
        el.querySelector('.chn-row').innerHTML = ch.steps.map((s, i) => (i ? '<span class="chn-arrow">' + ARROW + '</span>' : '') + step(s, i)).join('');
        bind();
    };
    el.innerHTML = '<button type="button" class="fm-back" data-chn-close aria-label="Назад"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></button>' +
        '<span class="fm-bal">' + ORN + '<b data-chn-bal>' + bal() + '</b></span>' +
        '<header class="chn-head"><h2>' + e(ch.title) + '</h2>' + (ch.subtitle ? '<p>' + e(ch.subtitle) + '</p>' : '') + '</header>' +
        '<div class="chn-row"></div><p class="chn-err" role="alert"></p><div class="chn-ask" hidden><div><b>Подтвердить?</b><span data-chn-what></span><button type="button" class="chn-yes">ДА</button><button type="button" class="chn-no">Отмена</button></div></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 260); document.removeEventListener('keydown', onKey); ctx.refresh && ctx.refresh(); };
    const onKey = ev => { if (ev.key === 'Escape' && !document.querySelector('.cx-play,.fm-reveal')) close(); };
    document.addEventListener('keydown', onKey);
    el.querySelector('[data-chn-close]').addEventListener('click', close);
    const err = el.querySelector('.chn-err'), ask = el.querySelector('.chn-ask');
    const popup = (s, res) => {
        const o = document.createElement('div');
        o.className = 'chn-got';
        o.innerHTML = '<div class="chn-got-box"><small>' + e(s.label) + '</small><img src="' + e(res.result.image) + '" alt=""><h3>' + e(res.result.title) + '</h3><p>' +
            (res.nft ? 'NFT уже в вашем инвентаре' + (res.nft.credited ? ': зачислена стоимость ' + e(res.nft.credited) + ' GRAM' : '') : res.gift_ids ? 'Подарок в разделе «Мои подарки»' : s.kind === 'GRAM' ? 'GRAM уже на вашем балансе' : s.kind === 'BALL' ? 'Шары уже на вашем балансе' : 'Готово') +
            '</p><button type="button">Отлично</button></div>';
        document.body.appendChild(o);
        requestAnimationFrame(() => o.classList.add('is-in'));
        o.addEventListener('click', ev => { if (ev.target === o || ev.target.tagName === 'BUTTON') { o.classList.remove('is-in'); setTimeout(() => o.remove(), 200); } });
    };
    // the same window as after a purchase in the market: a pack (or the prize) flies up with sparks and rays
    const reveal = (s, res) => {
        const f = window.crafterFestive;
        if (!f || !f.reveal) { popup(s, res); return; }
        const r = res.result, isPack = Boolean(res.pack_ids && res.pack_ids.length);
        const it = {id: 'chain', kind: isPack ? 'PACK' : r.kind, title: r.title, rarity: 'special', bundle: res.pack_ids ? res.pack_ids.length : 1, left: null, mine: 0, price_balls: 0, image_url: r.image,
            pack: isPack ? {image: r.image, title: r.title, id: ''} : null, card_bg: ch.bg && ch.bg.indexOf('image:') === 0 ? ch.bg : ''};
        const text = res.nft ? 'NFT уже в вашем инвентаре' + (res.nft.credited ? ': зачислена стоимость ' + res.nft.credited + ' GRAM' : '') : res.gift_ids ? 'Подарок уже в разделе «Мои подарки».' : r.kind === 'BALL' ? 'Шары уже на вашем балансе.' : r.kind === 'GRAM' ? 'GRAM уже на вашем балансе.' : 'Награда получена.';
        const result = isPack ? {packIds: res.pack_ids, count: res.pack_ids.length, head: 'Получено', title: 'Вы получили: <b>' + e(r.title) + '</b>'} : {head: 'Получено', title: 'Вы получили: ' + e(r.title), text};
        f.reveal({it}, result, {refresh() {}}, () => {});
    };
    let busy = false;
    const claim = async s => {
        if (busy) return;
        busy = true; err.textContent = '';
        try {
            const res = await api('chains/claim', {step_id: s.id});
            if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(res.balance);
            if (res.gram_balance !== undefined && state?.me) { state.me.balance = res.gram_balance; if (typeof updateBalance === 'function') updateBalance(); }
            const b = el.querySelector('[data-chn-bal]'); if (b && res.balance) b.textContent = num(res.balance.balls);
            s.state = 'done'; ch.done++;
            const nx = ch.steps.find(x => x.state === 'locked'); if (nx) nx.state = 'ready';
            draw();
            if (res.chest_open && window.crafterChests) window.crafterChests.play(res.chest_open, {bg: 'cozy', toast, refresh() {}});
            else reveal(s, res);
        } catch (error) { err.textContent = error.message; toast(error.message); }
        busy = false;
    };
    let pending = null;
    ask.querySelector('.chn-no').addEventListener('click', () => { ask.hidden = true; pending = null; });
    ask.querySelector('.chn-yes').addEventListener('click', () => { const s = pending; ask.hidden = true; pending = null; if (s) claim(s); });
    function bind() {
        // the whole ready card is the button: a tap anywhere on it takes the step (the foot of the card may be out of sight on a small screen)
        el.querySelectorAll('.chn-step.st-ready').forEach(card => card.addEventListener('click', () => {
            const s = ch.steps.find(x => x.id === card.dataset.chnStep); if (!s || busy) return;
            if (s.price_balls) { pending = s; ask.querySelector('[data-chn-what]').innerHTML = e(s.reward_title) + ' · ' + ORN + '<b>' + num(s.price_balls) + '</b>'; ask.hidden = false; } else claim(s);
        }));
    }
    draw();
    return el;
}

window.crafterChains = {card, stage};
})();
