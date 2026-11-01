// WHALESHIP audio v0.7 — procedural synth: no samples, no network, no tracking.
// Buses: effects / music / ambient → master. One shared noise buffer (no per-shot allocation).
let ctx, master, music, ambient, effects, musicFilter, noiseBuf, enabled = false, timer = null, step = 0, lastKey = 0;
let levels = {master: .65, music: .12, ambient: .18, effects: .7};
const now = () => ctx.currentTime;

function tone(freq, dur, type = 'sine', gain = .1, dest = effects, pan = 0, end = freq, at = 0) {
  if (!enabled || !ctx) return;
  const t = now() + at, o = ctx.createOscillator(), v = ctx.createGain(), p = ctx.createStereoPanner();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (end !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
  v.gain.setValueAtTime(.0001, t); v.gain.exponentialRampToValueAtTime(Math.max(.0002, gain), t + .012); v.gain.exponentialRampToValueAtTime(.0001, t + dur);
  p.pan.value = pan; o.connect(v).connect(p).connect(dest); o.start(t); o.stop(t + dur + .03);
}
function noise(dur, gain, freq = 1200, type = 'lowpass', dest = effects, at = 0, q = .8) {
  if (!enabled || !ctx) return;
  const t = now() + at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  v.gain.setValueAtTime(gain, t); v.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f).connect(v).connect(dest); s.start(t, Math.random() * 1.5, dur + .05);
}

// 120 bpm, 8th-note grid: soft kick, closed hat, minor-pentatonic arp through a lowpass. Quiet by default.
const ARP = [220, 261.63, 329.63, 392, 440, 392, 329.63, 261.63, 196, 261.63, 293.66, 392, 349.23, 293.66, 261.63, 220];
function beat() {
  if (!enabled || document.hidden) return;
  const s = step++ % 32;
  if (s % 4 === 0) tone(110, .22, 'sine', .5, music, 0, 38);                  // kick
  if (s % 2 === 1) noise(.04, .05, 7000, 'highpass', music);                   // hat
  tone(ARP[s % 16] * (s >= 16 ? 1.5 : 1), .2, 'square', .045, music, s % 4 < 2 ? -.3 : .3);
  if (s % 16 === 0) tone(55, 1.8, 'sawtooth', .07, music, 0, 55);             // bass drone
  if (s === 0) tone(82.4, 3.5, 'sine', .09, ambient, 0, 70);                   // sub swell
  if (s === 8 && Math.random() < .5) tone(1318, .9, 'sine', .015, ambient, .6, 1250);   // distant sonar
}

export async function enable(value) {
  enabled = value;
  if (!ctx && value) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.connect(ctx.destination);
    effects = ctx.createGain(); ambient = ctx.createGain(); music = ctx.createGain();
    musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 1700;
    music.connect(musicFilter).connect(master); effects.connect(master); ambient.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    setLevels(levels);
  }
  if (ctx) { if (value) await ctx.resume(); else await ctx.suspend(); }
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
  const pan = incoming ? .5 : -.5;
  switch (kind) {
    case 'launch': tone(160, .5, 'sawtooth', .12, effects, pan, 1400); noise(.45, .18, 900, 'bandpass', effects, 0, 2); tone(880, .08, 'square', .05, effects, -pan); break;
    case 'packet': tone(1760, .05, 'square', .035, effects, pan); tone(2349, .05, 'square', .03, effects, pan, 2349, .05); break;
    case 'hit': noise(.5, .7, 1100); tone(95, .45, 'sine', .55, effects, pan, 28); tone(420, .12, 'square', .06, effects, pan, 180); break;
    case 'miss': noise(.35, .16, 2600, 'bandpass'); tone(620, .35, 'sine', .1, effects, pan, 140); break;
    case 'sunk': noise(1, .45, 520); tone(130, 1.3, 'sawtooth', .16, effects, 0, 24); [392, 311, 262, 196].forEach((f, i) => tone(f, .25, 'square', .05, effects, 0, f, .15 + i * .14)); break;
    case 'sonar': [0, .32, .64].forEach((at, i) => tone(1318, .9, 'sine', .14 / (i + 1), effects, pan, 1250, at)); break;
    case 'depth': tone(70, .9, 'sine', .6, effects, pan, 22); noise(.8, .5, 300); break;
    case 'tail': noise(.25, .6, 3200, 'bandpass', effects, 0, 1.5); tone(240, .2, 'triangle', .2, effects, pan, 90); break;
    case 'turn': tone(660, .14, 'triangle', .14); tone(990, .22, 'triangle', .14, effects, 0, 990, .12); break;
    case 'victory': [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) => tone(f, .55, 'square', .09, effects, 0, f, i * .11)); break;
    case 'defeat': [196, 185, 164.81, 130.81].forEach((f, i) => tone(f, .6, 'sawtooth', .08, effects, 0, f * .97, i * .17)); break;
    case 'error': tone(140, .14, 'square', .06); tone(110, .16, 'square', .05, effects, 0, 110, .1); break;
    case 'join': tone(440, .12, 'square', .06); tone(660, .2, 'square', .06, effects, 0, 660, .1); break;
    case 'copy': tone(700, .08, 'square', .05); tone(1050, .1, 'square', .05, effects, 0, 1050, .08); break;
    case 'place': tone(300, .08, 'triangle', .12, effects, 0, 180); noise(.08, .1, 1800); break;
    case 'key': { const t = performance.now(); if (t - lastKey < 35) return; lastKey = t; noise(.018, .05, 4000 + Math.random() * 2000, 'highpass'); break; }
    default: tone(1200, .04, 'square', .035);
  }
}
