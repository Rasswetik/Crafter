let marketBannerData;
let marketBannersRequest;

function loadMarketBanners() {
    if (!marketBannersRequest) {
        marketBannersRequest = api('banners').then(data => {
            marketBannerData = data;
            paintMarketBanners();
        }).catch(() => { marketBannersRequest = null; });
    }
}

function paintMarketBanners() {
    if (state.page !== 'market' || state.collectionPage || marketActivityVisible()) return;
    const main = document.querySelector('#main');
    if (!main.querySelector('.search') || main.querySelector('.banner-carousel') || !marketBannerData?.banners.length) return;
    main.prepend(makeBannerCarousel(marketBannerData.banners, marketBannerData.carousel, openMarketBanner));
}

const marketBeforeBanners = renderMarket;
renderMarket = function () {
    marketBeforeBanners();
    paintMarketBanners();
    loadMarketBanners();
};

async function openMarketBanner(banner) {
    switch (banner.action) {
        case 'link':
            if (tg?.initData && tg.openLink) tg.openLink(banner.target);
            else window.open(banner.target, '_blank', 'noopener,noreferrer');
            break;
        case 'collection': {
            await state.catalogReady;
            const collection = state.catalog.collections.find(item => String(item.id) === banner.target ||
                item.short_name === banner.target || giftCollectionSlug(item.name) === banner.target);
            if (collection) await openCollectionPage(collection);
            else toast('Коллекция недоступна');
            break;
        }
        case 'gifts':
        case 'offers':
        case 'history':
            state.inventoryTab = banner.action;
            state.picked.clear();
            await go('gifts');
            break;
        case 'referrals':
            await go('profile');
            document.querySelector('.portal-referrals')?.scrollIntoView({block: 'start'});
            break;
        case 'activity':
            toggleMarketActivity();
            break;
        case 'lucky':
            await openBannerLuckyCraft();
            break;
        case 'gift-deposit':
            openGiftDeposit();
            break;
        case 'craft-rules':
            craftRules();
            break;
        case 'settings':
            crafterOpenSettings();
            break;
        case 'staking-rules':
        case 'stake-gifts':
            await go('staking');
            if (state.page !== 'staking' || !stakeUi.status) break;
            if (banner.action === 'staking-rules') stakingRules();
            else if (!stakeUi.status.enabled) toast('Стейкинг временно отключён');
            else if (stakeUi.status.activated) openStakeGiftPicker();
            else showStakingTutorial();
            break;
        case 'games':
        case 'arena':
        case 'events':
        case 'staking':
        case 'market':
        case 'craft':
        case 'profile':
        case 'wallet':
            await go(banner.action);
            break;
    }
}

async function openBannerLuckyCraft() {
    await state.catalogReady;
    if (state.page !== 'market') return;
    const gifts = state.gifts.filter(gift => gift.number && !gift.catalog_only && !gift.own_listing && (gift.resale || giftCollection(gift)));
    sheet('Lucky Craft', `<p class="sub">Выберите лот, который хотите скрафтить.</p>
        <div class="banner-lucky-gifts">${gifts.length ? gifts.map(gift =>
            `<button class="catalog-row" onclick="chooseLuckyGift(${arg(gift.id)})">
                ${transferArt(gift)}<strong>${esc(gift.name)} #${esc(gift.number)}</strong>
                <b>${money(gift.price)} ${currencyHTML(gift)}</b>
            </button>`).join('') : '<p class="sub">Среди текущих лотов нет подарков для Lucky Craft.</p>'}</div>`);
}
