"""Relayer account: move a collectible gift it owns to a Crafter user (MTProto).

Used only by the automatic NFT withdrawal pipeline (auto_nft.py), which persists a
"sending" stage BEFORE calling transfer() and never repeats a transfer whose outcome is
unknown. Paid transfers (Stars) are never paid automatically: they raise NeedsPayment.
"""
import time

from telethon.errors import RPCError
from telethon.tl import functions, types

from telegram_deposits import with_client


class NotReady(Exception):
    def __init__(self, retry_at):
        super().__init__('gift cannot be transferred yet')
        self.retry_at = int(retry_at)


class NeedsPayment(Exception):
    pass


class GiftNotFound(Exception):
    pass


class TransferRejected(Exception):
    """Telegram refused the request; nothing was transferred."""


def match(entry, slug=None, title=None, number=None):
    gift = getattr(entry, 'gift', None)
    if gift is None or getattr(entry, 'refunded', False):
        return False
    if slug:
        return str(getattr(gift, 'slug', '') or '').lower() == str(slug).lower()
    return (str(getattr(gift, 'title', '') or '').strip().lower() == str(title or '').strip().lower()
            and int(getattr(gift, 'num', 0) or 0) == int(number or 0))


async def saved_gifts(client):
    records, offset = [], ''
    for _ in range(100):
        result = await client(functions.payments.GetSavedStarGiftsRequest(
            peer=types.InputPeerSelf(), offset=offset, limit=100, exclude_hosted=True))
        records.extend(result.gifts)
        nxt = getattr(result, 'next_offset', None)
        if not nxt or nxt == offset:
            return records
        offset = nxt
    raise ValueError('Too many gifts on the relayer account')


async def held_slugs(api_id, api_hash, session):
    """Lower-cased slugs of every collectible gift the relayer account currently holds."""
    async def run(client):
        return {str(e.gift.slug).lower() for e in await saved_gifts(client)
                if getattr(e, 'gift', None) is not None and getattr(e.gift, 'slug', None) and not getattr(e, 'refunded', False)}
    return await with_client(api_id, api_hash, session, run)


async def entry_by_slug(api_id, api_hash, session, slug):
    """The relayer's saved-gift entry of this unique gift (slug like PlushPepe-1234), or None."""
    async def run(client):
        for entry in await saved_gifts(client):
            if match(entry, slug=slug):
                return entry
        return None
    return await with_client(api_id, api_hash, session, run)


async def find_on_relayer(api_id, api_hash, session, slug=None, title=None, number=None):
    """Return the Telegram slug of a matching gift held by the relayer, or None."""
    async def run(client):
        for entry in await saved_gifts(client):
            if match(entry, slug, title, number):
                return str(entry.gift.slug)
        return None
    return await with_client(api_id, api_hash, session, run)


async def transfer(api_id, api_hash, session, slug, to_user_id, to_username=''):
    async def run(client):
        entry = next((e for e in await saved_gifts(client) if match(e, slug=slug)), None)
        if entry is None or not getattr(entry, 'msg_id', None):
            raise GiftNotFound(slug)
        ready_at = getattr(entry, 'can_transfer_at', None)
        if ready_at and int(ready_at) > time.time():
            raise NotReady(ready_at)
        if getattr(entry, 'transfer_stars', None):
            raise NeedsPayment(slug)             # never spend Stars automatically
        try:
            try:
                peer = await client.get_input_entity(int(to_user_id))
            except ValueError:
                if not to_username:
                    raise
                peer = await client.get_input_entity(to_username)
        except (ValueError, RPCError) as error:
            raise TransferRejected('recipient cannot be resolved') from error
        try:
            await client(functions.payments.TransferStarGiftRequest(
                stargift=types.InputSavedStarGiftUser(msg_id=int(entry.msg_id)), to_id=peer))
        except RPCError as error:
            if 'PAYMENT_REQUIRED' in str(error):
                raise NeedsPayment(slug) from error
            raise TransferRejected(type(error).__name__) from error
        return True
    return await with_client(api_id, api_hash, session, run)
