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
    preferences=(root/'static/preferences.js').read_text(encoding='utf-8')
    assert 'crafterAddProfileSettings' in preferences
    assert 'crafter-open-settings' in preferences
    assert 'profile-settings-button' not in profile


def test_admin_action_history_and_cancellation_sections_are_visible():
    root=Path(__file__).resolve().parent.parent
    admin=(root/'static/admin-page.js').read_text(encoding='utf-8')
    console=(root/'static/admin-console-ui.js').read_text(encoding='utf-8')
    assert "audit:        {label:'История действий'" in admin
    assert "cancellations:{label:'Управление отменами'" in admin
    assert 'renderAdminCancellations(' in console
    assert 'Не удалось получить журнал:' in console


def test_event_banner_delete_is_real_and_admin_only(client):
    owner=signed(42)
    visitor=signed(43)
    client.get('/api/me',headers=owner)
    for kind in ('craft','arena'):
        path=f'/api/admin/{kind}/banner/delete'
        assert client.post(path,headers=visitor,json={}).status_code==403
        response=client.post(path,headers=owner,json={})
        assert response.status_code==200,response.json
        assert response.json['ok'] is True
        loaded=client.get(f'/api/admin/{kind}/banner',headers=owner)
        assert loaded.status_code==200
        assert loaded.json['banner']['enabled'] is False
        public=client.get(f'/api/{kind}/banner')
        assert public.status_code==200
        assert public.json['banner'] is None


def test_hidden_craft_event_banner_is_not_replaced_by_a_fake_placeholder():
    root=Path(__file__).resolve().parent.parent
    client=(root/'static/arena-banner.js').read_text(encoding='utf-8')
    editor=(root/'static/ice-banner-admin.js').read_text(encoding='utf-8')
    assert "if(!response.banner)" in client
    assert "const config=response.banner||{" not in client
    assert 'data-ice-delete' in editor
    assert "banner/delete" in editor


def test_postgres_history_query_does_not_use_ambiguous_null_placeholders():
    root=Path(__file__).resolve().parent.parent
    source=(root/'admin_user_tools.py').read_text(encoding='utf-8')
    assert 'WHERE (? IS NULL OR user_id=?)' not in source
    assert 'if uid is None:' in source
    assert 'WHERE user_id=? ORDER BY created DESC LIMIT ?' in source
