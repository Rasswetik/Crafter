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
      background_tint:0,background_focus_x:50,background_focus_y:50,
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
  snap:true,backgroundDrag:false,dirty:false,prizeFiles:new Map(),rank:1};
 content.innerHTML='<div class="crafter-event-studio">'+
  '<section class="panel studio-toolbar">'+
  '<button type="button" class="secondary" data-studio-action="back">Назад к событиям</button>'+
  '<div class="studio-heading"><h3>Конструктор · '+studioEsc(event.title)+'</h3>'+
  '<p class="sub">Блоки можно менять местами; каждый баннер имеет собственные слои и GIF.</p></div>'+
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
  '</div>'+layerList+layerFields;
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
  art='<img src="https://fragment.com/file/gifts/'+encodeURIComponent(p.collection.replace(/[^a-z0-9]/gi,'').toLowerCase())+'/thumb.webp" alt="Коллекция">';
 else if(p.type==='model'&&p.collection&&p.model)
  art='<img src="https://api.changes.tg/model/'+encodeURIComponent(p.collection)+'/'+encodeURIComponent(p.model)+'.png?size=128" alt="Модель">';
 return '<span class="crafter-rank-prize"><span class="crafter-rank-prize-label">'+
 studioEsc(p.label||'Награда')+'</span><span class="crafter-rank-prize-art">'+art+'</span></span>';
}
function studioPaintPreview(){
 const root=document.getElementById('studio-preview');if(!root||!crafterStudio)return;
 const s=crafterStudio.page.style;
 const active=crafterStudio.selected;
 const prevStages=new Map();
 root.querySelectorAll('[data-studio-banner]').forEach(el=>{
    const stage=el.querySelector('.ice-banner-stage');
    if(stage)prevStages.set(el.dataset.studioBanner,{
        stage,signature:el.dataset.signature,editable:el.dataset.editable==='yes'});
 });
 root.innerHTML='<section class="crafter-events-page crafter-event-detail crafter-event-custom-layout">'+
  crafterStudio.page.blocks.map((b,i)=>
   '<div class="studio-preview-block'+(b.id===active?' studio-selected':'')+
   '" data-studio-preview-select="'+studioEsc(b.id)+'">'+studioPreviewHTML(b,i)+'</div>').join('')+
  '</section>';
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
   }else{
      iceBannerMount(target,banner,{editable:isEditable,previewOnly:true,
       selected:crafterStudio.layer,serverTime:Date.now()/1000,
       snapEnabled:()=>crafterStudio.snap,
       backgroundDrag:()=>crafterStudio.backgroundDrag,
       onSelect(id){crafterStudio.layer=id;studioPaintInspector();},
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
