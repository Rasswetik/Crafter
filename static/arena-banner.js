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


function iceBannerSnap(start,size,targets,threshold) {
    const edges=[start,start+size/2,start+size];
    let delta=0,guide=null,smallest=threshold;
    for(const target of targets){
        for(const point of edges){
            const distance=Math.abs(target-point);
            if(distance<=smallest){
                smallest=distance;
                delta=target-point;
                guide=target;
            }
        }
    }
    return {value:start+delta,guide};
}
function iceBannerGuides(stage){
    let x=stage.querySelector('.ice-banner-guide-x');
    let y=stage.querySelector('.ice-banner-guide-y');
    if(!x){x=document.createElement('span');x.className='ice-banner-guide ice-banner-guide-x';x.hidden=true;stage.append(x);}
    if(!y){y=document.createElement('span');y.className='ice-banner-guide ice-banner-guide-y';y.hidden=true;stage.append(y);}
    return {x,y};
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
    const guides=iceBannerGuides(stage);
    const peers=(options.layers||[]).filter(item=>item.id!==layer.id);
    const xTargets=[0,50,100,...peers.flatMap(item=>[
        Number(item.x),Number(item.x)+Number(item.w)/2,Number(item.x)+Number(item.w)])];
    const yTargets=[0,50,100,...peers.flatMap(item=>[
        Number(item.y),Number(item.y)+Number(item.h)/2,Number(item.y)+Number(item.h)])];
    if(options.onSelect)options.onSelect(layer.id);
    el.setPointerCapture(event.pointerId);
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const round=v=>Math.round(v*10)/10;
    const hideGuides=()=>{guides.x.hidden=true;guides.y.hidden=true;};
    const move=e=>{
        const dx=(e.clientX-origin.x)/Math.max(1,rect.width)*100;
        const dy=(e.clientY-origin.y)/Math.max(1,rect.height)*100;
        let {x,y,w,h}=initial;
        hideGuides();
        if(edge==='move'){
            x=clamp(initial.x+dx,0,100-initial.w);
            y=clamp(initial.y+dy,0,100-initial.h);
            const snapping=(options.snapEnabled?.()??true)&&!e.altKey;
            if(snapping){
                const sx=iceBannerSnap(x,w,xTargets,750/Math.max(140,rect.width));
                const sy=iceBannerSnap(y,h,yTargets,750/Math.max(70,rect.height));
                if(sx.guide!==null){
                    x=clamp(sx.value,0,100-w);
                    guides.x.hidden=false;guides.x.style.left=sx.guide+'%';
                }
                if(sy.guide!==null){
                    y=clamp(sy.value,0,100-h);
                    guides.y.hidden=false;guides.y.style.top=sy.guide+'%';
                }
            }
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
        hideGuides();
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


/* Backgrounds are explicit: a solid color must never be obscured by a CSS fallback gradient. */
function iceBannerApplyBackground(stage, banner) {
    const first=/^#[0-9a-f]{6}$/i.test(banner.background_color||'') ?
        banner.background_color : '#075b9e';
    const second=/^#[0-9a-f]{6}$/i.test(banner.background_second_color||'') ?
        banner.background_second_color : '#48bee5';
    const mode=banner.background_mode || (banner.background_asset ? 'image' : 'solid');
    const source=/^\/media\/ice-banner\/[0-9a-f]{32}\.(?:gif|webp)$/.test(banner.background_asset||'')
        ? banner.background_asset : '';
    stage.style.backgroundColor=first;
    stage.style.backgroundRepeat='no-repeat';
    const focusX=Math.max(0,Math.min(100,Number(banner.background_focus_x??50)));
    const focusY=Math.max(0,Math.min(100,Number(banner.background_focus_y??50)));
    stage.style.backgroundPosition='center, '+focusX+'% '+focusY+'%';
    if(mode==='image' && source) {
        const alpha=Math.round(Math.max(0,Math.min(.9,Number(banner.background_tint)||0))*255)
          .toString(16).padStart(2,'0');
        stage.style.backgroundImage='linear-gradient('+first+alpha+','+first+alpha+'), url("'+source+'")';
        stage.style.backgroundSize='100% 100%, '+(banner.background_fit==='contain'?'contain':'cover');
    } else if(mode==='gradient') {
        stage.style.backgroundImage='linear-gradient(110deg,'+first+','+second+')';
        stage.style.backgroundSize='100% 100%';
    } else {
        stage.style.backgroundImage='none';
        stage.style.backgroundSize='auto';
    }
}
function iceBannerMount(container, banner, options = {}) {
    if (!container) return;
    container.replaceChildren();
    const stage = document.createElement('div');
    stage.className = 'ice-banner-stage' + (options.editable ? ' ice-banner-editable' : '');
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', banner.title || 'Ice Arena — событие');
    if (!options.editable && !options.previewOnly) {
        const eventId = /^[0-9a-f]{32}$/.test(banner.event_id || '') ? banner.event_id : null;
        stage.classList.add('ice-banner-link');
        stage.tabIndex = 0;
        stage.setAttribute('role', 'link');
        stage.setAttribute('aria-label', 'Открыть лидерборд события: ' + (banner.title || 'Ивент'));
        const activate = () => {
            if (typeof go === 'function') go('events', eventId, options.kind !== 'craft');
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
    iceBannerApplyBackground(stage,banner);
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
                img.loading = 'eager';
                img.decoding = 'async';
                img.draggable = false;
                img.style.objectFit = layer.fit || 'contain';
                img.style.objectPosition='center center';
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
            el.tabIndex=0;
            el.setAttribute('aria-label','Выбрать и изменить '+(layer.text || layer.type));
            for(const direction of ['nw','n','ne','e','se','s','sw','w']){
                const h=document.createElement('span');
                h.className='ice-banner-handle ice-banner-handle-'+direction;
                h.dataset.iceHandle=direction;
                h.setAttribute('aria-hidden','true');
                el.append(h);
            }
            el.addEventListener('pointerdown',event=>iceBannerDragLayer(el,layer,stage,event,
                {...options,layers:banner.layers}));
            el.addEventListener('keydown',event=>{
                if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
                event.preventDefault();
                const axis=/Left|Right/.test(event.key)?'x':'y';
                const size=axis==='x'?'w':'h';
                const delta=/Right|Down/.test(event.key)?1:-1;
                if(event.shiftKey)layer[size]=Math.max(3,Math.min(100-layer[axis],Number(layer[size])+delta));
                else layer[axis]=Math.max(0,Math.min(100-layer[size],Number(layer[axis])+delta));
                el.style[axis==='x'?'left':'top']=layer[axis]+'%';
                el.style[axis==='x'?'width':'height']=layer[size]+'%';
                if(options.onMove)options.onMove(layer.id);
            });
            if(layer.type==='title'||layer.type==='text'){
                el.addEventListener('dblclick',event=>{
                    if(event.target.closest('[data-ice-handle]'))return;
                    const rich=el.querySelector('.ice-banner-inline');
                    if(!rich)return;
                    rich.textContent=layer.text||'';
                    rich.contentEditable='true';
                    rich.spellcheck=false;
                    rich.focus();
                    const range=document.createRange();
                    range.selectNodeContents(rich);
                    const selection=window.getSelection();
                    selection.removeAllRanges();selection.addRange(range);
                    rich.addEventListener('blur',()=>{
                        const updated=rich.innerText.slice(0,140).trim();
                        rich.contentEditable='false';
                        layer.text=updated;
                        rich.remove();
                        iceBannerRichText(el,updated);
                        if(options.onTextChange)options.onTextChange(layer.id);
                    },{once:true});
                });
            }
        }
        stage.append(el);
    }
    if(options.editable){
        for(const edge of ['left','right','bottom','right-bottom']){
            const handle=document.createElement('span');
            handle.className='ice-banner-canvas-handle ice-banner-canvas-'+edge;
            handle.dataset.iceCanvasEdge=edge;
            handle.title='Изменить ширину или высоту полотна';
            stage.append(handle);
            iceBannerResizeCanvas(stage,banner,handle,options);
        }
    }
    if(options.editable){
        stage.addEventListener('pointerdown',event=>{
            if(event.target!==stage || !options.backgroundDrag?.())return;
            if(event.button!==0 && event.pointerType==='mouse')return;
            event.preventDefault();
            const origin={x:event.clientX,y:event.clientY};
            const rect=stage.getBoundingClientRect();
            const initX=Number(banner.background_focus_x??50);
            const initY=Number(banner.background_focus_y??50);
            stage.setPointerCapture(event.pointerId);
            const guide=iceBannerGuides(stage);
            const move=e=>{
                const clamp=(n)=>Math.max(0,Math.min(100,n));
                const x=clamp(initX+(e.clientX-origin.x)/Math.max(1,rect.width)*100);
                const y=clamp(initY+(e.clientY-origin.y)/Math.max(1,rect.height)*100);
                banner.background_focus_x=Math.round(x);
                banner.background_focus_y=Math.round(y);
                stage.style.backgroundPosition='center, '+banner.background_focus_x+'% '+banner.background_focus_y+'%';
                guide.x.hidden=Math.abs(x-50)>2;guide.x.style.left='50%';
                guide.y.hidden=Math.abs(y-50)>2;guide.y.style.top='50%';
            };
            const end=()=>{
                stage.removeEventListener('pointermove',move);
                stage.removeEventListener('pointerup',end);
                stage.removeEventListener('pointercancel',end);
                guide.x.hidden=true;guide.y.hidden=true;
                options.onBackgroundMove?.();
            };
            stage.addEventListener('pointermove',move);
            stage.addEventListener('pointerup',end);
            stage.addEventListener('pointercancel',end);
        });
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
            const signature=JSON.stringify(response.banner);
            holder.hidden=false;
            // Most polls return an identical banner. Preserve the DOM to avoid
            // resetting animated GIFs and causing repeated image downloads.
            if(holder.dataset.bannerSignature!==signature) {
                holder.dataset.bannerSignature=signature;
                iceBannerMount(holder,response.banner,{serverTime:response.server_time});
            }
            holder.setAttribute('title',response.banner.title || 'Событие Arena');
        } else if (!holder.hidden) {
            holder.hidden = true;
            holder.dataset.bannerSignature='';
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


/* Independent Craft event banner, reused on Hub and inside Crafts.
   Data cache prevents redundant requests; DOM reuse preserves running GIFs. */
let crafterCraftBannerData=null;
let crafterCraftBannerFetchedAt=0;
let crafterCraftBannerInFlight=null;

async function crafterCraftBannerFetch(force=false) {
    const age=Date.now()-crafterCraftBannerFetchedAt;
    if(!force&&crafterCraftBannerData&&age<45000)return crafterCraftBannerData;
    if(crafterCraftBannerInFlight)return crafterCraftBannerInFlight;
    crafterCraftBannerInFlight=api('craft/banner').then(data=>{
        crafterCraftBannerData=data;
        crafterCraftBannerFetchedAt=Date.now();
        return data;
    }).finally(()=>{crafterCraftBannerInFlight=null;});
    return crafterCraftBannerInFlight;
}

async function crafterCraftBannerMount(holderId) {
    const holder=document.getElementById(holderId);
    if(!holder)return;
    try {
        const response=await crafterCraftBannerFetch();
        if(!holder.isConnected)return;
        const config=response.banner;
        if(!config){
            holder.hidden=true;
            holder.replaceChildren();
            holder.dataset.bannerSignature='';
            return;
        }
        holder.hidden=false;
        const signature=JSON.stringify(config);
        if(holder.dataset.bannerSignature!==signature||!holder.querySelector('.ice-banner-stage')){
            iceBannerMount(holder,config,{serverTime:response.server_time,kind:'craft'});
            holder.dataset.bannerSignature=signature;
        }
        holder.title='Открыть событие: '+(config.title||'Крафты');
    } catch(e) {
        if(holder.isConnected&&!holder.querySelector('.ice-banner-stage'))holder.hidden=true;
    }
}
