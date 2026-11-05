"""Independent, configurable layouts for Crafter event pages.

Every event owns a JSON layout. Image/GIF assets are uploaded through the existing
Ice banner media endpoint, so no arbitrary HTML, CSS, JS or URLs are accepted.
"""
import json
import re
import uuid
from flask import request, abort

EVENT_ID=re.compile(r'^[0-9a-f]{32}$')
HEX=re.compile(r'^#[a-fA-F0-9]{6}$')
ASSET=re.compile(r'^/media/ice-banner/[0-9a-f]{32}\.(gif|webp)$')
FONTS={'system','rounded','mono','serif','condensed','heavy','bold',
       'geometric','clean','classic','display','futuristic'}
BLOCKS={'header','banner','text','timer','leaderboard','spacer','divider'}
LAYERS={'title','text','timer','image','gram'}


def num(value,low,high,default):
    try: value=float(value)
    except (ValueError, TypeError, OverflowError): value=float(default)
    return max(low,min(high,value))


def color(value,default):
    return value if isinstance(value,str) and HEX.fullmatch(value) else default


def default_page():
    return {
        'style':{'background':'#141414','row_bg':'#242229','row_border':'#36313d',
                 'text_color':'#f7f5fa','score_color':'#bbb6c7','heading_color':'#ffffff',
                 'font':'system','heading_font':'rounded',
                 'heading_size':26,'name_size':13,'score_size':12,
                 'row_radius':14,'row_gap':8,'prize_size':55,
                 'rank_count':10,'show_empty':True},
        'blocks':[
            {'id':'header','type':'header','enabled':True,
             'padding':8,'background':'#141414','radius':0},
            {'id':'leaderboard','type':'leaderboard','enabled':True,
             'padding':0,'background':'#141414','radius':0,
             'rank_count':10},
        ]
    }


def clean_layer(layer):
    if not isinstance(layer,dict):
        abort(400, description='Слой баннера должен быть объектом')
    typ=layer.get('type','text')
    if typ not in LAYERS:
        abort(400, description='Неизвестный тип слоя')
    asset=layer.get('asset','')
    if not isinstance(asset,str) or (asset and not ASSET.fullmatch(asset)):
        abort(400, description='Недопустимый файл слоя')
    return {
        'id':str(layer.get('id','') or uuid.uuid4().hex)[:40],
        'type':typ,'text':str(layer.get('text',''))[:140],
        'x':round(num(layer.get('x'),0,100,5),1),
        'y':round(num(layer.get('y'),0,100,5),1),
        'w':round(num(layer.get('w'),3,100,45),1),
        'h':round(num(layer.get('h'),3,100,70),1),
        'font':layer.get('font','rounded') if layer.get('font') in FONTS else 'rounded',
        'font_size':int(num(layer.get('font_size'),10,72,24)),
        'font_weight':int(num(layer.get('font_weight'),400,900,800)),
        'stroke_width':round(num(layer.get('stroke_width'),0,3,0),1),
        'color':color(layer.get('color'),'#ffffff'),
        'bg_color':color(layer.get('bg_color'),'#ffffff'),
        'bg_opacity':round(num(layer.get('bg_opacity'),0,1,0),2),
        'radius':int(num(layer.get('radius'),0,90,0)),
        'align':layer.get('align','center') if layer.get('align') in ('left','center','right') else 'center',
        'format':layer.get('format','hh:mm:ss') if layer.get('format') in ('hh:mm:ss','mm:ss','days') else 'hh:mm:ss',
        'asset':asset,'fit':layer.get('fit') if layer.get('fit') in ('cover','contain') else 'contain',
        'z':int(num(layer.get('z'),0,99,1)),
    }


def clean_banner(data):
    if not isinstance(data,dict): data={}
    bg_asset=data.get('background_asset','')
    if not isinstance(bg_asset,str) or (bg_asset and not ASSET.fullmatch(bg_asset)):
        abort(400,description='Недопустимый фон баннера')
    incoming=data.get('layers',[])
    if not isinstance(incoming,list) or len(incoming)>20:
        abort(400,description='В баннере допускается до 20 элементов')
    return {
        'title':str(data.get('title',''))[:90],
        'height':int(num(data.get('height'),70,280,112)),
        'width_pct':int(num(data.get('width_pct'),50,100,100)),
        'radius':int(num(data.get('radius'),0,60,18)),
        'background_color':color(data.get('background_color'),'#124a67'),
        'background_second_color':color(data.get('background_second_color'),'#51c1e7'),
        'background_mode':data.get('background_mode') if data.get('background_mode') in ('solid','gradient','image') else 'gradient',
        'background_asset':bg_asset,
        'background_fit':data.get('background_fit') if data.get('background_fit') in ('cover','contain') else 'cover',
        'background_tint':round(num(data.get('background_tint'),0,.9,0),2),
        'background_focus_x':int(num(data.get('background_focus_x'),0,100,50)),
        'background_focus_y':int(num(data.get('background_focus_y'),0,100,50)),
        'layers':[clean_layer(layer) for layer in incoming],
    }


def clean_page(data):
    if not isinstance(data,dict):abort(400,description='Отправьте настройки страницы')
    raw_style=data.get('style',{})
    if not isinstance(raw_style,dict):abort(400,description='Ошибка стиля')
    default=default_page()['style']
    style={key:color(raw_style.get(key),default[key]) for key in
           ('background','row_bg','row_border','text_color','score_color','heading_color')}
    for key in ('font','heading_font'):
        style[key]=raw_style.get(key) if raw_style.get(key) in FONTS else default[key]
    for key,low,high in (('heading_size',16,48),('name_size',10,25),('score_size',10,24),
                         ('row_radius',0,35),('row_gap',0,24),('prize_size',24,130),
                         ('rank_count',1,100)):
        style[key]=int(num(raw_style.get(key),low,high,default[key]))
    style['show_empty']=raw_style.get('show_empty') is not False
    blocks=data.get('blocks',[])
    if not isinstance(blocks,list) or len(blocks)>24:
        abort(400,description='Можно добавить до 24 блоков')
    cleaned=[]
    seen=set()
    for block in blocks:
        if not isinstance(block,dict) or block.get('type') not in BLOCKS:
            abort(400,description='Некорректный блок страницы')
        bid=str(block.get('id',''))[:40] or uuid.uuid4().hex
        if bid in seen:abort(400,description='Повторяющийся идентификатор блока')
        seen.add(bid)
        typ=block['type']
        safe={
            'id':bid,'type':typ,'enabled':block.get('enabled') is not False,
            'padding':int(num(block.get('padding'),0,50,0)),
            'radius':int(num(block.get('radius'),0,45,0)),
            'background':color(block.get('background'),style['background']),
            'text':str(block.get('text',''))[:600],
            'color':color(block.get('color'),style['text_color']),
            'font':block.get('font') if block.get('font') in FONTS else style['font'],
            'font_size':int(num(block.get('font_size'),10,58,18)),
            'height':int(num(block.get('height'),8,160,22)),
            'align':block.get('align') if block.get('align') in ('left','center','right') else 'left',
            'rank_count':int(num(block.get('rank_count'),1,100,style['rank_count'])),
            'banner':clean_banner(block.get('banner')) if typ=='banner' else None,
        }
        cleaned.append(safe)
    if not cleaned:
        cleaned=default_page()['blocks']
    return {'style':style,'blocks':cleaned}


def install_event_pages(app,db,auth,audit):
    with db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_event_pages (
                event_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
        """)

    def validated(event_id,admin=False):
        if not EVENT_ID.fullmatch(event_id):abort(404)
        row=db().execute('SELECT id,start_at,end_at,enabled FROM crafter_events WHERE id=?',(event_id,)).fetchone()
        if not row or (not admin and not row['enabled']):abort(404)
        return row

    def load(event_id):
        row=db().execute('SELECT payload FROM crafter_event_pages WHERE event_id=?',(event_id,)).fetchone()
        if row:
            try:
                return {**default_page(),**json.loads(row['payload'])}
            except (ValueError, TypeError):
                pass
        return default_page()

    @app.get('/api/events/<event_id>/page')
    def public_event_page(event_id):
        validated(event_id)
        response=app.json.response({'page':load(event_id)})
        response.headers['Cache-Control']='no-store'
        return response

    @app.get('/api/admin/events/<event_id>/page')
    @auth(admin=True)
    def admin_event_page(event_id):
        validated(event_id,True)
        return {'page':load(event_id)}

    @app.post('/api/admin/events/<event_id>/page')
    @auth(admin=True)
    def save_event_page(event_id):
        validated(event_id,True)
        config=clean_page(request.get_json(silent=True))
        payload=json.dumps(config,ensure_ascii=False,separators=(',',':'))
        if len(payload)>200_000:abort(413,description='Макет страницы слишком большой')
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('INSERT INTO crafter_event_pages VALUES(?,?) '
                         'ON CONFLICT(event_id) DO UPDATE SET payload=excluded.payload',
                         (event_id,payload))
        audit('Crafter event page layout saved')
        return {'page':config}
