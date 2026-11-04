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
        const candidate = Number(gift.floor_price ?? gift.price);
        const price = Number.isFinite(candidate) && candidate > 0 ? candidate : null;
        if (!existing) {
            const collection = kind === 'collection'
                ? state.catalog?.collections?.find(row =>
                    String(row.id) === String(gift.collection_id) ||
                    String(row.name).toLowerCase() === String(gift.name).toLowerCase())
                : null;
            existing = {
                value,
                name: kind === 'collection' ? String(collection?.name || gift.name || value) : value,
                image: imageURL(gift.image) || imageURL(collection?.photo_url) || '/static/assets/amulet.webp',
                background: kind === 'backdrop' ? giftBackdrop(gift) : '',
                price,
                unit: String(gift.price_unit || collection?.price_unit || 'GRAM'),
                count: 0,
            };
            groups.set(value, existing);
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
