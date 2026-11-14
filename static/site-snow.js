/* Lightweight, site-wide snowfall. CSS animations only; no per-frame JS. */
(function () {
    'use strict';
    const allowed={density:['light','normal','heavy'],speed:['slow','normal','fast'],size:['small','normal','large']};
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    let current={enabled:false,density:'normal',speed:'normal',size:'normal'};
    let root=null;
    let lastConfig='';
    let busy=false;
    const reduced=()=>media.matches;
    function removeSnow(){
        if(root){root.remove();root=null;}
        lastConfig='';
    }
    function normalize(data){
        return {
            enabled:data?.enabled===true,
            density:allowed.density.includes(data?.density)?data.density:'normal',
            speed:allowed.speed.includes(data?.speed)?data.speed:'normal',
            size:allowed.size.includes(data?.size)?data.size:'normal'
        };
    }
    function renderSnow(data){
        current=normalize(data);
        if(!current.enabled||reduced()||document.documentElement.classList.contains('ny-off')){removeSnow();return;}
        const narrow=window.matchMedia('(max-width: 600px)').matches;
        const count=({light:15,normal:31,heavy:51})[current.density];
        const flakes=narrow?Math.min(count,14):count;
        const configKey=[current.density,current.speed,current.size,narrow].join(':');
        if(root&&lastConfig===configKey){
            root.classList.toggle('crafter-snow-paused',document.hidden);
            return;
        }
        removeSnow();
        lastConfig=configKey;
        root=document.createElement('div');
        root.className='crafter-snowfall';
        root.setAttribute('aria-hidden','true');
        root.setAttribute('role','presentation');
        const speed={slow:1.65,normal:1,fast:.64}[current.speed];
        const multiplier={small:.75,normal:1,large:1.5}[current.size];
        const fragment=document.createDocumentFragment();
        for(let i=0;i<flakes;i++){
            const particle=document.createElement('span');
            particle.className='crafter-snowflake';
            const n=(i*73+17)%101;
            const length=Math.round((10+(i*37)%18)*speed*10)/10;
            // Three depths: far flakes are small, dim and slow; near flakes are larger, soft and faster.
            const depth=i%3;
            particle.classList.add('snow-d'+depth);
            if(i%11===0)particle.textContent='❅';
            const size=([2.6,4.4,7.2][depth]+((i*23)%5)*.35)*multiplier;
            particle.style.setProperty('--snow-x',((i*59+11)%100)+'%');
            particle.style.setProperty('--snow-drift',((i*41)%140-70)+'px');
            particle.style.setProperty('--snow-size',size.toFixed(1)+'px');
            particle.style.setProperty('--snow-delay',(-((i*11)%25))+'s');
            particle.style.setProperty('--snow-duration',(length*([1.35,1,.78][depth])).toFixed(1)+'s');
            particle.style.setProperty('--snow-opacity',([0.38,0.6,0.85][depth]).toFixed(2));
            particle.style.setProperty('--snow-sway',([6,11,17][depth]+(i*7)%6)+'px');
            particle.style.setProperty('--snow-sway-time',(2.4+((i*13)%9)*.35).toFixed(1)+'s');
            fragment.append(particle);
        }
        root.append(fragment);
        document.body.append(root);
        root.classList.toggle('crafter-snow-paused',document.hidden);
    }
    async function refreshSnow(){
        if(busy||document.hidden)return;
        busy=true;
        try{
            const response=await fetch('/api/site/snow',{credentials:'same-origin',cache:'no-store'});
            if(!response.ok)return;
            renderSnow(await response.json());
        }catch(_error){
            // Network issues must never block the app or remove existing effects.
        }finally{busy=false;}
    }
    window.crafterSnowApply=renderSnow;
    function init(){
        refreshSnow();
        document.addEventListener('visibilitychange',()=>{
            if(root)root.classList.toggle('crafter-snow-paused',document.hidden);
            if(!document.hidden)refreshSnow();
        });
        const onMediaChange=()=>renderSnow(current);
        if(media.addEventListener)media.addEventListener('change',onMediaChange);
        else if(media.addListener)media.addListener(onMediaChange);
        window.addEventListener('resize',()=>{
            if(root&&current.enabled)renderSnow(current);
        },{passive:true});
        setInterval(()=>{if(!document.hidden)refreshSnow();},120000);
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
    else init();
})();
