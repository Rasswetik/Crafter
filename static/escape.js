/* Crafter Escape: a ball bounces inside a ring with a gap, every bounce is +0.2x, the ball leaves through the gap and falls on the
   green part (the bet times the multiplier) or on the red part (the bet is lost). The server settles the round and returns the
   result together with the revealed seed; this file only plays the already decided round, and can verify it. */
(function () {
'use strict';
const ui = {info: null, level: 'mid', bet: 0.1, busy: false, hash: '', play: null, raf: 0, idleStart: 0, sound: true, loading: false, skin: 'lol-pop'};
const LADDER = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
const GAP = {lite: 1.45, mid: 1.0, epic: 0.62};              // the gap in radians (the smaller, the harder)
const fmt = (n, d) => { const v = Number(n); return Number.isFinite(v) ? v.toLocaleString('ru-RU', {maximumFractionDigits: d == null ? 2 : d}) : '—'; };
const h = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
const root = () => document.querySelector('#main');
const alive = () => state.page === 'escape' && root()?.querySelector('.esc');
const SVG = (path, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + path + '</svg>';
const escapeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-8-8"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>';
if (typeof gameNavIcons !== 'undefined') gameNavIcons.escape = escapeIcon;
window.crafterEscapeIcon = escapeIcon;

/* ---------- sound: a short soft tick per bounce, rising with the multiplier ---------- */
let audio = null;
function tone(freq, dur, gain, type) {
    if (!ui.sound) return;
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const o = audio.createOscillator(), g = audio.createGain(), now = audio.currentTime;
        o.type = type || 'sine'; o.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(gain, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        o.connect(g); g.connect(audio.destination); o.start(now); o.stop(now + dur + 0.02);
    } catch (_) {}
}

/* ---------- verification of a finished round (anybody can recompute it) ---------- */
async function hmac(seed, text) {
    const enc = new TextEncoder(), key = await crypto.subtle.importKey('raw', enc.encode(seed), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
async function draw(round, index) {
    const d = await hmac(round.seed, round.client_seed + ':' + round.nonce + ':' + index);
    let n = 0; for (let i = 0; i < 6; i++) n = n * 256 + d[i];
    return n / 281474976710656;
}
async function sha(text) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return Array.from(d).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verify(round) {
    const level = (ui.info?.levels || []).find(l => l.key === round.level);
    if (!level) return false;
    if (await sha(round.seed) !== round.hash) return false;
    let bounces = 0;
    while (bounces < 80 && (await draw(round, bounces)) >= level.exit) bounces++;
    const win = (await draw(round, 1000)) < level.green;
    return bounces === round.bounces && win === round.win;
}

/* ---------- page ---------- */
function render() {
    const main = root(); if (!main) return;
    const info = ui.info;
    const best = (label, b) => '<div class="esc-luck"><span>' + label + '</span><b>' + (b ? h(b.name) : '—') + '</b><i>' + (b ? '+' + fmt(b.profit) : '') + '</i></div>';
    main.innerHTML = '<section class="esc">' +
        '<div class="esc-top"><button type="button" class="esc-ico" data-esc="history" aria-label="История раундов">' + SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') + '</button>' +
        '<button type="button" class="esc-ico" data-esc="rules" aria-label="Как играть">' + SVG('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 17v.01"/>') + '</button>' +
        '<button type="button" class="esc-ico" data-esc="sound" aria-label="Звук">' + SVG(ui.sound ? '<path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="M16 9a4 4 0 0 1 0 6"/>' : '<path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="M16 9l5 6M21 9l-5 6"/>') + '</button>' +
        '</div>' +
        '<div class="esc-lucks">' + best('Удача недели', info?.best_week) + best('Удача дня', info?.best_day) + '</div>' +
        '<div class="esc-stage" id="esc-stage"><canvas id="esc-canvas"></canvas>' +
        '<div class="esc-hint">Каждый отскок: <b>+' + h(info?.step || '0.2') + 'x</b></div></div>' +
        '<div class="esc-hash">Хеш: <b id="esc-hash">' + h(short(ui.hash)) + '</b><button type="button" id="esc-copy" aria-label="Копировать хеш">' + SVG('<rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>') + '</button></div>' +
        '<div class="esc-row"><div class="esc-seg" id="esc-levels">' + ((info?.levels || []).map(l => '<button type="button" data-level="' + l.key + '" class="' + (l.key === ui.level ? 'is-on is-' + l.key : '') + '">' + h(l.name) + '</button>').join('')) + '</div></div>' +
        '<div class="esc-bet"><div class="esc-stepper"><button type="button" id="esc-minus" aria-label="Меньше">' + SVG('<path d="M6 12h12"/>') + '</button>' +
        '<input id="esc-amount" inputmode="decimal" value="' + h(fmt(ui.bet, 6)) + '" aria-label="Ставка"><span>GRAM</span><button type="button" id="esc-plus" aria-label="Больше">' + SVG('<path d="M12 6v12M6 12h12"/>') + '</button></div>' +
        '<button type="button" class="esc-go" id="esc-go"></button></div></section>';
    bind(); paintGo(); fit(); startLoop();
}
function short(hash) { return hash ? hash.slice(0, 4) + '…' + hash.slice(-4) : '…'; }
function balance() { return Number(state.me?.balance || 0); }
function paintGo() {
    const go = document.querySelector('#esc-go'); if (!go) return;
    const lack = balance() < ui.bet - 1e-9;
    go.disabled = ui.busy || lack; go.classList.toggle('is-busy', ui.busy);
    go.innerHTML = ui.busy ? '<span>Играем…</span>' : '<span>Ставка ' + h(fmt(ui.bet, 6)) + ' GRAM</span>' + (lack ? '<small>Недостаточно средств</small>' : '');
}
function setBet(v) {
    const min = Number(ui.info?.min_bet || 0.1), max = Number(ui.info?.max_bet || 200);
    ui.bet = Math.min(max, Math.max(min, Math.round(v * 1e6) / 1e6));
    const input = document.querySelector('#esc-amount'); if (input) input.value = fmt(ui.bet, 6);
    paintGo();
}
function stepBet(dir) {
    const next = dir > 0 ? LADDER.find(v => v > ui.bet + 1e-9) : [...LADDER].reverse().find(v => v < ui.bet - 1e-9);
    if (next !== undefined) setBet(next);
}
function bind() {
    const q = s => document.querySelector(s);
    q('#esc-plus').addEventListener('click', () => { if (!ui.busy) stepBet(1); });
    q('#esc-minus').addEventListener('click', () => { if (!ui.busy) stepBet(-1); });
    q('#esc-amount').addEventListener('change', e => { const v = parseFloat(String(e.target.value).replace(',', '.').replace(/\s/g, '')); setBet(Number.isFinite(v) ? v : ui.bet); });
    q('#esc-levels').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        if (ui.busy) return; ui.level = b.dataset.level;
        q('#esc-levels').querySelectorAll('button').forEach(x => x.className = x.dataset.level === ui.level ? 'is-on is-' + ui.level : '');
        ui.idleStart = performance.now();
    }));
    q('#esc-go').addEventListener('click', playRound);
    q('#esc-copy').addEventListener('click', () => { navigator.clipboard?.writeText(ui.hash); toast('Хеш скопирован'); });
    document.querySelectorAll('[data-esc]').forEach(b => b.addEventListener('click', () => {
        const kind = b.dataset.esc;
        if (kind === 'history') openHistory(); else if (kind === 'rules') openRules();
        else { ui.sound = !ui.sound; render(); }
    }));
}
function openRules() {
    const edge = ui.info ? Math.round((1 - ui.info.rtp) * 100) : 4;
    sheet('Как играть', '<div class="esc-rules"><p>Шар прыгает внутри кольца. Каждый отскок от стенки прибавляет <b>+' + h(ui.info?.step || '0.2') + 'x</b> к множителю, он начинается с <b>1.0x</b>.</p>' +
        '<p>Рано или поздно шар вылетает через разрыв и падает на пол. <b>Зелёная часть</b>: вы получаете ставку, умноженную на множитель. <b>Красная часть (череп)</b>: ставка сгорает.</p>' +
        '<p>Сложность меняет размер разрыва: на <b>Lite</b> шар вылетает быстро и чаще падает на зелёное, на <b>Epic</b> отскоков больше и множители выше, но зелёной части меньше.</p>' +
        '<p><b>Честная игра.</b> До раунда вы видите хеш серверного числа. После раунда мы раскрываем само число, и в истории можно проверить, что результат посчитан именно из него. Преимущество платформы около ' + edge + '%.</p></div>');
}
async function openHistory() {
    sheet('История раундов', '<div class="esc-hist"><p class="esc-muted">Загрузка…</p></div>');
    try {
        const data = await api('escape/history');
        const box = document.querySelector('.esc-hist'); if (!box) return;
        if (!data.rounds.length) { box.innerHTML = '<p class="esc-muted">Раундов пока нет.</p>'; return; }
        box.innerHTML = data.rounds.map((r, i) => '<div class="esc-h ' + (r.win ? 'is-win' : 'is-lose') + '"><div><b>' + (r.win ? '+' + fmt(r.payout) : '−' + fmt(r.bet)) + ' GRAM</b>' +
            '<small>' + h(r.level.toUpperCase()) + ' · ставка ' + fmt(r.bet) + ' · ' + r.bounces + ' отск. · ' + fmt(r.multiplier, 1) + 'x · ' + new Date(r.created * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + '</small></div>' +
            '<button type="button" data-verify="' + i + '">Проверить</button><code>seed ' + h(r.seed) + '<br>hash ' + h(r.hash) + '<br>client ' + h(r.client_seed) + ' · nonce ' + r.nonce + '</code></div>').join('');
        box.querySelectorAll('[data-verify]').forEach(btn => btn.addEventListener('click', async () => {
            btn.textContent = '…'; let ok = false;
            try { ok = await verify(data.rounds[Number(btn.dataset.verify)]); } catch (_) {}
            btn.textContent = ok ? 'Честно' : 'Не сошлось'; btn.classList.add(ok ? 'is-ok' : 'is-bad');
        }));
    } catch (e) { const box = document.querySelector('.esc-hist'); if (box) box.innerHTML = '<p class="esc-muted">' + h(e.message) + '</p>'; }
}

/* ---------- the canvas ---------- */
const W = 480, H = 560, CX = 240, CY = 232, R = 150, FLOOR = 506, BALL = 15;
let cv = null, ctx = null;
function fit() {
    cv = document.querySelector('#esc-canvas'); if (!cv) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function greenShare() { const l = (ui.info?.levels || []).find(x => x.key === ui.level); return Math.max(0.28, Math.min(0.62, (l?.green || 0.6) * 0.62)); }
const rnd = (seed, i) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };

/* the scripted round: where the ball touches the wall, and when the gap is in front of it */
function script(round) {
    const gap = GAP[round.level] || 1, n = round.bounces, seed = parseInt(round.hash.slice(0, 8), 16) % 100000;
    const leg = Math.max(0.16, Math.min(0.62, 9 / (n + 2)));            // long games are played faster
    const omega = (round.level === 'epic' ? 1.5 : round.level === 'mid' ? 1.15 : 0.9) * (rnd(seed, 90) > 0.5 ? 1 : -1);
    const g0 = rnd(seed, 91) * Math.PI * 2;
    const gapAt = t => g0 + omega * t;
    const hits = [];                                                     // {t, a}: time and the angle on the ring
    let t = 0.5, prev = -Math.PI / 2;
    for (let i = 0; i < n; i++) {
        t += leg * (0.85 + 0.3 * rnd(seed, i));
        let a = prev + Math.PI * (0.55 + 0.9 * rnd(seed, i + 200)) * (rnd(seed, i + 300) > 0.5 ? 1 : -1);
        const d = Math.atan2(Math.sin(a - gapAt(t)), Math.cos(a - gapAt(t)));
        if (Math.abs(d) < gap / 2 + 0.3) a += gap + 0.6;                  // never touch the wall inside the gap
        hits.push({t, a}); prev = a;
    }
    const tExit = t + leg * 1.1, aExit = gapAt(tExit);
    const green = greenShare(), landX = round.win ? 24 + (W * green - 48) * round.landing : W * green + 24 + (W * (1 - green) - 48) * round.landing;
    return {hits, tExit, aExit, gapAt, gap, landX, leg, tLand: tExit + 0.85, tEnd: tExit + 2.4, n, win: round.win, mult: Number(round.multiplier), round};
}
const pt = a => [CX + Math.cos(a) * (R - BALL), CY + Math.sin(a) * (R - BALL)];
function ballAt(sc, t) {
    const pts = [{t: 0, p: [CX, CY - 90]}].concat(sc.hits.map(h => ({t: h.t, p: pt(h.a)}))); pts.push({t: sc.tExit, p: pt(sc.aExit)});
    if (t < sc.tExit) {                                                  // between two wall points: a light arc
        let i = 1; while (i < pts.length - 1 && pts[i].t <= t) i++;
        const a = pts[i - 1], b = pts[i], u = Math.max(0, Math.min(1, (t - a.t) / Math.max(0.05, b.t - a.t)));
        return [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u - Math.sin(u * Math.PI) * 22];
    }
    // the exit: out through the gap and down to the floor
    const e = pt(sc.aExit), y0 = CY + Math.sin(sc.aExit) * (R + 30);
    const u = Math.max(0, Math.min(1, (t - sc.tExit) / (sc.tLand - sc.tExit)));
    const x = e[0] + (sc.landX - e[0]) * (u * 0.55 + u * u * 0.45);
    const y = y0 + (FLOOR - BALL - y0) * (u * u) - Math.sin(Math.min(1, u * 1.4) * Math.PI) * 38;
    return [x, Math.min(FLOOR - BALL, y)];
}
let burst = [], floats = [], trail = [], pulse = 0, lastMult = 1, popAt = 0;
const SKINS = ['lol-pop', 'heart-locket', 'plush-pepe', 'swiss-watch', 'diamond-ring', 'eternal-rose', 'jelly-bunny', 'kissed-frog', 'magic-potion', 'mini-oscar', 'loot-bag', 'hanging-star', 'durovs-cap'];
const skinImages = {};
function skinImage(name) {
    if (!skinImages[name]) { const im = new Image(); im.src = '/static/assets/escape/' + name + '.png'; skinImages[name] = im; }
    return skinImages[name];
}
function pickSkin() { return SKINS[Math.floor(Math.random() * SKINS.length)]; }
function drawBall(x, y, skin, scale) {
    const im = skinImage(skin), r = BALL * (scale || 1) + 3;
    ctx.save();
    ctx.shadowColor = 'rgba(90,150,255,.85)'; ctx.shadowBlur = 20;
    ctx.fillStyle = '#16203f'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r - 1.5, 0, 7); ctx.clip();
    if (im.complete && im.naturalWidth) ctx.drawImage(im, x - r, y - r, r * 2, r * 2);
    else { const g = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, r); g.addColorStop(0, '#9bd0ff'); g.addColorStop(1, '#2f6fe0'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.restore();
}
function profitText(round) {
    const p = round.win ? Number(round.payout) - Number(round.bet) : -Number(round.bet);
    const body = Math.abs(p).toLocaleString('en-US', {maximumFractionDigits: 4});
    return p === 0 ? '0' : (p > 0 ? '+' : '-') + body;
}
function drawScene(now) {
    if (!ctx) return;
    const sc = ui.play, lvl = ui.level, gap = GAP[lvl] || 1;
    ctx.clearRect(0, 0, W, H);
    // the background: a soft glow behind the ring and a few stars
    let g = ctx.createRadialGradient(CX, CY, 20, CX, CY, 300); g.addColorStop(0, 'rgba(60,70,160,.34)'); g.addColorStop(1, 'rgba(10,12,24,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 34; i++) { const tw = 0.5 + 0.5 * Math.sin(now / 700 + i * 1.7); ctx.fillStyle = 'rgba(190,205,255,' + (0.14 + 0.2 * tw) + ')'; ctx.beginPath(); ctx.arc((i * 97 + 31) % W, (i * 61 + 17) % 470, 1.2 + (i % 3) * 0.55, 0, 7); ctx.fill(); }
    // the pit: the floor with a green part (the bag) and a red part (the skull)
    const green = greenShare(), gw = W * green, fy = FLOOR;
    g = ctx.createLinearGradient(0, fy - 6, 0, H); g.addColorStop(0, '#1ee27b'); g.addColorStop(0.35, '#0f9c52'); g.addColorStop(1, '#063a1e'); ctx.fillStyle = g; ctx.fillRect(0, fy, gw, H - fy);
    g = ctx.createLinearGradient(0, fy - 6, 0, H); g.addColorStop(0, '#ff4a5c'); g.addColorStop(0.35, '#c4202f'); g.addColorStop(1, '#4a0a14'); ctx.fillStyle = g; ctx.fillRect(gw, fy, W - gw, H - fy);
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(0, fy, W, 2.5);
    ctx.fillStyle = '#28d977'; ctx.beginPath(); ctx.arc(gw / 2, fy - 30, 21, 0, 7); ctx.fill(); ctx.fillStyle = '#04290f'; ctx.font = '800 26px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', gw / 2, fy - 29);
    const sx = gw + (W - gw) / 2; ctx.fillStyle = '#ffe9e9'; ctx.beginPath(); ctx.arc(sx, fy - 34, 18, 0, 7); ctx.fill(); ctx.fillRect(sx - 10, fy - 28, 20, 15);
    ctx.fillStyle = '#7a0d17'; ctx.beginPath(); ctx.arc(sx - 6.5, fy - 35, 4.4, 0, 7); ctx.arc(sx + 6.5, fy - 35, 4.4, 0, 7); ctx.fill(); ctx.fillRect(sx - 1.5, fy - 29, 3, 5);
    // the time of the scripted round
    let t, mult = 1, hits = 0;
    if (sc) { t = (now - sc.started) / 1000; hits = sc.hits.filter(h => h.t <= t).length; mult = 1 + 0.2 * hits; } else t = (now - ui.idleStart) / 1000;
    if (mult !== lastMult) { lastMult = mult; popAt = now; }
    // the ring: a soft halo, tick marks, the bright stroke with the gap
    const ga = sc ? sc.gapAt(t) : 1.2 + t * 0.9, hit = sc ? sc.hits.some(h => t - h.t > 0 && t - h.t < 0.2) : false;
    pulse = hit ? 1 : pulse * 0.88;
    ctx.lineCap = 'round';
    ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(26,127,255,' + (0.1 + 0.16 * pulse) + ')'; ctx.beginPath(); ctx.arc(CX, CY, R, ga + gap / 2, ga - gap / 2 + Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 9; ctx.strokeStyle = pulse > 0.4 ? '#69b4ff' : '#1a7fff'; ctx.shadowColor = '#1a7fff'; ctx.shadowBlur = 12 + 22 * pulse;
    ctx.beginPath(); ctx.arc(CX, CY, R, ga + gap / 2, ga - gap / 2 + Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(CX, CY, R - 2.5, ga + gap / 2 + 0.05, ga - gap / 2 + Math.PI * 2 - 0.05); ctx.stroke();
    for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2 - now / 6000; const d = Math.atan2(Math.sin(a - ga), Math.cos(a - ga)); if (Math.abs(d) < gap / 2) continue; ctx.strokeStyle = 'rgba(160,200,255,.18)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(CX + Math.cos(a) * (R - 22), CY + Math.sin(a) * (R - 22)); ctx.lineTo(CX + Math.cos(a) * (R - 15), CY + Math.sin(a) * (R - 15)); ctx.stroke(); }
    // the multiplier in the middle, it pops on every bounce
    const k = Math.max(0, 1 - (now - popAt) / 260), sizeNow = (sc ? 50 : 44) + (sc ? Math.min(12, hits * 1.4) : 0) + 12 * k;
    ctx.fillStyle = sc ? (mult >= 3 ? '#ffd36b' : mult >= 2 ? '#d49bff' : '#ffffff') : 'rgba(255,255,255,.5)';
    ctx.shadowColor = sc && mult >= 2 ? 'rgba(200,140,255,.7)' : 'rgba(0,0,0,0)'; ctx.shadowBlur = 16;
    ctx.font = '800 ' + sizeNow + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(mult.toFixed(1) + 'x', CX, CY + 6); ctx.shadowBlur = 0;
    // the ball with its trail
    let bx, by;
    if (sc) [bx, by] = ballAt(sc, t); else { bx = CX; by = CY - 96 + Math.sin(t * 2.2) * 10; }
    if (sc) { trail.push([bx, by]); if (trail.length > 14) trail.shift(); trail.forEach(([tx, ty], i) => { ctx.fillStyle = 'rgba(120,180,255,' + (i / trail.length * 0.28) + ')'; ctx.beginPath(); ctx.arc(tx, ty, BALL * (0.35 + 0.55 * i / trail.length), 0, 7); ctx.fill(); }); } else trail = [];
    drawBall(bx, by, ui.skin, 1);
    // sparks on every bounce, the tick sounds, the landing
    if (sc) {
        sc.hits.forEach((hh, i) => { if (t >= hh.t && !sc.fired[i]) { sc.fired[i] = 1; const [px, py] = pt(hh.a); for (let q = 0; q < 9; q++) burst.push({x: px, y: py, vx: Math.cos(hh.a + Math.PI + (q - 4) * .3) * 80, vy: Math.sin(hh.a + Math.PI + (q - 4) * .3) * 80, life: 1}); tone(380 + Math.min(900, i * 55), 0.09, 0.05); } });
        if (t >= sc.tLand && !sc.landed) {
            sc.landed = true; tone(sc.win ? 880 : 130, sc.win ? 0.5 : 0.35, 0.07, sc.win ? 'sine' : 'triangle'); if (sc.win) setTimeout(() => tone(1175, 0.5, 0.06), 140);
            floats.push({x: Math.max(60, Math.min(W - 60, bx)), y: by - 34, text: profitText(sc.round), win: sc.win, born: now, sub: sc.win ? fmt(sc.round.multiplier, 1) + 'x' : ''});
            for (let q = 0; q < 16; q++) burst.push({x: bx, y: by, vx: (Math.random() - 0.5) * 170, vy: -Math.random() * 120, life: 1.2, c: sc.win ? '80,235,150' : '255,90,110'});
            landedRound(sc);
        }
    }
    burst = burst.filter(p => p.life > 0); burst.forEach(p => { p.x += p.vx / 60; p.y += p.vy / 60; p.vy += 2.4; p.life -= 0.035; ctx.fillStyle = 'rgba(' + (p.c || '120,190,255') + ',' + Math.max(0, p.life) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, 7); ctx.fill(); });
    if (sc && sc.landed) { const lit = sc.win ? [0, gw, '#12c963'] : [gw, W - gw, '#ff3a4a']; ctx.fillStyle = lit[2]; ctx.globalAlpha = 0.2 + 0.1 * Math.sin(now / 160); ctx.fillRect(lit[0], fy, lit[1], H - fy); ctx.globalAlpha = 1; }
    // the floating result over the ball: +0.2 or -0.1
    floats = floats.filter(f => now - f.born < 1700);
    floats.forEach(f => {
        const age = (now - f.born) / 1700, rise = 70 * (1 - Math.pow(1 - Math.min(1, age * 1.6), 3)), pop = age < 0.12 ? 0.6 + age / 0.12 * 0.5 : 1.1 - Math.min(0.1, (age - 0.12) * 0.3);
        ctx.save(); ctx.globalAlpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3; ctx.translate(f.x, f.y - rise); ctx.scale(pop, pop);
        ctx.font = '900 40px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(8,10,18,.92)'; ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = f.text === '0' ? '#cfd6e0' : f.win ? '#4be58f' : '#ff6b78'; ctx.shadowColor = f.text === '0' ? 'rgba(200,210,225,.5)' : f.win ? 'rgba(75,229,143,.7)' : 'rgba(255,107,120,.7)'; ctx.shadowBlur = 14; ctx.fillText(f.text, 0, 0); ctx.shadowBlur = 0;
        if (f.sub) { ctx.font = '800 17px system-ui,sans-serif'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(8,10,18,.9)'; ctx.strokeText(f.sub, 0, 28); ctx.fillStyle = '#e8d9ff'; ctx.fillText(f.sub, 0, 28); }
        ctx.restore();
    });
    return t;
}
function landedRound(sc) {
    if (state.me && ui.lastBalance != null) { state.me.balance = ui.lastBalance; if (typeof updateBalance === 'function') updateBalance(); }
    refreshHash();
}
function loop(now) {
    ui.raf = 0; if (!alive() || !cv) return;
    const t = drawScene(now);
    if (ui.play && t > ui.play.tEnd) { ui.play = null; ui.busy = false; ui.idleStart = now; paintGo(); }
    ui.raf = requestAnimationFrame(loop);
}
function startLoop() { if (!ui.raf) { ui.idleStart = performance.now(); ui.raf = requestAnimationFrame(loop); } }
function refreshHash() { const el = document.querySelector('#esc-hash'); if (el) el.textContent = short(ui.hash); }

async function playRound() {
    if (ui.busy) return;
    if (balance() < ui.bet - 1e-9) return toast('Недостаточно GRAM на балансе');
    ui.busy = true; paintGo();
    ui.skin = pickSkin();
    const rid = 'esc-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2));
    try {
        const data = await api('escape/play', {bet: String(ui.bet), level: ui.level, request_id: rid});
        const r = data.round;
        ui.hash = data.next_hash || ui.hash; ui.lastBalance = data.balance;
        const sc = script(r); sc.started = performance.now(); sc.fired = []; sc.landed = false; ui.play = sc; startLoop();
    } catch (e) { ui.busy = false; paintGo(); toast(e.message); }
}

async function loadInfo() {
    const data = await api('escape/state'); ui.info = data; ui.hash = data.hash;
    ui.bet = Math.max(Number(data.min_bet), Math.min(ui.bet, Number(data.max_bet)));
    return data;
}

/* ---------- navigation and the tile in the Games hub ---------- */
const goBefore = go;
go = async function (page, ...rest) {
    const app = document.querySelector('#app');
    app?.classList.toggle('escape-view', page === 'escape');
    if (page !== 'escape') { if (ui.raf) { cancelAnimationFrame(ui.raf); ui.raf = 0; } return goBefore.call(this, page, ...rest); }
    if (state.crafting) return;
    if (state.page === 'arena' && typeof leaveArena === 'function') leaveArena();
    state.gamesMode = true; state.page = 'escape';
    app?.classList.remove('craft-view', 'cart-view'); app?.classList.add('games-view');
    document.querySelector('#cart-float')?.remove();
    if (typeof nav === 'function') nav();
    if (typeof updateBalance === 'function') updateBalance();
    ui.busy = false; ui.play = null; ui.skin = pickSkin();
    const main = root(); if (main) main.innerHTML = '<div class="esc"><p class="esc-muted" style="padding:40px;text-align:center">Загрузка…</p></div>';
    try { if (!state.me) state.me = await api('me'); else if (typeof refreshMe === 'function') await refreshMe(); await loadInfo(); } catch (e) { if (main) main.innerHTML = '<div class="error">' + h(e.message) + '</div><button class="secondary" onclick="go(\'escape\')">Повторить</button>'; return; }
    if (state.page === 'escape') render();
};

function addTile() {
    const wrap = document.querySelector('#main .crafter-games');
    if (!wrap || wrap.querySelector('.escape-tile') || (typeof crafterCanSeeMode === 'function' && !crafterCanSeeMode('escape'))) return;
    const tile = document.createElement('button');
    tile.type = 'button'; tile.className = 'crafter-game-tile escape-tile'; tile.addEventListener('click', () => go('escape'));
    tile.innerHTML = '<span class="crafter-game-label"><strong>Escape</strong><span>Шар в кольце: каждый отскок даёт +0.2x</span><span class="crafter-game-open">Играть</span></span>' +
        '<span class="escape-art" aria-hidden="true"><i class="escape-ring"></i><i class="escape-ball"></i><i class="escape-star s1"></i><i class="escape-star s2"></i><i class="escape-star s3"></i></span>' +
        '<span class="escape-online" title="Игроков за последние 10 минут"><i></i><span id="esc-online">0</span></span>';
    const upgrade = wrap.querySelector('.crafter-upgrade-tile');
    if (upgrade) upgrade.after(tile); else wrap.appendChild(tile);
    api('escape/state').then(d => { const n = document.querySelector('#esc-online'); if (n) n.textContent = d.online; }).catch(() => {});
}
if (typeof renderGamesHub === 'function') {
    const hubBefore = renderGamesHub;
    renderGamesHub = function () { hubBefore.apply(this, arguments); addTile(); };
}
})();
