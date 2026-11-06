"""Per-place layout persist and exact Ice Arena banner copy permissions."""
import json
import sqlite3
import time
from test_app import client,signed


def test_rank_customizer_sanitizes_positions_and_preserves_other_ranks(client):
    admin=signed()
    now=int(time.time())
    response=client.post('/api/admin/events',headers=admin,data={
        'title':'Test leaders','description':'','metric':'craft_wins',
        'start_at':str(now-100),'end_at':str(now+600),'accent':'#9164e9',
        'sort_order':'10','enabled':'1','show_leaderboard':'1',
        'prizes_json':'[]'
    })
    assert response.status_code==200,response.json
    event_id=response.json['id']
    page={
        'style':{'background':'#141414'},
        'blocks':[{'id':'rank-board','type':'leaderboard','enabled':True,
            'rank_count':10,'leader_mode':'podium',
            'leader_fields':{'name':True,'avatar':True,'prize':True,'prize_label':False},
            'leader_row_height':92,'leader_podium_height':270,
            'leader_podium_width':86,'leader_podium_gap':12,'leader_podium_style':'royal',
            'rank_styles':{
                '1':{
                    'hidden':['prize_label'],
                    'avatar_asset':'/media/ice-banner/'+'a'*32+'.webp',
                    'prize_asset':'/media/ice-banner/'+'b'*32+'.gif',
                    'layout':{'prize':{'x':28,'y':35,'w':36,'h':35}},
                    'background':'#221133','order':2,
                    'caption':'Champion','height':300,
                    'width_pct':84,'step_height':115
                },
                '2':{'hidden':['name'],'order':1}
            }}]
    }
    save=client.post('/api/admin/events/'+event_id+'/page',headers=admin,json=page)
    assert save.status_code==200,save.json
    block=save.json['page']['blocks'][0]
    assert block['leader_mode']=='podium'
    assert block['leader_podium_width']==86
    assert block['leader_podium_gap']==12
    assert block['leader_podium_style']=='royal'
    assert block['rank_styles']['1']['width_pct']==84
    assert block['rank_styles']['1']['step_height']==115
    assert block['rank_styles']['1']['layout']['prize']=={'x':28.0,'y':35.0,'w':36.0,'h':35.0}
    assert block['rank_styles']['1']['prize_asset'].endswith('b'*32+'.gif')
    assert block['rank_styles']['2']['hidden']==['name']
    assert block['leader_fields']['prize_label'] is False
    public=client.get('/api/events/'+event_id+'/page')
    assert public.status_code==200
    assert public.json['page']['blocks'][0]['rank_styles']==block['rank_styles']
    assert client.get('/api/admin/events/'+event_id+'/leaders',headers=admin).status_code==200
    assert client.get('/api/admin/events/'+event_id+'/leaders',headers=signed(43)).status_code==403
    bad={**page,'blocks':[{**page['blocks'][0],
         'rank_styles':{'1':{'prize_asset':'https://evil.example/nft.png'}}}]}
    assert client.post('/api/admin/events/'+event_id+'/page',headers=admin,json=bad).status_code==400


def test_copy_ice_banner_to_craft_includes_layers_and_media(client):
    from arena_banner import CONFIG_KEY,CRAFT_KEY,default_banner
    source=default_banner('arena')
    source.update(enabled=False,title='Snow Hunt',width_pct=86,height=211,
      background_mode='image',
      background_asset='/media/ice-banner/'+'c'*32+'.gif',
      layers=[{**source['layers'][0], 'text':'Snow event' }])
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO ice_banner_assets(id,mime,body,created_at) VALUES(?,?,?,?)",
                   ('c'*32,'image/gif',b'GIF89a',int(time.time())))
        db.execute("INSERT INTO settings(key,payload) VALUES(?,?)",
                   (CONFIG_KEY,json.dumps(source)))
    endpoint='/api/admin/craft/banner/copy-arena'
    assert client.post(endpoint,headers=signed(43),json={}).status_code==403
    response=client.post(endpoint,headers=signed(),json={})
    assert response.status_code==200,response.json
    copied=response.json['banner']
    assert copied['width_pct']==86 and copied['height']==211
    assert copied['background_asset']==source['background_asset']
    assert copied['layers'][0]['text']=='Snow event'
    assert client.get('/api/admin/craft/banner',headers=signed()).json['banner']==copied
    assert client.get('/api/admin/arena/banner',headers=signed()).json['banner']['title']=='Snow Hunt'
