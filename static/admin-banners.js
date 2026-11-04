const bannerActions = {
    none:'Без действия', lucky:'Lucky Craft', market:'Маркет', craft:'Крафт',
    gifts:'Мои подарки', offers:'Офферы', history:'История подарков', profile:'Профиль',
    referrals:'Рефералы', wallet:'Баланс', activity:'Активность маркета',
    collection:'Коллекция', link:'Внешняя ссылка',
};

async function renderAdminBanners(content) {
    const {banners, carousel} = await api('admin/banners');
    if (!content.isConnected) return;
    content.innerHTML = `<div class="banner-admin">
        <section class="panel"><h3>Карусель</h3>
            <form class="banner-carousel-form">
                <label><input type="checkbox" name="enabled" ${carousel.enabled ? 'checked' : ''}> Включить</label>
                <label><input type="checkbox" name="show_counter" ${carousel.show_counter ? 'checked' : ''}> Показывать номер баннера</label>
                <label><input type="checkbox" name="show_dots" ${carousel.show_dots !== false ? 'checked' : ''}> Показывать точки баннеров</label>
                <label><input type="checkbox" name="auto_rotate" ${carousel.auto_rotate !== false ? 'checked' : ''}> Автоматически перелистывать</label>
                <label>Интервал <input class="field" name="interval" type="number" min="2" max="60" value="${carousel.interval}" required> сек.</label>
                <button class="secondary" type="submit">Сохранить</button>
            </form>
            <p class="sub">Счётчик показывает текущую позицию (например, 2 из 5). Если его выключить, место под ним освобождается автоматически. При выключенной карусели показывается первый опубликованный баннер.</p>
            <div class="banner-preview-wrap" data-carousel-preview></div>
        </section>
        <section class="panel"><h3>Баннеры маркета</h3><div class="banner-admin-list">
            ${banners.map(banner => `<div class="banner-admin-row">
                <div><b>${esc(banner.title)}</b><small>${banner.enabled ? 'Опубликован' : 'Скрыт'} · № ${banner.sort_order} · ${bannerActions[banner.action]}</small></div>
                <button type="button" class="admin-back" data-edit="${esc(banner.id)}">Изменить</button>
            </div>`).join('') || '<p class="sub">Баннеров пока нет.</p>'}
            <div class="banner-admin-actions"><button type="button" class="primary" data-create>Добавить баннер</button></div>
        </div></section>
        <section class="panel" data-banner-editor hidden></section>
    </div>`;
    const preview = content.querySelector('[data-carousel-preview]');
    const form = content.querySelector('.banner-carousel-form');
    const paintPreview = () => {
        const published = banners.filter(banner => banner.enabled);
        if (!published.length) return;
        const interval = Number(form.elements.interval.value);
        preview.replaceChildren(makeBannerCarousel(published, {
            enabled:form.elements.enabled.checked, interval:interval >= 2 && interval <= 60 ? interval : 5,
            show_counter: form.elements.show_counter.checked,
            show_dots: form.elements.show_dots.checked,
            auto_rotate: form.elements.auto_rotate.checked,
        }));
    };
    form.addEventListener('change', paintPreview);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;
        try {
            await api('admin/banners/carousel', {enabled:form.elements.enabled.checked,
                show_counter:form.elements.show_counter.checked,
                show_dots:form.elements.show_dots.checked,
                auto_rotate:form.elements.auto_rotate.checked,
                interval:Number(form.elements.interval.value)});
            toast('Карусель сохранена');
        } catch (error) { toast(error.message); }
        finally { button.disabled = false; }
    });
    paintPreview();
    const editor = content.querySelector('[data-banner-editor]');
    content.querySelector('[data-create]').onclick = () => editAdminBanner(content, editor, {
        title:'', action:'lucky', target:'', enabled:false,
        sort_order:Math.min(999, (banners.at(-1)?.sort_order || 0) + 10),
        focus_x:50, focus_y:50, zoom:100,
    });
    content.querySelectorAll('[data-edit]').forEach(button => {
        button.onclick = () => editAdminBanner(content, editor, banners.find(item => item.id === button.dataset.edit));
    });
}

function editAdminBanner(content, editor, banner) {
    editor.hidden = false;
    editor.innerHTML = `<h3>${banner.id ? 'Редактирование баннера' : 'Новый баннер'}</h3>
        <form class="banner-editor">
            <div class="banner-preview-wrap"><div class="banner-viewport banner-crop-preview" aria-label="Предпросмотр кадрирования"></div></div>
            <label>Изображение <input type="file" name="image" accept="image/png,image/jpeg,image/webp" ${banner.id ? '' : 'required'}></label>
            <div class="banner-editor-grid">
                <label>Горизонталь <input type="range" name="focus_x" min="0" max="100" value="${banner.focus_x}"></label>
                <label>Вертикаль <input type="range" name="focus_y" min="0" max="100" value="${banner.focus_y}"></label>
                <label>Масштаб <input type="range" name="zoom" min="100" max="250" value="${banner.zoom}"></label>
            </div>
            <label>Название <input class="field" name="title" maxlength="80" value="${esc(banner.title)}" required></label>
            <div class="banner-editor-grid">
                <label>Действие при нажатии <select class="field" name="action">${Object.entries(bannerActions).map(([key, label]) =>
                    `<option value="${key}" ${key === banner.action ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
                <label>Порядок <input class="field" type="number" name="sort_order" min="0" max="999" value="${banner.sort_order}" required></label>
            </div>
            <label data-link>HTTPS-ссылка <input class="field" name="url" type="url" maxlength="2048" value="${banner.action === 'link' ? esc(banner.target) : ''}"></label>
            <div data-collection>
                <label>Коллекция <input class="field" type="search" name="collection_query" placeholder="Быстрый поиск"></label>
                <p class="sub" data-collection-selected></p>
                <div class="banner-collection-options" data-collection-options></div>
            </div>
            <label class="banner-check"><input type="checkbox" name="enabled" value="1" ${banner.enabled ? 'checked' : ''}> Показать на маркете</label>
            <div class="banner-admin-actions">
                <button class="primary" type="submit">Сохранить</button>
                <button class="secondary" type="button" data-cancel>Отмена</button>
                ${banner.id ? '<button class="secondary" type="button" data-delete>Удалить</button>' : ''}
            </div>
            <p class="sub banner-editor-status" role="status"></p>
        </form>`;
    const form = editor.querySelector('form'), fields = form.elements;
    const preview = form.querySelector('.banner-crop-preview');
    const status = form.querySelector('[role=status]');
    let collection = banner.action === 'collection' ? banner.target : '';
    const updateArt = () => {
        const file = fields.image.files[0];
        const url = file ? URL.createObjectURL(file) : banner.image_url;
        if (!url) {
            preview.innerHTML = '<span>Добавьте изображение · 15:4</span>';
            return;
        }
        const img = bannerArt({image_url:url, focus_x:fields.focus_x.value, focus_y:fields.focus_y.value, zoom:fields.zoom.value});
        if (file) {
            const release = () => URL.revokeObjectURL(url);
            img.onload = release;
            img.onerror = release;
        }
        preview.replaceChildren(img);
    };
    form.addEventListener('input', event => {
        if (event.target.matches('[type=range],[type=file]')) updateArt();
    });
    updateArt();
    const showAction = () => {
        form.querySelector('[data-link]').hidden = fields.action.value !== 'link';
        fields.url.required = fields.action.value === 'link';
        form.querySelector('[data-collection]').hidden = fields.action.value !== 'collection';
    };
    fields.action.onchange = showAction;
    showAction();
    const paintCollections = () => {
        if (!form.isConnected) return;
        const query = fields.collection_query.value.toLocaleLowerCase().trim();
        const rows = state.catalog.collections;
        form.querySelector('[data-collection-selected]').textContent =
            rows.find(row => String(row.id) === collection)?.name || collection || 'Выберите коллекцию';
        const list = form.querySelector('[data-collection-options]');
        list.innerHTML = rows.filter(row => row.name.toLocaleLowerCase().includes(query)).slice(0, 12).map(row =>
            `<button type="button" data-id="${esc(row.id)}" aria-pressed="${String(row.id) === collection}">${esc(row.name)}</button>`).join('')
            || '<p class="sub">Коллекций не найдено</p>';
    };
    form.querySelector('[data-collection-options]').onclick = event => {
        const button = event.target.closest('[data-id]');
        if (button) { collection = button.dataset.id; paintCollections(); }
    };
    fields.collection_query.oninput = paintCollections;
    Promise.resolve(state.catalogReady).then(paintCollections);

    const url = 'admin/banners' + (banner.id ? '/' + encodeURIComponent(banner.id) : '');
    form.querySelector('[data-cancel]').onclick = () => { editor.hidden = true; editor.replaceChildren(); };
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const file = fields.image.files[0];
        if (file && file.size > 5 * 1024 * 1024) return void (status.textContent = 'Максимальный размер файла 5 МБ.');
        const data = new FormData(form);
        data.set('target', fields.action.value === 'link' ? fields.url.value : fields.action.value === 'collection' ? collection : '');
        data.delete('url');
        data.delete('collection_query');
        await saveAdminBanner(content, form, status, () => api(url, data), 'Баннер сохранён');
    });
    const remove = form.querySelector('[data-delete]');
    if (remove) remove.onclick = async () => {
        if (remove.dataset.confirm !== 'yes') {
            remove.dataset.confirm = 'yes';
            remove.textContent = 'Подтвердить удаление';
            return;
        }
        await saveAdminBanner(content, form, status, () => api(url + '/delete', {}), 'Баннер удалён');
    };
    editor.scrollIntoView({block:'nearest'});
}

async function saveAdminBanner(content, form, status, save, message) {
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = 'Сохраняем…';
    try {
        await save();
        toast(message);
        if (content.isConnected) await renderAdminBanners(content);
    } catch (error) { status.textContent = error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
}
