/* Badges («значки», animated emoji) of the player: a slot next to the name in the profile, a picker like the emoji status of Telegram, the badge next to the name everywhere.
   window.crafterBadge(emoji) -> html of a small animated badge (for lists of players, leaders, bids). */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const media = (em, cls) => !em ? '' : em.kind === 'video'
    ? '<video class="' + (cls || '') + '" src="' + e(em.media) + '" autoplay loop muted playsinline preload="auto" draggable="false" aria-hidden="true"></video>'
    : '<img class="' + (cls || '') + '" src="' + e(em.media || em.image) + '" alt="" draggable="false">';
const badge = (em, cls) => em ? '<span class="ce-badge ' + (cls || '') + '" title="' + e(em.title || '') + '">' + media(em) + '</span>' : '';
window.crafterBadge = badge;
window.crafterBadgeMedia = media;

/* ---- the page of a badge (the lot and the screen of a new badge): the animation on the left, on the right the collection, «УНИКАЛЬНЫЙ ЗНАЧОК», the description, «ВХОДИТ В КОЛЛЕКЦИЮ» ---- */
const BUBBLE = '<span class="ep-circle is-kind" aria-hidden="true">🙂</span>';
const circle = (src, cls) => '<span class="ep-circle ' + (cls || '') + '">' + (src ? '<img src="' + e(src) + '" alt="" draggable="false">' : '') + '</span>';
function panelHTML(em) {
    const c = em.collection;
    return '<div class="ep-panel">' +
        (c ? '<div class="ep-coll">' + circle(c.photo, 'is-big') + '<b>' + e(String(c.title).toUpperCase()) + '</b></div>' : '') +
        '<h2 class="ep-kind">' + BUBBLE + '<span>УНИКАЛЬНЫЙ ЗНАЧОК</span></h2>' +
        '<div class="ep-desc"><span>' + e(em.description || 'Особый значок.') + '</span></div>' +
        (c ? '<div class="ep-in"><small>ВХОДИТ В КОЛЛЕКЦИЮ</small><span class="ep-icons">' + circle(c.photo, 'is-plain') + '</span></div>' : '') +
        '</div>';
}
window.crafterEmojiPanelHTML = panelHTML;
/* the screen of a new badge: «ПОЛУЧЕН ЗНАЧОК», the picture, the collection, a button that puts it into the profile */
function reveal(list, done) {
    const got = (list || []).filter(Boolean);
    if (!got.length) { done && done(); return; }
    let i = 0;
    const el = document.createElement('div');
    el.className = 'ep-reveal';
    document.body.appendChild(el);
    const draw = () => {
        const x = got[i], em = x.emoji, last = i === got.length - 1;
        el.classList.remove('is-in');
        el.innerHTML = '<i class="ep-rays"></i><div class="ep-top"><small>' + (x.new === false ? 'ТАКОЙ ЗНАЧОК У ВАС УЖЕ БЫЛ' : 'ПОЛУЧЕН ЗНАЧОК') + '</small></div>' +
            '<div class="ep-lot"><div class="ep-hero ep-pop">' + media(em, 'ep-media') + '</div>' + panelHTML(em) + '</div>' +
            '<div class="ep-btns"><button type="button" class="ep-btn green" data-ep-ok>' + (last ? 'Отлично' : 'Дальше') + '</button>' + (x.new === false ? '' : '<button type="button" class="ep-btn blue" data-ep-set>Поставить в профиль</button>') + '</div>';
        requestAnimationFrame(() => el.classList.add('is-in'));
        el.querySelector('[data-ep-ok]').addEventListener('click', () => { if (last) { el.classList.remove('is-in'); setTimeout(() => { el.remove(); done && done(); }, 220); } else { i++; draw(); } });
        el.querySelector('[data-ep-set]')?.addEventListener('click', async ev => {
            const b = ev.currentTarget; b.disabled = true;
            try { const r = await api('emoji-status', {emoji_id: em.id}); if (state && state.me) state.me.status_emoji = r.status; decorate(); try { (window.toast || (() => {}))('Статус установлен: ' + em.title); } catch (_) {} b.textContent = 'Установлено'; } catch (err) { try { (window.toast || (() => {}))(err.message); } catch (_) {} b.disabled = false; }
        });
    };
    draw();
}
window.crafterEmojiReveal = reveal;

let mineCache = null;
async function mine(force) {
    if (!mineCache || force) { try { mineCache = await api('emojis'); } catch (_) { mineCache = {emojis: [], status: null}; } }
    return mineCache;
}
const status = () => (typeof state !== 'undefined' && state && state.me ? state.me.status_emoji : null) || null;

/* ---- the badge next to the name in the sidebar and in the slot of the profile ---- */
function decorate() {
    const st = status();
    document.querySelectorAll('.desktop-sidebar-identity b').forEach(b => {
        const have = b.querySelector(':scope > .ce-badge');
        if (!st) { have?.remove(); return; }
        if (have && have.dataset.id === st.id) return;
        have?.remove();
        b.insertAdjacentHTML('beforeend', badge(st, 'is-name'));
        b.querySelector(':scope > .ce-badge').dataset.id = st.id;
    });
    document.querySelectorAll('.ce-slot').forEach(fillSlot);
}
function fillSlot(btn) {
    const st = status();
    btn.classList.toggle('is-set', Boolean(st));
    const html = st ? media(st) : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.500 14.200c.9 1.100 2 1.700 3.500 1.700s2.600-.6 3.500-1.700"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/></svg>';
    if (btn.dataset.fill !== (st ? st.id : '')) { btn.innerHTML = html; btn.dataset.fill = st ? st.id : ''; }
    btn.title = st ? 'Статус: ' + st.title : 'Выбрать значок рядом с ником';
}

/* ---- the picker (like the emoji status of Telegram) ---- */
let picker = null;
function closePicker() { picker?.remove(); picker = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); }
const outside = ev => { if (picker && !picker.contains(ev.target) && !ev.target.closest('.ce-slot')) closePicker(); };
const onKey = ev => { if (ev.key === 'Escape') closePicker(); };
async function openPicker(anchor) {
    if (picker) { closePicker(); return; }
    picker = document.createElement('div');
    picker.className = 'ce-picker';
    picker.innerHTML = '<div class="ce-pick-head"><b>Статус</b><small>Значок рядом с вашим ником</small></div><div class="ce-pick-body"><p class="ce-pick-empty">Загрузка…</p></div>';
    document.body.appendChild(picker);
    place(anchor);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    const data = await mine(true);
    if (!picker) return;
    const cur = status();
    const body = picker.querySelector('.ce-pick-body');
    if (!data.emojis.length) {
        body.innerHTML = '<p class="ce-pick-empty">У вас пока нет значков.<br>Их можно купить в разделе <b>Season → Маркет</b> или получить в сезонном пассе.</p>';
    } else {
        body.innerHTML = '<div class="ce-pick-label">ВАШИ ЗНАЧКИ</div><div class="ce-pick-grid">' + (cur ? '<button type="button" class="ce-cell is-clear" data-clear title="Убрать статус">×</button>' : '') +
            data.emojis.map(m => '<button type="button" class="ce-cell' + (cur && cur.id === m.id ? ' is-on' : '') + '" data-id="' + e(m.id) + '" title="' + e(m.title) + '">' + media(m) + '</button>').join('') + '</div>';
        body.addEventListener('click', async ev => {
            const c = ev.target.closest('.ce-cell'); if (!c) return;
            try {
                const r = await api('emoji-status', {emoji_id: c.dataset.id || ''});
                if (state && state.me) state.me.status_emoji = r.status;
                mineCache = null;
                try { (window.toast || (() => {}))(r.status ? 'Статус установлен: ' + r.status.title : 'Статус убран'); } catch (_) {}
                closePicker(); decorate();
            } catch (err) { try { (window.toast || (() => {}))(err.message); } catch (_) {} }
        });
    }
    place(anchor);
}
function place(anchor) {
    if (!picker) return;
    if (innerWidth <= 760) { picker.classList.add('is-sheet'); picker.style.cssText = ''; return; }
    picker.classList.remove('is-sheet');
    const r = anchor.getBoundingClientRect(), w = Math.min(340, innerWidth - 24);
    picker.style.width = w + 'px';
    picker.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
    picker.style.top = Math.min(innerHeight - picker.offsetHeight - 12, r.bottom + 10) + 'px';
}

/* ---- the slot in the profile, right of the nick ---- */
function addProfileSlot() {
    document.querySelectorAll('.profile-card .identity h2, .portal-profile .profile-name h2').forEach(h => {
        if (h.querySelector('.ce-slot')) return;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ce-slot';
        h.appendChild(b);
        fillSlot(b);
        b.addEventListener('click', ev => { ev.stopPropagation(); openPicker(b); });
    });
}
let queued = 0;
new MutationObserver(() => { if (queued) return; queued = requestAnimationFrame(() => { queued = 0; addProfileSlot(); decorate(); }); })
    .observe(document.documentElement, {childList: true, subtree: true});
addProfileSlot(); decorate();
window.crafterEmojiStatus = {open: openPicker, decorate};
})();
