/* Freebies inside the special market: a tile among the offers (the picture of the event: a background, a gift and a title) and a window
   with a row of gift boxes of one size. An open box is pressed, the reward is given and the box is replaced by what was received. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
let offset = 0;
const nowSec = () => Math.floor(Date.now() / 1000) + offset;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function left(s) {
    if (s <= 0) return '';
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? d + 'д ' + h + 'ч' : h ? h + 'ч ' + m + 'м' : m + 'м ' + (s % 60) + 'с';
}
const LOCK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2ZM9 7a3 3 0 0 1 6 0v2H9V7Z"/></svg>';

/* ---------- the tile among the offers of the market ---------- */
function card(ev) {
    if (ev.now) offset = ev.now - Math.floor(Date.now() / 1000);
    const next = ev.next_unlock ? ev.next_unlock - nowSec() : 0;
    const tab = ev.ready ? 'Забрать!' : next > 0 ? left(next) : (ev.total && ev.claimed >= ev.total ? 'Собрано' : '');
    return '<div class="fm-card fm-fbcard fm-s-wide' + (ev.ready ? ' has-ready' : '') + '" data-fm="fb:' + e(ev.id) + '" style="--u:2" tabindex="0" role="button" aria-label="' + e(ev.title) + '">' +
        (tab ? '<span class="fm-tab fb-tab' + (ev.ready ? ' is-ready' : '') + '" data-fb-next="' + (ev.next_unlock || 0) + '" data-fb-ready="' + (ev.ready ? 1 : 0) + '">' + e(tab) + '</span>' : '') +
        '<div class="fm-body"><i class="fbt-bg" style="background-image:url(' + e(ev.preview_bg) + ')"></i><i class="fbt-shade"></i>' +
        '<img class="fbt-gift" src="' + e(ev.preview_gift) + '" alt="" draggable="false"><h3 class="fbt-title">' + e(ev.title) + '</h3>' + (ev.ready ? '<i class="fbt-dot"></i>' : '') + '</div></div>';
}

/* the picture of the background is mirrored again and again, so the page can be as long as it likes */
const tiles = new Map();
function tileBg(url, width) {
    const key = url + '|' + width;
    if (tiles.has(key)) return tiles.get(key);
    const p = new Promise(resolve => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => {
            try {
                const w = width, h = Math.round(im.height * w / im.width), c = document.createElement('canvas');
                c.width = w * 2; c.height = h * 2;
                const g = c.getContext('2d');
                [[0, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, -1], [1, 1, -1, -1]].forEach(([cx, cy, sx, sy]) => { g.save(); g.translate(cx * w + (sx < 0 ? w : 0), cy * h + (sy < 0 ? h : 0)); g.scale(sx, sy); g.drawImage(im, 0, 0, w, h); g.restore(); });
                resolve({url: c.toDataURL('image/jpeg', .82), w: w * 2, h: h * 2});
            } catch (_) { resolve({url, w: width, h: Math.round(im.height * width / im.width)}); }
        };
        im.onerror = () => resolve({url, w: width, h: width});
        im.src = url;
    });
    tiles.set(key, p);
    return p;
}

/* ---------- the boxes ---------- */
function box(g, ev) {
    const img = g.golden ? ev.gift_gold : ev.gift_regular;
    const cls = 'fb-gift is-' + g.state + (g.golden ? ' is-gold' : '') + (g.size === 'large' ? ' fb-large' : '');
    if (g.state === 'claimed') {
        const r = g.reward || {};
        return '<div class="' + cls + ' fb-got" data-fb="' + e(g.id) + '"><div class="fb-plate"><span class="fb-check">✓</span><b>' + e(g.label) + '</b>' + (r.image ? '<img src="' + e(r.image) + '" alt="" draggable="false">' : '') + '<strong>' + e(r.title || '') + '</strong><small>Получено</small></div></div>';
    }
    const wait = g.unlock_at - nowSec();
    return '<div class="' + cls + '" data-fb="' + e(g.id) + '"><button type="button" class="fb-boxbtn" aria-label="' + e(g.label) + '"><img class="fb-img" src="' + e(img) + '" alt="" draggable="false"><span class="fb-label">' + e(g.label) + '</span>' + (g.state === 'ready' ? '<i class="fb-shine"></i>' : '') + '</button>' +
        (g.state === 'locked' ? '<div class="fb-lock">' + LOCK + '<em data-fb-t="' + g.unlock_at + '">' + left(wait) + '</em></div>' : '') + '</div>';
}
/* the same window as after a purchase in the market, only «Получено»: a pack can be opened at once or kept in the inventory */
function showReveal(ev, res) {
    const f = window.crafterFestive;
    if (!f || !f.reveal) { toast('Вы получили: ' + (res.result.title || 'подарок')); return; }
    const r = res.result, isPack = Boolean(res.pack_ids && res.pack_ids.length);
    const it = {id: 'fb', kind: isPack ? 'PACK' : r.kind, title: r.title, rarity: 'special', bundle: r.count || 1, left: null, mine: 0, price_balls: 0, image_url: r.image,
        pack: isPack ? {image: r.image, title: r.title, id: ''} : null};
    const result = isPack ? {packIds: res.pack_ids, count: res.pack_ids.length, head: 'Получено', title: 'Вы получили: <b>' + e(r.title) + '</b>'}
        : {head: 'Получено', title: 'Вы получили: ' + e(r.title), text: r.kind === 'BALL' ? 'Шары уже на вашем балансе.' : r.kind === 'GRAM' ? 'GRAM уже на вашем балансе.' : 'Подарок уже в разделе «Мои подарки».'};
    const el = f.reveal({it}, result, {refresh() {}}, () => {});
    // the background of the window is the background of the freebies, mirrored
    if (el && ev.page_bg) {
        let bg = el.querySelector('.fm-rv-bg');
        if (!bg) { bg = document.createElement('div'); bg.className = 'fm-rv-bg'; el.insertBefore(bg, el.firstChild); }
        bg.style.backgroundImage = 'url(' + ev.page_bg + ')'; bg.style.backgroundSize = 'cover';
        tileBg(ev.page_bg, innerWidth < 760 ? 520 : 900).then(t => { if (!bg.isConnected) return; bg.style.backgroundImage = 'url(' + t.url + ')'; bg.style.backgroundSize = t.w + 'px ' + t.h + 'px'; bg.style.backgroundRepeat = 'repeat'; });
        el.classList.add('fm-rv-fb');
    }
}
function mount(host, ev, nav) {
    if (ev.now) offset = ev.now - Math.floor(Date.now() / 1000);
    host.innerHTML = '<div class="fb-row" id="fb-row">' + ev.gifts.map(g => box(g, ev)).join('') + '</div>' + (ev.gifts.length ? '' : '<p class="fb-empty">Подарки скоро появятся.</p>');
    const row = host.querySelector('#fb-row');
    const swap = g => { const old = row.querySelector('[data-fb="' + g.id + '"]'); if (!old) return; const t = document.createElement('div'); t.innerHTML = box(g, ev); const n = t.firstElementChild; old.replaceWith(n); bindBox(n); n.classList.add('fb-pop'); };
    const bindBox = el => {
        const claim = async () => {
            const g = ev.gifts.find(x => x.id === el.dataset.fb); if (!g || el.dataset.busy) return;
            if (g.state === 'locked') { toast('Откроется через ' + left(g.unlock_at - nowSec())); return; }
            el.dataset.busy = '1'; el.classList.add('is-opening');
            try {
                const res = await api('freebies/claim', {gift_id: g.id});
                if (typeof window.crafterNewYearUpdateBalance === 'function') window.crafterNewYearUpdateBalance(res.balance);
                if (res.gram_balance !== undefined && state?.me) { state.me.balance = res.gram_balance; if (typeof updateBalance === 'function') updateBalance(); }
                if (!reduced()) await new Promise(r => setTimeout(r, 480));
                g.state = 'claimed'; g.reward = res.result; ev.ready = Math.max(0, ev.ready - 1); ev.claimed++;
                swap(g);
                showReveal(ev, res);
            } catch (error) { el.classList.remove('is-opening'); delete el.dataset.busy; toast(error.message); }
        };
        el.querySelector('.fb-boxbtn')?.addEventListener('click', claim);
    };
    row.querySelectorAll('.fb-gift').forEach(bindBox);
    const tick = () => {
        if (!host.isConnected || !row.isConnected) return;
        row.querySelectorAll('[data-fb-t]').forEach(t => {
            const s = Number(t.dataset.fbT) - nowSec();
            if (s <= 0) { const g = ev.gifts.find(x => x.id === t.closest('[data-fb]').dataset.fb); if (g && g.state === 'locked') { g.state = 'ready'; ev.ready++; swap(g); } } else t.textContent = left(s);
        });
        setTimeout(tick, 1000);
    };
    tick();
}
window.crafterFreebies = {card, mount, tileBg, left};
})();
