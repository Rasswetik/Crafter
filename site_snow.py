"""One global, administrator-controlled snow effect for all Crafter pages."""
import json
from flask import abort, request

SNOW_KEY='global_snowfall_v1'
DEFAULT={'enabled':True,'density':'normal','speed':'normal','size':'normal'}
ALLOWED={'density':{'light','normal','heavy'},
         'speed':{'slow','normal','fast'},
         'size':{'small','normal','large'}}

def install_snow(app,db,auth,audit):
    # One-time seasonal restoration requested by the site owner. Respect all
    # subsequent admin toggles; do not force snow on every restart.
    with app.app_context(), db():
        marker='restore_winter_snow_20261108'
        if not db().execute('SELECT 1 FROM settings WHERE key=?',(marker,)).fetchone():
            row=db().execute('SELECT payload FROM settings WHERE key=?',(SNOW_KEY,)).fetchone()
            if row:
                try: current=json.loads(row['payload'])
                except (ValueError,TypeError): current={}
                if not isinstance(current,dict): current={}
                current['enabled']=True
                db().execute('UPDATE settings SET payload=? WHERE key=?',
                             (json.dumps(current,ensure_ascii=False),SNOW_KEY))
            db().execute('INSERT INTO settings VALUES(?,?)',(marker,'{"restored":true}'))
    def read_snow():
        row=db().execute('SELECT payload FROM settings WHERE key=?',(SNOW_KEY,)).fetchone()
        if row:
            try:
                data=json.loads(row['payload'])
                if isinstance(data,dict):
                    return {
                        'enabled':data.get('enabled') is True,
                        **{key:(data.get(key) if data.get(key) in choices else DEFAULT[key])
                           for key,choices in ALLOWED.items()},
                    }
            except (ValueError,TypeError):
                pass
        return dict(DEFAULT)

    @app.get('/api/site/snow')
    def site_snow():
        resp=app.json.response(read_snow())
        resp.headers['Cache-Control']='public, max-age=20'
        return resp

    @app.post('/api/admin/site/snow')
    @auth(admin=True)
    def save_site_snow():
        data=request.get_json(silent=True)
        if not isinstance(data,dict) or type(data.get('enabled')) is not bool:
            abort(400,description='Выберите включение или выключение снега')
        for key,choices in ALLOWED.items():
            if data.get(key) not in choices:
                abort(400,description='Проверьте параметры снега: '+key)
        config={'enabled':data['enabled'],**{key:data[key] for key in ALLOWED}}
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload',
                         (SNOW_KEY,json.dumps(config,ensure_ascii=False)))
        audit('Global snowfall settings changed')
        return {'snow':config}
