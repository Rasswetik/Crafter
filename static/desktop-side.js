/* The left panel of Crafter (desktop): drag its right edge to change the width, double-click the edge to fold it to icons and back. */
(function () {
'use strict';
const KEY = 'crafter:side-width', MIN = 72, MAX = 360, MINI = 150;
const wide = () => innerWidth >= 1024;
let width = 0;
try { width = Number(localStorage.getItem(KEY)) || 0; } catch (_) {}
function apply(w, save) {
    width = Math.max(MIN, Math.min(MAX, Math.round(w)));
    if (width < 112) width = MIN;
    document.documentElement.style.setProperty('--crafter-desktop-side', width + 'px');
    document.querySelector('#crafter-desktop-sidebar')?.classList.toggle('side-mini', width < MINI);
    if (save) { try { localStorage.setItem(KEY, String(width)); } catch (_) {} }
}
function mount() {
    const side = document.querySelector('#crafter-desktop-sidebar');
    if (!side || side.querySelector('.desktop-side-grip')) return;
    const grip = document.createElement('div');
    grip.className = 'desktop-side-grip';
    grip.title = 'Потяните, чтобы изменить ширину панели. Двойной щелчок: свернуть до значков';
    side.appendChild(grip);
    grip.addEventListener('pointerdown', ev => {
        ev.preventDefault(); document.body.classList.add('side-sizing');
        const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--crafter-desktop-gutter')) || 18;
        const move = e2 => apply(e2.clientX - gutter, false);
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('side-sizing'); apply(width, true); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => apply(width < MINI ? 248 : MIN, true));
    if (width && wide()) apply(width, false);
}
if (width && wide()) document.documentElement.style.setProperty('--crafter-desktop-side', width + 'px');
const start = () => { mount(); setInterval(mount, 1500); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
