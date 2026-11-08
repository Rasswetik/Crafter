"""PC Arena/cart/offers/bank and purchase receipt NFT link regression tests."""
from pathlib import Path
import re

import telegram_bot


def test_purchase_notification_contains_validated_direct_telegram_nft(monkeypatch):
    sent = []

    def capture(token, method, payload, sticker=None):
        sent.append((method, payload))

    monkeypatch.setattr(telegram_bot, 'bot_api', capture)
    gift = {
        'name': 'Lucky Locket', 'number': 13826,
        'source_number': 13826,
    }
    telegram_bot.notify_gift_purchase({'token': 'bot-token'}, 44, gift, '14.50', '')
    assert len(sent) == 1
    method, receipt = sent[0]
    assert method == 'sendMessage'
    assert receipt['chat_id'] == 44
    assert receipt['parse_mode'] == 'HTML'
    assert receipt['text'].startswith(
        '✅ Successfully purchased <a href="https://t.me/nft/luckylocket-13826">'
        'Lucky Locket #13826</a> for 14.5 GRAM.'
    )
    assert '<a href="https://t.me/nft/luckylocket-13826">View NFT in Telegram</a>' in receipt['text']
    assert receipt['link_preview_options']['is_disabled']


def test_purchase_notification_reuses_verified_url_or_slug_but_not_fake_data(monkeypatch):
    sent = []
    monkeypatch.setattr(
        telegram_bot, 'bot_api',
        lambda token,method,payload,sticker=None: sent.append(payload)
    )
    telegram_bot.notify_gift_purchase({'token':'x'}, 1, {
        'name': 'A & B <Gift>', 'number': 10,
        'telegram_url': 'https://t.me/nft/realgift-156'
    }, '1', '')
    assert '<a href="https://t.me/nft/realgift-156">A &amp; B &lt;Gift&gt; #10</a>' in sent[-1]['text']

    telegram_bot.notify_gift_purchase({'token':'x'}, 1, {
        'name': 'Test', 'number': 10,
        'telegram_slug': 'test-155',
        'telegram_url': 'https://external.example.com/phish'
    }, '1', '')
    assert 'https://t.me/nft/test-155' in sent[-1]['text']
    assert 'external.example.com' not in sent[-1]['text']

    telegram_bot.notify_gift_purchase({'token':'x'}, 1, {
        'name': 'Fictional Demo', 'number': 99999,
        'telegram_url': 'javascript:alert(1)'
    }, '1', '')
    assert 'View NFT in Telegram' not in sent[-1]['text']
    assert '<a ' not in sent[-1]['text']
    assert 'javascript:' not in sent[-1]['text']


def test_regular_sale_link_and_purchase_link_share_safe_helper(monkeypatch):
    sent = []
    monkeypatch.setattr(
        telegram_bot, 'bot_api',
        lambda token,method,payload,sticker=None: sent.append((method,payload))
    )
    gift = {'name':'Lucky Locket','number':13826,
            'telegram_url':'https://t.me/nft/luckylocket-13826'}
    telegram_bot.notify_gift_sale({'token':'abc'}, 2, gift, '14', '')
    assert sent[0][0] == 'sendMessage'
    assert '<a href="https://t.me/nft/luckylocket-13826">' in sent[0][1]['text']
    assert telegram_bot.verified_nft_link({'name':'Unsafe','number':2}) == ''


def test_arena_has_no_info_button_but_craft_info_is_on_the_right():
    root = Path(__file__).resolve().parent.parent
    page = (root / 'templates/index.html').read_text(encoding='utf-8')
    css = (root / 'static/desktop-final-layout.css').read_text(encoding='utf-8')
    assert 'class="arena-rules-button"' not in page
    assert 'class="info-btn" onclick="craftRules()"' in page
    assert '#app.craft-view > header > .craft-header' in css
    assert '#app.craft-view > header > .balance' in css
    assert 'order:60!important' in css
    assert '#app.arena-view > header > .arena-rules-button' in css


def test_pc_arena_dock_and_gifts_bank_are_not_centered_to_mobile_viewport():
    root = Path(__file__).resolve().parent.parent
    css = (root / 'static/desktop-final-layout.css').read_text(encoding='utf-8')
    assert '@media (min-width:1024px)' in css
    assert '#app.arena-view .arena-page:not(.arena-private-lobby)>.arena-dock' in css
    assert 'position:relative!important' in css
    assert 'bottom:auto!important' in css
    assert 'transform:none!important' in css
    assert '.arena-dock>.arena-modes' in css
    assert '#app #inventory-body .inventory-bank-float' in css
    assert 'right:clamp(20px,2.5vw,48px)!important' in css


def test_desktop_offer_cards_max_six_and_checkout_in_same_toolbar():
    root = Path(__file__).resolve().parent.parent
    css = (root / 'static/desktop-final-layout.css').read_text(encoding='utf-8')
    cart = (root / 'static/cart.js').read_text(encoding='utf-8')
    index = (root / 'templates/index.html').read_text(encoding='utf-8')
    assert 'repeat(5,minmax(0,1fr))' in css
    assert 'repeat(6,minmax(0,1fr))' in css
    assert 'repeat(7,minmax(0,1fr))' not in css
    assert ':has(> .collection-offer-card):not(.list)' in css
    assert 'max-width:1023.98px' in css
    assert 'class="primary cart-pay-top" onclick="payCart()"' in cart
    assert 'id="cart-pay" onclick="payCart()"' in cart
    assert "state.me.demo?'local/cart/buy':'portals/buy'" in cart
    assert 'desktop-final-layout.css' in index
