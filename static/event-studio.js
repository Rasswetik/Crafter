/* Crafter Event Page Studio — visual per-event block and banner constructor. */
let crafterStudio=null;
const STUDIO_FONTS=[
 ['system','Системный'],['rounded','Скруглённый'],['display','SF Pro Display'],
 ['heavy','Impact'],['bold','Arial Black'],['clean','Verdana'],['geometric','Trebuchet'],
 ['condensed','Узкий'],['mono','Моноширинный'],['serif','Georgia'],['classic','Tahoma'],
 ['futuristic','Техно']
];
const STUDIO_LABELS={header:'Заголовок + таймер',leaderboard:'Лидерборд',banner:'Баннер PNG / GIF',
 text:'Текст',timer:'Таймер',divider:'Разделитель',spacer:'Отступ'};
const STUDIO_FONT_FIELDS=new Set(['font','heading_font']);
const STUDIO_COLOR_FIELDS=new Set(['background','row_bg','row_border','text_color',
 'score_color','heading_color','color','bg_color','background_color','background_second_color']);
function studioEsc(v){return esc(String(v??''));}
function studioSelect(key,label,value,values,scope='block'){
 return '<label>'+label+'<select class="field" data-studio-scope="'+scope+'" data-studio-key="'+key+'">'+
 values.map(([val,name])=>'<option value="'+studioEsc(val)+'"'+
 (String(val)===String(value)?' selected':'')+'>'+studioEsc(name)+'</option>').join('')+
 '</select></label>';
}
function studioInput(key,label,value,scope='block',type='text',min='',max='',step=''){
 return '<label>'+label+'<input class="field" data-studio-scope="'+scope+
 '" data-studio-key="'+key+'" type="'+type+'" value="'+studioEsc(value)+
 '"'+(min!==''?' min="'+min+'"':'')+(max!==''?' max="'+max+'"':'')+
 (step!==''?' step="'+step+'"':'')+'></label>';
}
function studioColor(key,label,value,scope='block'){
 return studioInput(key,label,value,scope,'color');
}
function studioFont(key,label,value,scope='block'){
 return studioSelect(key,label,value,STUDIO_FONTS,scope);
}
function studioRankBlock(){return crafterStudio?.page.blocks.find(x=>x.type==='leaderboard');}
function studioBlock(){return crafterStudio?.page.blocks.find(x=>x.id===crafterStudio.selected);}
function studioLayer(){return studioBlock()?.banner?.layers?.find(x=>x.id===crafterStudio.layer);}
function studioFreshBlock(type){
 const id='b'+crypto.randomUUID().replaceAll('-','').slice(0,26);
 const p=crafterStudio.page.style;
 const block={id,type,enabled:true,padding:0,radius:0,
  background:p.background,text:'',color:p.text_color,font:p.font,
  font_size:18,height:26,align:'left',rank_count:p.rank_count,banner:null};
 if(type==='banner'){
    block.banner={title:'',height:112,width_pct:100,radius:19,
      background_color:'#165580',background_second_color:'#4eb4dd',
      background_mode:'gradient',background_asset:'',background_fit:'cover',
      background_tint:0,background_focus_x:50,background_focus_y:50,link_target:'event',
      layers:[studioFreshLayer('text','Заголовок события')]};
 }
 if(type==='text')block.text='Напишите текст';
 if(type==='timer')block.text='До конца';
 if(type==='spacer')block.height=20;
 return block;
}
function studioFreshLayer(type,text=''){
 return {id:'layer'+crypto.randomUUID().replaceAll('-','').slice(0,19),
  type,text,x:5,y:16,w:type==='image'?35:type==='timer'?35:54,h:64,
  font:'rounded',font_size:type==='timer'?20:27,font_weight:800,
  stroke_width:0,color:'#ffffff',bg_color:'#112943',
  bg_opacity:0,radius:12,align:'center',format:'hh:mm:ss',
  asset:'',fit:'contain',z:1};
}
function studioSetStatus(message){
 const node=document.getElementById('studio-status');
 if(node)node.textContent=message;
}
function studioDirty(){crafterStudio.dirty=true;studioSetStatus('Изменения не сохранены');}
async function crafterOpenEventStudio(eventId){
 const [results,layout]=await Promise.all([
  api('admin/events'),api('admin/events/'+eventId+'/page')
 ]);
 const event=results.events?.find(e=>e.id===eventId);
 if(!event)return toast('Событие не найдено');
 const content=document.querySelector('#admin-content');
 if(!content)return;
 const selected=layout.page.blocks.find(b=>b.enabled!==false)||layout.page.blocks[0];
 crafterStudio={event,page:layout.page,selected:selected?.id||'',
  layer:selected?.banner?.layers?.[0]?.id||'',previewMode:false,
  snap:true,backgroundDrag:false,focus:true,dirty:false,prizeFiles:new Map(),rank:1};
 content.innerHTML='<div class="crafter-event-studio">'+
  '<section class="panel studio-toolbar">'+
  '<button type="button" class="secondary" data-studio-action="back">Назад к событиям</button>'+
  '<div class="studio-heading"><h3>Конструктор · '+studioEsc(event.title)+'</h3>'+
  '<p class="sub">Блоки можно менять местами; каждый баннер имеет собственные слои и GIF.</p></div>'+
  '<button type="button" class="secondary" data-studio-action="add-banner">+ Баннер</button>'+
  '<button type="button" class="secondary" data-studio-action="add-gif">+ PNG / GIF</button>'+
  '<input id="studio-quick-gif" type="file" accept="image/png,image/gif,image/webp,image/jpeg" data-studio-upload="layer" hidden>'+
  '<button type="button" class="primary" data-studio-action="save">Сохранить страницу</button>'+
  '<p role="status" id="studio-status">Настройки загружены</p></section>'+
  '<section class="studio-workspace">'+
   '<aside class="panel studio-sidebar">'+
    '<h4>Блоки страницы</h4><div id="studio-block-list"></div>'+
    '<label>Добавить блок<select class="field" id="studio-add-kind">'+
    Object.entries(STUDIO_LABELS).map(([val,name])=>
      '<option value="'+val+'">'+studioEsc(name)+'</option>').join('')+
    '</select></label><button type="button" class="secondary" data-studio-action="add">+ Добавить</button>'+
    '<button type="button" class="secondary" data-studio-action="style">Стиль всей страницы</button>'+
    '<button type="button" class="secondary" data-studio-action="prizes">Награды 1–100</button>'+
   '</aside>'+
   '<section class="studio-center">'+
    '<div class="panel studio-preview-tools">'+
     '<label>Экран<select class="field" id="studio-device">'+
       '<option value="100%">Текущая ширина</option>'+
       '<option value="320px">320 px</option><option value="375px">375 px</option>'+
       '<option value="430px">430 px</option><option value="540px">540 px</option>'+
     '</select></label>'+
     '<label class="studio-toggle"><input type="checkbox" id="studio-snap" checked> Направляющие</label>'+
     '<label class="studio-toggle"><input type="checkbox" id="studio-bgdrag"> Двигать фон</label>'+
     '<button type="button" class="secondary" data-studio-action="focus">Крупный баннер</button>'+
     '<button type="button" class="secondary" data-studio-action="preview">Без рамок</button>'+
    '</div>'+
    '<div class="studio-preview-frame"><div id="studio-preview"></div></div>'+
   '</section>'+
   '<aside class="panel studio-properties"><h4>Настройки</h4>'+
     '<div id="studio-inspector"></div></aside>'+
  '</section></div>';
 const root=content.querySelector('.crafter-event-studio');
 root.addEventListener('click',studioClick);
 root.addEventListener('change',studioChange);
 root.addEventListener('input',studioInputChanged);
 studioPaintList();studioPaintInspector();studioPaintPreview();
}
function studioPaintList(){
 const root=document.getElementById('studio-block-list');
 if(!root||!crafterStudio)return;
 root.innerHTML=crafterStudio.page.blocks.map((b,i)=>
  '<div class="studio-block-row'+(b.id===crafterStudio.selected?' active':'')+'">'+
   '<button type="button" data-studio-select="'+studioEsc(b.id)+'">'+
    '<small>'+(i+1)+'</small><b>'+STUDIO_LABELS[b.type]+'</b></button>'+
   '<button type="button" data-studio-move="'+studioEsc(b.id)+'" data-dir="-1" aria-label="Вверх">↑</button>'+
   '<button type="button" data-studio-move="'+studioEsc(b.id)+'" data-dir="1" aria-label="Вниз">↓</button>'+
  '</div>').join('');
}
function studioStyleInspector(){
 const s=crafterStudio.page.style;
 return '<h4>Глобальный стиль</h4><div class="studio-fields">'+
  studioColor('background','Фон страницы',s.background,'style')+
  studioColor('row_bg','Фон места',s.row_bg,'style')+
  studioColor('row_border','Контур места',s.row_border,'style')+
  studioColor('text_color','Текст игроков',s.text_color,'style')+
  studioColor('score_color','Цвет показателя',s.score_color,'style')+
  studioColor('heading_color','Цвет названия',s.heading_color,'style')+
  studioFont('font','Шрифт элементов',s.font,'style')+
  studioFont('heading_font','Шрифт заголовка',s.heading_font,'style')+
  studioInput('heading_size','Размер названия',s.heading_size,'style','number',16,48)+
  studioInput('name_size','Размер имён',s.name_size,'style','number',10,25)+
  studioInput('score_size','Размер результатов',s.score_size,'style','number',10,24)+
  studioInput('row_radius','Скругление строк',s.row_radius,'style','number',0,35)+
  studioInput('row_gap','Расстояние между местами',s.row_gap,'style','number',0,24)+
  studioInput('prize_size','Размер PNG/GIF приза',s.prize_size,'style','number',24,130)+
  studioInput('rank_count','Число отображаемых мест',s.rank_count,'style','number',1,100)+
  '<label class="studio-toggle"><input type="checkbox" data-studio-scope="style" data-studio-key="show_empty"'+
   (s.show_empty!==false?' checked':'')+'> Показывать свободные места</label></div>';
}
function studioBannerInspector(block){
 const b=block.banner;
 const layer=studioLayer();
 const layerList='<h4>Слои баннера</h4><div class="studio-layers">'+
  b.layers.map(l=>'<button type="button" data-studio-layer="'+studioEsc(l.id)+'" class="'+
    (l.id===crafterStudio.layer?'active':'')+'">'+studioEsc(l.type)+' · '+
    studioEsc((l.text||'GIF').slice(0,26))+'</button>').join('')+
  '</div><div class="studio-add-layer">'+
  [['title','Заголовок'],['text','Текст'],['timer','Таймер'],['gram','GRAM'],['image','PNG/GIF']].map(([kind,label])=>
   '<button type="button" class="secondary" data-studio-add-layer="'+kind+'">+ '+label+'</button>').join('')+'</div>';
 const layerFields=layer?'<h4>Выбранный слой</h4><div class="studio-fields">'+
  (layer.type==='image'?
   '<label>Изображение<input type="file" accept="image/png,image/gif,image/webp,image/jpeg" data-studio-upload="layer"></label>'+
    studioSelect('fit','Масштабирование',layer.fit,[['contain','Целиком'],['cover','Заполнение']],'layer'):
   layer.type==='gram'?'':studioInput('text','Надпись (добавьте {GRAM} для значка)',layer.text,'layer'))+
  studioFont('font','Шрифт',layer.font,'layer')+
  studioInput('font_size','Размер букв',layer.font_size,'layer','range',10,72,1)+
  studioInput('font_weight','Жирность',layer.font_weight,'layer','range',400,900,50)+
  studioInput('stroke_width','Усиление обводки',layer.stroke_width,'layer','range',0,3,.1)+
  studioColor('color','Цвет текста',layer.color,'layer')+
  studioColor('bg_color','Цвет плашки',layer.bg_color,'layer')+
  studioInput('bg_opacity','Прозрачность плашки',layer.bg_opacity,'layer','range',0,1,.05)+
  studioInput('radius','Скругление',layer.radius,'layer','number',0,90)+
  (layer.type==='timer'?studioSelect('format','Формат отсчёта',layer.format,
   [['hh:mm:ss','Часы:минуты:секунды'],['mm:ss','Минуты:секунды'],['days','Дни:часы:минуты']],'layer'):'')+
  studioInput('x','Слева, %',layer.x,'layer','number',0,100,.1)+
  studioInput('y','Сверху, %',layer.y,'layer','number',0,100,.1)+
  studioInput('w','Ширина, %',layer.w,'layer','number',3,100,.1)+
  studioInput('h','Высота, %',layer.h,'layer','number',3,100,.1)+
  studioSelect('align','Выравнивание',layer.align,
   [['left','Слева'],['center','Центр'],['right','Справа']],'layer')+
  '</div><button class="secondary" type="button" data-studio-action="remove-layer">Удалить слой</button>':'';
 return '<h4>Фон и размер баннера</h4><div class="studio-fields">'+
  studioInput('height','Высота, px',b.height,'banner','number',70,280)+
  studioInput('width_pct','Ширина, %',b.width_pct,'banner','number',50,100)+
  studioInput('radius','Скругление',b.radius,'banner','number',0,60)+
  studioSelect('background_mode','Тип фона',b.background_mode,
   [['solid','Цвет'],['gradient','Градиент'],['image','Изображение/GIF']],'banner')+
  studioColor('background_color','Основной цвет',b.background_color,'banner')+
  studioColor('background_second_color','Второй цвет',b.background_second_color,'banner')+
  '<label>Фоновая PNG/GIF<input type="file" data-studio-upload="background" accept="image/png,image/gif,image/webp,image/jpeg"></label>'+
  studioInput('background_tint','Затемнение изображения',b.background_tint,'banner','range',0,.9,.05)+
  studioInput('background_focus_x','Положение фона X',b.background_focus_x,'banner','number',0,100)+
  studioInput('background_focus_y','Положение фона Y',b.background_focus_y,'banner','number',0,100)+
  studioSelect('link_target','Переход по баннеру',b.link_target||'event', [['event','Текущий ивент'],['craft','Крафты'],['arena','Arena'],['none','Без перехода']],'banner')+'</div><div class="studio-inspector-actions"><button type="button" class="secondary" data-studio-action="link-craft">Связать с баннером над Крафтами</button><button type="button" class="secondary" data-studio-action="link-arena">Связать с баннером над Arena</button></div>'+layerList+layerFields;
}
function studioPaintInspector(){
 const root=document.getElementById('studio-inspector');if(!root||!crafterStudio)return;
 if(crafterStudio.selected==='global'){root.innerHTML=studioStyleInspector();return;}
 if(crafterStudio.selected==='prizes'){
    studioRenderPrizes(root);return;
 }
 const b=studioBlock();
 if(!b){root.innerHTML='<p class="sub">Выберите блок страницы.</p>';return;}
 root.innerHTML='<h4>'+STUDIO_LABELS[b.type]+'</h4>'+
   '<label class="studio-toggle"><input type="checkbox" data-studio-scope="block" data-studio-key="enabled"'+
    (b.enabled?' checked':'')+'> Показывать блок</label>'+
   '<div class="studio-fields">'+
    studioColor('background','Фон блока',b.background)+
    studioInput('padding','Внутренние отступы',b.padding,'block','number',0,50)+
    studioInput('radius','Скругление блока',b.radius,'block','number',0,45)+
    ((b.type==='text'||b.type==='timer')?
     '<label>Текст<textarea class="field" data-studio-scope="block" data-studio-key="text" rows="3">'+
       studioEsc(b.text)+'</textarea></label>'+
     studioFont('font','Шрифт',b.font)+
     studioInput('font_size','Размер букв',b.font_size,'block','number',10,58)+
     studioColor('color','Цвет текста',b.color):'')+
    (b.type==='leaderboard'?
     studioInput('rank_count','Показывать мест (1–100)',b.rank_count,'block','number',1,100):'')+
    (b.type==='spacer'?studioInput('height','Высота отступа',b.height,'block','number',8,160):'')+
   '</div>'+
   (b.type==='banner'?studioBannerInspector(b):'')+
   '<div class="studio-inspector-actions">'+
    '<button class="secondary" type="button" data-studio-action="clone">Дублировать</button>'+
    '<button class="secondary" type="button" data-studio-action="remove">Удалить блок</button></div>';
}
function studioPreviewHTML(block,index){
 const s=crafterStudio.page.style;
 const bg=studioEsc(block.background||s.background);
 const p=Number(block.padding||0),r=Number(block.radius||0);
 const outer='background:'+bg+';padding:'+p+'px;border-radius:'+r+'px;';
 if(!block.enabled)return '';
 const event=crafterStudio.event;
 if(block.type==='banner')return '<div class="studio-render-block" style="'+outer+'">'+
  '<div data-studio-banner="'+studioEsc(block.id)+'"></div></div>';
 if(block.type==='header')return '<div class="studio-render-block" style="'+outer+'">'+
  '<div class="crafter-event-header"><div class="crafter-event-name">'+
  '<h1>'+studioEsc(event.title)+'</h1>'+
  '<p>'+studioEsc(event.description||'')+'</p></div>'+
  '<div class="crafter-event-countdown"><small>До конца</small><b>'+studioRemaining(event.end_at)+'</b></div></div></div>';
 if(block.type==='timer')return '<div class="studio-render-block" style="'+outer+'">'+
  '<div class="crafter-event-countdown"><small>'+studioEsc(block.text||'До конца')+
  '</small><b>'+studioRemaining(event.end_at)+'</b></div></div>';
 if(block.type==='text')return '<div class="studio-render-block" style="'+outer+'"><p style="color:'+
  studioEsc(block.color)+';font-family:'+studioEsc(ICE_BANNER_FONTS[block.font]||'inherit')+
  ';font-size:'+Number(block.font_size)+'px;white-space:pre-wrap;">'+
  studioEsc(block.text)+'</p></div>';
 if(block.type==='divider')return '<div class="studio-render-block" style="'+outer+'"><hr></div>';
 if(block.type==='spacer')return '<div class="studio-render-block" style="height:'+Number(block.height)+'px;"></div>';
 if(block.type==='leaderboard'){
   const byRank=new Map((event.leaders||[]).map(row=>[row.rank,row]));
   const prizes=new Map((event.prizes||[]).map(row=>[row.place,row]));
   const n=Math.min(100,Math.max(1,Number(block.rank_count)||10));
   return '<div class="studio-render-block" style="'+outer+'"><div class="crafter-event-rank-list">'+
    Array.from({length:n},(_,i)=>{
     const rank=i+1,prize=prizes.get(rank);
     if(!crafterStudio.page.style.show_empty&&!byRank.has(rank)&&!prize)return '';
     const player=byRank.get(rank);
     return '<article class="crafter-event-leader"><span class="crafter-event-rank">'+rank+
      '</span><span class="crafter-event-avatar">'+(player?studioEsc(player.name?.[0]||'?'):'?')+
      '</span><div class="crafter-event-leader-info"><strong>'+
       studioEsc(player?.name||'Место свободно')+'</strong><span class="crafter-event-score">'+
       studioEsc(player?.score??'—')+'</span></div>'+
       studioPrizePreview(prize)+'</article>';
    }).join('')+'</div></div>';
 }
 return '';
}
function studioRemaining(unix){
 let n=Math.max(0,Number(unix)-Math.floor(Date.now()/1000));
 const pad=v=>String(v).padStart(2,'0');
 return Math.floor(n/86400)+'д '+pad(Math.floor(n/3600)%24)+':'+pad(Math.floor(n/60)%60)+':'+pad(n%60);
}
function studioPrizePreview(p){
 if(!p||p.type==='none')return '';
 let art='';
 if(p.type==='gram')art='<img src="/static/assets/gram.svg" alt="GRAM">';
 else if(p.image_url)art='<img src="'+studioEsc(p.image_url)+'" alt="Приз">';
 else if(p.type==='telegram'&&p.telegram_slug)
  art='<img src="https://nft.fragment.com/gift/'+studioEsc(p.telegram_slug.toLowerCase())+'.webp" alt="NFT">';
 else if(p.type==='collection'&&p.collection)
  art='<img src="/media/collection/'+encodeURIComponent(p.collection.replace(/[^a-z0-9]/gi,'').toLowerCase())+'" alt="Оригинальное PNG коллекции">';
 else if(p.type==='model'&&p.collection&&p.model)
  art='<img src="/media/trait/model?gift='+encodeURIComponent(p.collection)+'&name='+encodeURIComponent(p.model)+'" alt="Оригинальное PNG модели">';
 return '<span class="crafter-rank-prize"><span class="crafter-rank-prize-label">'+
 studioEsc(p.label||'Награда')+'</span><span class="crafter-rank-prize-art">'+art+'</span></span>';
}
function studioPaintPreview(){
 const root=document.getElementById('studio-preview');if(!root||!crafterStudio)return;
 const s=crafterStudio.page.style;
 const active=crafterStudio.selected;
 root.classList.toggle('studio-focus-banner',!!crafterStudio.focus&&!!studioBlock()?.banner&&!crafterStudio.previewMode);
 const prevStages=new Map();
 root.querySelectorAll('[data-studio-banner]').forEach(el=>{
    const stage=el.querySelector('.ice-banner-stage');
    if(stage)prevStages.set(el.dataset.studioBanner,{
        stage,signature:el.dataset.signature,editable:el.dataset.editable==='yes'});
 });
 const renderBlock=(b,i)=>
   '<div class="studio-preview-block'+(b.id===active?' studio-selected':'')+
   '" data-studio-preview-select="'+studioEsc(b.id)+'">'+studioPreviewHTML(b,i)+'</div>';
 const top=crafterStudio.page.blocks.map((b,i)=>b.type==='banner'?renderBlock(b,i):'').join('');
 const rest=crafterStudio.page.blocks.map((b,i)=>b.type==='banner'?'':renderBlock(b,i)).join('');
 root.innerHTML='<section class="crafter-events-page crafter-event-detail crafter-event-custom-layout">'+
  (top?'<div class="crafter-event-top-banners">'+top+'</div>':'')+rest+'</section>';
 const surface=root.querySelector('.crafter-event-custom-layout');
 if(!surface)return;
 const props={'--event-page-bg':s.background,'--event-row-bg':s.row_bg,
  '--event-row-border':s.row_border,'--event-text':s.text_color,
  '--event-score':s.score_color,'--event-heading':s.heading_color,
  '--event-font':ICE_BANNER_FONTS[s.font]||'inherit',
  '--event-heading-font':ICE_BANNER_FONTS[s.heading_font]||'inherit',
  '--event-heading-size':s.heading_size+'px','--event-name-size':s.name_size+'px',
  '--event-score-size':s.score_size+'px','--event-row-radius':s.row_radius+'px',
  '--event-row-gap':s.row_gap+'px','--event-prize-size':s.prize_size+'px'};
 for(const [key,value] of Object.entries(props))surface.style.setProperty(key,value);
 for(const block of crafterStudio.page.blocks.filter(b=>b.type==='banner'&&b.enabled)){
   const target=root.querySelector('[data-studio-banner="'+block.id+'"]');
   if(!target)continue;
   const isEditable=block.id===active&&!crafterStudio.previewMode;
   const banner={...block.banner,start_at:crafterStudio.event.start_at,
    end_at:crafterStudio.event.end_at,title:block.banner.title||crafterStudio.event.title};
   const signature=JSON.stringify(banner);
   const previous=prevStages.get(block.id);
   if(previous&&previous.signature===signature&&previous.editable===isEditable){
      target.append(previous.stage);
      previous.stage.querySelectorAll('.ice-banner-layer').forEach(node=>node.classList.toggle('is-selected',isEditable&&node.dataset.bannerLayer===crafterStudio.layer));
   }else{
      iceBannerMount(target,banner,{editable:isEditable,previewOnly:true,
       selected:crafterStudio.layer,serverTime:Date.now()/1000,
       snapEnabled:()=>crafterStudio.snap,
       backgroundDrag:()=>crafterStudio.backgroundDrag,
       onSelect(id){crafterStudio.layer=id;target.querySelectorAll('.ice-banner-layer').forEach(n=>n.classList.toggle('is-selected',n.dataset.bannerLayer===id));studioPaintInspector();},
       onMove(){studioDirty();studioPaintInspector();},
       onCanvasResize(){studioDirty();studioPaintInspector();},
       onBackgroundMove(){studioDirty();studioPaintInspector();},
       onTextChange(){studioDirty();studioPaintInspector();}
      });
   }
   target.dataset.signature=signature;
   target.dataset.editable=isEditable?'yes':'no';
 }
}

function studioRenderPrizes(root){
 const event=crafterStudio.event,rank=crafterStudio.rank;
 const prize=event.prizes[rank-1]||{place:rank,type:'none',label:''};
 const types=[['none','Без награды'],['gram','GRAM (значок)'],
  ['telegram','Telegram NFT (по ссылке)'],['collection','Обычный подарок — коллекция'],
  ['model','Конкретная модель'],['image','Своё PNG / GIF']];
 root.innerHTML='<h4>Призы для 100 мест</h4>'+
  '<div class="studio-award-tools"><button type="button" class="secondary" data-studio-action="catalog-picker">+ Подарок из каталога</button>'+
  '<button type="button" class="secondary" data-studio-action="distribute">Выкупить и выдать победителям</button></div>'+
  '<p class="sub">Выберите место и укажите награду. Изображение загружается отдельно; для Telegram NFT достаточно ссылки.</p>'+
  '<div class="studio-fields">'+
  studioInput('rank','Призовое место (1–100)',rank,'prize','number',1,100)+
  studioSelect('type','Тип награды',prize.type||'none',types,'prize')+
  studioInput('label','Надпись / количество',prize.label||'','prize')+
  ((prize.type==='telegram')?studioInput('telegram_url','https://t.me/nft/…',
   prize.telegram_url||'','prize'):'')+
  (['collection','model'].includes(prize.type)?studioInput('collection','Коллекция',
   prize.collection||'','prize'):'')+
  ((prize.type==='model')?studioInput('model','Модель',prize.model||'','prize'):'')+
  ((prize.type==='image')?'<label>PNG / WebP / GIF<input type="file" '+
   'accept="image/png,image/jpeg,image/webp,image/gif" data-studio-upload="prize"></label>':'')+
  '</div>'+
  '<div class="studio-prize-preview"><b>Предпросмотр награды</b>'+
   studioPrizePreview(prize)+'</div>'+
  '<div class="studio-prize-jumps">'+
  Array.from({length:100},(_,i)=>{
   const r=i+1;
   if(r>100)return '';
   const p=event.prizes[i];
   return '<button type="button" data-studio-rank="'+r+'" class="'+(r===rank?'active':'')+'">'+
    r+(p&&p.type!=='none'?' 🎁':'')+'</button>';
  }).join('')+'</div>'+
  '<button type="button" class="primary" data-studio-action="save-prizes">Сохранить награды</button>';
}
function studioPrize(rank){
 const list=crafterStudio.event.prizes;
 while(list.length<rank)list.push({place:list.length+1,label:'',type:'none',
  telegram_url:'',telegram_slug:'',collection:'',model:'',image_url:null});
 return list[rank-1];
}
function studioConvertValue(target){
 if(target.type==='checkbox')return target.checked;
 const val=target.value;
 if(target.type==='number'||target.type==='range'){
  const n=Number(val);
  return Number.isFinite(n)?n:0;
 }
 return val;
}
function studioApplyLive(scope,key){
 if(!['banner','layer'].includes(scope))return false;
 const block=studioBlock();if(!block?.banner)return false;
 const holder=document.querySelector('[data-studio-banner="'+block.id+'"]');
 const stage=holder?.querySelector('.ice-banner-stage');
 if(!stage)return false;
 const banner=block.banner;
 if(scope==='banner'){
   if(['background_color','background_second_color','background_mode',
       'background_asset','background_tint','background_fit',
       'background_focus_x','background_focus_y'].includes(key))
       iceBannerApplyBackground(stage,banner);
   else if(key==='height')stage.style.height=Math.max(70,Number(banner.height))+'px';
   else if(key==='width_pct')stage.style.width=Math.max(50,Number(banner.width_pct))+'%';
   else if(key==='radius')stage.style.borderRadius=Math.max(0,Number(banner.radius))+'px';
   else return false;
 }else{
   const layer=studioLayer();
   if(!layer)return false;
   const el=[...stage.querySelectorAll('.ice-banner-layer')].find(node=>node.dataset.bannerLayer===layer.id);
   if(!el)return false;
   if(['x','y','w','h'].includes(key))
     el.style[{x:'left',y:'top',w:'width',h:'height'}[key]]=Number(layer[key])+'%';
   else if(key==='font')el.style.fontFamily=ICE_BANNER_FONTS[layer.font]||ICE_BANNER_FONTS.system;
   else if(key==='font_size')el.style.fontSize='clamp(9px,'+(Number(layer.font_size)/4)+'cqw,'+Number(layer.font_size)+'px)';
   else if(key==='font_weight')el.style.fontWeight=String(layer.font_weight);
   else if(key==='color'){
     el.style.color=layer.color;
     el.style.webkitTextStroke=Number(layer.stroke_width||0)+'px '+layer.color;
   }else if(key==='stroke_width')el.style.webkitTextStroke=Number(layer.stroke_width||0)+'px '+layer.color;
   else if(key==='bg_color'||key==='bg_opacity'){
     const opacity=Math.max(0,Math.min(1,Number(layer.bg_opacity)||0));
     const alpha=Math.round(opacity*255).toString(16).padStart(2,'0');
     el.style.background=opacity?layer.bg_color+alpha:'transparent';
   }else if(key==='radius')el.style.borderRadius=Number(layer.radius)+'px';
   else if(key==='align'){
     el.style.textAlign=layer.align;
     el.style.justifyContent={left:'flex-start',center:'center',right:'flex-end'}[layer.align]||'center';
   }else if(key==='fit'){
     const img=el.querySelector('img');if(img)img.style.objectFit=layer.fit;
   }else if(key==='format'){el.dataset.format=layer.format;iceBannerUpdateClocks();}
   else if(key==='text'&&layer.type!=='timer'){
     el.querySelector('.ice-banner-inline')?.remove();
     iceBannerRichText(el,layer.text||'');
   }else return false;
 }
 const signature=JSON.stringify({...banner,start_at:crafterStudio.event.start_at,
   end_at:crafterStudio.event.end_at,title:banner.title||crafterStudio.event.title});
 holder.dataset.signature=signature;
 return true;
}
function studioInputChanged(event){
 const t=event.target;
 const scope=t.dataset.studioScope,key=t.dataset.studioKey;
 if(!scope||!key||!crafterStudio)return;
 if(scope==='prize'&&key==='rank'){
    const rank=Math.max(1,Math.min(100,Number(t.value)||1));
    crafterStudio.rank=rank;
    studioPrize(rank);
    studioPaintInspector();
    return;
 }
 let target;
 if(scope==='style')target=crafterStudio.page.style;
 else if(scope==='block')target=studioBlock();
 else if(scope==='banner')target=studioBlock()?.banner;
 else if(scope==='layer')target=studioLayer();
 else if(scope==='prize')target=studioPrize(crafterStudio.rank);
 if(!target)return;
 let value=studioConvertValue(t);
 if(scope==='prize'&&key==='type'){
    target.type=value;
    if(value!=='image')crafterStudio.prizeFiles.delete(crafterStudio.rank);
 }
 target[key]=value;
 if(scope==='prize'&&key==='telegram_url'){
    const match=String(value).match(/^https:\/\/(?:t\.me|telegram\.me)\/nft\/([A-Za-z][A-Za-z0-9]{1,70}-[0-9]{1,10})\/?$/i);
    if(match){target.type='telegram';target.telegram_slug=match[1];}
 }
 if(scope==='style'&&key==='rank_count'){
    const block=studioRankBlock();if(block)block.rank_count=Math.min(100,Number(value)||10);
 }
 studioDirty();
 if(!studioApplyLive(scope,key))studioPaintPreview();
}
function studioChange(event){
 const t=event.target;
 if(t.id==='studio-device'){
    const node=document.getElementById('studio-preview');
    if(node)node.style.width=t.value;
    return;
 }
 if(t.id==='studio-snap'){crafterStudio.snap=t.checked;return;}
 if(t.id==='studio-bgdrag'){crafterStudio.backgroundDrag=t.checked;return;}
 if(t.dataset.studioUpload){
    const file=t.files?.[0];
    if(file)studioUpload(file,t.dataset.studioUpload);
    return;
 }
 if(t.dataset.studioScope&&t.dataset.studioKey){
    studioInputChanged(event);
    if(t.dataset.studioScope==='prize'&&['type','telegram_url'].includes(t.dataset.studioKey))studioPaintInspector();
 }
}
function studioClick(event){
 const button=event.target.closest('[data-studio-action],[data-studio-select],'+
  '[data-studio-move],[data-studio-layer],[data-studio-add-layer],[data-studio-rank]');
 if(!button)return;
 const studio=crafterStudio;
 if(button.dataset.studioSelect){
    studio.selected=button.dataset.studioSelect;
    studio.layer=studioBlock()?.banner?.layers?.[0]?.id||'';
    studioPaintList();studioPaintInspector();studioPaintPreview();return;
 }
 if(button.dataset.studioLayer){
    studio.layer=button.dataset.studioLayer;
    studioPaintInspector();studioPaintPreview();return;
 }
 if(button.dataset.studioRank){
    studio.rank=Number(button.dataset.studioRank);
    studioPaintInspector();return;
 }
 if(button.dataset.studioMove){
    const blocks=studio.page.blocks;
    const index=blocks.findIndex(b=>b.id===button.dataset.studioMove);
    const destination=index+Number(button.dataset.dir);
    if(index>=0&&destination>=0&&destination<blocks.length){
        [blocks[index],blocks[destination]]=[blocks[destination],blocks[index]];
        studioDirty();studioPaintList();studioPaintPreview();
    }
    return;
 }
 if(button.dataset.studioAddLayer){
    const block=studioBlock();
    if(!block?.banner)return;
    if(block.banner.layers.length>=20)return toast('До 20 слоёв в одном баннере');
    const type=button.dataset.studioAddLayer;
    const layer=studioFreshLayer(type,type==='title'?'Заголовок':type==='text'?'Текст':'');
    layer.z=Math.min(99,1+Math.max(0,...block.banner.layers.map(l=>Number(l.z))));
    block.banner.layers.push(layer);studio.layer=layer.id;
    studioDirty();studioPaintInspector();studioPaintPreview();return;
 }
 const action=button.dataset.studioAction;
 if(action==='back'){
    if(studio.dirty&&!confirm('Есть несохранённые изменения. Вернуться?'))return;
    renderAdminEvents();return;
 }
 if(action==='save'){studioSavePage();return;}
 if(action==='focus'){studio.focus=!studio.focus;studioPaintPreview();return;}
 if(action==='add-banner'||action==='add-gif'){
   let block=studioBlock();
   if(action==='add-banner'||!block?.banner){
     if(studio.page.blocks.filter(b=>b.type==='banner').length>=4)return toast('Максимум 4 баннера');
     block=studioFreshBlock('banner');
     studio.page.blocks.unshift(block);studio.selected=block.id;studio.layer=block.banner.layers[0]?.id||'';
   }
   if(action==='add-gif'){
     if(block.banner.layers.length>=20)return toast('Максимум 20 слоёв');
     const layer=studioFreshLayer('image');layer.x=53;layer.y=10;layer.w=42;layer.h=80;
     layer.z=Math.min(99,2+Math.max(0,...block.banner.layers.map(l=>Number(l.z))));
     block.banner.layers.push(layer);studio.layer=layer.id;
   }
   studioDirty();studioPaintList();studioPaintInspector();studioPaintPreview();
   if(action==='add-gif')document.getElementById('studio-quick-gif')?.click();
   return;
 }
 if(action==='link-craft'||action==='link-arena'){studioLinkGlobalBanner(action==='link-craft'?'craft':'arena');return;}
 if(action==='prizes'){studio.selected='prizes';studioPaintList();studioPaintInspector();return;}
 if(action==='style'){studio.selected='global';studioPaintList();studioPaintInspector();return;}
 if(action==='preview'){
    studio.previewMode=!studio.previewMode;
    button.textContent=studio.previewMode?'Вернуться в редактор':'Без рамок';
    studioPaintPreview();return;
 }
 if(action==='add'){
    if(studio.page.blocks.length>=24)return toast('Максимум 24 блока');
    const kind=document.getElementById('studio-add-kind')?.value||'text';
    if(kind==='banner'&&studio.page.blocks.filter(b=>b.type==='banner').length>=4)return toast('До 4 баннеров');
    const block=studioFreshBlock(kind);
    studio.page.blocks.push(block);studio.selected=block.id;
    studio.layer=block.banner?.layers?.[0]?.id||'';
    studioDirty();studioPaintList();studioPaintInspector();studioPaintPreview();
    return;
 }
 if(action==='remove'){
    const index=studio.page.blocks.findIndex(b=>b.id===studio.selected);
    if(index<0)return;
    studio.page.blocks.splice(index,1);
    studio.selected=studio.page.blocks[Math.max(0,index-1)]?.id||'global';
    studio.layer=studioBlock()?.banner?.layers?.[0]?.id||'';
    studioDirty();studioPaintList();studioPaintInspector();studioPaintPreview();
    return;
 }
 if(action==='clone'){
    if(studio.page.blocks.length>=24)return toast('Максимум 24 блока');
    const block=studioBlock();
    if(!block)return;
    if(block.type==='banner'&&studio.page.blocks.filter(b=>b.type==='banner').length>=4)return toast('До 4 баннеров');
    const copy=structuredClone(block);
    copy.id='b'+crypto.randomUUID().replaceAll('-','').slice(0,26);
    if(copy.banner)copy.banner.layers.forEach(l=>l.id='layer'+crypto.randomUUID().replaceAll('-','').slice(0,19));
    const index=studio.page.blocks.indexOf(block);
    studio.page.blocks.splice(index+1,0,copy);
    studio.selected=copy.id;studio.layer=copy.banner?.layers?.[0]?.id||'';
    studioDirty();studioPaintList();studioPaintInspector();studioPaintPreview();
    return;
 }
 if(action==='remove-layer'){
    const block=studioBlock();
    block.banner.layers=block.banner.layers.filter(l=>l.id!==studio.layer);
    studio.layer=block.banner.layers[0]?.id||'';
    studioDirty();studioPaintInspector();studioPaintPreview();return;
 }
 if(action==='save-prizes'){studioSavePrizes();return;}
 if(action==='catalog-picker'){studioOpenPrizeCatalog();return;}
 if(action==='distribute'){studioDistributePrizes();return;}
}
async function studioUpload(file,where){
 if(file.size>8*1024*1024)return toast('Изображение/GIF до 8 МБ');
 if(where==='prize'){
    crafterStudio.prizeFiles.set(crafterStudio.rank,file);
    studioSetStatus('PNG/GIF выбран; нажмите «Сохранить награды»');
    return;
 }
 const block=studioBlock();
 const layer=studioLayer();
 if(!block?.banner||(where==='layer'&&!layer))return toast('Сначала выберите слой PNG/GIF');
 const form=new FormData();form.append('file',file);
 studioSetStatus('Загружаем '+file.name+'…');
 try{
    const data=await api('admin/arena/banner/asset',form);
    if(where==='background') {
       block.banner.background_asset=data.url;
       block.banner.background_mode='image';
    }else if(where==='layer'&&layer){
       layer.asset=data.url;
    }
    studioDirty();studioPaintInspector();studioPaintPreview();
 }catch(error){studioSetStatus(error.message);toast(error.message);}
 finally{const quick=document.getElementById('studio-quick-gif');if(quick)quick.value='';}
}
async function studioLinkGlobalBanner(kind){
 const studio=crafterStudio,block=studioBlock();
 if(!block?.banner)return toast('Выберите баннер');
 if(!studio.event?.enabled)return toast('Сначала опубликуйте ивент');
 const b=structuredClone(block.banner);
 const payload={...b,enabled:true,event_id:studio.event.id,rooms:'all',hide_after_end:true,
   title:b.title||studio.event.title,start_at:studio.event.start_at,end_at:studio.event.end_at};
 try{
   await api('admin/'+kind+'/banner',payload);
   studioSetStatus('Баннер опубликован над '+(kind==='craft'?'Крафтами':'Arena'));
   toast('Баннер связан с '+(kind==='craft'?'Крафтами':'Arena'));
 }catch(e){studioSetStatus(e.message);toast(e.message);}
}
async function studioSavePage(){
 const id=crafterStudio.event.id;
 const button=document.querySelector('[data-studio-action="save"]');
 if(button)button.disabled=true;
 try{
   const result=await api('admin/events/'+id+'/page',crafterStudio.page);
   crafterStudio.page=result.page;
   // The primary Save button commits layout AND prizes together.
   if(!await studioSavePrizes(true))throw new Error('Макет сохранён, но награды не удалось сохранить');
   crafterStudio.dirty=false;
   studioSetStatus('Макет, баннеры и все награды сохранены');
   toast('Страница события обновлена');
   studioPaintList();studioPaintInspector();studioPaintPreview();
 }catch(e){studioSetStatus(e.message);toast(e.message);}
 finally{if(button)button.disabled=false;}
}
async function studioSavePrizes(silent=false){
 const studio=crafterStudio,ev=studio.event;
 const body=new FormData();
 body.set('title',ev.title);body.set('description',ev.description||'');
 body.set('metric',ev.metric);body.set('accent',ev.accent);
 body.set('start_at',String(ev.start_at));body.set('end_at',String(ev.end_at));
 body.set('sort_order',String(ev.sort_order||0));
 if(ev.enabled)body.set('enabled','1');
 if(ev.show_leaderboard)body.set('show_leaderboard','1');
 const prizes=ev.prizes.map(p=>{
    const url=String(p.telegram_url||'').trim();
    const viaTelegram=/^https:\/\/(?:t\.me|telegram\.me)\/nft\//i.test(url);
    return {type:viaTelegram?'telegram':p.type||'none',label:p.label||'',
      telegram_url:url,collection:p.collection||'',model:p.model||''};
 });
 body.set('prizes_json',JSON.stringify(prizes));
 for(const [rank,file] of studio.prizeFiles)body.append('prize_image_'+rank,file);
 studioSetStatus('Сохраняем награды…');
 try{
    await api('admin/events/'+ev.id,body);
    const result=await api('admin/events');
    studio.event=result.events.find(x=>x.id===ev.id)||ev;
    studio.prizeFiles.clear();
    studioSetStatus('Призы сохранены: '+prizes.length+' мест');
    if(!silent)toast('Награды ивента сохранены');
    studioPaintInspector();studioPaintPreview();
    return true;
 }catch(e){studioSetStatus(e.message);if(!silent)toast(e.message);return false;}
}

/* Plain collection/model artwork chooser, not the upgraded/full NFT rendering. */
async function studioOpenPrizeCatalog(){
 const event=crafterStudio,rank=event?.rank;
 if(!event||!rank)return;
 sheet('Обычный подарок из каталога',
  '<div class="studio-prize-picker"><p>Выберите коллекцию или конкретную модель. В лидерборде отображается исходный PNG. Для выдачи выкупается реальный доступный лот Craft Market.</p>'+
  '<input type="search" class="field" placeholder="Поиск коллекции" aria-label="Поиск коллекции" data-prize-search>'+
  '<div class="studio-prize-choices" data-prize-choices><p class="sub">Загрузка каталога…</p></div>'+
  '<button type="button" class="secondary" data-prize-back hidden>← Все коллекции</button></div>');
 const root=document.querySelector('#sheet-body .studio-prize-picker');
 const target=root.querySelector('[data-prize-choices]');
 const query=root.querySelector('[data-prize-search]');
 const back=root.querySelector('[data-prize-back]');
 let collections=[];
 try{
   const result=await api('catalog');
   collections=(result.collections||[]).filter(c=>c.name&&c.id);
 }catch(error){target.textContent='Каталог недоступен: '+error.message;return;}
 if(!root.isConnected)return;
 const originalArt=c=>'/media/collection/'+String(c.name).replace(/[^a-z0-9]/gi,'').toLowerCase();
 const choose=(c,model='')=>{
   const prize=studioPrize(rank);
   prize.type=model?'model':'collection';
   prize.collection=c.name;prize.model=model;prize.telegram_url='';prize.telegram_slug='';
   prize.label=(model?c.name+' · '+model:c.name).slice(0,120);
   event.prizeFiles.delete(rank);
   studioDirty();studioPaintInspector();studioPaintPreview();closeSheet();
   studioSetStatus('PNG приза выбран. Сохраните награды.');
 };
 const renderCollections=()=>{
   back.hidden=true;query.hidden=false;
   const term=query.value.trim().toLowerCase();
   const found=collections.filter(c=>c.name.toLowerCase().includes(term)).slice(0,80);
   target.innerHTML=found.map((c,i)=>
    '<article class="studio-prize-choice" data-prize-catalog="'+i+'">'+
    '<img loading="lazy" src="'+esc(originalArt(c))+'" alt="">'+
    '<strong>'+esc(c.name)+'</strong>'+
    '<div><button type="button" class="secondary" data-prize-collection="'+i+'">Коллекция</button>'+
    '<button type="button" class="secondary" data-prize-models="'+i+'">Модели</button></div></article>'
   ).join('')||'<p class="sub">Коллекции не найдены</p>';
   target.querySelectorAll('[data-prize-collection]').forEach(button=>{
      button.onclick=()=>choose(found[Number(button.dataset.prizeCollection)]);
   });
   target.querySelectorAll('[data-prize-models]').forEach(button=>{
      button.onclick=()=>renderModels(found[Number(button.dataset.prizeModels)]);
   });
 };
 const renderModels=async c=>{
   back.hidden=false;query.hidden=true;
   target.innerHTML='<p class="sub">Загружаем оригинальные PNG моделей…</p>';
   let models=[];
   try{
     const result=await api('collections/'+encodeURIComponent(c.short_name||c.id)+'/models');
     models=(result.models||[]).filter(m=>m.name).slice(0,150);
   }catch(error){target.textContent='Не удалось загрузить модели: '+error.message;return;}
   if(!root.isConnected)return;
   target.innerHTML=models.map((m,i)=>
     '<button type="button" class="studio-prize-model" data-prize-model="'+i+'">'+
     '<img loading="lazy" src="/media/trait/model?gift='+encodeURIComponent(c.name)+
     '&name='+encodeURIComponent(m.name)+'" alt="">'+
     '<span>'+esc(m.name)+'</span></button>'
   ).join('')||'<p class="sub">Модели не найдены</p>';
   target.querySelectorAll('[data-prize-model]').forEach(button=>{
     button.onclick=()=>choose(c,models[Number(button.dataset.prizeModel)].name);
   });
 };
 query.oninput=renderCollections;
 back.onclick=renderCollections;
 renderCollections();
}
async function studioDistributePrizes(){
 const event=crafterStudio?.event;
 if(!event?.id)return;
 if(event.status!=='finished')return toast('Выдача доступна только после завершения ивента');
 try{
   const result=await api('admin/events/'+event.id+'/awards/preview');
   const pending=result.awards.filter(a=>a.status==='ready');
   const missing=result.awards.filter(a=>a.status==='unavailable');
   const paid=result.awards.filter(a=>a.status==='issued');
   const canPay=pending.length&&!missing.length&&Number(result.balance)>=Number(result.total);
   sheet('Выдача призов победителям',
     '<div class="studio-award-checkout"><p>Покупка выполняется из Craft Market по минимальной актуальной цене. Это реальный перевод существующего подарка в инвентарь победителя, без создания копий NFT.</p>'+
     '<div class="studio-award-summary"><span>Стоимость: <b>'+esc(result.total)+' GRAM</b></span>'+
     '<span>Баланс: <b>'+esc(result.balance)+' GRAM</b></span></div>'+
     result.awards.map(a=>'<div class="studio-award-row"><b>Место №'+a.place+'</b><span>'+
        esc(a.collection||a.gift_name||'Выдано')+(a.model?' · '+esc(a.model):'')+
        '</span><small>'+esc(a.status==='issued'?'Уже выдан':a.status==='unavailable'?'Нет доступного лота':a.price+' GRAM')+'</small></div>').join('')+
     (missing.length?'<p class="studio-award-warning">Для некоторых призов нет лотов. Выдача остановлена, пока они не появятся.</p>':'')+
     '<button class="primary" data-award-confirm '+(canPay?'':'disabled')+'>Выкупить и выдать '+pending.length+' призов</button>'+
     '<p class="sub">Внешние покупки через Portals здесь не имитируются. Для этой операции используются только лоты Craft Market.</p></div>');
   const button=document.querySelector('[data-award-confirm]');
   if(!button||!canPay)return;
   button.onclick=async()=>{
     if(!confirm('Подтвердить выкуп призов на '+result.total+' GRAM со своего баланса и выдачу победителям?'))return;
     button.disabled=true;
     try{
       const quotes=pending.map(a=>({place:a.place,recipient:a.recipient,lot_id:a.lot_id,price:a.price}));
       const response=await api('admin/events/'+event.id+'/awards/distribute',
         {quotes,max_total_gram:result.total});
       closeSheet();toast('Выдано призов: '+response.issued+' · '+response.total+' GRAM');
     }catch(error){button.disabled=false;toast(error.message);}
   };
 }catch(error){toast(error.message);}
}
