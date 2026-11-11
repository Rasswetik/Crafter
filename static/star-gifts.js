// Ordinary Telegram gifts (Bear, Rose ...): priced in GRAM (100 Stars = 1 GRAM), sold to the site or withdrawn by the relayer.
(function () {
    const gramText = value => money(value) + ' GRAM';

    const originalCard = card;
    card = function (gift, action) {
        let html = originalCard(gift, action).replace('<small>Минимальная цена</small>', '<small>Мин. цена</small>');
        if (gift && gift.star_gift) return html.replace('<p class="number">#</p>', '<p class="number">' + esc(gift.stars) + ' ★</p>');
        if (gift && gift.pack_item && !gift.resale && gift.status !== 'listed') {      // a pack in the inventory: price line as for any other gift
            const floor = productFloor(gift);
            const value = floor.endsWith(' GRAM') ? esc(floor.slice(0, -5)) + ' ' + gramIcon() : esc(floor);
            html = html.replace('<b style="margin:0 auto">' + esc(gift.model || '') + '</b>', '<small>Мин. цена</small><b>' + value + '</b>');
        }
        return html;
    };

    // Ordinary Telegram gifts are not for the market: never draw them there, and never offer them as collections.
    const isStar = g => g && (g.star_gift || String(g.collection_id || '').startsWith('stargift-'));
    const drawMarket = renderMarket;
    renderMarket = function () {
        if (Array.isArray(state.gifts)) state.gifts = state.gifts.filter(g => !isStar(g));
        if (state.catalog && Array.isArray(state.catalog.collections)) state.catalog.collections = state.catalog.collections.filter(c => !String(c.id || '').startsWith('stargift-'));
        return drawMarket.apply(this, arguments);
    };

    const originalFloor = productFloor;
    productFloor = function (gift) {
        if (gift && gift.star_gift) return gramText(gift.price);
        const text = originalFloor(gift);
        // The site counts in GRAM: a floor quoted in TON is shown converted, with the GRAM icon.
        const match = /^([\d\s.,]+)\s*TON$/.exec(String(text).trim());
        const ratio = Number(state?.me?.new_year_gram_per_ton || 0);
        if (match && ratio > 0) {
            const ton = Number(match[1].replace(/\s/g, '').replace(',', '.'));
            if (Number.isFinite(ton) && ton > 0) return money(ton * ratio) + ' GRAM';
        }
        return text;
    };

    // A gift that is being withdrawn (NFT or ordinary): show where the request stands and, if it failed, why.
    function showWithdrawalStatus(gift) {
        state.detailGift = gift;
        sheet('', `
            <div class="portal-product owned-gift-product star-gift-product">
                <img ${giftPicture(gift, true)} alt="${esc(gift.name)}" decoding="async">
                <div><h2>${esc(gift.name)}</h2><span>${gift.star_gift ? esc(gift.stars) + ' ★' : gift.number ? '#' + esc(gift.number) : ''}</span></div>
            </div>
            <div class="product-properties"><div><span>Вывод</span><strong id="wd-status">Загружаем статус…</strong></div></div>
            <div class="ny-footnote" id="wd-note">Если вывод не получится, подарок вернётся в «Мои подарки», а причина появится в истории и придёт сообщением от бота.</div>`);
        document.querySelector('#sheet')?.classList.add('purchase-sheet');
        let stopped = false;
        const paint = async () => {
            if (stopped || !document.querySelector('#wd-status')) { stopped = true; return; }
            try {
                const data = await api('gifts/withdrawals');
                const row = (data.items || []).find(item => item.gift_id === gift.id);
                const box = document.querySelector('#wd-status');
                if (!box) return;
                box.textContent = row ? row.text : 'Заявка обрабатывается';
                const holder = document.querySelector('#wd-note');
                if (holder && row && row.can_cancel && !document.querySelector('#wd-cancel')) {
                    holder.insertAdjacentHTML('afterend', '<button type="button" class="secondary" id="wd-cancel" style="width:100%;margin-top:10px">Отменить вывод и вернуть подарок</button>');
                    document.querySelector('#wd-cancel').addEventListener('click', async ev => {
                        ev.target.disabled = true;
                        try { await api('gifts/withdrawals/' + encodeURIComponent(row.id) + '/cancel', {}); toast('Вывод отменён, подарок в инвентаре'); stopped = true; closeSheet(); if (typeof refreshMe === 'function') refreshMe().catch(() => {}); if (state.page === 'gifts' && typeof renderGifts === 'function') renderGifts(); }
                        catch (error) { ev.target.disabled = false; toast(error.message); }
                    });
                } else if (row && !row.can_cancel) document.querySelector('#wd-cancel')?.remove();
                if (row && row.status !== 'queued' && row.status !== 'sending' && row.status !== 'review') stopped = true;
            } catch (error) {
                const box = document.querySelector('#wd-status');
                if (box) box.textContent = 'Не удалось загрузить статус';
            }
            if (!stopped) setTimeout(paint, 8000);
        };
        paint();
    }

    const originalDetail = showGiftDetail;
    showGiftDetail = function (gift, source) {
        if (gift && source === 'inventory' && gift.status === 'withdrawing') return showWithdrawalStatus(gift);
        if (gift && gift.pack_item && gift.pack_id) window.crafterPackWarm?.(gift.pack_id);
        if (!gift || !gift.star_gift || source !== 'inventory') return originalDetail(gift, source);
        state.detailGift = gift;
        const busy = gift.status !== 'unlisted';
        sheet('', `
            <div class="portal-product owned-gift-product star-gift-product">
                <img ${giftPicture(gift, true)} alt="${esc(gift.name)}" decoding="async">
                <div><h2>${esc(gift.name)}</h2><span>${esc(gift.stars)} ★</span></div>
            </div>
            <div class="product-properties">
                <div><span>Тип</span><strong>Подарок Telegram</strong></div>
                <div><span>Стоимость</span><strong>${gramText(gift.price)}</strong></div>
            </div>
            ${busy ? '<div class="ny-footnote">Подарок обрабатывается: он уже в очереди на вывод.</div>' : `
            <div class="product-actions owned-gift-actions">
                <button class="secondary" type="button" id="star-withdraw">Вывести</button>
                <button class="primary" type="button" id="star-sell">Продать за ${gramText(gift.price)}</button>
            </div>`}
            <div class="crafter-withdraw-result" id="star-result" role="status"></div>`);
        document.querySelector('#sheet')?.classList.add('purchase-sheet');
        const result = document.querySelector('#star-result');
        const lock = value => document.querySelectorAll('#star-sell,#star-withdraw').forEach(b => { b.disabled = value; });
        const finish = () => {
            if (typeof updateBalance === 'function') updateBalance();
            setTimeout(() => { try { closeSheet(); } catch (e) {} if (state.page === 'gifts' && typeof renderGifts === 'function') renderGifts(); }, 900);
        };
        document.querySelector('#star-sell')?.addEventListener('click', async () => {
            lock(true);
            try {
                const done = await api('star-gifts/sell', { gift_id: gift.id });
                state.inventory = (state.inventory || []).filter(item => item.id !== gift.id);
                if (state.me) state.me.balance = done.balance;
                result.className = 'crafter-withdraw-result is-success';
                result.innerHTML = '<strong>Продано</strong><p>На баланс начислено ' + gramText(done.amount) + '.</p>';
                finish();
            } catch (error) {
                result.className = 'crafter-withdraw-result is-error';
                result.textContent = error.message || 'Не удалось продать';
                lock(false);
            }
        });
        document.querySelector('#star-withdraw')?.addEventListener('click', async event => {
            const button = event.currentTarget;
            if (button.dataset.confirm !== '1') {
                button.dataset.confirm = '1';
                button.textContent = 'Подтвердить вывод';
                result.className = 'crafter-withdraw-result';
                result.textContent = 'Подарок отправит релейер Crafter. Если у вас нет @username в Telegram, вывод может не пройти.';
                return;
            }
            lock(true);
            try {
                const done = await api('star-gifts/withdraw', { gift_id: gift.id });
                state.inventory = (state.inventory || []).map(item => item.id === gift.id ? { ...item, status: 'withdrawing' } : item);
                result.className = 'crafter-withdraw-result is-success';
                result.innerHTML = '<strong>Заявка принята</strong><p>' + (done.auto ? 'Подарок будет отправлен в Telegram в ближайшую минуту.' : 'Подарок будет отправлен после обработки заявки.') + '</p>';
                finish();
            } catch (error) {
                result.className = 'crafter-withdraw-result is-error';
                result.textContent = error.message || 'Не удалось отправить заявку';
                lock(false);
            }
        });
    };
})();
