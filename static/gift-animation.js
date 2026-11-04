function fragmentGiftPath(gift) {
    const link = telegramGiftLink(gift);
    return link ? 'https://nft.fragment.com/gift/' + link.split('/').pop().toLowerCase() : '';
}

function giftCollectionSlug(name) {
    return String(name || '').normalize('NFKD').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function fragmentCollectionImage(slug) {
    // Serve via our own image proxy: Telegram WebViews can block cross-origin
    // Fragment thumbnails. The server validates the slug and caches the PNG/WebP.
    return /^[a-z0-9]{2,60}$/.test(slug || '') ? '/media/collection/' + slug : '';
}
function directFragmentCollectionImage(slug) {
    return /^[a-z0-9]{2,60}$/.test(slug || '') ?
        'https://fragment.com/file/gifts/' + slug + '/thumb.webp' : '';
}

function giftAssetPart(value) {
    return encodeURIComponent(value).replace(/'/g, '%27');
}

function giftPicture(gift, large = false) {
    const fragment = fragmentGiftPath(gift);
    const model = giftAnimationPath(gift);
    const original = imageURL(gift.image);
    const exact = fragment ? [fragment + '.webp', fragment + (large ? '.large.jpg' : '.medium.jpg')] : [];
    const proxy = fragment ? '/media/fragment/' + fragment.split('/').pop() : '';
    const scalable = model ? model + '.svg' : '';
    const awarded = gift.origin === 'application-craft' && gift.source_id ? original : '';
    const sharp = large ? (fragment ? [proxy, original, fragment + '.large.jpg', ...exact] : [scalable, model && model + '.png']) : [];
    // Individual NFT cards must resolve to their own collectible or EXACT model.
    // A generic collection thumbnail is not a valid model fallback.
    const urls = [...new Set([awarded, ...sharp, proxy, original, ...exact, scalable, model && model + '.png'].filter(Boolean))];
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

function giftSymbolPath(gift) {
    return gift.symbol ? 'https://api.changes.tg/symbol/' +
        [gift.name, gift.symbol].map(giftAssetPart).join('/') + '.png' : '';
}

function giftPattern(gift) {
    const path = giftSymbolPath(gift);
    return path ? `<span class="gift-symbol-pattern" aria-hidden="true" style="--gift-symbol:url(&quot;${esc(path)}&quot;)"></span>` : '';
}

const giftAttributeRequests = new Map();

function giftAttributes(gift) {
    const collection = giftCollection(gift);
    if (!collection) return Promise.resolve(null);
    const id = collection.id;
    const existing = giftAttributeRequests.get(id);
    // Reuse completed and in-flight attribute lookups while browsing gifts.
    if (existing && existing.expires > Date.now()) return existing.request;
    const request = api('collections/' + encodeURIComponent(id) + '/attributes')
        .catch(error => {
            if (giftAttributeRequests.get(id)?.request === request) giftAttributeRequests.delete(id);
            throw error;
        });
    giftAttributeRequests.set(id, {request, expires: Date.now() + 90000});
    if (giftAttributeRequests.size > 40) giftAttributeRequests.delete(giftAttributeRequests.keys().next().value);
    return request;
}

async function prepareGiftBackdrop(art, gift, stage) {
    function paint(current) {
        if (!art.isConnected) return;
        art.style.background = giftBackdrop(current);
        const [center, edge] = giftBackdropColors(current);
        if (stage && center && edge) {
            stage.style.setProperty('--craft-result-center', center);
            stage.style.setProperty('--craft-result-edge', edge);
        }
    }

    paint(gift);
    const attributes = await giftAttributes(gift).catch(() => null);
    const backdrop = attributes?.backdrops?.find(item => item.name === gift.backdrop);
    const resolved = {...gift, background: {...gift.background, ...backdrop}};
    paint(resolved);

    // A transparent model must never replace a complete poster unless its backdrop can be shown.
    if (gift.backdrop && !giftBackdropColors(resolved).every(Boolean)) return false;
    const symbol = attributes?.symbols?.find(item => item.name === gift.symbol);
    const candidate = /^https:\/\//.test(symbol?.image_url || '') ? symbol.image_url : null;
    for (const url of new Set([candidate, giftSymbolPath(gift)].filter(Boolean))) {
        const preview = new Image();
        preview.crossOrigin = 'anonymous';
        preview.src = url;
        try {
            await preview.decode();
            art.querySelector('.gift-symbol-pattern')?.style.setProperty('--gift-symbol', `url("${encodeURI(url).replace(/"/g, '%22')}")`);
            return true;
        } catch {}
    }
    return !gift.symbol;
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

async function playGiftAnimation(art, gift, layer, dialog, backdrop) {
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
        const [data, lottie, ready] = await Promise.all([pending, loadGiftAnimationPlayer(), backdrop]);
        if (stopped || !art.isConnected || !data || !ready) return stop();
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

function mountGiftAnimation(art, gift, stage, autoplay = true) {
    const backdrop = prepareGiftBackdrop(art, gift, stage);
    backdrop.then(ready => {
        const path = giftAnimationPath(gift);
        if (!ready || !path || fragmentGiftPath(gift) || !gift.backdrop || !art.isConnected) return;
        const vector = new Image();
        vector.src = path + '.svg';
        vector.decode().then(() => {
            const poster = art.querySelector(':scope > img');
            if (!poster || !art.isConnected) return;
            poster.src = vector.src;
            poster.hidden = false;
        }).catch(() => {});
    });
    if (!giftAnimationPath(gift)) return;
    const dialog = art.closest('dialog');
    const layer = document.createElement('span');
    layer.className = 'gift-animation-layer';
    layer.setAttribute('aria-hidden', 'true');
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'gift-animation-replay';
    replay.setAttribute('aria-label', 'Воспроизвести анимацию подарка');
    replay.addEventListener('click', () => playGiftAnimation(art, gift, layer, dialog, backdrop));
    art.append(layer, replay);
    if (autoplay && !giftAnimationMotion.matches && document.documentElement.dataset.crafterAnimations !== 'off') playGiftAnimation(art, gift, layer, dialog, backdrop);
}
