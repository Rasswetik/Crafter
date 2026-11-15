/* Мини-приложение «Проверка отзывов» */
const tg = window.Telegram && window.Telegram.WebApp;
try { tg && tg.ready(); tg && tg.expand(); tg && tg.setHeaderColor && tg.setHeaderColor('#ffffff');
  tg && tg.setBackgroundColor && tg.setBackgroundColor('#ffffff'); tg && tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hap = t => { try { tg && tg.HapticFeedback && (t === 'tap' ? tg.HapticFeedback.impactOccurred('light') : tg.HapticFeedback.notificationOccurred(t)); } catch (e) {} };

/* ---------- иконки ---------- */
const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  no: '<circle cx="12" cy="12" r="9"/><path d="m9.5 9.5 5 5m0-5-5 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
  clip: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
};
const ico = (n, s = 22, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;
const storeIco = n => n === 'App Store'
  ? '<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#1c7cf5"/><path d="M12 5.4 8 13m4-7.6 4 7.6M7.2 16.2h9.6M9.2 12.6h5.6" stroke="#fff" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>'
  : '<svg viewBox="0 0 24 24"><path d="M5 3.5v17l9-8.5z" fill="#00c6ff"/><path d="M5 3.5 14 12l3.2-3.2z" fill="#00e37a"/><path d="M5 20.5 14 12l3.2 3.2z" fill="#ff3d57"/><path d="m17.2 8.8 3 1.7c.9.5.9 1.9 0 2.4l-3 1.8-3.2-3z" fill="#ffc800"/></svg>';

/* ---------- состояние и API ---------- */
const S = { me: null, tab: 'search', session: [], q: { found: '', not_found: '' }, manual: false, mStore: 'unknown', tid: 0, draft: { app: '', text: '' } };

async function api(path, body) {
  const opt = { headers: { 'Content-Type': 'application/json', 'X-Init-Data': (tg && tg.initData) || '' } };
  if (body !== undefined) { opt.method = 'POST'; opt.body = JSON.stringify(body); }
  const r = await fetch('/api' + path, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'Ошибка ' + r.status); e.status = r.status; throw e; }
  return d;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2800); }
const openUrl = u => (tg && tg.openLink) ? tg.openLink(u) : window.open(u, '_blank', 'noopener');

/* ---------- утилиты ---------- */
const VL = { found: 'Найден', similar: 'Похожий', not_found: 'Не найден' };
const VT = { found: 'Отзыв найден', similar: 'Найден похожий отзыв', not_found: 'Отзыв не найден' };
function ring(score, v, size = 52) {
  const r = 21, c = 2 * Math.PI * r, pct = Math.round((score || 0) * 100);
  return `<div class="ringw ${v}" style="width:${size}px;height:${size}px"><svg class="ring" width="${size}" height="${size}" viewBox="0 0 52 52">
    <circle class="bgc" cx="26" cy="26" r="${r}" fill="none" stroke-width="5"/>
    <circle class="fg" cx="26" cy="26" r="${r}" fill="none" stroke-width="5" stroke="var(--cl)" style="--c:${c.toFixed(1)};--off:${(c * (1 - (score || 0))).toFixed(1)}"/></svg>
    <span style="color:var(--cl)">${pct}%</span></div>`;
}
function dayLabel(ts) {
  const d = new Date(ts * 1000), n = new Date(), s = x => x.toDateString();
  if (s(d) === s(n)) return 'Сегодня';
  if (s(d) === s(new Date(n - 864e5))) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}
const timeLabel = ts => new Date(ts * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const stars = n => '★'.repeat(n || 0);

/* ---------- карточки ---------- */
function itemCard(it) {
  const th = it.thumb ? `<img class="th" src="${it.thumb}" alt="">` : `<div class="th ph">${ico('pen', 22)}</div>`;
  return `<div class="card tap" data-act="open" data-id="${it.id}"><div class="cr ${it.verdict}">
    ${th}<div class="mid"><div class="mt"><span class="store">${storeIco(it.store)}${esc(it.store)}</span><span class="pill ${it.verdict}">${VL[it.verdict]}</span></div>
    <div class="an">${esc(it.app_name)}</div><div class="sn">${esc(it.text)}</div></div>${ring(it.score, it.verdict)}</div></div>`;
}
function sessionCard(t) {
  const th = t.thumb ? `<img class="th" src="${t.thumb}" alt="">` : `<div class="th ph">${ico('pen', 22)}</div>`;
  if (t.state === 'done') return itemCard(t.item);
  const s1 = t.state === 'scan' ? 'on' : 'done', s2 = t.state === 'check' ? 'on' : '';
  const dot = c => c === 'done' ? ico('check', 13, 3.4) : '';
  if (t.state === 'fail') return `<div class="card"><div class="cr">${th}<div class="mid"><div class="an">Не получилось</div><div class="sn">Попробуй другой скриншот или введи данные вручную</div></div></div>
    <div class="err">${esc(t.msg)}</div><div class="row2" style="padding:0 16px 16px"><button class="btn soft sm" data-act="manualfrom" data-t="${t.tid}">${ico('pen', 16)}Вручную</button><button class="btn line sm" data-act="rmsess" data-t="${t.tid}">Убрать</button></div></div>`;
  return `<div class="card"><div class="cr">${th.replace('class="th"', 'class="th shim"')}<div class="mid"><div class="an">${t.scan && t.scan.app_name ? esc(t.scan.app_name.split('|')[0]) : 'Проверяю отзыв…'}</div>
    <div class="sn">${t.scan && t.scan.review_text ? esc(t.scan.review_text) : 'Это займёт немного времени'}</div></div></div>
    <div class="prog"><div class="stp ${s1}"><span class="dot">${dot(s1)}</span>Читаю скриншот</div><div class="stp ${s2}"><span class="dot"></span>Ищу приложение и сверяю отзывы</div></div></div>`;
}

/* ---------- экраны ---------- */
function viewSearch() {
  const u = S.me.user, st = S.me.stats, hi = u.first_name || 'друг';
  return `<div class="screen">
  <div class="top"><div class="avatar">${esc((hi[0] || '?').toUpperCase())}</div><div><div class="hi">Здравствуйте</div><div class="name">${esc(hi)}</div></div><div class="sp"></div>
    <button class="badge" data-act="tab" data-t="settings">${ico('globe', 16)}${esc((S.me.countries.find(c => c.code === S.me.country) || {}).name || S.me.country)}</button></div>
  <h1 class="title">Проверь, что отзыв <em>опубликован</em></h1>
  <p class="lead">Отправь скриншот из App Store или Google Play. Магазин и текст я определю сам.</p>
  <div class="stats">
    <button class="stat ok" data-act="tab" data-t="found"><b>${st.found}</b><span>Найдено</span></button>
    <button class="stat bad" data-act="tab" data-t="not_found"><b>${st.not_found}</b><span>Не найдено</span></button>
    <div class="stat"><b>${st.total}</b><span>Всего</span></div></div>
  <div class="up" id="drop"><div class="up-in">
    <div class="up-art">${ico('image', 28, 1.8)}</div>
    <h2>Добавь скриншот отзыва</h2><p>Можно сразу несколько штук</p>
    <div class="btns"><button class="btn primary" data-act="pick">${ico('image', 20)}Выбрать скриншот</button>
      <button class="btn soft" data-act="paste">${ico('clip', 20)}Вставить из буфера</button></div>
    <button class="link" data-act="togglemanual">${ico('pen', 15)}${S.manual ? 'Скрыть ручной ввод' : 'Ввести отзыв вручную'}</button>
    ${S.manual ? manualForm() : ''}
  </div></div>
  <div class="sec"><h3>Проверки</h3><small id="scnt"></small></div><div id="session"></div></div>`;
}
function manualForm() {
  const o = (v, l) => `<button data-act="mstore" data-v="${v}" class="${S.mStore === v ? 'on' : ''}">${l}</button>`;
  return `<div class="form"><label>Приложение<input class="inp" id="mApp" placeholder="Название или ссылка на магазин" value="${esc(S.draft.app)}"></label>
    <label>Текст отзыва<textarea class="inp" id="mText" placeholder="Вставь текст отзыва">${esc(S.draft.text)}</textarea></label>
    <label>Где искать<div class="seg">${o('unknown', 'Везде')}${o('apple', 'App Store')}${o('play', 'Google Play')}</div></label>
    <button class="btn primary" data-act="mgo">Проверить отзыв</button></div>`;
}
function drawSession() {
  const el = $('#session'); if (!el) return;
  el.innerHTML = S.session.length ? S.session.map(sessionCard).join('') :
    `<div class="empty" style="padding:22px 10px"><div class="ill" style="width:72px;height:72px;border-radius:24px">${ico('search', 28, 1.8)}</div><b>Пока пусто</b>Результаты появятся здесь</div>`;
  const c = $('#scnt'); if (c) c.textContent = S.session.length ? S.session.length + ' шт.' : '';
}

function viewHistory(status) {
  const f = status === 'found', st = S.me.stats, n = f ? st.found : st.not_found;
  return `<div class="screen"><div class="top" style="margin-bottom:4px"><div><h1 class="title" style="margin:0;font-size:28px">${f ? 'Найденные' : 'Не найденные'}</h1>
    <p class="lead" style="font-size:14px">${n ? n + ' ' + plural(n, 'отзыв', 'отзыва', 'отзывов') : f ? 'Здесь будут опубликованные отзывы' : 'Здесь будут отзывы, которых нет в магазине'}</p></div></div>
    <div class="search">${ico('search', 18)}<input class="inp" id="hq" placeholder="Поиск по приложению или тексту" value="${esc(S.q[status])}"></div>
    <div id="hlist"></div></div>`;
}
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m > 1 && m < 5 ? b : m === 1 ? a : c; };
async function loadHistory(status) {
  const el = $('#hlist'); if (!el) return;
  try {
    const d = await api('/history?status=' + status + '&q=' + encodeURIComponent(S.q[status]));
    S.me.stats = d.stats; paintTabbar();
    if (S.tab !== status) return;
    S.items = Object.fromEntries(d.items.map(i => [i.id, i]));
    if (!d.items.length) {
      el.innerHTML = `<div class="empty"><div class="ill">${ico(status === 'found' ? 'ok' : 'no', 40, 1.8)}</div><b>${S.q[status] ? 'Ничего не нашлось' : 'Пока пусто'}</b>${S.q[status] ? 'Попробуй другой запрос' : 'Проверь первый отзыв на вкладке «Поиск»'}</div>`;
      return;
    }
    let last = '', h = '';
    for (const it of d.items) { const l = dayLabel(it.created); if (l !== last) { h += `<div class="day">${esc(l)}</div>`; last = l; } h += itemCard(it); }
    el.innerHTML = h;
  } catch (e) { el.innerHTML = `<div class="empty"><b>Ошибка</b>${esc(e.message)}</div>`; }
}

function viewSettings() {
  const u = S.me.user, st = S.me.stats, nm = u.first_name || 'Гость';
  return `<div class="screen"><h1 class="title" style="font-size:28px;margin-top:4px">Профиль</h1>
  <div class="prof"><div class="avatar">${esc((nm[0] || '?').toUpperCase())}</div><div><b>${esc(nm)}</b><span>${u.username ? '@' + esc(u.username) : 'Telegram'} · проверок: ${st.total}</span></div></div>
  <div class="sec"><h3>Страна магазина</h3></div>
  <div class="list">${S.me.countries.map(c => `<button class="li ${c.code === S.me.country ? 'on' : ''}" data-act="country" data-c="${c.code}"><span class="cc">${c.code.toUpperCase()}</span><span class="tx">${esc(c.name)}</span><span class="radio">${c.code === S.me.country ? ico('check', 13, 3.4) : ''}</span></button>`).join('')}</div>
  <p class="hint" style="margin:10px 4px">Отзыв ищется в магазине выбранной страны. Каждая проверка идёт заново, без кэша.</p>
  <div class="sec"><h3>Данные</h3></div>
  <button class="btn danger" data-act="clearall">${ico('trash', 18)}Очистить всю историю</button></div>`;
}

/* ---------- каркас ---------- */
const TABS = [['search', 'Поиск', 'search'], ['found', 'Найденные', 'ok'], ['not_found', 'Не найденные', 'no'], ['settings', 'Профиль', 'user']];
function paintTabbar() {
  const st = S.me ? S.me.stats : { found: 0, not_found: 0 };
  $('#tabbar').innerHTML = TABS.map(([k, l, i]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-t="${k}">${ico(i, 24, S.tab === k ? 2.2 : 1.8)}${l}
    ${k === 'found' && st.found ? `<span class="n g">${st.found}</span>` : ''}${k === 'not_found' && st.not_found ? `<span class="n">${st.not_found}</span>` : ''}</button>`).join('');
}
function render() {
  paintTabbar();
  const app = $('#app');
  if (S.tab === 'search') { app.innerHTML = viewSearch(); drawSession(); }
  else if (S.tab === 'settings') app.innerHTML = viewSettings();
  else { app.innerHTML = viewHistory(S.tab); loadHistory(S.tab); }
}
function go(tab) { if (S.tab === tab && tab !== 'search') return; S.tab = tab; hap('tap'); render(); window.scrollTo({ top: 0 }); }

/* ---------- шторка с деталями ---------- */
function openSheet(it) {
  S.cur = it;
  const found = it.verdict !== 'not_found', cl = it.verdict;
  const cn = S.me.countries.find(c => c.code === it.country);
  const m = (it.details.find(d => d.store === it.store) || {}).match;
  const rows = it.details.filter(d => !d.error).map(d => `<div><span style="display:flex;gap:8px;align-items:center"><span class="store" style="color:var(--ink)">${storeIco(d.store)}${esc(d.store)}</span></span>
    <b><span class="pill ${d.status}">${VL[d.status]} ${Math.round((d.score || 0) * 100)}%</span></b></div>`).join('');
  const linkLabel = it.store === 'Google Play' ? 'Открыть отзыв в Google Play' : 'Открыть отзывы в App Store';
  $('#sheet').innerHTML = `<div class="grab"></div><div class="vh ${cl}">${ring(it.score, cl, 112)}<h2>${VT[cl]}</h2>
    <p>Проверено отзывов: ${it.checked} · ${esc(timeLabel(it.created))}</p></div>
    <div class="kv"><div><span>Приложение</span><b>${it.app_url ? `<a href="#" data-act="ext" data-u="${esc(it.app_url)}" style="color:var(--brand);text-decoration:none">${esc(it.app_name)}</a>` : esc(it.app_name)}</b></div>
      <div><span>Магазин</span><b>${esc(it.store)}</b></div>${it.review_date ? `<div><span>Дата отзыва</span><b>${esc(it.review_date)}</b></div>` : ''}
      ${cn ? `<div><span>Страна</span><b>${esc(cn.name)}</b></div>` : ''}</div>
    <div class="quote mine"><small>Твой отзыв</small>${esc(it.text)}</div>
    ${found && m ? `<div class="quote theirs ${cl}"><small>Найденный в магазине · ${esc(m.author || '')} ${stars(m.rating)} ${esc(m.date || '')}</small>${esc((m.title ? m.title + '\n' : '') + (m.text || ''))}</div>` : ''}
    ${rows && it.details.length > 1 ? `<div class="kv">${rows}</div>` : ''}
    <div class="acts">${found && it.review_url ? `<button class="btn primary" data-act="ext" data-u="${esc(it.review_url)}">${ico('link', 19)}${linkLabel}</button>` : ''}
      <div class="row2"><button class="btn soft" data-act="recheck">${ico('refresh', 18)}Перепроверить</button><button class="btn danger" data-act="del">${ico('trash', 18)}Удалить</button></div></div>
    ${!found && it.store === 'App Store' ? '<p class="note">Apple отдаёт не все отзывы и с задержкой. «Не найден» значит «в доступной ленте нет».</p>' : ''}`;
  $('#scrim').classList.add('on'); $('#sheet').classList.add('on'); hap(found ? 'success' : 'warning');
}
function closeSheet() { $('#scrim').classList.remove('on'); $('#sheet').classList.remove('on'); }
$('#scrim').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ---------- добавление скриншотов ---------- */
function toB64(file) {
  return createImageBitmap(file).then(bmp => {
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .88).split(',')[1];
  });
}
function addFiles(files) {
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length) return;
  if (S.tab !== 'search') go('search');
  list.forEach(async f => {
    const t = { tid: ++S.tid, state: 'scan', thumb: URL.createObjectURL(f) };
    S.session.unshift(t); drawSession();
    try { t.b64 = await toB64(f); await pipeline(t); } catch (e) { t.state = 'fail'; t.msg = e.message; drawSession(); }
  });
}
async function pipeline(t) {
  t.state = 'scan'; drawSession();
  try {
    const sc = await api('/scan', { image: t.b64 }); t.scan = sc; if (sc.thumb) t.thumb = sc.thumb;
    if (!sc.app_name || !sc.review_text) { t.state = 'fail'; t.msg = 'Не удалось прочитать название приложения или текст отзыва.'; hap('error'); drawSession(); return; }
    t.state = 'check'; drawSession();
    await finishCheck(t, sc.app_name, sc.review_text, sc.store, sc.date, sc.rating);
  } catch (e) { t.state = 'fail'; t.msg = e.message; hap('error'); drawSession(); }
}
async function finishCheck(t, app, text, store, date, rating) {
  t.state = 'check'; drawSession();
  try {
    const r = await api('/check', { app, text, store: store || 'unknown', date, rating, thumb: t.thumb && t.thumb.startsWith('data:') ? t.thumb : null });
    t.item = r.item; t.state = 'done'; S.me.stats = r.stats; paintTabbar();
    const c = document.querySelectorAll('.stat b'); if (c.length === 3) { c[0].textContent = r.stats.found; c[1].textContent = r.stats.not_found; c[2].textContent = r.stats.total; }
    hap(r.item.found ? 'success' : 'warning'); drawSession();
  } catch (e) { t.state = 'fail'; t.msg = e.message; hap('error'); drawSession(); }
}
async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read(), fs = [];
    for (const it of items) { const ty = it.types.find(x => x.startsWith('image/')); if (ty) fs.push(new File([await it.getType(ty)], 'clipboard.png', { type: ty })); }
    if (fs.length) addFiles(fs); else toast('В буфере нет картинки. Скопируй скриншот и повтори');
  } catch (e) { toast('Нет доступа к буферу. Выбери скриншот из галереи'); }
}
document.addEventListener('paste', e => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const fs = [...(e.clipboardData ? e.clipboardData.items : [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
  if (fs.length) { e.preventDefault(); addFiles(fs); }
});
['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop') { $('#drop') && $('#drop').classList.remove('over'); addFiles(e.dataTransfer.files); } else $('#drop') && $('#drop').classList.add('over'); }));
window.addEventListener('dragleave', () => $('#drop') && $('#drop').classList.remove('over'));
$('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };

/* ---------- действия ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'tab') return go(b.dataset.t);
  if (a === 'pick') return $('#file').click();
  if (a === 'paste') return pasteFromClipboard();
  if (a === 'togglemanual') { keepDraft(); S.manual = !S.manual; return render(); }
  if (a === 'mstore') { keepDraft(); S.mStore = b.dataset.v; return render(); }
  if (a === 'mgo') {
    keepDraft(); const { app, text } = S.draft;
    if (!app.trim() || !text.trim()) return toast('Заполни приложение и текст отзыва');
    const t = { tid: ++S.tid, state: 'check', scan: { app_name: app, review_text: text } }; S.session.unshift(t);
    S.draft = { app: '', text: '' }; S.manual = false; render();
    return finishCheck(t, app, text, S.mStore);
  }
  if (a === 'manualfrom') {
    const t = S.session.find(x => x.tid == b.dataset.t); S.draft = { app: (t.scan && t.scan.app_name || '').split('|')[0], text: t.scan && t.scan.review_text || '' };
    S.session = S.session.filter(x => x !== t); S.manual = true; return render();
  }
  if (a === 'rmsess') { S.session = S.session.filter(x => x.tid != b.dataset.t); return drawSession(); }
  if (a === 'open') {
    const id = +b.dataset.id; let it = (S.items || {})[id];
    if (!it) { const t = S.session.find(x => x.item && x.item.id === id); it = t && t.item; }
    return it && openSheet(it);
  }
  if (a === 'ext') { e.preventDefault(); return openUrl(b.dataset.u); }
  if (a === 'del') {
    await api('/delete', { id: S.cur.id }).then(d => { S.me.stats = d.stats; });
    S.session = S.session.filter(x => !(x.item && x.item.id === S.cur.id)); closeSheet(); hap('tap'); toast('Удалено'); return render();
  }
  if (a === 'recheck') {
    const it = S.cur; closeSheet(); go('search');
    const t = { tid: ++S.tid, state: 'check', thumb: it.thumb, scan: { app_name: it.app_name, review_text: it.text } }; S.session.unshift(t); drawSession();
    await api('/delete', { id: it.id }).catch(() => {});
    return finishCheck(t, it.app_name, it.text, it.store === 'App Store' ? 'apple' : 'play', it.review_date, it.rating);
  }
  if (a === 'country') {
    await api('/settings', { country: b.dataset.c }); S.me.country = b.dataset.c; hap('tap'); toast('Страна сохранена'); return render();
  }
  if (a === 'clearall') {
    const ok = tg && tg.showConfirm ? await new Promise(r => tg.showConfirm('Удалить всю историю проверок?', r)) : confirm('Удалить всю историю проверок?');
    if (!ok) return;
    const d = await api('/clear', {}); S.me.stats = d.stats; S.session = []; hap('success'); toast('История очищена'); return render();
  }
});
function keepDraft() { const a = $('#mApp'), t = $('#mText'); if (a) S.draft.app = a.value; if (t) S.draft.text = t.value; }
document.addEventListener('input', e => {
  if (e.target.id === 'hq') { S.q[S.tab] = e.target.value; clearTimeout(S.dq); S.dq = setTimeout(() => loadHistory(S.tab), 280); }
});

/* ---------- запуск ---------- */
(async function boot() {
  try { S.me = await api('/me'); render(); }
  catch (e) {
    $('#tabbar').style.display = 'none';
    $('#app').innerHTML = `<div class="empty" style="padding-top:90px"><div class="ill">${ico('user', 40, 1.8)}</div><b>${e.status === 401 ? 'Откройте из Telegram' : 'Не удалось загрузиться'}</b>${esc(e.message)}</div>`;
  }
})();
