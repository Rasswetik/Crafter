async function renderAdminStaking(content=document.querySelector('#admin-content')) {
    const s=await api('admin/staking');
    if (!content?.isConnected) return;
    content.innerHTML=`<div class="staking-admin">
        <section class="panel">
            <h3>Стейкинг подарков</h3>
            <p class="sub">Настройки используются для новых вкладов. У уже замороженных подарков APR и дата разблокировки не меняются.</p>
            <form id="staking-admin-form" onsubmit="event.preventDefault();saveAdminStaking()">
                <label class="staking-admin-check"><input type="checkbox" id="staking-admin-enabled"
                    ${s.enabled?'checked':''}> Разрешить новые вклады</label>
                <label class="form-label">APR — процентов годовых (%)
                    <input class="field" id="staking-admin-apr" type="number" min="0" max="500"
                        step=".01" inputmode="decimal" required value="${esc(s.apr_percent)}">
                </label>
                <label class="form-label">Срок блокировки (дней)
                    <input class="field" id="staking-admin-days" type="number" min="1" max="365"
                        step="1" inputmode="numeric" required value="${Number(s.lock_days)}">
                </label>
                <label class="form-label">Лимит стейкинга на игрока (GRAM)
                    <input class="field" id="staking-admin-limit" type="number" min="0.01" max="1000000"
                        step=".01" inputmode="decimal" required value="${esc(s.limit_gram)}">
                </label>
                <button type="submit" class="primary">Сохранить настройки</button>
            </form>
            <p class="sub">Награды рассчитываются за каждые полные 24 часа по формуле «стоимость подарка × APR / 365». Получить их можно от 1 GRAM — на внутренний баланс Crafter, без блокчейн-перевода.</p>
        </section>
        <section class="panel">
            <h3>Активность</h3>
            <p class="sub">Сейчас в стейкинге: <b>${Number(s.active_gifts)} подарков</b>.</p>
            <p class="sub">Отключение новых вкладов не отменяет текущие сроки и уже заработанные награды.</p>
        </section>
    </div>`;
}
async function saveAdminStaking() {
    const form=document.querySelector('#staking-admin-form');
    if(!form?.reportValidity())return;
    const data={
        enabled:document.querySelector('#staking-admin-enabled').checked,
        apr_percent:Number(document.querySelector('#staking-admin-apr').value),
        lock_days:Number(document.querySelector('#staking-admin-days').value),
        limit_gram:Number(document.querySelector('#staking-admin-limit').value),
    };
    if(!Number.isFinite(data.apr_percent)||!Number.isFinite(data.limit_gram))return toast('Проверьте числовые значения');
    const button=form.querySelector('button[type=submit]');
    button.disabled=true;
    try {
        await api('admin/staking',data);
        toast('Стейкинг обновлён');
        await renderAdminStaking();
    }catch(e){toast(e.message)}
    finally{if(button.isConnected)button.disabled=false}
}
