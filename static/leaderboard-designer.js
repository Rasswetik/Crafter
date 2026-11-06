/* Shared visual leaderboard renderer. Public rankings always come from the real ledger. */
const CRAFTER_LEADER_PARTS=[
 ['rank','Номер места'],['avatar','Аватар'],['name','Ник игрока'],
 ['score','Очки / результат'],['prize','PNG награды'],
 ['prize_label','Надпись награды'],['caption','Дополнительный текст']
];
const CRAFTER_LEADER_FIELDS=['rank','avatar','name','score','prize','prize_label','caption'];

function crafterLeaderSlots(mode='list'){
 if(mode==='podium')return {
  rank:{x:5,y:4,w:23,h:12},avatar:{x:20,y:19,w:60,h:36},
  name:{x:5,y:58,w:90,h:12},score:{x:5,y:71,w:90,h:10},
  prize:{x:31,y:83,w:38,h:16},prize_label:{x:7,y:83,w:86,h:12},
  caption:{x:10,y:87,w:80,h:11}
 };
 return {
  rank:{x:2,y:20,w:7,h:60},avatar:{x:10,y:12,w:13,h:76},
  name:{x:26,y:14,w:48,h:30},score:{x:26,y:52,w:45,h:24},
  prize:{x:80,y:10,w:18,h:80},prize_label:{x:60,y:35,w:18,h:30},
  caption:{x:26,y:77,w:49,h:17}
 };
}
function crafterLeaderRankStyle(block,rank){
 return block?.rank_styles?.[String(rank)]||{};
}
function crafterLeaderPosition(block,rank,part,mode='list'){
 return {...crafterLeaderSlots(mode)[part],
         ...(crafterLeaderRankStyle(block,rank).layout?.[part]||{})};
}
function crafterLeaderVisible(block,rank,part){
 const defaults={rank:true,avatar:true,name:true,score:true,prize:true,prize_label:false,caption:false};
 const enabled=(block?.leader_fields?.[part]??defaults[part])===true;
 return enabled&&!((crafterLeaderRankStyle(block,rank).hidden||[]).includes(part));
}
function crafterLeaderPartHTML(block,rank,part,content,mode,editable,selectedPart){
 if(!crafterLeaderVisible(block,rank,part))return '';
 const p=crafterLeaderPosition(block,rank,part,mode);
 const geometry='left:'+Number(p.x)+'%;top:'+Number(p.y)+'%;width:'+Number(p.w)+
   '%;height:'+Number(p.h)+'%;';
 return '<div class="crafter-leader-part crafter-leader-part-'+part+
   (editable&&selectedPart===part?' is-selected':'')+
   '" data-leader-part="'+part+'" style="'+geometry+'">'+content+
   (editable&&selectedPart===part?'<i class="crafter-leader-resize" data-leader-resize aria-hidden="true"></i>':'')+
   '</div>';
}
function crafterLeaderCard(player,rank,prize,block,event,mode='list',options={}){
 const setting=crafterLeaderRankStyle(block,rank);
 const selected=Boolean(options.editable&&options.selectedRank===rank);
 const height=(setting.height&&Number(setting.height)!==84)?Number(setting.height):
   mode==='podium'?Number(block.leader_podium_height||250):Number(block.leader_row_height||84);
 const bg=setting.background||options.rowBg||'#242229';
 const hasPrize=Boolean(setting.prize_asset||prize&&prize.type!=='none');
 const configuredName=typeof prize?.label==='string'?prize.label.trim():'';
 const customAvatar=Boolean(setting.avatar_asset);
 const name=player?.name||'Место свободно';
 const avatar=setting.avatar_asset||player?.photo_url||'';
 const safePhoto=avatar&&(
   /^\/media\/ice-banner\/[0-9a-f]{32}\.(?:webp|gif)$/.test(avatar)||
   (avatar===player?.photo_url&&typeof imageURL==='function'&&imageURL(avatar))
 );
 const avatarContent=safePhoto?'<img loading="lazy" draggable="false" src="'+
   esc(setting.avatar_asset||imageURL(avatar))+'" alt="Аватар игрока"'+
   (customAvatar?' class="crafter-avatar-transparent"':'')+'>':
   '<span>'+esc(Array.from(name)[0]||'?')+'</span>';
 const pic=setting.prize_asset?
   '<img src="'+esc(setting.prize_asset)+'" draggable="false" alt="PNG награды">':
   (typeof crafterEventPrizeVisual==='function'&&prize?crafterEventPrizeVisual(prize):
     typeof studioPrizePreview==='function'&&prize?studioPrizePreview(prize):
     options.editable?'<span class="crafter-leader-placeholder">PNG</span>':'');
 const unit=event?.score_unit||'';
 const score=player?esc(player.score)+' <small>'+esc(unit)+'</small>':'—';
 const parts={
   rank:esc(String(rank)),avatar:avatarContent,name:'<strong>'+esc(name)+'</strong>',
   score:'<span>'+score+'</span>',prize:pic,
   prize_label:'<span>'+esc(configuredName||'Награда')+'</span>',
   caption:'<span>'+esc(setting.caption||'')+'</span>'
 };
 const content=CRAFTER_LEADER_FIELDS.map(part=>{
   // Empty spaces must never render a fake reward label or a clipped "Награда".
   if((part==='prize'||part==='prize_label')&&!hasPrize)return '';
   if(part==='prize_label'&&!configuredName)return '';
   if(part==='caption'&&!String(setting.caption||'').trim())return '';
   return crafterLeaderPartHTML(block,rank,part,parts[part],mode,selected,
     options.selectedPart);
 }).join('');
 return '<article class="crafter-leader-card crafter-leader-'+
   (mode==='podium'?'podium-card':'list')+
   (selected?' is-active':'')+
   (mode==='podium'?' crafter-leader-seat':'')+
   '" data-leader-rank="'+rank+'" data-leader-mode="'+mode+
   '" style="--leader-card-height:'+Math.max(64,Math.min(440,height))+
   'px;--leader-card-bg:'+esc(bg)+';">'+
   (mode==='podium'?'<div class="crafter-throne-shimmer" aria-hidden="true"></div>':'')+
   content+'</article>';
}
function crafterLeaderboardHTML(leaders,prizes,block,event,options={}){
 const n=Math.min(100,Math.max(1,Number(block.rank_count)||10));
 const playerMap=leaders&&typeof leaders.get==='function'&&typeof leaders.entries==='function'
   ?leaders:new Map((leaders||[]).map(p=>[Number(p.rank),p]));
 const prizeMap=prizes&&typeof prizes.get==='function'&&typeof prizes.entries==='function'
   ?prizes:new Map((prizes||[]).map(p=>[Number(p.place),p]));
 const mode=block.leader_mode==='podium'?'podium':'list';
 const podiumWidth=Math.max(60,Math.min(100,Number(block.leader_podium_width)||100));
 const podiumGap=Math.max(0,Math.min(24,Number(block.leader_podium_gap??8)));
 const throneStyle=['royal','steps','minimal'].includes(block.leader_podium_style)?
    block.leader_podium_style:'royal';
 const render=(rank,typ)=>{
   const player=playerMap.get(rank),prize=prizeMap.get(rank);
   if(!options.editable&&options.showEmpty===false&&!player&&!prize)return '';
   return crafterLeaderCard(player,rank,prize,block,event,typ,options);
 };
 const ranks=Array.from({length:n},(_,i)=>i+1);
 if(options.editable&&options.selectedRank>n&&options.selectedRank<=100)
   ranks.push(options.selectedRank);
 if(mode!=='podium')
   return '<div class="crafter-leader-full-list" id="crafter-event-ranking">'+
       ranks.map(rank=>render(rank,'list')).join('')+'</div>';
 const podium=ranks.filter(rank=>rank<=3).sort((a,b)=>{
    const slotA=Number(crafterLeaderRankStyle(block,a).order||({1:2,2:1,3:3}[a]));
    const slotB=Number(crafterLeaderRankStyle(block,b).order||({1:2,2:1,3:3}[b]));
    return slotA-slotB||a-b;
 });
 const ordinary=ranks.filter(rank=>rank>3);
 const throne=rank=>{
   const setting=crafterLeaderRankStyle(block,rank);
   const width=Math.max(50,Math.min(100,Number(setting.width_pct)||100));
   const stepDefaults={1:92,2:68,3:54};
   const step=Math.max(20,Math.min(190,Number(setting.step_height)||stepDefaults[rank]));
   return '<div class="crafter-throne-slot crafter-throne-place-'+rank+
    '" data-throne-rank="'+rank+'" style="--throne-card-width:'+width+
    '%;--throne-step-height:'+step+'px">'+
      (throneStyle==='royal'?'<div class="crafter-throne-crest" aria-hidden="true">✦</div>':'')+
      render(rank,'podium')+
      '<div class="crafter-throne-base" aria-hidden="true"><span>'+
       rank+'</span></div>'+
      (options.editable?'<span class="crafter-throne-size-grip" data-throne-resize title="Перетащите для изменения размера места"></span>':'')+
    '</div>';
 };
 return '<div class="crafter-leader-combined" id="crafter-event-ranking">'+
   '<div class="crafter-leader-podium crafter-throne-style-'+throneStyle+
      '" style="--podium-width:'+podiumWidth+'%;--podium-gap:'+podiumGap+'px">'+
      podium.map(throne).join('')+'</div>'+
   (ordinary.length?'<div class="crafter-leader-full-list">'+
       ordinary.map(rank=>render(rank,'list')).join('')+'</div>':'')+'</div>';
}
