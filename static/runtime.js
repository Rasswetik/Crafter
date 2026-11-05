/* Persist each section's filters and load market pages as they approach the viewport. */
const viewFields=['query','collection','model','backdrop','symbol','order','minPrice','maxPrice','list'];let viewUser,views={},marketObserver,viewHydrated=false;
function restoreViews(){if(!state.me||viewUser===state.me.user.id)return;viewUser=state.me.user.id;try{views=JSON.parse(localStorage.getItem('crafter-views:'+viewUser)||'{}')}catch{views={}}}
function saveView() {
    restoreViews();
    if (!['market', 'gifts'].includes(state.page)) return;
    views[state.page] = Object.fromEntries(viewFields.map(key => [key, state[key]]));
    if (state.page === 'market') views.marketSource = state.marketSource;
    try { localStorage.setItem('crafter-views:' + viewUser, JSON.stringify(views)); } catch {}
}
const viewsGo = go;
go = async function(page) {
    if (state.crafting) return;
    const oldUser = viewUser;
    restoreViews();
    if (viewHydrated && oldUser === viewUser) saveView();
    viewHydrated = true;
    if (state.page === 'craft' || page === 'craft') saveCraftDraft(page === 'craft');
    marketObserver?.disconnect();
    if (['market', 'gifts'].includes(page)) {
        const values = views[page] || {};
        for (const key of viewFields) state[key] = values[key] ?? (key === 'list' ? false : '');
        if (!state.order || (page === 'market' && views.marketSource !== state.marketSource)) {
            state.order = page === 'market' && state.marketSource === 'crafter' ? 'price asc' : 'listed_at desc';
        }
    }
    await viewsGo(page);
};
async function filterMarketByGiftTrait(key) {
    const gift = state.detailGift;
    if (!['model', 'backdrop', 'symbol'].includes(key) || !gift?.[key]) return;
    if (!giftCollection(gift) && state.catalogReady) await state.catalogReady.catch(() => {});
    if (state.detailGift !== gift || !document.querySelector('#sheet').open) return;
    const collection = giftCollection(gift);
    if (!collection && !gift.collection_id) return toast('Коллекция пока недоступна');
    restoreViews();
    const filter = {
        query: '', collection: collection?.id ?? gift.collection_id,
        model: '', backdrop: '', symbol: '', minPrice: '', maxPrice: '', [key]: gift[key],
    };
    views.market = {...views.market, ...filter};
    if (state.page === 'market') Object.assign(state, filter);
    saveView();
    closeSheet();
    await go('market');
}

const viewFilter=changedFilter;changedFilter=function(){saveView();viewFilter()};
const continuousMarket=renderMarket;renderMarket=function(){const input=document.querySelector('.search-box input'),editing=document.activeElement===input,selection=input?.selectionStart;continuousMarket();document.querySelector('.load-more')?.remove();marketObserver?.disconnect();const sentinel=document.createElement('div');sentinel.id='market-sentinel';sentinel.className='market-sentinel';sentinel.textContent=state.marketLoading?'Загрузка…':'';document.querySelector('#main').appendChild(sentinel);if(editing){const next=document.querySelector('.search-box input');next?.focus();next?.setSelectionRange(selection,selection)}marketObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&state.marketHasMore!==false)loadMore()},{rootMargin:'180px'});if(state.marketHasMore!==false)marketObserver.observe(sentinel)};
loadMore=async function(){if(state.page!=='market'||state.marketLoading||state.marketHasMore===false||state.source==='demo')return;const signature=marketParams(0).toString(),offset=state.marketCursor||20;state.marketLoading=true;const el=document.querySelector('#market-sentinel');if(el)el.textContent='Загрузка…';marketObserver?.disconnect();try{const data=await api('market?'+marketParams(offset));if(state.page!=='market'||signature!==marketParams(0).toString())return;const known=new Set(state.gifts.map(g=>g.id));const fresh=data.gifts.filter(g=>!known.has(g.id));const cursor=Number(data.next_offset);const advanced=Number.isFinite(cursor)&&cursor>offset;state.marketCursor=advanced?cursor:offset+data.gifts.length;state.marketHasMore=Boolean((data.has_more??data.gifts.length>=20)&&fresh.length&&state.marketCursor>offset);if(fresh.length){state.gifts.push(...fresh);filterGrid()}if(el){el.textContent=state.marketHasMore?'':'Все подарки загружены';el.onclick=null}if(state.marketHasMore&&state.page==='market'){const sentinel=document.querySelector('#market-sentinel');if(sentinel)marketObserver?.observe(sentinel)}}catch(e){if(el){el.textContent='Повторить загрузку';el.onclick=()=>loadMore()}}finally{state.marketLoading=false}};
function giftColor(value) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
    if (typeof value === 'string' && /^[0-9]+$/.test(value)) value = Number(value);
    return Number.isInteger(value) ? '#' + (value & 0xffffff).toString(16).padStart(6, '0') : null;
}
function giftBackdropColors(gift) {
    const dark = {'Onyx Black': [0x505658, 0x24282a], Black: [0x343434, 0x101010]}[gift.backdrop];
    return [
        giftColor(gift.background?.center_color) ?? giftColor(dark?.[0]),
        giftColor(gift.background?.edge_color) ?? giftColor(dark?.[1]),
    ];
}
function giftBackdrop(gift) {
    const [center, edge] = giftBackdropColors(gift);
    return `radial-gradient(circle at 50% 40%, ${center || '#4e6289'}, ${edge || '#263346'})`;
}
const backdropCard=card;card=function(g,action='detail'){return backdropCard(g,action).replace('class="art"',`class="art" style="background:${giftBackdrop(g)}"`)};

const catalogReadySheet=openCatalogSheet;openCatalogSheet=async function(kind){if(!state.catalog.collections.length&&state.catalogReady)await state.catalogReady;return catalogReadySheet(kind)};

function craftDraftKey() {
    const userId = state.me?.user?.id;
    if (userId == null) return null;
    return 'crafter-craft:' + (state.me.demo ? 'demo:' : 'user:') + userId;
}

function restoreCraftDraft() {
    const key = craftDraftKey();
    if (!key) return false;
    try {
        const draft = JSON.parse(localStorage.getItem(key));
        if (!draft) return false;
        if (Array.isArray(draft.ids)) {
            state.selected = [...new Set(draft.ids.filter(id => typeof id === 'string'))]
                .slice(0, CRAFT_GIFT_LIMIT);
        }
        const target = draft.target;
        if (target && (typeof target.id === 'string' || Number.isSafeInteger(target.id)) &&
                typeof target.name === 'string') {
            state.target = { id: target.id, name: target.name, image: imageURL(target.image) };
            if (typeof target.listingId === 'string' && /^[1-9]\d*$/.test(String(target.number))) {
                state.target.listingId = target.listingId;
                state.target.number = target.number;
            }
        }
        return draft.resume === true;
    } catch {
        return false;
    }
}

function saveCraftDraft(resume = state.page === 'craft') {
    const key = craftDraftKey();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify({
            ids: state.selected,
            target: state.target || null,
            resume
        }));
    } catch {}
}
