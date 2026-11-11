/* Opened from Telegram as https://t.me/<bot>?startapp=creators: go to the creators page (the page is not linked from the app). */
(function () {
    function go() { if (location.pathname !== '/creators') location.replace('/creators'); }
    try {
        var raw = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1)).get('tgWebAppStartParam');
        if (raw === 'creators') { go(); return; }
    } catch (e) {}
    var tries = 0, timer = setInterval(function () {
        tries++;
        try {
            var tg = window.Telegram && window.Telegram.WebApp;
            if (tg && tg.initDataUnsafe) {
                clearInterval(timer);
                if (tg.initDataUnsafe.start_param === 'creators') go();
            }
        } catch (e) {}
        if (tries > 40) clearInterval(timer);
    }, 100);
})();
