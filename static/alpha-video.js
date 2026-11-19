/* Badges are WebM videos with a transparent background. Chrome, Firefox, Edge and Android WebView play them transparent; iPhones
   (every iOS browser, Telegram's included) and desktop Safari draw an opaque rectangle instead. There the video is swapped for the
   same animation as an animated WebP with an alpha channel (<name>.alpha.webp next to <name>.webm). If that file is missing
   (a badge uploaded by an administrator) the still picture of the badge is used, or the video is left as it is. */
(function () {
    'use strict';
    const ua = navigator.userAgent || '';
    const ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /^((?!chrome|chromium|android|crios|fxios|edg|opr).)*safari/i.test(ua);
    if (!ios && !safari) return;

    const OWN = /^(\/static\/assets\/[A-Za-z0-9_./-]+)\.webm(?:\?.*)?$/;

    function swap(video) {
        if (video.dataset.alphaSwapped || video.hasAttribute('controls')) return;
        const src = video.getAttribute('src') || '';
        const own = OWN.exec(src);
        const poster = video.getAttribute('poster') || '';
        const still = own ? own[1] + '.png' : poster;
        const first = own ? own[1] + '.alpha.webp' : poster;
        if (!first) return;
        video.dataset.alphaSwapped = '1';
        const img = document.createElement('img');
        img.className = video.className;
        img.alt = '';
        img.draggable = false;
        img.setAttribute('aria-hidden', 'true');
        if (video.title) img.title = video.title;
        let tried = 0;
        img.onerror = () => {
            if (tried++ === 0 && still && still !== first) { img.src = still; return; }
            img.onerror = null;
            if (img.parentNode) img.replaceWith(video);          // nothing better exists: leave the video
        };
        img.src = first;
        if (video.parentNode) video.replaceWith(img);
    }

    function scan(root) {
        if (root.nodeType !== 1) return;
        if (root.tagName === 'VIDEO') swap(root);
        else root.querySelectorAll && root.querySelectorAll('video').forEach(swap);
    }

    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(scan)))
        .observe(document.documentElement, {childList: true, subtree: true});
    document.querySelectorAll('video').forEach(swap);
})();
