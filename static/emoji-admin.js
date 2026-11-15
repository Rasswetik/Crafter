/* Admin → Управление сезоном → Значки: animated emoji that players buy, get as prizes and put next to their name. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const pic = (em, cls) => window.crafterBadgeMedia ? window.crafterBadgeMedia(em, cls || '') : '';

/* the still picture of a video badge (for lists and pickers): one frame, cut in the browser */
const posterFrom = file => new Promise(done => {
    const v = document.createElement('video'), url = URL.createObjectURL(file);
    let ended = false; const fin = b => { if (ended) return; ended = true; URL.revokeObjectURL(url); done(b); };
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    v.onloadeddata = () => { v.currentTime = Math.min(1.3, (v.duration || 2) * .5); };
    v.onseeked = () => { const c = document.createElement('canvas'); c.width = 320; c.height = 320; const g = c.getContext('2d'); const k = Math.min(320 / v.videoWidth, 320 / v.videoHeight); g.drawImage(v, (320 - v.videoWidth * k) / 2, (320 - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k); c.toBlob(b => fin(b), 'image/png'); };
    v.onerror = () => fin(null); setTimeout(() => fin(null), 8000);
});

async function admin(content) {
    let data;
    try { data = await api('admin/emojis'); } catch (_) { return; }
    if (!content.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section ea-wrap';
    sec.dataset.pane = 'emojis';
    let form = null, cform = null;
    const blank = () => ({id: '', title: '', description: '', media: '', kind: 'image', poster: '', value: 300, collection_id: '', rarity: '', enabled: true});

    const draw = () => {
        sec.innerHTML = collectionsHTML() + '<h3>Значки</h3><p class="sub">Анимированные эмодзи. Игрок покупает их в маркете, получает в пассе, а потом ставит рядом с ником в профиле. Анимация: WebM с прозрачностью, WebP, GIF, PNG или SVG до 6 МБ.</p>' +
            '<div class="ea-list">' + (data.emojis.length ? data.emojis.map(x => '<div class="ea-card' + (x.enabled ? '' : ' is-off') + '"><span class="ea-pic">' + pic(x) + '</span><div><b>' + e(x.title) + '</b><small>' + e(x.description) + '</small><small>Код: ' + e(x.id) + ' · владельцев: ' + x.owners + (x.enabled ? '' : ' · скрыт') + '</small></div>' +
                '<span class="ea-btns"><button type="button" data-edit="' + e(x.id) + '">Изменить</button><button type="button" class="is-danger" data-del="' + e(x.id) + '">Удалить</button></span></div>').join('') : '<p class="sub">Значков пока нет.</p>') + '</div>' +
            (form ? formHTML() : '<button type="button" class="primary" data-new>+ Новый значок</button>') +
            '<h3 style="margin-top:24px">Выдать значок игроку</h3><div class="ea-give"><input data-gid inputmode="numeric" placeholder="Telegram ID игрока"><select data-gem>' + data.emojis.map(x => '<option value="' + e(x.id) + '">' + e(x.title) + '</option>').join('') + '</select><button type="button" class="primary" data-give>Выдать</button></div>';
        bind();
    };
    const collectionsHTML = () => '<h3>Коллекции значков</h3><p class="sub">У значка бывает коллекция: она показывается на странице значка («ВХОДИТ В КОЛЛЕКЦИЮ») с фото и названием.</p>' +
        '<div class="ea-list">' + (data.collections.length ? data.collections.map(c => '<div class="ea-card"><span class="ea-pic">' + (c.photo ? '<img src="' + e(c.photo) + '" alt="">' : '') + '</span><div><b>' + e(c.title) + '</b><small>Код: ' + e(c.id) + ' · значков: ' + data.emojis.filter(x => x.collection_id === c.id).length + '</small></div>' +
            '<span class="ea-btns"><button type="button" data-cedit="' + e(c.id) + '">Изменить</button><button type="button" class="is-danger" data-cdel="' + e(c.id) + '">Удалить</button></span></div>').join('') : '<p class="sub">Коллекций пока нет.</p>') + '</div>' +
        (cform ? '<div class="adm-step ea-form"><h4>' + (cform.id ? 'Изменить коллекцию' : 'Новая коллекция') + '</h4><label>Название<input data-cf="title" maxlength="40" value="' + e(cform.title) + '" placeholder="Например: Goshan"></label>' +
            '<div class="ea-up"><span class="ea-pic big">' + (cform.photo ? '<img src="' + e(cform.photo) + '" alt="">' : '<small>нет фото</small>') + '</span><label class="ea-file">Загрузить фото<input type="file" data-cfile accept=".png,.webp,.jpg,.jpeg,.gif,image/*"></label></div>' +
            '<div class="ea-actions"><button type="button" class="primary" data-csave>Сохранить</button><button type="button" data-ccancel>Отмена</button></div></div>' : '<button type="button" class="primary" data-cnew>+ Новая коллекция</button>');
    const formHTML = () => '<div class="adm-step ea-form"><h4>' + (form.id ? 'Изменить значок' : 'Новый значок') + '</h4>' +
        '<label>Название<input data-f="title" maxlength="60" value="' + e(form.title) + '" placeholder="Например: Goshan Vice"></label>' +
        '<label>Коллекция<select data-f="collection_id"><option value="">Без коллекции</option>' + data.collections.map(c => '<option value="' + e(c.id) + '"' + (form.collection_id === c.id ? ' selected' : '') + '>' + e(c.title) + '</option>').join('') + '</select></label>' +
        '<label>Редкость<select data-f="rarity">' + [['', 'Без редкости'], ['default', 'Основной'], ['common', 'Обычный'], ['rare', 'Редкий'], ['epic', 'Эпический'], ['legendary', 'Легендарный']].map(r => '<option value="' + r[0] + '"' + (form.rarity === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('') + '</select></label>' +
        '<label>Оценка значка (на столько дешевле набор, если значок у игрока уже есть)<input data-f="value" inputmode="numeric" value="' + e(form.value) + '" placeholder="300"></label>' +
        '<label>Описание значка (показывается игроку)<input data-f="description" maxlength="240" value="' + e(form.description) + '" placeholder="Особый значок."></label>' +
        '<div class="ea-up"><span class="ea-pic big">' + (form.media ? pic(form) : '<small>нет анимации</small>') + '</span><label class="ea-file">Загрузить анимацию<input type="file" data-file accept=".webm,.webp,.gif,.png,.svg,video/webm,image/*"></label></div>' +
        '<label class="ea-check"><input type="checkbox" data-f="enabled"' + (form.enabled ? ' checked' : '') + '> Показывать игрокам</label>' +
        '<div class="ea-actions"><button type="button" class="primary" data-save>Сохранить</button><button type="button" data-cancel>Отмена</button></div></div>';

    const pull = () => { if (!form) return; sec.querySelectorAll('[data-f]').forEach(i => { form[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; }); };
    const bind = () => {
        sec.querySelector('[data-cnew]')?.addEventListener('click', () => { cform = {id: '', title: '', photo: ''}; draw(); });
        sec.querySelector('[data-ccancel]')?.addEventListener('click', () => { cform = null; draw(); });
        sec.querySelectorAll('[data-cedit]').forEach(b => b.addEventListener('click', () => { cform = {...data.collections.find(c => c.id === b.dataset.cedit)}; draw(); }));
        sec.querySelectorAll('[data-cdel]').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('Удалить коллекцию? Значки останутся, но без коллекции.')) return;
            try { await api('admin/emoji-collections/' + b.dataset.cdel + '/delete', {}); toast('Коллекция удалена'); data = await api('admin/emojis'); draw(); } catch (err) { toast(err.message); }
        }));
        sec.querySelector('[data-cf="title"]')?.addEventListener('input', ev => { cform.title = ev.target.value; });
        sec.querySelector('[data-cfile]')?.addEventListener('change', async ev => {
            const f = ev.target.files[0]; if (!f) return;
            if (f.size > 6000000) { toast('Файл должен быть не больше 6 МБ'); return; }
            try { const body = new FormData(); body.append('file', f); cform.photo = (await api('admin/emojis/media', body)).url; draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-csave]')?.addEventListener('click', async () => {
            try { await api('admin/emoji-collections', {id: cform.id, title: cform.title, photo: cform.photo}); toast('Коллекция сохранена'); cform = null; data = await api('admin/emojis'); draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-new]')?.addEventListener('click', () => { form = blank(); draw(); });
        sec.querySelector('[data-cancel]')?.addEventListener('click', () => { form = null; draw(); });
        sec.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { form = {...data.emojis.find(x => x.id === b.dataset.edit)}; draw(); sec.querySelector('.ea-form')?.scrollIntoView({block: 'center'}); }));
        sec.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('Удалить значок? Он пропадёт и у игроков, которые его купили.')) return;
            try { await api('admin/emojis/' + b.dataset.del + '/delete', {}); toast('Значок удалён'); data = await api('admin/emojis'); draw(); } catch (err) { toast(err.message); }
        }));
        sec.querySelector('[data-file]')?.addEventListener('change', async ev => {
            const f = ev.target.files[0]; if (!f) return;
            if (f.size > 6000000) { toast('Файл должен быть не больше 6 МБ'); return; }
            pull();
            try { const body = new FormData(); body.append('file', f); const r = await api('admin/emojis/media', body); form.media = r.url; form.kind = r.mime === 'video/webm' ? 'video' : 'image'; form.poster = ''; if (form.kind === 'video') { const blob = await posterFrom(f); if (blob) { const pb = new FormData(); pb.append('file', new File([blob], 'poster.png', {type: 'image/png'})); try { form.poster = (await api('admin/emojis/media', pb)).url; } catch (_) {} } } draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-save]')?.addEventListener('click', async () => {
            pull();
            try { await api('admin/emojis', {id: form.id, title: form.title, description: form.description, media: form.media, poster: form.poster, value: form.value, collection_id: form.collection_id, rarity: form.rarity, enabled: form.enabled}); toast('Значок сохранён'); form = null; data = await api('admin/emojis'); draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-give]')?.addEventListener('click', async () => {
            try { const r = await api('admin/emojis/grant', {user_id: sec.querySelector('[data-gid]').value.trim(), emoji_id: sec.querySelector('[data-gem]').value}); toast(r.new ? 'Значок выдан' : 'У игрока он уже есть'); } catch (err) { toast(err.message); }
        });
    };
    draw();
    content.appendChild(sec);
}
window.crafterEmojiAdmin = {admin};
})();
