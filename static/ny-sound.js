/* New Year sound: a quiet, sparkling arrangement of "Jingle Bells" (a folk tune of 1857) played by a celesta with soft pads and sleigh bells,
   and a small bell for every tap. It is made live with the Web Audio API (nothing to download), starts after the first touch, plays only while
   the New Year is switched on, and can be switched off in the settings (music and taps separately). */
(function () {
'use strict';
const KEY = 'crafter:ny-sound';
const read = () => { try { return Object.assign({music: true, clicks: true}, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { return {music: true, clicks: true}; } };
let prefs = read();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {} };
const root = document.documentElement;
const on = () => !root.classList.contains('ny-off');

let ctx = null, master = null, musicBus = null, clickBus = null, reverb = null, timer = 0, started = false, nextAt = 0, step = 0;
const MUSIC_GAIN = 0.32, CLICK_GAIN = 0.55;

const hz = (name) => { const n = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}[name[0]], o = Number(name[name.length - 1]); return 440 * Math.pow(2, (n + (o - 4) * 12 - 9) / 12); };

function impulse(seconds, decay) {                                 // a soft room made of decaying noise
    const rate = ctx.sampleRate, len = Math.floor(rate * seconds), buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
}
function boot() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    reverb = ctx.createConvolver(); reverb.buffer = impulse(2.4, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.34; reverb.connect(wet); wet.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master); musicBus.connect(reverb);
    clickBus = ctx.createGain(); clickBus.gain.value = CLICK_GAIN * MUSIC_GAIN; clickBus.connect(master); clickBus.connect(reverb);
    return true;
}

/* ---------- voices ---------- */
function bell(freq, when, dur, vol, bus) {                          // a celesta / glass bell: a pure tone, an octave and a quick inharmonic ring
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    g.connect(bus);
    [[1, 1], [2, 0.32], [2.76, 0.12], [5.4, 0.04]].forEach(([m, a]) => {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq * m; og.gain.value = a;
        o.connect(og); og.connect(g);
        o.start(when); o.stop(when + dur + 0.05);
    });
}
function pad(freqs, when, dur, vol) {                               // a warm chord under the tune
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.45);
    g.gain.linearRampToValueAtTime(vol * 0.6, when + dur - 0.3);
    g.gain.linearRampToValueAtTime(0.0001, when + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(g); g.connect(musicBus);
    freqs.forEach(f => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(lp); o.start(when); o.stop(when + dur + 0.05); });
}
let noiseBuf = null;
function shaker(when, vol) {                                        // sleigh bells: short filtered noise
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 7200; hp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vol, when + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);
    s.connect(hp); hp.connect(g); g.connect(musicBus); s.start(when); s.stop(when + 0.15);
}

/* ---------- the tune: bars of [note, beats]; 4 beats a bar ---------- */
const E = 'E5', G = 'G5', C = 'C5', D = 'D5', F = 'F5', A = 'A5', H = 'C6';
const BARS = [
    [[E, 1], [E, 1], [E, 2]], [[E, 1], [E, 1], [E, 2]], [[E, 1], [G, 1], [C, 1.5], [D, .5]], [[E, 4]],
    [[F, 1], [F, 1], [F, 1.5], [F, .5]], [[F, 1], [E, 1], [E, 1], [E, .5], [E, .5]], [[E, 1], [D, 1], [D, 1], [E, 1]], [[D, 2], [G, 2]],
    [[E, 1], [E, 1], [E, 2]], [[E, 1], [E, 1], [E, 2]], [[E, 1], [G, 1], [C, 1.5], [D, .5]], [[E, 4]],
    [[F, 1], [F, 1], [F, 1.5], [F, .5]], [[F, 1], [E, 1], [E, 1], [E, .5], [E, .5]], [[G, 1], [G, 1], [F, 1], [D, 1]], [[C, 4]],
    [[G, 1], [E, 1], [D, 1], [C, 1]], [[G, 3], [0, 1]], [[G, 1], [E, 1], [D, 1], [C, 1]], [[A, 3], [0, 1]],
    [[A, 1], [F, 1], [E, 1], [D, 1]], [[H, 3], [0, 1]], [[G, 1], [G, 1], [F, 1], [D, 1]], [[C, 4]],
];
const CHORDS = ['C', 'C', 'C', 'C', 'F', 'C', 'G', 'C', 'C', 'C', 'C', 'C', 'F', 'C', 'G', 'C', 'C', 'C', 'C', 'F', 'F', 'C', 'G', 'C'];
const CH = {C: ['C3', 'G3', 'E4'], F: ['F3', 'C4', 'A4'], G: ['G2', 'D4', 'B3']};
const BPM = 96, BEAT = 60 / BPM;

function scheduleBar(bar, at) {
    let t = at;
    BARS[bar % BARS.length].forEach(([note, beats]) => {
        if (note) bell(hz(note), t, Math.max(0.9, beats * BEAT * 1.6), 0.16, musicBus);
        t += beats * BEAT;
    });
    pad(CH[CHORDS[bar % CHORDS.length]].map(hz), at, 4 * BEAT, 0.05);
    for (let i = 0; i < 8; i++) shaker(at + i * BEAT / 2, i % 2 ? 0.014 : 0.028);
}
function pump() {                                                   // keeps the next bars scheduled a little ahead
    if (!ctx || !started) return;
    while (nextAt < ctx.currentTime + 1.2) { scheduleBar(step, nextAt); nextAt += 4 * BEAT; step++; }
}
function startMusic() {
    if (!boot()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (started) return;
    started = true; nextAt = ctx.currentTime + 0.15; step = 0;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + 2.5);       // it fades in
    pump(); timer = setInterval(pump, 250);
}
function stopMusic() {
    if (!ctx || !started) return;
    started = false; clearInterval(timer);
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    const old = musicBus;                                           // what was already scheduled dies away in the faded bus
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master); musicBus.connect(reverb);
    setTimeout(() => { try { old.disconnect(); } catch (_) {} }, 3000);
}

/* ---------- the tap: a small bell, a different note each time ---------- */
const SCALE = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7'];
let last = 0, pick = 0;
function tap() {
    if (!prefs.clicks || !on() || !ctx || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - last < 55) return;
    last = now; pick = (pick + 1 + Math.floor(Math.random() * 3)) % SCALE.length;
    bell(hz(SCALE[pick]), ctx.currentTime, 0.7, 0.5, clickBus);
}

/* ---------- when to play ---------- */
function sync() {
    if (prefs.music && on() && !document.hidden && armed) startMusic(); else stopMusic();
}
let armed = false;
function arm() {                                                    // browsers allow sound only after a touch
    if (armed) return;
    armed = true;
    if (boot() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    sync();
}
['pointerdown', 'keydown', 'touchend'].forEach(ev => window.addEventListener(ev, arm, {capture: true, passive: true}));
window.addEventListener('pointerdown', ev => { if (ev.target.closest && ev.target.closest('button,a,[role="button"],.fm-card,.fm-sec,.ny-lot,.sp-rw,.sp-q,label,summary,select')) tap(); }, {capture: true, passive: true});
document.addEventListener('visibilitychange', () => { if (ctx) { if (document.hidden) ctx.suspend().catch(() => {}); else if (armed) ctx.resume().catch(() => {}); } sync(); });
new MutationObserver(sync).observe(root, {attributes: true, attributeFilter: ['class']});   // the switch of the New Year in the admin panel works at once

window.crafterNYSound = {
    get music() { return prefs.music; }, get clicks() { return prefs.clicks; }, get available() { return on(); }, get state() { return ctx ? ctx.state : 'none'; }, get playing() { return started; },
    setMusic(v) { prefs.music = Boolean(v); save(); if (v) arm(); sync(); },
    setClicks(v) { prefs.clicks = Boolean(v); save(); if (v) arm(); },
};
})();
