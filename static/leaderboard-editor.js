/* Visual leaderboard inspector: per-place drag/resize, hide, avatar and NFT art. */
const CRAFTER_LEADER_LABELS={
 rank:'Номер',avatar:'Аватар',name:'Ник',score:'Результат',
 prize:'PNG награды',prize_label:'Надпись награды',caption:'Свой текст'
};

function studioLeaderRank(block,rank){
 block.rank_styles ||= {};
 const key=String(Math.max(1,Math.min(100,Number(rank)||1)));
 if(!block.rank_styles[key])
   block.rank_styles[key]={layout:{},hidden:[],avatar_asset:'',prize_asset:'',
       caption:'',background:'',height:84,order:Number(key)===1?2:Number(key)===2?1:3};
 return block.rank_styles[key];
}
function studioLeaderPart(){
 return CRAFTER_LEADER_FIELDS.includes(crafterStudio.leaderPart)?crafterStudio.leaderPart:'prize';
}
function studioLeaderInspector(block){
 block.leader_mode ||= 'classic';
 block.leader_fields ||= {
    rank:true,avatar:true,name:true,score:true,prize:true,prize_label:true,caption:false
 };
 const rank=crafterStudio.rank||1,part=studioLeaderPart();
 const setting=block.rank_styles?.[String(rank)]||{};
 const position=crafterLeaderPosition(block,rank,part,
   block.leader_mode==='podium'&&rank<=3?'podium':'list');
 const options=[['classic','Классический список'],['list','Полный настраиваемый список'],
                ['podium','Пьедестал топ-3 + остальные места']];
 const input=(label,key,value,type='number',min='',max='',step='')=>
    '<label>'+label+'<input class="field" data-leader-key="'+key+
    '" type="'+type+'" value="'+studioEsc(value??'')+'"'+
    (min!==''?' min="'+min+'"':'')+(max!==''?' max="'+max+'"':'')+
    (step!==''?' step="'+step+'"':'')+'></label>';
 const toggles=CRAFTER_LEADER_PARTS.map(([name,label])=>
    '<label><input type="checkbox" data-leader-key="global-'+name+
    '"'+(block.leader_fields[name]===true?' checked':'')+'> '+label+'</label>').join('');
 const hidden=setting.hidden||[];
 const rankChecks=CRAFTER_LEADER_PARTS.map(([name,label])=>
    '<label><input type="checkbox" data-leader-key="visible-'+name+
    '"'+(!hidden.includes(name)?' checked':'')+'> '+label+'</label>').join('');
 const select=(key,value,choices)=>
    '<select class="field" data-leader-key="'+key+'">'+choices.map(([v,name])=>
      '<option value="'+studioEsc(v)+'"'+(String(v)===String(value)?' selected':'')+
      '>'+studioEsc(name)+'</option>').join('')+'</select>';
 return '<div class="crafter-leader-editor">'+
    '<p class="sub">Реальные игроки и результаты. Двигайте аватар, ник, очки, PNG и подписи прямо на карточке; за синий угол меняется размер.</p>'+
    '<h4>Режим лидерборда</h4>'+
    select('mode',block.leader_mode,options)+
    '<div class="studio-fields">'+
      input('Количество мест','rank_count',block.rank_count,'number',1,100)+
      input('Высота строки, px','leader_row_height',block.leader_row_height||84,'number',64,280)+
      input('Высота пьедестала, px','leader_podium_height',block.leader_podium_height||250,'number',140,440)+
    '</div>'+
    '<h4>Показывать элементы</h4><div class="crafter-leader-options">'+toggles+'</div>'+
    '<h4>Выберите место</h4>'+
    input('Место 1–100','rank',rank,'number',1,100)+
    '<div class="crafter-leader-places">'+Array.from({length:100},(_,i)=>{
        const n=i+1;return '<button type="button" data-leader-pick="'+n+
          '" class="'+(n===rank?'active':'')+'">'+n+'</button>';
    }).join('')+'</div>'+
    '<div class="crafter-leader-buttons">'+
     '<button type="button" class="secondary" data-leader-action="reset-rank">Сбросить оформление этого места</button>'+
    '</div>'+
    '<h4>Место №'+rank+'</h4>'+
    '<div class="studio-fields">'+
      input('Фон этого места (цвет)','background',setting.background||block.background||'#242229','color')+
      input('Высота места, px','height',setting.height||84,'number',64,440)+
      (rank<=3?input('Позиция на пьедестале, 1–3','order',
           setting.order||({1:2,2:1,3:3}[rank]),'number',1,3):'')+
      input('Дополнительная надпись','caption',setting.caption||'','text')+
    '</div>'+
    '<h4>Видимость на этом месте</h4><div class="crafter-leader-options">'+rankChecks+'</div>'+
    '<h4>Выбранный элемент</h4>'+
    select('part',part,CRAFTER_LEADER_PARTS)+
    '<div class="studio-fields">'+
      input('X, %','x',position.x,'number',0,98,.1)+
      input('Y, %','y',position.y,'number',0,98,.1)+
      input('Ширина, %','w',position.w,'number',2,100,.1)+
      input('Высота, %','h',position.h,'number',2,100,.1)+
    '</div>'+
    '<div class="crafter-leader-buttons">'+
      '<button class="secondary" type="button" data-leader-action="hide-part">Убрать элемент</button>'+
      '<button class="secondary" type="button" data-leader-action="reset-part">Сбросить координаты</button>'+
      '<button class="secondary" type="button" data-leader-action="center-part">По центру</button>'+
    '</div>'+
    '<h4>Своё изображение для места №'+rank+'</h4>'+
    '<label>Аватар PNG / GIF<input type="file" data-leader-upload="avatar_asset" accept="image/png,image/gif,image/webp,image/jpeg"></label>'+
    (setting.avatar_asset?'<div class="crafter-leader-asset"><img src="'+studioEsc(setting.avatar_asset)+
      '" alt="Аватар"><button class="secondary" type="button" data-leader-action="clear-avatar">Вернуть аватар игрока</button></div>':'')+
    '<label>PNG / GIF награды<input type="file" data-leader-upload="prize_asset" accept="image/png,image/gif,image/webp,image/jpeg"></label>'+
    (setting.prize_asset?'<div class="crafter-leader-asset"><img src="'+studioEsc(setting.prize_asset)+
      '" alt="Награда"><button class="secondary" type="button" data-leader-action="clear-prize">Вернуть PNG награды из каталога</button></div>':'')+
    '<p class="sub">Перемещение и изменение изображения не влияет на NFT, который будет куплен и выдан победителю. Призы настраиваются отдельно в разделе «Награды 1–100».</p>'+
    '</div>';
}

function studioLeaderChange(input){
 const block=studioBlock();if(!block||block.type!=='leaderboard')return;
 const key=input.dataset.leaderKey,value=input.type==='checkbox'?input.checked:input.value;
 if(key==='rank'){
   crafterStudio.rank=Math.max(1,Math.min(100,Number(value)||1));
   studioPaintInspector();studioPaintPreview();return;
 }
 if(key==='part'){
   crafterStudio.leaderPart=value;
   studioPaintInspector();studioPaintPreview();return;
 }
 if(['mode','rank_count','leader_row_height','leader_podium_height'].includes(key)){
   const dest={mode:'leader_mode',rank_count:'rank_count',
     leader_row_height:'leader_row_height',leader_podium_height:'leader_podium_height'}[key];
   block[dest]=key==='mode'?value:Number(value);
   if(key==='rank_count')crafterStudio.page.style.rank_count=Number(value);
 }else if(key.startsWith('global-')){
   block.leader_fields ||= {};
   block.leader_fields[key.slice(7)]=Boolean(value);
 }else{
   const rank=crafterStudio.rank||1,setting=studioLeaderRank(block,rank);
   if(key.startsWith('visible-')){
     const name=key.slice(8);
     setting.hidden=(setting.hidden||[]).filter(x=>x!==name);
     if(!value)setting.hidden.push(name);
   }else if(['x','y','w','h'].includes(key)){
     const part=studioLeaderPart(),mode=block.leader_mode==='podium'&&rank<=3?'podium':'list';
     setting.layout ||= {};
     setting.layout[part] ||= crafterLeaderPosition(block,rank,part,mode);
     const p=setting.layout[part];
     p[key]=Math.min(key==='x'||key==='y'?98:100,Math.max(key==='x'||key==='y'?0:2,Number(value)||0));
     p.x=Math.min(p.x,100-p.w);p.y=Math.min(p.y,100-p.h);
   }else if(key==='height'||key==='order')setting[key]=Number(value);
   else if(key==='background'||key==='caption')setting[key]=String(value);
 }
 studioDirty();studioPaintInspector();studioPaintPreview();
}
function studioLeaderClick(button){
 const block=studioBlock();
 if(!block||block.type!=='leaderboard')return;
 if(button.dataset.leaderPick){
   crafterStudio.rank=Number(button.dataset.leaderPick);
   studioPaintInspector();studioPaintPreview();return;
 }
 const action=button.dataset.leaderAction,rank=crafterStudio.rank||1;
 if(!action)return;
 if(action==='reset-rank')delete (block.rank_styles||{})[String(rank)];
 else{
   const setting=studioLeaderRank(block,rank);
   if(action==='clear-avatar')setting.avatar_asset='';
   if(action==='clear-prize')setting.prize_asset='';
   if(action==='hide-part'){
     setting.hidden ||= [];
     if(!setting.hidden.includes(studioLeaderPart()))setting.hidden.push(studioLeaderPart());
   }
   if(action==='reset-part')delete (setting.layout||{})[studioLeaderPart()];
   if(action==='center-part'){
     const part=studioLeaderPart(),mode=block.leader_mode==='podium'&&rank<=3?'podium':'list';
     const pos=crafterLeaderPosition(block,rank,part,mode);
     setting.layout ||= {};
     setting.layout[part]={...pos,x:Math.round((100-pos.w)/2*10)/10};
   }
 }
 studioDirty();studioPaintInspector();studioPaintPreview();
}
async function studioLeaderUpload(input){
 const file=input.files?.[0];
 if(!file)return;
 if(file.size>8*1024*1024)return toast('Максимум 8 МБ для PNG/GIF');
 const block=studioBlock();if(block?.type!=='leaderboard')return;
 const rank=crafterStudio.rank;
 const assetKey=input.dataset.leaderUpload;
 if(!['avatar_asset','prize_asset'].includes(assetKey))return;
 const form=new FormData();form.append('file',file);
 studioSetStatus('Загружаем '+file.name+'…');
 try{
   const result=await api('admin/arena/banner/asset',form);
   studioLeaderRank(block,rank)[assetKey]=result.url;
   studioDirty();studioPaintInspector();studioPaintPreview();
   toast('Изображение загружено; сохраните страницу.');
 }catch(error){studioSetStatus(error.message);toast(error.message);}
}
function studioLeaderDragStart(event){
 if(!crafterStudio||crafterStudio.previewMode||event.button!==0)return;
 const card=event.target.closest('.crafter-leader-card[data-leader-rank]');
 const block=studioBlock();
 if(!card||block?.type!=='leaderboard')return;
 const rank=Number(card.dataset.leaderRank);
 const partEl=event.target.closest('[data-leader-part]');
 crafterStudio.rank=rank;
 if(!partEl){
   studioPaintInspector();studioPaintPreview();return;
 }
 const part=partEl.dataset.leaderPart;
 crafterStudio.leaderPart=part;
 const mode=card.dataset.leaderMode==='podium'?'podium':'list';
 const init=crafterLeaderPosition(block,rank,part,mode);
 const startX=event.clientX,startY=event.clientY;
 const resize=Boolean(event.target.closest('[data-leader-resize]'));
 const setting=studioLeaderRank(block,rank);
 setting.layout ||= {};
 const box=card.getBoundingClientRect();
 const control=partEl,anchor={...init};
 let moved=false;
 function move(e){
   if(e.pointerId!==event.pointerId)return;
   const dx=(e.clientX-startX)/Math.max(1,box.width)*100;
   const dy=(e.clientY-startY)/Math.max(1,box.height)*100;
   const p={...anchor};
   const snap=(n)=>crafterStudio.snap?Math.round(n*2)/2:Math.round(n*10)/10;
   if(resize){
      p.w=Math.max(2,Math.min(100-p.x,snap(init.w+dx)));
      p.h=Math.max(2,Math.min(100-p.y,snap(init.h+dy)));
   }else{
      p.x=Math.max(0,Math.min(100-p.w,snap(init.x+dx)));
      p.y=Math.max(0,Math.min(100-p.h,snap(init.y+dy)));
   }
   setting.layout[part]=p;moved=true;
   control.style.left=p.x+'%';control.style.top=p.y+'%';
   control.style.width=p.w+'%';control.style.height=p.h+'%';
 }
 function done(e){
   if(e.pointerId!==event.pointerId)return;
   control.removeEventListener('pointermove',move);
   control.removeEventListener('pointerup',done);
   control.removeEventListener('pointercancel',done);
   if(moved)studioDirty();
   studioPaintInspector();studioPaintPreview();
 }
 event.preventDefault();event.stopPropagation();
 control.setPointerCapture(event.pointerId);
 control.addEventListener('pointermove',move);
 control.addEventListener('pointerup',done);
 control.addEventListener('pointercancel',done);
}
