"""Public fallback must not mislabel TON quotes as Portals partner prices."""
from test_app import client,signed

def test_public_market_uses_actual_fallback_and_source_currency(client,monkeypatch):
    import thermos
    monkeypatch.setattr(thermos,'collections',lambda:[{
        'id':'snoop','short_name':'snoop','name':'Snoop Dogg',
        'photo_url':'/static/assets/snoop.webp','floor_price':'3.25','price_unit':'TON'}])
    monkeypatch.setattr(thermos,'gifts',lambda params,rows:{
        'gifts':[{'id':'source-gift-1','name':'Snoop Dogg',
                  'collection_id':'snoop','model':'Emerald','price':'4.50',
                  'price_unit':'TON','number':14,'image':'/static/assets/snoop.webp'}],
        'total':1,'source':'thermos','price_unit':'TON','demo':False})
    response=client.get('/api/market',headers=signed())
    assert response.status_code==200,response.json
    data=response.json
    assert data['market_price_source']=='thermos'
    assert data['market_price_unit']=='TON'
    assert data['gifts'][0]['source_price_unit']=='TON'
    assert data['gifts'][0]['source_price']=='4.50'
    assert data['purchase_mode']=='local'
    assert 'Partner API' in data['warning']
