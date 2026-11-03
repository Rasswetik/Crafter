function fragmentGiftPath(gift) {
    const link = telegramGiftLink(gift);
    return link ? 'https://nft.fragment.com/gift/' + link.split('/').pop().toLowerCase() : '';
}

function giftAssetPart(value) {
    return encodeURIComponent(value).replace(/'/g, '%27');
}

function giftPicture(gift, large = false) {
    const fragment = fragmentGiftPath(gift);
    const model = giftAnimationPath(gift);
    const original = imageURL(gift.image);
    const fallback = fragment ? fragment + (large ? '.large.jpg' : '.medium.jpg') : model ? model + '.png' : '';
    const sharp = large ? (fragment ? fragment + '.large.jpg' : model ? model + '.png' : '') : '';
    const urls = [...new Set([sharp, original, fallback, model && model + '.png'].filter(Boolean))];
    return `src="${esc(urls.shift() || '')}" data-gift-fallback="${esc(JSON.stringify(urls))}" onerror="nextGiftPicture(this)"`;
}

function nextGiftPicture(image) {
    const urls = JSON.parse(image.dataset.giftFallback);
    if (!urls.length) {
        image.hidden = true;
        return;
    }
    image.dataset.giftFallback = JSON.stringify(urls.slice(1));
    image.src = urls[0];
}

function giftPattern(gift) {
    if (!gift.symbol) return '';
    const path = 'https://api.changes.tg/symbol/' + [gift.name, gift.symbol].map(giftAssetPart).join('/') + '.png';
    return `<span class="gift-symbol-pattern" aria-hidden="true" style="--gift-symbol:url(&quot;${esc(path)}&quot;)"></span>`;
}

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
    return giftAnimationEndpoint + parts.map(giftAssetPart).join('/');
}

async function downloadGiftAnimation(path, fragment) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
        if (fragment) {
            try {
                const full = await fetch(fragment + '.lottie.json', {
                    credentials: 'omit', signal: AbortSignal.timeout(2500),
                });
                if (full.ok) {
                    const data = await full.json();
                    if (validGiftAnimation(data)) return data;
                }
            } catch {}
        }
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
        if (!validGiftAnimation(data)) throw new Error('Invalid gift animation');
        return data;
    } finally {
        clearTimeout(timer);
    }
}

function validGiftAnimation(data) {
    return Array.isArray(data?.layers) && data.layers.length && Number.isFinite(data.fr) &&
        Number.isFinite(data.w) && Number.isFinite(data.h) && data.w >= 1 && data.h >= 1 &&
        data.w <= 2048 && data.h <= 2048 && !data.assets?.some(asset => asset.p || asset.u);
}

function prepareGiftAnimation(gift) {
    const path = giftAnimationPath(gift);
    if (!path) return null;
    const fragment = fragmentGiftPath(gift);
    const key = fragment || path;
    if (!giftAnimationCache.has(key)) {
        if (giftAnimationCache.size >= 32) giftAnimationCache.delete(giftAnimationCache.keys().next().value);
        const pending = downloadGiftAnimation(path, fragment).catch(() => {
            if (giftAnimationCache.get(key) === pending) giftAnimationCache.delete(key);
            return null;
        });
        giftAnimationCache.set(key, pending);
    }
    return giftAnimationCache.get(key);
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
