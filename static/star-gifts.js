// Ordinary Telegram gifts (Bear, Rose ...): priced in GRAM (100 Stars = 1 GRAM), sold to the site or withdrawn by the relayer.
(function () {
    const gramText = value => money(value) + ' GRAM';

    const originalCard = card;
    card = function (gift, action) {
        const html = originalCard(gift, action);
        if (gift && gift.star_gift) return html.replace('<p class="number">#</p>', '<p class="number">' + esc(gift.stars) + ' ★</p>');
        if (gift && gift.pack_item && gift.model) {            // a pack: its title first, then "Pack #serial"
            html = html.replace('<b style="margin:0 auto">' + esc(gift.model) + '</b>', '<b style="margin:0 auto">Открыть</b>');
            return html.replace('<h3>' + esc(gift.name) + '</h3><p class="number">#' + esc(gift.number) + '</p>',
                '<h3>' + esc(gift.model) + '</h3><p class="number">Pack #' + esc(gift.number) + '</p>');
        }
        return html;
    };

    const originalFloor = productFloor;
    productFloor = function (gift) {
        return gift && gift.star_gift ? gramText(gift.price) : originalFloor(gift);
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
                <div><span>Курс</span><strong>100 ★ = 1 GRAM</strong></div>
            </div>
            ${busy ? '<div class="ny-footnote">Подарок обрабатывается: он уже в очереди на вывод.</div>' : `
            <div class="ny-footnote">Продать: сайт сразу выкупит подарок и начислит ${gramText(gift.price)} на баланс. Вывести: Telegram-подарок придёт вам в чат с подписью «Gift from Crafter». Его также можно использовать в апгрейде и крафте.</div>
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
