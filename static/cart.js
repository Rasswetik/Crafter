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
function renderCart(){const items=[...state.cart.values()],chosen=selectedCart(),total=cartTotal(chosen),balance=Number(state.me.balance||0),missing=Math.max(0,Math.round((total-balance)*100)/100),enough=!state.cartBalanceLoading&&!state.cartBalanceError&&balance>=total;document.querySelector('#main').innerHTML=`<div class="cart-heading"><button onclick="go('market')">‹ Маркет</button><b>Корзина</b></div><div class="cart-tools"><button onclick="toggleAllCart()"><span class="cart-check ${chosen.length===items.length&&items.length?'checked':''}">${chosen.length===items.length&&items.length?'✓':''}</span>${chosen.length?'Снять выделение':'Выбрать всё'} · ${items.length}</button><button class="cart-remove" onclick="removeCartSelected()" ${!chosen.length?'disabled':''}>Удалить · ${chosen.length}</button></div><div class="cart-list">${items.map(g=>`<article class="cart-row"><button class="cart-row-select" onclick="selectCart(${arg(g.id)})" aria-label="Выбрать ${esc(g.name)}"><img ${giftPicture(g)} alt=""><span class="cart-row-info"><b>${esc(g.name)}</b><small>#${esc(g.number||'—')}</small><strong>${gramIcon()} ${money(g.price)}</strong></span><span class="cart-check ${state.cartSelected.has(g.id)?'checked':''}">${state.cartSelected.has(g.id)?'✓':''}</span></button></article>`).join('')||'<div class="inventory-empty">'+icon('basket')+'<h2>Корзина пуста</h2><p>Добавьте подарки в маркете</p><button class="primary" onclick="go(\'market\')">Перейти в маркет</button></div>'}</div>${items.length?`<div class="cart-checkout"><div class="cart-available"><span>Доступно на балансе</span><b>${state.cartBalanceLoading?"Проверяем…":state.cartBalanceError?"—":cartFunds(balance)+" GRAM"}</b><button onclick="refreshCartBalance()" aria-label="Обновить баланс" ${state.cartBalanceLoading?"disabled":""}>↻</button></div><div class="cart-sum"><span>К оплате</span><b>${cartFunds(total)} GRAM</b></div><p class="cart-balance-error">${esc(state.cartBalanceError||state.cartError||(!state.cartBalanceLoading&&chosen.length&&missing>0?'Недостаточно средств: не хватает '+cartFunds(missing)+' GRAM':''))}</p><button class="primary" id="cart-pay" onclick="payCart()" ${!chosen.length||!enough||state.cartBuying?'disabled':''}>${state.cartBuying?'Оплата…':state.cartBalanceLoading?'Проверяем баланс…':'Оплатить с помощью GRAM'}<small>${money(total)} GRAM · ${chosen.length} ${giftCountWord(chosen.length)}</small></button></div>`:''}`}
function selectCart(id){if(state.cartBuying)return;state.cartError='';state.cartSelected.has(id)?state.cartSelected.delete(id):state.cartSelected.add(id);renderCart()}
function toggleAllCart(){if(state.cartBuying)return;state.cartError='';state.cartSelected=state.cartSelected.size===state.cart.size?new Set():new Set(state.cart.keys());renderCart()}
function removeCartSelected(){if(state.cartBuying)return;for(const id of state.cartSelected)state.cart.delete(id);state.cartSelected.clear();saveCart();renderCart()}
async function payCart(){if(state.cartBuying)return;const items=selectedCart();if(!items.length)return;const ids=items.map(g=>g.id).sort(),key='crafter-cart-payment:'+state.me.user.id+':'+ids.join('|');state.cartBuying=true;state.cartError='';renderCart();try{const result=await api('local/cart/buy',{gift_ids:ids,expected_total:String(cartTotal(items)),request_id:paymentRequestId(key)});removePurchasedMarketLots(ids);state.me.balance=result.balance;state.me.inventory_count=(state.me.inventory_count||0)+result.gifts.length;updateBalance();toast('Покупка завершена')}catch(e){state.cartError=e.message;toast(e.message)}finally{state.cartBuying=false;renderCart()}}

function cartFunds(value){return Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}
let cartBalanceRequest=0;
async function refreshCartBalance(){const ticket=++cartBalanceRequest;state.cartBalanceLoading=true;state.cartBalanceError='';if(state.page==='cart')renderCart();try{const me=await api('me');if(ticket!==cartBalanceRequest)return;state.me=me;updateBalance()}catch(e){if(ticket!==cartBalanceRequest)return;state.cartBalanceError='Не удалось обновить баланс. Нажмите ↻ для повтора.'}finally{if(ticket===cartBalanceRequest){state.cartBalanceLoading=false;if(state.page==='cart')renderCart()}}}
