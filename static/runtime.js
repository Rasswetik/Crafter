/* Persist each section's filters and load market pages as they approach the viewport. */
const viewFields=['query','collection','model','backdrop','symbol','order','minPrice','maxPrice','list'];let viewUser,views={},marketObserver,viewHydrated=false;
function restoreViews(){if(!state.me||viewUser===state.me.user.id)return;viewUser=state.me.user.id;try{views=JSON.parse(localStorage.getItem('crafter-views:'+viewUser)||'{}')}catch{views={}}}
function saveView(){restoreViews();if(!['market','gifts'].includes(state.page))return;views[state.page]=Object.fromEntries(viewFields.map(k=>[k,state[k]]));try{localStorage.setItem('crafter-views:'+viewUser,JSON.stringify(views))}catch{}}
const viewsGo=go;go=async function(page){if(state.crafting)return;const oldUser=viewUser;restoreViews();if(viewHydrated&&oldUser===viewUser)saveView();viewHydrated=true;if(state.page==='craft'||page==='craft')saveCraftDraft(page==='craft');marketObserver?.disconnect();if(['market','gifts'].includes(page)){const values=views[page]||{query:'',collection:'',model:'',backdrop:'',symbol:'',order:'listed_at desc',minPrice:'',maxPrice:'',list:false};for(const key of viewFields)state[key]=values[key]??(key==='list'?false:key==='order'?'listed_at desc':'')}await viewsGo(page)};
const viewFilter=changedFilter;changedFilter=function(){saveView();viewFilter()};
const continuousMarket=renderMarket;renderMarket=function(){const input=document.querySelector('.search-box input'),editing=document.activeElement===input,selection=input?.selectionStart;continuousMarket();document.querySelector('.load-more')?.remove();marketObserver?.disconnect();const sentinel=document.createElement('div');sentinel.id='market-sentinel';sentinel.className='market-sentinel';sentinel.textContent=state.marketLoading?'Загрузка…':'';document.querySelector('#main').appendChild(sentinel);if(editing){const next=document.querySelector('.search-box input');next?.focus();next?.setSelectionRange(selection,selection)}marketObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))loadMore()},{rootMargin:'400px'});marketObserver.observe(sentinel)};
loadMore=async function(){if(state.page!=='market'||state.marketLoading||state.marketHasMore===false||state.source==='demo')return;const signature=marketParams(0).toString(),offset=state.marketCursor||20;state.marketLoading=true;const el=document.querySelector('#market-sentinel');if(el)el.textContent='Загрузка…';let succeeded=false;try{const data=await api('market?'+marketParams(offset));if(state.page!=='market'||signature!==marketParams(0).toString())return;state.marketCursor=data.next_offset||offset+20;state.marketHasMore=data.has_more??data.gifts.length>=20;const known=new Set(state.gifts.map(g=>g.id));state.gifts.push(...data.gifts.filter(g=>!known.has(g.id)));filterGrid();succeeded=true}catch(e){if(el){el.textContent='Повторить загрузку';el.onclick=()=>loadMore()}}finally{state.marketLoading=false;if(!succeeded&&state.page==='market'&&signature!==marketParams(0).toString())setTimeout(loadMore,0);if(succeeded&&el){el.textContent='';el.onclick=null;if(state.marketHasMore&&el.getBoundingClientRect().top<innerHeight+400)setTimeout(loadMore,100)}}};
function giftBackdrop(g){const b=g.background||{};const color=(n,fallback)=>Number.isInteger(n)?'#'+(n&0xffffff).toString(16).padStart(6,'0'):fallback;return `radial-gradient(circle at 50% 40%,${color(b.center_color,'#4e6289')},${color(b.edge_color,'#263346')})`}
const backdropCard=card;card=function(g,action='detail'){return backdropCard(g,action).replace('class="art"',`class="art" style="background:${giftBackdrop(g)}"`)};
const backdropDetail=detail;detail=function(id){backdropDetail(id);const el=document.querySelector('.portal-product'),g=state.detailGift;if(el&&g)el.style.background=giftBackdrop(g)};

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
