/* Creators info page: the application form, the private ad videos and the section highlight. Chats live on a separate page (/creators/my). */
(function () {
    var $ = CR.$, esc = CR.esc;

    CR.onMe = function (d) { var dot = $('my-dot'); if (dot) dot.hidden = !d.unread; };

    /* ---------- application form: it only sends the application to the server ---------- */
    function applyModal() {
        var u = (CR.me && CR.me.user && CR.me.user.username) || '';
        CR.openModal('<h3>Заявка на выплату</h3><p class="hint">Платформа, ссылка на ролик, кошелёк для выплаты и запись экрана со статистикой.</p>' +
            '<div class="field"><span>Платформа</span><div class="plat"><button type="button" aria-pressed="true"><span class="logo-tt">' + CR.TT + '</span>TikTok</button></div></div>' +
            '<label class="field"><span>Ваш Telegram юзернейм</span><input type="text" id="f-user" maxlength="33" placeholder="@username" value="' + esc(u ? '@' + u : '') + '"></label>' +
            '<label class="field"><span>Ссылка на ролик в TikTok</span><input type="url" id="f-url" maxlength="300" placeholder="https://www.tiktok.com/@name/video/…"><span class="linkstat" id="f-linkstat" hidden></span></label>' +
            '<label class="field"><span>Кошелёк для выплаты (сеть Gram)</span><input type="text" id="f-wallet" maxlength="100" placeholder="Адрес кошелька в сети Gram"><span class="help">Выплата идёт на этот адрес. Проверьте его внимательно: ошибку в адресе мы исправить не сможем.</span></label>' +
            '<div class="steps-rec"><b>Запись экрана.</b> Включите запись экрана и снимите: зайдите в свой профиль TikTok, нажмите на ролик, откройте статистику и пролистайте все слайды. На записи должно быть видно, что вы владелец аккаунта и вся статистика ролика. Скриншоты не принимаются.</div>' +
            '<label class="drop" id="f-drop"><input type="file" id="f-file" accept="video/*"><span id="f-file-name">Нажмите, чтобы прикрепить запись экрана</span></label>' +
            '<div class="prog" id="f-prog" hidden><i></i></div><p class="err" id="f-err"></p>' +
            '<button type="button" class="btn big" id="f-send">Отправить заявку</button>');
        var file = $('f-file');
        var linkState = '', linkTimer = null, linkSeq = 0, stat = $('f-linkstat'), urlInput = $('f-url');
        var ICON = {busy: '<i class="ls-spin"></i>', enough: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>', few: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>', unknown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>'};
        function paintLink(state, text) { linkState = state; stat.hidden = !state; stat.className = 'linkstat is-' + state; stat.innerHTML = state ? ICON[state === 'bad_link' ? 'few' : state] + '<span>' + esc(text) + '</span>' : ''; }
        function checkLink() {
            var url = urlInput.value.trim(), seq = ++linkSeq;
            if (!url) return paintLink('', '');
            if (!/tiktok\.com/i.test(url)) return paintLink('bad_link', 'Вставьте ссылку на ролик в TikTok');
            paintLink('busy', 'Проверяем просмотры…');
            CR.api('/api/creators/check-link', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: url})}).then(function (d) {
                if (seq !== linkSeq) return;
                paintLink(d.state === 'enough' ? 'enough' : d.state === 'unknown' ? 'unknown' : 'few', d.message);
            }).catch(function (e) { if (seq === linkSeq) paintLink('unknown', e.message); });
        }
        urlInput.addEventListener('input', function () { clearTimeout(linkTimer); paintLink('', ''); linkTimer = setTimeout(checkLink, 650); });
        urlInput.addEventListener('paste', function () { clearTimeout(linkTimer); linkTimer = setTimeout(checkLink, 120); });
        urlInput.addEventListener('blur', function () { if (urlInput.value.trim() && !linkState) checkLink(); });
        file.addEventListener('change', function () { var f = file.files[0]; $('f-file-name').textContent = f ? f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' МБ' : 'Нажмите, чтобы прикрепить запись экрана'; $('f-drop').classList.toggle('has', !!f); });
        $('f-send').addEventListener('click', function () {
            var err = $('f-err'), btn = this; err.textContent = '';
            var f = file.files[0];
            if (!$('f-user').value.trim()) return err.textContent = 'Укажите ваш Telegram юзернейм';
            if (!/tiktok\.com/i.test($('f-url').value)) return err.textContent = 'Вставьте ссылку на ролик в TikTok';
            if (linkState === 'few' || linkState === 'bad_link') return err.textContent = stat.textContent || 'Ролик не подходит';
            if (linkState === 'busy') return err.textContent = 'Подождите, проверяем просмотры ролика';
            if (!$('f-wallet').value.trim()) return err.textContent = 'Укажите адрес кошелька в сети Gram';
            if (!f) return err.textContent = 'Прикрепите запись экрана со статистикой';
            if (f.size > 120 * 1048576) return err.textContent = 'Файл больше 120 МБ';
            var form = new FormData();
            form.append('platform', 'tiktok'); form.append('username', $('f-user').value.trim()); form.append('video_url', $('f-url').value.trim());
            form.append('wallet', $('f-wallet').value.trim()); form.append('record', f);
            btn.disabled = true; btn.textContent = 'Отправляем…'; $('f-prog').hidden = false;
            var xhr = new XMLHttpRequest(); xhr.open('POST', '/api/creators/apply');
            var h = CR.headers({}); Object.keys(h).forEach(function (k) { xhr.setRequestHeader(k, h[k]); });
            xhr.upload.onprogress = function (e) { if (e.lengthComputable) $('f-prog').firstChild.style.width = Math.round(e.loaded / e.total * 100) + '%'; };
            xhr.onload = function () {
                var d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) {}
                if (xhr.status >= 200 && xhr.status < 300 && d.number) {
                    CR.openModal('<div class="done"><div class="done-ring"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 14-16"/></svg></div><h3>Заявка отправлена</h3><div class="done-num">№ ' + d.number + '</div>' +
                        '<ul class="done-list"><li><i>1</i><div><b>Мы написали вам в бот</b><span>Там номер заявки и кнопка «Рассмотреть».</span></div></li><li><i>2</i><div><b>Проверим запись и ролик</b><span>Смотрим статистику, вставку и условия.</span></div></li><li><i>3</i><div><b>Ответим в чате</b><span>Статус и переписка с поддержкой на странице «Мои заявки».</span></div></li></ul>' +
                        '<div class="done-actions"><a class="btn big" href="/creators/my?app=' + d.number + '">Открыть мои заявки</a><button type="button" class="btn ghost big" id="done-close">Закрыть</button></div></div>');
                    CR.$('done-close').addEventListener('click', CR.closeModal);
                } else {
                    btn.disabled = false; btn.textContent = 'Отправить заявку'; $('f-prog').hidden = true;
                    err.textContent = (d && (d.error || d.description)) || (xhr.status === 413 ? 'Файл слишком большой' : 'Не удалось отправить, ошибка ' + xhr.status);
                }
            };
            xhr.onerror = function () { btn.disabled = false; btn.textContent = 'Отправить заявку'; err.textContent = 'Нет связи. Проверьте интернет и попробуйте ещё раз.'; };
            xhr.send(form);
        });
    }
    ['apply-open', 'apply-top', 'apply-bottom'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', function () { CR.withLogin(applyModal); }); });
    /* ---------- the ad videos: private, shown only to a signed-in player ---------- */
    function showBanners() {
        CR.api('/api/creators/banners').then(function (d) {
            var box = $('banners-box'); box.className = '';
            if (!d.banners.length) { box.innerHTML = '<p>Вставки пока не загружены. Напишите в поддержку: <a href="https://t.me/crafter_support">@crafter_support</a>.</p>'; return; }
            box.innerHTML = '<p>Готовые вставки Crafter в формате 9:16. Используйте их без обрезки, ускорения и изменений. Ссылки личные и действуют 15 минут: если видео не открывается, обновите страницу.</p><div class="vgrid">' + d.banners.map(function (b) {
                return '<div class="vcard"><video controls preload="metadata" playsinline controlsList="nodownload" src="' + esc(b.url) + '"></video><b>' + esc(b.title) + '</b><p>' + esc(b.note) + '</p><a class="btn small" href="' + esc(b.url) + '?download=1">Скачать · ' + b.size + ' МБ</a></div>';
            }).join('') + '</div>';
        }).catch(function () {});
    }
    var openBanners = $('banners-open');
    if (openBanners) openBanners.addEventListener('click', function () { CR.withLogin(showBanners); });

    /* ---------- the contents on the right: highlight the section we are in ---------- */
    (function () {
        var secs = [].slice.call(document.querySelectorAll('main section[id]')), links = [].slice.call(document.querySelectorAll('.toc a[href^="#"]'));
        if (!secs.length || !links.length) return;
        function mark(id) { links.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + id); }); }
        function spy() {
            var line = window.innerHeight * 0.42, current = secs[0].id;
            secs.forEach(function (s) {
                var top = s.getBoundingClientRect().top;
                if (top <= line) current = s.id;
                if (top < window.innerHeight * 0.95) s.classList.add('in');
            });
            if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = secs[secs.length - 1].id;
            mark(current);
        }
        window.addEventListener('scroll', spy, {passive: true}); window.addEventListener('resize', spy); spy();
        if ('IntersectionObserver' in window) {
            var rv = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); rv.unobserve(e.target); } }); }, {threshold: .06});
            secs.forEach(function (s) { s.classList.add('rv'); rv.observe(s); });
        }
    })();
    if (new URLSearchParams(location.search).get('apply')) CR.withLogin(applyModal);
    else CR.loadMe().catch(function () {});
})();
