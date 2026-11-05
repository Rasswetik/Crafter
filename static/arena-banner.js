/* Shared Ice Arena banner renderer — the admin preview and real arena use this same component. */
const ICE_BANNER_FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Arial, sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, Arial, sans-serif',
    mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif',
    condensed: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif',
    heavy: 'Impact, "Arial Black", sans-serif',
    bold: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
    geometric: '"Trebuchet MS", Verdana, Arial, sans-serif',
    clean: 'Verdana, Tahoma, Arial, sans-serif',
    classic: 'Tahoma, Arial, sans-serif',
    display: '"SF Pro Display", -apple-system, Arial, sans-serif',
    futuristic: 'Eurostile, "Trebuchet MS", Arial, sans-serif'
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
        const offset=Number(node.dataset.offset||0);
        const now=(Date.now()-offset)/1000;
        const start=Number(node.dataset.start);
        const end=Number(node.dataset.end);
        const target=now<start?start:end;
        const mode=now<start?'start':now<end?'end':'done';
        const timer=iceBannerTime(Math.max(0,target-now),node.dataset.format);
        const digits=node.querySelector('.ice-clock-digits');
        if(digits&&digits.textContent!==timer)digits.textContent=timer;
        node.setAttribute('aria-label',(mode==='start'?'До начала: ':
            mode==='end'?'До окончания: ':'Событие завершено: ')+timer);
    });
}
function iceBannerRichText(node,value) {
    const inline=document.createElement('span');
    inline.className='ice-banner-inline';
    const parts=String(value||'').split(/(\{GRAM\})/gi);
    for(const part of parts) {
        if(part.toUpperCase()==='{GRAM}') {
            const icon=document.createElement('img');
            icon.src='/static/assets/gram.svg';
            icon.alt='GRAM';
            icon.className='ice-gram-inline';
            icon.draggable=false;
            inline.append(icon);
        } else if(part) {
            inline.append(document.createTextNode(part));
        }
    }
    node.append(inline);
    return inline;
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


function iceBannerDragLayer(el,layer,stage,event,options) {
    if(event.button!==0&&event.pointerType==='mouse')return;
    if(el.querySelector('[contenteditable=true]'))return;
    event.preventDefault();
    event.stopPropagation();
    const edge=event.target.closest('[data-ice-handle]')?.dataset.iceHandle||'move';
    const initial={x:Number(layer.x),y:Number(layer.y),w:Number(layer.w),h:Number(layer.h)};
    const rect=stage.getBoundingClientRect();
    const origin={x:event.clientX,y:event.clientY};
    if(options.onSelect)options.onSelect(layer.id);
    el.setPointerCapture(event.pointerId);
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const round=v=>Math.round(v*10)/10;
    const move=e=>{
        const dx=(e.clientX-origin.x)/Math.max(1,rect.width)*100;
        const dy=(e.clientY-origin.y)/Math.max(1,rect.height)*100;
        let {x,y,w,h}=initial;
        if(edge==='move'){
            x=clamp(initial.x+dx,0,100-initial.w);
            y=clamp(initial.y+dy,0,100-initial.h);
        }else{
            if(edge.includes('e'))w=clamp(initial.w+dx,3,100-initial.x);
            if(edge.includes('s'))h=clamp(initial.h+dy,3,100-initial.y);
            if(edge.includes('w')){
                x=clamp(initial.x+dx,0,initial.x+initial.w-3);
                w=initial.w+initial.x-x;
            }
            if(edge.includes('n')){
                y=clamp(initial.y+dy,0,initial.y+initial.h-3);
                h=initial.h+initial.y-y;
            }
        }
        layer.x=round(x);layer.y=round(y);
        layer.w=round(w);layer.h=round(h);
        el.style.left=layer.x+'%';el.style.top=layer.y+'%';
        el.style.width=layer.w+'%';el.style.height=layer.h+'%';
    };
    const end=()=>{
        el.removeEventListener('pointermove',move);
        el.removeEventListener('pointerup',end);
        el.removeEventListener('pointercancel',end);
        if(options.onMove)options.onMove(layer.id);
    };
    el.addEventListener('pointermove',move);
    el.addEventListener('pointerup',end);
    el.addEventListener('pointercancel',end);
}

function iceBannerResizeCanvas(stage,banner,handle,options){
    handle.addEventListener('pointerdown',e=>{
        if(e.button!==0&&e.pointerType==='mouse')return;
        e.preventDefault();e.stopPropagation();
        const edge=handle.dataset.iceCanvasEdge;
        const parentWidth=Math.max(1,stage.parentElement.getBoundingClientRect().width);
        const initialWidth=Number(banner.width_pct??100);
        const initialHeight=Number(banner.height);
        const down={x:e.clientX,y:e.clientY};
        handle.setPointerCapture(e.pointerId);
        const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
        const move=event=>{
            const delta=(event.clientX-down.x)/parentWidth*200;
            if(edge.includes('right'))banner.width_pct=Math.round(clamp(initialWidth+delta,50,100));
            if(edge.includes('left'))banner.width_pct=Math.round(clamp(initialWidth-delta,50,100));
            if(edge.includes('bottom'))banner.height=Math.round(clamp(initialHeight+event.clientY-down.y,70,280));
            stage.style.width=banner.width_pct+'%';
            stage.style.height=banner.height+'px';
        };
        const end=()=>{
            handle.removeEventListener('pointermove',move);
            handle.removeEventListener('pointerup',end);
            handle.removeEventListener('pointercancel',end);
            if(options.onCanvasResize)options.onCanvasResize();
        };
        handle.addEventListener('pointermove',move);
        handle.addEventListener('pointerup',end);
        handle.addEventListener('pointercancel',end);
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
    stage.style.width = Math.max(50, Math.min(100, Number(banner.width_pct ?? 100))) + '%';
    stage.style.marginInline = 'auto';
    stage.style.height = Math.max(70, Math.min(280, Number(banner.height) || 112)) + 'px';
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
        el.style.fontSize = 'clamp(9px, ' + Number(layer.font_size) / 4 + 'cqw, ' +
            Number(layer.font_size) + 'px)';
        el.style.webkitTextStroke = Math.max(0, Math.min(3, Number(layer.stroke_width) || 0)) +
            'px ' + layer.color;
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
        } else if (layer.type === 'gram') {
            const img = document.createElement('img');
            img.src = '/static/assets/gram.svg';
            img.alt = 'GRAM';
            img.className = 'ice-gram-layer-icon';
            img.draggable = false;
            el.append(img);
        } else if (layer.type === 'timer') {
            el.classList.add('ice-banner-countdown');
            el.dataset.start = banner.start_at;
            el.dataset.end = banner.end_at;
            el.dataset.offset = offset;
            el.dataset.format = layer.format || 'hh:mm:ss';
            if (layer.text) iceBannerRichText(el, layer.text + ' ');
            const digits = document.createElement('span');
            digits.className = 'ice-clock-digits';
            digits.textContent = '00:00:00';
            el.append(digits);
        } else {
            iceBannerRichText(el, layer.text || '');
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
