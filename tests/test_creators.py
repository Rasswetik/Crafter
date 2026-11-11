from test_app import client  # noqa: F401


def test_creators_page_shows_rates_rules_and_is_not_indexed(client):
    response = client.get('/creators')
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert response.headers['X-Robots-Tag'] == 'noindex, nofollow'
    for text in ('1,25 $', '0,90 $', '0,65 $', '0,15 $', 'Не оплачиваются', 'Администрация вправе отказать', 'не менее 25%', 'Скриншоты не принимаются'):
        assert text in page
    assert 'startapp=creators' not in client.get('/').get_data(as_text=True)          # no link to it from the application
    assert '/static/creators-link.js' in client.get('/').get_data(as_text=True)


def test_creators_rates_math():
    from decimal import Decimal
    import creators
    rates = {key: rate for key, _, _, rate in creators.RATES}
    assert rates['tg'] == Decimal('1.25') and creators.money(rates['tg'] * 10) == '12,50'
    import math
    assert math.ceil(creators.MIN_PAYOUT / rates['tg'] * 1000) == 8000


def test_my_applications_page_is_separate_and_hidden(client):
    response = client.get('/creators/my')
    assert response.status_code == 200 and response.headers['X-Robots-Tag'] == 'noindex, nofollow'
    page = response.get_data(as_text=True)
    assert 'id="mlist"' in page and 'creators-my.js' in page
    info = client.get('/creators').get_data(as_text=True)
    assert 'id="my-body"' not in info and 'apply-open' in info and 'href="/creators/my"' in info
