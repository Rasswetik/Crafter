/* Phones: no pinch or double-tap zoom, so the page stays put. */
(function () {
    'use strict';
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(name => document.addEventListener(name, e => e.preventDefault(), {passive: false}));
    document.addEventListener('touchmove', e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, {passive: false});
    let last = 0;
    document.addEventListener('touchend', e => { const now = Date.now(); if (now - last < 350) e.preventDefault(); last = now; }, {passive: false});
    document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, {passive: false});
})();
