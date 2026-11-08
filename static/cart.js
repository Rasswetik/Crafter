Object.assign(paths,{basket:'M4 10h16l-1.6 8.5A2 2 0 0 1 16.4 20H7.6a2 2 0 0 1-2-1.5L4 10Zm-2 0h20M7 10l3-5m7 5-3-5m-5 8v4m3-4v4m3-4v4',check:'m5 12 4 4L20 5'});
Object.assign(state,{cart:new Map(),cartSelected:new Set(),cartUser:null,cartBuying:false});
function cartKey(){return 'crafter-cart:'+state.me.user.id}
function restoreCart(){if(!state.me||state.cartUser===state.me.user.id)return;state.cartUser=state.me.user.id;try{const rows=JSON.parse(sessionStorage.getItem(cartKey())||'[]');state.cart=new Map(rows.filter(g=>g&&typeof g.id==='string'&&Number.isFinite(Number(g.price))).map(g=>[g.id,g]));state.cartSelected=new Set(state.cart.keys())}catch{state.cart=new Map();state.cartSelected=new Set()}}
function saveCart(){try{sessionStorage.setItem(cartKey(),JSON.stringify([...state.cart.values()]))}catch{}updateCartFloat()}
function selectedCart(){return [...state.cart.values()].filter(g=>state.cartSelected.has(g.id))}
function cartTotal(items){return items.reduce((c,g)=>c+Math.round(Number(g.price)*100),0)/100}
const cartCard=card;card=function(g,action='detail'){restoreCart();let html=cartCard(g,action);if(state.page!=='market'||action!=='detail')return html;if(state.cart.has(g.id))state.cart.set(g.id,{...g});const added=state.cart.has(g.id);return html.replace(/<button class="basket"[\s\S]*?<\/button>/,`<button class="basket ${added?'in-cart':''}" data-cart-id="${esc(g.id)}" onclick="toggleCart(${arg(g.id)})" aria-label="${added?'Убрать из корзины':'Добавить в корзину'}" aria-pressed="${added}">${icon(added?'check':'basket')}</button>`)};
function toggleCart(id){if(state.cartBuying)return;restoreCart();if(state.cart.has(id)){state.cart.delete(id);state.cartSelected.delete(id)}else{const g=state.gifts.find(x=>x.id===id);if(!g)return;if(state.cart.size>=100)return toast('В корзину можно добавить до 100 подарков');state.cart.set(id,{...g});state.cartSelected.add(id)}saveCart();updateMarketCartButtons();paintBulkControls()}
function updateMarketCartButtons() {
    for (const button of document.querySelectorAll('#gifts-grid .basket[data-cart-id]')) {
        const added = state.cart.has(button.dataset.cartId);
        if (button.getAttribute('aria-pressed') === String(added)) continue;
        button.classList.toggle('in-cart', added);
        button.setAttribute('aria-pressed', String(added));
        button.setAttribute('aria-label', added ? 'Убрать из корзины' : 'Добавить в корзину');
        button.innerHTML = icon(added ? 'check' : 'basket');
    }
}

function updateCartFloat() {
    let button = document.querySelector('#cart-float');
    if (!state.cart.size || state.page !== 'market' || marketActivityVisible()) {
        button?.remove();
        return;
    }
    if (!button) {
        button = document.createElement('button');
        button.id = 'cart-float';
        button.className = 'cart-float';
        button.onclick = openCart;
        button.innerHTML = icon('basket') + '<span><b></b><small></small></span>';
        document.querySelector('#app').appendChild(button);
    }
    button.querySelector('b').textContent = money(cartTotal([...state.cart.values()])) + ' GRAM';
    button.querySelector('small').textContent = state.cart.size + ' ' + giftCountWord(state.cart.size);
}
function giftCountWord(n){const a=n%10,b=n%100;return b>=11&&b<=14?'подарков':a===1?'подарок':a>=2&&a<=4?'подарка':'подарков'}
const cartGrid=filterGrid;filterGrid=function(){cartGrid();updateCartFloat()};
const cartGo=go;go=async function(page){document.querySelector('#app').classList.remove('cart-view');document.querySelector('#cart-float')?.remove();await cartGo(page);restoreCart();updateCartFloat()};
function openCart(){restoreCart();state.cartError='';state.cartBalanceLoading=true;state.cartBalanceError='';state.page='cart';document.querySelector('#app').classList.remove('craft-view');document.querySelector('#app').classList.add('cart-view');document.querySelector('#cart-float')?.remove();renderCart();refreshCartBalance()}
function renderCart(){
    if(state.page!=='cart')return;
    const items=[...state.cart.values()];
    const chosen=selectedCart();
    const total=cartTotal(chosen);
    const balance=Number(state.me?.balance||0);
    const missing=Math.max(0,Math.round((total-balance)*100)/100);
    const enough=!state.cartBalanceLoading&&!state.cartBalanceError&&balance>=total;
    // Keep the button clickable while a stale balance is being checked, so a
    // user always receives feedback instead of an apparently dead control.
    const pending=Boolean(state.cartBuying);
    const payDisabled=!chosen.length||pending;
    const status=state.cartError||state.cartBalanceError||
        (state.cartBalanceLoading&&chosen.length?'Проверяем баланс…':
         (!state.cartBalanceLoading&&chosen.length&&!enough?'Недостаточно средств: не хватает '+cartFunds(missing)+' GRAM':''));
    const selectedCount=chosen.length;
    document.querySelector('#main').innerHTML=`<div class="cart-heading"><button onclick="go('market')">‹ Маркет</button><b>Корзина</b></div><div class="cart-tools"><button onclick="toggleAllCart()"><span class="cart-check ${selectedCount===items.length&&items.length?'checked':''}">${selectedCount===items.length&&items.length?'✓':''}</span>${selectedCount?'Снять выделение':'Выбрать всё'} · ${items.length}</button><button class="cart-remove" onclick="removeCartSelected()" ${!selectedCount?'disabled':''}>Удалить · ${selectedCount}</button><button type="button" class="primary cart-pay-top" onclick="payCart()" ${payDisabled?'disabled':''}>${pending?'Оплата…':'Оплатить'} <small>${cartFunds(total)} GRAM</small></button></div>${status?'<div class="cart-top-feedback" role="status">'+esc(status)+'</div>':''}<div class="cart-list">${items.map(g=>`<article class="cart-row"><button class="cart-row-select" onclick="selectCart(${arg(g.id)})" aria-label="Выбрать ${esc(g.name)}"><img ${giftPicture(g)} alt=""><span class="cart-row-info"><b>${esc(g.name)}</b><small>#${esc(g.number||'—')}</small><strong>${gramIcon()} ${money(g.price)}</strong></span><span class="cart-check ${state.cartSelected.has(g.id)?'checked':''}">${state.cartSelected.has(g.id)?'✓':''}</span></button></article>`).join('')||'<div class="inventory-empty">'+icon('basket')+'<h2>Корзина пуста</h2><p>Добавьте подарки в маркете</p><button class="primary" onclick="go(\'market\')">Перейти в маркет</button></div>'}</div>${items.length?`<div class="cart-checkout"><div class="cart-available"><span>Доступно на балансе</span><b>${state.cartBalanceLoading?"Проверяем…":state.cartBalanceError?"—":cartFunds(balance)+" GRAM"}</b><button onclick="refreshCartBalance()" aria-label="Обновить баланс" ${state.cartBalanceLoading?"disabled":""}>↻</button></div><div class="cart-sum"><span>К оплате</span><b>${cartFunds(total)} GRAM</b></div><p class="cart-balance-error">${esc(status)}</p><button class="primary" id="cart-pay" onclick="payCart()" ${payDisabled?'disabled':''}>${pending?'Оплата…':state.cartBalanceLoading?'Проверяем баланс…':'Оплатить с помощью GRAM'}<small>${money(total)} GRAM · ${selectedCount} ${giftCountWord(selectedCount)}</small></button></div>`:''}`;
}
function selectCart(id){if(state.cartBuying)return;state.cartError='';state.cartSelected.has(id)?state.cartSelected.delete(id):state.cartSelected.add(id);renderCart()}
function toggleAllCart(){if(state.cartBuying)return;state.cartError='';state.cartSelected=state.cartSelected.size===state.cart.size?new Set():new Set(state.cart.keys());renderCart()}
function removeCartSelected(){if(state.cartBuying)return;for(const id of state.cartSelected)state.cart.delete(id);state.cartSelected.clear();saveCart();renderCart()}
async function payCart(){
    if(state.cartBuying)return;
    const items=selectedCart();
    if(!items.length){toast('Выберите подарки для оплаты');return;}
    if(state.cartBalanceLoading&&!state.me.market_test_purchases){
        state.cartError='Баланс ещё обновляется. Повторите оплату после проверки.';
        renderCart();toast(state.cartError);return;
    }
    if(state.cartBalanceError&&!state.me.market_test_purchases){
        state.cartError=state.cartBalanceError;
        renderCart();toast(state.cartError);return;
    }
    const testing=Boolean(state.me.market_test_purchases && items.every(g=>!g.resale));
    const amount=cartTotal(items);
    if((!Number.isFinite(amount)||amount<=0) && !testing){
        state.cartError='Не удалось определить сумму покупки. Перезагрузите корзину.';
        renderCart();toast(state.cartError);return;
    }
    if(!testing&&Number(state.me.balance)<amount){
        state.cartError='Недостаточно средств: не хватает '+cartFunds(amount-Number(state.me.balance))+' GRAM';
        renderCart();toast(state.cartError);return;
    }
    const thermos=state.me.market_backend==='thermos';
    if(!testing&&!state.me.demo&&!thermos&&items.some(g=>g.resale||g.price_unit!=='GRAM'||!/^[a-f0-9-]{36}$/i.test(g.id))){
        state.cartError='В этой корзине доступны только реальные лоты Portals с ценами в GRAM';
        renderCart();toast(state.cartError);return;
    }
    const ids=items.map(g=>g.id).sort();
    const key='crafter-cart-payment:'+state.me.user.id+':'+ids.join('|');
    state.cartBuying=true;state.cartError='';renderCart();
    try{
        const result=await api(testing?'market/test/buy':state.me.demo?'local/cart/buy':(thermos?'thermos/buy':'portals/buy'),
            thermos&&!testing?{gift_ids:ids,expected_total_ton:String(cartTotal(items)),request_id:paymentRequestId(key)}
            :{gift_ids:ids,expected_total:String(cartTotal(items)),request_id:paymentRequestId(key)});
        if(!testing&&!state.me.demo&&result.status!=='complete')throw Error('Покупка требует проверки. Не оплачивайте повторно.');
        const gifts=result.gifts||[];
        const purchasedIds=gifts.map(g=>g.source_id||g.id);
        if(purchasedIds.length){
            removePurchasedMarketLots(purchasedIds);
            purchasedIds.forEach(id=>{state.cart.delete(id);state.cartSelected.delete(id)});
            saveCart();
        }
        state.me.balance=result.balance;
        state.me.inventory_count=(state.me.inventory_count||0)+gifts.length;
        updateBalance();
        if(typeof window.crafterSeasonBalanceRefresh==='function')window.crafterSeasonBalanceRefresh();
        toast(testing?'Подарки добавлены в инвентарь':result.failed?.length?'Покупка частичная: '+gifts.length+' из '+ids.length: 'Покупка подтверждена');
    }catch(e){
        state.cartError=e.message||'Не удалось подтвердить покупку';
        toast(state.cartError);
    }finally{state.cartBuying=false;if(state.page==='cart')renderCart();}
}

function cartFunds(value){return Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}
let cartBalanceRequest=0;
async function refreshCartBalance(){const ticket=++cartBalanceRequest;state.cartBalanceLoading=true;state.cartBalanceError='';if(state.page==='cart')renderCart();try{const me=await api('me');if(ticket!==cartBalanceRequest)return;state.me=me;updateBalance()}catch(e){if(ticket!==cartBalanceRequest)return;state.cartBalanceError='Не удалось обновить баланс. Нажмите ↻ для повтора.'}finally{if(ticket===cartBalanceRequest){state.cartBalanceLoading=false;if(state.page==='cart')renderCart()}}}
