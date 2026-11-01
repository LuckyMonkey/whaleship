// WHALESHIP audio v0.14 — realistic procedural sound: no samples, no network, no tracking.
// Everything is synthesised live with the Web Audio API and placed in a generated "underwater" reverb:
// ocean surf bed, whale song (moans + humpback whoops), blowhole spouts, splashes with bubbles, explosions,
// sinking groans, launch whooshes, sonar pings. Buses: effects / music / ambient → master (+ reverb send).
let ctx, master, music, ambient, effects, musicFilter, verb, verbIn, white, brown, enabled = false, timer = null, step = 0, lastKey = 0;
let surf = null, songTimer = 0;
let levels = {master: .65, music: 0, ambient: .18, effects: .7};
const now = () => ctx.currentTime;
const rnd = (a, b) => a + Math.random() * (b - a);

/* ---------------- building blocks ---------------- */
function env(g, t, a, peak, d, end = .0001) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(end, t + a + d); }
function out(node, dest, pan = 0, wet = .25) {
  const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p).connect(dest);
  if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w).connect(verbIn); }
}
function tone(freq, dur, type = 'sine', gain = .1, dest = effects, pan = 0, end = freq, at = 0, wet = .1) {
  if (!enabled || !ctx) return;
  const t = now() + at, o = ctx.createOscillator(), v = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (end !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
  env(v, t, .012, gain, dur); o.connect(v); out(v, dest, pan, wet); o.start(t); o.stop(t + dur + .05);
}
function noise(dur, gain, {freq = 1200, type = 'lowpass', q = .8, dest = effects, at = 0, attack = .005, pan = 0, wet = .2, sweepTo = null, buf = white} = {}) {
  if (!enabled || !ctx) return;
  const t = now() + at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain();
  s.buffer = buf; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q; if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  env(v, t, attack, gain, dur); s.connect(f).connect(v); out(v, dest, pan, wet); s.start(t, Math.random() * 1.5, dur + attack + .1);
}
const bubbles = (n, at = 0, spread = .6, pan = 0, gain = .05) => { for (let i = 0; i < n; i++) { const f = rnd(350, 1100); tone(f, rnd(.04, .09), 'sine', gain * rnd(.5, 1), effects, pan + rnd(-.2, .2), f * rnd(1.6, 2.4), at + Math.random() * spread, .35); } };

/* ---------------- voices ---------------- */
// Whale song: a slow gliding fundamental with vibrato, a nasal formant partial, heavy underwater reverb.
function whaleCall(kind = Math.random() < .6 ? 'moan' : 'whoop', gain = .14, pan = rnd(-.6, .6), dest = effects) {
  if (!enabled || !ctx) return;
  const t = now(), dur = kind === 'moan' ? rnd(2.2, 3.4) : rnd(1.1, 1.6);
  const f0 = kind === 'moan' ? rnd(85, 170) : rnd(260, 380), peak = kind === 'moan' ? f0 * rnd(1.25, 1.6) : f0 * rnd(2, 2.8);
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain(), bp = ctx.createBiquadFilter(), g2 = ctx.createGain(), v = ctx.createGain();
  o.type = 'sine'; o2.type = 'sawtooth'; vib.frequency.value = rnd(4, 6.5); vg.gain.value = f0 * .025; vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
  for (const osc of [o, o2]) { osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(peak, t + dur * (kind === 'moan' ? .45 : .6)); osc.frequency.exponentialRampToValueAtTime(f0 * (kind === 'moan' ? .8 : 1.1), t + dur); }
  bp.type = 'bandpass'; bp.frequency.value = f0 * 3; bp.Q.value = 6; g2.gain.value = .25;
  o.connect(v); o2.connect(bp).connect(g2).connect(v);
  v.gain.setValueAtTime(.0001, t); v.gain.exponentialRampToValueAtTime(gain, t + dur * .25); v.gain.setValueAtTime(gain, t + dur * .6); v.gain.exponentialRampToValueAtTime(.0001, t + dur);
  out(v, dest, pan, .9); for (const osc of [o, o2, vib]) { osc.start(t); osc.stop(t + dur + .1); }
}
// Ocean bed: brown noise through a low-pass whose gain swells and recedes like waves on a slow LFO.
function startSurf() {
  if (surf || !ctx) return;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), hiss = ctx.createBufferSource(), hf = ctx.createBiquadFilter(), hg = ctx.createGain(), lfo2 = ctx.createOscillator(), lg2 = ctx.createGain();
  s.buffer = brown; s.loop = true; f.type = 'lowpass'; f.frequency.value = 420; g.gain.value = .32; lfo.frequency.value = .09; lg.gain.value = .22; lfo.connect(lg).connect(g.gain);
  hiss.buffer = white; hiss.loop = true; hf.type = 'bandpass'; hf.frequency.value = 2400; hf.Q.value = .5; hg.gain.value = .015; lfo2.frequency.value = .13; lg2.gain.value = .012; lfo2.connect(lg2).connect(hg.gain);
  s.connect(f).connect(g).connect(ambient); hiss.connect(hf).connect(hg).connect(ambient);
  for (const n of [s, lfo, hiss, lfo2]) n.start(); surf = [s, lfo, hiss, lfo2];
}
function stopSurf() { if (!surf) return; surf.forEach(n => { try { n.stop(); } catch {} }); surf = null; }
function makeBuffers() {
  white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const w = white.getChannelData(0); for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
  brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate); const b = brown.getChannelData(0); let last = 0;
  for (let i = 0; i < b.length; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
  // underwater-ish reverb: 2.8 s stereo decay, darker in the tail
  const len = ctx.sampleRate * 2.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * (.25 - .2 * i / len); d[i] = lp * Math.pow(1 - i / len, 2.6); } }
  verb = ctx.createConvolver(); verb.buffer = ir; verbIn = ctx.createGain(); verbIn.gain.value = 1; const vo = ctx.createGain(); vo.gain.value = .7; verbIn.connect(verb).connect(vo).connect(master);
}

// 120 bpm, 8th-note grid: soft kick, closed hat, minor-pentatonic arp through a lowpass. Off by default (music level 0).
const ARP = [220, 261.63, 329.63, 392, 440, 392, 329.63, 261.63, 196, 261.63, 293.66, 392, 349.23, 293.66, 261.63, 220];
function beat() {
  if (!enabled || document.hidden) return;
  if (levels.music > .001) { const s = step++ % 32;
    if (s % 4 === 0) tone(110, .22, 'sine', .5, music, 0, 38, 0, 0);
    if (s % 2 === 1) noise(.04, .05, {freq: 7000, type: 'highpass', dest: music, wet: 0});
    tone(ARP[s % 16] * (s >= 16 ? 1.5 : 1), .2, 'square', .045, music, s % 4 < 2 ? -.3 : .3, ARP[s % 16] * (s >= 16 ? 1.5 : 1), 0, 0);
    if (s % 16 === 0) tone(55, 1.8, 'sawtooth', .07, music, 0, 55, 0, 0); }
  // now and then, a whale sings somewhere far away
  if (--songTimer <= 0) { songTimer = Math.round(rnd(100, 220)); whaleCall(undefined, .05, rnd(-.8, .8), ambient); }
}

export async function enable(value) {
  enabled = value;
  if (!ctx && value) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.connect(ctx.destination);
    effects = ctx.createGain(); ambient = ctx.createGain(); music = ctx.createGain();
    musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 1700;
    music.connect(musicFilter).connect(master); effects.connect(master); ambient.connect(master);
    makeBuffers(); setLevels(levels); songTimer = 40;
    document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (enabled) ctx.resume(); });
  }
  if (ctx) { if (value) { await ctx.resume(); startSurf(); } else { stopSurf(); await ctx.suspend(); } }
  clearInterval(timer); timer = value ? setInterval(beat, 250) : null;
  return enabled;
}
export const isEnabled = () => enabled;
export function setLevels(next) {
  levels = {...levels, ...next};
  if (ctx) { master.gain.value = levels.master; effects.gain.value = levels.effects; music.gain.value = levels.music; ambient.gain.value = levels.ambient; }
}
export function sound(kind, incoming = false) {
  if (!enabled || !ctx) return;
  const pan = incoming ? .45 : -.45;
  switch (kind) {
    case 'launch':   // whoosh of a packet leaving
      noise(.55, .35, {freq: 300, type: 'bandpass', q: 1.4, sweepTo: 3200, attack: .04, pan, wet: .15}); tone(1600, .07, 'square', .03, effects, -pan, 2400, 0, 0); break;
    case 'packet': tone(1760, .05, 'square', .03, effects, pan, 2349, 0, 0); noise(.25, .12, {freq: 600, type: 'bandpass', q: 1.2, sweepTo: 2500, attack: .03, pan, wet: .1}); break;
    case 'hit':      // explosion: sub thump + roar + debris crackle, then the water falls back
      tone(95, .7, 'sine', .7, effects, pan, 30, 0, .25); noise(1.3, .8, {freq: 900, sweepTo: 180, attack: .004, pan, wet: .45});
      noise(.5, .25, {freq: 3500, type: 'highpass', attack: .002, pan, wet: .2}); for (let i = 0; i < 6; i++) noise(.03, .12, {freq: 4000, type: 'highpass', at: .08 + Math.random() * .5, pan: pan + rnd(-.3, .3), wet: .1});
      noise(.6, .18, {freq: 1800, type: 'bandpass', q: .7, at: .25, attack: .05, pan, wet: .3}); break;
    case 'miss':     // splash + a few bubbles
      noise(.45, .45, {freq: 2600, type: 'bandpass', q: .6, attack: .003, pan, wet: .3}); noise(.25, .25, {freq: 500, attack: .003, pan, wet: .2}); bubbles(6, .12, .5, pan); break;
    case 'sunk':     // metal groans as it goes under, then a stream of bubbles
      for (const f of [55, 58.5]) tone(f, 2.6, 'sawtooth', .09, effects, 0, f * .7, 0, .6);
      noise(2.4, .35, {freq: 260, attack: .3, wet: .6}); bubbles(22, .4, 2.2, 0, .045); break;
    case 'whale': whaleCall(incoming ? 'moan' : undefined, .16, pan); break;
    case 'blow':     // blowhole spout: "pffhhh"
      noise(.9, .22, {freq: 900, type: 'bandpass', q: .7, attack: .05, pan: rnd(-.5, .5), wet: .25, sweepTo: 600}); noise(.6, .12, {freq: 180, attack: .05, wet: .2}); break;
    case 'sonar': [0, .5].forEach((at, i) => tone(1480, .5, 'sine', .14 / (i + 1), effects, pan, 1420, at, .95)); break;
    case 'depth': tone(60, 1.4, 'sine', .55, effects, pan, 25, 0, .5); noise(1.6, .5, {freq: 240, attack: .1, wet: .6}); for (let i = 0; i < 10; i++) tone(rnd(1300, 2600), .05, 'square', .025, effects, rnd(-.6, .6), rnd(1300, 2600), i * .09, 0); break;
    case 'tail':     // a fluke slamming the water
      noise(.35, .9, {freq: 1400, type: 'bandpass', q: .5, attack: .002, pan, wet: .4}); tone(120, .35, 'sine', .45, effects, pan, 45, 0, .3); bubbles(8, .15, .6, pan); break;
    case 'turn': tone(660, .14, 'triangle', .12); tone(990, .22, 'triangle', .12, effects, 0, 990, .12); break;
    case 'victory': [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) => tone(f, .55, 'triangle', .09, effects, 0, f, i * .11, .4)); setTimeout(() => whaleCall('whoop', .14, 0), 700); break;
    case 'defeat': [196, 185, 164.81, 130.81].forEach((f, i) => tone(f, .6, 'sawtooth', .07, effects, 0, f * .97, i * .17, .4)); setTimeout(() => whaleCall('moan', .16, 0), 600); break;
    case 'error': tone(140, .14, 'square', .05, effects, 0, 140, 0, 0); tone(110, .16, 'square', .04, effects, 0, 110, .1, 0); break;
    case 'join': tone(440, .12, 'triangle', .07); tone(660, .2, 'triangle', .07, effects, 0, 660, .1); break;
    case 'copy': tone(700, .08, 'triangle', .05); tone(1050, .1, 'triangle', .05, effects, 0, 1050, .08); break;
    case 'place': noise(.2, .25, {freq: 1600, type: 'bandpass', q: .6, attack: .004, wet: .2}); bubbles(3, .05, .2); break;
    case 'key': { const t = performance.now(); if (t - lastKey < 35) return; lastKey = t; noise(.018, .05, {freq: 4000 + Math.random() * 2000, type: 'highpass', wet: 0}); break; }
    default: tone(1200, .035, 'triangle', .035, effects, 0, 1200, 0, 0);
  }
}
