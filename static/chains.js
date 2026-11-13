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

/* ---------- the window: the main gift on the left, the other steps as slides on the right ---------- */
const pill = r => r.kind === 'GRAM' ? String(r.amount) : r.kind === 'BALL' ? num(r.amount) : r.kind === 'NFT' ? '1' : '×' + (r.count || 1);
const prizeName = r => r.kind === 'NFT' ? r.title : r.kind === 'GRAM' ? 'GRAM' : r.kind === 'BALL' ? 'Шары' : r.title.replace(/ ×\d+$/, '');
function footer(s) {
    const state = s.state || 'locked', free = s.price_balls === 0;
    return state === 'done' ? '<span class="chn-done">Куплено</span>'
        : state === 'locked' ? '<span class="chn-lock">' + LOCK + '<em>Сначала возьмите предыдущий шаг</em></span>'
        : free ? '<span class="chn-take is-free">ПОДАРОК</span>'
        : '<span class="chn-take">' + ORN + '<b>' + num(s.price_balls) + '</b></span>';
}
function prizes(s) {
    const list = s.rewards && s.rewards.length ? s.rewards : [{kind: s.kind, amount: s.amount, count: s.count, title: s.reward_title, image: s.image}];
    return '<div class="chn-prizes n' + Math.min(list.length, 6) + '">' + list.map(r => '<div class="chn-prize" title="' + e(r.title) + '"><img src="' + e(r.image) + '" alt="" draggable="false"><b class="chn-pill">' + e(pill(r)) + '</b><small>' + e(prizeName(r)) + '</small></div>').join('') + '</div>';
}

function stage(ch, ctx) {
    document.querySelector('.fm-chainstage')?.remove();
    const el = document.createElement('div');
    el.className = 'fm-stage fm-chainstage';
    if (ch.bg && ch.bg.indexOf('image:') === 0) el.style.backgroundImage = 'url(' + ch.bg.slice(6) + ')';
    const bal = () => num(ctx.balance ? ctx.balance() : 0);
    const main = ch.steps[0], slides = ch.steps.slice(1);
    let cur = Math.max(0, slides.findIndex(x => x.state === 'ready'));
    if (cur < 0 || (main.state === 'ready' && slides.length)) cur = 0;
    const mainHTML = () => '<div class="chn-main st-' + (main.state || 'locked') + '" data-chn-step="' + e(main.id) + '"><div class="chn-main-pic"><img src="' + e(main.image) + '" alt="" draggable="false"></div>' +
        '<div class="chn-main-info"><b>' + e(main.reward_title) + '</b>' + (main.caption ? '<small>' + e(main.caption) + '</small>' : '') + '</div><div class="chn-foot">' + footer(main) + '</div></div>';
    const slideHTML = () => {
        const s = slides[cur];
        return '<div class="chn-slide st-' + (s.state || 'locked') + '" data-chn-step="' + e(s.id) + '"><div class="chn-slide-head"><b>' + e(s.label) + '</b>' + (s.caption ? '<small>' + e(s.caption) + '</small>' : '') + '</div>' + prizes(s) + '<div class="chn-foot">' + footer(s) + '</div></div>';
    };
    const sideHTML = () => !slides.length ? '' : '<div class="chn-side"><button type="button" class="chn-nav l" data-chn-go="-1" aria-label="Назад"' + (cur ? '' : ' disabled') + '>‹</button>' + slideHTML() +
        '<button type="button" class="chn-nav r" data-chn-go="1" aria-label="Дальше"' + (cur < slides.length - 1 ? '' : ' disabled') + '>›</button><div class="chn-dots">' + slides.map((x, i) => '<i class="' + (i === cur ? 'is-on ' : '') + 'd-' + (x.state || 'locked') + '" data-chn-dot="' + i + '"></i>').join('') + '</div></div>';
    const draw = () => {
        el.querySelector('.chn-body').innerHTML = mainHTML() + sideHTML();
        bind();
    };
    el.innerHTML = '<button type="button" class="fm-back" data-chn-close aria-label="Назад"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></button>' +
        '<span class="fm-bal">' + ORN + '<b data-chn-bal>' + bal() + '</b></span>' +
        '<header class="chn-head"><h2>' + e(ch.title) + '</h2>' + (ch.subtitle ? '<p>' + e(ch.subtitle) + '</p>' : '') + '</header>' +
        '<div class="chn-body"></div><p class="chn-err" role="alert"></p><div class="chn-ask" hidden><div><b>Подтвердить?</b><span data-chn-what></span><button type="button" class="chn-yes">ДА</button><button type="button" class="chn-no">Отмена</button></div></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 260); document.removeEventListener('keydown', onKey); ctx.refresh && ctx.refresh(); };
    const go = d => { const n = Math.max(0, Math.min(slides.length - 1, cur + d)); if (n !== cur) { cur = n; draw(); } };
    const onKey = ev => {
        if (document.querySelector('.cx-play,.fm-reveal')) return;
        if (ev.key === 'Escape') close(); else if (ev.key === 'ArrowRight') go(1); else if (ev.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    el.querySelector('[data-chn-close]').addEventListener('click', close);
    const err = el.querySelector('.chn-err'), ask = el.querySelector('.chn-ask');
    const popup = (s, res) => {
        const o = document.createElement('div');
        o.className = 'chn-got';
        o.innerHTML = '<div class="chn-got-box"><small>' + e(s.label) + '</small><img src="' + e(res.result.image) + '" alt=""><h3>' + e(res.result.title) + '</h3><p>Готово</p><button type="button">Отлично</button></div>';
        document.body.appendChild(o);
        requestAnimationFrame(() => o.classList.add('is-in'));
        o.addEventListener('click', ev => { if (ev.target === o || ev.target.tagName === 'BUTTON') { o.classList.remove('is-in'); setTimeout(() => o.remove(), 200); } });
    };
    // the same window as after a purchase in the market: the prize flies up with sparks and rays
    const reveal = (s, res, rest) => {
        const f = window.crafterFestive;
        if (!f || !f.reveal) { popup(s, res); return; }
        const list = rest && rest.length ? rest : (res.result.rewards || []);
        const isPack = Boolean(res.pack_ids && res.pack_ids.length);
        const firstPack = list.find(r => r.kind === 'PACK');
        const title = list.map(r => r.title).join(' + ') || res.result.title;
        const pic = isPack && firstPack ? firstPack.image : (list[0] && list[0].image) || res.result.image;
        const it = {id: 'chain', kind: isPack ? 'PACK' : list[0] ? list[0].kind : 'GRAM', title, rarity: 'special', bundle: isPack ? res.pack_ids.length : 1, left: null, mine: 0, price_balls: 0, image_url: pic,
            pack: isPack ? {image: pic, title: firstPack ? firstPack.title : title, id: ''} : null, card_bg: ch.bg && ch.bg.indexOf('image:') === 0 ? ch.bg : ''};
        const extra = [];
        if (res.nfts && res.nfts.length) extra.push('NFT уже в вашем инвентаре' + (res.nfts.some(n => n.credited) ? ' (где нельзя выдать — зачислена стоимость в GRAM)' : ''));
        if (res.gift_ids && res.gift_ids.length) extra.push('Подарки Telegram — в разделе «Мои подарки»');
        if (list.some(r => r.kind === 'GRAM' || r.kind === 'BALL')) extra.push('GRAM и шары уже на балансе');
        const result = isPack ? {packIds: res.pack_ids, count: res.pack_ids.length, head: 'Получено', title: 'Вы получили: <b>' + e(title) + '</b>'} : {head: 'Получено', title: 'Вы получили: ' + e(title), text: extra.join('. ') || 'Награда получена.'};
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
            const at = slides.indexOf(nx); if (at >= 0) cur = at;               // the next slide opens by itself
            draw();
            if (res.chest_opens && window.crafterChests) await window.crafterChests.playMany(res.chest_opens, {bg: 'cozy', toast, refresh() {}});
            const rest = (res.result.rewards || []).filter(r => r.kind !== 'CHEST');
            if (rest.length || !res.chest_opens) reveal(s, res, rest);
        } catch (error) { err.textContent = error.message; toast(error.message); }
        busy = false;
    };
    let pending = null;
    ask.querySelector('.chn-no').addEventListener('click', () => { ask.hidden = true; pending = null; });
    ask.querySelector('.chn-yes').addEventListener('click', () => { const s = pending; ask.hidden = true; pending = null; if (s) claim(s); });
    const take = s => {
        if (!s || s.state !== 'ready' || busy) return;
        if (s.price_balls) { pending = s; ask.querySelector('[data-chn-what]').innerHTML = e(s.reward_title) + ' · ' + ORN + '<b>' + num(s.price_balls) + '</b>'; ask.hidden = false; } else claim(s);
    };
    function bind() {
        el.querySelectorAll('[data-chn-go]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); go(Number(b.dataset.chnGo)); }));
        el.querySelectorAll('[data-chn-dot]').forEach(d => d.addEventListener('click', () => { cur = Number(d.dataset.chnDot); draw(); }));
        // a tap on a ready card takes the step; a swipe over the slides turns them
        el.querySelectorAll('.chn-main.st-ready,.chn-slide.st-ready').forEach(card => card.addEventListener('click', () => take(ch.steps.find(x => x.id === card.dataset.chnStep))));
        const side = el.querySelector('.chn-side');
        if (side) {
            let x0 = null;
            side.addEventListener('pointerdown', ev => { x0 = ev.clientX; });
            side.addEventListener('pointerup', ev => { if (x0 !== null && Math.abs(ev.clientX - x0) > 50) { go(ev.clientX < x0 ? 1 : -1); ev.stopPropagation(); } x0 = null; }, true);
        }
    }
    draw();
    return el;
}

window.crafterChains = {card, stage};
})();
