"""Original synthwave track for the Vice City style event: "Neon Boulevard" (A minor, 104 BPM, ~3 min, loops seamlessly)."""
import numpy as np, sys
from scipy.signal import butter, lfilter, fftconvolve

SR = 44100
BPM = 104
BEAT = 60 / BPM
rng = np.random.default_rng(7)

SEC = ['intro'] * 8 + ['verse'] * 16 + ['pre'] * 8 + ['chorus'] * 16 + ['break'] * 8 + ['chorus2'] * 16 + ['outro'] * 4
BARS = len(SEC)
TAIL = 4.0
N = int((BARS * 4 * BEAT + TAIL) * SR)

CH = {'Am': (45, [57, 60, 64]), 'F': (41, [53, 57, 60]), 'C': (48, [60, 64, 67]), 'G': (43, [55, 59, 62]), 'E': (40, [56, 59, 64])}
PROG = ['Am', 'F', 'C', 'G']
PRE = ['F', 'G', 'Am', 'E']


def chord(bar):
    s = SEC[bar]; i = bar - SEC.index(s)
    if s == 'pre':
        return PRE[i % 4]
    if s == 'outro':
        return ['Am', 'F', 'Am', 'Am'][i]
    return PROG[i % 4]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tsec(bar, beat=0.0):
    return (bar * 4 + beat) * BEAT


def S(sec):
    return int(sec * SR)


def new():
    return np.zeros((2, N), dtype=np.float32)


def put(tr, start, sig, pan=0.0, gain=1.0):
    i = S(start) if isinstance(start, float) else start
    if i >= N:
        return
    n = min(len(sig), N - i)
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    tr[0, i:i + n] += sig[:n] * l * gain * 1.414
    tr[1, i:i + n] += sig[:n] * r * gain * 1.414


def adsr(n, a, d, s, r, hold=None):
    t = np.arange(n) / SR
    env = np.ones(n)
    a = max(a, 1e-4)
    env = np.where(t < a, t / a, 1.0)
    dd = np.clip((t - a) / max(d, 1e-4), 0, 1)
    env = np.where(t >= a, 1 - (1 - s) * dd, env)
    rel_start = (n / SR) - r
    rel = np.clip((t - rel_start) / max(r, 1e-4), 0, 1)
    return env * (1 - rel)


def saw_bl(freq, n, nmax=24, vib=0.0, vib_rate=5.5, vib_delay=0.35, phase0=0.0):
    t = np.arange(n) / SR
    if vib:
        depth = vib * np.clip((t - vib_delay) / 0.4, 0, 1)
        f = freq * (1 + depth * np.sin(2 * np.pi * vib_rate * t))
    else:
        f = np.full(n, freq)
    ph = np.cumsum(f) * 2 * np.pi / SR + phase0
    kmax = int(min(nmax, (SR / 2 * 0.92) / (freq * (1 + vib))))
    out = np.zeros(n)
    for k in range(1, max(kmax, 1) + 1):
        out += np.sin(k * ph) / k
    return out * (2 / np.pi)


def sq_bl(freq, n, nmax=16):
    ph = np.arange(n) * 2 * np.pi * freq / SR
    kmax = int(min(nmax, (SR / 2 * 0.92) / freq))
    out = np.zeros(n)
    for k in range(1, kmax + 1, 2):
        out += np.sin(k * ph) / k
    return out * (4 / np.pi) * .5


def lp(x, fc, order=2):
    b, a = butter(order, min(fc, SR / 2 * .95) / (SR / 2), 'low')
    return lfilter(b, a, x, axis=-1)


def hp(x, fc, order=2):
    b, a = butter(order, fc / (SR / 2), 'high')
    return lfilter(b, a, x, axis=-1)


def bp(x, lo, hi, order=2):
    b, a = butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band')
    return lfilter(b, a, x, axis=-1)


def sweep_lp(x, curve, step=0.08):
    """a lowpass with a moving cutoff; curve(t) -> Hz"""
    out = np.zeros_like(x)
    ch = int(step * SR)
    zi = [None, None]
    for c in range(2):
        z = None
        for i in range(0, x.shape[1], ch):
            fc = float(np.clip(curve(i / SR), 120, 18000))
            b, a = butter(2, fc / (SR / 2), 'low')
            seg = x[c, i:i + ch]
            if z is None:
                z = np.zeros(max(len(a), len(b)) - 1)
            y, z = lfilter(b, a, seg, zi=z)
            out[c, i:i + len(seg)] = y
    return out


# ------------------------------------------------------------------ drums
def kick():
    n = S(.42); t = np.arange(n) / SR
    f = 46 + 120 * np.exp(-t * 32)
    body = np.sin(np.cumsum(f) * 2 * np.pi / SR) * np.exp(-t * 7.5)
    click = np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 180) * .25
    return (body + click) * .95


def snare():
    n = S(.34); t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = bp(noise, 1200, 9000)
    gate = np.where(t < .2, np.exp(-t * 7) * 1.0, 0) * np.clip((.22 - t) / .03, 0, 1)      # the 80s gated tail
    tone = np.sin(2 * np.pi * (210 - 60 * t) * t) * np.exp(-t * 22) * .7
    return (noise * gate * .8 + tone) * .9


def clap():
    n = S(.3); t = np.arange(n) / SR
    out = np.zeros(n)
    for d in (0, .011, .022):
        i = S(d)
        seg = np.exp(-(t[:n - i]) * 70)
        out[i:] += bp(rng.standard_normal(n - i), 900, 3500) * seg
    tail = bp(rng.standard_normal(n), 900, 3500) * np.exp(-t * 16) * .35
    return (out + tail) * .55


def hat(openh=False):
    n = S(.3 if openh else .07); t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-t * (11 if openh else 70)) * .6


def tom(f0):
    n = S(.4); t = np.arange(n) / SR
    f = f0 * (1 + .6 * np.exp(-t * 14))
    return np.sin(np.cumsum(f) * 2 * np.pi / SR) * np.exp(-t * 9) * .9


def crash():
    n = S(3.2); t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 4800) * np.exp(-t * 1.9) * .5


def riser(sec):
    n = S(sec); t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = bp(x, 1500, 12000) * (t / sec) ** 2.2
    return x * .55


# ------------------------------------------------------------------ synth voices
def pluck(freq, dur, bright=1.0):
    n = S(dur)
    x = saw_bl(freq, n, nmax=int(10 * bright)) * np.exp(-np.arange(n) / SR * 11)
    return x * .6


def bassnote(freq, dur):
    n = S(dur)
    x = saw_bl(freq, n, nmax=14) * .7 + sq_bl(freq, n) * .3 + np.sin(2 * np.pi * freq * np.arange(n) / SR) * .5
    env = adsr(n, .004, .12, .72, .04)
    return lp(x, 900) * env


def padnote(freq, dur):
    n = S(dur)
    x = np.zeros(n)
    for dt in (-9, 0, 9):
        x += saw_bl(freq * 2 ** (dt / 1200), n, nmax=14, phase0=rng.uniform(0, 6.28))
    return x / 3 * adsr(n, .7, .3, .85, .9)


def leadnote(freq, dur, vib=.0035):
    n = S(dur + .12)
    x = np.zeros(n)
    for dt in (-13, -5, 0, 6, 14):
        x += saw_bl(freq * 2 ** (dt / 1200), n, nmax=22, vib=vib, phase0=rng.uniform(0, 6.28))
    x = x / 5 + np.sin(2 * np.pi * freq * np.arange(n) / SR) * .25
    return lp(x, 5200) * adsr(n, .012, .25, .82, .14)


def brass(freqs, dur):
    n = S(dur)
    x = np.zeros(n)
    for f in freqs:
        for dt in (-8, 8):
            x += saw_bl(f * 2 ** (dt / 1200), n, nmax=14, phase0=rng.uniform(0, 6.28))
    x /= len(freqs) * 2
    swell = 1.0 + .5 * np.exp(-np.arange(n) / SR * 9)
    return lp(x * swell, 3400) * adsr(n, .015, .2, .6, .12) * .9


# ------------------------------------------------------------------ the arrangement
drums, bass, pad, arp, lead, stab, fx = (new() for _ in range(7))
kicks = []

K, SN, CL = kick(), snare(), clap()
H, HO = hat(), hat(True)
for bar in range(BARS):
    s = SEC[bar]; i = bar - SEC.index(s)
    base = tsec(bar)
    has_beat = (s in ('verse', 'pre', 'chorus', 'chorus2')) or (s == 'intro' and i >= 4) or (s == 'break' and i == 7)
    full = s in ('verse', 'pre', 'chorus', 'chorus2')
    if s == 'intro' and i >= 6 or full:                              # four on the floor
        for b in range(4):
            put(drums, base + b * BEAT, K, 0, 1.0)
            kicks.append(base + b * BEAT)
    if full:
        for b in (1, 3):
            put(drums, base + b * BEAT, SN, 0, .8)
            put(drums, base + b * BEAT, CL, 0, .45)
        for e in range(8):                                           # off-beat open hats, closed ghosts
            if e % 2:
                put(drums, base + e * BEAT / 2, HO, .25, .3 if s in ('chorus', 'chorus2') else .22)
            else:
                put(drums, base + e * BEAT / 2, H, -.2, .16)
        for q in range(16):
            if q % 2 and s in ('chorus', 'chorus2'):
                put(drums, base + q * BEAT / 4, H, .1, .06)
    elif s == 'intro' and i >= 4:
        for e in range(8):
            put(drums, base + e * BEAT / 2, H, (-.3 if e % 2 else .3), .13 + .02 * i)
    # fills and cymbals
    if s in ('verse', 'pre', 'chorus', 'chorus2') and i % 8 == 7:
        for q in range(8):
            put(drums, base + (3 + q / 8) * BEAT, tom(210 - q * 18), (-.4 + q * .1), .6)
    if s == 'pre' and i == 7:
        for q in range(16):
            put(drums, base + (2 + q / 8) * BEAT, SN, 0, .25 + .65 * q / 16)
    if s in ('chorus', 'chorus2') and i in (0, 8):
        put(fx, base, crash(), 0, .75)
    if s in ('verse',) and i == 0:
        put(fx, base, crash(), 0, .5)
    if s == 'break' and i == 4:
        put(fx, base, riser(4 * BEAT * 4), 0, .6)
    if s == 'pre' and i == 0:
        put(fx, base, riser(8 * 4 * BEAT), 0, .55)
    if s == 'outro' and i == 0:
        put(fx, base, crash(), 0, .5)

    # bass: driving eighth notes with the octave jump
    root, triad = CH[chord(bar)]
    if s in ('verse', 'pre', 'chorus', 'chorus2') or (s == 'intro' and i >= 6):
        for e in range(8):
            f = hz(root + (12 if e % 2 else 0))
            put(bass, base + e * BEAT / 2, bassnote(f, BEAT / 2 * .92), 0, .8 if e % 2 else 1.0)
    if s == 'break' and i % 2 == 0:
        put(bass, base, bassnote(hz(root), 4 * BEAT * 1.9) * .8, 0, .8)

    # pad: slow chords
    if True:
        dur = 4 * BEAT + .8
        for k, m in enumerate(triad):
            put(pad, base, padnote(hz(m - 12), dur), (-.5 + k * .5), .55)
        put(pad, base, padnote(hz(root + 12), dur), 0, .4)
        if s in ('chorus', 'chorus2', 'break'):
            for k, m in enumerate(triad):
                put(pad, base, padnote(hz(m), dur), (.4 - k * .4), .35)

    # arpeggio: sixteenths on the chord, rolling up and down
    arp_on = s in ('verse', 'pre', 'chorus', 'chorus2', 'break') or (s == 'intro' and i >= 2) or (s == 'outro' and i <= 1)
    if arp_on:
        tones = [triad[0], triad[1], triad[2], triad[0] + 12]
        pat = [0, 1, 2, 3, 2, 1, 2, 1, 0, 1, 2, 3, 2, 1, 2, 3]
        vol = {'intro': .5, 'verse': .8, 'pre': .9, 'chorus': .75, 'break': .55, 'chorus2': .75, 'outro': .5}[s]
        for q in range(16):
            m = tones[pat[q]] + (12 if (s in ('chorus', 'chorus2') and bar % 2) else 0)
            put(arp, base + q * BEAT / 4, pluck(hz(m), .22, 1.2 if s in ('pre', 'chorus2') else 1.0), (-.6 if q % 2 else .6), vol)

# ---- the melodies: [midi note or 0, beats]
CHORUS_MEL = [
    [(76, 1.5), (76, .5), (81, 1), (79, 1)], [(77, 1.5), (77, .5), (81, 1), (79, .5), (77, .5)], [(76, 1.5), (76, .5), (79, 1), (76, 1)], [(74, 2), (71, 1), (74, 1)],
    [(81, 1.5), (81, .5), (84, 1), (83, 1)], [(81, 1.5), (81, .5), (84, 1), (81, .5), (77, .5)], [(79, 1.5), (76, .5), (79, 1), (84, 1)], [(83, 2), (81, 1), (79, 1)]]
VERSE_MEL = [
    [(69, 1), (72, 1), (76, 2)], [(69, 1), (72, 1), (77, 2)], [(67, 1), (72, 1), (76, 2)], [(74, 2), (71, 2)],
    [(69, 1), (72, 1), (76, 1), (81, 1)], [(72, 1), (77, 1), (81, 2)], [(76, 1), (79, 1), (84, 2)], [(83, 1), (81, 1), (79, 2)]]
BREAK_MEL = [[(76, 4)], [(77, 4)], [(79, 4)], [(74, 4)], [(81, 4)], [(79, 4)], [(76, 4)], [(71, 2), (74, 2)]]


def play(mel, section, vol=1.0, octs=(0,), extra=()):
    st = SEC.index(section)
    nb = len([b for b in SEC if b == section])
    for i in range(nb):
        bar = st + i
        t = 0.0
        for m, d in mel[i % len(mel)]:
            for o in octs:
                put(lead, tsec(bar, t), leadnote(hz(m + o), d * BEAT * .98), .0, vol * (1.0 if o == 0 else .5))
            for iv, g in extra:
                put(lead, tsec(bar, t), leadnote(hz(m + iv), d * BEAT * .98, .003), .0, vol * g)
            t += d


# the verse: hook only in its second half
st = SEC.index('verse')
for i in range(8, 16):
    bar = st + i; t = 0.0
    for m, d in VERSE_MEL[i - 8]:
        put(lead, tsec(bar, t), leadnote(hz(m), d * BEAT * .98), 0, .85)
        t += d
play(CHORUS_MEL, 'chorus', 1.0, octs=(-12,))
play(BREAK_MEL, 'break', .8)
play(CHORUS_MEL, 'chorus2', 1.0, octs=(-12, 12), extra=((7, .3),))

# stabs in the choruses
for sname in ('chorus', 'chorus2'):
    st = SEC.index(sname)
    for i in range(16):
        bar = st + i; root, triad = CH[chord(bar)]
        fr = [hz(m) for m in triad]
        put(stab, tsec(bar, 0), brass(fr, BEAT * 1.4), 0, .8)
        put(stab, tsec(bar, 3.5), brass(fr, BEAT * .4), 0, .6)

# ------------------------------------------------------------------ sidechain, sweeps, space
duck = np.ones(N, dtype=np.float32)
dn = S(.3); dt_ = np.arange(dn) / SR
curve = (1 - .55 * np.exp(-dt_ * 11)).astype(np.float32)
for k in kicks:
    i = S(k)
    n = min(dn, N - i)
    duck[i:i + n] *= curve[:n]
bass *= duck; pad *= duck; arp *= duck ** .5

edges = {}
pos = 0
for s in ['intro', 'verse', 'pre', 'chorus', 'break', 'chorus2', 'outro']:
    c = SEC.count(s); edges[s] = (tsec(pos), tsec(pos + c)); pos += c


def pad_curve(t):
    for s, (a, b) in edges.items():
        if a <= t < b:
            u = (t - a) / (b - a)
            return {'intro': 400 + 1400 * u, 'verse': 1500, 'pre': 1800 + 1800 * u, 'chorus': 2300, 'break': 700 + 800 * u, 'chorus2': 2500, 'outro': 1500 - 1200 * u}[s]
    return 1500


pad = sweep_lp(pad, pad_curve)
arp_cut = lambda t: 900 + 3500 * min(1.0, t / (tsec(8))) if t < tsec(8) else 4500
arp = sweep_lp(arp, arp_cut)
bass = lp(bass, 1400)
lead = hp(lead, 120)


def impulse(sec, decay, seed):
    r = np.random.default_rng(seed)
    n = int(sec * SR); t = np.arange(n) / SR
    ir = r.standard_normal((2, n)) * np.exp(-t * decay)
    ir[:, :int(.015 * SR)] *= np.linspace(0, 1, int(.015 * SR))
    return lp(ir, 5500, 1) * .25


IR = impulse(2.4, 2.6, 3)


def reverb(x, amount):
    wet = np.stack([fftconvolve(x[0], IR[0])[:N], fftconvolve(x[1], IR[1])[:N]])
    return wet.astype(np.float32) * amount


def pingpong(x, beats=.75, fb=.38, amount=.35, taps=5):
    d = S(beats * BEAT)
    out = np.zeros_like(x)
    cur = x.copy()
    for k in range(1, taps + 1):
        cur = cur * fb
        sh = d * k
        if sh >= N:
            break
        if k % 2:
            out[0, sh:] += cur[1, :N - sh]; out[1, sh:] += cur[0, :N - sh]
        else:
            out[0, sh:] += cur[0, :N - sh]; out[1, sh:] += cur[1, :N - sh]
    return out * amount


# gated-ish reverb on the drums' snare and a room on the rest
mix = (drums * 1.0 + bass * .72 + pad * .30 + arp * .24 + lead * .36 + stab * .26 + fx * .5).astype(np.float32)
mix += reverb(pad * .30 + lead * .36 + stab * .26, .55)
mix += reverb(arp * .3 + drums * .12, .28)
mix += pingpong(lead * .36 + arp * .3, .75, .38, .5)

# the energy of the song: quiet intro, a lift into the chorus, a breath in the break, the big final chorus
ENERGY = {'intro': .55, 'verse': .8, 'pre': .92, 'chorus': 1.12, 'break': .6, 'chorus2': 1.22, 'outro': .55}
centers = [(b + .5) * 4 * BEAT for b in range(BARS)]
env = np.interp(np.arange(N) / SR, centers, [ENERGY[SEC[b]] for b in range(BARS)]).astype(np.float32)
mix *= env

# loop: the tail wraps onto the beginning, so the track repeats without a gap
body = N - int(TAIL * SR)
tail = mix[:, body:]
mix = mix[:, :body]
mix[:, :tail.shape[1]] += tail[:, :body]
mix = mix * np.minimum(1, np.linspace(0, 1, body) * 0 + 1)

# gentle master: soft clip and normalise
mix = mix / np.percentile(np.abs(mix), 99.7) * .85
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix = hp(mix, 28, 1)
mix = (mix / np.max(np.abs(mix)) * .93).astype(np.float32)
out = sys.argv[1] if len(sys.argv) > 1 else 'vice.wav'
import wave
pcm = (mix.T * 32767).astype('<i2')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('done', body / SR, 'sec', 'rms', float(np.sqrt((mix ** 2).mean())))
