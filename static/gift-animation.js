const giftAnimationCache = new Map();
const giftAnimationEndpoint = 'https://api.changes.tg/model/';
const giftAnimationMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let giftAnimationPlayer;
let stopGiftAnimation;

function loadGiftAnimationPlayer() {
    if (giftAnimationPlayer) return giftAnimationPlayer;
    giftAnimationPlayer = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/lottie-web@5.13.0/build/player/lottie_light.min.js';
        script.integrity = 'sha384-Gr3FGWSrOz4fzm9bvrWwhuQH87JMUCLlOTaHhpddbnlHHWCZPxMeQ3KUPsomzIii';
        script.crossOrigin = 'anonymous';
        script.onload = () => window.lottie ? resolve(window.lottie) : reject(new Error('Lottie unavailable'));
        script.onerror = () => {
            script.remove();
            reject(new Error('Lottie unavailable'));
        };
        document.head.append(script);
    }).catch(error => {
        giftAnimationPlayer = null;
        throw error;
    });
    return giftAnimationPlayer;
}

function giftAnimationPath(gift) {
    const parts = [gift.name, gift.model].map(value => String(value ?? '').trim());
    if (parts.some(value => !value || value === '.' || value === '..')) return '';
    return giftAnimationEndpoint + parts.map(value => encodeURIComponent(value).replace(/'/g, '%27')).join('/');
}

async function downloadGiftAnimation(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
        // Older Telegram WebViews can use the same TGS document as unpacked Lottie JSON.
        const compressed = typeof DecompressionStream === 'function';
        const response = await fetch(path + (compressed ? '.tgs' : '.json'), {
            credentials: 'omit',
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('Gift animation unavailable');
        const data = await (compressed
            ? new Response(response.body.pipeThrough(new DecompressionStream('gzip')))
            : response).json();
        if (!Array.isArray(data.layers) || !data.layers.length || !Number.isFinite(data.fr) ||
            !Number.isFinite(data.w) || !Number.isFinite(data.h) || data.w < 1 || data.h < 1 ||
            data.w > 2048 || data.h > 2048 ||
            data.assets?.some(asset => asset.p || asset.u)) {
            throw new Error('Invalid gift animation');
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}

function prepareGiftAnimation(gift) {
    const path = giftAnimationPath(gift);
    if (!path) return null;
    if (!giftAnimationCache.has(path)) {
        if (giftAnimationCache.size >= 32) giftAnimationCache.delete(giftAnimationCache.keys().next().value);
        const pending = downloadGiftAnimation(path).catch(() => {
            if (giftAnimationCache.get(path) === pending) giftAnimationCache.delete(path);
            return null;
        });
        giftAnimationCache.set(path, pending);
    }
    return giftAnimationCache.get(path);
}

async function playGiftAnimation(art, gift, layer, dialog) {
    stopGiftAnimation?.();
    const pending = prepareGiftAnimation(gift);
    if (!pending) return;
    let player;
    let stopped = false;
    const observer = new MutationObserver(() => {
        if (!art.isConnected) stop();
    });
    function stop() {
        if (stopped) return;
        stopped = true;
        observer.disconnect();
        dialog?.removeEventListener('close', stop);
        art.classList.remove('gift-animation-playing');
        player?.destroy();
        if (stopGiftAnimation === stop) stopGiftAnimation = null;
    }
    stopGiftAnimation = stop;
    observer.observe(dialog || document.querySelector('#main'), {childList: true, subtree: true});
    dialog?.addEventListener('close', stop);
    try {
        const [data, lottie] = await Promise.all([pending, loadGiftAnimationPlayer()]);
        if (stopped || !art.isConnected || !data) return stop();
        player = lottie.loadAnimation({
            container: layer,
            renderer: 'svg',
            animationData: JSON.parse(JSON.stringify(data)),
            rendererSettings: {preserveAspectRatio: 'xMidYMid meet'},
            autoplay: false,
            loop: false,
        });
        player.addEventListener('DOMLoaded', () => player.goToAndPlay(0, true));
        player.addEventListener('drawnFrame', () => art.classList.add('gift-animation-playing'));
        player.addEventListener('data_failed', stop);
        player.addEventListener('error', stop);
        player.addEventListener('complete', stop);
    } catch {
        stop();
    }
}

function mountGiftAnimation(art, gift) {
    if (!giftAnimationPath(gift)) return;
    const dialog = art.closest('dialog');
    const layer = document.createElement('span');
    layer.className = 'gift-animation-layer';
    layer.setAttribute('aria-hidden', 'true');
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'gift-animation-replay';
    replay.setAttribute('aria-label', 'Воспроизвести анимацию подарка');
    replay.addEventListener('click', () => playGiftAnimation(art, gift, layer, dialog));
    art.append(layer, replay);
    if (!giftAnimationMotion.matches) playGiftAnimation(art, gift, layer, dialog);
}
