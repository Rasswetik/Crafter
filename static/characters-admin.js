/* Admin → «Персонажи»: the 3D characters of the site. A card per character; the card opens a rotatable 3D preview
   (drag to turn, wheel / pinch to zoom, double-click to reset) with buttons that switch the animations of the model. */
(function () {
    'use strict';

    const CHARACTERS = [{
        id: 'goshan', name: 'Гошан', ready: false, file: '/static/models/goshan.glb?v=1', thumb: '/static/assets/emoji/goshan-happy.alpha.webp',
        about: 'Медно-рыжие волосы, чёрные очки, полосатый свитер, джинсы с подворотами, белые кроссовки. Модель собрана по 7 видам T-позы, текстура — сами рисунки.',
        anims: [['Idle', 'Idle'], ['Pose', 'Поза'], ['Wave', 'Привет'], ['Cheer', 'Ура'], ['TPose', 'T-поза']],
        start: 'Idle',
    }];

    const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    let libs = null;
    const script = src => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Не удалось загрузить ' + src)); document.head.appendChild(s); });
    function loadLibs() {
        if (window.THREE && THREE.GLTFLoader) return Promise.resolve();
        if (!libs) libs = script('/static/vendor/three.min.js?v=147').then(() => script('/static/vendor/GLTFLoader.js?v=147')).catch(err => { libs = null; throw err; });
        return libs;
    }

    let viewer = null;                                     // the open preview (stopped when the section is left)

    function list(content) {
        content.innerHTML = '<div class="chr-grid">' + CHARACTERS.map(c =>
            '<button type="button" class="chr-card" data-chr="' + e(c.id) + '">' +
            '<span class="chr-thumb"><img src="' + e(c.thumb) + '" alt="" loading="lazy"></span>' +
            '<span class="chr-meta"><b>' + e(c.name) + '</b><small>' + (c.ready ? '3D-модель · ' + c.anims.length + ' анимаций' : '3D-модель готовится') + '</small></span>' +
            '<span class="chr-open">Открыть 3D →</span></button>').join('') + '</div>';
        content.querySelectorAll('[data-chr]').forEach(b => b.addEventListener('click', () => open(content, CHARACTERS.find(c => c.id === b.dataset.chr))));
    }

    async function open(content, ch) {
        stop();
        content.innerHTML = '<div class="chr-view">' +
            '<div class="chr-top"><button type="button" class="chr-back">‹ Персонажи</button><div><h3>' + e(ch.name) + '</h3><p>' + e(ch.about) + '</p></div></div>' +
            '<div class="chr-stage"><canvas></canvas><div class="chr-status">Загружаем модель…</div>' +
            '<div class="chr-hint">Тяните — вращать · колесо / щипок — приблизить · двойной клик — сбросить</div></div>' +
            '<div class="chr-controls"><div class="chr-anims">' + ch.anims.map(([k, label]) => '<button type="button" data-anim="' + e(k) + '">' + e(label) + '</button>').join('') + '</div>' +
            '<div class="chr-opts"><label><input type="checkbox" data-auto> Автоповорот</label>' +
            '<label>Скорость <select data-speed><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option></select></label>' +
            '<button type="button" data-reset>Сбросить камеру</button></div></div>' +
            '<p class="chr-info" data-info></p></div>';
        content.querySelector('.chr-back').addEventListener('click', () => { stop(); list(content); });
        const status = content.querySelector('.chr-status');
        if (!ch.ready) { status.textContent = '3D-модель готовится — появится здесь после загрузки.'; return; }
        try {
            await loadLibs();
            const gltf = await new Promise((ok, fail) => new THREE.GLTFLoader().load(ch.file, ok, ev => {
                if (ev.total) status.textContent = 'Загружаем модель… ' + Math.round(ev.loaded / ev.total * 100) + '%';
            }, fail));
            if (!content.isConnected) return;
            viewer = mount(content.querySelector('.chr-stage'), content, gltf, ch);
            status.remove();
        } catch (err) {
            status.textContent = 'Не удалось показать модель: ' + (err && err.message || err);
        }
    }

    function mount(stage, content, gltf, ch) {
        const canvas = stage.querySelector('canvas');
        const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.outputEncoding = THREE.sRGBEncoding;
        const scene = new THREE.Scene();
        const model = gltf.scene;
        model.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
        scene.add(model);
        // soft round shadow under the feet
        const sc = document.createElement('canvas'); sc.width = sc.height = 128;
        const g = sc.getContext('2d'), grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
        grd.addColorStop(0, 'rgba(0,0,0,.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false}));
        shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; scene.add(shadow);

        const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
        const home = {az: 0.35, el: 0.12, dist: 4.4};
        const orbit = {...home}, target = new THREE.Vector3(0, 0.88, 0);
        const place = () => {
            camera.position.set(target.x + Math.sin(orbit.az) * Math.cos(orbit.el) * orbit.dist, target.y + Math.sin(orbit.el) * orbit.dist,
                target.z + Math.cos(orbit.az) * Math.cos(orbit.el) * orbit.dist);
            camera.lookAt(target);
        };
        // pointer orbit + zoom
        const pts = new Map(); let pinch = 0;
        canvas.addEventListener('pointerdown', ev => { canvas.setPointerCapture(ev.pointerId); pts.set(ev.pointerId, [ev.clientX, ev.clientY]); auto.checked = false; });
        canvas.addEventListener('pointermove', ev => {
            if (!pts.has(ev.pointerId)) return;
            const [x0, y0] = pts.get(ev.pointerId); pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
            if (pts.size === 1) {
                orbit.az -= (ev.clientX - x0) * 0.008;
                orbit.el = Math.max(-0.5, Math.min(1.2, orbit.el + (ev.clientY - y0) * 0.006));
            } else if (pts.size === 2) {
                const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
                if (pinch) orbit.dist = Math.max(1.6, Math.min(9, orbit.dist * pinch / d));
                pinch = d;
            }
        });
        const up = ev => { pts.delete(ev.pointerId); if (pts.size < 2) pinch = 0; };
        canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('wheel', ev => { ev.preventDefault(); orbit.dist = Math.max(1.6, Math.min(9, orbit.dist * (1 + Math.sign(ev.deltaY) * 0.1))); }, {passive: false});
        const reset = () => Object.assign(orbit, home);
        canvas.addEventListener('dblclick', reset);

        // animations
        const mixer = new THREE.AnimationMixer(model);
        const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
        let current = null;
        const buttons = content.querySelectorAll('[data-anim]');
        const play = name => {
            const clip = clips[name]; if (!clip) return;
            const next = mixer.clipAction(clip);
            next.reset().setEffectiveWeight(1).play();
            if (current && current !== next) current.crossFadeTo(next, 0.3, false);
            current = next;
            buttons.forEach(b => b.classList.toggle('is-on', b.dataset.anim === name));
        };
        buttons.forEach(b => { if (!clips[b.dataset.anim]) b.disabled = true; b.addEventListener('click', () => play(b.dataset.anim)); });
        play(clips[ch.start] ? ch.start : (gltf.animations[0] || {}).name);
        const auto = content.querySelector('[data-auto]');
        const speed = content.querySelector('[data-speed]');
        speed.addEventListener('change', () => { mixer.timeScale = Number(speed.value); });
        content.querySelector('[data-reset]').addEventListener('click', reset);

        // info line
        let tris = 0; model.traverse(o => { if (o.isMesh && o.name.indexOf('Outline') < 0) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
        const bones = []; model.traverse(o => { if (o.isBone) bones.push(o); });
        content.querySelector('[data-info]').textContent = 'Треугольников: ' + Math.round(tris).toLocaleString('ru-RU') + ' · костей: ' + bones.length + ' · анимаций: ' + gltf.animations.length;

        const clock = new THREE.Clock();
        let raf = 0, alive = true;
        const resize = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
        const frame = () => {
            if (!alive) return;
            if (!canvas.isConnected) { dispose(); return; }
            const dt = clock.getDelta();
            if (auto.checked) orbit.az += dt * 0.5;
            mixer.update(dt); resize(); place(); renderer.render(scene, camera);
            raf = requestAnimationFrame(frame);
        };
        const dispose = () => {
            alive = false; cancelAnimationFrame(raf); mixer.stopAllAction();
            scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
            renderer.dispose();
        };
        frame();
        return {dispose};
    }

    function stop() { if (viewer) { viewer.dispose(); viewer = null; } }

    window.renderAdminCharacters = async function (content) {
        stop();
        list(content);
    };

    if (typeof adminSections === 'object') {
        adminSections.characters = {label: 'Персонажи', detail: '3D-модели персонажей и их анимации', group: 'manage', glyph: 'users', render: window.renderAdminCharacters};
    }
})();
