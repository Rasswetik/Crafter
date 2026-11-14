/* Winter garland, drawn for the real width of the app (never stretched): rope with needles, glass bulbs with
   highlights, and every bulb gently twinkling in three alternating groups. Decorative only. */
(function () {
'use strict';
const COLORS = ['#ff5a5a', '#ffd25e', '#5ccfff', '#7be38f', '#ff82d6'];
const SAGS = [15, 22, 18, 25, 16, 21];
const HEIGHT = 56;

function quad(p0, c, p1, t) {
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

function draw(width) {
    const swags = Math.max(3, Math.round(width / (width < 420 ? 82 : 96)));
    const step = width / swags;
    const rope = [], bulbs = [[], [], []];
    let counter = 0;
    for (let i = 0; i < swags; i++) {
        const x0 = i * step, x1 = x0 + step, sag = SAGS[i % SAGS.length];
        const p0 = [x0, 3], p1 = [x1, 3], c = [(x0 + x1) / 2, 3 + sag * 2];
        rope.push(`M${x0.toFixed(1)} 3Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${x1.toFixed(1)} 3`);
        for (const t of [0.13, 0.3, 0.5, 0.7, 0.87]) {
            const [x, y] = quad(p0, c, p1, t);
            const color = COLORS[counter % COLORS.length];
            const group = 'g' + (counter % 3);
            bulbs[counter % 3].push(`<g class="wg-bulb ${group}" style="--i:${counter}" transform="translate(${x.toFixed(1)} ${(y + 1).toFixed(1)})">
                <circle class="wg-glow" cy="8" r="11" fill="url(#wg-g${counter % COLORS.length})"/>
                <rect x="-1.8" y="0" width="3.6" height="3.2" rx=".8" fill="#12301f"/>
                <path d="M-3.7 3c0 5.4 1.7 9.4 3.7 9.4s3.7-4 3.7-9.4Z" fill="${color}"/>
                <path d="M-3.7 3c0 5.4 1.7 9.4 3.7 9.4s3.7-4 3.7-9.4Z" fill="url(#wg-shade)"/>
                <ellipse cx="-1.3" cy="6.6" rx=".9" ry="2.1" fill="#fff" opacity=".75"/>
                <g transform="translate(-1.2 6.6)"><path class="wg-spark" d="M0-7 1.5-1.5 7 0 1.5 1.5 0 7-1.5 1.5-7 0-1.5-1.5Z" fill="#fff"/></g></g>`);
            counter++;
        }
    }
    const d = rope.join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" aria-hidden="true">
        <defs>${COLORS.map((c, k) => `<radialGradient id="wg-g${k}"><stop offset="0" stop-color="${c}" stop-opacity=".95"/><stop offset=".4" stop-color="${c}" stop-opacity=".34"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`).join('')}<linearGradient id="wg-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>
        <path d="${d}" fill="none" stroke="#0d2a1e" stroke-width="7" stroke-linecap="round"/>
        <path d="${d}" fill="none" stroke="#27603f" stroke-width="4.4" stroke-linecap="round"/>
        <path d="${d}" fill="none" stroke="#5bb07d" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2.2 3.6" opacity=".9"/>
        ${Array.from({length: swags + 1}, (_, i) => `<circle cx="${(i * step).toFixed(1)}" cy="3" r="3.2" fill="#e8c25a"/>`).join('')}
        ${bulbs.map((set, k) => `<g class="wg-set s${k}">${set.join('')}</g>`).join('')}</svg>`;
}

function build() {
    const app = document.querySelector('#app');
    if (!app) return;
    const width = Math.round(app.clientWidth);
    if (!width) return;
    let box = document.getElementById('winter-garland');
    if (!box) {
        box = document.createElement('div');
        box.id = 'winter-garland';
        box.setAttribute('aria-hidden', 'true');
        app.prepend(box);
    }
    if (box.dataset.width === String(width)) return;
    box.dataset.width = String(width);
    box.innerHTML = draw(width);
}

let queued = 0;
function schedule() { cancelAnimationFrame(queued); queued = requestAnimationFrame(build); }
function start() {
    build();
    window.addEventListener('resize', schedule, {passive: true});
    if (window.ResizeObserver) { const app = document.querySelector('#app'); if (app) new ResizeObserver(schedule).observe(app); }
    setInterval(() => { if (!document.hidden && !document.getElementById('winter-garland')) build(); }, 3000);   // survives full re-renders
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
