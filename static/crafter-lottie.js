/* Real Lottie animation for supplied Magnate TGS model and collectible prizes.
   The Lottie player is loaded only on pages that display animations. */
const crafterLottieInstances=new Set();
const crafterLottieCache=new Map();
let crafterLottieLibraryPromise=null;

function crafterLoadLottieLibrary() {
    if(window.lottie?.loadAnimation)return Promise.resolve(window.lottie);
    if(crafterLottieLibraryPromise)return crafterLottieLibraryPromise;
    crafterLottieLibraryPromise=new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
        script.async=true;
        script.onload=()=>window.lottie?.loadAnimation?resolve(window.lottie):reject(new Error('Lottie library missing'));
        script.onerror=()=>reject(new Error('Lottie unavailable'));
        document.head.append(script);
    });
    return crafterLottieLibraryPromise;
}
function crafterLottieJSON(path){
    if(!crafterLottieCache.has(path)){
        const promise=fetch(path,{credentials:'same-origin'})
            .then(response=>{if(!response.ok)throw new Error('Animation unavailable');return response.json();});
        crafterLottieCache.set(path,promise);
    }
    return crafterLottieCache.get(path);
}
function crafterLottieCleanup(){
    for(const entry of crafterLottieInstances){
        if(entry.el.isConnected)continue;
        entry.observer?.disconnect();
        entry.animation.destroy();
        crafterLottieInstances.delete(entry);
    }
}
async function crafterLottieMount(el,path){
    if(!el||el.dataset.lottieInitialized)return;
    el.dataset.lottieInitialized='pending';
    try{
        const [library,data]=await Promise.all([crafterLoadLottieLibrary(),crafterLottieJSON(path)]);
        if(!el.isConnected) return;
        crafterLottieCleanup();
        const instance=library.loadAnimation({
            container:el,renderer:'svg',loop:true,autoplay:false,
            animationData:structuredClone(data),
            rendererSettings:{preserveAspectRatio:'xMidYMid meet',progressiveLoad:true}
        });
        instance.setSubframe(false);
        const entry={el,animation:instance,observer:null};
        crafterLottieInstances.add(entry);
        instance.addEventListener('DOMLoaded',()=>{
            el.classList.add('crafter-lottie-loaded');
            el.parentElement?.classList.add('crafter-lottie-playing');
        });
        if('IntersectionObserver' in window){
            const observer=new IntersectionObserver(entries=>{
                if(entries.some(e=>e.isIntersecting&&!document.hidden))instance.play();
                else instance.pause();
            },{threshold:.03});
            observer.observe(el);entry.observer=observer;
        }else if(!document.hidden)instance.play();
        el.dataset.lottieInitialized='yes';
    }catch(_error){
        el.dataset.lottieInitialized='fallback';
        // The existing static model remains visible when network or renderer fails.
    }
}
function crafterLottieEnhance(root=document){
    crafterLottieCleanup();
    root.querySelectorAll('[data-crafter-lottie="magnate"]').forEach(el=>{
        crafterLottieMount(el,'/media/crafter/magnate.json');
    });
}
function crafterLoadEventNFTAnimations(root=document){
    crafterLottieCleanup();
    root.querySelectorAll('[data-event-nft]').forEach(el=>{
        const slug=el.dataset.eventNft?.toLowerCase();
        if(!slug||!/^[a-z][a-z0-9]{1,70}-[0-9]{1,10}$/.test(slug))return;
        const target=document.createElement('span');
        target.className='crafter-nft-lottie-container';
        el.append(target);
        crafterLottieMount(target,'/media/crafter/gift/'+slug+'.json');
    });
}
document.addEventListener('visibilitychange',()=>{
    for(const entry of crafterLottieInstances){
        if(!entry.el.isConnected){entry.observer?.disconnect();entry.animation.destroy();crafterLottieInstances.delete(entry);continue;}
        if(document.hidden)entry.animation.pause();
        else if(entry.el.getBoundingClientRect().bottom>0&&
                entry.el.getBoundingClientRect().top<window.innerHeight)entry.animation.play();
    }
});
