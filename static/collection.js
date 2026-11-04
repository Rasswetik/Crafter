const baseCollectionMarket = renderMarket;
renderMarket = function () {
    baseCollectionMarket();
    const page = state.collectionPage;
    if (!page) return;
    const template = document.querySelector('#collection-screen');
    const section = template.content.firstElementChild.cloneNode(true);
    section.querySelector('h1').textContent = page.name;
    if (!page.bannerEntered) {
        section.querySelector('.collection-banner').classList.add('collection-banner-enter');
        page.bannerEntered = true;
    }
    const thumb = section.querySelector('.collection-thumbnail');
    const slug = giftCollectionSlug(page.name);
    const image = imageURL(page.photo_url);
    thumb.src = image || fragmentCollectionImage(slug);
    thumb.onerror = () => {
        const fallback = fragmentCollectionImage(slug);
        if (fallback && thumb.src !== fallback) thumb.src = fallback;
        else thumb.hidden = true;
    };
    if (page.overview) {
        const {collection, volume_24h, volume_total} = page.overview;
        section.querySelector('[data-volume="24h"]').textContent = money(volume_24h) + ' GRAM';
        section.querySelector('[data-volume="total"]').textContent = money(volume_total) + ' GRAM';
        if (Number(collection.floor_price) > 0) {
            section.querySelector('[data-collection-floor]').textContent =
                money(collection.floor_price) + ' ' + (collection.price_unit || 'TON');
        }
        section.querySelector('.collection-banner-art').innerHTML = page.banner.map(model =>
            `<img ${giftPicture({name: page.name, model: model.name, image: model.image}, true)} alt="">`).join('');
    }
    document.querySelector('#main').prepend(section);
    if (page.banner.length && !page.modelsEntered) {
        page.modelsEntered = new Set();
    }
    section.querySelectorAll('.collection-banner-art img').forEach((model, index) => {
        const reveal = () => {
            if (!model.isConnected || !model.naturalWidth || page.modelsEntered.has(index)) return;
            page.modelsEntered.add(index);
            model.classList.add('collection-model-enter');
        };
        model.addEventListener('load', reveal);
        if (model.complete) reveal();
    });
};

const goWithoutCollection = go;
go = async function (page) {
    if (state.crafting) return;
    if (state.page === 'profile' && page !== 'profile' && !giftAnimationMotion.matches) {
        const main = document.querySelector('#main');
        main.classList.add('profile-leaving');
        await new Promise(resolve => setTimeout(resolve, 170));
        main.classList.remove('profile-leaving');
    }
    if (state.collectionPage) {
        const saved = state.collectionPage.marketView;
        state.collectionPage = null;
        if (state.page === 'market') {
            Object.assign(state, saved);
            saveView();
        }
        if (location.pathname.startsWith('/collections/')) window.history.replaceState(null, '', '/');
    }
    await goWithoutCollection(page);
    document.querySelector('#main').classList.toggle('profile-entered', state.page === 'profile');
};

function closeCollectionPage() {
    go('market');
}

async function openGiftCollection(gift = state.detailGift, fromSheet = true) {
    if (!gift) return;
    await state.catalogReady;
    if (fromSheet && (state.detailGift !== gift || !appSheet.open)) return;
    const collection = giftCollection(gift) || {id: gift.collection_id || giftCollectionSlug(gift.name), name: gift.name};
    if (fromSheet) closeSheet();
    await openCollectionPage(collection);
}

async function openCollectionPage(collection, updateUrl = true) {
    restoreViews();
    if (state.page === 'market' && viewHydrated) saveView();
    const marketView = state.collectionPage?.marketView || {
        query:'', collection:'', model:'', backdrop:'', symbol:'', order:'listed_at desc',
        minPrice:'', maxPrice:'', list:false, ...views.market,
    };
    const page = {...collection, marketView, overview: null, banner: []};
    const filter = {
        ...marketView, collection: collection.id, query:'', model:'', backdrop:'', symbol:'', minPrice:'', maxPrice:'',
    };
    state.collectionPage = page;
    views.market = filter;
    if (state.page === 'market') Object.assign(state, filter);
    if (updateUrl) window.history.pushState({crafterCollection: true}, '', '/collections/' + encodeURIComponent(collection.id));

    const overview = api('collections/' + encodeURIComponent(collection.id) + '/overview').then(data => {
        if (state.collectionPage !== page) return;
        page.overview = data;
        page.name = data.collection.name;
        page.photo_url = data.collection.photo_url;
        const models = data.models.filter(model => model.name);
        for (let index = 0; index < 2 && models.length; index++) {
            page.banner.push(models.splice(Math.floor(Math.random() * models.length), 1)[0]);
        }
        if (state.page === 'market' && document.querySelector('#gifts-grid')) renderMarket();
    }).catch(() => {});
    await goWithoutCollection('market');
    await overview;
}

window.addEventListener('popstate', () => {
    if (state.collectionPage && !location.pathname.startsWith('/collections/')) closeCollectionPage();
    else if (location.pathname.startsWith('/collections/')) openCollectionFromUrl();
});

async function openCollectionFromUrl() {
    const match = /^\/collections\/([^/]+)$/.exec(location.pathname);
    if (!match) return false;
    let slug;
    try { slug = decodeURIComponent(match[1]); } catch { return false; }
    await state.catalogReady;
    const collection = state.catalog.collections.find(item =>
        String(item.id) === slug || giftCollectionSlug(item.name) === slug);
    if (!collection) return false;
    await openCollectionPage(collection, false);
    return true;
}
