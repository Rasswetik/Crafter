"""Relayer account: send an ordinary Telegram gift (paid with the relayer's Stars) to a Crafter user (MTProto).

Used only by the automatic star-gift withdrawal (star_gifts.py). The caller persists a "sending" state in
`before_send` immediately before the payment is submitted; a send whose outcome is unknown is never repeated.
"""
from telethon.errors import RPCError
from telethon.tl import functions, types

from telegram_deposits import with_client


class LowBalance(Exception):
    """The relayer has fewer Stars than the gift costs. Nothing was sent."""

    def __init__(self, have, need):
        super().__init__('not enough Stars')
        self.have, self.need = int(have), int(need)


class GiftUnavailable(Exception):
    """Telegram does not offer this gift now (sold out or removed). Nothing was sent."""


class Unresolvable(Exception):
    """The recipient cannot be reached by the relayer. Nothing was sent."""


class Rejected(Exception):
    """Telegram refused the request before charging. Nothing was sent."""


def stars_of(status):
    amount = getattr(status, 'balance', None)
    amount = getattr(amount, 'amount', amount)
    return int(amount or 0)


def alt_of(gift):
    for attribute in getattr(getattr(gift, 'sticker', None), 'attributes', None) or ():
        alt = getattr(attribute, 'alt', None)
        if alt:
            return str(alt)
    return ''


def strip_variation(value):
    return str(value or '').replace('️', '').strip()


def pick(gifts, stars, emoji):
    """The ordinary (unlimited, not sold out) Telegram gift with this price and emoji."""
    candidates = [x for x in gifts if getattr(x, 'id', None) and int(getattr(x, 'stars', 0) or 0) == int(stars)
                  and not getattr(x, 'limited', False) and not getattr(x, 'sold_out', False)]
    exact = [x for x in candidates if strip_variation(alt_of(x)) == strip_variation(emoji)]
    return exact[0] if exact else None


async def available(client):
    result = await client(functions.payments.GetStarGiftsRequest(hash=0))
    return list(getattr(result, 'gifts', None) or [])


def by_emoji(gifts, emoji):
    found = [x for x in gifts if getattr(x, 'id', None) and not getattr(x, 'limited', False) and not getattr(x, 'sold_out', False)
             and strip_variation(alt_of(x)) == strip_variation(emoji)]
    return found[0] if found else None


def to_png(data, size=512):
    """Telegram sends WebP/JPEG previews; the site stores PNG."""
    from io import BytesIO
    from PIL import Image
    image = Image.open(BytesIO(data)).convert('RGBA')
    image.thumbnail((size, size))
    out = BytesIO()
    image.save(out, 'PNG', optimize=True)
    return out.getvalue()


async def preview_png(client, gift):
    """The gift sticker's static preview as PNG, or None (animated stickers carry only a thumbnail)."""
    document = getattr(gift, 'sticker', None)
    if document is None:
        return None
    for thumb in (-1, 0):
        try:
            data = await client.download_media(document, file=bytes, thumb=thumb)
            if data:
                return to_png(data)
        except Exception:
            continue
    return None


async def sync(api_id, api_hash, session, wanted):
    """Stars balance plus, for every wanted (key, stars, emoji): Telegram's gift id, current price and a PNG preview."""
    async def run(client):
        balance = stars_of(await client(functions.payments.GetStarsStatusRequest(peer=types.InputPeerSelf())))
        gifts = await available(client)
        found = {}
        for key, stars, emoji in wanted:
            gift = by_emoji(gifts, emoji)
            if gift is not None:
                found[key] = {'tg_id': int(gift.id), 'stars': int(getattr(gift, 'stars', 0) or stars), 'png': await preview_png(client, gift)}
        return {'stars': balance, 'gifts': found}
    return await with_client(api_id, api_hash, session, run)


async def stars_balance(api_id, api_hash, session):
    async def run(client):
        return stars_of(await client(functions.payments.GetStarsStatusRequest(peer=types.InputPeerSelf())))
    return await with_client(api_id, api_hash, session, run)


async def check(api_id, api_hash, session, wanted):
    """{'stars': balance, 'gifts': {key: bool}} for wanted = [(key, stars, emoji)]."""
    async def run(client):
        balance = stars_of(await client(functions.payments.GetStarsStatusRequest(peer=types.InputPeerSelf())))
        gifts = await available(client)
        return {'stars': balance, 'gifts': {key: pick(gifts, stars, emoji) is not None for key, stars, emoji in wanted}}
    return await with_client(api_id, api_hash, session, run)


async def send(api_id, api_hash, session, to_user_id, to_username, stars, emoji, text, before_send, tg_id=None):
    async def run(client):
        try:
            try:
                peer = await client.get_input_entity(int(to_user_id))
            except ValueError:
                if not to_username:
                    raise
                peer = await client.get_input_entity(to_username)
        except (ValueError, RPCError) as error:
            raise Unresolvable('recipient cannot be resolved') from error
        offered = await available(client)
        gift = next((x for x in offered if tg_id and int(x.id) == int(tg_id) and not getattr(x, 'sold_out', False)), None) or pick(offered, stars, emoji)
        if gift is None:
            raise GiftUnavailable(emoji)
        have = stars_of(await client(functions.payments.GetStarsStatusRequest(peer=types.InputPeerSelf())))
        if have < int(stars):
            raise LowBalance(have, stars)
        invoice = types.InputInvoiceStarGift(
            peer=peer, gift_id=int(gift.id), hide_name=False,
            message=types.TextWithEntities(text=str(text)[:250], entities=[]))
        try:
            form = await client(functions.payments.GetPaymentFormRequest(invoice=invoice))
        except RPCError as error:
            if 'BALANCE_TOO_LOW' in str(error):
                raise LowBalance(have, stars) from error
            raise Rejected(type(error).__name__) from error
        before_send()                      # from here on the outcome may be unknown
        await client(functions.payments.SendStarsFormRequest(form_id=form.form_id, invoice=invoice))
        return True
    return await with_client(api_id, api_hash, session, run)
