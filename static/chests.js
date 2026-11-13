/* Chests: a 3D model (three.js) that hops when it appears and opens in a blink, then the items come out one by one.
   window.crafterChests = {viewer, play, chances}. Without WebGL the flat picture takes the place of the model. */
(function () {
'use strict';
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = n => Number(n).toLocaleString('ru-RU', {maximumFractionDigits: 2});
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => innerWidth < 760;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ORN = '/static/assets/new-year-ornament.svg', GRAM = '/static/assets/gram.svg';

/* ---------- loading of three.js (once) ---------- */
let libs = null;
function script(src) {
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('script')); document.head.appendChild(s); });
}
function loadLibs() {
    if (window.THREE && THREE.GLTFLoader) return Promise.resolve();
    if (!libs) libs = script('/static/vendor/three.min.js?v=147').then(() => script('/static/vendor/GLTFLoader.js?v=147')).catch(err => { libs = null; throw err; });
    return libs;
}
function webgl() {
    try { const c = document.createElement('canvas'); return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (_) { return false; }
}
const models = new Map();                                          // a model is loaded once
/* the model carries only the shape; the gingerbread "textures" are painted by the shader from the position on the model:
   honey lid, cinnamon body, white icing with drips, candy red handle, bolts and latch, a cute face */
const PAINT_FRAG = `
varying vec3 vP; varying vec3 vN;
float disc(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return 1.0 - smoothstep(0.86, 1.0, length(q)); }
vec3 gingerPaint(vec3 p, vec3 n) {
    vec3 honey = vec3(0.86, 0.5, 0.15), cinn = vec3(0.5, 0.21, 0.07), icing = vec3(1.0, 0.96, 0.9), candy = vec3(0.78, 0.07, 0.12), choc = vec3(0.17, 0.07, 0.03);
    float y = p.y, ax = abs(p.x), az = abs(p.z);
    vec3 col = y > 12.0 ? honey : cinn;
    // baked look: a little darker towards the seam and the foot, lighter on the tops
    col *= 0.86 + 0.2 * smoothstep(-0.3, 1.0, n.y);
    col *= 0.88 + 0.12 * smoothstep(0.0, 4.0, y) * smoothstep(0.0, 2.5, abs(y - 12.0));
    // fine crumb texture
    col *= 0.96 + 0.04 * sin(p.x * 7.3) * sin(p.y * 6.1) * sin(p.z * 8.7);
    // rows of icing pearls on the lid walls and the body walls
    vec2 c1 = fract(vec2(p.x, y) / 2.6) - 0.5;
    if (abs(n.z) > 0.85 && y > 13.6 && y < 19.6 && ax < 12.5 && length(c1) < 0.15) col = icing;
    if (abs(n.z) > 0.85 && y > 3.4 && y < 5.6 && ax < 12.5 && length(c1) < 0.15) col = icing;
    if (abs(n.x) > 0.85 && y > 3.4 && y < 19.6 && az < 6.4 && length(fract(vec2(p.z, y) / 2.6) - 0.5) < 0.15) col = icing;
    // white icing on the top of the lid with a scalloped, dripping edge
    float scal = 21.4 + 1.5 * abs(sin(p.x * 0.62 + p.z * 0.31)) + 1.1 * smoothstep(0.7, 1.0, sin(p.x * 1.4 + 0.8) * 0.5 + 0.5);
    if (y > scal) col = icing;
    // piping: at the foot and a zigzag on the seam
    if (y < 2.4 + 0.5 * abs(sin(p.x * 1.1 + p.z * 0.5))) col = icing;
    float seam = abs(y - 12.0 - 0.38 * sin(p.x * 3.0 + p.z * 3.0));
    if (seam < 0.38) col = icing;
    // the face on the front of the body: two big eyes with shine, a smile and blush
    if (p.z > 0.0 && n.z > 0.6 && ax < 11.5 && y < 11.4) {
        vec2 f = vec2(p.x, y);
        float eye = max(disc(f, vec2(-4.4, 8.9), vec2(1.3, 1.75)), disc(f, vec2(4.4, 8.9), vec2(1.3, 1.75)));
        float shine = max(disc(f, vec2(-3.95, 9.7), vec2(0.5, 0.62)), disc(f, vec2(4.85, 9.7), vec2(0.5, 0.62)));
        float blush = max(disc(f, vec2(-7.4, 6.9), vec2(1.5, 0.9)), disc(f, vec2(7.4, 6.9), vec2(1.5, 0.9)));
        float sm = (1.0 - smoothstep(0.3, 0.55, abs(length(vec2(f.x * 0.85, f.y - 7.9)) - 3.0))) * step(f.y, 7.2);
        col = mix(col, vec3(1.0, 0.55, 0.45), blush * 0.7);
        col = mix(col, choc, max(eye, sm));
        col = mix(col, vec3(1.0), shine);
    }
    // candy: the handle in stripes, the latch like a peppermint, bolts like gumdrops
    float stripe = step(0.5, fract(p.x * 0.34 + atan(y - 26.0, p.z) * 0.8));
    if (y > 24.1 && ax < 8.4) col = mix(candy, icing, stripe);
    if (ax > 15.6 && y > 8.4 && y < 17.8) col = mix(candy, icing, step(0.5, fract(atan(y - 13.0, p.z) * 1.6)));
    float bolt = min(length(vec3(ax - 15.4, y - 3.7, az - 8.3)), length(vec3(ax - 15.4, y - 19.3, az - 8.3)));
    if (bolt < 2.9) col = mix(candy, vec3(1.0, 0.45, 0.45), smoothstep(1.6, 0.0, bolt) * 0.5);
    return pow(col, vec3(2.2));                                                    // the colours above are sRGB, the shader works in linear
}`;
function paintModel(gltf) {
    if (gltf.userData.painted) return gltf;
    gltf.userData.painted = true;
    const done = new Set();
    gltf.scene.traverse(m => {
        if (!m.isMesh || !m.material || m.material.name !== 'paint' || done.has(m.material.uuid)) return;
        done.add(m.material.uuid);
        const mat = m.material;
        mat.onBeforeCompile = sh => {
            sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; vN = normal;');
            sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + PAINT_FRAG).replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = gingerPaint(vP, normalize(vN));');
        };
        mat.customProgramCacheKey = () => 'ginger-paint-5';
        mat.needsUpdate = true;
    });
    return gltf;
}
function loadModel(url) {
    if (!models.has(url)) models.set(url, new Promise((ok, fail) => new THREE.GLTFLoader().load(url, g => ok(paintModel(g)), undefined, fail)));
    return models.get(url).catch(err => { models.delete(url); throw err; });
}

/* ---------- the viewer: idle hop, bobbing, quick opening ---------- */
function flat(host, chest) {                                        // no WebGL: the picture with the same movements made by CSS
    host.innerHTML = '<img class="cx-flat is-hop" src="' + e(chest.image) + '" alt="" draggable="false">';
    const img = host.firstChild;
    setTimeout(() => img.classList.remove('is-hop'), 1300);
    return {ready: Promise.resolve(), dispose() {}, async open() { img.classList.add('is-shake'); await sleep(520); return 0; }};
}
function viewer(host, chest, opts = {}) {
    if (!webgl()) return flat(host, chest);
    let dead = false, raf = 0, ro = null, renderer = null;
    const ctl = {dispose() { dead = true; cancelAnimationFrame(raf); ro && ro.disconnect(); if (renderer) { renderer.dispose(); renderer.domElement.remove(); } }, open: async () => 0, ready: null};
    const url = (phone() && chest.model_mobile) || chest.model;
    let state = {t0: performance.now(), opening: 0, opened: false}, pivot = null, mixer = null, action = null, burstAt = 0, burstRes = null;
    ctl.ready = loadLibs().then(() => loadModel(url)).then(gltf => {
        if (dead) return;
        const cv = document.createElement('canvas'); cv.className = 'cx-canvas'; host.innerHTML = ''; host.appendChild(cv);
        renderer = new THREE.WebGLRenderer({canvas: cv, antialias: !phone(), alpha: true, powerPreference: 'high-performance'});
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, phone() ? 1.6 : 2));
        if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
        const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, .1, 100);
        scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a5a, .9));
        const key = new THREE.DirectionalLight(0xffe6c0, 2.0); key.position.set(3, 5, 4); scene.add(key);
        const rim = new THREE.DirectionalLight(0xffb070, .9); rim.position.set(-4, 2.5, -3); scene.add(rim);
        const fill = new THREE.PointLight(0xffd7a0, .35, 20); fill.position.set(0, .5, 4); scene.add(fill);
        const model = gltf.scene.clone(true);
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
        const k = 2 / Math.max(size.x, size.y, size.z);
        model.position.copy(mid).multiplyScalar(-1);
        pivot = new THREE.Group(); const wrap = new THREE.Group(); wrap.add(model); wrap.scale.setScalar(k); pivot.add(wrap); pivot.rotation.y = -.5; scene.add(pivot);
        state.base = pivot.rotation.y; state.size = size.y * k;
        const clip = gltf.animations.find(a => /^open$/i.test(a.name)) || gltf.animations[0];
        if (clip) { mixer = new THREE.AnimationMixer(model); action = mixer.clipAction(clip.clone()); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.timeScale = opts.speed || 2.6; state.dur = clip.duration / action.timeScale; }
        const fit = () => {
            const w = Math.max(60, host.clientWidth), h = Math.max(60, host.clientHeight);
            renderer.setSize(w, h, false); cam.aspect = w / h;
            const r = 1.75, fov = cam.fov * Math.PI / 180, dist = Math.max(r / Math.sin(fov / 2) / Math.min(1, cam.aspect * 1.05), r / Math.sin(fov / 2) * .78);
            cam.position.set(0, dist * .17, dist * .98); cam.lookAt(0, -.05, 0); cam.updateProjectionMatrix();
        };
        fit(); ro = new ResizeObserver(fit); ro.observe(host);
        host.classList.add('is-3d');
        if (opts.drag) {                                            // the chest can be turned by a finger or a mouse
            let down = null, vel = 0;
            host.classList.add('is-drag');
            host.addEventListener('pointerdown', ev => { down = ev.clientX; vel = 0; host.setPointerCapture && host.setPointerCapture(ev.pointerId); host.classList.add('is-grab'); });
            host.addEventListener('pointermove', ev => { if (down === null) return; const dx = ev.clientX - down; down = ev.clientX; state.base += dx * .012; vel = dx * .012; });
            const up = () => { down = null; host.classList.remove('is-grab'); };
            host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
            state.spin = () => { if (down === null && Math.abs(vel) > .0004) { state.base += vel; vel *= .94; } };
        }
        const hop = t => {                                          // up fast, down with a small dip, then a spring
            const H = .95;
            if (t < .42) { const q = t / .42; return {y: H * (1 - (1 - q) * (1 - q)), s: 1 + .04 * q}; }
            if (t < .78) { const q = (t - .42) / .36; return {y: H * (1 - q * q), s: 1.04 - .08 * q}; }
            const u = t - .78; return {y: -.1 * Math.exp(-u * 7) * Math.sin(u * 15 + .6), s: 1 - .1 * Math.exp(-u * 8) * Math.cos(u * 17)};
        };
        let last = performance.now();
        const frame = now => {
            if (dead) return;
            raf = requestAnimationFrame(frame);
            if (!host.isConnected) { ctl.dispose(); return; }
            const dt = Math.min(.05, (now - last) / 1000); last = now;
            const t = (now - state.t0) / 1000;
            let y = 0, s = 1, rot = 0;
            if (state.opening) {
                const u = (now - state.opening) / 1000;
                if (u < .22) y = .22 * Math.sin(u / .22 * Math.PI / 2);          // a short lift before the lid goes
                else y = .22 * Math.exp(-(u - .22) * 9) * Math.cos((u - .22) * 14);
                s = 1 + .05 * Math.sin(Math.min(u, .5) / .5 * Math.PI);
                rot = Math.sin(u * 34) * .05 * Math.exp(-u * 3);
                if (mixer) mixer.update(dt * (u < .12 ? 0 : 1));
                if (burstRes && u >= burstAt) { const f = burstRes; burstRes = null; f(); }
            } else if (!reduced() && t < 1.25) { const h = hop(t); y = h.y; s = h.s; rot = t < .78 ? Math.sin(t / .78 * Math.PI) * .22 : 0; }
            else if (!reduced() && !state.opened) { const u = t - 1.25; y = Math.sin(u * 2.1) * .05 + .02; rot = Math.sin(u * 1.1) * .07; }
            if (state.spin) state.spin();
            pivot.position.y = y * state.size; pivot.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)); pivot.rotation.y = state.base + rot;
            renderer.render(scene, cam);
        };
        raf = requestAnimationFrame(frame);
    });
    ctl.open = () => ctl.ready.then(() => new Promise(done => {
        if (!pivot || dead) { done(); return; }
        state.opening = performance.now(); state.opened = true;
        burstAt = Math.max(.34, (state.dur || .5) * .45 + .12);
        burstRes = done;
        if (action) { action.reset(); action.play(); }
    }));
    return ctl;
}

/* ---------- screens of the opening ---------- */
const KIND_TITLE = {BALL: 'ШАРЫ', GRAM: 'GRAM'};
function pieces(items) {                                            // one screen for each item that came out
    return items.map(it => {
        const title = KIND_TITLE[it.kind] || String(it.title || 'Награда').toUpperCase();
        const count = it.kind === 'BALL' || it.kind === 'GRAM' ? 'x' + num(it.amount) : 'x' + (it.count || 1);
        const image = it.image || (it.kind === 'GRAM' ? GRAM : ORN);
        return {title, count, image, kind: it.kind, big: it.kind === 'PACK' || it.kind === 'STAR', item: it};
    });
}
function burst(host) {
    const n = phone() ? 22 : 36;
    host.insertAdjacentHTML('beforeend', '<div class="cx-burst">' + Array.from({length: n}, (_, i) => '<i style="--a:' + (i * 360 / n).toFixed(0) + 'deg;--d:' + (110 + (i * 53) % 190) + 'px;--t:' + (.7 + (i % 5) * .11).toFixed(2) + 's;--c:' + ['#ffd36b', '#7cc8ff', '#ff7a9a', '#9be37f', '#fff'][i % 5] + '"></i>').join('') + '</div><i class="cx-flash"></i>');
    setTimeout(() => host.querySelectorAll('.cx-burst,.cx-flash').forEach(x => x.remove()), 1300);
}
function play(res, opts = {}) {
    document.querySelector('.cx-play')?.remove();
    const chest = res.chest, items = pieces(res.items || []);
    const el = document.createElement('div');
    el.className = 'cx-play';
    const bg = opts.bg || chest.bg || 'cozy';
    const scene = '<div class="cx-bg"><i class="cx-bg-a"></i><i class="cx-bg-b"></i></div>';
    document.body.classList.add('cx-open');
    el.innerHTML = scene + '<i class="cx-vig"></i><i class="cx-rays"></i><div class="cx-glow"></div><div class="cx-model"></div>' +
        '<div class="cx-name">' + e(chest.title) + '</div><div class="cx-hint"><b>Нажмите, чтобы открыть</b></div>' +
        '<div class="cx-reward" hidden></div><div class="cx-left" hidden>ОСТАЛОСЬ НАГРАД <b></b></div><div class="cx-sum" hidden></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const v = viewer(el.querySelector('.cx-model'), chest);
    const reward = el.querySelector('.cx-reward'), left = el.querySelector('.cx-left'), sum = el.querySelector('.cx-sum');
    const packIds = items.flatMap(p => p.item.pack_ids || []);
    let phase = 'wait', at = 0, busy = false;
    const done = () => { document.body.classList.remove('cx-open'); el.classList.remove('is-in'); setTimeout(() => { v.dispose(); el.remove(); }, 260); opts.onDone && opts.onDone(); opts.refresh && opts.refresh(); };
    const showItem = () => {
        const p = items[at];
        left.hidden = false; left.querySelector('b').textContent = String(items.length - at - 1);
        reward.hidden = false; reward.className = 'cx-reward is-' + p.kind.toLowerCase() + (p.big ? ' is-big' : '');
        reward.innerHTML = '<h2>' + e(p.title) + '</h2><div class="cx-art"><i class="cx-aura"></i><img src="' + e(p.image) + '" alt="" draggable="false"></div><div class="cx-count">' + e(p.count) + '</div><small class="cx-tap">Нажмите, чтобы продолжить</small>';
        void reward.offsetWidth; reward.classList.add('is-pop');
    };
    const summary = () => {
        left.hidden = true; reward.hidden = true; el.classList.add('is-sum');
        sum.hidden = false;
        const tot = [];                                              // GRAM and balls are added up, packs are counted
        items.forEach(p => {
            const key = p.kind === 'PACK' || p.kind === 'STAR' ? p.kind + p.item.amount : p.kind, hit = tot.find(t => t.key === key);
            const amount = p.kind === 'BALL' || p.kind === 'GRAM' ? Number(p.item.amount) : (p.item.count || 1);
            if (hit) hit.amount += amount; else tot.push({key, p, amount});
        });
        const cells = tot.map(t => ({...t.p, count: 'x' + num(Math.round(t.amount * 100) / 100)}));
        sum.innerHTML = '<h2>Вы получили</h2><div class="cx-grid">' + cells.map((p, i) => '<div class="cx-cell' + (p.big ? ' is-big' : '') + '" style="--i:' + i + '"><img src="' + e(p.image) + '" alt=""><b>' + e(p.count) + '</b><small>' + e(p.kind === 'BALL' ? 'Шары' : p.kind === 'GRAM' ? 'GRAM' : p.item.title) + '</small></div>').join('') + '</div>' +
            '<p>' + (packIds.length ? (packIds.length > 1 ? 'Паки уже в инвентаре. Открыть их сейчас?' : 'Пак уже в инвентаре. Открыть его сейчас?') : 'Всё уже на вашем балансе.') + '</p>' +
            '<div class="cx-btns">' + (packIds.length ? '<button type="button" class="cx-btn green" data-cx-open>' + (packIds.length > 1 ? 'Открыть все (' + packIds.length + ')' : 'Открыть сейчас') + '</button><button type="button" class="cx-btn blue" data-cx-keep>Оставить в инвентаре</button>' : '<button type="button" class="cx-btn green" data-cx-keep>Отлично</button>') + '</div>';
        sum.querySelector('[data-cx-keep]').addEventListener('click', ev => { ev.stopPropagation(); done(); });
        sum.querySelector('[data-cx-open]')?.addEventListener('click', async ev => {
            ev.stopPropagation(); const b = ev.currentTarget; b.disabled = true; b.textContent = 'Открываем…';
            document.body.classList.remove('cx-open'); el.classList.remove('is-in'); setTimeout(() => { v.dispose(); el.remove(); }, 220);
            try { await window.crafterPacks.openMany(packIds, opts.refresh); } catch (err) { opts.toast && opts.toast(err.message); }
            opts.onDone && opts.onDone();
        });
        phase = 'sum';
    };
    el.addEventListener('click', async () => {
        if (busy) return;
        if (phase === 'wait') {
            busy = true; el.classList.add('is-opening'); el.querySelector('.cx-hint').remove();
            await v.open();
            burst(el); el.classList.add('is-opened');
            await sleep(reduced() ? 60 : 420);
            phase = 'items'; showItem(); busy = false;
        } else if (phase === 'items') {
            at++;
            if (at >= items.length) summary(); else { busy = true; reward.classList.remove('is-pop'); await sleep(90); showItem(); busy = false; }
        }
    });
    return el;
}

/* ---------- what can be inside ---------- */
async function chances(chestId, api) {
    document.querySelector('.cx-chances')?.remove();
    const el = document.createElement('div');
    el.className = 'cx-chances';
    el.innerHTML = '<div class="cx-ch-box"><button type="button" class="cx-ch-x" aria-label="Закрыть">×</button><div class="cx-ch-body"><p class="cx-ch-load">Загрузка…</p></div></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 220); };
    el.addEventListener('click', ev => { if (ev.target === el || ev.target.closest('.cx-ch-x')) close(); });
    const body = el.querySelector('.cx-ch-body');
    try {
        const d = await api('chests/' + encodeURIComponent(chestId));
        const top = Math.max(...d.rolls.map(r => r.chance)), word = n => n === 1 ? 'награда' : n < 5 ? 'награды' : 'наград';
        const pc = v => (v < 0.01 ? '<0,01' : v < 1 ? v.toFixed(2).replace('.', ',') : v < 10 ? v.toFixed(1).replace('.', ',') : v.toFixed(v % 1 ? 1 : 0).replace('.', ',')) + '%';
        const label = x => x.kind === 'BALL' ? num(x.amount.split('-')[0]) + (x.amount.includes('-') ? '–' + num(x.amount.split('-')[1]) : '') + ' шаров' : x.kind === 'GRAM' ? num(x.amount.split('-')[0]) + (x.amount.includes('-') ? '–' + num(x.amount.split('-')[1]) : '') + ' GRAM' : x.title + (x.cmax > 1 ? ' ×' + (x.cmin === x.cmax ? x.cmax : x.cmin + '–' + x.cmax) : '');
        const NAMES = {GRAM: 'GRAM', BALL: 'Новогодние шары', PACK: 'Закрытые паки', STAR: 'Подарки Telegram'};
        const sure = (d.settings && d.settings.guaranteed || []).map(k => ({GRAM: 'сумма GRAM', BALL: 'шары', PACK: 'закрытый пак', STAR: 'подарок'}[k])).filter(Boolean);
        body.innerHTML = '<div class="cx-ch-hero"><img src="' + e(d.chest.image) + '" alt=""><div><b>' + e(d.chest.title) + '</b><small>Открывается сразу после покупки</small></div></div>' +
            (sure.length ? '<p class="cx-ch-sure"><b>В каждом ящике:</b> ' + sure.join(' + ') + '. Остальное — бонусные награды.</p>' : '') +
            '<h4>Сколько наград</h4><div class="cx-ch-bars">' + d.rolls.map(r => '<div><span>' + r.count + ' ' + word(r.count) + '</span><i><u style="width:' + Math.max(3, r.chance / top * 100).toFixed(1) + '%"></u></i><b>' + pc(r.chance) + '</b></div>').join('') + '</div>' +
            ['GRAM', 'BALL', 'PACK', 'STAR'].filter(k => d.loot.some(x => x.kind === k)).map(k => '<h4>' + NAMES[k] + ' <small>шанс среди таких наград · хотя бы раз за ящик</small></h4><div class="cx-ch-loot">' + d.loot.filter(x => x.kind === k).map(x => '<div class="t-' + (x.inside < 3 ? 'legend' : x.inside < 10 ? 'epic' : x.inside < 25 ? 'rare' : 'common') + '"><em>' + pc(x.inside) + '</em><img src="' + e(x.image || (x.kind === 'GRAM' ? GRAM : ORN)) + '" alt="" loading="lazy"><span>' + e(label(x)) + '</span><small>' + pc(x.chance) + ' за ящик</small></div>').join('') + '</div>').join('');
    } catch (err) { body.innerHTML = '<p class="cx-ch-load">' + e(err.message || 'Не удалось загрузить') + '</p>'; }
}

window.crafterChests = {viewer, play, chances, webgl, model: url => loadLibs().then(() => loadModel(url))};
})();
