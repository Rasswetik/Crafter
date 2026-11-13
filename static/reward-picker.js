/* The window «what to add»: a pack, a chest, GRAM, balls, a gift (NFT) or a gift of Telegram.
   A pack and a chest ask which one and how many; GRAM and balls ask the amount; a gift asks the collection and the model.
   window.crafterRewardPicker.open(cfg, onAdd): cfg = {packs, chests, stars, cols, models(cid) -> Promise of a list}; onAdd gets {kind, amount, count}. */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TYPES = [['PACK', 'Пак', '/static/assets/packs/new-year-pack.webp'], ['CHEST', 'Ящик', '/static/assets/chests/gingerbread.png'], ['GRAM', 'GRAM', '/static/assets/gram.svg'],
    ['BALL', 'Шары', '/static/assets/new-year-ornament.svg'], ['NFT', 'Подарок (NFT)', '/static/assets/stargifts/bear.png'], ['STAR', 'Подарок Telegram', '/static/assets/stargifts/bear.png']];

function open(cfg, onAdd) {
    const wrap = document.createElement('div');
    wrap.className = 'bnd-modal';
    const close = () => wrap.remove();
    const done = x => { close(); onAdd(x); };
    const shell = (title, body) => { wrap.innerHTML = '<div class="bnd-box"><div class="bnd-top"><b>' + title + '</b><button type="button" data-x aria-label="Закрыть">×</button></div>' + body + '</div>'; wrap.querySelector('[data-x]').addEventListener('click', close); };
    const counter = () => '<div class="bnd-count"><label>Сколько штук</label><input type="number" min="1" max="20" value="1" data-bnd-n><button type="button" class="primary" data-bnd-ok>Добавить</button></div>';
    const n = () => Math.max(1, Math.min(20, Math.floor(Number(wrap.querySelector('[data-bnd-n]').value) || 1)));
    const pickOne = kind => {
        const list = kind === 'PACK' ? (cfg.packs || []).map(p => ({id: p.id, title: p.title, image: p.image})) : (cfg.chests || []);
        shell(kind === 'PACK' ? 'Какой пак?' : 'Какой ящик?', '<div class="bnd-grid">' + (list.length ? list.map(x => '<button type="button" class="bnd-opt" data-id="' + e(x.id) + '"><img src="' + e(x.image) + '" alt=""><span>' + e(x.title) + '</span></button>').join('') : '<p class="sub">Пока нечего выбрать.</p>') + '</div>');
        wrap.querySelectorAll('.bnd-opt').forEach(b => b.addEventListener('click', () => {
            const x = list.find(y => y.id === b.dataset.id);
            shell(e(x.title), '<div class="bnd-one"><img src="' + e(x.image) + '" alt=""></div>' + counter());
            wrap.querySelector('[data-bnd-ok]').addEventListener('click', () => done({kind, amount: x.id, count: n()}));
        }));
    };
    const amount = kind => {
        shell(kind === 'GRAM' ? 'Сколько GRAM?' : 'Сколько шаров?', '<div class="bnd-one"><img src="' + (kind === 'GRAM' ? '/static/assets/gram.svg' : '/static/assets/new-year-ornament.svg') + '" alt=""></div><div class="bnd-count"><label>Сумма</label><input inputmode="decimal" data-bnd-a placeholder="' + (kind === 'GRAM' ? '0.5' : '100') + '"><button type="button" class="primary" data-bnd-ok>Добавить</button></div>');
        wrap.querySelector('[data-bnd-ok]').addEventListener('click', () => {
            const v = wrap.querySelector('[data-bnd-a]').value.trim().replace(',', '.');
            if (!(Number(v) > 0)) { if (typeof toast === 'function') toast('Введите сумму'); return; }
            done({kind, amount: kind === 'BALL' ? String(Math.floor(Number(v))) : v, count: 1});
        });
    };
    const nft = async () => {
        const cols = cfg.cols || [];
        shell('Какой подарок?', '<div class="bnd-count"><label>Коллекция</label><select data-col>' + cols.map(c => '<option value="' + e(c.id) + '">' + e(c.name) + '</option>').join('') + '</select><label>Модель</label><select data-model><option>Загрузка…</option></select><button type="button" class="primary" data-bnd-ok>Добавить</button></div>');
        const col = wrap.querySelector('[data-col]'), model = wrap.querySelector('[data-model]');
        const fill = async () => { const list = cfg.models ? await cfg.models(col.value) : []; model.innerHTML = (list || []).map(m => '<option value="' + e(m.name) + '">' + e(m.name) + '</option>').join(''); };
        col.addEventListener('change', fill); fill();
        wrap.querySelector('[data-bnd-ok]').addEventListener('click', () => { if (col.value && model.value) done({kind: 'NFT', amount: col.value + ':' + model.value, count: 1}); });
    };
    const star = () => {
        shell('Какой подарок Telegram?', '<div class="bnd-count"><select data-star>' + (window.crafterStarGifts ? window.crafterStarGifts.options(cfg.stars || [], '') : '') + '</select>' + counter() + '</div>');
        wrap.querySelector('[data-bnd-ok]').addEventListener('click', () => { const v = wrap.querySelector('[data-star]').value; if (v) done({kind: 'STAR', amount: v, count: n()}); });
    };
    shell('Что добавить в приз?', '<div class="bnd-types">' + TYPES.filter(t => t[0] !== 'STAR' || (cfg.stars || []).length).map(([k, t, img]) => '<button type="button" class="bnd-type" data-type="' + k + '"><img src="' + img + '" alt=""><span>' + t + '</span></button>').join('') + '</div>');
    wrap.querySelectorAll('.bnd-type').forEach(b => b.addEventListener('click', () => { const k = b.dataset.type; if (k === 'PACK' || k === 'CHEST') pickOne(k); else if (k === 'GRAM' || k === 'BALL') amount(k); else if (k === 'NFT') nft(); else star(); }));
    wrap.addEventListener('click', ev => { if (ev.target === wrap) close(); });
    document.body.appendChild(wrap);
}

window.crafterRewardPicker = {open};
})();
