/* Creators info page: the calculator and the application form. Chats live on a separate page (/creators/my). */
(function () {
    var $ = CR.$, esc = CR.esc;

    /* ---------- calculator ---------- */
    (function () {
        var cat = $('calc-cat'), views = $('calc-views'), sum = $('calc-sum'), hint = $('calc-hint'), box = $('calc-box');
        if (!cat || !views) return;
        var minimum = Number(box.dataset.min || 10);
        var money = function (v) { return v.toFixed(2).replace('.', ',') + ' $'; };
        function count() {
            var rate = Number(cat.value), n = Math.max(0, Number(views.value) || 0), total = Math.round(n / 1000 * rate * 100) / 100, need = Math.ceil(minimum / rate * 1000);
            sum.textContent = money(total);
            hint.textContent = total >= minimum ? 'Минимум выплаты выполнен' : 'До выплаты нужно ещё ' + (need - n).toLocaleString('ru-RU') + ' просмотров (всего ' + need.toLocaleString('ru-RU') + ')';
        }
        cat.addEventListener('change', count); views.addEventListener('input', count); count();
    })();

    CR.onMe = function (d) { var dot = $('my-dot'); if (dot) dot.hidden = !d.unread; };

    /* ---------- application form: it only sends the application to the server ---------- */
    function applyModal() {
        var u = (CR.me && CR.me.user && CR.me.user.username) || '';
        CR.openModal('<h3>Заявка на выплату</h3><p class="hint">Платформа, ссылка на ролик, кошелёк для выплаты и запись экрана со статистикой.</p>' +
            '<div class="field"><span>Платформа</span><div class="plat"><button type="button" aria-pressed="true"><span class="logo-tt">' + CR.TT + '</span>TikTok</button></div></div>' +
            '<label class="field"><span>Ваш Telegram юзернейм</span><input type="text" id="f-user" maxlength="33" placeholder="@username" value="' + esc(u ? '@' + u : '') + '"></label>' +
            '<label class="field"><span>Ссылка на ролик в TikTok</span><input type="url" id="f-url" maxlength="300" placeholder="https://www.tiktok.com/@name/video/…"></label>' +
            '<label class="field"><span>Кошелёк для выплаты (сеть Gram)</span><input type="text" id="f-wallet" maxlength="100" placeholder="Адрес кошелька в сети Gram"><span class="help">Выплата идёт на этот адрес. Проверьте его внимательно: ошибку в адресе мы исправить не сможем.</span></label>' +
            '<div class="steps-rec"><b>Запись экрана.</b> Включите запись экрана и снимите: зайдите в свой профиль TikTok, нажмите на ролик, откройте статистику и пролистайте все слайды. На записи должно быть видно, что вы владелец аккаунта и вся статистика ролика. Скриншоты не принимаются.</div>' +
            '<label class="drop" id="f-drop"><input type="file" id="f-file" accept="video/*"><span id="f-file-name">Нажмите, чтобы прикрепить запись экрана</span></label>' +
            '<div class="prog" id="f-prog" hidden><i></i></div><p class="err" id="f-err"></p>' +
            '<button type="button" class="btn big" id="f-send">Отправить заявку</button>');
        var file = $('f-file');
        file.addEventListener('change', function () { var f = file.files[0]; $('f-file-name').textContent = f ? f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' МБ' : 'Нажмите, чтобы прикрепить запись экрана'; $('f-drop').classList.toggle('has', !!f); });
        $('f-send').addEventListener('click', function () {
            var err = $('f-err'), btn = this; err.textContent = '';
            var f = file.files[0];
            if (!$('f-user').value.trim()) return err.textContent = 'Укажите ваш Telegram юзернейм';
            if (!/tiktok\.com/i.test($('f-url').value)) return err.textContent = 'Вставьте ссылку на ролик в TikTok';
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
                    CR.openModal('<div class="ok-big"><div class="tick">✓</div><h3>Заявка №' + d.number + ' отправлена</h3><p class="hint">Мы рассмотрим её и ответим. Номер заявки мы написали вам в бот. Статус заявки и чат с поддержкой находятся на отдельной странице «Мои заявки».</p>' +
                        '<a class="btn big" href="/creators/my?app=' + d.number + '">Мои заявки</a></div>');
                } else {
                    btn.disabled = false; btn.textContent = 'Отправить заявку'; $('f-prog').hidden = true;
                    err.textContent = (d && (d.error || d.description)) || (xhr.status === 413 ? 'Файл слишком большой' : 'Не удалось отправить, ошибка ' + xhr.status);
                }
            };
            xhr.onerror = function () { btn.disabled = false; btn.textContent = 'Отправить заявку'; err.textContent = 'Нет связи. Проверьте интернет и попробуйте ещё раз.'; };
            xhr.send(form);
        });
    }
    $('apply-open').addEventListener('click', function () { CR.withLogin(applyModal); });
    if (new URLSearchParams(location.search).get('apply')) CR.withLogin(applyModal);
    else CR.loadMe().catch(function () {});
})();
