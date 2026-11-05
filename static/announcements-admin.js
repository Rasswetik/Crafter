/* Admin: Announcement / promo card composer. */
let crafterAnnouncementAdmin={items:[],draft:null};
function announcementDefault(){
 return {
  id:'',enabled:false,title:'Новое событие Crafter',
  description:'Участвуйте в новых событиях и получайте награды.',
  button_text:'Перейти',button_url:'',media:'',frequency:4,close_delay:3,
  max_width:420,media_height:290,position:'center',
  background_color:'#242326',title_color:'#ffffff',
  description_color:'#b7b2c0',button_color:'#168bff',
  button_text_color:'#ffffff',
  title_font:'rounded',description_font:'system',
  title_size:23,description_size:13,radius:27,blur:8,
  start_at:0,end_at:0
 };
}
function announcementField(key,label,value,type='text',min='',max='',step=''){
 return '<label>'+label+'<input class="field" type="'+type+
  '" data-ann-field="'+key+'" value="'+esc(String(value??''))+'"'+
  (min!==''?' min="'+min+'"':'')+(max!==''?' max="'+max+'"':'')+
  (step!==''?' step="'+step+'"':'')+'></label>';
}
function announcementChoices(key,label,value,choices){
 return '<label>'+label+'<select class="field" data-ann-field="'+key+'">'+
 choices.map(([v,n])=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+
  '>'+esc(n)+'</option>').join('')+'</select></label>';
}
function announcementDate(unix){
 if(!unix)return'';
 const d=new Date(Number(unix)*1000);
 return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
async function renderAdminAnnouncements(content=document.querySelector('#admin-content')){
 const result=await api('admin/announcements');
 if(!content?.isConnected)return;
 crafterAnnouncementAdmin={items:result.announcements||[],draft:announcementDefault()};
 content.innerHTML='<div class="crafter-announcement-admin">'+
  '<section class="panel"><h3>Анонсы</h3>'+
  '<p class="sub">Полноэкранные всплывающие объявления в стиле Crafter: PNG/GIF, заголовок, описание, кнопка, цвет, шрифт и кольцо закрытия. Первый показ всем, затем повтор через 3–5 посещений.</p>'+
  '<button class="primary" type="button" data-ann-action="new">+ Новый анонс</button></section>'+
  '<section class="panel"><h3>Опубликованные и черновики</h3>'+
   '<div id="ann-admin-list"></div></section>'+
  '<section class="panel"><h3>Редактор анонса</h3>'+
   '<div id="ann-admin-editor"></div></section>'+
  '</div>';
 const root=content.querySelector('.crafter-announcement-admin');
 root.addEventListener('click',announcementAdminClick);
 root.addEventListener('input',announcementAdminInput);
 root.addEventListener('change',announcementAdminChange);
 announcementPaintList();announcementPaintEditor();
}
function announcementPaintList(){
 const root=document.getElementById('ann-admin-list');
 if(!root)return;
 root.innerHTML=crafterAnnouncementAdmin.items.map(item=>
  '<button type="button" class="ann-admin-row" data-ann-open="'+esc(item.id)+'">'+
  (item.media?'<img src="'+esc(item.media)+'" alt="">':'<span class="ann-admin-symbol">✦</span>')+
  '<span><b>'+esc(item.title)+'</b><small>'+
  (item.enabled?'Опубликован':'Черновик')+' · Каждые '+item.frequency+' входа</small></span></button>').join('')||
  '<p class="sub">Пока нет анонсов.</p>';
}
function announcementPaintEditor(){
 const root=document.getElementById('ann-admin-editor');
 if(!root)return;
 const d=crafterAnnouncementAdmin.draft;
 const fonts=[['system','Системный'],['rounded','Скруглённый'],['display','SF Pro Display'],
  ['heavy','Impact'],['bold','Arial Black'],['geometric','Trebuchet'],['clean','Verdana'],
  ['classic','Tahoma'],['mono','Моноширинный'],['serif','Georgia'],
  ['condensed','Узкий'],['futuristic','Техно']];
 root.innerHTML='<div class="ann-admin-fields">'+
  '<label class="ann-admin-publish"><input type="checkbox" data-ann-field="enabled"'+
   (d.enabled?' checked':'')+'> Опубликовано</label>'+
  announcementField('title','Заголовок',d.title)+
  '<label class="ann-admin-wide">Описание<textarea class="field" rows="3" data-ann-field="description">'+
   esc(d.description)+'</textarea></label>'+
  '<label class="ann-admin-wide">Изображение или GIF (до 8 МБ)'+
   '<input type="file" accept="image/png,image/gif,image/jpeg,image/webp" data-ann-upload></label>'+
  (d.media?'<div class="ann-admin-current"><img src="'+esc(d.media)+'" alt="Анонс">'+
    '<button type="button" data-ann-action="clear-media">Удалить изображение</button></div>':'')+
  announcementField('button_text','Надпись кнопки',d.button_text)+
  announcementField('button_url','Ссылка кнопки',d.button_url)+
  announcementChoices('position','Расположение',d.position,
   [['center','По центру'],['bottom','Снизу']])+
  announcementField('frequency','Повтор через входов',d.frequency,'number',3,5)+
  announcementField('close_delay','Круг закрытия, секунд',d.close_delay,'number',1,12)+
  announcementField('max_width','Ширина окна',d.max_width,'range',290,560)+
  announcementField('media_height','Высота изображения',d.media_height,'range',120,520)+
  announcementField('radius','Скругление окна',d.radius,'range',0,45)+
  announcementField('blur','Размытие фона',d.blur,'range',0,20)+
  announcementChoices('title_font','Шрифт заголовка',d.title_font,fonts)+
  announcementChoices('description_font','Шрифт описания',d.description_font,fonts)+
  announcementField('title_size','Размер заголовка',d.title_size,'range',14,45)+
  announcementField('description_size','Размер описания',d.description_size,'range',10,23)+
  announcementField('background_color','Цвет окна',d.background_color,'color')+
  announcementField('title_color','Цвет заголовка',d.title_color,'color')+
  announcementField('description_color','Цвет описания',d.description_color,'color')+
  announcementField('button_color','Цвет кнопки',d.button_color,'color')+
  announcementField('button_text_color','Текст кнопки',d.button_text_color,'color')+
  announcementField('start_at','Начало показа (необязательно)',announcementDate(d.start_at),'datetime-local')+
  announcementField('end_at','Окончание (необязательно)',announcementDate(d.end_at),'datetime-local')+
  '</div><div class="ann-admin-actions">'+
  '<button type="button" class="secondary" data-ann-action="preview">Предпросмотр</button>'+
  '<button type="button" class="primary" data-ann-action="save">Сохранить</button>'+
  (d.id?'<button type="button" class="secondary" data-ann-action="delete">Удалить</button>':'')+
  '</div><p class="sub" role="status" id="ann-admin-status">Настройки сохраняются по кнопке.</p>';
}
function announcementAdminInput(event){
 const t=event.target,k=t.dataset.annField;
 if(!k)return;
 let val=t.type==='checkbox'?t.checked:t.value;
 if(t.type==='number'||t.type==='range')val=Number(val);
 if(t.type==='datetime-local')val=val?Math.floor(Date.parse(val)/1000):0;
 crafterAnnouncementAdmin.draft[k]=val;
}
function announcementAdminChange(event){
 if(event.target.hasAttribute('data-ann-upload')){
  const file=event.target.files?.[0];if(file)announcementUpload(file);
 }else if(event.target.dataset.annField)announcementAdminInput(event);
}
async function announcementUpload(file){
 if(file.size>8*1024*1024)return toast('PNG/GIF должен быть до 8 МБ');
 const data=new FormData();data.append('file',file);
 const status=document.getElementById('ann-admin-status');
 if(status)status.textContent='Загружаем '+file.name+'…';
 try{
  const result=await api('admin/arena/banner/asset',data);
  crafterAnnouncementAdmin.draft.media=result.url;
  announcementPaintEditor();
  toast('Изображение загружено');
 }catch(error){if(status)status.textContent=error.message;toast(error.message);}
}
async function announcementAdminClick(event){
 const button=event.target.closest('[data-ann-action],[data-ann-open]');
 if(!button)return;
 if(button.dataset.annOpen){
  const found=crafterAnnouncementAdmin.items.find(x=>x.id===button.dataset.annOpen);
  if(found)crafterAnnouncementAdmin.draft={...found};
  announcementPaintEditor();
  document.getElementById('ann-admin-editor')?.scrollIntoView({block:'start',behavior:'smooth'});
  return;
 }
 const action=button.dataset.annAction;
 if(action==='new'){crafterAnnouncementAdmin.draft=announcementDefault();announcementPaintEditor();return;}
 if(action==='clear-media'){
  crafterAnnouncementAdmin.draft.media='';announcementPaintEditor();return;
 }
 if(action==='preview'){
  if(typeof crafterShowAnnouncement==='function')crafterShowAnnouncement(crafterAnnouncementAdmin.draft,true);
  return;
 }
 if(action==='save'){
  button.disabled=true;
  try{
   const result=await api('admin/announcements',crafterAnnouncementAdmin.draft);
   const saved=result.announcement;
   crafterAnnouncementAdmin.draft={...saved};
   const index=crafterAnnouncementAdmin.items.findIndex(a=>a.id===saved.id);
   if(index>=0)crafterAnnouncementAdmin.items[index]=saved;
   else crafterAnnouncementAdmin.items.unshift(saved);
   announcementPaintList();announcementPaintEditor();
   toast('Анонс сохранён');
  }catch(error){toast(error.message);}
  finally{if(button.isConnected)button.disabled=false;}
  return;
 }
 if(action==='delete'){
  const id=crafterAnnouncementAdmin.draft.id;
  if(!id||!confirm('Удалить анонс и настройки повторных показов?'))return;
  try{
   await api('admin/announcements/'+id+'/delete',{});
   crafterAnnouncementAdmin.items=crafterAnnouncementAdmin.items.filter(a=>a.id!==id);
   crafterAnnouncementAdmin.draft=announcementDefault();
   announcementPaintList();announcementPaintEditor();
   toast('Анонс удалён');
  }catch(error){toast(error.message);}
 }
}
