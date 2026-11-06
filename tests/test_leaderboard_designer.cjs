const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx=vm.createContext({
 esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 imageURL:s=>s,
 crafterEventPrizeVisual:p=>'<span class="crafter-rank-prize"><span class="crafter-rank-prize-label">Награда</span><span class="crafter-rank-prize-art"><img src="'+p.image_url+'"></span></span>'
});
vm.runInContext(fs.readFileSync('static/leaderboard-designer.js','utf8'),ctx);
for(const filename of ['static/leaderboard-editor.js','static/event-studio.js','static/event-page-view.js','static/events-admin.js','static/ice-banner-admin.js'])
    new vm.Script(fs.readFileSync(filename,'utf8'),{filename});
const display=vm.runInContext('crafterLeaderboardHTML',ctx);
const defaultStyle={leader_mode:'list',rank_count:4,leader_row_height:100,rank_styles:{},leader_fields:{}};
const players=new Map([[1,{id:'100',rank:1,name:'User & Co',score:'9',photo_url:'/a.png'}]]);
const prizes=new Map([[1,{place:1,label:'Reward',image_url:'/prize.png'}]]);
const list=display(players,prizes,defaultStyle,{score_unit:'очков'},{editable:true,selectedRank:1,selectedPart:'prize'});
assert.match(list,/data-leader-rank="1"/);
assert.match(list,/data-leader-rank="4"/);
assert.match(list,/User &amp; Co/);
assert.match(list,/data-leader-part="prize"/);
assert.match(list,/data-leader-resize/);
assert.match(list,/class="crafter-leader-full-list"/);
const custom={...defaultStyle,leader_mode:'podium',rank_styles:{
 '1':{order:2,hidden:['prize_label','score'],
   avatar_asset:'/media/ice-banner/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
   prize_asset:'/media/ice-banner/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.gif',
   caption:'Winner',layout:{prize:{x:20,y:25,w:40,h:35}}},
 '2':{order:1},'3':{order:3}
}};
const html=display(players,prizes,custom,{score_unit:'очков'},{editable:false});
assert.ok(html.indexOf('data-leader-rank="2"')<html.indexOf('data-leader-rank="1"'));
assert.ok(html.indexOf('data-leader-rank="1"')<html.indexOf('data-leader-rank="3"'));
const card1=html.slice(html.indexOf('data-leader-rank="1"'),html.indexOf('data-leader-rank="3"'));
assert.doesNotMatch(card1,/data-leader-part="prize_label"/);
assert.doesNotMatch(card1,/data-leader-part="score"/);
assert.match(card1,/data-leader-part="prize"/);
assert.match(card1,/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.gif/);
assert.match(card1,/left:20%;top:25%;width:40%;height:35%/);
assert.ok(html.includes('data-leader-rank="4"'));
console.log('Leaderboard display and per-rank podium editor passed.');
