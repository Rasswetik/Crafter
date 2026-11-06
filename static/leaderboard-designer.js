/* Shared visual leaderboard renderer. Public rankings always come from the real ledger. */
const CRAFTER_LEADER_PARTS=[
 ['rank','Номер места'],['avatar','Аватар'],['name','Ник игрока'],
 ['score','Очки / результат'],['prize','PNG награды'],
 ['prize_label','Надпись награды'],['caption','Дополнительный текст']
];
const CRAFTER_LEADER_FIELDS=['rank','avatar','name','score','prize','prize_label','caption'];

function crafterLeaderSlots(mode='list'){
 if(mode==='podium')return {
  rank:{x:5,y:5,w:24,h:13},avatar:{x:22,y:17,w:56,h:38},
  name:{x:6,y:56,w:88,h:12},score:{x:10,y:69,w:80,h:10},
  prize:{x:35,y:81,w:30,h:18},prize_label:{x:4,y:85,w:30,h:10},
  caption:{x:15,y:92,w:70,h:8}
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
 const defaults={rank:true,avatar:true,name:true,score:true,prize:true,prize_label:true,caption:false};
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
   (editable?'<i class="crafter-leader-resize" data-leader-resize aria-hidden="true"></i>':'')+
   '</div>';
}
function crafterLeaderCard(player,rank,prize,block,event,mode='list',options={}){
 const setting=crafterLeaderRankStyle(block,rank);
 const selected=Boolean(options.editable&&options.selectedRank===rank);
 const height=(setting.height&&Number(setting.height)!==84)?Number(setting.height):
   mode==='podium'?Number(block.leader_podium_height||250):Number(block.leader_row_height||84);
 const bg=setting.background||options.rowBg||'#242229';
 const name=player?.name||'Место свободно';
 const avatar=setting.avatar_asset||player?.photo_url||'';
 const safePhoto=avatar&&(
   /^\/media\/ice-banner\/[0-9a-f]{32}\.(?:webp|gif)$/.test(avatar)||
   (avatar===player?.photo_url&&typeof imageURL==='function'&&imageURL(avatar))
 );
 const avatarContent=safePhoto?'<img loading="lazy" draggable="false" src="'+
   esc(setting.avatar_asset||imageURL(avatar))+'" alt="Аватар игрока">':
   '<span>'+esc(Array.from(name)[0]||'?')+'</span>';
 const pic=setting.prize_asset?
   '<img src="'+esc(setting.prize_asset)+'" draggable="false" alt="PNG награды">':
   (typeof crafterEventPrizeVisual==='function'&&prize?crafterEventPrizeVisual(prize):
    options.editable?'<span class="crafter-leader-placeholder">PNG</span>':'');
 const unit=event?.score_unit||'';
 const score=player?esc(player.score)+' <small>'+esc(unit)+'</small>':'—';
 const parts={
   rank:esc(String(rank)),avatar:avatarContent,name:'<strong>'+esc(name)+'</strong>',
   score:'<span>'+score+'</span>',prize:pic,
   prize_label:'<span>'+esc(prize?.label||'Награда')+'</span>',
   caption:'<span>'+esc(setting.caption||'')+'</span>'
 };
 const content=CRAFTER_LEADER_FIELDS.map(part=>
   crafterLeaderPartHTML(block,rank,part,parts[part],mode,selected,
     options.selectedPart)).join('');
 return '<article class="crafter-leader-card crafter-leader-'+mode+
   (selected?' is-active':'')+
   '" data-leader-rank="'+rank+'" data-leader-mode="'+mode+
   '" style="--leader-card-height:'+Math.max(64,Math.min(440,height))+
   'px;--leader-card-bg:'+esc(bg)+';">'+content+'</article>';
}
function crafterLeaderboardHTML(leaders,prizes,block,event,options={}){
 const n=Math.min(100,Math.max(1,Number(block.rank_count)||10));
 const playerMap=leaders instanceof Map?leaders:new Map((leaders||[]).map(p=>[Number(p.rank),p]));
 const prizeMap=prizes instanceof Map?prizes:new Map((prizes||[]).map(p=>[Number(p.place),p]));
 const mode=block.leader_mode==='podium'?'podium':'list';
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
 return '<div class="crafter-leader-combined" id="crafter-event-ranking">'+
   '<div class="crafter-leader-podium">'+podium.map(rank=>render(rank,'podium')).join('')+'</div>'+
   (ordinary.length?'<div class="crafter-leader-full-list">'+
       ordinary.map(rank=>render(rank,'list')).join('')+'</div>':'')+'</div>';
}
