/* Crafter Escape: a ball bounces inside a ring with a gap. The game starts at 0x, every bounce on the wall adds the step of the level
   (Lite +0.1x, Mid +0.15x, Epic +0.2x). The ball leaves through the gap and falls on the green part (bet x multiplier) or on the red part.
   The server settles the round and sends the number of bounces together with the revealed seed. Here the ball is a real physical body:
   the ring is simulated with gravity and elastic hits until exactly that number of bounces has happened, then the gap swings to the place
   where the ball touches the ring and the ball leaves through it. Every round can be verified in the history. */
(function () {
'use strict';
const ui = {info: null, level: 'mid', bet: 0.1, busy: false, hash: '', play: null, raf: 0, idleStart: 0, sound: true, lastBalance: null};
const LADDER = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
const GAP = {lite: 1.05, mid: 0.9, epic: 0.74};
const OMEGA = {lite: 0.8, mid: 1.0, epic: 1.25};
const fmt = (n, d) => { const v = Number(n); return Number.isFinite(v) ? v.toLocaleString('ru-RU', {maximumFractionDigits: d == null ? 2 : d}) : '—'; };
const h = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
const root = () => document.querySelector('#main');
const alive = () => state.page === 'escape' && root()?.querySelector('.esc');
const SVG = (path) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
const escapeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-8-8"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>';
if (typeof gameNavIcons !== 'undefined') gameNavIcons.escape = escapeIcon;
window.crafterEscapeIcon = escapeIcon;
const levelInfo = key => (ui.info?.levels || []).find(l => l.key === (key || ui.level)) || {step: '0.15', exit: 0.08, green: 0.55};
const stepOf = key => Number(levelInfo(key).step);
const multText = m => (Math.round(m * 100) / 100) + 'x';

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
    const level = levelInfo(round.level);
    if (!ui.info || await sha(round.seed) !== round.hash) return false;
    let bounces = 0;
    while (bounces < 60 && (await draw(round, bounces)) >= level.exit) bounces++;
    const win = (await draw(round, 1000)) < level.green;
    return bounces === round.bounces && win === round.win;
}

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
        '<div class="esc-hint">Каждый отскок: <b id="esc-step">+' + h(levelInfo().step) + 'x</b></div></div>' +
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
        const st = q('#esc-step'); if (st) st.textContent = '+' + levelInfo().step + 'x';
    }));
    q('#esc-go').addEventListener('click', playRound);
    q('#esc-copy').addEventListener('click', () => { navigator.clipboard?.writeText(ui.hash); if (typeof toast === 'function') toast('Хеш скопирован'); });
    document.querySelectorAll('[data-esc]').forEach(b => b.addEventListener('click', () => {
        const kind = b.dataset.esc;
        if (kind === 'history') openHistory(); else if (kind === 'rules') openRules();
        else { ui.sound = !ui.sound; render(); }
    }));
}
function openRules() {
    const edge = ui.info ? Math.round((1 - ui.info.rtp) * 100) : 4;
    sheet('Как играть', '<div class="esc-rules"><p>Игра начинается с <b>0x</b>. Шар прыгает внутри кольца, и каждый отскок от стенки прибавляет к множителю: <b>Lite +0.1x</b>, <b>Mid +0.15x</b>, <b>Epic +0.2x</b>.</p>' +
        '<p>Рано или поздно шар вылетает через разрыв и падает на пол. <b>Зелёная часть</b>: вы получаете ставку, умноженную на множитель. <b>Красная часть (череп)</b>: ставка сгорает.</p>' +
        '<p>Размер зелёной части показывает ваш шанс. Чем больше отскоков, тем выше множитель.</p>' +
        '<p><b>Честная игра.</b> До раунда вы видите хеш серверного числа. После раунда мы раскрываем само число, и в истории можно проверить, что результат посчитан именно из него. Преимущество платформы около ' + edge + '%.</p></div>');
}
async function openHistory() {
    sheet('История раундов', '<div class="esc-hist"><p class="esc-muted">Загрузка…</p></div>');
    try {
        const data = await api('escape/history');
        const box = document.querySelector('.esc-hist'); if (!box) return;
        if (!data.rounds.length) { box.innerHTML = '<p class="esc-muted">Раундов пока нет.</p>'; return; }
        box.innerHTML = data.rounds.map((r, i) => '<div class="esc-h ' + (r.win ? 'is-win' : 'is-lose') + '"><div><b>' + (r.win ? '+' + fmt(r.payout) : '−' + fmt(r.bet)) + ' GRAM</b>' +
            '<small>' + h(r.level.toUpperCase()) + ' · ставка ' + fmt(r.bet) + ' · ' + r.bounces + ' отск. · ' + fmt(r.multiplier, 2) + 'x · ' + new Date(r.created * 1000).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + '</small></div>' +
            '<button type="button" data-verify="' + i + '">Проверить</button><code>seed ' + h(r.seed) + '<br>hash ' + h(r.hash) + '<br>client ' + h(r.client_seed) + ' · nonce ' + r.nonce + '</code></div>').join('');
        box.querySelectorAll('[data-verify]').forEach(btn => btn.addEventListener('click', async () => {
            btn.textContent = '…'; let ok = false;
            try { ok = await verify(data.rounds[Number(btn.dataset.verify)]); } catch (_) {}
            btn.textContent = ok ? 'Честно' : 'Не сошлось'; btn.classList.add(ok ? 'is-ok' : 'is-bad');
        }));
    } catch (e) { const box = document.querySelector('.esc-hist'); if (box) box.innerHTML = '<p class="esc-muted">' + h(e.message) + '</p>'; }
}

/* ---------- the physics ---------- */
const W = 480, H = 560, CX = 240, CY = 228, R = 150, FLOOR = 508, BALL = 14;
const RIN = R - BALL - 4.5;
const PHYS = {g: 780, e: 0.86, minN: 250, dt: 1 / 240, maxT: 70};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function flight(ex) {
    let x = ex.x, y = ex.y, vx = ex.vx, vy = ex.vy, t = 0, out = false; const pts = [x, y];
    for (let i = 0; i < 3000; i++) {
        vy += PHYS.g * PHYS.dt; x += vx * PHYS.dt; y += vy * PHYS.dt; t += PHYS.dt; pts.push(x, y);
        const d = Math.hypot(x - CX, y - CY);
        if (d > R + BALL * 0.9) out = true; else if (out && d < R + BALL * 0.45) return null;
        if (x < -30 || x > W + 30) return null;
        if (y >= FLOOR - BALL) return {t, pts, x, y};
    }
    return null;
}
function gapPlan(contacts, exit, level, seed) {
    const half = GAP[level] / 2, need = half + 0.42, omega = OMEGA[level] * (seed % 2 ? 1 : -1);
    const wp = [{t: 0, a: (seed % 628) / 100}]; let prevT = 0, prev = wp[0].a;
    contacts.forEach(c => {
        let a = prev + omega * (c.t - prevT); const d = wrap(a - c.a);
        if (Math.abs(d) < need) a += (d >= 0 ? 1 : -1) * (need - Math.abs(d));
        wp.push({t: c.t, a}); prevT = c.t; prev = a;
    });
    let target = exit.a; while (target - prev > Math.PI) target -= 2 * Math.PI; while (target - prev < -Math.PI) target += 2 * Math.PI;
    wp.push({t: exit.t, a: target});
    const last = wp[wp.length - 1], before = wp[wp.length - 2];
    return {wp, speed: Math.abs(last.a - before.a) / Math.max(0.05, last.t - before.t)};
}
function gapAt(plan, ts) {
    const wp = plan.wp; if (ts <= wp[0].t) return wp[0].a; if (ts >= wp[wp.length - 1].t) return wp[wp.length - 1].a;
    let k = 0; while (k < wp.length - 2 && wp[k + 1].t <= ts) k++;
    const p0 = wp[k], p1 = wp[k + 1], dt = p1.t - p0.t, u = (ts - p0.t) / dt;
    const tan = i => { const a = wp[Math.max(0, i - 1)], b = wp[Math.min(wp.length - 1, i + 1)], s = (b.a - a.a) / Math.max(0.02, b.t - a.t); return Math.max(-5, Math.min(5, s)); };
    const m0 = tan(k) * dt, m1 = tan(k + 1) * dt, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p0.a + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1.a + (u3 - u2) * m1;
}
function buildRound(round) {
    const n = round.bounces, level = round.level, seed0 = parseInt(round.hash.slice(0, 8), 16);
    let fallback = null;
    for (let attempt = 0; attempt < 700; attempt++) {
        const r = mulberry(seed0 + attempt * 7919);
        let x = CX + (r() - 0.5) * 90, y = CY - 10 + (r() - 0.5) * 70; const ang = r() * 6.2832, sp = 170 + r() * 150;
        let vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp - 40, ts = 0, exit = null;
        const path = [x, y], contacts = [], maxSteps = Math.floor(PHYS.maxT / PHYS.dt);
        for (let i = 0; i < maxSteps; i++) {
            vy += PHYS.g * PHYS.dt; x += vx * PHYS.dt; y += vy * PHYS.dt; ts += PHYS.dt;
            const dx = x - CX, dy = y - CY, dist = Math.hypot(dx, dy);
            if (dist >= RIN) {
                const nx = dx / dist, ny = dy / dist, vn = vx * nx + vy * ny;
                if (vn > 40) {
                    const a = Math.atan2(dy, dx);
                    if (contacts.length < n) {
                        const back = Math.max(PHYS.minN, PHYS.e * vn);
                        vx -= (vn + back) * nx; vy -= (vn + back) * ny; x = CX + nx * (RIN - 0.5); y = CY + ny * (RIN - 0.5);
                        contacts.push({t: ts, a});
                    } else { exit = {t: ts, a, x, y, vx, vy}; path.push(x, y); break; }
                } else { x = CX + nx * RIN; y = CY + ny * RIN; vx -= Math.max(0, vn) * nx; vy -= Math.max(0, vn) * ny; }
            }
            path.push(x, y);
        }
        if (!exit) continue;
        const fl = flight(exit); if (!fl) continue;
        const plan = gapPlan(contacts, exit, level, seed0 + attempt);
        const cand = {path, contacts, exit, fl, plan};
        if (Math.sin(exit.a) > 0.3 && plan.speed < 4.5) return cand;
        if (!fallback) fallback = cand;
    }
    return fallback;
}
function script(round) {
    const built = buildRound(round); if (!built) return null;
    const info = levelInfo(round.level), green = Math.max(0.25, Math.min(0.75, info.green)), gw = W * green;
    const landX = round.win ? 26 + (gw - 52) * round.landing : gw + 26 + (W - gw - 52) * round.landing;
    const speed = Math.max(1, Math.min(4, built.exit.t / 9)), fspeed = Math.min(speed, 2);
    const lead = 0.5, tExit = lead + built.exit.t / speed, tLand = tExit + Math.max(0.45, built.fl.t / fspeed);
    return Object.assign(built, {round, speed, fspeed, lead, tExit, tLand, tEnd: tLand + 1.8, landX, fired: [], landed: false, step: Number(info.step)});
}
function ballAt(sc, t) {
    if (t <= sc.lead) return [sc.path[0], sc.path[1]];
    if (t < sc.tExit) {
        const f = (t - sc.lead) * sc.speed / PHYS.dt, i = Math.min(Math.floor(f), sc.path.length / 2 - 2), u = f - i;
        return [sc.path[2 * i] + (sc.path[2 * i + 2] - sc.path[2 * i]) * u, sc.path[2 * i + 1] + (sc.path[2 * i + 3] - sc.path[2 * i + 1]) * u];
    }
    const tau = Math.min(sc.fl.t, (t - sc.tExit) * sc.fspeed), f = tau / PHYS.dt, i = Math.min(Math.floor(f), sc.fl.pts.length / 2 - 2), u = f - i;
    let x = sc.fl.pts[2 * i] + (sc.fl.pts[2 * i + 2] - sc.fl.pts[2 * i]) * u, y = sc.fl.pts[2 * i + 1] + (sc.fl.pts[2 * i + 3] - sc.fl.pts[2 * i + 1]) * u;
    const k = Math.min(1, tau / sc.fl.t); x += (sc.landX - sc.fl.x) * k * k;
    return [x, Math.min(y, FLOOR - BALL)];
}

/* ---------- the canvas ---------- */
let cv = null, ctx = null, burst = [], floats = [], trail = [], pulse = 0, lastMult = 0, popAt = 0;
function fit() {
    cv = document.querySelector('#esc-canvas'); if (!cv) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function greenShare() { return Math.max(0.25, Math.min(0.75, levelInfo().green)); }
function drawBall(x, y) {
    const r = BALL;
    ctx.save();
    ctx.shadowColor = 'rgba(90,150,255,.8)'; ctx.shadowBlur = 18;
    const g = ctx.createRadialGradient(x - 5, y - 6, 2, x, y, r + 2); g.addColorStop(0, '#c9e4ff'); g.addColorStop(0.45, '#4f95f0'); g.addColorStop(1, '#2557c8');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - 4.6, y - 2, 3.6, 0, 7); ctx.arc(x + 4.6, y - 2, 3.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#10244f'; ctx.beginPath(); ctx.arc(x - 3.8, y - 1.4, 1.7, 0, 7); ctx.arc(x + 5.4, y - 1.4, 1.7, 0, 7); ctx.fill();
    ctx.strokeStyle = '#10244f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y + 3.5, 4, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.restore();
}
function profitText(round) {
    const p = (round.win ? Number(round.payout) : 0) - Number(round.bet);
    const body = Math.abs(p).toLocaleString('en-US', {maximumFractionDigits: 4});
    return Math.abs(p) < 1e-9 ? '0' : (p > 0 ? '+' : '-') + body;
}
function drawScene(now) {
    if (!ctx) return 0;
    const sc = ui.play, lvl = ui.level, gapTotal = GAP[lvl] || 0.9, step = stepOf(lvl);
    ctx.clearRect(0, 0, W, H);
    let g = ctx.createRadialGradient(CX, CY, 20, CX, CY, 300); g.addColorStop(0, 'rgba(60,70,160,.32)'); g.addColorStop(1, 'rgba(10,12,24,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 34; i++) { const tw = 0.5 + 0.5 * Math.sin(now / 700 + i * 1.7); ctx.fillStyle = 'rgba(190,205,255,' + (0.12 + 0.18 * tw) + ')'; ctx.beginPath(); ctx.arc((i * 97 + 31) % W, (i * 61 + 17) % 470, 1.2 + (i % 3) * 0.55, 0, 7); ctx.fill(); }
    const green = greenShare(), gw = W * green, fy = FLOOR;
    g = ctx.createLinearGradient(0, fy - 6, 0, H); g.addColorStop(0, '#1ee27b'); g.addColorStop(0.35, '#0f9c52'); g.addColorStop(1, '#063a1e'); ctx.fillStyle = g; ctx.fillRect(0, fy, gw, H - fy);
    g = ctx.createLinearGradient(0, fy - 6, 0, H); g.addColorStop(0, '#ff4a5c'); g.addColorStop(0.35, '#c4202f'); g.addColorStop(1, '#4a0a14'); ctx.fillStyle = g; ctx.fillRect(gw, fy, W - gw, H - fy);
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(0, fy, W, 2.5);
    ctx.fillStyle = '#28d977'; ctx.beginPath(); ctx.arc(gw / 2, fy - 30, 21, 0, 7); ctx.fill(); ctx.fillStyle = '#04290f'; ctx.font = '800 26px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', gw / 2, fy - 29);
    const sx = gw + (W - gw) / 2; ctx.fillStyle = '#ffe9e9'; ctx.beginPath(); ctx.arc(sx, fy - 34, 18, 0, 7); ctx.fill(); ctx.fillRect(sx - 10, fy - 28, 20, 15);
    ctx.fillStyle = '#7a0d17'; ctx.beginPath(); ctx.arc(sx - 6.5, fy - 35, 4.4, 0, 7); ctx.arc(sx + 6.5, fy - 35, 4.4, 0, 7); ctx.fill(); ctx.fillRect(sx - 1.5, fy - 29, 3, 5);
    let t, ts = 0, hits = 0, ga;
    if (sc) {
        t = (now - sc.started) / 1000;
        ts = t <= sc.lead ? 0 : Math.min(sc.exit.t, (t - sc.lead) * sc.speed);
        hits = sc.contacts.filter(c => c.t <= ts).length;
        ga = gapAt(sc.plan, ts);
    } else { t = (now - ui.idleStart) / 1000; ga = 1.2 + t * 0.7; }
    const mult = hits * (sc ? sc.step : step);
    if (mult !== lastMult) { lastMult = mult; popAt = now; }
    const half = gapTotal / 2;
    pulse *= 0.9;
    ctx.lineCap = 'round';
    ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(26,127,255,' + (0.1 + 0.16 * pulse) + ')'; ctx.beginPath(); ctx.arc(CX, CY, R, ga + half, ga - half + Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 9; ctx.strokeStyle = pulse > 0.4 ? '#69b4ff' : '#1a7fff'; ctx.shadowColor = '#1a7fff'; ctx.shadowBlur = 12 + 22 * pulse;
    ctx.beginPath(); ctx.arc(CX, CY, R, ga + half, ga - half + Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(CX, CY, R - 2.5, ga + half + 0.05, ga - half + Math.PI * 2 - 0.05); ctx.stroke();
    // the multiplier in the middle: it starts at 0x and pops on every bounce
    const k = Math.max(0, 1 - (now - popAt) / 260), size = 46 + 12 * k;
    ctx.fillStyle = sc ? (mult >= 3 ? '#ffd36b' : mult >= 1.5 ? '#d49bff' : '#ffffff') : 'rgba(255,255,255,.5)';
    ctx.font = '800 ' + size + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(multText(mult), CX, CY + 4);
    let bx, by;
    if (sc) [bx, by] = ballAt(sc, t); else { bx = CX; by = CY - 92 + Math.sin(t * 2.2) * 9; }
    if (sc) { trail.push([bx, by]); if (trail.length > 12) trail.shift(); trail.forEach(([tx, ty], i) => { ctx.fillStyle = 'rgba(120,180,255,' + (i / trail.length * 0.24) + ')'; ctx.beginPath(); ctx.arc(tx, ty, BALL * (0.3 + 0.6 * i / trail.length), 0, 7); ctx.fill(); }); } else trail = [];
    drawBall(bx, by);
    if (sc) {
        sc.contacts.forEach((c, i) => {
            if (ts >= c.t && !sc.fired[i]) {
                sc.fired[i] = 1; pulse = 1; const px = CX + Math.cos(c.a) * R, py = CY + Math.sin(c.a) * R;
                for (let q = 0; q < 9; q++) burst.push({x: px, y: py, vx: Math.cos(c.a + Math.PI + (q - 4) * 0.3) * 85, vy: Math.sin(c.a + Math.PI + (q - 4) * 0.3) * 85, life: 1});
                tone(360 + Math.min(900, i * 45), 0.09, 0.05);
            }
        });
        if (t >= sc.tLand && !sc.landed) {
            sc.landed = true; const win = sc.round.win; tone(win ? 880 : 130, win ? 0.5 : 0.35, 0.07, win ? 'sine' : 'triangle'); if (win) setTimeout(() => tone(1175, 0.5, 0.06), 140);
            const txt = profitText(sc.round);
            floats.push({x: Math.max(60, Math.min(W - 60, bx)), y: by - 34, text: txt, pos: Number(sc.round.payout) > Number(sc.round.bet), zero: txt === '0', born: now, sub: win ? multText(Number(sc.round.multiplier)) : ''});
            for (let q = 0; q < 16; q++) burst.push({x: bx, y: by, vx: (Math.random() - 0.5) * 170, vy: -Math.random() * 120, life: 1.2, c: win ? '80,235,150' : '255,90,110'});
            landedRound();
        }
    }
    burst = burst.filter(p => p.life > 0); burst.forEach(p => { p.x += p.vx / 60; p.y += p.vy / 60; p.vy += 2.4; p.life -= 0.035; ctx.fillStyle = 'rgba(' + (p.c || '120,190,255') + ',' + Math.max(0, p.life) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, 7); ctx.fill(); });
    if (sc && sc.landed) { const lit = sc.round.win ? [0, gw, '#12c963'] : [gw, W - gw, '#ff3a4a']; ctx.fillStyle = lit[2]; ctx.globalAlpha = 0.2 + 0.1 * Math.sin(now / 160); ctx.fillRect(lit[0], fy, lit[1], H - fy); ctx.globalAlpha = 1; }
    floats = floats.filter(f => now - f.born < 1700);
    floats.forEach(f => {
        const age = (now - f.born) / 1700, rise = 70 * (1 - Math.pow(1 - Math.min(1, age * 1.6), 3)), pop = age < 0.12 ? 0.6 + age / 0.12 * 0.5 : 1.1 - Math.min(0.1, (age - 0.12) * 0.3);
        ctx.save(); ctx.globalAlpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3; ctx.translate(f.x, f.y - rise); ctx.scale(pop, pop);
        ctx.font = '900 40px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(8,10,18,.92)'; ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = f.zero ? '#cfd6e0' : f.pos ? '#4be58f' : '#ff6b78'; ctx.fillText(f.text, 0, 0);
        if (f.sub) { ctx.font = '800 17px system-ui,sans-serif'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(8,10,18,.9)'; ctx.strokeText(f.sub, 0, 28); ctx.fillStyle = '#e8d9ff'; ctx.fillText(f.sub, 0, 28); }
        ctx.restore();
    });
    return t;
}
function landedRound() {
    if (state.me && ui.lastBalance != null) { state.me.balance = ui.lastBalance; if (typeof updateBalance === 'function') updateBalance(); }
    const el = document.querySelector('#esc-hash'); if (el) el.textContent = short(ui.hash);
}
function loop(now) {
    ui.raf = 0; if (!alive() || !cv) return;
    const t = drawScene(now);
    if (ui.play && t > ui.play.tEnd) { ui.play = null; ui.busy = false; ui.idleStart = now; trail = []; lastMult = 0; paintGo(); }
    ui.raf = requestAnimationFrame(loop);
}
function startLoop() { if (!ui.raf) { ui.idleStart = performance.now(); ui.raf = requestAnimationFrame(loop); } }

async function playRound() {
    if (ui.busy) return;
    if (balance() < ui.bet - 1e-9) return toast('Недостаточно GRAM на балансе');
    ui.busy = true; paintGo();
    const rid = 'esc-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36).slice(2));
    try {
        const data = await api('escape/play', {bet: String(ui.bet), level: ui.level, request_id: rid});
        const r = data.round, sc = script(r);
        if (!sc) throw new Error('Не удалось показать раунд, результат записан в историю');
        ui.hash = data.next_hash || ui.hash; ui.lastBalance = data.balance;
        sc.started = performance.now(); ui.play = sc; startLoop();
    } catch (e) { ui.busy = false; paintGo(); toast(e.message); }
}

async function loadInfo() {
    const data = await api('escape/state'); ui.info = data; ui.hash = data.hash;
    ui.bet = Math.max(Number(data.min_bet), Math.min(ui.bet, Number(data.max_bet)));
    return data;
}

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
    ui.busy = false; ui.play = null; floats = []; burst = []; trail = [];
    const main = root(); if (main) main.innerHTML = '<div class="esc"><p class="esc-muted" style="padding:40px;text-align:center">Загрузка…</p></div>';
    try { if (!state.me) state.me = await api('me'); else if (typeof refreshMe === 'function') await refreshMe(); await loadInfo(); } catch (e) { if (main) main.innerHTML = '<div class="error">' + h(e.message) + '</div><button class="secondary" onclick="go(\'escape\')">Повторить</button>'; return; }
    if (state.page === 'escape') render();
};

function addTile() {
    const wrapEl = document.querySelector('#main .crafter-games');
    if (!wrapEl || wrapEl.querySelector('.escape-tile') || (typeof crafterCanSeeMode === 'function' && !crafterCanSeeMode('escape'))) return;
    const tile = document.createElement('button');
    tile.type = 'button'; tile.className = 'crafter-game-tile escape-tile'; tile.addEventListener('click', () => go('escape'));
    tile.innerHTML = '<span class="crafter-game-label"><strong>Escape</strong><span>Шар в кольце: с каждым отскоком множитель растёт</span><span class="crafter-game-open">Играть</span></span>' +
        '<span class="escape-art" aria-hidden="true"><i class="escape-ring"></i><i class="escape-ball"></i><i class="escape-star s1"></i><i class="escape-star s2"></i><i class="escape-star s3"></i></span>' +
        '<span class="escape-online" title="Игроков за последние 10 минут"><i></i><span id="esc-online">0</span></span>';
    const upgrade = wrapEl.querySelector('.crafter-upgrade-tile');
    if (upgrade) upgrade.after(tile); else wrapEl.appendChild(tile);
    api('escape/state').then(d => { const n = document.querySelector('#esc-online'); if (n) n.textContent = d.online; }).catch(() => {});
}
if (typeof renderGamesHub === 'function') {
    const hubBefore = renderGamesHub;
    renderGamesHub = function () { hubBefore.apply(this, arguments); addTile(); };
}
})();
