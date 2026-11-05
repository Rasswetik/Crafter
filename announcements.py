"""Configurable in-app announcements (interstitials), with per-user visit frequency."""
import json
import re
import time
import uuid
from flask import request,abort,g

HEX=re.compile(r'^#[0-9a-fA-F]{6}$')
ASSET=re.compile(r'^/media/ice-banner/[0-9a-f]{32}\.(?:gif|webp)$')
ID=re.compile(r'^[0-9a-f]{32}$')
FONT={'system','rounded','display','heavy','bold','geometric','clean',
      'classic','mono','serif','condensed','futuristic'}


def within(value,lo,hi,default):
    try:value=float(value)
    except (ValueError,TypeError,OverflowError):value=float(default)
    return max(lo,min(hi,value))


def valid_color(value,default):
    return value if isinstance(value,str) and HEX.fullmatch(value) else default


def announcement_defaults():
    return {
        'id':'','enabled':False,
        'title':'Новое событие Crafter',
        'description':'Участвуйте в новых событиях и получайте награды.',
        'button_text':'Перейти','button_url':'',
        'media':'','frequency':4,'close_delay':3,
        'max_width':420,'media_height':290,'position':'center',
        'background_color':'#242326','title_color':'#ffffff',
        'description_color':'#b7b2c0','button_color':'#168bff','button_text_color':'#ffffff',
        'title_font':'rounded','description_font':'system',
        'title_size':23,'description_size':13,'radius':27,'blur':8,
        'start_at':0,'end_at':0
    }


def clean(data):
    if not isinstance(data,dict):abort(400,description='Передайте настройки анонса')
    default=announcement_defaults()
    result=dict(default)
    for key,limit in [('title',100),('description',650),('button_text',45)]:
        result[key]=str(data.get(key,default[key])).strip()[:limit]
    if not result['title']:abort(400,description='Добавьте заголовок')
    url=str(data.get('button_url','')).strip()
    if url:
        if not (re.fullmatch(r'https://[A-Za-z0-9._~:/?#\[\]@!$&\'()*+,;=%-]{3,1000}',url) or
                re.fullmatch(r'/(?!/)[a-zA-Z0-9/_?=&%-]{1,200}',url)):
            abort(400,description='Кнопка принимает ссылку https:// или путь внутри сайта')
    result['button_url']=url
    media=data.get('media','') or ''
    if not isinstance(media,str) or (media and not ASSET.fullmatch(media)):
        abort(400,description='Загрузите PNG/GIF через редактор')
    result['media']=media
    result['enabled']=data.get('enabled') is True
    result['position']=data.get('position') if data.get('position') in ('center','bottom') else 'center'
    for key in ('background_color','title_color','description_color','button_color','button_text_color'):
        result[key]=valid_color(data.get(key),default[key])
    for key in ('title_font','description_font'):
        result[key]=data.get(key) if data.get(key) in FONT else default[key]
    for key,lo,hi in [('frequency',3,5),('close_delay',1,12),('max_width',290,560),
                      ('media_height',120,520),('title_size',14,45),
                      ('description_size',10,23),('radius',0,45),('blur',0,20)]:
        result[key]=int(within(data.get(key,default[key]),lo,hi,default[key]))
    for key in ('start_at','end_at'):
        result[key]=int(within(data.get(key),0,4102444800,0))
    if result['end_at'] and result['start_at'] and result['end_at']<=result['start_at']:
        abort(400,description='Дата окончания должна быть позднее начала')
    return result


def install_announcements(app,db,auth,audit):
    with db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_announcements (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS crafter_announcement_visits (
                user_id INTEGER NOT NULL,
                announcement_id TEXT NOT NULL,
                visits INTEGER NOT NULL DEFAULT 0,
                last_shown INTEGER NOT NULL DEFAULT 0,
                last_entry INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(user_id,announcement_id)
            );
        """)

    def read_all():
        result=[]
        for row in db().execute('SELECT id,payload,updated_at FROM crafter_announcements ORDER BY updated_at DESC'):
            try:
                data=json.loads(row['payload'])
                if isinstance(data,dict):
                    result.append({**announcement_defaults(),**data,'id':row['id'],
                                   'updated_at':row['updated_at']})
            except (ValueError,TypeError):continue
        return result

    @app.get('/api/admin/announcements')
    @auth(admin=True)
    def list_announcements():
        return {'announcements':read_all()}

    @app.post('/api/admin/announcements')
    @auth(admin=True)
    def save_announcement():
        data=request.get_json(silent=True)
        config=clean(data)
        item_id=data.get('id') if isinstance(data,dict) else ''
        if item_id and not ID.fullmatch(item_id):abort(400,description='Неверный ID')
        if not item_id:
            if len(read_all())>=20:abort(409,description='Не более 20 анонсов')
            item_id=uuid.uuid4().hex
        config['id']=item_id
        now=int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('INSERT INTO crafter_announcements VALUES(?,?,?) '
                         'ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
                         (item_id,json.dumps(config,ensure_ascii=False),now))
        audit('Crafter interstitial announcement saved')
        return {'announcement':config}

    @app.post('/api/admin/announcements/<item_id>/delete')
    @auth(admin=True)
    def delete_announcement(item_id):
        if not ID.fullmatch(item_id):abort(404)
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('DELETE FROM crafter_announcement_visits WHERE announcement_id=?',(item_id,))
            if not db().execute('DELETE FROM crafter_announcements WHERE id=?',(item_id,)).rowcount:
                abort(404)
        audit('Crafter announcement deleted')
        return {'ok':True}

    @app.post('/api/announcements/entry')
    @auth()
    def entry():
        uid=int(g.user['id'])
        now=int(time.time())
        eligible=[]
        for ann in read_all():
            if not ann['enabled']:continue
            if ann['start_at'] and now<ann['start_at']:continue
            if ann['end_at'] and now>=ann['end_at']:continue
            eligible.append(ann)
        if not eligible:return {'announcement':None}
        chosen=None
        with db():
            db().execute('BEGIN IMMEDIATE')
            for ann in eligible:
                row=db().execute('SELECT visits,last_shown,last_entry FROM crafter_announcement_visits '
                                 'WHERE user_id=? AND announcement_id=?',(uid,ann['id'])).fetchone()
                # Avoid counting several same-session reloads as new visits.
                if row and now-int(row['last_entry'])<30:
                    continue
                visits=int(row['visits'])+1 if row else 1
                first=not row or not row['last_shown']
                should_show=first or visits>=ann['frequency']
                if should_show and chosen is None:
                    chosen=ann
                    visits=0
                    shown=now
                else:
                    shown=int(row['last_shown']) if row else 0
                db().execute('INSERT INTO crafter_announcement_visits VALUES(?,?,?,?,?) '
                             'ON CONFLICT(user_id,announcement_id) DO UPDATE SET '
                             'visits=excluded.visits,last_shown=excluded.last_shown,last_entry=excluded.last_entry',
                             (uid,ann['id'],visits,shown,now))
        return {'announcement':chosen}
