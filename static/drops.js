/* Drops (Snowman Drop): four attempts to raise the rarity of one drop, then one reward.
   The server decides everything; this file only shows it: the star turns around on every tap, the background and the title follow the rarity,
   four glossy orbs under the star are the attempts. window.crafterDrops = {open, afterPurchase, mount, chances} */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = '/static/assets/drops/';
const RAR = ['common', 'rare', 'epic', 'mythic', 'legendary', 'secret'];
const NAMES = {common: 'Обычный', rare: 'Редкий', epic: 'Эпический', mythic: 'Мифический', legendary: 'Легендарный', secret: 'Секретный'};
const EN = {common: 'Common', rare: 'Rare', epic: 'Epic', mythic: 'Mythic', legendary: 'Legendary', secret: 'Secret'};
const COLORS = {common: '#b9cde0', rare: '#4aa8ff', epic: '#c25bff', mythic: '#ff4f78', legendary: '#ffb62e', secret: '#27f0d6'};
const FRAMES = ['front-000', 'turn-045', 'turn-090', 'turn-135', 'turn-180', 'turn-225', 'turn-270', 'turn-315', 'front-000'].map(n => A + 'snowman-' + n + '.webp');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rid = () => 'dr-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU', {maximumFractionDigits: 6}) : String(v); };
const preload = urls => Promise.all(urls.map(u => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = u; })));
const toast = m => { try { (window.toast || window.crafterToast || (() => {}))(m); } catch (_) {} };
const thumb = (u, w) => /^\/(static\/assets\/(chests|packs)\/[\w.-]+\.(png|webp|jpe?g)|media\/shop\/[0-9a-f]{32})$/.test(u || '') ? '/thumb?u=' + encodeURIComponent(u) + '&w=' + w : u;

/* pseudo-3D from the flat picture: the picture is stacked in many layers (each deeper one a bit darker and smaller: a rounded, smooth side),
   the back view lies behind them - when the solid turns around the vertical axis it has a real thickness and a back */
const solidHTML = (front, back, n) => {
    const d = n > 9 ? 2.2 : 3.4;
    let out = '';
    for (let i = n; i >= 1; i--) out += '<i class="ps-l" style="--z:' + (-i * d).toFixed(1) + 'px;--b:' + (1 - Math.min(.5, i * .5 / n)).toFixed(2) + ';--k:' + (1 - i * .0032).toFixed(4) + '"><img alt="" draggable="false" src="' + front + '"></i>';
    out += '<i class="ps-l ps-back" style="--z:' + (-(n + 1) * d).toFixed(1) + 'px"><img alt="" draggable="false" src="' + back + '"></i>';
    out += '<i class="ps-l ps-front"><img class="dr-front" alt="" draggable="false" src="' + front + '"><i class="dr-shine"></i></i>';
    return out;
};
const orbs = (s) => {                                    // four attempts: spent ones keep the colour of the rarity they brought, the next one is a «?»
    let out = '';
    for (let i = 0; i < 4; i++) {
        const spent = i < s.attempt, next = i === s.attempt && s.attempt < 4;
        const key = spent ? (s.history[i] || 'common') : '';
        out += '<i class="dr-orb' + (spent ? ' is-spent' : next ? ' is-next' : '') + '"' + (spent ? ' style="--oc:' + COLORS[key] + '"' : '') + '><b>' + (next ? '?' : spent ? '✓' : '') + '</b></i>';
    }
    return out;
};

async function chances(dropId) {
    const d = await api('drops/' + dropId + '/chances');
    document.querySelector('.dr-chances')?.remove();
    const el = document.createElement('div');
    el.className = 'dr-chances';
    const rar = d.rarities.map(r => '<div class="dr-ch-row" style="--oc:' + COLORS[r.key] + '"><span>' + e(NAMES[r.key]) + '</span><u><i style="width:' + Math.max(1, r.chance) + '%"></i></u><b>' + num(r.chance) + '%</b></div>').join('');
    const kinds = {GRAM: 'GRAM', BALL: 'Шары', PACK: 'Паки', NFT: 'NFT'};
    const kinds_html = Object.entries(d.kinds).map(([k, v]) => '<span class="dr-ch-pill">' + e(kinds[k] || k) + ' <b>' + num(v) + '%</b></span>').join('');
    const loot = d.loot.map(x => '<div class="dr-ch-it"><img src="' + e(thumb(x.image, 160)) + '" alt="" loading="lazy"><b>' + e(x.kind === 'GRAM' ? num(x.amount) + ' GRAM' : x.kind === 'BALL' ? num(x.amount) + ' шаров' : x.title) + '</b><small>' + (x.collection ? e(x.collection) + ' · ' : '') + num(x.chance) + '%</small></div>').join('');
    el.innerHTML = '<div class="dr-ch-box"><button type="button" class="dr-ch-x" aria-label="Закрыть">×</button><h2>Шансы</h2><p class="dr-ch-sub">Какая редкость будет после четырёх попыток и что может выпасть за один дроп.</p>' +
        '<div class="dr-ch-rar">' + rar + '</div><div class="dr-ch-kinds">' + kinds_html + '</div><h3>Все награды</h3><div class="dr-ch-loot">' + loot + '</div></div>';
    const close = () => el.remove();
    el.querySelector('.dr-ch-x').addEventListener('click', close);
    el.addEventListener('click', ev => { if (ev.target === el) close(); });
    document.body.appendChild(el);
}

async function open(dropId, opts) {
    opts = opts || {};
    let s;
    try { s = await api('drops/' + dropId + '/open', {}); } catch (err) { toast(err.message); return; }
    await preload([A + 'snowman-idle.webp', A + 'snowman-turn-180.webp', A + 'snowman-open-charge.webp', A + 'bg-common.webp?v=2']);
    document.querySelector('.dr-play')?.remove();
    const el = document.createElement('div');
    el.className = 'dr-play is-' + RAR[s.rarity];
    document.body.classList.add('dr-open');
    const hist = [];
    s.history = hist;
    el.innerHTML = '<div class="dr-bg"><i class="dr-bg-a"></i><i class="dr-bg-b"></i></div><i class="dr-rays"></i><div class="dr-fx"></div>' +
        '<div class="dr-top"><h1 class="dr-rarity" data-t="' + e(EN[RAR[s.rarity]]) + '">' + e(EN[RAR[s.rarity]]) + '</h1></div>' +
        '<div class="dr-snow">' + Array.from({length: 16}, (_, i) => '<i style="left:' + ((i * 61) % 100) + '%;--d:' + (7 + (i * 5) % 7) + 's;--w:' + ((i * 17) % 40 - 20) + 'px;--s:' + (3 + (i * 3) % 5) + 'px;animation-delay:-' + ((i * 3) % 9) + 's"></i>').join('') + '</div><i class="dr-rflash"></i>' +
        '<div class="dr-stage"><div class="dr-halo"></div><i class="dr-ground"></i><div class="dr-orbit" aria-hidden="true">' + Array.from({length: 7}, (_, i) => { const a = i * 2 * Math.PI / 7, r = 36 + (i % 3) * 6; return '<i style="left:' + (50 + r * Math.cos(a)).toFixed(1) + '%;top:' + (50 + r * Math.sin(a)).toFixed(1) + '%;--s:' + (10 + (i % 3) * 5) + 'px;--t:' + (2.2 + (i % 4) * .5).toFixed(1) + 's;animation-delay:-' + (i * .7).toFixed(1) + 's"></i>'; }).join('') + '</div><button type="button" class="dr-star" aria-label="Улучшить дроп"><span class="ps3d dr-solid">' + solidHTML(A + 'snowman-idle.webp', A + 'snowman-turn-180.webp', innerWidth < 760 ? 8 : 14) + '</span></button><i class="dr-ring"></i><i class="dr-ring r2"></i><i class="dr-wave"></i><i class="dr-flash"></i></div>' +
        '<div class="dr-bottom"><h2 class="dr-title">Попытки улучшения</h2><div class="dr-orbs"></div><p class="dr-hint">Нажмите на экран</p></div>' +
        '<div class="dr-reward" hidden></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const $ = q => el.querySelector(q);
    const star = $('.dr-star'), img = $('.dr-front'), solidEl = $('.dr-solid'), orbsEl = $('.dr-orbs'), titleEl = $('.dr-rarity'), stage = $('.dr-stage'), fx = $('.dr-fx');
    const setBg = r => { $('.dr-bg-a').style.backgroundImage = 'url(' + A + 'bg-' + RAR[r] + '.webp?v=2)'; };
    const drawOrbs = pop => { orbsEl.innerHTML = orbs(s); orbsEl.setAttribute('aria-label', 'Осталось попыток: ' + s.attempts_left); if (pop !== undefined) orbsEl.children[pop]?.classList.add('is-pop'); };
    setBg(s.rarity);
    // a session that was already started: the history of the attempts is not shown (the server does not give the future); the past is drawn as the current rarity
    for (let i = 0; i < s.attempt; i++) hist.push(RAR[s.rarity]);
    drawOrbs();
    let busy = false, finished = false;
    const done = () => { finished = true; document.body.classList.remove('dr-open'); el.classList.remove('is-in'); setTimeout(() => el.remove(), 260); opts.onDone && opts.onDone(); opts.refresh && opts.refresh(); };
    const center = () => { const r = stage.getBoundingClientRect(), f = el.getBoundingClientRect(); return [r.left - f.left + r.width / 2, r.top - f.top + r.height / 2]; };
    // sparks fly out of the star: small stars, snowflakes and dots in the colour of the rarity
    const burst = (n, power, color) => {
        if (reduced()) return;
        const [cx, cy] = center();
        for (let i = 0; i < n; i++) {
            const d = document.createElement('i');
            d.className = 'dr-spark k' + (i % 3);
            const ang = Math.random() * Math.PI * 2, dist = (80 + Math.random() * 150) * power;
            d.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;--dx:' + Math.cos(ang) * dist + 'px;--dy:' + (Math.sin(ang) * dist - 30 * power) + 'px;--s:' + (.5 + Math.random() * .9) + ';--r:' + (Math.random() * 720 - 360) + 'deg;--c:' + (i % 4 === 0 ? '#fff' : color) + ';animation-delay:' + Math.random() * 90 + 'ms';
            fx.appendChild(d);
            setTimeout(() => d.remove(), 1300);
        }
    };
    const shake = (amp, ms) => { if (!reduced()) stage.animate([{transform: 'translate(0,0)'}, {transform: 'translate(' + amp + 'px,' + -amp / 2 + 'px)'}, {transform: 'translate(' + -amp + 'px,' + amp / 2 + 'px)'}, {transform: 'translate(' + amp / 2 + 'px,0)'}, {transform: 'translate(0,0)'}], {duration: ms, easing: 'ease-out'}); };
    const flip = async () => {                            // anticipation, a jump with one full turn around the vertical axis through the eight views, a soft landing
        if (reduced()) { await sleep(160); return; }
        solidEl.classList.add('is-flipping');
        const an = solidEl.animate([
            {transform: 'rotateY(0deg) translateY(0) scale(1.05,.93)', offset: 0}, {transform: 'rotateY(-24deg) translateY(-3%) scale(.97,1.05)', offset: .14},
            {transform: 'rotateY(180deg) translateY(-13%) scale(1.13)', offset: .52}, {transform: 'rotateY(360deg) translateY(0) scale(1.07,.92)', offset: .88}, {transform: 'rotateY(360deg) translateY(0) scale(1)', offset: 1}
        ], {duration: 780, easing: 'ease-in-out'});
        try { await an.finished; } catch (_) {}
        solidEl.classList.remove('is-flipping');
    };
    const pulse = cls => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
    const showReward = async (rw, color) => {
        const r = $('.dr-reward');
        const label = rw.kind === 'GRAM' ? num(rw.amount) + ' GRAM' : rw.kind === 'BALL' ? num(rw.amount) + ' шаров' : rw.title;
        const conf = Array.from({length: 34}, (_, i) => '<i style="left:' + ((i * 29) % 100) + '%;--d:' + (2.4 + (i * 7) % 20 / 10).toFixed(1) + 's;--w:' + ((i * 23) % 80 - 40) + 'px;--c:' + [color, '#ffffff', '#ffd36b', '#7cc8ff', '#ff7a9a'][i % 5] + ';animation-delay:' + ((i * 13) % 12 / 10).toFixed(1) + 's"></i>').join('');
        r.innerHTML = '<div class="dr-conf">' + conf + '</div><span class="dr-rw-chip">' + e(EN[RAR[s.rarity]]) + '</span><div class="dr-rw-art"><i class="dr-rw-rays"></i><i class="dr-rw-aura"></i><img src="' + e(thumb(rw.image, 480)) + '" alt=""></div><div class="dr-rw-plate"><h2>' + e(label) + '</h2></div>' +
            (rw.kind === 'NFT' ? '<small class="dr-rw-note">NFT · уже в вашем инвентаре</small>' : rw.kind === 'PACK' ? '<small class="dr-rw-note">Закрытый пак · в инвентаре</small>' : '') +
            '<div class="dr-rw-btns">' + (s.qty > 0 ? '<button type="button" class="dr-btn is-main" data-more>Следующий дроп (' + s.qty + ')</button>' : '') + '<button type="button" class="dr-btn" data-done>Готово</button></div>';
        r.hidden = false; void r.offsetWidth; r.classList.add('is-pop');
        burst(34, 1.5, color);
        r.querySelector('[data-done]').addEventListener('click', done);
        r.querySelector('[data-more]')?.addEventListener('click', () => { el.remove(); document.body.classList.remove('dr-open'); open(dropId, opts); });
    };
    const reveal = async rw => {                          // the star charges and trembles, flashes, bursts: the reward appears on its place
        const color = COLORS[RAR[s.rarity]];
        $('.dr-bottom').classList.add('is-gone'); $('.dr-top').classList.add('is-gone');
        el.classList.add('is-charge');
        img.src = A + 'snowman-open-charge.webp';
        if (!reduced()) star.animate([{transform: 'translate(0,0) scale(1)'}, {transform: 'translate(-6px,2px) scale(1.04)'}, {transform: 'translate(6px,-2px) scale(1.07)'}, {transform: 'translate(-8px,0) scale(1.1)'}, {transform: 'translate(8px,2px) scale(1.14)'}, {transform: 'translate(0,0) scale(1.2)'}], {duration: 640, easing: 'ease-in', fill: 'forwards'});
        await sleep(reduced() ? 150 : 700);
        el.classList.add('is-flash', 'is-pop-out'); shake(14, 520); burst(46, 1.7, color);
        if (!reduced()) star.animate([{transform: 'scale(1.2)', opacity: 1}, {transform: 'scale(1.7)', opacity: 0}], {duration: 240, easing: 'ease-out', fill: 'forwards'});
        await sleep(reduced() ? 80 : 140);
        await showReward(rw, color);
    };
    const tap = async () => {
        if (busy || finished || s.attempt >= s.attempts) return;
        busy = true; el.classList.add('is-busy');
        $('.dr-hint').textContent = '';
        let res;
        try {
            const [r] = await Promise.all([api('drops/sessions/' + s.session_id + '/tap', {request_id: rid(), revision: s.revision}), sleep(120)]);
            res = r;
        } catch (err) {
            if (err.status === 409) { try { s = {...await api('drops/sessions/' + s.session_id), history: hist}; drawOrbs(); } catch (_) {} } else toast(err.message);
            busy = false; el.classList.remove('is-busy'); $('.dr-hint').textContent = 'Нажмите на экран'; return;
        }
        await flip();
        const up = res.rarity > s.rarity, color = COLORS[RAR[res.rarity]];
        hist[res.attempt - 1] = RAR[res.rarity];
        res.history = hist; Object.assign(s, res);
        if (up) {
            el.className = el.className.replace(/is-(common|rare|epic|mythic|legendary|secret)/, 'is-' + RAR[res.rarity]);
            const bb = $('.dr-bg-b'); bb.style.transition = 'none'; bb.style.backgroundImage = $('.dr-bg-a').style.backgroundImage; bb.style.opacity = 1; setBg(res.rarity); void bb.offsetWidth; bb.style.transition = 'opacity .7s'; bb.style.opacity = 0; setTimeout(() => { bb.style.backgroundImage = ''; }, 800);
            titleEl.textContent = EN[RAR[res.rarity]]; titleEl.dataset.t = EN[RAR[res.rarity]]; pulse('is-up');
            burst(18 + res.rarity * 4, 1 + res.rarity * .12, color); shake(5 + res.rarity, 360);
        } else { pulse('is-same'); burst(7, .6, color); }
        img.src = A + 'snowman-idle.webp';
        drawOrbs(res.attempt - 1);
        if (res.state === 'revealed') { await sleep(300); await reveal(res.reward); return; }
        $('.dr-hint').textContent = 'Нажмите на экран';
        busy = false; el.classList.remove('is-busy');
    };
    el.addEventListener('click', ev => { if (ev.target.closest('.dr-reward')) return; tap(); });
    el.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && !finished) { ev.preventDefault(); tap(); } });
    let tiltRaf = 0;
    el.addEventListener('pointermove', ev => {
        if (busy || tiltRaf || reduced()) return;
        tiltRaf = requestAnimationFrame(() => { tiltRaf = 0; const r = star.getBoundingClientRect(); const dx = (ev.clientX - (r.left + r.width / 2)) / innerWidth, dy = (ev.clientY - (r.top + r.height / 2)) / innerHeight; star.style.setProperty('--ry', (dx * 26).toFixed(1) + 'deg'); star.style.setProperty('--rx', (-dy * 18).toFixed(1) + 'deg'); });
    });
    star.focus();
}

/* a drop that was just bought lies in the inventory: it is opened at once, the rest of the stack waits */
async function afterPurchase(granted, opts) {
    if (granted && granted.drop) await open(granted.drop.id, opts);
}

/* a strip on the market page: «you have N drops — open» (also when an opening was not finished) */
async function mount(root) {
    try {
        const r = await api('drops');
        root.querySelector('.dr-strip')?.remove();
        const list = (r.drops || []).filter(d => d.qty > 0 || d.session_id);
        if (!list.length) return;
        const strip = document.createElement('div');
        strip.className = 'dr-strip';
        strip.innerHTML = list.map(d => '<button type="button" class="dr-chip" data-drop="' + e(d.id) + '"><img src="' + e(d.image) + '" alt=""><span><b>' + e(d.title) + '</b><small>' + (d.session_id ? 'Продолжить' + (d.qty > 1 ? ' · ждут: ' + d.qty : '') : 'Открыть · ждут: ' + d.qty) + '</small></span></button>').join('');
        strip.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', () => open(b.dataset.drop, {onDone: () => mount(root)})));
        const head = root.querySelector('.fm-head, .fm-top'); if (head) head.insertAdjacentElement('afterend', strip); else root.prepend(strip);
    } catch (_) {}
}

window.crafterDrops = {open, afterPurchase, mount, chances};
})();
