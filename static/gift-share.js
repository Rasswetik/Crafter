/* NFT gift toolbar icons and Telegram Mini App collectible deep links.
 * startapp=gift_<slug>-<number> is a view-only reference; users cannot use it
 * to bypass purchase verification. Listing links use the real server endpoint.
 */
function crafterGiftEyeSVG() {
    return '<svg viewBox="0 0 14 10" width="18" height="15" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M2.9327 1.49099C4.0559 0.68177 5.4556 0 7 0C8.54441 0 9.9441 0.68177 11.0673 1.49099C12.1946 2.30314 13.087 3.27496 13.6272 3.92789L13.6317 3.93342C13.873 4.23362 14 4.61404 14 5.00006C14 5.38607 13.873 5.7665 13.6317 6.0667L13.6272 6.07223C13.087 6.72515 12.1946 7.69698 11.0673 8.5091C9.9441 9.3183 8.54441 10.0001 7 10.0001C5.4556 10.0001 4.0559 9.3183 2.9327 8.5091C1.80544 7.69698 0.913028 6.72515 0.37279 6.07223L0.36828 6.0667C0.127025 5.7665 0 5.38607 0 5.00006C0 4.61404 0.127025 4.23362 0.36828 3.93342L0.37279 3.92789C0.913028 3.27496 1.80544 2.30314 2.9327 1.49099ZM7 7.25C8.24264 7.25 9.25 6.24264 9.25 5C9.25 3.75736 8.24264 2.75 7 2.75C5.75736 2.75 4.75 3.75736 4.75 5C4.75 6.24264 5.75736 7.25 7 7.25Z" fill="currentColor"/></svg>';
}
function crafterGiftShareSVG() {
    return '<svg viewBox="0 0 21 20" width="20" height="20" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M16.5714 7.85714C18.7411 7.85714 20.5 6.09826 20.5 3.92857C20.5 1.75889 18.7411 0 16.5714 0C14.4017 0 12.6429 1.75889 12.6429 3.92857C12.6429 3.99104 12.6443 4.05317 12.6472 4.11493L6.93221 6.97241C6.25244 6.40964 5.38 6.07143 4.42857 6.07143C2.25889 6.07143 0.5 7.83031 0.5 10C0.5 12.1697 2.25889 13.9286 4.42857 13.9286C5.38 13.9286 6.25244 13.5904 6.93221 13.0276L12.6472 15.8851C12.6443 15.9469 12.6429 16.009 12.6429 16.0714C12.6429 18.2411 14.4017 20 16.5714 20C18.7411 20 20.5 18.2411 20.5 16.0714C20.5 13.9017 18.7411 12.1429 16.5714 12.1429C15.4967 12.1429 14.5227 12.5745 13.8134 13.2738L8.32196 10.5281C8.34516 10.3554 8.35714 10.1791 8.35714 10C8.35714 9.82093 8.34516 9.64464 8.32196 9.47193L13.8134 6.72621C14.5227 7.42554 15.4967 7.85714 16.5714 7.85714Z" fill="currentColor"/></svg>';
}
function crafterLuckyActionSVG() {
    // Small, crisp diagonal crafting pickaxe rather than the previous generic anvil.
    return '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.8 4.1C11 3 7 4.4 4.2 7.4c4.1-.8 7.1.5 8.9 2.4"/><path d="M17.4 4.5 20.9 8"/><path d="M18.9 2.9 22.5 6.4"/><path d="M16.3 7.8 6.8 17.3"/><path d="M5.5 17.4 3.2 19.7l1.1 1.1 2.3-2.3"/></svg>';
}
function crafterShareBotBase() {
    const invite=String(state.me?.invite_link || '');
    const match=invite.match(/^https:\/\/(?:t\.me|telegram\.me)\/([a-z][a-z0-9_]{4,31})(?:[/?#]|$)/i);
    return match ? 'https://t.me/'+match[1] : '';
}
function crafterGiftShareParam(gift) {
    const link=telegramGiftLink(gift);
    const nft=link.match(/^https:\/\/t\.me\/nft\/([a-z0-9]+-[1-9][0-9]*)$/i);
    if (nft && ('nft_'+nft[1]).length<=64) return 'nft_'+nft[1];
    if (gift.resale && /^[a-z0-9_-]{1,55}$/i.test(gift.id || '')) return 'lot_'+gift.id;
    return '';
}
function openGiftTelegramView() {
    const gift=state.detailGift;
    const link=gift && telegramGiftLink(gift);
    if (!link) return toast('У подарка нет подтверждённой ссылки Telegram NFT');
    if (tg?.openTelegramLink) tg.openTelegramLink(link);
    else window.open(link,'_blank','noopener,noreferrer');
}
async function shareDetailGift() {
    const gift=state.detailGift;
    if (!gift) return;
    const bot=crafterShareBotBase();
    const token=crafterGiftShareParam(gift);
    if (!bot) return toast('Для отправки ссылки укажите BOT_USERNAME в настройках Crafter');
    if (!token) return toast('Этот подарок пока нельзя открыть по публичной ссылке');
    const miniApp=bot+'?startapp='+encodeURIComponent(token);
    const label=gift.name+(gift.number?' #'+gift.number:'');
    const share='https://t.me/share/url?url='+encodeURIComponent(miniApp)+
        '&text='+encodeURIComponent('🎁 '+label+' — view this gift on Crafter');
    try {
        if (tg?.openTelegramLink) tg.openTelegramLink(share);
        else window.open(share,'_blank','noopener,noreferrer');
    } catch {
        try { await navigator.clipboard.writeText(miniApp);toast('Ссылка на подарок скопирована'); }
        catch { toast('Не удалось открыть меню отправки Telegram'); }
    }
}
function crafterGiftFromParam(raw) {
    if (!/^(?:nft|lot)_[a-z0-9_-]{1,60}$/i.test(raw || '') || raw.length>64) return null;
    if (raw.startsWith('lot_')) return {kind:'lot', id:raw.slice(4)};
    const nft=raw.slice(4).match(/^([a-z0-9]+)-([1-9][0-9]*)$/i);
    return nft ? {kind:'nft',slug:nft[1].toLowerCase(),number:nft[2]} : null;
}
function crafterIncomingShare() {
    let raw='';
    try {
        raw=String(tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('tgWebAppStartParam') || '');
    } catch {}
    return crafterGiftFromParam(raw);
}
function crafterSameCollectible(gift,ref) {
    if (!gift || !ref || ref.kind!=='nft') return false;
    const slug=String(gift.name||'').normalize('NFKD').replace(/[^a-z0-9]/gi,'').toLowerCase();
    return slug===ref.slug && String(gift.source_number ?? gift.number ?? '')===ref.number;
}
async function crafterOpenSharedGift(ref) {
    if (!ref || state.crafting) return;
    if (ref.kind === 'lot') {
        try {
            const result=await api('resale/listings/'+encodeURIComponent(ref.id));
            if (result?.gift) { showGiftDetail(result.gift,'market');return; }
        } catch {}
        return toast('Лот уже продан или снят с продажи');
    }
    const cached=[...(state.gifts||[]),...(state.inventory||[])];
    let gift=cached.find(x=>crafterSameCollectible(x,ref));
    if (!gift) {
        const found=await Promise.allSettled([
            api('inventory'),
            api('market?search='+encodeURIComponent(ref.number)+'&offset=0'),
        ]);
        for(let i=0;i<found.length;i++){
            const result=found[i];
            if(result.status!=='fulfilled')continue;
            gift=(result.value.gifts||[]).find(x=>crafterSameCollectible(x,ref));
            if(gift)break;
        }
    }
    if(gift) {
        const own=(state.inventory||[]).some(x=>x.id===gift.id);
        showGiftDetail(gift, own ? 'inventory' : 'market');
        return;
    }
    // The original listing might have been removed. Still open the collectible
    // info sheet, but never offer a purchase without a fresh server listing.
    if(state.catalogReady)await state.catalogReady.catch(()=>{});
    const collection=(state.catalog?.collections||[]).find(c =>
        String(c.name||'').replace(/[^a-z0-9]/gi,'').toLowerCase()===ref.slug);
    const name=collection?.name || ref.slug;
    showGiftDetail({
        id:'preview-'+ref.slug+'-'+ref.number, name,number:ref.number,
        source_number:ref.number, image:collection?.photo_url || '/static/assets/amulet.webp',
        telegram_url:'https://t.me/nft/'+ref.slug+'-'+ref.number,
        catalog_only:true,model:'',symbol:'',backdrop:'',floor_price:0
    },'history');
}
const crafterOriginalBoot=boot;
boot=async function() {
    const incoming=crafterIncomingShare();
    await crafterOriginalBoot();
    if (incoming && state.me && state.page!=='admin') {
        await crafterOpenSharedGift(incoming);
    }
};
