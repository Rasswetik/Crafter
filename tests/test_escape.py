"""Escape's virtual balance and full-shard animation are independent of real GRAM."""
import sqlite3
from pathlib import Path

import pytest

from test_app import client, signed


def launch(client, stake='5.00', difficulty='light', request_id='escape-first-round-1'):
    return client.post('/api/escape/play', headers=signed(43), json={
        'stake': stake, 'difficulty': difficulty, 'request_id': request_id,
    })


def test_escape_first_visit_creates_separate_virtual_balance(client):
    before = client.get('/api/me', headers=signed(43))
    assert before.status_code == 200
    real_before = before.json['balance']
    response = client.get('/api/escape/state', headers=signed(43))
    assert response.status_code == 200, response.json
    state = response.json
    assert state['demo'] is True
    assert state['balance'] == '1000.00'
    assert state['currency'] == 'TEST GRAM'
    assert set(state['difficulties']) == {'light', 'mid', 'epic'}
    assert state['best_day'] is None
    assert state['best_week'] is None
    assert client.get('/api/me', headers=signed(43)).json['balance'] == real_before
    with sqlite3.connect(client.application.config['DATABASE']) as conn:
        assert conn.execute('SELECT balance_cents FROM escape_test_wallets WHERE user_id=43').fetchone() == (100000,)


def test_escape_winning_shards_and_payout_are_determined_before_animation(client, monkeypatch):
    before = client.get('/api/me', headers=signed(43)).json['balance']
    monkeypatch.setattr('escape.secrets.randbelow', lambda n: 0)
    response = launch(client)
    assert response.status_code == 200, response.json
    result = response.json
    assert result['demo']
    assert result['success']
    assert result['difficulty'] == 'light'
    assert result['shards'] == 6
    assert len(result['steps']) == 6
    assert [stage['multiplier'] for stage in result['steps']] == [
        '0.20x','0.40x','0.60x','0.80x','1.00x','1.20x'
    ]
    assert all(stage['safe'] for stage in result['steps'])
    assert result['steps'][-1]['exit'] is True
    assert [stage['sector_bps'] for stage in result['steps']] == sorted(
        [stage['sector_bps'] for stage in result['steps']], reverse=True)
    assert result['multiplier'] == '1.20x'
    assert result['payout'] == '6.00'
    assert result['balance'] == '1001.00'
    info = client.get('/api/escape/state', headers=signed(43)).json
    assert info['best_day']['payout'] == '6.00'
    assert info['best_week']['multiplier'] == '1.20x'
    assert info['recent'][0]['id'] == result['id']
    assert client.get('/api/me', headers=signed(43)).json['balance'] == before


def test_escape_loss_and_idempotent_retry_cannot_double_charge(client, monkeypatch):
    before = client.get('/api/me', headers=signed(43)).json['balance']
    monkeypatch.setattr('escape.secrets.randbelow', lambda n: n-1)
    response = launch(client, difficulty='epic')
    assert response.status_code == 200, response.json
    result = response.json
    assert not result['success']
    assert result['shards'] == 1
    assert result['steps'][0]['multiplier'] == '0.55x'
    assert not result['steps'][0]['safe']
    assert result['payout'] == '0.00'
    assert result['balance'] == '995.00'
    repeated = launch(client, difficulty='epic')
    assert repeated.status_code == 200
    assert repeated.json['id'] == result['id']
    assert repeated.json['balance'] == '995.00'
    assert launch(client, stake='6.00', difficulty='epic').status_code == 409
    assert launch(client, stake='5.00', difficulty='mid').status_code == 409
    assert client.get('/api/me', headers=signed(43)).json['balance'] == before
    with sqlite3.connect(client.application.config['DATABASE']) as conn:
        assert conn.execute('SELECT count(*) FROM escape_test_rounds').fetchone() == (1,)
        assert conn.execute('SELECT balance_cents FROM escape_test_wallets WHERE user_id=43').fetchone() == (99500,)


def test_escape_rapid_rounds_and_difficulties_share_only_test_balance(client, monkeypatch):
    client.get('/api/me', headers=signed(43))
    monkeypatch.setattr('escape.secrets.randbelow', lambda n: n-1)
    results = []
    for number,mode in enumerate(('light','mid','epic','light','mid'), 1):
        response = launch(client, '7.50', mode, f'escape-separate-round-{number}')
        assert response.status_code == 200, response.json
        results.append(response.json)
    assert len({r['id'] for r in results}) == 5
    assert all(not r['success'] for r in results)
    assert results[-1]['balance'] == '962.50'
    assert client.get('/api/escape/state', headers=signed(43)).json['balance'] == '962.50'
    assert client.get('/api/escape/state', headers=signed(44)).json['balance'] == '1000.00'
    with sqlite3.connect(client.application.config['DATABASE']) as conn:
        assert conn.execute('SELECT count(*) FROM escape_test_rounds').fetchone() == (5,)


@pytest.mark.parametrize(('stake','difficulty'), [
    ('0','light'), ('-5','light'), ('0.01','mid'), ('12.123','mid'),
    ('501','epic'), ('nan','epic'), (12.5,'light'),
    ('20','nonsense'), ('20',123),
])
def test_escape_rejects_invalid_wagers_and_modes(client, stake, difficulty):
    response = launch(client, stake, difficulty, 'escape-invalid-one-1')
    assert response.status_code == 400
    assert client.get('/api/escape/state', headers=signed(43)).json['balance'] == '1000.00'


def test_escape_reset_only_after_test_balance_is_exhausted(client):
    client.get('/api/escape/state', headers=signed(43))
    assert client.post('/api/escape/test-balance/reset', headers=signed(43),json={}).status_code == 409
    with sqlite3.connect(client.application.config['DATABASE']) as conn:
        conn.execute('UPDATE escape_test_wallets SET balance_cents=0 WHERE user_id=43')
    refill = client.post('/api/escape/test-balance/reset', headers=signed(43),json={})
    assert refill.status_code == 200
    assert refill.json['balance'] == '1000.00'
    assert refill.json['demo'] is True


def test_escape_screen_has_concurrent_balls_and_no_upgrade():
    root = Path(__file__).resolve().parent.parent
    js = (root / 'static/escape.js').read_text(encoding='utf-8')
    css = (root / 'static/escape.css').read_text(encoding='utf-8')
    hub = (root / 'static/staking.js').read_text(encoding='utf-8')
    html = (root / 'templates/index.html').read_text(encoding='utf-8')
    backend = (root / 'escape.py').read_text(encoding='utf-8')
    assert 'escape-hub-tile' in hub and "go('escape')" in hub
    assert "go('upgrade')" not in hub
    assert 'enterEscape(main)' in hub
    assert '/static/escape.js' in html and '/static/escape.css' in html
    assert '/static/upgrade.js' not in html and '/static/upgrade.css' not in html
    assert not (root / 'upgrade.py').exists()
    assert 'active: new Map()' in js
    assert 'escapeGame.active.set(result.id,track)' in js
    assert '0x' in js and 'escape-ball-label' in js
    assert 'escape-wheel-rotor' in js and 'escape-wheel-arc' in css
    assert 'conic-gradient(from 180deg' in css
    assert 'light' in backend and 'mid' in backend and 'epic' in backend
    assert 'escape_test_wallets' in backend and 'escape_test_rounds' in backend
