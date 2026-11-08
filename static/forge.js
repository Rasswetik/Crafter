function forgePanel(className) {
    const panel = document.createElement('div');
    panel.className = 'forge-decal ' + className;
    panel.hidden = true;
    return panel;
}

function forgeGiftPanel(gift, sourceImage) {
    const panel = forgePanel('forge-gift-panel');
    panel.style.background = giftBackdrop(gift);
    panel.innerHTML = giftPattern(gift);
    if (sourceImage?.complete && sourceImage.naturalWidth) panel.append(sourceImage.cloneNode());
    else panel.insertAdjacentHTML('beforeend', `<img ${giftPicture(gift, true)} alt="">`);

    return panel;
}

const brokenGiftImage = '/static/assets/broken-gift.png';

function forgeBrokenGiftPanel() {
    const panel = forgePanel('forge-loss-panel');
    panel.innerHTML = `<img src="${brokenGiftImage}" alt="">`;
    return panel;
}

function placeForgePanel(panel, points, opacity = 1) {
    const transform = points && opacity > 0 ? CrafterCube.panelTransform(points) : '';
    panel.hidden = !transform;
    if (!transform) return;
    panel.style.transform = transform;
    panel.style.opacity = opacity;
}

function forgeFlight(from, to, progress) {
    const eased = CrafterCube.smooth(progress);
    const arc = 19 * Math.sin(Math.PI * eased);
    const deltaX = (to[0][0] + to[2][0] - from[0][0] - from[2][0]) / 2;
    const deltaY = (to[0][1] + to[2][1] - from[0][1] - from[2][1]) / 2;
    return from.map(([x, y]) => [x + deltaX * eased, y + deltaY * eased - arc]);
}

async function playForge(forge, gifts, result) {
    const scene = document.createElement('div');
    scene.className = 'forge-animation';
    scene.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas unavailable');

    const slots = gifts.map((_, index) => forge.querySelector('[data-index="' + index + '"]'));
    const marks = CrafterCube.faces.map(() => {
        const panel = forgePanel('forge-anvil-panel');
        panel.innerHTML = anvilArt('forge-anvil-icon');
        return panel;
    });
    const decals = gifts.map((gift, index) =>
        forgeGiftPanel(gift, slots[index]?.querySelector('img'))
    );
    const reward = result.gift ? forgeGiftPanel(result.gift) : forgeBrokenGiftPanel();

    scene.append(canvas, ...marks, ...decals, reward);
    forge.append(scene);
    const bounds = scene.getBoundingClientRect();
    const { width, height } = bounds;
    const anvil = forge.querySelector('.anvil').getBoundingClientRect();
    const cubeFrame = {
        left: anvil.left - bounds.left,
        top: anvil.top - bounds.top,
        width: anvil.width,
        height: anvil.height
    };
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.scale(ratio, ratio);

    const origins = slots.map(slot => {
        const box = slot.getBoundingClientRect();
        const left = box.left - bounds.left;
        const top = box.top - bounds.top;
        return [[left, top], [left + box.width, top],
            [left + box.width, top + box.height], [left, top + box.height]];
    });
    const sequence = CrafterCube.timeline(gifts.length);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let visible = [];
    let lastPitch, lastYaw, lastRoll, lastOffset;
    let hiddenSlots = 0;

    function paint(elapsed) {
        const frame = sequence.at(elapsed);
        const offset = (frame.offsetY || 0) * cubeFrame.height;
        if (frame.rx !== lastPitch || frame.ry !== lastYaw || frame.roll !== lastRoll || offset !== lastOffset) {
            const position = {...cubeFrame, top: cubeFrame.top + offset};
            const view = CrafterCube.camera(frame.rx, frame.ry, width, height, frame.roll, position);
            visible = CrafterCube.draw(ctx, view, width, height);
            lastPitch = frame.rx;
            lastYaw = frame.ry;
            lastRoll = frame.roll;
            lastOffset = offset;
        }

        const taken = frame.attached + (frame.flight ? 1 : 0);
        while (hiddenSlots < taken) slots[hiddenSlots++].classList.add('forge-slot-taken');

        const release = frame.release || 0;
        const reveal = frame.reveal || 0;
        marks.forEach((mark, index) => {
            const face = visible.find(item => item.index === index);
            const input = CrafterCube.inputFaces.indexOf(index);
            const opacity = index === CrafterCube.resultFace ? 1 - reveal :
                input >= 0 && input < frame.attached ? release : 1;
            placeForgePanel(mark, face?.points, opacity);
        });

        decals.forEach((decal, index) => {
            const face = visible.find(item => item.index === CrafterCube.inputFaces[index]);
            if (frame.flight?.index === index && face) {
                const progress = frame.flight.progress;
                const opacity = 1 - CrafterCube.smooth((progress - .84) / .16);
                placeForgePanel(decal, forgeFlight(origins[index], face.points, progress), opacity);
            } else if (index < frame.attached && face && release < 1) {
                const lift = release * 21;
                const points = face.points.map(([x, y]) =>
                    [x + face.normal[0] * lift, y + (face.normal[1] - .22) * lift]
                );
                placeForgePanel(decal, points, 1 - release);
            } else {
                decal.hidden = true;
            }
        });
        if (reveal > 0 && result.gift && !forge.classList.contains('forge-reward-visible')) {
            forge.classList.add('forge-reward-visible');
            mountGiftAnimation(reward, result.gift, forge.closest('.craft-page'));
        }
        const resultFace = visible.find(face => face.index === CrafterCube.resultFace);
        placeForgePanel(reward, resultFace?.points, reveal);
    }

    if (reduced) {
        paint(sequence.duration);
        return;
    }
    paint(0);
    await new Promise((resolve, reject) => {
        const started = performance.now();
        function tick(now) {
            if (!scene.isConnected) return resolve();
            const elapsed = Math.min(now - started, sequence.duration);
            try {
                paint(elapsed);
            } catch (error) {
                reject(error);
                return;
            }
            if (elapsed < sequence.duration) requestAnimationFrame(tick);
            else resolve();
        }
        requestAnimationFrame(tick);
    });
}

function showForgeResult(status, result, usedGifts = []) {
    const gift = result.gift;
    status.closest('.craft-page').classList.add('craft-finished');
    status.classList.add('forge-complete');
    status.innerHTML = `
        ${gift ? '' : '<h2>Проигрыш</h2>'}
        ${gift ? `<figure class="forge-result-gift">
            <div class="forge-result-art">${giftPattern(gift)}<img ${giftPicture(gift, true)} alt=""></div>
            <figcaption><b><button type="button" class="gift-collection-link" aria-label="Открыть коллекцию ${esc(gift.name)}">
                ${esc(gift.name)} ${gift.number ? '#' + esc(gift.number) : ''}${icon('chevron')}</button></b>
                <span>${esc(gift.model)}</span></figcaption>
        </figure>`
            : `<div class="forge-loss-art"><img src="${brokenGiftImage}" alt="Разбитый подарок"></div>`}
        ${usedGifts.length ? `<section class="craft-materials" aria-labelledby="craft-materials-title">
            <h3 id="craft-materials-title">Crafting Tools</h3>
            <div class="craft-materials-row">
                ${usedGifts.map((item, index) => `<div class="craft-material" style="background:${giftBackdrop(item)};--material-delay:${index * 85}ms">
                    ${giftPattern(item)}<img ${giftPicture(item)} alt="${esc(item.name)}">
                </div>`).join('')}
            </div>
        </section>` : ''}
        <div class="forge-result-actions">
            <button class="primary" onclick="go('gifts')">Мои подарки</button>
            <button class="forge-again" onclick="renderCraft()">Ещё раз</button>
        </div>`;
    if (gift) {
        status.querySelector('.gift-collection-link').addEventListener('click', () => openGiftCollection(gift, false));
        const art = status.querySelector('.forge-result-art');
        const stage = status.closest('.craft-page');
        const [center, edge] = giftBackdropColors(gift);
        art.style.background = giftBackdrop(gift);
        if (center && edge) {
            stage.style.setProperty('--craft-result-center', center);
            stage.style.setProperty('--craft-result-edge', edge);
        }
        mountGiftAnimation(art, gift, stage);
    }
    status.querySelectorAll('.craft-material').forEach((art, index) => {
        mountGiftAnimation(art, usedGifts[index], null, false);
    });
}

async function runCraft() {
    if (state.crafting) return;
    if (!state.selected.length) return pickGift();
    if (state.selected.length > CRAFT_GIFT_LIMIT) return pickGift();
    if (!state.target) return chooseTarget();

    const ids = [...state.selected];
    const gifts = ids.map(id => state.inventory.find(gift => gift.id === id));
    const page = document.querySelector('.craft-page');
    const button = document.querySelector('#craft-button');
    state.crafting = true;
    button.disabled = true;
    button.textContent = 'Изготовление…';

    try {
        const quote = await getCraftQuote(ids, state.target.id, state.target.listingId);
        state.quote = quote;
        const result = await api('craft', { quote_id: quote.quote_id, request_id: quote.quote_id });
        if (result.gift && !giftAnimationMotion.matches) prepareGiftAnimation(result.gift);

        const consumed = new Set(result.consumed);
        state.inventory = state.inventory.filter(gift => !consumed.has(gift.id));
        if (result.gift && !state.inventory.some(gift => gift.id === result.gift.id)) {
            state.inventory.push({ ...result.gift, status: 'unlisted' });
        }
        if (result.gift && (result.listing_id || result.gift.source_id)) {
            const won = result.gift;
            const listingId = result.listing_id || won.source_id;
            if (state.target?.listingId === listingId) state.target = null;
            const isWon = item => item.id === listingId || (!result.listing_id &&
                item.name === won.name && String(item.number) === String(won.source_number));
            state.gifts = state.gifts.filter(item => !isWon(item));
            restoreCart();
            let removed = false;
            for (const [id, item] of state.cart) {
                if (!isWon(item)) continue;
                state.cart.delete(id);
                state.cartSelected.delete(id);
                removed = true;
            }
            if (removed) saveCart();
        }
        state.me.inventory_count = state.inventory.length;
        state.selected = [];
        state.quote = null;
        saveCraftDraft();

        page.classList.add('manufacturing');
        const status = document.createElement('section');
        status.className = 'manufacturing-status';
        status.setAttribute('aria-live', 'polite');
        status.innerHTML = '<h2>Изготовление</h2>';
        page.append(status);
        try {
            await playForge(page.querySelector('#forge'), gifts, result);
        } catch {
            page.querySelector('.forge-animation')?.remove();
            page.classList.add('forge-visual-unavailable');
        }
        showForgeResult(status, result, gifts.filter(gift => consumed.has(gift.id)));
        if(typeof window.crafterSeasonBalanceRefresh==='function')window.crafterSeasonBalanceRefresh();
        refreshMe().catch(() => {});
    } catch (error) {
        if (error.status >= 400 && error.status < 500) state.quote = null;
        toast(error.message);
        renderCraft();
    } finally {
        state.crafting = false;
    }
}
