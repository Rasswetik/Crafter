function forgePanel(className) {
    const panel = document.createElement('div');
    panel.className = 'forge-decal ' + className;
    panel.hidden = true;
    return panel;
}

function forgeGiftPanel(gift, sourceImage) {
    const panel = forgePanel('forge-gift-panel');
    panel.style.background = giftBackdrop(gift);
    const image = sourceImage?.cloneNode() || new Image();
    image.alt = '';
    image.src = imageURL(gift.image);
    panel.append(image);
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
    return from.map(([x, y], index) => [
        x + (to[index][0] - x) * eased,
        y + (to[index][1] - y) * eased - arc
    ]);
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
    const reward = result.gift ? forgeGiftPanel(result.gift) : forgePanel('forge-anvil-panel');
    if (!result.gift) reward.innerHTML = icon('gift');

    scene.append(canvas, ...marks, ...decals, reward);
    forge.append(scene);
    const bounds = scene.getBoundingClientRect();
    const { width, height } = bounds;
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
    let lastPitch, lastYaw;
    let hiddenSlots = 0;

    function paint(elapsed) {
        const frame = sequence.at(elapsed);
        if (frame.rx !== lastPitch || frame.ry !== lastYaw) {
            const view = CrafterCube.camera(frame.rx, frame.ry, width, height);
            visible = CrafterCube.draw(ctx, view, width, height);
            lastPitch = frame.rx;
            lastYaw = frame.ry;
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
                placeForgePanel(decal, forgeFlight(origins[index], face.points, frame.flight.progress));
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

function showForgeResult(status, result) {
    const gift = result.gift;
    status.classList.add('forge-complete');
    status.innerHTML = `
        <h2>${gift ? 'Подарок изготовлен' : 'Крафт не удался'}</h2>
        ${gift ? `<div class="forge-result-art"><img src="${esc(imageURL(gift.image))}" alt="${esc(gift.name)}"></div>
            <p><b>${esc(gift.name)} #${esc(gift.number)}</b><br>${esc(gift.model)}</p>`
            : `<p>Использовано подарков: ${result.consumed.length}</p>`}
        <div class="forge-result-actions">
            <button class="primary" onclick="go('gifts')">Мои подарки</button>
            <button class="forge-again" onclick="renderCraft()">Ещё крафт</button>
        </div>`;
    if (gift) status.querySelector('.forge-result-art').style.background = giftBackdrop(gift);
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
        const quote = await getCraftQuote(ids, state.target.id);
        state.quote = quote;
        const result = await api('craft', { quote_id: quote.quote_id, request_id: quote.quote_id });

        const consumed = new Set(result.consumed);
        state.inventory = state.inventory.filter(gift => !consumed.has(gift.id));
        if (result.gift && !state.inventory.some(gift => gift.id === result.gift.id)) {
            state.inventory.push({ ...result.gift, status: 'unlisted' });
        }
        state.me.inventory_count = state.inventory.length;
        state.selected = [];
        state.quote = null;

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
        showForgeResult(status, result);
        refreshMe().catch(() => {});
    } catch (error) {
        if (error.status >= 400 && error.status < 500) state.quote = null;
        toast(error.message);
        renderCraft();
    } finally {
        state.crafting = false;
    }
}
