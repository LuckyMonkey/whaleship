// Project Moby acceptance gate: the 3D ocean, world-space Conway foam and one Docker whale.
import {createWorld, LETTERS} from './ocean3d.js';
const $ = s => document.querySelector(s), Q = new URLSearchParams(location.search);
const quality = Q.get('q') || (matchMedia('(pointer:coarse)').matches ? 'low' : 'medium');
const world = createWorld($('#world'), {quality});
const N = 15;
// one magnificent whale, a penguin admin on an iceberg, a couple of buoys
const whale = world.buildWhale({length: 5.6, seed: 2}); whale.rotation.y = .18; world.add(whale, .5, 1.5);
const berg = world.buildIceberg(3); berg.scale.setScalar(.9); world.add(berg, -5.2, -4.2);
const far = world.buildIceberg(7); far.scale.setScalar(1.8); world.add(far, 13, -9);
const b1 = world.buildBuoy(); world.add(b1, 8.6, 5.2); const b2 = world.buildBuoy(); world.add(b2, -9, 7.6);
const distant = world.buildWhale({length: 4.2, seed: 5, palette: {top: '#4aa3ff', side: '#2a78d8', belly: '#eef6ff'}}); distant.rotation.y = -.7; world.add(distant, -15, 6);
setInterval(() => whale.userData.spout(), 9000); setTimeout(() => whale.userData.spout(), 1200);
setInterval(() => distant.userData.spout(), 13000);
// picking + keyboard targeting readout
const addr = c => LETTERS[Math.floor(Math.floor(c / N) / 3) * 5 + Math.floor((c % N) / 3)] + ((Math.floor(c / N) % 3) * 3 + (c % N) % 3 + 1);
let sel = -1, drag = null;
const cv = $('#world');
cv.addEventListener('pointermove', e => {
  if (drag) { world.pan(-(e.clientX - drag.x), -(e.clientY - drag.y)); drag = {x: e.clientX, y: e.clientY, moved: true}; return; }
  const p = world.pick(e.clientX, e.clientY); world.setHover(p?.cell ?? null); $('#cell').textContent = p ? `${addr(p.cell)} · col ${p.q + 1} row ${p.r + 1}` : 'open water';
});
cv.addEventListener('pointerdown', e => { drag = {x: e.clientX, y: e.clientY, moved: false}; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointerup', e => { const d = drag; drag = null; if (d && !d.moved) { const p = world.pick(e.clientX, e.clientY); if (p) $('#log').textContent = `clicked ${addr(p.cell)} (ray-cast pick)`; } });
cv.addEventListener('wheel', e => { e.preventDefault(); world.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, {passive: false});
document.addEventListener('keydown', e => {
  const k = e.key.toUpperCase();
  if (/^[A-Y]$/.test(k)) { sel = LETTERS.indexOf(k); world.setSector(sel); $('#log').textContent = `sector ${k} → now 1–9`; }
  else if (/^[1-9]$/.test(k) && sel >= 0) { const si = sel, sub = Number(k) - 1, c = (Math.floor(si / 5) * 3 + Math.floor(sub / 3)) * N + (si % 5) * 3 + sub % 3; world.setHover(c); world.setSector(-1); sel = -1; $('#log').textContent = `armed ${addr(c)}`; }
});
$('#spout').onclick = () => whale.userData.spout();
$('#slap').onclick = () => whale.userData.tailSlap();
$('#q').value = quality; $('#q').onchange = () => { location.search = '?q=' + $('#q').value; };
if (Q.get('z')) { world.zoomBy(Number(Q.get('z'))); world.focus(.5, 1.5); }
setInterval(() => { const i = world.info; $('#fps').textContent = `${world.fps.toFixed(0)} fps · ${i.calls} draw calls · ${(i.triangles / 1000).toFixed(1)}k tris · ${quality}`; }, 1000);
