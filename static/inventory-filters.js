/* Inventory-only filters, sourced exclusively from real user-owned gifts. */
const marketplaceCatalogSheet = openCatalogSheet;

function ownedFilterGifts() {
    return (state.inventory || []).filter(gift =>
        gift && gift.status !== 'staked' && !gift.catalog_only);
}

function ownedFilterCollectionMatch(gift, selected = state.collection) {
    if (!selected) return true;
    return selectedCollections(selected).some(value =>
        String(gift.collection_id || gift.name) === value ||
        String(gift.name) === value);
}

function ownedCatalogChoices(kind) {
    const all = ownedFilterGifts();
    const gifts = kind === 'collection' ? all :
        all.filter(gift => ownedFilterCollectionMatch(gift));
    const groups = new Map();
    const property = kind === 'collection' ? 'collection_id' : kind;
    for (const gift of gifts) {
        const value = kind === 'collection'
            ? String(gift.collection_id || gift.name || '').trim()
            : String(gift[property] || '').trim();
        if (!value) continue;
        let existing = groups.get(value);
        const collection = state.catalog?.collections?.find(row =>
            String(row.id) === String(gift.collection_id) ||
            String(row.name).toLowerCase() === String(gift.name).toLowerCase());
        // A sale price is not a floor price. Show only a confirmed floor snapshot.
        const hasCatalogFloor = kind === 'collection' && Number(collection?.floor_price) > 0;
        const candidate = hasCatalogFloor ? Number(collection.floor_price) : Number(gift.floor_price);
        const price = Number.isFinite(candidate) && candidate > 0 ? candidate : null;
        if (!existing) {
            existing = {
                value,
                name: kind === 'collection' ? String(collection?.name || gift.name || value) : value,
                // The collection filter uses official collection artwork,
                // never the first owned gift's randomly chosen model PNG.
                image: kind === 'collection'
                    ? imageURL(collection?.photo_url) || fragmentCollectionImage(giftCollectionSlug(gift.name))
                    : '', // Never show a complete NFT as a standalone model/symbol.
                background: kind === 'backdrop' ? giftBackdrop(gift) : '',
                collection_name: kind !== 'collection' ? gift.name : '',
                price,
                unit: hasCatalogFloor
                    ? String(collection.price_unit || (['thermos','snapshot'].includes(state.catalog?.source) ? 'TON' : 'GRAM'))
                    : String(gift.price_unit || 'GRAM'),
                count: 0,
            };
            groups.set(value, existing);
        }
        if (kind !== 'collection' && existing.collection_name !== gift.name) {
            // Same attribute name across multiple gift collections is ambiguous.
            existing.collection_name = '';
        }
        existing.count++;
        if (price !== null && (existing.price === null || price < existing.price)) {
            existing.price = price;
        }
    }
    return [...groups.values()].sort((a, b) =>
        a.name.localeCompare(b.name, 'ru', {sensitivity: 'base'}));
}

openCatalogSheet = async function(kind) {
    if (state.page !== 'gifts' || !['collection','model','backdrop','symbol'].includes(kind)) {
        return marketplaceCatalogSheet(kind);
    }
    const titles = {collection:'Коллекция',model:'Модель',backdrop:'Фон',symbol:'Символ'};
    state.catalogRows = ownedCatalogChoices(kind);
    state.sheetKind = kind;
    state.sheetValue = state[kind] || '';
    sheet(titles[kind], `<label class="catalog-search search-box">
        ${icon('search')}<input type="search" placeholder="Быстрый поиск" aria-label="Быстрый поиск"
            oninput="renderCatalogRows(this.value)">
        </label>
        <div class="catalog-columns">
            <span>${titles[kind].toUpperCase()}</span>
            <button type="button" class="target-order" onclick="toggleTargetOrder()">ФЛОР ↓</button>
        </div>
        <div id="catalog-rows" class="catalog-rows"></div>
        <div class="catalog-footer">
            <button type="button" onclick="resetCatalogDraft()">Сбросить</button>
            <button type="button" class="apply" onclick="applyCatalogFilter()">Применить</button>
        </div>`);
    document.querySelector('#sheet').classList.add('catalog-sheet');
    state.targetOrder = 'desc';
    sortTargets();
};
