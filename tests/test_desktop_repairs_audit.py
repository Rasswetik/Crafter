"""Desktop layout and robust admin audit-history regressions."""
import sqlite3
from pathlib import Path
from test_app import client, signed


def test_admin_history_handles_non_dict_legacy_payloads(client):
    h=signed(42)
    assert client.get('/api/me',headers=h).status_code==200
    values=('[]','null','"legacy"','{"gifts":[]}','{"gifts":[null]}',
            '{"gift":"not-a-dict"}','{"gifts":3}','{}')
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        for i,value in enumerate(values):
            db.execute("INSERT INTO history(user_id,kind,payload,created) VALUES(?,?,?,?)",
                       (42,'legacy',value,1794149000+i))
    response=client.get('/api/admin/logs?limit=200',headers=h)
    assert response.status_code==200,response.json
    assert sum(row['kind']=='legacy' for row in response.json['items']
               if row.get('type')=='history')==len(values)


def test_desktop_grid_never_exceeds_seven_and_mobile_stays_separate():
    root=Path(__file__).resolve().parent.parent
    css=(root/'static/desktop-repairs.css').read_text(encoding='utf-8')
    banners=(root/'static/market-banners.js').read_text(encoding='utf-8')
    page=(root/'templates/index.html').read_text(encoding='utf-8')
    profile=(root/'static/screens.js').read_text(encoding='utf-8')
    assert 'repeat(7,minmax(0,1fr))' in css
    assert 'repeat(11,minmax(0,1fr))' not in css
    assert 'grid-template-columns:repeat(3,minmax(0,1fr))' in css
    assert 'grid.list' in css and 'grid-template-columns:106px minmax(0,1fr)' in css
    assert 'banners.slice(0,3)' in banners
    assert 'desktop-repairs.css' in page
    assert 'if(state.gamesMode)return renderGamesProfile()' not in profile
    assert 'profile-settings-button' in profile


def test_admin_action_history_and_cancellation_sections_are_visible():
    root=Path(__file__).resolve().parent.parent
    admin=(root/'static/admin-page.js').read_text(encoding='utf-8')
    console=(root/'static/admin-console-ui.js').read_text(encoding='utf-8')
    assert "audit:        {label:'История действий'" in admin
    assert "cancellations:{label:'Управление отменами'" in admin
    assert 'renderAdminCancellations(' in console
    assert 'Не удалось получить журнал:' in console
