async function renderAdminArena(content = document.querySelector('#admin-content')) {
    const settings = await api('admin/arena');
    if (!content?.isConnected) return;
    content.innerHTML = `<section class="panel">
        <h3>Crafter · Бот</h3>
        <p class="sub">Банк бота: <b>${money(settings.balance)} GRAM</b> · NFT: <b>${Number(settings.gift_count)}</b>.
            Комиссии Arena: <b>${money(settings.fees)} GRAM</b>.</p>
        <form id="arena-bot-form">
            <label class="staking-admin-check"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}>
                Разрешить участие бота</label>
            <label class="form-label">Максимальная оценка ставки бота за раунд, GRAM
                <input class="field" name="limit" type="number" min=".000001" max="1000000" step=".000001"
                    inputmode="decimal" required value="${esc(settings.limit)}">
            </label>
            <label class="form-label">Перевести боту GRAM с вашего баланса
                <input class="field" name="amount" type="number" min="0" max="1000000" step=".000001" inputmode="decimal" placeholder="0">
            </label>
            <p class="sub">Доступно: ${money(settings.admin_balance)} GRAM</p>
            ${settings.gifts.length ? `<label class="form-label">Перевести боту NFT из вашего инвентаря
                <select class="field" name="gift_ids" multiple size="${Math.min(5, settings.gifts.length)}">
                    ${settings.gifts.map(gift => `<option value="${esc(gift.id)}">${esc(gift.name)} #${esc(gift.number)} · ${money(gift.value / 1e6)} GRAM</option>`).join('')}
                </select></label>` : ''}
            <p class="sub">Переведённые средства и подарки принадлежат банку бота и могут быть выиграны другими игроками.</p>
            <button class="primary" type="submit">Сохранить</button>
        </form>
    </section>`;
    let retry;
    const form = content.querySelector('#arena-bot-form');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const fields = new FormData(form);
        const data = {enabled: fields.has('enabled'), limit: fields.get('limit'),
                      amount: fields.get('amount') || '0', gift_ids: fields.getAll('gift_ids')};
        const intent = JSON.stringify(data);
        if (retry && retry.intent !== intent) {
            return toast('Проверьте предыдущий запрос, повторив его с теми же данными.');
        }
        const requestId = retry?.id || crypto.randomUUID();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            await api('admin/arena', {...data, request_id: requestId});
            retry = null;
            toast('Настройки Arena сохранены');
            await renderAdminArena(content);
        } catch (error) {
            retry = error.status && error.status < 500 ? null : {id: requestId, intent};
            toast(error.message);
        } finally {
            if (button.isConnected) button.disabled = false;
        }
    });
}
