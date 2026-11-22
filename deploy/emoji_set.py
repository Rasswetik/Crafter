"""Prints the emoji of a custom emoji set: the character and its id (public data of the set; the bot token is never printed).

    sudo -u crafter /opt/crafter/.venv/bin/python /opt/crafter/deploy/emoji_set.py [SetName]
"""
import json
import os
import sys
from urllib.request import urlopen

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    for line in open(os.path.join(HERE, '.env'), encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            name, _, value = line.removeprefix('export ').partition('=')
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
                value = value[1:-1]
            os.environ.setdefault(name.strip(), value)
except OSError:
    pass

token = os.getenv('BOT_TOKEN', '')
name = sys.argv[1] if len(sys.argv) > 1 else 'GiftNews_icons'
with urlopen('https://api.telegram.org/bot%s/getStickerSet?name=%s' % (token, name), timeout=20) as response:
    data = json.load(response)
stickers = data.get('result', {}).get('stickers', [])
print('SET', name, 'emoji:', len(stickers))
for sticker in stickers:
    print(sticker.get('emoji', '?'), sticker.get('custom_emoji_id'))
