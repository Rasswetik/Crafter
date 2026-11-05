/* Shared Ice Arena banner renderer — the admin preview and real arena use this same component. */
const ICE_BANNER_FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Arial, sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, Arial, sans-serif',
    mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif',
    condensed: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif'
};
let iceBannerTickInterval = null;

function iceBannerTime(seconds, format) {
    const count = Math.max(0, Math.ceil(seconds));
    const pad = n => String(n).padStart(2, '0');
    if (format === 'mm:ss') return pad(Math.floor(count / 60)) + ':' + pad(count % 60);
    const h = Math.floor(count / 3600);
    if (format === 'days') return Math.floor(h / 24) + 'д ' + pad(h % 24) + ':' +
        pad(Math.floor(count / 60) % 60) + ':' + pad(count % 60);
    return pad(h) + ':' + pad(Math.floor(count / 60) % 60) + ':' + pad(count % 60);
}

function iceBannerUpdateClocks() {
    document.querySelectorAll('.ice-banner-countdown[data-end]').forEach(node => {
        const offset = Number(node.dataset.offset || 0);
        const now = (Date.now() - offset) / 1000;
        const start = Number(node.dataset.start);
        const end = Number(node.dataset.end);
        const target = now < start ? start : end;
        const mode = now < start ? 'start' : now < end ? 'end' : 'done';
        const timer = mode === 'done' ? '00:00' : iceBannerTime(target - now, node.dataset.format);
        const rendered = (node.dataset.prefix || '') + timer;
        if (node.textContent !== rendered) node.textContent = rendered;
        node.setAttribute('aria-label', (mode === 'start' ? 'До начала: ' :
            mode === 'end' ? 'До окончания: ' : 'Событие завершено: ') + timer);
    });
}

function iceBannerStartClock() {
    if (iceBannerTickInterval != null) return;
    iceBannerTickInterval = setInterval(() => {
        if (!document.hidden) iceBannerUpdateClocks();
    }, 1000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) iceBannerUpdateClocks();
    });
}

function iceBannerMount(container, banner, options = {}) {
    if (!container) return;
    container.replaceChildren();
    const stage = document.createElement('div');
    stage.className = 'ice-banner-stage' + (options.editable ? ' ice-banner-editable' : '');
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', banner.title || 'Ice Arena — событие');
    if (!options.editable) {
        const eventId = /^[0-9a-f]{32}$/.test(banner.event_id || '') ? banner.event_id : null;
        stage.classList.add('ice-banner-link');
        stage.tabIndex = 0;
        stage.setAttribute('role', 'link');
        stage.setAttribute('aria-label', 'Открыть лидерборд события: ' + (banner.title || 'Ивент'));
        const activate = () => {
            if (typeof go === 'function') go('events', eventId);
        };
        stage.addEventListener('click', activate);
        stage.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            activate();
        });
    }
    stage.style.height = Math.max(70, Math.min(240, Number(banner.height) || 112)) + 'px';
    stage.style.borderRadius = (Number(banner.radius) || 0) + 'px';
    stage.style.backgroundColor = banner.background_color || '#085e98';
    if (/^\/media\/ice-banner\/[0-9a-f]{32}\.(?:gif|webp)$/.test(banner.background_asset || '')) {
        stage.style.backgroundImage = 'linear-gradient(110deg,#03192e28,#49bbf510),url("' +
            banner.background_asset + '")';
        stage.style.backgroundSize = 'cover,' + (banner.background_fit || 'cover');
        stage.style.backgroundPosition = 'center';
    }
    const offset = Date.now() - Number(options.serverTime || Date.now() / 1000) * 1000;
    const sorted = [...(banner.layers || [])].sort((a,b) => Number(a.z) - Number(b.z));
    for (const layer of sorted) {
        const el = document.createElement('div');
        el.className = 'ice-banner-layer ice-banner-type-' + layer.type +
            (options.editable ? ' ice-banner-layer-edit' : '') +
            (options.selected === layer.id ? ' is-selected' : '');
        el.dataset.bannerLayer = layer.id;
        el.style.left = layer.x + '%';
        el.style.top = layer.y + '%';
        el.style.width = layer.w + '%';
        el.style.height = layer.h + '%';
        el.style.zIndex = Number(layer.z) + 1;
        el.style.color = layer.color;
        el.style.fontFamily = ICE_BANNER_FONTS[layer.font] || ICE_BANNER_FONTS.system;
        el.style.fontWeight = layer.font_weight;
        el.style.fontSize = 'clamp(10px, ' + Number(layer.font_size) / 3.9 + 'cqw, ' +
            Number(layer.font_size) + 'px)';
        el.style.borderRadius = Number(layer.radius) + 'px';
        el.style.justifyContent = {left:'flex-start',center:'center',right:'flex-end'}[layer.align] || 'center';
        el.style.textAlign = layer.align;
        const bg = layer.bg_color || '#ffffff';
        const hex = /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#ffffff';
        const alpha = Math.round(Math.max(0, Math.min(1, Number(layer.bg_opacity))) * 255)
            .toString(16).padStart(2,'0');
        el.style.background = Number(layer.bg_opacity) <= 0 ? 'transparent' : hex + alpha;
        if (layer.type === 'image') {
            if (/^\/media\/ice-banner\/[0-9a-f]{32}\.(?:gif|webp)$/.test(layer.asset || '')) {
                const img = document.createElement('img');
                img.src = layer.asset;
                img.alt = layer.text || '';
                img.loading = 'lazy';
                img.draggable = false;
                img.style.objectFit = layer.fit || 'contain';
                el.append(img);
            } else {
                el.classList.add('ice-banner-missing-image');
                el.textContent = options.editable ? 'Загрузите PNG / GIF' : '';
            }
        } else if (layer.type === 'timer') {
            el.classList.add('ice-banner-countdown');
            el.dataset.start = banner.start_at;
            el.dataset.end = banner.end_at;
            el.dataset.offset = offset;
            el.dataset.format = layer.format || 'hh:mm:ss';
            el.dataset.prefix = layer.text ? layer.text + ' ' : '';
        } else {
            el.textContent = layer.text || '';
        }
        if (options.editable) {
            el.tabIndex = 0;
            el.setAttribute('aria-label','Переместить слой ' + (layer.text || layer.type));
            el.addEventListener('pointerdown', event => {
                if (event.button !== 0 && event.pointerType === 'mouse') return;
                event.preventDefault();
                const rect = stage.getBoundingClientRect();
                const initX = Number(layer.x), initY = Number(layer.y);
                const downX = event.clientX, downY = event.clientY;
                if (options.onSelect) options.onSelect(layer.id, true);
                el.setPointerCapture(event.pointerId);
                const move = e => {
                    const w = rect.width || 1, h = rect.height || 1;
                    const maxX = Math.max(0, 100 - Number(layer.w));
                    const maxY = Math.max(0, 100 - Number(layer.h));
                    layer.x = Math.round(Math.max(0, Math.min(maxX, initX + (e.clientX-downX) / w * 100)) * 10) / 10;
                    layer.y = Math.round(Math.max(0, Math.min(maxY, initY + (e.clientY-downY) / h * 100)) * 10) / 10;
                    el.style.left = layer.x + '%';
                    el.style.top = layer.y + '%';
                };
                const stop = () => {
                    el.removeEventListener('pointermove', move);
                    el.removeEventListener('pointerup', stop);
                    el.removeEventListener('pointercancel', stop);
                    if (options.onMove) options.onMove(layer.id);
                };
                el.addEventListener('pointermove', move);
                el.addEventListener('pointerup', stop);
                el.addEventListener('pointercancel', stop);
            });
            el.addEventListener('keydown', e => {
                if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
                e.preventDefault();
                const axis = /Left|Right/.test(e.key) ? 'x' : 'y';
                const direction = /Right|Down/.test(e.key) ? 1 : -1;
                layer[axis] = Math.max(0, Math.min(100 - layer[axis === 'x' ? 'w' : 'h'],
                    Number(layer[axis]) + direction));
                if (options.onMove) options.onMove(layer.id);
            });
        }
        stage.append(el);
    }
    container.append(stage);
    iceBannerStartClock();
    iceBannerUpdateClocks();
}

let iceArenaBannerPollTimer;
async function iceArenaLoadBanner(view, privateRoom = false) {
    clearTimeout(iceArenaBannerPollTimer);
    const holder = document.getElementById('arena-event-banner');
    if (!holder) return;
    try {
        const response = await api('arena/banner?room=' + (privateRoom ? 'private' : 'public'));
        if (view !== arena.view || !holder.isConnected) return;
        if (response.banner) {
            holder.hidden = false;
            iceBannerMount(holder,response.banner,{serverTime:response.server_time});
            holder.setAttribute('title',response.banner.title || 'Событие Ice Arena');
        } else {
            holder.hidden = true;
            holder.replaceChildren();
        }
    } catch (error) {
        if (view !== arena.view) return;
        holder.hidden = true;
    }
    if (view === arena.view) {
        iceArenaBannerPollTimer = setTimeout(() =>
            iceArenaLoadBanner(view, privateRoom), 60000);
    }
}
