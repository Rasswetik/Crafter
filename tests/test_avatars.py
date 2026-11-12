import avatars


def test_fallback_points_real_players_to_the_proxy():
    assert avatars.fallback(5, 'https://x/y.jpg') == 'https://x/y.jpg'
    assert avatars.fallback(5, '') == '/media/avatar/5'
    assert avatars.fallback(0, None) == ''
    assert avatars.fallback(-3, None) == ''
