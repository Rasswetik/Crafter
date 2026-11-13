/* Administrator: chains of offers. A chain is a main gift (step 1) and any number of next steps; each step has a picture, a reward and a price. */
(function () {
'use strict';
const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])));
const toMsk = epoch => new Date((epoch + 3 * 3600) * 1000).toISOString().slice(0, 16);
const KINDS = [['GRAM', 'GRAM'], ['BALL', 'Шары'], ['PACK', 'Пак'], ['STAR', 'Подарок Telegram'], ['CHEST', 'Ящик'], ['NFT', 'Прямой NFT']];

async function admin(content) {
    let r, packs = [], STARS = [], CHESTS = [], COLS = [], LIB = [], SECTIONS = [];
    const MODELS = {};
    try { r = await api('admin/new-year/chains'); } catch (_) { return; }
    try { packs = (await api('admin/new-year/packs')).packs || []; } catch (_) {}
    try { STARS = window.crafterStarGifts ? await window.crafterStarGifts.catalog() : []; } catch (_) {}
    try { CHESTS = (await api('admin/new-year/chests')).chests.map(c => c.chest); } catch (_) {}
    try { COLS = (await api('admin/new-year/catalog')).collections; } catch (_) {}
    try { LIB = (await api('admin/new-year/shop-bg-library')).library; } catch (_) {}
    try { SECTIONS = ((await api('admin/new-year/shop')).sections || []).filter(x => x.kind !== 'exchange' && x.id !== 'gifts'); } catch (_) {}
    if (!content?.isConnected) return;
    const sec = document.createElement('section');
    sec.className = 'ny-admin-section';
    sec.dataset.pane = 'chains';
    content.appendChild(sec);
    let sel = r.chains[0]?.id || '', form = null;
    const reload = async () => { try { r = await api('admin/new-year/chains'); } catch (_) {} draw(); };
    const run = async (fn, ok) => { try { const out = await fn(); if (ok) toast(ok); await reload(); return out; } catch (err) { toast(err.message); } };
    const field = (label, input, hint) => '<div class="adm-field"><label>' + label + '</label>' + input + (hint ? '<small class="sub">' + hint + '</small>' : '') + '</div>';
    const uploadMedia = async file => { if (file.size > 15000000) throw new Error('Файл слишком большой (до 15 МБ)'); const b = new FormData(); b.append('file', file); return (await api('admin/new-year/shop-media', b)).url; };
    const loadModels = async cid => {
        if (MODELS[cid] !== undefined) return;
        MODELS[cid] = null;
        try { MODELS[cid] = (await api('admin/new-year/catalog/' + encodeURIComponent(cid) + '/models')).models; } catch (_) { MODELS[cid] = []; }
        if (form) { pull(); draw(); }
    };
    const blank = () => ({rewards: [], price_balls: '0', label: '', caption: '', image: ''});
    const fresh = () => ({id: '', title: 'Новая акция', subtitle: '', enabled: true, section_id: '', bg: '', starts_at_msk: '', ends_at_msk: '', steps: [
        Object.assign(blank(), {label: 'Шаг 1', rewards: [{kind: 'PACK', amount: packs[0]?.id || '', count: 1}]}), Object.assign(blank(), {label: 'Шаг 2', rewards: [{kind: 'GRAM', amount: '0.5', count: 1}]})]});
    const edit = c => ({id: c.id, title: c.title, subtitle: c.subtitle, enabled: c.enabled, section_id: c.section_id, bg: c.bg, starts_at_msk: c.starts_at ? toMsk(c.starts_at) : '', ends_at_msk: c.ends_at ? toMsk(c.ends_at) : '',
        steps: c.steps.map(s => ({id: s.id, rewards: (s.rewards || []).map(r => ({kind: r.kind, amount: r.amount, count: r.count})), price_balls: String(s.price_balls), label: s.label, caption: s.caption, image: s.own_image}))});
    const pull = () => {
        sec.querySelectorAll('[data-chf]').forEach(i => { form[i.dataset.chf] = i.value; });
        sec.querySelectorAll('[data-chs]').forEach(i => { const [n, k] = i.dataset.chs.split('.'); if (form.steps[+n]) form.steps[+n][k] = i.value; });
    };
    /* a prize in a step is a cell: a picture, the amount and the name */
    const rewardInfo = r => r.kind === 'PACK' ? {img: packs.find(p => p.id === r.amount)?.image || '', name: packs.find(p => p.id === r.amount)?.title || 'Пак', n: '×' + r.count}
        : r.kind === 'CHEST' ? {img: CHESTS.find(c => c.id === r.amount)?.image || '', name: CHESTS.find(c => c.id === r.amount)?.title || 'Ящик', n: '×' + r.count}
        : r.kind === 'GRAM' ? {img: '/static/assets/gram.svg', name: 'GRAM', n: String(r.amount)} : r.kind === 'BALL' ? {img: '/static/assets/new-year-ornament.svg', name: 'Шары', n: Number(r.amount).toLocaleString('ru-RU')}
        : r.kind === 'STAR' ? {img: STARS.find(x => x.key === r.amount)?.image || '', name: STARS.find(x => x.key === r.amount)?.name || 'Подарок', n: '×' + r.count}
        : {img: '', name: String(r.amount).split(':').slice(1).join(':') || 'NFT', n: (COLS.find(c => c.id === String(r.amount).split(':')[0]) || {}).name || 'NFT'};
    const stepCard = (s, i, n) => '<div class="cha-step"><div class="cha-top"><b>' + (i ? 'Шаг ' + (i + 1) : 'Шаг 1 · главная награда') + '</b><span><button type="button" data-st-up="' + i + '"' + (i ? '' : ' disabled') + '>↑</button><button type="button" data-st-down="' + i + '"' + (i < n - 1 ? '' : ' disabled') + '>↓</button><button type="button" class="danger" data-st-del="' + i + '">×</button></span></div>' +
        '<div class="cha-grid"><div class="cha-pic">' + (s.image ? '<img src="' + e(s.image) + '" alt="">' : '<span>PNG</span>') + '<label class="cha-up">Загрузить PNG<input type="file" accept="image/png,image/webp,image/jpeg" hidden data-st-img="' + i + '"></label>' + (s.image ? '<a href="#" data-st-noimg="' + i + '">Убрать</a>' : '') + '</div>' +
        '<div>' + field('Заголовок', '<input data-chs="' + i + '.label" maxlength="24" value="' + e(s.label) + '" placeholder="Шаг ' + (i + 1) + '">') + field('Подпись', '<input data-chs="' + i + '.caption" maxlength="40" value="' + e(s.caption) + '" placeholder="Например: СЛУЧАЙНО">') +
        field('Цена, шаров', '<input data-chs="' + i + '.price_balls" type="number" min="0" value="' + e(s.price_balls) + '">', Number(s.price_balls) > 0 ? '' : 'Бесплатно: на карточке «ПОДАРОК»') + '</div>' +
        '<div class="cha-prizes"><label>Призы шага</label><div class="bnd-cells">' + s.rewards.map((r, j) => { const v = rewardInfo(r); return '<div class="bnd-cell"><button type="button" class="bnd-x" data-rw-del="' + i + '.' + j + '" aria-label="Убрать">×</button>' + (v.img ? '<img src="' + e(v.img) + '" alt="">' : '<i class="bnd-gift">🎁</i>') + '<b>' + e(v.n) + '</b><span>' + e(v.name) + '</span></div>'; }).join('') +
        '<button type="button" class="bnd-cell bnd-plus" data-rw-add="' + i + '" aria-label="Добавить приз"><i>+</i><span>Добавить</span></button></div></div></div></div>';
    const draw = () => {
        const cur = r.chains.find(c => c.id === sel);
        let html = '<h3>Цепочки акций</h3><p class="sub">Первая карточка — главная награда, дальше идут шаги: бесплатные («ПОДАРОК») или за шары. Следующий шаг открывается, когда взят предыдущий. Цепочка появляется плиткой в разделе «Акции» (или в выбранном разделе).</p>' +
            '<div class="cxa-list">' + r.chains.map(c => '<button type="button" class="cxa-pick' + (c.id === sel && !form ? ' is-on' : '') + '" data-ch-pick="' + e(c.id) + '"><span>' + e(c.title) + (c.enabled ? '' : ' · выключена') + ' · шагов ' + c.total + '</span></button>').join('') + '<button type="button" class="cxa-pick cxa-new" data-ch-new>+ Новая цепочка</button></div>';
        if (!form && cur) {
            html += '<div class="cxa-card"><b>' + e(cur.title) + '</b> <small class="sub">' + e(cur.subtitle) + ' · взяли хотя бы один шаг: ' + cur.players + '</small><div class="cxa-loot">' + cur.steps.map(s => '<span><img src="' + e(s.image) + '" alt="">' + e(s.label) + ': ' + e(s.reward_title) + ' · ' + (s.price_balls ? s.price_balls + ' шаров' : 'подарок') + '</span>').join('') + '</div>' +
                '<div class="adm-chips"><button type="button" class="primary" data-ch-edit>Изменить</button><button type="button" class="danger" data-ch-del>Удалить</button></div></div>';
        }
        if (form) {
            html += '<div class="cxa-card"><h4>' + (form.id ? 'Изменить цепочку' : 'Новая цепочка') + '</h4><div class="adm-row3">' + field('Название акции', '<input data-chf="title" maxlength="60" value="' + e(form.title) + '">') + field('Подпись', '<input data-chf="subtitle" maxlength="80" value="' + e(form.subtitle) + '" placeholder="Например: Ура!">') +
                field('Показывать игрокам', '<div class="adm-chips">' + [['1', 'Да'], ['0', 'Нет']].map(([v, t]) => '<button type="button" class="' + ((form.enabled ? '1' : '0') === v ? 'is-on' : '') + '" data-ch-on="' + v + '">' + t + '</button>').join('') + '</div>') + '</div>' +
                '<div class="adm-row3">' + field('Раздел', '<select data-chf="section_id"><option value="">Акции (по умолчанию)</option>' + SECTIONS.map(x => '<option value="' + e(x.id) + '"' + (form.section_id === x.id ? ' selected' : '') + '>' + e(x.title) + '</option>').join('') + '</select>') +
                field('Появится (по Москве)', '<input type="datetime-local" data-chf="starts_at_msk" value="' + e(form.starts_at_msk) + '">', 'Пусто: сразу') + field('Закончится (по Москве)', '<input type="datetime-local" data-chf="ends_at_msk" value="' + e(form.ends_at_msk) + '">', 'Пусто: без конца') + '</div>' +
                field('Фон акции (PNG)', '<div class="fm-gal">' + LIB.map(x => '<span class="fm-sw fm-swlib' + (form.bg === 'image:' + x.url ? ' is-on' : '') + '"><button type="button" class="fm-swlibpick" data-ch-bg="image:' + e(x.url) + '"><span class="fm-swp" style="background-image:url(' + e(x.url) + ')"></span><em>' + e(x.name) + '</em></button></span>').join('') +
                    '<label class="fm-sw fm-swup' + (form.bg ? ' is-on' : '') + '"><span class="fm-swp"' + (form.bg ? ' style="background-image:url(' + e(form.bg.slice(6)) + ')"' : '') + '><b>+</b></span><em>Свой PNG-фон</em><input type="file" accept="image/png,image/webp,image/jpeg" hidden data-ch-bgfile></label></div>', form.bg ? '<a href="#" data-ch-nobg>Вернуть фиолетовый по умолчанию</a>' : 'Пусто: фиолетовый градиент') +
                '<h4>Шаги</h4>' + form.steps.map((s, i) => stepCard(s, i, form.steps.length)).join('') + '<button type="button" data-ch-add>+ Добавить шаг</button>' +
                '<div class="adm-chips" style="margin-top:14px"><button type="button" class="primary" data-ch-save>Сохранить</button><button type="button" data-ch-cancel>Отмена</button></div></div>';
        }
        sec.innerHTML = html;
        bind();
    };
    const bind = () => {
        sec.querySelectorAll('[data-ch-pick]').forEach(b => b.addEventListener('click', () => { form = null; sel = b.dataset.chPick; draw(); }));
        sec.querySelector('[data-ch-new]')?.addEventListener('click', () => { form = fresh(); draw(); });
        sec.querySelector('[data-ch-edit]')?.addEventListener('click', () => { form = edit(r.chains.find(c => c.id === sel)); draw(); });
        sec.querySelector('[data-ch-del]')?.addEventListener('click', () => { if (confirm('Удалить акцию и прогресс игроков?')) run(() => api('admin/new-year/chains/' + sel + '/delete', {}), 'Акция удалена'); });
        if (!form) return;
        sec.querySelectorAll('[data-ch-on]').forEach(b => b.addEventListener('click', () => { pull(); form.enabled = b.dataset.chOn === '1'; draw(); }));
        sec.querySelectorAll('[data-ch-bg]').forEach(b => b.addEventListener('click', () => { pull(); form.bg = b.dataset.chBg; draw(); }));
        sec.querySelector('[data-ch-nobg]')?.addEventListener('click', ev => { ev.preventDefault(); pull(); form.bg = ''; draw(); });
        sec.querySelector('[data-ch-bgfile]')?.addEventListener('change', async ev => {
            const f = ev.target.files[0]; if (!f) return; pull();
            try { const url = await uploadMedia(f); form.bg = 'image:' + url; try { LIB = (await api('admin/new-year/shop-bg-library', {url, name: f.name.replace(/\.[^.]+$/, '')})).library; } catch (_) {} draw(); } catch (err) { toast(err.message); }
        });
        sec.querySelector('[data-ch-add]')?.addEventListener('click', () => { pull(); form.steps.push(Object.assign(blank(), {label: 'Шаг ' + (form.steps.length + 1)})); draw(); });
        sec.querySelectorAll('[data-st-del]').forEach(b => b.addEventListener('click', () => { pull(); if (form.steps.length > 1) form.steps.splice(+b.dataset.stDel, 1); draw(); }));
        const move = (i, d) => { pull(); const j = i + d; if (j < 0 || j >= form.steps.length) return; [form.steps[i], form.steps[j]] = [form.steps[j], form.steps[i]]; draw(); };
        sec.querySelectorAll('[data-st-up]').forEach(b => b.addEventListener('click', () => move(+b.dataset.stUp, -1)));
        sec.querySelectorAll('[data-st-down]').forEach(b => b.addEventListener('click', () => move(+b.dataset.stDown, 1)));
        sec.querySelectorAll('[data-rw-add]').forEach(b => b.addEventListener('click', () => {
            pull(); const i = +b.dataset.rwAdd;
            window.crafterRewardPicker.open({packs, chests: CHESTS, stars: STARS, cols: COLS, models: async cid => { await loadModels(cid); return MODELS[cid] || []; }}, x => { form.steps[i].rewards.push(x); draw(); });
        }));
        sec.querySelectorAll('[data-rw-del]').forEach(b => b.addEventListener('click', () => { pull(); const [i, j] = b.dataset.rwDel.split('.').map(Number); form.steps[i].rewards.splice(j, 1); draw(); }));
        sec.querySelectorAll('[data-st-img]').forEach(i => i.addEventListener('change', async () => { const f = i.files[0]; if (!f) return; pull(); try { form.steps[+i.dataset.stImg].image = await uploadMedia(f); draw(); } catch (err) { toast(err.message); } }));
        sec.querySelectorAll('[data-st-noimg]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); pull(); form.steps[+a.dataset.stNoimg].image = ''; draw(); }));
        sec.querySelector('[data-ch-cancel]')?.addEventListener('click', () => { form = null; draw(); });
        sec.querySelector('[data-ch-save]')?.addEventListener('click', async () => {
            pull();
            const out = await run(() => api('admin/new-year/chains', {id: form.id || undefined, title: form.title, subtitle: form.subtitle, enabled: form.enabled, section_id: form.section_id, bg: form.bg, starts_at_msk: form.starts_at_msk, ends_at_msk: form.ends_at_msk,
                steps: form.steps.map(s => ({id: s.id || undefined, rewards: s.rewards, price_balls: s.price_balls || 0, label: s.label, caption: s.caption, image: s.image}))}), 'Акция сохранена');
            if (out) { sel = out.id; form = null; draw(); }
        });
    };
    draw();
}

window.crafterChainsAdmin = {admin};
})();
