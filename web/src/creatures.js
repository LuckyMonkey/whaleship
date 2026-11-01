// WHALESHIP creatures v0.9 — original side-view characters, drawn as camera-facing sprites (they always look at you,
// like classic isometric game sprites). Shaded with shared gradients so they read as round, 3D animals.
// Each sprite is len*40 × 64 units; y = 60 is the waterline. Containers/racks/disks carry data-slot so the game can
// knock individual ones off when that part of the creature is hit. Facing right; the game mirrors them as needed.
const INK = '#0a2342';
const BOX = [['#2f7bff', '#1d5fd6'], ['#ffcb3b', '#e0a91e'], ['#23e4d0', '#13b8a8'], ['#ff754f', '#e2532f'], ['#0db7ed', '#0a92bd'], ['#8a63d2', '#6c48b3'], ['#f4f1df', '#d8d3b8'], ['#3ddc84', '#24b066']];
const LABELS = ['nginx', 'redis', 'postgres', 'alpine', 'busybox', 'api', 'etcd', 'web', 'node', 'mysql'];
export const ROLES = [
  {kind: 'Moby', role: 'docker host', glyph: '🐋', ns: 'moby'},
  {kind: 'K8s carrier', role: 'orchestrator', glyph: '🚢', ns: 'k8s'},
  {kind: 'Walrus', role: 'storage node', glyph: '🦭', ns: 'walrus'},
  {kind: 'Tux', role: 'linux host', glyph: '🐧', ns: 'tux'},
  {kind: 'Squid', role: 'network proxy', glyph: '🦑', ns: 'squid'},
];
export const containerLabel = (seed, i) => LABELS[(seed * 3 + i) % LABELS.length];
const f = n => Math.round(n * 10) / 10;
// Shared defs: identical definitions in every sprite, so duplicate ids are harmless.
const DEFS = `<defs>
<linearGradient id="wsBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa2ff"/><stop offset=".45" stop-color="#2468e8"/><stop offset="1" stop-color="#173f9e"/></linearGradient>
<linearGradient id="wsBody2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fd0ff"/><stop offset=".5" stop-color="#1e9be6"/><stop offset="1" stop-color="#11619e"/></linearGradient>
<linearGradient id="wsBelly" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#bcd8f2"/></linearGradient>
<linearGradient id="wsWalrus" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c48e6a"/><stop offset=".55" stop-color="#9a6646"/><stop offset="1" stop-color="#6a4129"/></linearGradient>
<linearGradient id="wsSquid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b393ff"/><stop offset=".55" stop-color="#7d55d6"/><stop offset="1" stop-color="#4f2f9e"/></linearGradient>
<linearGradient id="wsIce" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#d5f1ff"/><stop offset="1" stop-color="#8fcdf0"/></linearGradient>
<radialGradient id="wsShine" cx=".35" cy=".25" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>`;
const eye = (x, y, r = 3.2) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="1.4"/><circle cx="${f(x + r * .25)}" cy="${f(y + r * .1)}" r="${f(r * .55)}" fill="${INK}"/><circle cx="${f(x + r * .05)}" cy="${f(y - r * .25)}" r="${f(r * .2)}" fill="#fff"/>`;
// A shipping container: two-tone corrugated box with a tiny workload label.
function box(x, y, w, h, slot, seed) {
  const [c1, c2] = BOX[(seed * 5 + slot * 3) % BOX.length], lab = containerLabel(seed, slot);
  let ribs = ''; for (let k = 1; k < 5; k++) ribs += `M${f(x + w * k / 5)} ${f(y + 1.6)}v${f(h - 3.2)}`;
  return `<g class="box" data-slot="${slot}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="1.2" fill="${c1}" stroke="${INK}" stroke-width="1.6"/>`
    + `<rect x="${f(x)}" y="${f(y + h * .62)}" width="${f(w)}" height="${f(h * .38)}" rx="1" fill="${c2}"/><path d="${ribs}" stroke="#00000033" stroke-width="1"/>`
    + `<rect x="${f(x + w * .14)}" y="${f(y + h * .22)}" width="${f(w * .72)}" height="${f(h * .36)}" rx=".8" fill="#ffffffcc"/>`
    + `<text x="${f(x + w / 2)}" y="${f(y + h * .5)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" font-size="${f(Math.min(4.2, w / lab.length * 1.45))}" fill="${INK}">${lab}</text></g>`;
}

// 🐋 Moby — docker host: a big round blue whale with a stepped stack of containers on its back.
function moby(L, seed) {
  const W = L * 40, X = u => f(u * W);
  const n1 = Math.max(2, L - 1), n2 = L >= 4 ? Math.max(1, L - 3) : 0, n3 = L >= 6 ? 1 : 0;
  const x0 = W * .3, x1 = W * .8, cw = (x1 - x0) / n1, ch = 10, base = 23;
  let boxes = '';
  for (let i = 0; i < n1; i++) boxes += box(x0 + i * cw + .5, base - ch, cw - 1, ch, i, seed);
  for (let i = 0; i < n2; i++) boxes += box(x0 + cw * (i + (n1 - n2) / 2) + .5, base - ch * 2 - .5, cw - 1, ch, n1 + i, seed);
  for (let i = 0; i < n3; i++) boxes += box(x0 + cw * ((n1 - 1) / 2) + .5, base - ch * 3 - 1, cw - 1, ch, n1 + n2 + i, seed);
  return `<ellipse cx="${X(.55)}" cy="60" rx="${X(.47)}" ry="4" fill="#ffffff2e"/>`
    + `<g class="fluke" style="transform-origin:${X(.16)}px 46px"><path d="M${X(.2)} 48 C${X(.12)} 46 ${X(.07)} 40 ${X(.035)} 28 C${X(.07)} 30 ${X(.09)} 32 ${X(.1)} 35 C${X(.1)} 27 ${X(.12)} 21 ${X(.17)} 16 C${X(.155)} 25 ${X(.16)} 34 ${X(.2)} 41 Z" fill="url(#wsBody)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/></g>`
    + `<path d="M${X(.14)} 46 C${X(.19)} 32 ${X(.25)} 25 ${X(.33)} 23 L${X(.8)} 18 C${X(.95)} 17 ${W - 1} 27 ${W - 1.5} 37 C${W - 2} 47 ${X(.93)} 53 ${X(.82)} 56 L${X(.45)} 59 C${X(.3)} 59 ${X(.2)} 55 ${X(.14)} 50 Z" fill="url(#wsBody)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`
    + `<path d="M${X(.3)} 58 C${X(.5)} 53 ${X(.75)} 51 ${W - 3} 47 C${X(.95)} 53 ${X(.9)} 55.5 ${X(.82)} 56.5 L${X(.45)} 59 Z" fill="url(#wsBelly)"/>`
    + `<ellipse cx="${X(.62)}" cy="29" rx="${X(.24)}" ry="7" fill="url(#wsShine)"/>`
    + `<path d="M${W - 1.8} 41 C${X(.93)} 44 ${X(.87)} 44 ${X(.81)} 42" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`
    + `<path class="fin" d="M${X(.66)} 50 C${X(.62)} 57 ${X(.58)} 62 ${X(.53)} 63 C${X(.57)} 57 ${X(.59)} 53 ${X(.61)} 49 Z" fill="#1a4fb8" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`
    + eye(W - 12, 32) + `<ellipse cx="${X(.84)}" cy="18.6" rx="2" ry="1" fill="${INK}"/>` + boxes
    + `<path class="vent" d="M${X(.84)} 17 q-4 -8 -9 -9 M${X(.84)} 17 q0 -9 1 -12 M${X(.84)} 17 q4 -8 9 -9" fill="none" stroke="#dff6ff" stroke-width="2.2" stroke-linecap="round"/>`;
}
// 🐳 Swarm — orchestrator: a formation of small whales, one container each.
function swarm(L, seed) {
  let out = '';
  for (let k = 0; k < L; k++) {
    const x = k * 40, dy = (k % 2) * -5, d = (k % 3) * .4;
    out += `<g class="pod" style="animation-delay:-${d}s"><g transform="translate(0 ${dy})">`
      + `<ellipse cx="${x + 22}" cy="${60 - dy}" rx="17" ry="2.6" fill="#ffffff26"/>`
      + `<path d="M${x + 6} 46 C${x + 3} 42 ${x + 2} 37 ${x + 1} 32 C${x + 4} 34 ${x + 6} 37 ${x + 7} 40 C${x + 8} 35 ${x + 10} 33 ${x + 13} 31 C${x + 11} 37 ${x + 11} 42 ${x + 12} 46 Z" fill="url(#wsBody2)" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`
      + `<path d="M${x + 9} 51 C${x + 10} 41 ${x + 15} 36 ${x + 22} 35 L${x + 31} 34 C${x + 38} 34 ${x + 40} 41 ${x + 39.5} 46 C${x + 39} 52 ${x + 34} 56 ${x + 26} 57 C${x + 18} 58 ${x + 12} 56 ${x + 9} 51 Z" fill="url(#wsBody2)" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
      + `<path d="M${x + 15} 56 C${x + 24} 51 ${x + 32} 50 ${x + 39} 47 C${x + 38} 53 ${x + 33} 56 ${x + 26} 57 Z" fill="url(#wsBelly)"/>`
      + `<ellipse cx="${x + 26}" cy="39" rx="8" ry="3" fill="url(#wsShine)"/>` + eye(x + 34, 42, 2.3)
      + `<path d="M${x + 39} 49 C${x + 35} 51 ${x + 32} 51 ${x + 29} 50" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`
      + box(x + 16, 24.5, 15, 10, k, seed) + '</g></g>';
  }
  return out;
}
// 🦭 Walrus — storage node: tusks, whiskers, and a stack of database disks.
function walrus(L, seed) {
  const W = L * 40, X = u => f(u * W), n = Math.max(1, L - 1), x0 = W * .2, cw = (W * .5) / n;
  let disks = '';
  for (let i = 0; i < n; i++) {
    const cx = x0 + cw * (i + .5), w = Math.min(cw - 3, 20), c = ['#8a63d2', '#2f7bff', '#3ddc84'][(seed + i) % 3], lab = ['pgdata', 's3', 'pvc'][(seed + i) % 3];
    disks += `<g class="box" data-slot="${i}"><path d="M${f(cx - w / 2)} 15 v12 a${f(w / 2)} 3.6 0 0 0 ${f(w)} 0 v-12" fill="${c}" stroke="${INK}" stroke-width="1.6"/><ellipse cx="${f(cx)}" cy="15" rx="${f(w / 2)}" ry="3.6" fill="#eef4ff" stroke="${INK}" stroke-width="1.6"/>`
      + `<path d="M${f(cx - w / 2)} 21 a${f(w / 2)} 3.6 0 0 0 ${f(w)} 0" fill="none" stroke="${INK}" stroke-width="1.1"/><text x="${f(cx)}" y="26.5" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="800" font-size="3.8" fill="#fff">${lab}</text></g>`;
  }
  return `<ellipse cx="${X(.5)}" cy="60" rx="${X(.48)}" ry="3.6" fill="#ffffff26"/><g class="breathe">`
    + `<path d="M3 59 C1 40 ${X(.18)} 29 ${X(.36)} 27 C${X(.6)} 24 ${W - 14} 25 ${W - 8} 33 C${W - 2} 40 ${W - 3} 52 ${W - 5} 59 Z" fill="url(#wsWalrus)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`
    + `<ellipse cx="${X(.45)}" cy="35" rx="${X(.25)}" ry="6" fill="url(#wsShine)"/>`
    + `<path d="M${X(.55)} 59 q-7 -9 2 -11 q9 2 7 11z" fill="#7a4b30" stroke="${INK}" stroke-width="1.6"/>`
    + `<ellipse cx="${W - 12}" cy="42" rx="8.5" ry="5.5" fill="#d9a988" stroke="${INK}" stroke-width="1.6"/>`
    + `<path d="M${W - 16} 45 l1.6 13 M${W - 9} 45 l-.6 13" stroke="#fffdf1" stroke-width="3.4" stroke-linecap="round"/><path d="M${W - 16} 45 l1.6 13 M${W - 9} 45 l-.6 13" stroke="${INK}" stroke-width=".8" stroke-linecap="round" opacity=".5"/>`
    + [[-15, 41], [-11, 43], [-8, 41]].map(([dx, y]) => `<circle cx="${W + dx}" cy="${y}" r=".8" fill="${INK}"/>`).join('')
    + eye(W - 15, 35, 2.4) + disks + '</g>';
}
// 🐧 Tux — linux host: a penguin admin with a laptop on an iceberg full of server racks.
function tux(L, seed) {
  const W = L * 40, X = u => f(u * W), n = Math.max(1, L - 1), px = W * .5;
  let racks = '', slots = [];
  for (let i = 0; i < n; i++) slots.push(W * (i + .5) / n);
  slots = slots.map(x => Math.abs(x - px) < 14 ? x + (x < px ? -14 : 14) : x);
  slots.forEach((x, i) => {
    racks += `<g class="box" data-slot="${i}"><rect x="${f(x - 7.5)}" y="22" width="15" height="19" rx="1.4" fill="#26333d" stroke="${INK}" stroke-width="1.6"/>`
      + [26, 30.5, 35].map((y, k) => `<rect x="${f(x - 5)}" y="${y}" width="10" height="2.4" rx=".4" fill="#4a5b66"/><circle cx="${f(x + 4)}" cy="${y + 1.2}" r=".9" fill="${(seed + i + k) % 3 ? '#3ddc84' : '#ffcb3b'}"/>`).join('') + '</g>';
  });
  return `<path d="M0 60 L5 44 L${X(.16)} 38 L${X(.3)} 41 L${X(.45)} 34 L${X(.62)} 39 L${X(.8)} 35 L${W - 4} 45 L${W} 60 Z" fill="url(#wsIce)" stroke="#3d7ea6" stroke-width="2" stroke-linejoin="round"/>`
    + `<path d="M${X(.22)} 60 L${X(.3)} 49 L${X(.4)} 60 M${X(.6)} 60 L${X(.7)} 51 L${X(.8)} 60" fill="#a9dcf5" stroke="#3d7ea6" stroke-width="1.2"/>` + racks
    + `<g class="tux" style="transform-origin:${f(px)}px 38px"><ellipse cx="${f(px)}" cy="26" rx="8.5" ry="11.5" fill="${INK}"/><ellipse cx="${f(px + 1.2)}" cy="28" rx="5.4" ry="8.6" fill="#fffdf1"/>`
    + `<circle cx="${f(px - .6)}" cy="15.5" r="6.4" fill="${INK}"/>${eye(px + 1.6, 14.8, 1.8)}<path d="M${f(px + 5)} 16.5 l5.5 1.6 -5.5 1.6z" fill="#ffb35c" stroke="${INK}" stroke-width=".8"/>`
    + `<path d="M${f(px - 6)} 37.5 h5 M${f(px + 1.5)} 37.5 h5" stroke="#ffb35c" stroke-width="2.8" stroke-linecap="round"/>`
    + `<rect x="${f(px + 3.5)}" y="25" width="10" height="6.5" rx="1" fill="#5c6b75" stroke="${INK}" stroke-width="1.2"/><rect x="${f(px + 4.8)}" y="26.2" width="7.4" height="3.8" fill="#3ddc84" class="lcd"/></g>`;
}
// 🦑 Squid — network proxy: tentacles are patch cables ending in RJ45 plugs.
function squid(L, seed) {
  const W = L * 40, X = u => f(u * W), n = Math.max(1, L - 1), mx = W * .66;
  let cables = '', boxes = '';
  [['#ffcb3b', 50], ['#2f7bff', 55], ['#23e4d0', 46], ['#ff754f', 58]].forEach(([c, y], i) => {
    const ex = 3 + i * 4, ey = 34 + i * 6, d = `M${X(.5)} ${y} C${X(.38)} ${y - 15} ${X(.2)} ${y + 9} ${ex + 6} ${ey}`;
    cables += `<path d="${d}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="2.8" stroke-linecap="round"/><rect x="${ex}" y="${ey - 3}" width="7" height="6" rx="1" fill="#e9f8ff" stroke="${INK}" stroke-width="1.2"/>`;
  });
  for (let i = 0; i < n; i++) boxes += box(mx - 11 + i * 14 - (n - 1) * 7, 9, 13, 9.5, i, seed);
  return `<ellipse cx="${X(.6)}" cy="60" rx="${X(.4)}" ry="3.4" fill="#ffffff26"/><g class="tentacles">${cables}</g>`
    + `<path d="M${X(.44)} 59 C${X(.44)} 36 ${X(.52)} 20 ${f(mx)} 18 C${W - 6} 16 ${W - 1} 30 ${W - 2} 59 Z" fill="url(#wsSquid)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`
    + `<ellipse cx="${X(.7)}" cy="30" rx="${X(.12)}" ry="7" fill="url(#wsShine)"/><circle cx="${X(.62)}" cy="44" r="2.2" fill="#d4c2ff"/><circle cx="${X(.72)}" cy="50" r="1.8" fill="#d4c2ff"/>` + eye(W - 12, 38, 3.6) + boxes;
}
const DRAW = [moby, swarm, walrus, tux, squid];
export function creatureSVG(kind, len, seed = 0) {
  return `<svg viewBox="0 -18 ${len * 40} 82" aria-hidden="true">${DEFS}${DRAW[kind % 5](len, seed)}</svg>`;
}
// Which container/rack/disk sits over segment j (0-based, tail→head) of a creature of length len.
export function slotFor(kind, len, j) { const n = kind === 1 ? len : kind === 0 ? Math.max(2, len - 1) : Math.max(1, len - 1); return Math.min(n - 1, Math.floor(j * n / len)); }
// Firewall iceberg with a penguin admin who alternates between a laptop and a coffee.
export function bergSVG(seed = 0) {
  return `<svg viewBox="0 -18 40 82" aria-hidden="true">${DEFS}<ellipse cx="20" cy="60" rx="19" ry="3" fill="#ffffff2e"/>`
    + `<path d="M0 60 L3 36 L10 27 L17 31 L24 15 L31 24 L37 35 L40 60 Z" fill="url(#wsIce)" stroke="#3d7ea6" stroke-width="2" stroke-linejoin="round"/>`
    + `<path d="M8 60 L14 44 L20 60 M24 60 L29 47 L34 60" fill="#a9dcf5" stroke="#3d7ea6" stroke-width="1.1"/>`
    + `<g class="pg"><ellipse cx="22" cy="6" rx="4.4" ry="6.4" fill="${INK}"/><ellipse cx="22.6" cy="7.6" rx="2.7" ry="4.6" fill="#fffdf1"/><circle cx="21.4" cy="-.6" r="3.4" fill="${INK}"/>`
    + `<circle cx="22.6" cy="-1" r="1" fill="#fff"/><path d="M24.2 0 l3 .9 -3 .9z" fill="#ffb35c"/><path d="M19 12.6 h3 M22.6 12.6 h3" stroke="#ffb35c" stroke-width="1.8" stroke-linecap="round"/>`
    + `<g class="pg-laptop"><rect x="24.5" y="5" width="6" height="4" rx=".6" fill="#5c6b75" stroke="${INK}" stroke-width=".8"/><rect x="25.3" y="5.6" width="4.4" height="2.4" fill="#3ddc84"/></g>`
    + `<g class="pg-coffee"><rect x="25" y="5.4" width="3.6" height="4" rx=".6" fill="#fffdf1" stroke="${INK}" stroke-width=".8"/><path d="M28.6 6.4 q1.6 .8 0 2" fill="none" stroke="${INK}" stroke-width=".8"/></g></g>`
    + `<text x="8" y="52" font-family="ui-monospace,monospace" font-size="6" font-weight="900" fill="#3d7ea6">FW</text></svg>`;
}
