/* Collection selector v2 — Portals-like tall sheet, true GRAM labels and crafted-only toggle. */
(function(){
 const matchesCraft = new Set(['jinglebells','junglebells','mythmask','puffmask','resistancedog','deskcalendar']);
 const key=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 let localVolumes={};
 let craftOnly=false;
 const anvil='<svg viewBox="0 0 9 9" fill="currentColor" aria-hidden="true">'+
 '<path d="M7.95567 3.80395C8.01856 3.80395 8.06973 3.8544 8.0699 3.91695V4.22956C8.0699 4.4209 8.22586 4.57601 8.41802 4.57601H8.5642C8.62714 4.57601 8.67843 4.62705 8.67843 4.68969C8.67836 5.18975 8.26981 5.59641 7.76733 5.59641H7.48244C6.71947 5.59645 5.89006 5.81967 5.89006 6.57892C5.89019 7.04269 6.24429 7.28531 6.6656 7.46461C6.87737 7.55473 7.10798 7.58984C7.40107 7.58999 7.45168 7.64044 7.45185 7.70285V8.88632C7.4519 8.94893 7.40117 8.99985 7.3383 9H1.83432C1.77132 9 1.72009 8.94896 1.72009 8.88632V7.70285C1.72026 7.6403 1.77143 7.58984 1.83432 7.58984C2.06419 7.58984 2.29609 7.55787 2.50266 7.4575C2.87029 7.27887 3.10501 7.0366 3.10509 6.57892C3.10509 5.81969 2.44693 5.59646 1.68405 5.59641H1.4046C0.594559 5.59641 0.297949 4.57601 0.607734 4.57601H3.2472C3.43946 4.57601 3.59532 4.4209 3.59532 4.22956V3.91695C3.59549 3.8544 3.64666 3.80395 3.70955 3.80395H7.95567Z"/>'+
 '<path d="M4.97285 0.00383804C5.02295 -0.00939743 5.07566 0.0123659 5.10135 0.057294C5.11456 0.080493 5.27837 0.372394 5.45695 0.886876C5.66429 0.847304 5.98074 0.928422 6.0648 1.24077C6.12985 1.48243 6.21586 1.66992 6.0886 1.88901C6.02222 2.00326 5.89125 2.08402 5.77923 2.12381C5.82924 2.39628 5.87143 2.69229 5.89822 3.01023C5.9029 3.06496 5.86726 3.11511 5.81391 3.12932L4.81918 3.39119C4.77585 3.39119 4.73509 3.36611 4.71583 3.32555C4.5788 3.03579 4.46558 2.75767 4.37179 2.49597L1.1204 3.36344C1.06679 3.37775 1.01117 3.38442 0.955855 3.38442C0.209208 3.3841 0.0804571 2.32629 0.789954 2.13666L4.03183 1.27189C3.9272 0.735234 3.92257 0.399333 3.92236 0.37194C3.92196 0.320222 3.95657 0.275063 4.00667 0.261645L4.97285 0.00383804Z"/></svg>';
 function gramFloor(row){
   if(String(row.unit||'').toUpperCase()==='GRAM'&&Number(row.price)>0)
     return Number(row.price);
   const prices=(state.gifts||[]).filter(g=>
     key(g.name)===key(row.name)&&
     String(g.price_unit||state.marketUnit||'').toUpperCase()==='GRAM'&&Number(g.price)>0)
     .map(g=>Number(g.price));
   return prices.length?Math.min(...prices):null;
 }
 function volume(row){
   if(state.marketSource==='crafter'){
      const value=localVolumes[key(row.name)];
      return value!=null?money(value)+' GRAM':'—';
   }
   const value=row.volume_24h_gram??row.stats?.volume_24h_gram;
   return value!=null&&Number.isFinite(Number(value))?money(value)+' GRAM':'—';
 }
 function enhanceRows(query){
   if(state.sheetKind!=='collection')return;
   const term=String(query||'').toLowerCase();
   const matching=(state.catalogRows||[]).filter(row=>row.name.toLowerCase().includes(term));
   const nodes=[...document.querySelectorAll('#catalog-rows .catalog-row')];
   for(let i=0;i<nodes.length;i++){
      const node=nodes[i],row=matching[i];
      if(!row)continue;
      if(craftOnly&&!matchesCraft.has(key(row.name))){
         node.hidden=true;
         continue;
      }
      node.hidden=false;
      const old=node.querySelector('b');
      if(!old)continue;
      const wrapper=document.createElement('span');
      wrapper.className='catalog-price-volume';
      const price=document.createElement('strong');
      const amount=gramFloor(row);
      price.textContent=(amount!=null?money(amount):'—')+' GRAM';
      const small=document.createElement('small');
      small.textContent='Объём за 24 ч: '+volume(row);
      wrapper.append(price,small);
      old.replaceWith(wrapper);
   }
 }
 const originalRows=renderCatalogRows;
 renderCatalogRows=function(query){
    originalRows(query);
    enhanceRows(query);
 };
 const originalSheet=openCatalogSheet;
 openCatalogSheet=async function(kind){
    craftOnly=false;localVolumes={};
    await originalSheet(kind);
    if(kind!=='collection')return;
    const modal=document.querySelector('#sheet.catalog-sheet');
    if(!modal)return;
    const search=modal.querySelector('.catalog-search');
    if(search){
      const wrapper=document.createElement('div');
      wrapper.className='catalog-search-enhanced';
      search.parentNode.insertBefore(wrapper,search);
      wrapper.append(search);
      const button=document.createElement('button');
      button.type='button';
      button.className='catalog-craft-filter';
      button.innerHTML=anvil;
      button.title='Только крафтовые коллекции';
      button.setAttribute('aria-label','Только крафтовые коллекции');
      button.setAttribute('aria-pressed','false');
      button.onclick=()=>{
         craftOnly=!craftOnly;
         button.classList.toggle('active',craftOnly);
         button.setAttribute('aria-pressed',String(craftOnly));
         renderCatalogRows(search.querySelector('input')?.value||'');
      };
      wrapper.append(button);
    }
    const col=modal.querySelector('.catalog-columns span:last-child');
    if(col)col.textContent='Мин. цена · GRAM';
    if(state.marketSource==='crafter'){
       try{
          const response=await api('catalog/collection-volume');
          if(state.sheetKind==='collection'&&modal.isConnected){
            localVolumes=response.volume_by_collection||{};
            renderCatalogRows(modal.querySelector('.catalog-search input')?.value||'');
          }
       }catch(_error){}
    }
 };
})();
