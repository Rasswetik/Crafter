/* Event Page Studio viewer. Renders the exact block order and rank typography
   saved for this event. Uses the shared Ice banner engine for static/GIF banners. */
function crafterEventPageView(main,event,leaders,page){
    const cfg=page||{};
    const style=cfg.style||{};
    const fallback={
        font:'system',heading_font:'rounded',background:'#141414',
        row_bg:'#242229',row_border:'#36313d',text_color:'#f7f5fa',
        score_color:'#bbb6c7',heading_color:'#ffffff',
        heading_size:26,name_size:13,score_size:12,row_radius:14,row_gap:8,
        prize_size:55,rank_count:10,show_empty:true
    };
    const st={...fallback,...style};
    const font=ICE_BANNER_FONTS[st.font]||ICE_BANNER_FONTS.system;
    const headingFont=ICE_BANNER_FONTS[st.heading_font]||ICE_BANNER_FONTS.rounded;
    const declarations={
        '--event-page-bg':st.background,
        '--event-row-bg':st.row_bg,
        '--event-row-border':st.row_border,
        '--event-text':st.text_color,
        '--event-score':st.score_color,
        '--event-heading':st.heading_color,
        '--event-font':font,
        '--event-heading-font':headingFont,
        '--event-heading-size':Math.min(48,Number(st.heading_size)||26)+'px',
        '--event-name-size':Math.min(25,Number(st.name_size)||13)+'px',
        '--event-score-size':Math.min(24,Number(st.score_size)||12)+'px',
        '--event-row-radius':Math.min(35,Number(st.row_radius)||14)+'px',
        '--event-row-gap':Math.min(24,Number(st.row_gap)||8)+'px',
        '--event-prize-size':Math.min(130,Number(st.prize_size)||55)+'px'
    };
    const blocks=Array.isArray(cfg.blocks)&&cfg.blocks.length?cfg.blocks:[
        {id:'header',type:'header',enabled:true},
        {id:'leaderboard',type:'leaderboard',enabled:true,rank_count:st.rank_count}
    ];
    const byRank=new Map(leaders.map(l=>[Number(l.rank),l]));
    const prizes=new Map((event.prizes||[]).map(p=>[Number(p.place),p]));
    const banners=[];
    const renderBlock=(block,index)=>{
        if(block.enabled===false)return '';
        const type=block.type;
        const background=block.background||st.background;
        const padding=Math.min(50,Number(block.padding)||0);
        const radius=Math.min(45,Number(block.radius)||0);
        const styleAttr='background:'+esc(background)+';padding:'+padding+'px;border-radius:'+radius+'px;';
        const color=esc(block.color||st.text_color);
        const fontFamily=esc(ICE_BANNER_FONTS[block.font]||font);
        const align=['left','right','center'].includes(block.align)?block.align:'left';
        const textStyle='font-family:'+fontFamily+';color:'+color+';font-size:'+Math.min(58,Number(block.font_size)||18)+'px;text-align:'+align+';';
        if(type==='header'){
            return '<div class="crafter-event-layout-block crafter-event-layout-header" style="'+styleAttr+'">'+
              '<header class="crafter-event-header"><div class="crafter-event-name">'+
              '<h1>'+esc(event.title)+'</h1>'+
              (event.description?'<p>'+esc(event.description)+'</p>':'')+
              '</div><div class="crafter-event-countdown"><small>До конца</small><b>00:00:00</b></div></header></div>';
        }
        if(type==='timer'){
            return '<div class="crafter-event-layout-block crafter-event-layout-timer" style="'+styleAttr+'">'+
              '<div class="crafter-event-countdown"><small>'+esc(block.text||'До конца')+
              '</small><b>00:00:00</b></div></div>';
        }
        if(type==='banner'){
            banners.push({index,config:block.banner||{}});
            return '<div class="crafter-event-layout-block crafter-event-layout-banner" style="'+styleAttr+'">'+
              '<div class="crafter-event-page-banner" data-event-banner="'+index+'"></div></div>';
        }
        if(type==='text'){
            return '<div class="crafter-event-layout-block crafter-event-layout-text" style="'+styleAttr+'">'+
              '<p style="'+textStyle+'">'+esc(block.text||'')+'</p></div>';
        }
        if(type==='divider'){
            return '<div class="crafter-event-layout-block" style="'+styleAttr+'"><hr class="crafter-event-layout-divider"></div>';
        }
        if(type==='spacer'){
            return '<div class="crafter-event-layout-block" style="height:'+Math.min(160,Number(block.height)||24)+'px"></div>';
        }
        if(type==='leaderboard'){
            if(block.leader_mode&&block.leader_mode!=='classic'){
                return '<div class="crafter-event-layout-block crafter-event-layout-ranks" style="'+styleAttr+'">'+
                  (event.show_leaderboard?crafterLeaderboardHTML(byRank,prizes,block,event,{
                     rowBg:st.row_bg,showEmpty:st.show_empty
                   }):'<p class="crafter-events-empty">Рейтинг скрыт.</p>')+'</div>';
            }
            const maxRank=Math.min(100,Math.max(1,Number(block.rank_count||st.rank_count)||10));
            const rows=Array.from({length:maxRank},(_,i)=>{
                const rank=i+1;
                const player=byRank.get(rank);
                const prize=prizes.get(rank);
                if(!player&&!prize&&!st.show_empty)return '';
                return crafterEventLeader(player,rank,prize);
            }).join('');
            return '<div class="crafter-event-layout-block crafter-event-layout-ranks" style="'+styleAttr+'">'+
              '<div class="crafter-event-rank-list" id="crafter-event-ranking">'+
              (event.show_leaderboard?rows:'<p class="crafter-events-empty">Рейтинг скрыт.</p>')+
              '</div></div>';
        }
        return '';
    };
    const topBanners=blocks.map((block,index)=>block.type==='banner'?renderBlock(block,index):'').join('');
    const rest=blocks.map((block,index)=>block.type==='banner'?'':renderBlock(block,index)).join('');
    main.innerHTML='<section class="crafter-events-page crafter-event-detail crafter-event-custom-layout">'+
      (topBanners?'<div class="crafter-event-top-banners">'+topBanners+'</div>':'')+rest+'</section>';
    const root=main.querySelector('.crafter-event-custom-layout');
    if(!root)return;
    for(const [key,value] of Object.entries(declarations)){
        root.style.setProperty(key,value);
    }
    root.style.setProperty('--event-accent',event.accent||'#9164e9');
    for(const item of banners){
        const target=root.querySelector('[data-event-banner="'+item.index+'"]');
        if(!target)continue;
        const banner={...item.config,start_at:event.start_at,end_at:event.end_at,
            title:item.config.title||event.title};
        iceBannerMount(target,banner,{previewOnly:true,serverTime:Date.now()/1000});
        const destination=banner.link_target||'event';
        if(destination!=='none'){
          const stage=target.querySelector('.ice-banner-stage');
          if(stage){
             stage.tabIndex=0;
             stage.setAttribute('role','link');
             stage.setAttribute('aria-label','Открыть '+(destination==='craft'?'Крафты':destination==='arena'?'Арену':'событие'));
             const open=()=>{
               if(destination==='craft')go('craft');
               else if(destination==='arena')go('arena');
               else go('events',event.id);
             };
             stage.addEventListener('click',open);
             stage.addEventListener('keydown',e=>{
               if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}
             });
          }
        }
    }
    crafterEventStartClock(event);
    if(typeof crafterLoadEventNFTAnimations==='function')crafterLoadEventNFTAnimations(root);
}
