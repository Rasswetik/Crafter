/* Visual editor for the Ice Arena event banner. */
let iceEdit={banner:null,events:[],selected:'',busy:false,timerOpacity:new Map()};

function iceLocal(ts){
  const d=new Date(Number(ts)*1000);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function iceSelected(){return iceEdit.banner.layers.find(l=>l.id===iceEdit.selected);}
function iceDirty(){
  const p=document.querySelector('#ice-editor-status');
  if(p)p.textContent='Есть несохранённые изменения';
}
function iceFields(label,field,value,type='number',attributes=''){
  return '<label>'+label+'<input class="field" data-ice-layer="'+field+'" type="'+type+
    '" value="'+esc(String(value??''))+'" '+attributes+'></label>';
}
function iceSelect(label,field,value,choices){
  return '<label>'+label+'<select class="field" data-ice-layer="'+field+'">'+
    choices.map(([id,name])=>'<option value="'+esc(id)+'"'+(String(id)===String(value)?' selected':'')+
    '>'+esc(name)+'</option>').join('')+'</select></label>';
}
function iceList(){
  const root=document.querySelector('#ice-editor-list');if(!root)return;
  root.innerHTML=[...iceEdit.banner.layers].sort((a,b)=>b.z-a.z).map(l=>
    '<button type="button" data-ice-pick="'+esc(l.id)+'" class="ice-list-item '+
    (l.id===iceEdit.selected?'active':'')+'"><span>'+esc({
      title:'Заголовок',text:'Текст',timer:'Таймер',image:'PNG / GIF',gram:'◇ GRAM'
    }[l.type])+'</span><strong>'+esc(l.text||'Изображение')+'</strong><small>z'+l.z+
    '</small></button>').join('')||'<p class="sub">Слои пока не добавлены.</p>';
}

function iceSlider(label,field,value,min,max,step){
  return '<label class="ice-editor-slider">'+label+
    '<span class="ice-editor-slider-row"><input type="range" data-ice-layer="'+field+
    '" min="'+min+'" max="'+max+'" step="'+step+'" value="'+Number(value||0)+'">'+
    '<output data-ice-readout="'+field+'">'+Number(value||0)+'</output></span></label>';
}
function iceColor(label,field,value){
  return '<label class="ice-editor-color-field">'+label+
    '<span class="ice-editor-color-row"><input type="color" data-ice-layer="'+field+
    '" value="'+esc(value||'#ffffff')+'">'+
    '<input class="field" type="text" maxlength="7" spellcheck="false" data-ice-color-hex="'+
    field+'" value="'+esc(value||'#ffffff')+'" aria-label="'+label+'"></span></label>';
}
function iceProperties(){
  const root=document.querySelector('#ice-editor-properties'),l=iceSelected();
  if(!root)return;
  if(!l){root.innerHTML='<p class="sub">Выберите объект на холсте или добавьте новый.</p>';return;}
  const isText=['title','text','timer'].includes(l.type);
  const fonts=[['system','Системный'],['display','SF Pro Display'],['rounded','Скруглённый'],
    ['heavy','Impact · массивный'],['bold','Arial Black · жирный'],
    ['geometric','Trebuchet · геометрический'],['clean','Verdana · чёткий'],
    ['classic','Tahoma · компактный'],['condensed','Узкий'],
    ['serif','Georgia · с засечками'],['mono','Моноширинный'],
    ['futuristic','Техно']];
  root.innerHTML='<h4>Параметры слоя</h4>'+
    '<p class="ice-editor-hint">Тяните за синие углы элемента прямо на холсте. Двойной клик по надписи — редактирование текста на баннере.</p>'+
    '<div class="ice-editor-properties-grid">'+
    (l.type==='image'?'<label>PNG / WebP / GIF<input data-ice-file="layer" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>'+
      (l.asset?'<div class="ice-asset-chip"><img src="'+esc(l.asset)+'" alt=""><button type="button" data-ice-clear="layer">Очистить</button></div>':'')+
      iceSelect('Масштабирование','fit',l.fit,[['contain','Целиком'],['cover','Заполнить']]):'')+
    (l.type==='gram'?'<p class="ice-editor-gram-help">Значок GRAM можно растягивать и перемещать как отдельный объект.</p>':'')+
    (isText?'<div class="ice-editor-text-input">'+
      iceFields(l.type==='timer'?'Надпись перед часами':'Текст баннера','text',l.text,'text','maxlength="140"')+
      '<button type="button" class="secondary" data-ice-insert="gram" title="Вставить значок GRAM рядом с текстом">+ Значок GRAM ◇</button>'+
      '<small>Символ {GRAM} заменяется официальной иконкой GRAM в баннере.</small></div>'+
      iceSelect('Шрифт','font',l.font,fonts)+
      iceSlider('Размер букв, px','font_size',l.font_size,10,72,1)+
      iceSlider('Насыщенность шрифта','font_weight',l.font_weight,400,900,50)+
      iceSlider('Дополнительная толщина букв, px','stroke_width',l.stroke_width??0,0,3,.1)+
      (l.type==='timer'?
        '<label class="ice-editor-check ice-timer-bg-toggle"><input type="checkbox" data-ice-toggle-bg '+
        (Number(l.bg_opacity)>0?'checked':'')+'> Фон часов</label>'+
        iceSelect('Формат отсчёта','format',l.format,[
          ['hh:mm:ss','00:00:59'],['mm:ss','00:59'],['days','1д 00:00:59']]):'')+
      iceSelect('Выравнивание','align',l.align,[['left','Слева'],['center','По центру'],['right','Справа']])+
      iceColor(l.type==='timer'?'Цвет цифр таймера':'Цвет надписи','color',l.color):'')+
    iceColor('Цвет подложки','bg_color',l.bg_color)+
    iceSlider('Прозрачность подложки','bg_opacity',l.bg_opacity,0,1,.05)+
    iceFields('Скругление, px','radius',l.radius,'number','min="0" max="90"')+
    iceFields('X, %','x',l.x,'number','min="0" max="100" step=".1"')+
    iceFields('Y, %','y',l.y,'number','min="0" max="100" step=".1"')+
    iceFields('Ширина элемента, %','w',l.w,'number','min="3" max="100" step=".1"')+
    iceFields('Высота элемента, %','h',l.h,'number','min="3" max="100" step=".1"')+
    iceFields('Порядок слоя','z',l.z,'number','min="0" max="99"')+
    '</div><div class="ice-editor-buttons">'+
    '<button type="button" class="secondary" data-ice-action="up">Выше</button>'+
    '<button type="button" class="secondary" data-ice-action="down">Ниже</button>'+
    '<button type="button" class="secondary" data-ice-action="copy">Копировать</button>'+
    '<button type="button" class="secondary" data-ice-action="remove">Удалить</button></div>';
}
function icePaint(){
  const root=document.querySelector('#ice-banner-preview');if(!root)return;
  iceBannerMount(root,iceEdit.banner,{
    editable:true,selected:iceEdit.selected,serverTime:Date.now()/1000,
    onSelect(id){
      iceEdit.selected=id;
      root.querySelectorAll('.ice-banner-layer').forEach(node=>
        node.classList.toggle('is-selected',node.dataset.bannerLayer===id));
      iceList();iceProperties();
    },
    onMove(id){
      iceEdit.selected=id;iceDirty();iceList();iceProperties();
    },
    onTextChange(id){
      iceEdit.selected=id;iceDirty();iceList();iceProperties();
    },
    onCanvasResize(){
      for(const field of ['height','width_pct']){
        const input=document.querySelector('[data-ice-global="'+field+'"]');
        if(input)input.value=iceEdit.banner[field];
      }
      iceDirty();
    }
  });
}
async function renderIceBannerAdmin(content=document.querySelector('#admin-content')){
  const [data,ev]=await Promise.all([api('admin/arena/banner'),api('admin/events')]);
  if(!content?.isConnected)return;
  iceEdit={banner:data.banner,events:ev.events,selected:data.banner.layers[0]?.id||'',busy:false,
    timerOpacity:new Map(data.banner.layers.filter(l=>l.type==='timer'&&Number(l.bg_opacity)>0)
      .map(l=>[l.id,Number(l.bg_opacity)]))};
  const b=iceEdit.banner;
  content.innerHTML=`<div class="ice-editor">
    <section class="panel">
      <h3>Ice Arena · Конструктор баннера</h3>
      <p class="sub">Здесь настраивается событие над игровой ареной, под инфо и балансом. Перетаскивайте элементы на живом предпросмотре: положение, размер, шрифты, PNG/GIF и таймеры сохраняются на сервере.</p>
      <div class="ice-editor-buttons">
        <button type="button" class="secondary" data-ice-save="save">Сохранить</button>
        <button type="button" class="primary" data-ice-save="publish">Опубликовать</button>
        <button type="button" class="secondary" data-ice-save="hide">Скрыть с сайта</button>
      </div>
      <p class="sub" id="ice-editor-status" role="status">Загружено. Изменения появятся у игроков после сохранения.</p>
    </section>
    <section class="panel ice-editor-preview-panel">
      <h3>Предпросмотр как в приложении</h3>
      <p class="sub">Нажмите на текст и потяните его; синие маркеры по углам меняют размер. Двойной клик редактирует надпись. Маркеры по краям полотна меняют размеры всего баннера.</p>
      <div id="ice-banner-preview" class="ice-editor-preview"></div>
    </section>
    <section class="panel">
      <h3>Публикация и полотно</h3>
      <div class="ice-editor-grid">
        <label>Название события<input class="field" data-ice-global="title" maxlength="90" value="${esc(b.title)}"></label>
        <label>Событие, на которое ведёт баннер (его топ)<select class="field" data-ice-global="event_id">
          <option value="">Без привязки</option>
          ${iceEdit.events.map(e=>`<option value="${esc(e.id)}" ${b.event_id===e.id?'selected':''}>${esc(e.title)}</option>`).join('')}
        </select></label>
        <label>Начало<input class="field" type="datetime-local" data-ice-global="start_at" value="${iceLocal(b.start_at)}"></label>
        <label>Окончание<input class="field" type="datetime-local" data-ice-global="end_at" value="${iceLocal(b.end_at)}"></label>
        <label>Показывать в<select class="field" data-ice-global="rooms">
          <option value="all" ${b.rooms==='all'?'selected':''}>Обе комнаты</option>
          <option value="public" ${b.rooms==='public'?'selected':''}>Комната 1</option>
          <option value="private" ${b.rooms==='private'?'selected':''}>Комната 2</option>
        </select></label>
        <label>Ширина полотна, %<input class="field" type="number" min="50" max="100" data-ice-global="width_pct" value="${b.width_pct??100}"></label>
        <label>Высота полотна, px<input class="field" type="number" min="70" max="280" data-ice-global="height" value="${b.height}"></label>
        <label>Скругление<input class="field" type="number" min="0" max="60" data-ice-global="radius" value="${b.radius}"></label>
        <label>Цвет фона<input type="color" data-ice-global="background_color" value="${esc(b.background_color)}"></label>
        <label>Фон<select class="field" data-ice-global="background_fit">
          <option value="cover" ${b.background_fit==='cover'?'selected':''}>Заполнить</option>
          <option value="contain" ${b.background_fit==='contain'?'selected':''}>Целиком</option>
        </select></label>
        <label>Фоновое PNG/WebP/GIF<input type="file" data-ice-file="background" accept="image/png,image/jpeg,image/webp,image/gif"></label>
      </div>
      <div class="ice-editor-buttons">
        <button type="button" class="secondary" data-ice-clear="background">Удалить загруженный фон</button>
        <label class="ice-editor-check"><input type="checkbox" data-ice-global="hide_after_end" ${b.hide_after_end?'checked':''}> Скрывать после завершения</label>
        <label class="ice-editor-check"><input type="checkbox" data-ice-global="enabled" ${b.enabled?'checked':''}> Опубликован</label>
      </div>
    </section>
    <section class="panel">
      <h3>Слои и элементы</h3>
      <div class="ice-editor-buttons ice-editor-create">
        <button type="button" data-ice-add="title">+ Заголовок</button>
        <button type="button" data-ice-add="text">+ Текст</button>
        <button type="button" data-ice-add="timer">+ Таймер</button>
        <button type="button" data-ice-add="image">+ PNG / GIF</button>
        <button type="button" data-ice-add="gram">+ ◇ GRAM</button>
      </div>
      <div id="ice-editor-list" class="ice-editor-layer-list"></div>
      <div id="ice-editor-properties"></div>
    </section>
  </div>`;
  const panel=content.querySelector('.ice-editor');
  panel.addEventListener('input',iceEditInput);
  panel.addEventListener('change',iceEditChange);
  panel.addEventListener('click',iceEditClick);
  iceList();iceProperties();icePaint();
}
function iceEditInput(e){
  const hexField=e.target.dataset.iceColorHex;
  if(hexField){
    const color=e.target.value;
    if(!/^#[a-f0-9]{6}$/i.test(color))return;
    const l=iceSelected();
    if(!l)return;
    l[hexField]=color;
    const picker=document.querySelector('[data-ice-layer="'+hexField+'"]');
    if(picker)picker.value=color;
    iceDirty();icePaint();
    return;
  }
  const global=e.target.dataset.iceGlobal,field=e.target.dataset.iceLayer;
  let value=e.target.type==='checkbox'?e.target.checked:e.target.value;
  if(global){
    const b=iceEdit.banner;
    if(global==='start_at'||global==='end_at'){
      const unix=Date.parse(value);if(!Number.isFinite(unix))return;
      value=Math.floor(unix/1000);
    } else if(['height','radius','width_pct'].includes(global)){
      if(value==='')return;value=Number(value);
    }
    if(global==='title'){
      const old=b.title;
      b.layers.forEach(l=>{if(l.type==='title'&&l.text===old)l.text=value;});
    }
    b[global]=value;
    iceDirty();icePaint();
    if(global==='title')iceList();
  }else if(field){
    const l=iceSelected();if(!l)return;
    if(['x','y','w','h','font_size','font_weight','stroke_width','bg_opacity','radius','z'].includes(field)){
      if(value==='')return;value=Number(value);if(!Number.isFinite(value))return;
    }
    l[field]=value;
    if(field==='bg_opacity'&&l.type==='timer'&&value>0)iceEdit.timerOpacity.set(l.id,value);
    const output=document.querySelector('[data-ice-readout="'+field+'"]');
    if(output)output.textContent=String(value);
    if(field==='color'||field==='bg_color'){
      const hex=document.querySelector('[data-ice-color-hex="'+field+'"]');
      if(hex)hex.value=value;
    }
    if(field==='bg_opacity'&&l.type==='timer'){
      const checkbox=document.querySelector('[data-ice-toggle-bg]');
      if(checkbox)checkbox.checked=Number(value)>0;
    }
    iceDirty();icePaint();
    if(field==='text'||field==='z')iceList();
  }
}
function iceEditChange(e){
  if(e.target.hasAttribute('data-ice-toggle-bg')){
    const l=iceSelected();
    if(!l||l.type!=='timer')return;
    if(e.target.checked){
      l.bg_opacity=iceEdit.timerOpacity.get(l.id)||1;
    }else{
      if(Number(l.bg_opacity)>0)iceEdit.timerOpacity.set(l.id,Number(l.bg_opacity));
      l.bg_opacity=0;
    }
    iceDirty();iceProperties();icePaint();
    return;
  }
  if(e.target.dataset.iceFile){
    const file=e.target.files?.[0];
    if(file)iceUploadAsset(file,e.target.dataset.iceFile);
    return;
  }
  if(e.target.dataset.iceGlobal==='event_id'&&e.target.value){
    const found=iceEdit.events.find(event=>event.id===e.target.value);
    if(!found)return;
    const b=iceEdit.banner,old=b.title;
    b.title=found.title;b.start_at=found.start_at;b.end_at=found.end_at;
    b.layers.forEach(l=>{if(l.type==='title'&&(!l.text||l.text===old))l.text=b.title;});
    for(const f of ['title','start_at','end_at']){
      const input=document.querySelector('[data-ice-global="'+f+'"]');
      if(input)input.value=f==='title'?b.title:iceLocal(b[f]);
    }
    iceDirty();iceList();iceProperties();icePaint();
  }
}
function iceEditClick(e){
  const button=e.target.closest('[data-ice-save],[data-ice-add],[data-ice-pick],[data-ice-action],[data-ice-clear],[data-ice-insert]');
  if(!button)return;
  if(button.dataset.iceInsert==='gram'){
    const l=iceSelected();
    if(!l||!['title','text','timer'].includes(l.type))return;
    const input=document.querySelector('[data-ice-layer="text"]');
    if(!input)return;
    const insert='{GRAM}';
    const start=input.selectionStart??input.value.length;
    const end=input.selectionEnd??start;
    const next=input.value.slice(0,start)+insert+input.value.slice(end);
    if(next.length>140)return toast('Текст до 140 символов');
    input.value=next;
    l.text=next;
    input.focus();
    input.setSelectionRange(start+insert.length,start+insert.length);
    iceDirty();iceList();icePaint();
    return;
  }
  if(button.dataset.iceSave)iceSave(button.dataset.iceSave);
  if(button.dataset.iceAdd)iceAdd(button.dataset.iceAdd);
  if(button.dataset.icePick){iceEdit.selected=button.dataset.icePick;iceList();iceProperties();icePaint();}
  if(button.dataset.iceAction)iceLayerAction(button.dataset.iceAction);
  if(button.dataset.iceClear){
    if(button.dataset.iceClear==='background')iceEdit.banner.background_asset='';
    else if(iceSelected())iceSelected().asset='';
    iceDirty();iceProperties();icePaint();
  }
}
function iceNewId(){return 'ice'+(crypto.randomUUID?.()||String(Date.now())).replace(/-/g,'').slice(0,20);}
function iceAdd(type){
  const b=iceEdit.banner;if(b.layers.length>=20)return toast('Можно добавить до 20 слоёв');
  const l={id:iceNewId(),type,text:type==='title'?'Заголовок':type==='text'?'Надпись':'',
    x:8,y:15,w:type==='gram'?13:type==='timer'?30:type==='image'?25:54,h:type==='gram'?55:60,
    font:type==='timer'?'mono':'rounded',font_size:type==='timer'?17:24,font_weight:800,stroke_width:0,
    color:type==='timer'?'#0a3555':'#ffffff',bg_color:type==='timer'?'#ffffff':'#123c5c',
    bg_opacity:type==='timer'?1:0,radius:type==='timer'?18:0,
    align:type==='timer'?'center':'left',format:'hh:mm:ss',asset:'',fit:'contain',
    z:Math.min(99,Math.max(0,...b.layers.map(x=>x.z))+1)};
  b.layers.push(l);iceEdit.selected=l.id;
  iceDirty();iceList();iceProperties();icePaint();
  document.querySelector('#ice-editor-properties')?.scrollIntoView({block:'nearest'});
}
function iceLayerAction(action){
  const b=iceEdit.banner,l=iceSelected();if(!l)return;
  if(action==='remove'){
    b.layers=b.layers.filter(x=>x.id!==l.id);iceEdit.selected=b.layers[0]?.id||'';
  }else if(action==='copy'){
    if(b.layers.length>=20)return toast('Максимум 20 слоёв');
    const d={...l,id:iceNewId(),x:Math.min(100-l.w,l.x+4),y:Math.min(100-l.h,l.y+4),z:Math.min(99,l.z+1)};
    b.layers.push(d);iceEdit.selected=d.id;
  }else{
    const sorted=[...b.layers].sort((a,c)=>a.z-c.z),i=sorted.indexOf(l);
    const j=i+(action==='up'?1:-1);
    if(j>=0&&j<sorted.length){
      [sorted[i],sorted[j]]=[sorted[j],sorted[i]];
      sorted.forEach((layer,k)=>{layer.z=k+1;});
    }
  }
  iceDirty();iceList();iceProperties();icePaint();
}
async function iceUploadAsset(file,target){
  const status=document.querySelector('#ice-editor-status');
  if(file.size>8*1024*1024)return toast('Файл должен весить до 8 МБ');
  if(status)status.textContent='Загружаем '+file.name+'…';
  const form=new FormData();form.append('file',file);
  const selected=iceEdit.selected;
  try{
    const r=await api('admin/arena/banner/asset',form);
    if(target==='background')iceEdit.banner.background_asset=r.url;
    else{
      const l=iceEdit.banner.layers.find(x=>x.id===selected);
      if(l)l.asset=r.url;
    }
    iceDirty();iceProperties();icePaint();toast('Загружено. Не забудьте сохранить баннер.');
  }catch(error){if(status)status.textContent=error.message;toast(error.message);}
}
async function iceSave(mode){
  if(iceEdit.busy)return;
  const b=iceEdit.banner,was=b.enabled;
  if(mode==='publish')b.enabled=true;
  if(mode==='hide')b.enabled=false;
  if(b.start_at>=b.end_at){b.enabled=was;return toast('Проверьте даты события');}
  if(b.enabled&&!b.event_id){
    b.enabled=was;
    return toast('Выберите связанный ивент, чтобы баннер открывал его топ.');
  }
  if(b.enabled){
    const event=iceEdit.events.find(item=>item.id===b.event_id);
    if(!event?.enabled){
      b.enabled=was;
      return toast('Сначала опубликуйте привязанный ивент в разделе «Лидерборды и ивенты».');
    }
  }
  iceEdit.busy=true;const label=document.querySelector('#ice-editor-status');
  if(label)label.textContent='Сохраняем настройки…';
  try{
    const r=await api('admin/arena/banner',b);
    iceEdit.banner=r.banner;
    if(label)label.textContent=b.enabled?'Баннер опубликован':'Настройки сохранены; баннер скрыт';
    const checkbox=document.querySelector('[data-ice-global="enabled"]');
    if(checkbox)checkbox.checked=b.enabled;
    toast(b.enabled?'Баннер Ice Arena опубликован':'Баннер сохранён');
  }catch(error){
    b.enabled=was;if(label)label.textContent=error.message;toast(error.message);
  }finally{iceEdit.busy=false;}
}
