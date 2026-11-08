"""Desktop basket placement and cart checkout UX regression tests."""
from pathlib import Path

def test_cart_floating_button_is_pinned_to_desktop_right_edge():
    root=Path(__file__).resolve().parent.parent
    css=(root/'static/cart-checkout-fix.css').read_text(encoding='utf-8')
    index=(root/'templates/index.html').read_text(encoding='utf-8')
    assert '#app:not(.cart-view) > #cart-float' in css
    assert 'right:clamp(23px,3vw,48px)!important' in css
    assert 'position:fixed!important' in css
    assert 'bottom:calc(24px + env(safe-area-inset-bottom))!important' in css
    assert 'cart-checkout-fix.css' in index


def test_checkout_button_is_clickable_with_friendly_errors():
    root=Path(__file__).resolve().parent.parent
    s=(root/'static/cart.js').read_text(encoding='utf-8')
    assert 'onclick="payCart()"' in s
    assert "const payDisabled=!chosen.length||pending;" in s
    assert "state.cartError=state.cartBalanceError;" in s
    assert "Баланс ещё обновляется." in s
    assert "Недостаточно средств: не хватает" in s
    assert 'class="cart-top-feedback" role="status"' in s
    assert "if(state.page==='cart')renderCart()" in s
    assert "(thermos?'thermos/buy':'portals/buy')" in s


def test_checkout_new_styles_dont_hide_top_action_or_mobile_checkout():
    root=Path(__file__).resolve().parent.parent
    css=(root/'static/cart-checkout-fix.css').read_text(encoding='utf-8')
    original=(root/'static/desktop-final-layout.css').read_text(encoding='utf-8')
    assert '#app.cart-view #main .cart-tools .cart-pay-top' in css
    assert '#app.cart-view #main .cart-tools .cart-pay-top:disabled' in css
    assert '.cart-top-feedback' in css
    assert '@media(max-width:1023.98px)' in css
    assert '#app.cart-view #main .cart-checkout #cart-pay{display:none!important}' in original
