// Shared between the game (index.html) and the control room (control.html).
// Both pages read/write localStorage; the game listens for 'storage' events so
// changes made in the control-room tab apply live to a running match.
export const KEY = 'whaleship:settings', CALLSIGN = 'whaleship:callsign';
export const defaults = {master: .65, effects: .7, ambient: .18, music: 0, fast: false,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, contrast: false, font: 100, topology: false,
  manual: false,   // place my own ships (otherwise auto-deploy + auto-ready)
  confirm: false}; // confirm each shot with FIRE (otherwise tap = fire)
export function load() { try { return {...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}')}; } catch { return {...defaults}; } }
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export function callsign() { try { return localStorage.getItem(CALLSIGN) || ''; } catch { return ''; } }
export function setCallsign(v) { try { v ? localStorage.setItem(CALLSIGN, v) : localStorage.removeItem(CALLSIGN); } catch {} }
export function applyDocument(s) {
  document.documentElement.classList.toggle('reduced', s.reduced);
  document.documentElement.classList.toggle('high-contrast', s.contrast);
  document.documentElement.style.fontSize = s.font + '%';
}
