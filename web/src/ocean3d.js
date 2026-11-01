// WHALESHIP 3D world (Three.js, WebGL2). Renderer only: it never decides game results, it visualises them.
// World convention: X right, Y up, Z depth; ocean surface y = 0; one board cell = 1 world unit, board centred at 0.
import * as THREE from './vendor/three.module.min.js';

const QUALITY = {
  low: {dpr: 1, shadows: false, oceanSeg: 56, foam: 96, aa: false, fps: 30},
  medium: {dpr: 1.25, shadows: true, oceanSeg: 96, foam: 128, aa: true},
  high: {dpr: 2, shadows: true, oceanSeg: 180, foam: 192, aa: true},
};
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXY';

/* ---------------- Conway's Game of Life, discrete; the shader interpolates between generations ---------------- */
class Life {
  constructor(n, density = .11) { this.n = n; this.a = new Uint8Array(n * n); this.b = new Uint8Array(n * n); for (let i = 0; i < n * n; i++) this.a[i] = Math.random() < density ? 255 : 0; }
  step() {   // standard B3/S23 on a torus (so the texture tiles seamlessly across the ocean)
    const {n, a, b} = this; let alive = 0;
    for (let y = 0; y < n; y++) { const ym = ((y - 1 + n) % n) * n, y0 = y * n, yp = ((y + 1) % n) * n;
      for (let x = 0; x < n; x++) { const xm = (x - 1 + n) % n, xp = (x + 1) % n;
        const k = (a[ym + xm] + a[ym + x] + a[ym + xp] + a[y0 + xm] + a[y0 + xp] + a[yp + xm] + a[yp + x] + a[yp + xp]) / 255;
        const v = k === 3 || (k === 2 && a[y0 + x]) ? 255 : 0; b[y0 + x] = v; if (v) alive++; } }
    this.a = b; this.b = a;
    // keep the sea alive: a glider or two when it thins out (cells still obey Conway's rules every generation)
    if (alive < n * n * .07) for (let g = 0; g < 6; g++) this.glider();
  }
  glider() { const n = this.n, x0 = Math.random() * n | 0, y0 = Math.random() * n | 0, fx = Math.random() < .5 ? 1 : -1, fy = Math.random() < .5 ? 1 : -1;
    for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) this.a[((y0 + y * fy + n) % n) * n + (x0 + x * fx + n) % n] = 255; }
}

/* ---------------- ocean shader: gentle waves, sun, horizon fog, world-space GOL foam ---------------- */
const OCEAN_VERT = `
uniform float uTime; uniform vec4 uBoard;
varying vec3 vWorld; varying vec3 vN; varying float vH;
#include <fog_pars_vertex>
float wave(vec2 p){ return sin(p.x*.33+uTime*.8)*.09 + sin(p.y*.27-uTime*.65)*.08 + sin((p.x+p.y)*.71+uTime*1.25)*.035 + sin((p.x-p.y)*1.3-uTime*1.7)*.015; }
float calm(vec2 p){ vec2 d = max(vec2(uBoard.x-p.x, p.x-uBoard.z), 0.); vec2 e = max(vec2(uBoard.y-p.y, p.y-uBoard.w), 0.); float o = length(vec2(max(d.x,d.y), max(e.x,e.y))); return mix(.3, 1., smoothstep(0., 4., o)); }
void main(){
  vec4 w = modelMatrix * vec4(position, 1.);
  float k = calm(w.xz), h = wave(w.xz) * k, e = .25;
  float hx = wave(w.xz + vec2(e, 0.)) * k, hz = wave(w.xz + vec2(0., e)) * k;
  vN = normalize(vec3(h - hx, e, h - hz)); vH = h; w.y += h; vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const OCEAN_FRAG = `
uniform float uTime, uMix, uFoamSize, uFoamStrength, uTexel; uniform sampler2D uPrev, uNext; uniform vec4 uBoard; uniform vec3 uSun, uView, uDeep, uShallow;
varying vec3 vWorld; varying vec3 vN; varying float vH;
#include <fog_pars_fragment>
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float outside(vec2 p){ vec2 d = max(vec2(uBoard.x-p.x, p.x-uBoard.z), 0.); vec2 e = max(vec2(uBoard.y-p.y, p.y-uBoard.w), 0.); return length(vec2(max(d.x,d.y), max(e.x,e.y))); }
void main(){
  vec3 n = normalize(vN), L = normalize(uSun), V = normalize(uView);
  vec3 col = mix(uDeep, uShallow, smoothstep(-.12, .16, vH));
  float dif = max(dot(n, L), 0.), spec = pow(max(dot(n, normalize(L + V)), 0.), 90.) * .55;
  float fres = pow(1. - max(dot(n, V), 0.), 3.) * .25;
  col = col * (.55 + .55 * dif) + spec + fres * vec3(.75, .9, 1.);
  // Conway foam in world space: drift (advection) + slight domain warp; prev→next blended with smoothstep
  vec2 drift = vec2(uTime * .06, uTime * .025);   // slow, coherent drift like a swell
  vec2 warp = vec2(noise(vWorld.xz * .7 + uTime * .05), noise(vWorld.xz * .7 - uTime * .04 + 7.)) - .5;
  vec2 uv = (vWorld.xz + drift) / uFoamSize + warp * .0015;   // a hint of swell, squares stay squares
  float t = uMix * uMix * (3. - 2. * uMix);
  // Crisp Conway cells: each one is a rounded square read at its texel centre. Its size and brightness follow the
  // eased intensity, so a cell grows in when born and shrinks away when it dies — smooth, but clearly Game of Life.
  float cells = 1. / uTexel;
  vec2 g = uv * cells, id = floor(g), f = fract(g) - .5, tuv = (id + .5) / cells;
  float v = mix(texture2D(uPrev, tuv).r, texture2D(uNext, tuv).r, t);
  float hs = .12 + .3 * v, rr = .08;
  vec2 q = abs(f) - (hs - rr); float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - rr;
  float aa = fwidth(d) * 1.1 + .01;
  float foam = (1. - smoothstep(-aa, aa, d)) * smoothstep(.05, .4, v) * (.82 + .18 * noise(id * .37 + uTime * .05));
  float core = foam * smoothstep(.8, 1., v) * .35;
  float mask = mix(.1, 1., smoothstep(.5, 4.5, outside(vWorld.xz)));   // quieter on the tactical board, never cut off abruptly
  float crest = smoothstep(.02, .12, vH) * .35;                // foam gathers on wave crests
  col = mix(col, vec3(.92, .97, 1.), clamp(foam * (.55 + crest) + core * .25, 0., 1.) * mask * uFoamStrength);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/* ---------------- container textures (corrugated steel + workload label) ---------------- */
const CONTAINER_COLORS = ['#2f7bff', '#ffcb3b', '#23e4d0', '#ff754f', '#0db7ed', '#8a63d2', '#3ddc84', '#f4f1df'];
const LABELS = ['nginx', 'redis', 'postgres', 'alpine', 'busybox', 'node', 'caddy', 'docker'];
const texCache = new Map();
function containerTexture(label, color) {
  const key = label + color; if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 10) { g.fillStyle = '#00000026'; g.fillRect(x, 0, 4, 128); g.fillStyle = '#ffffff22'; g.fillRect(x + 5, 0, 2, 128); }
  g.strokeStyle = '#00000055'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 122);
  const [img, name] = String(label).split('|');
  g.fillStyle = '#ffffffe8'; g.fillRect(22, 30, 212, name ? 68 : 46); g.fillStyle = '#0a2342'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 30px ui-monospace,Menlo,monospace'; g.fillText(img, 128, name ? 50 : 53, 200);
  if (name) { g.font = '700 17px ui-monospace,Menlo,monospace'; g.fillText(name, 128, 80, 204); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(key, t); return t;
}

/* ---------------- creatures: lofted low-poly bodies sized to fit their board footprint ---------------- */
const lerpTable = (tab, u) => { for (let i = 1; i < tab.length; i++) if (u <= tab[i][0]) { const [u0, a] = tab[i - 1], [u1, b] = tab[i], t = (u - u0) / (u1 - u0), s = t * t * (3 - 2 * t); return a + (b - a) * s; } return tab[tab.length - 1][1]; };
const WHALE = {W: [[0, .07], [.1, .15], [.25, .42], [.45, .74], [.62, .86], [.78, .86], [.9, .74], [.97, .5], [1, .04]], H: [[0, .08], [.1, .16], [.25, .44], [.45, .76], [.62, .9], [.78, .92], [.9, .82], [.97, .56], [1, .04]], C: [[0, .3], [.2, .16], [.5, 0], [.85, -.02], [1, -.1]]};
const WALRUS = {W: [[0, .32], [.15, .62], [.5, .8], [.8, .74], [.94, .52], [1, .06]], H: [[0, .22], [.2, .5], [.55, .66], [.85, .62], [.96, .44], [1, .06]], C: [[0, -.05], [.5, 0], [1, .05]]};
const SQUID = {W: [[0, .55], [.15, .66], [.45, .52], [.8, .3], [.97, .1], [1, .02]], H: [[0, .5], [.15, .62], [.45, .5], [.8, .3], [.97, .1], [1, .02]], C: [[0, 0], [1, .08]]};
// Loft elliptical cross-sections along x. sw/sh scale the tables so the body fits one board cell across.
function loft(T, length, sw, sh, palette, {rings = 34, seg = 16, flat = .82} = {}) {
  const pos = [], col = [], idx = [], ctop = new THREE.Color(palette.top), cside = new THREE.Color(palette.side), cbelly = new THREE.Color(palette.belly), c = new THREE.Color();
  for (let i = 0; i <= rings; i++) { const u = i / rings, rw = lerpTable(T.W, u) * sw, rh = lerpTable(T.H, u) * sh, cy = lerpTable(T.C, u) * sh, x = (u - .5) * length;
    for (let j = 0; j <= seg; j++) { const th = j / seg * Math.PI * 2, cs = Math.cos(th); pos.push(x, cy + rh * cs * (cs < 0 ? flat : 1), rw * Math.sin(th));
      c.copy(cside).lerp(ctop, THREE.MathUtils.smoothstep(cs, .3, .9)).lerp(cbelly, THREE.MathUtils.smoothstep(-cs, .05, .45)); col.push(c.r, c.g, c.b); } }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + seg + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const at = (u, th, out = 0) => { const rw = lerpTable(T.W, u) * sw, rh = lerpTable(T.H, u) * sh, cy = lerpTable(T.C, u) * sh, cs = Math.cos(th); return new THREE.Vector3((u - .5) * length, cy + (rh + out) * cs * (cs < 0 ? flat : 1), (rw + out) * Math.sin(th)); };
  return {geo, at, top: u => lerpTable(T.C, u) * sh + lerpTable(T.H, u) * sh};
}
const MAT = {};
const mat = (key, make) => MAT[key] ||= make();
const ink = () => mat('ink', () => new THREE.MeshStandardMaterial({color: '#0a2342', roughness: .4}));
const whiteM = () => mat('white', () => new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .3}));
const steel = () => mat('steel', () => new THREE.MeshStandardMaterial({color: '#2b3440', roughness: .6, metalness: .5}));
function eyes(g, at, u, th, r = .07) { for (const s of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), whiteM()); e.position.copy(at(u, s * th)); g.add(e);
  const p = new THREE.Mesh(new THREE.SphereGeometry(r * .56, 10, 6), ink()); p.position.copy(at(u + .005, s * th, r * .55)); g.add(p); } }
// One container per board segment, so a hit on segment j knocks off container j.
function containerMesh(label, k, seed, size) {
  const color = CONTAINER_COLORS[(seed * 5 + k * 3) % CONTAINER_COLORS.length];
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({map: containerTexture(label, color), roughness: .7, metalness: .15})); m.castShadow = true; return m;
}
function stackOn(g, labels, seed, {x0, x1, y, depth = .36, h = .3}) {   // two rows across the deck, tail→head
  const n = labels.length, cols = Math.ceil(n / 2), cw = (x1 - x0) / cols, boxes = [];
  labels.forEach((lab, j) => { const col = Math.floor(j / 2), side = n === 1 ? 0 : (j % 2 ? 1 : -1), m = containerMesh(lab, j, seed, [cw - .04, h, depth / (n === 1 ? 1 : 2) * .96]);
    m.position.set(x0 + cw * (col + .5), y + h / 2, side * depth / 4 * (n === 1 ? 0 : 1)); g.add(m); boxes.push(m); });
  return boxes;
}
const bendY = (u, time, amp) => amp * Math.sin(time * 1.6 - u * 3.2) * Math.pow(1 - u, 2.2);
function tailBend(material, uniforms) {
  material.onBeforeCompile = sh => { Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uAmp, uLen;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat wu = clamp(position.x / uLen + .5, 0., 1.);\ntransformed.y += uAmp * sin(uTime * 1.6 - wu * 3.2) * pow(1. - wu, 2.2);'); };
}
// 🐋 a whale of the given body length; `labels` = one container per segment (empty for the mini whales' single box)
function whaleBody(length, seed, labels, {sw = .58, sh = .62, palette = {top: '#2f7bff', side: '#1d5fd6', belly: '#eef6ff'}, deck = true} = {}) {
  const g = new THREE.Group(), L = loft(WHALE, length, sw, sh, palette), uniforms = {uTime: {value: 0}, uAmp: {value: .05 * sh / .62}, uLen: {value: length}};
  const skin = new THREE.Mesh(L.geo, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .55, metalness: .05, flatShading: true})); tailBend(skin.material, uniforms); skin.castShadow = true; g.add(skin);
  eyes(g, L.at, .86, 1.3, .07 * sh / .62 + .02);
  for (const s of [1, -1]) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([.76, .84, .91, .965, .995].map((u, i) => L.at(u, s * (2.05 - i * .1), .004))), 12, .018, 4), ink()));
  const hole = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), ink()); hole.scale.set(1.6, .35, 1); hole.position.copy(L.at(.76, 0, -.01)); g.add(hole);
  const finMat = new THREE.MeshStandardMaterial({color: palette.side, roughness: .55, flatShading: true}), fins = [];
  for (const s of [1, -1]) { const pv = new THREE.Group(), f = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), finMat); f.scale.set(.12 * length / 3 + .05, .035, .3 * sh / .62 + .05); f.position.z = s * (.2 * sh / .62 + .07); f.castShadow = true;
    pv.position.copy(L.at(.64, s * 1.95, -.04)); pv.rotation.set(s * .5, -s * .55, 0); pv.add(f); g.add(pv); fins.push({pv, s}); }
  const fl = new THREE.Shape(); fl.moveTo(0, 0); fl.bezierCurveTo(-.12, .18, -.3, .55, -.72, .95); fl.bezierCurveTo(-.62, .62, -.6, .32, -.5, .1); fl.quadraticCurveTo(-.44, 0, -.5, -.1); fl.bezierCurveTo(-.6, -.32, -.62, -.62, -.72, -.95); fl.bezierCurveTo(-.3, -.55, -.12, -.18, 0, 0);
  const fg = new THREE.ExtrudeGeometry(fl, {depth: .05, bevelEnabled: true, bevelSize: .02, bevelThickness: .02, bevelSegments: 1, curveSegments: 6}); fg.translate(0, 0, -.025); fg.rotateX(Math.PI / 2);
  const fluke = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({color: palette.top, roughness: .5, flatShading: true})); fluke.castShadow = true; fluke.scale.setScalar(Math.min(.5, .22 + length * .06) / .95 * .95 * (sw / .58));
  const fp = new THREE.Group(); fp.position.set(-length / 2 + .02, lerpTable(WHALE.C, 0) * sh, 0); fp.add(fluke); g.add(fp);
  let boxes = [];
  if (labels.length) {
    const x0 = (.3 - .5) * length, x1 = (.8 - .5) * length, y = Math.max(L.top(.3), L.top(.55), L.top(.8)) + .02;
    if (deck) { const d = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + .06, .05, Math.min(.72, sw * 1.5)), steel()); d.position.set((x0 + x1) / 2, y, 0); d.castShadow = true; g.add(d);
      for (const u of [.36, .55, .74]) { const st = new THREE.Mesh(new THREE.TorusGeometry(1, .03, 5, 24), steel()); st.rotation.y = Math.PI / 2; st.scale.set(lerpTable(WHALE.W, u) * sw + .03, lerpTable(WHALE.H, u) * sh + .03, 1); st.position.set((u - .5) * length, lerpTable(WHALE.C, u) * sh, 0); g.add(st); } }
    boxes = stackOn(g, labels, seed, {x0, x1, y: y + .025, depth: Math.min(.7, sw * 1.45), h: labels.length === 1 ? .22 : .28});
  }
  const holePos = hole.position.clone();
  g.userData = {fins, fp, uniforms, boxes, holePos, length, sh,
    update(t, phase) { uniforms.uTime.value = t + phase; const amp = uniforms.uAmp.value, y0 = bendY(0, t + phase, amp), y1 = bendY(.05, t + phase, amp);
      fp.position.y = lerpTable(WHALE.C, 0) * sh + y0; fp.rotation.z = Math.atan2(y1 - y0, length * .05) * 1.3; fins.forEach(({pv, s}, i) => { pv.rotation.x = s * (.5 + .14 * Math.sin(t * 1.1 + i + phase)); }); }};
  return g;
}
function walrusBody(length, seed, labels) {
  const g = new THREE.Group(), L = loft(WALRUS, length, .56, .6, {top: '#c48e6a', side: '#9a6646', belly: '#d9b08c'}, {flat: .9});
  const skin = new THREE.Mesh(L.geo, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .8, flatShading: true})); skin.castShadow = true; g.add(skin);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 8), new THREE.MeshStandardMaterial({color: '#e2bc9c', roughness: .8, flatShading: true})); muzzle.scale.set(.8, .7, 1.15); muzzle.position.copy(L.at(.97, 2.2, -.12)); g.add(muzzle);
  for (const s of [1, -1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(.035, .42, 8), mat('ivory', () => new THREE.MeshStandardMaterial({color: '#fffdf1', roughness: .3}))); t.position.copy(muzzle.position).add(new THREE.Vector3(.05, -.25, s * .08)); t.rotation.set(0, 0, Math.PI + .25); t.castShadow = true; g.add(t);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({color: '#7a4b30', roughness: .8, flatShading: true})); fl.scale.set(.22, .04, .14); fl.position.copy(L.at(.1, s * 1.7, 0)).add(new THREE.Vector3(-.15, -.05, s * .06)); g.add(fl); }
  eyes(g, L.at, .9, 1.05, .055);
  const y = Math.max(L.top(.25), L.top(.55)) - .02, x0 = (.15 - .5) * length, x1 = (.75 - .5) * length, n = labels.length, cols = Math.ceil(n / 2), cw = (x1 - x0) / cols, boxes = [];
  labels.forEach((lab, j) => { const col = CONTAINER_COLORS[(seed + j * 3) % CONTAINER_COLORS.length], cyl = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .3, 14), new THREE.MeshStandardMaterial({color: col, roughness: .5, metalness: .2}));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .02, 14), mat('cap', () => new THREE.MeshStandardMaterial({color: '#eef4ff', roughness: .4}))); cap.position.y = .16; cyl.add(cap);
    for (const ry of [-.06, .06]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.132, .008, 4, 18), ink()); ring.rotation.x = Math.PI / 2; ring.position.y = ry; cyl.add(ring); }
    cyl.position.set(x0 + cw * (Math.floor(j / 2) + .5), y + .15, n === 1 ? 0 : (j % 2 ? .15 : -.15)); cyl.castShadow = true; g.add(cyl); boxes.push(cyl); });
  g.userData = {boxes, update(t, phase) { skin.scale.y = 1 + Math.sin(t * 1.2 + phase) * .02; }};
  return g;
}
function tuxBody(length, seed, labels) {
  const g = new THREE.Group(), geo = new THREE.BoxGeometry(length * .96, .36, .9, Math.max(2, Math.round(length * 2)), 2, 3), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const h = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453 % 1; p.setY(i, p.getY(i) + (p.getY(i) > 0 ? Math.abs(h) * .12 : -Math.abs(h) * .2)); p.setZ(i, p.getZ(i) * (1 + h * .08)); }
  geo.computeVertexNormals();
  const ice = new THREE.Mesh(geo, mat('ice', () => new THREE.MeshStandardMaterial({color: '#e8f8ff', roughness: .35, flatShading: true}))); ice.position.y = .02; ice.castShadow = ice.receiveShadow = true; g.add(ice);
  const n = labels.length, boxes = [];
  labels.forEach((lab, j) => { const r = new THREE.Mesh(new THREE.BoxGeometry(.22, .42, .26), mat('rack', () => new THREE.MeshStandardMaterial({color: '#26333d', roughness: .5, metalness: .4})));
    for (let k = 0; k < 3; k++) { const led = new THREE.Mesh(new THREE.BoxGeometry(.16, .025, .01), new THREE.MeshStandardMaterial({color: '#3ddc84', emissive: (j + k) % 3 ? '#3ddc84' : '#ffcb3b', emissiveIntensity: 1.2})); led.position.set(0, -.12 + k * .12, .131); r.add(led); }
    r.position.set((j - (n - 1) / 2) * length * .96 / n, .41, -.2); r.castShadow = true; g.add(r); boxes.push(r); });
  const pens = []; for (let k = 0; k < Math.max(1, Math.floor(length / 2)); k++) { const pg = buildPenguin(); pg.scale.setScalar(1.25); pg.position.set((k - (Math.max(1, Math.floor(length / 2)) - 1) / 2) * 1.1, .2, .2); g.add(pg); pens.push(pg); }
  g.userData = {boxes, update(t) { pens.forEach(pg => pg.userData.update(t)); }};
  return g;
}
function squidBody(length, seed, labels) {
  const g = new THREE.Group(), mantleLen = length * .58, L = loft(SQUID, mantleLen, .55, .62, {top: '#b393ff', side: '#7d55d6', belly: '#d4c2ff'});
  const skin = new THREE.Mesh(L.geo, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .5, flatShading: true})); skin.position.x = length * .2; skin.castShadow = true; g.add(skin);
  const ex = new THREE.Group(); ex.position.x = length * .2; eyes(ex, L.at, .1, 1.2, .09); g.add(ex);
  const tent = new THREE.Group(); tent.position.x = length * .2 - mantleLen / 2; g.add(tent);
  ['#ffcb3b', '#2f7bff', '#23e4d0', '#ff754f', '#3ddc84', '#f4f1df'].forEach((c, i) => { const a = (i / 6) * Math.PI * 2, z0 = Math.sin(a) * .22, y0 = Math.cos(a) * .18;
    const pts = [0, .25, .5, .75, 1].map(t => new THREE.Vector3(-t * length * .42, y0 * (1 - t) - .05 * t + Math.sin(t * 6 + i) * .05, z0 * (1 + t * .6) + Math.sin(t * 5 + i * 2) * .06));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, .035, 5), new THREE.MeshStandardMaterial({color: c, roughness: .5})); tube.castShadow = true; tent.add(tube);
    const plug = new THREE.Mesh(new THREE.BoxGeometry(.08, .06, .06), mat('plug', () => new THREE.MeshStandardMaterial({color: '#e9f8ff', roughness: .3}))); plug.position.copy(pts[4]); tent.add(plug); });
  const boxes = stackOn(g, labels, seed, {x0: length * .2 - mantleLen * .15, x1: length * .2 + mantleLen * .3, y: L.top(.4) + .02, depth: .4, h: .22});
  g.userData = {boxes, update(t, phase) { tent.rotation.y = Math.sin(t * .9 + phase) * .08; tent.rotation.z = Math.sin(t * .7 + phase) * .04; }};
  return g;
}
// kind: 0 moby · 1 swarm · 2 walrus · 3 tux · 4 squid. len = board cells. Result: centred at origin, head toward +x.
export function buildCreature(kind, len, seed = 0, labels = []) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const lab = Array.from({length: len}, (_, j) => { const [img, name] = String(labels[j] || 'docker').split('|'); return img.split(/[:/]/)[0].slice(0, 8) + (name ? '|' + name : ''); });
  let parts = [], boxes = [], spouters = [];
  if (kind % 5 === 0) { const w = whaleBody(len * .97, seed, lab, {sw: .5, sh: .58}); w.position.y = .2; body.add(w); parts = [w]; boxes = w.userData.boxes; spouters = [w]; }
  else if (kind % 5 === 1) { const w = buildCarrier(len * .96, lab, seed); w.position.y = .05; body.add(w); parts = [w]; boxes = w.userData.boxes; }
  else if (false) for (let j = 0; j < len; j++) { const w = whaleBody(.86, seed + j, [lab[j]], {sw: .44, sh: .48, deck: false, palette: {top: '#3aa6ff', side: '#1e86d6', belly: '#eef6ff'}}); w.position.set(j - (len - 1) / 2, .15, j % 2 ? .1 : -.1); w.rotation.y = (j % 2 ? -.12 : .12); body.add(w); parts.push(w); boxes.push(...w.userData.boxes); if (j === len - 1) spouters.push(w); }
  else if (kind % 5 === 2) { const w = walrusBody(len * .95, seed, lab); w.position.y = .12; body.add(w); parts = [w]; boxes = w.userData.boxes; }
  else if (kind % 5 === 3) { const w = tuxBody(len, seed, lab); body.add(w); parts = [w]; boxes = w.userData.boxes; }
  else { const w = squidBody(len * .96, seed, lab); w.position.y = .12; body.add(w); parts = [w]; boxes = w.userData.boxes; }
  // spout particles (pooled)
  const SP = 30, sp = new Float32Array(SP * 3), vel = Array.from({length: SP}, () => new THREE.Vector3()), sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const spout = new THREE.Points(sg, new THREE.PointsMaterial({color: '#eaf8ff', size: .08, transparent: true, opacity: .9, depthWrite: false})); spout.visible = false; root.add(spout);
  const flying = []; let spoutT = -1, sink = null, phase = seed * 1.7;
  const flames = new Map(), SM = 26, smP = new Float32Array(SM * 3), smV = Array.from({length: SM}, () => ({v: new THREE.Vector3(), life: 1})), smG = new THREE.BufferGeometry(); smG.setAttribute('position', new THREE.BufferAttribute(smP, 3));
  const smoke = new THREE.Points(smG, new THREE.PointsMaterial({color: '#4a5560', size: .22, transparent: true, opacity: .45, depthWrite: false})); smoke.visible = false; root.add(smoke);
  const segX = j => (j - (len - 1) / 2) * .96;
  root.userData = {kind, len, boxes, gone: new Set(),
    update(t, dt) {
      if (!sink || sink.t < 1) { body.position.y = Math.sin(t * .9 + phase) * .03; body.rotation.x = Math.sin(t * .7 + phase) * .02; }
      for (const p of parts) p.userData.update?.(t, phase);
      if (spoutT >= 0) { spoutT += dt; for (let i = 0; i < SP; i++) { vel[i].y -= 3 * dt; sp[i * 3] += vel[i].x * dt; sp[i * 3 + 1] += vel[i].y * dt; sp[i * 3 + 2] += vel[i].z * dt; } sg.attributes.position.needsUpdate = true; spout.material.opacity = Math.max(0, .9 - spoutT * .6); if (spoutT > 1.5) { spoutT = -1; spout.visible = false; } }
      if (flames.size && !sink) { const fl = [...flames.values()]; fl.forEach((f, i) => { const k = .75 + .35 * Math.sin(t * 13 + i * 2.1) * Math.sin(t * 7.3 + i); f.scale.set(.42 * k, .6 * k, 1); f.material.opacity = .75 + .25 * Math.sin(t * 9 + i); });
        for (let i = 0; i < SM; i++) { const s = smV[i]; s.life += dt * .7; if (s.life >= 1) { const f = fl[Math.floor(Math.random() * fl.length)]; s.life = Math.random() * .3; smP[i * 3] = f.position.x + (Math.random() - .5) * .15; smP[i * 3 + 1] = f.position.y + .1; smP[i * 3 + 2] = f.position.z + (Math.random() - .5) * .15; s.v.set((Math.random() - .5) * .15, .55 + Math.random() * .3, (Math.random() - .5) * .15); }
          smP[i * 3] += s.v.x * dt; smP[i * 3 + 1] += s.v.y * dt; smP[i * 3 + 2] += s.v.z * dt; } smG.attributes.position.needsUpdate = true; }
      for (let i = flying.length - 1; i >= 0; i--) { const f = flying[i]; f.v.y -= 4 * dt; f.m.position.addScaledVector(f.v, dt); f.m.rotation.x += f.r * dt; f.m.rotation.z += f.r * .7 * dt; if (f.m.getWorldPosition(new THREE.Vector3()).y < -.4) { f.m.visible = false; flying.splice(i, 1); } }
      if (sink && sink.t < 1) { sink.t = Math.min(1, sink.t + dt / (sink.anim ? 2.6 : .001)); const e = sink.t * sink.t; body.position.y = -.55 * e; body.rotation.z = -.25 * e; body.rotation.x = .2 * e; }
    },
    spout() { const s = spouters[0]; if (!s || sink) return; const h = s.localToWorld(s.userData.holePos.clone()); root.worldToLocal(h); spout.visible = true; spoutT = 0; for (let i = 0; i < SP; i++) { sp[i * 3] = h.x; sp[i * 3 + 1] = h.y; sp[i * 3 + 2] = h.z; vel[i].set((Math.random() - .5) * .4, 1.4 + Math.random() * .8, (Math.random() - .5) * .4); } sg.attributes.position.needsUpdate = true; },
    burn(j) { if (flames.has(j) || sink) return; const f = new THREE.Sprite(new THREE.SpriteMaterial({map: getFlameTex(), depthWrite: false, transparent: true, toneMapped: false}));
      f.position.set(segX(j), .62, 0); f.center.set(.5, .15); body.add(f); flames.set(j, f); smoke.visible = true; },
    knockOff(j, animate) { const m = boxes[j]; if (!m || root.userData.gone.has(j)) return; root.userData.gone.add(j); if (!animate) { m.visible = false; return; } flying.push({m, v: new THREE.Vector3((Math.random() - .5) * 1.2, 2.2, (Math.random() - .5) * 1.2), r: (Math.random() - .5) * 8}); },
    sinkNow(animate) { if (sink) return; sink = {t: 0, anim: animate}; flames.forEach(f => f.visible = false); smoke.visible = false; root.traverse(o => { if (o.material && !o.isPoints) { o.material = o.material.clone(); if (o.material.color) o.material.color.lerp(new THREE.Color('#55606a'), .55); if (o.material.emissive) o.material.emissiveIntensity = 0; } }); boxes.forEach((b, j) => this.knockOff(j, animate && Math.random() < .7)); },
  };
  return root;
}
/* ---------------- small props: iceberg with a penguin admin, buoy ---------------- */
export function buildIceberg(seed = 1) {
  const g = new THREE.Group(), geo = new THREE.IcosahedronGeometry(1, 1), p = geo.attributes.position, rnd = (i) => (Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453) % 1;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setXYZ(i, p.getX(i) * (1 + rnd(i) * .25), y > 0 ? y * (.9 + Math.abs(rnd(i + 9)) * .7) : y * .5, p.getZ(i) * (1 + rnd(i + 3) * .25)); }
  geo.computeVertexNormals();
  const ice = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color: '#e8f8ff', roughness: .35, flatShading: true})); ice.castShadow = true; ice.receiveShadow = true; ice.scale.set(1.1, .7, .9); g.add(ice);
  const under = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color: '#7fd0f5', roughness: .5, flatShading: true, transparent: true, opacity: .35})); under.scale.set(1.5, .9, 1.3); under.position.y = -.55; g.add(under);
  const peng = buildPenguin(); peng.position.set(.1, .62, .05); g.add(peng);
  g.userData.update = t => { g.position.y = Math.sin(t * .6 + seed) * .04; g.rotation.y = seed + t * .01; peng.userData.update(t); };
  return g;
}
function buildPenguin() {
  const g = new THREE.Group(), black = new THREE.MeshStandardMaterial({color: '#141c26', roughness: .5}), white = new THREE.MeshStandardMaterial({color: '#fbfaf2', roughness: .5}), orange = new THREE.MeshStandardMaterial({color: '#ffa63d', roughness: .5});
  const bodyM = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .16, 4, 10), black); bodyM.position.y = .2; bodyM.castShadow = true; g.add(bodyM);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(.105, 12, 10), white); belly.scale.set(.75, 1.25, .6); belly.position.set(0, .19, .06); g.add(belly);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.1, 12, 10), black); head.position.y = .42; g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(.03, .09, 8), orange); beak.rotation.x = Math.PI / 2; beak.position.set(0, .41, .1); g.add(beak);
  for (const s of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.018, 8, 6), white); e.position.set(s * .04, .45, .08); g.add(e); const f = new THREE.Mesh(new THREE.BoxGeometry(.06, .02, .08), orange); f.position.set(s * .05, .01, .04); g.add(f); }
  const laptop = new THREE.Group(), base = new THREE.Mesh(new THREE.BoxGeometry(.14, .01, .1), new THREE.MeshStandardMaterial({color: '#5c6b75'})), lid = new THREE.Mesh(new THREE.BoxGeometry(.14, .1, .01), new THREE.MeshStandardMaterial({color: '#5c6b75', emissive: '#3ddc84', emissiveIntensity: .6}));
  lid.position.set(0, .05, -.05); laptop.add(base, lid); laptop.position.set(0, .22, .17); g.add(laptop);
  g.userData.update = t => { g.rotation.y = Math.sin(t * .4) * .5 + .6; head.rotation.z = Math.sin(t * 1.3) * .12; };
  return g;
}
function buildBuoy() {
  const g = new THREE.Group(), red = new THREE.MeshStandardMaterial({color: '#ff5a3c', roughness: .5}), wht = new THREE.MeshStandardMaterial({color: '#f4f1df', roughness: .5});
  const a = new THREE.Mesh(new THREE.CylinderGeometry(.18, .26, .3, 10), red), b = new THREE.Mesh(new THREE.CylinderGeometry(.1, .18, .25, 10), wht); b.position.y = .27; a.castShadow = b.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), new THREE.MeshStandardMaterial({color: '#23e4d0', emissive: '#23e4d0', emissiveIntensity: 1})); lamp.position.y = .45; g.add(a, b, lamp);
  g.userData.update = t => { g.position.y = Math.sin(t * 1.4 + g.position.x) * .05; g.rotation.z = Math.sin(t * 1.1) * .08; lamp.material.emissiveIntensity = (Math.sin(t * 3) > .6) ? 2.5 : .3; };
  return g;
}

let flameTex = null;
function getFlameTex() { if (flameTex) return flameTex; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 36, 0, 32, 36, 30);
  r.addColorStop(0, '#fff3b0ff'); r.addColorStop(.22, '#ffb627f5'); r.addColorStop(.5, '#ff5a1fd0'); r.addColorStop(.8, '#d6281a60'); r.addColorStop(1, '#a0181000'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); flameTex = new THREE.CanvasTexture(c); return flameTex; }
/* ---------------- vessels: Kubernetes carrier + Linux icebreaker (scenery, never part of game state) ---------------- */
function hullGeo(len, beam, depth) {   // top-view outline with a pointed bow, extruded upward
  const sh = new THREE.Shape(); sh.moveTo(-len / 2, -beam / 2); sh.lineTo(len * .28, -beam / 2); sh.quadraticCurveTo(len * .48, -beam * .35, len / 2, 0); sh.quadraticCurveTo(len * .48, beam * .35, len * .28, beam / 2); sh.lineTo(-len / 2, beam / 2); sh.lineTo(-len / 2, -beam / 2);
  const g = new THREE.ExtrudeGeometry(sh, {depth, bevelEnabled: true, bevelSize: .04, bevelThickness: .04, bevelSegments: 1}); g.rotateX(-Math.PI / 2); return g;
}
function wheel(color = '#326ce5') {   // a ship's-wheel motif (helm), Kubernetes-inspired but not the logo
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({color, roughness: .4, metalness: .3, emissive: color, emissiveIntensity: .25});
  g.add(new THREE.Mesh(new THREE.TorusGeometry(.22, .035, 6, 20), m));
  for (let i = 0; i < 7; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .56, 5), m); sp.rotation.z = i / 7 * Math.PI; g.add(sp); }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .05, 10).rotateX(Math.PI / 2), m)); return g;
}
// ☸ Kubernetes carrier: a container ship sized to its footprint (length L, one cell wide), bridge at the stern,
// one container per board segment (so hits knock off the right one), a helm wheel and a spinning radar.
export function buildCarrier(L = 4.4, labels = ['nginx', 'redis', 'postgres', 'etcd', 'node', 'caddy', 'alpine', 'docker'], seed = 4) {
  const g = new THREE.Group(), beam = .82, hull = new THREE.Mesh(hullGeo(L, beam, .42), new THREE.MeshStandardMaterial({color: '#1f3b57', roughness: .6, flatShading: true})); hull.position.y = -.16; hull.castShadow = true; g.add(hull);
  const stripe = new THREE.Mesh(hullGeo(L + .02, beam + .02, .1), new THREE.MeshStandardMaterial({color: '#c8352b', roughness: .6})); stripe.position.y = -.18; g.add(stripe);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L * .8, .04, beam * .86), steel()); deck.position.set(-L * .04, .3, 0); g.add(deck);
  const x0 = -L / 2 + .75, x1 = L / 2 - .5, n = labels.length, cols = Math.ceil(n / 2), cw = (x1 - x0) / cols, boxes = [];
  labels.forEach((lab, j) => { const m = containerMesh(lab, j, seed, [cw - .05, .28, beam * .42]); m.position.set(x0 + cw * (Math.floor(j / 2) + .5), .47, n === 1 ? 0 : (j % 2 ? .19 : -.19)); g.add(m); boxes.push(m); });
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(.5, .6, beam * .9), new THREE.MeshStandardMaterial({color: '#f4f1df', roughness: .5})); bridge.position.set(-L / 2 + .38, .6, 0); bridge.castShadow = true; g.add(bridge);
  const win = new THREE.Mesh(new THREE.BoxGeometry(.51, .09, beam * .8), new THREE.MeshStandardMaterial({color: '#0a2342', emissive: '#7fe3ff', emissiveIntensity: .7})); win.position.set(-L / 2 + .38, .76, 0); g.add(win);
  const helm = wheel(); helm.scale.setScalar(.85); helm.position.set(-L / 2 + .66, .6, 0); helm.rotation.y = Math.PI / 2; g.add(helm);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .6, 6), steel()); mast.position.set(-L / 2 + .38, 1.18, 0); g.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), whiteM()); dish.position.set(-L / 2 + .38, 1.45, 0); dish.rotation.x = Math.PI; g.add(dish);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshStandardMaterial({color: '#23e4d0', emissive: '#23e4d0', emissiveIntensity: 2})); lamp.position.set(L / 2 - .1, .25, 0); g.add(lamp);
  g.userData = {boxes, update: t => { helm.rotation.z = t * .6; dish.rotation.y = t * 1.5; lamp.material.emissiveIntensity = Math.sin(t * 3) > .5 ? 2.5 : .3; }};
  return g;
}
export function buildIcebreaker() {
  const g = new THREE.Group(), hull = new THREE.Mesh(hullGeo(2.6, .95, .55), new THREE.MeshStandardMaterial({color: '#d63a2c', roughness: .55, flatShading: true})); hull.position.y = -.2; hull.castShadow = true; g.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(.9, .45, .7), new THREE.MeshStandardMaterial({color: '#fbfaf2', roughness: .5})); cabin.position.set(-.2, .48, 0); cabin.castShadow = true; g.add(cabin);
  const top = new THREE.Mesh(new THREE.BoxGeometry(.5, .25, .55), new THREE.MeshStandardMaterial({color: '#fbfaf2', roughness: .5})); top.position.set(-.1, .82, 0); g.add(top);
  const win = new THREE.Mesh(new THREE.BoxGeometry(.52, .08, .5), new THREE.MeshStandardMaterial({color: '#0a2342', emissive: '#3ddc84', emissiveIntensity: .5})); win.position.set(-.1, .86, 0); g.add(win);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(.11, .13, .4, 10), new THREE.MeshStandardMaterial({color: '#ffcb3b', roughness: .5})); funnel.position.set(-.55, .95, 0); g.add(funnel);
  const crane = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .9), new THREE.MeshStandardMaterial({color: '#ffcb3b'})); crane.position.set(.6, .7, 0); crane.rotation.x = .5; g.add(crane);
  const crew = [buildPenguin(), buildPenguin()]; crew[0].position.set(.55, .3, .25); crew[1].position.set(.75, .3, -.2); crew.forEach(c => { c.scale.setScalar(.9); g.add(c); });
  g.userData.update = t => crew.forEach(c => c.userData.update(t));
  return g;
}
/* ---------------- the world ---------------- */
export function createWorld(canvas, {quality = 'medium'} = {}) {
  const Q = QUALITY[quality] || QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({canvas, antialias: Q.aa, powerPreference: 'high-performance', alpha: false});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.dpr)); renderer.shadowMap.enabled = Q.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;   // refreshed every 3rd frame below
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(), HORIZON = new THREE.Color('#5fb4e6');
  scene.background = HORIZON; scene.fog = new THREE.Fog(HORIZON, 70, 125);
  // true orthographic camera on the isometric diagonal (elevation ~37°)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 400), base = new THREE.Vector3(), target = new THREE.Vector3(), DIR = new THREE.Vector3(1, 1.08, 1).normalize(), DIST = 70;
  const RIGHT = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), DIR).normalize() /* screen-right on the ground */, FWD = new THREE.Vector3(-DIR.x, 0, -DIR.z).normalize(), SIN_EL = DIR.y;
  let N = 15, HT = 15, viewH = 16, glide = null, framePx = {x: 0, y: 0}, insets = {top: 0, right: 0, bottom: 0, left: 0}, last3 = {z: 1, px: 0, py: 0};
  const placeCamera = () => { camera.position.copy(target).addScaledVector(DIR, DIST); camera.lookAt(target); camera.updateMatrixWorld(); };
  scene.add(new THREE.HemisphereLight('#d8f2ff', '#0b4a7a', 1.15));
  const sun = new THREE.DirectionalLight('#fff3df', 2.4); sun.position.set(18, 30, 6); sun.castShadow = Q.shadows;
  Object.assign(sun.shadow.camera, {left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80}); sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024); sun.shadow.bias = -.0008; scene.add(sun, sun.target);
  // ocean: one displaced plane; Conway foam from two generation textures on the SAME plane as the board
  const life = new Life(Q.foam), mk = () => { const t = new THREE.DataTexture(new Uint8Array(Q.foam * Q.foam), Q.foam, Q.foam, THREE.RedFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  const prev = mk(), next = mk(); next.image.data.set(life.a); prev.image.data.set(life.a); prev.needsUpdate = next.needsUpdate = true;
  const oceanMat = new THREE.ShaderMaterial({vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {uTime: {value: 0}, uMix: {value: 0}, uFoamSize: {value: Q.foam * .3}, uFoamStrength: {value: .6}, uTexel: {value: 1 / Q.foam}, uPrev: {value: null}, uNext: {value: null},
      uBoard: {value: new THREE.Vector4(-7.5, -7.5, 7.5, 7.5)}, uSun: {value: sun.position.clone().normalize()}, uView: {value: DIR.clone()}, uDeep: {value: new THREE.Color('#0b4f86')}, uShallow: {value: new THREE.Color('#1f8fcf')}}])});
  oceanMat.uniforms.uPrev.value = prev; oceanMat.uniforms.uNext.value = next;
  const oceanGeo = new THREE.PlaneGeometry(240, 240, Q.oceanSeg, Q.oceanSeg); oceanGeo.rotateX(-Math.PI / 2); scene.add(new THREE.Mesh(oceanGeo, oceanMat));
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(44, 44).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({opacity: .22})); shadowCatcher.position.y = .02; shadowCatcher.receiveShadow = true; scene.add(shadowCatcher);
  // tactical overlay: the game paints its board canvas (marks, labels, targets) onto this plane
  const boardMat = new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, fog: false}); let board = null, boardTex = null;
  const hover = new THREE.Mesh(new THREE.PlaneGeometry(.96, .96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({color: '#ffd34d', transparent: true, opacity: .4, depthWrite: false})); hover.position.y = .1; hover.visible = false; hover.renderOrder = 3; scene.add(hover);
  // decorative world outside the board (never affects game state)
  const deco = [], add = (o, x, z) => { o.position.x = x; o.position.z = z; scene.add(o); deco.push(o); return o; };
  const cellCenter = (q, r) => new THREE.Vector3(q - N / 2 + .5, 0, r - HT / 2 + .5);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), v3 = new THREE.Vector3();
  const setRay = (cx, cy) => { const r = canvas.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera); };
  // Frame the board inside the free area (screen minus HUD insets): fit both its diamond width and height, then centre it there.
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false);
    const aw = Math.max(120, w - insets.left - insets.right), ah = Math.max(120, h - insets.top - insets.bottom), diag = (N + HT) / Math.SQRT2;
    viewH = Math.max((diag * SIN_EL + 1.4) * h / ah, diag * h / aw) * 1.02;
    const a = w / h; camera.top = viewH / 2; camera.bottom = -viewH / 2; camera.left = -viewH * a / 2; camera.right = viewH * a / 2; camera.updateProjectionMatrix();
    framePx = {x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2};   // the free area's centre, in px from screen centre
    api?.setZoomPan(last3.z, last3.px, last3.py, false);
  }
  // impact effects in the world: pooled water rings + spray bursts (no per-shot allocation)
  const ringGeo = new THREE.RingGeometry(.32, .4, 40).rotateX(-Math.PI / 2), rings = Array.from({length: 12}, () => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, depthWrite: false, fog: false})); m.visible = false; m.renderOrder = 4; scene.add(m); return {m, t: 1, dur: 1, s: 1}; });
  const BP = 48, bursts = Array.from({length: 6}, () => { const g = new THREE.BufferGeometry(), pos = new Float32Array(BP * 3); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({color: '#eaf8ff', size: .12, transparent: true, depthWrite: false})); pts.visible = false; scene.add(pts); return {pts, pos, vel: Array.from({length: BP}, () => new THREE.Vector3()), t: 1}; });
  function ring(x, z, color, delay = 0, scale = 4, dur = 1) { const r = rings.find(r => r.t >= 1) || rings[0]; r.m.position.set(x, .12, z); r.m.material.color.set(color); r.m.scale.setScalar(.3); r.t = -delay / dur; r.dur = dur; r.s = scale; r.m.visible = false; }
  function burst(x, z, color, power) { const b = bursts.find(b => b.t >= 1) || bursts[0]; b.t = 0; b.pts.material.color.set(color); b.pts.visible = true;
    for (let i = 0; i < BP; i++) { b.pos[i * 3] = x; b.pos[i * 3 + 1] = .1; b.pos[i * 3 + 2] = z; const a = Math.random() * Math.PI * 2, sp = (.4 + Math.random()) * power; b.vel[i].set(Math.cos(a) * sp * .6, (1.6 + Math.random() * 1.6) * power, Math.sin(a) * sp * .6); }
    b.pts.geometry.attributes.position.needsUpdate = true; }
  const fireballs = Array.from({length: 6}, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: getFlameTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false})); s.visible = false; s.renderOrder = 5; scene.add(s); return {s, t: 1, big: false}; });
  const sweepGeo = new THREE.CircleGeometry(1.7, 24, 0, .8).rotateX(-Math.PI / 2), sweeps = Array.from({length: 2}, () => { const m = new THREE.Mesh(sweepGeo, new THREE.MeshBasicMaterial({color: '#23e4d0', transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false})); m.visible = false; m.renderOrder = 4; scene.add(m); return {m, t: 1}; });
  function fxTick(dt) {
    for (const f of fireballs) if (f.t < 1) { f.t += dt / (f.big ? 1 : .7); const e = 1 - (1 - Math.min(1, f.t)) ** 2, k = (f.big ? 2.6 : 1.6) * (.3 + e); f.s.scale.set(k, k * 1.1, 1); f.s.position.y = .45 + e * .5; f.s.material.opacity = Math.max(0, 1 - f.t * 1.1); if (f.t >= 1) f.s.visible = false; }
    for (const w of sweeps) if (w.t < 1) { w.t += dt / 1.2; w.m.rotation.y = -w.t * Math.PI * 2.4; w.m.material.opacity = .5 * (1 - w.t); if (w.t >= 1) w.m.visible = false; }
    for (const r of rings) if (r.t < 1) { r.t += dt / r.dur; if (r.t < 0) continue; r.m.visible = r.t < 1; const e = 1 - (1 - r.t) ** 3; r.m.scale.setScalar(.3 + r.s * e); r.m.material.opacity = (1 - r.t) * .85; }
    for (const b of bursts) if (b.t < 1) { b.t += dt / 1.1; for (let i = 0; i < BP; i++) { b.vel[i].y -= 6 * dt; b.pos[i * 3] += b.vel[i].x * dt; b.pos[i * 3 + 1] = Math.max(-.2, b.pos[i * 3 + 1] + b.vel[i].y * dt); b.pos[i * 3 + 2] += b.vel[i].z * dt; }
      b.pts.geometry.attributes.position.needsUpdate = true; b.pts.material.opacity = Math.max(0, 1 - b.t); if (b.t >= 1) b.pts.visible = false; }
  }
  // glowing network packets that arc over the water, with a light trail (pooled)
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#ffffffff'); r.addColorStop(.25, '#ffffffaa'); r.addColorStop(1, '#ffffff00'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const TR = 26, packets = Array.from({length: 8}, () => {
    const g = new THREE.Group(), core = new THREE.Mesh(new THREE.BoxGeometry(.17, .17, .17), new THREE.MeshStandardMaterial({color: '#23e4d0', emissive: '#23e4d0', emissiveIntensity: 2.2}));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTex, color: '#23e4d0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false})); glow.scale.setScalar(1.1); g.add(core, glow);
    const tg = new THREE.BufferGeometry(), tp = new Float32Array(TR * 3); tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({color: '#23e4d0', transparent: true, opacity: .85, fog: false})); trail.frustumCulled = false;
    g.visible = trail.visible = false; scene.add(g, trail); return {g, core, glow, trail, tp, t: 2, from: new THREE.Vector3(), to: new THREE.Vector3(), h: 3, dur: 1, done: null, n: 0};
  });
  function packetTick(dt) {
    for (const p of packets) { if (p.t >= 2) continue; p.t += dt / p.dur;
      if (p.t < 1) { const t = p.t < .5 ? 2 * p.t * p.t : 1 - (-2 * p.t + 2) ** 2 / 2; p.g.position.lerpVectors(p.from, p.to, t); p.g.position.y += p.h * 4 * t * (1 - t) + .15; p.core.rotation.x += dt * 6; p.core.rotation.y += dt * 4;
        p.tp.copyWithin(3, 0, (TR - 1) * 3); p.tp[0] = p.g.position.x; p.tp[1] = p.g.position.y; p.tp[2] = p.g.position.z; if (p.n < TR) { for (let i = p.n; i < TR; i++) p.tp.set([p.g.position.x, p.g.position.y, p.g.position.z], i * 3); p.n = TR; } p.trail.geometry.attributes.position.needsUpdate = true; }
      else { if (p.done) { p.done(); p.done = null; } p.g.visible = false; p.trail.material.opacity = Math.max(0, .85 * (2 - p.t) - .4); if (p.t >= 1.5) { p.trail.visible = false; p.t = 2; } } }
  }
  // animal attacks: a temporary whale/squid performs the move at the target, then dives away
  const stunts = [];
  function stuntTick(dt) { for (let i = stunts.length - 1; i >= 0; i--) { const s = stunts[i]; s.t += dt; s.step(s.t); s.m.userData.update?.(time, dt); if (s.t >= s.dur) { scene.remove(s.m); stunts.splice(i, 1); } } }
  // cruising scenery ships on loops around the battlefield
  const cruisers = [];
  // creatures (only what the player may see: own fleet, revealed enemy wrecks, public firewalls)
  const creatures = new Map();
  const GEN_MS = 650, vis = new Float32Array(Q.foam * Q.foam); for (let i = 0; i < vis.length; i++) vis[i] = life.a[i] / 255;
  let genT = 0, last = performance.now(), raf = 0, frames = 0, fpsT = 0, fps = 0, time = 0, nextSpout = 4;
  let lastDraw = 0, frameNo = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (Q.fps && now - lastDraw < 1000 / Q.fps - 2) return;   // frame cap on phones (saves battery)
    lastDraw = now;
    const dt = Math.min(.05, (now - last) / 1000); last = now; time += dt; genT += dt * 1000;
    if (genT >= GEN_MS) { genT %= GEN_MS; prev.image.data.set(next.image.data); life.step();
      // Conway decides alive/dead; the visible foam eases toward it, so cells bloom in and dissolve out over ~3 generations
      const nd = next.image.data, a = life.a; for (let i = 0; i < vis.length; i++) { vis[i] += ((a[i] ? 1 : 0) - vis[i]) * .42; nd[i] = vis[i] * 255; }
      prev.needsUpdate = next.needsUpdate = true; }
    oceanMat.uniforms.uTime.value = time; oceanMat.uniforms.uMix.value = genT / GEN_MS;
    if (glide) { glide.t = Math.min(1, glide.t + dt / glide.dur); const e = 1 - (1 - glide.t) ** 3; target.lerpVectors(glide.from, glide.to, e); camera.zoom = glide.z0 + (glide.z1 - glide.z0) * e; camera.updateProjectionMatrix(); placeCamera(); if (glide.t >= 1) glide = null; }
    fxTick(dt); packetTick(dt); stuntTick(dt);
    for (const c of cruisers) { c.a += dt * c.speed; const R = Math.max(N, HT) * .5 + c.r, x = Math.cos(c.a) * R * 1.15, z = Math.sin(c.a) * R; c.m.position.set(x, Math.sin(time * 1.1 + c.a) * .04, z); c.m.rotation.y = -c.a - (c.speed > 0 ? Math.PI / 2 : -Math.PI / 2); c.m.rotation.z = Math.sin(time * .9 + c.a) * .03; c.m.userData.update?.(time); }
    for (const o of deco) o.userData.update?.(time, dt);
    for (const c of creatures.values()) if (c.visible) c.userData.update(time, dt);
    if (time > nextSpout) { nextSpout = time + 5 + Math.random() * 6; const vis = [...creatures.values()].filter(c => c.visible && c.userData.kind % 5 <= 1); const w = vis[Math.floor(Math.random() * vis.length)]; if (w) { w.userData.spout(); api.onSpout?.(); } }
    if (Q.shadows && frameNo++ % 3 === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    frames++; fpsT += dt; if (fpsT >= 1) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  }
  function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  let api = null; new ResizeObserver(() => resize()).observe(canvas); placeCamera(); start();
  // a little life beyond the battlefield
  const b1 = add(buildBuoy(), 11.5, 4); const b2 = add(buildBuoy(), -10.5, 9); const berg = add(buildIceberg(7), 16, -11); berg.scale.setScalar(1.8);
  const far = buildCreature(0, 4, 9, ['nginx', 'redis', 'postgres', 'alpine']); far.rotation.y = -.7; add(far, -17, 5);
  const carrier = buildCarrier(4.6); scene.add(carrier); cruisers.push({m: carrier, a: 0, speed: .045, r: 6.5});
  const ib = buildIcebreaker(); scene.add(ib); cruisers.push({m: ib, a: 2.6, speed: -.06, r: 4.2});
  api = {
    THREE, scene, camera, get fps() { return fps; }, get info() { return renderer.info.render; },
    setBoard(n, ht, canvasEl) {
      N = n; HT = ht; resize();
      if (board) { scene.remove(board); board.geometry.dispose(); }
      boardTex?.dispose(); boardTex = new THREE.CanvasTexture(canvasEl); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 8; boardMat.map = boardTex; boardMat.needsUpdate = true;
      board = new THREE.Mesh(new THREE.PlaneGeometry(N, HT).rotateX(-Math.PI / 2), boardMat); board.position.y = .09; board.renderOrder = 2; scene.add(board);
      oceanMat.uniforms.uBoard.value.set(-N / 2, -HT / 2, N / 2, HT / 2);
      for (const c of creatures.values()) scene.remove(c); creatures.clear();
    },
    boardDirty() { if (boardTex) boardTex.needsUpdate = true; },
    // pixel offset (px, py) and zoom z, same semantics as the 2D renderer's pan/zoom state
    setInsets(v) { insets = {...insets, ...v}; resize(); },
    setZoomPan(z, px, py, smooth) {
      last3 = {z, px, py};
      // zoom pivots on the free area's centre, so the board stays framed beside the console at any zoom
      const k = viewH / Math.max(1, canvas.clientHeight) / z, to = base.clone().addScaledVector(RIGHT, -(px + framePx.x) * k).addScaledVector(FWD, (py + framePx.y) * k / SIN_EL);
      if (smooth) { glide = {t: 0, dur: .35, from: target.clone(), to, z0: camera.zoom, z1: z}; return; }
      glide = null; target.copy(to); camera.zoom = z; camera.updateProjectionMatrix(); placeCamera();
    },
    cellScreen(cell) { const c = cellCenter(cell % N, Math.floor(cell / N)); c.y = .1; const a = c.clone().project(camera), b = c.clone().add(new THREE.Vector3(1, 0, 0)).project(camera), w = canvas.clientWidth, h = canvas.clientHeight;
      return {x: (a.x + 1) / 2 * w, y: (1 - a.y) / 2 * h, w: Math.abs(b.x - a.x) / 2 * w * 1.41}; },
    pick(cx, cy) { setRay(cx, cy); if (!ray.ray.intersectPlane(ground, hit)) return -1; const q = Math.floor(hit.x + N / 2), r = Math.floor(hit.z + HT / 2); return q >= 0 && r >= 0 && q < N && r < HT ? r * N + q : -1; },
    pickContainer(cx, cy) { setRay(cx, cy); const list = []; for (const [key, c] of creatures) if (c.visible) c.userData.boxes.forEach((b, j) => b.visible && list.push(Object.assign(b, {_key: key, _j: j}))); const h = ray.intersectObjects(list, false)[0]; return h ? {key: h.object._key, j: h.object._j} : null; },
    setHover(cell) { if (cell == null || cell < 0) { hover.visible = false; return; } const p = cellCenter(cell % N, Math.floor(cell / N)); hover.position.x = p.x; hover.position.z = p.z; hover.visible = true; },
    // items: [{key, kind, len, cells (sorted), vertical, hits: [segment idx], sunk, fresh, seed, labels}] — anything not listed is hidden
    syncCreatures(items) {
      const live = new Set();
      for (const it of items) {
        live.add(it.key); const sig = it.cells.join(',') + '|' + it.kind;
        let c = creatures.get(it.key);
        if (!c || c.userData.sig !== sig) {
          if (c) scene.remove(c);
          c = it.kind === 'berg' ? buildIceberg(it.seed) : buildCreature(it.kind, it.len, it.seed, it.labels); c.userData.sig = sig;
          if (it.kind === 'berg') { c.scale.setScalar(.42); c.userData.boxes = []; c.userData.gone = new Set(); const u = c.userData.update; c.userData.update = (t) => u(t); c.userData.knockOff = () => {}; c.userData.sinkNow = () => {}; c.userData.spout = () => {}; }
          const a = cellCenter(it.cells[0] % N, Math.floor(it.cells[0] / N)), b = cellCenter(it.cells[it.cells.length - 1] % N, Math.floor(it.cells[it.cells.length - 1] / N));
          c.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2); c.rotation.y = it.vertical ? -Math.PI / 2 : 0; scene.add(c); creatures.set(it.key, c); c.userData.seen = false;
        }
        c.visible = true;
        for (const j of it.hits || []) { c.userData.knockOff(j, c.userData.seen); if (!it.sunk) c.userData.burn?.(j); }
        if (it.sunk) c.userData.sinkNow(!!it.fresh && c.userData.seen);
        c.userData.seen = true;
      }
      for (const [key, c] of creatures) if (!live.has(key)) c.visible = false;
    },
    splash(cell, kind) {   // kind: 'miss' | 'hit' | 'sunk' | 'decoy'
      const p = cellCenter(cell % N, Math.floor(cell / N)), hit = kind === 'hit' || kind === 'sunk';
      if (hit) { const fb = fireballs.find(f => f.t >= 1) || fireballs[0]; fb.t = 0; fb.big = kind === 'sunk'; fb.s.position.set(p.x, .45, p.z); fb.s.visible = true; }
      burst(p.x, p.z, hit ? '#ffb35c' : kind === 'decoy' ? '#c9a7ff' : '#eaf8ff', kind === 'sunk' ? 1.4 : hit ? 1.1 : .8);
      ring(p.x, p.z, hit ? '#ffcf8a' : '#ffffff', 0, kind === 'sunk' ? 7 : 4, 1.1); ring(p.x, p.z, '#ffffff', .18, kind === 'sunk' ? 5 : 2.6, 1);
      if (kind === 'sunk') ring(p.x, p.z, '#bff3ff', .4, 9, 1.6);
    },
    // fire a glowing packet from one cell to another; resolves on impact
    launch(fromCell, toCell, {color = '#23e4d0', dur = 1.4} = {}) {
      return new Promise(resolve => { const p = packets.find(p => p.t >= 2) || packets[0];
        const a = cellCenter(fromCell % N, Math.floor(fromCell / N)), b = cellCenter(toCell % N, Math.floor(toCell / N));
        p.from.copy(a); p.to.copy(b); p.h = Math.min(6, 1.6 + a.distanceTo(b) * .32); p.dur = dur; p.t = 0; p.n = 0; p.done = resolve;
        p.core.material.color.set(color); p.core.material.emissive.set(color); p.glow.material.color.set(color); p.trail.material.color.set(color); p.trail.material.opacity = .85; p.g.visible = p.trail.visible = true; });
    },
    // kind: 'breach' | 'tail' | 'grab' — resolves at the moment of impact
    stunt(cell, kind, rot = 0) {
      return new Promise(resolve => {
        const c = cellCenter(cell % N, Math.floor(cell / N)), m = kind === 'grab' ? buildCreature(4, 3, 11, ['haproxy', 'envoy']) : buildCreature(0, 4, 13, ['nginx', 'redis', 'postgres', 'alpine']);
        m.rotation.y = -rot * Math.PI / 2 + (kind === 'tail' ? Math.PI : 0); scene.add(m); m.position.copy(c);
        let hitDone = false; const impact = (big) => { if (hitDone) return; hitDone = true; api.splash(cell, big ? 'sunk' : 'hit'); resolve(); };
        const step = kind === 'breach' ? t => { const u = Math.min(1, t / 1.5); m.position.y = -1.4 + 4.2 * u - 4.4 * u * u; m.rotation.z = -1 + 2.1 * u; if (u > .82) impact(true); }
          : kind === 'tail' ? t => { const u = Math.min(1, t / 1.4), lift = Math.sin(Math.min(1, u / .6) * Math.PI / 2); m.position.y = -.35 * lift; m.rotation.z = u < .6 ? -1.1 * lift : -1.1 + 1.6 * Math.min(1, (u - .6) / .15); if (u > .72) impact(false); if (u > .8) m.position.y = -.35 - (u - .8) * 4; }
          : t => { const u = Math.min(1, t / 1.4); m.position.y = -1 + Math.sin(u * Math.PI) * 1.3; m.rotation.y += .05; if (u > .55) impact(false); };
        stunts.push({m, t: 0, dur: kind === 'breach' ? 1.7 : 1.6, step});
      });
    },
    scanFx(cell) { const p = cellCenter(cell % N, Math.floor(cell / N)), w = sweeps.find(w => w.t >= 1) || sweeps[0]; w.m.position.set(p.x, .13, p.z); w.t = 0; w.m.visible = true;
      for (let i = 0; i < 3; i++) ring(p.x, p.z, '#23e4d0', i * .25, 3.5, 1.1); },
    // packet flood: red packets pour in from the horizon onto every cell of the diamond
    floodFx(cell, area) { const c = cellCenter(cell % N, Math.floor(cell / N)), list = area.slice(0, 8);
      return Promise.all(list.map((a, i) => new Promise(res => setTimeout(() => { const src = Math.max(0, Math.min(N * HT - 1, (i % 2 ? 0 : N - 1) + Math.floor(Math.random() * HT) * N)); api.launch(src, a, {color: '#ff5a2e', dur: .9}).then(() => { const q = cellCenter(a % N, Math.floor(a / N)); ring(q.x, q.z, '#ff8a5c', 0, 2.2, .7); res(); }); }, i * 70)))); },
    clearCreatures() { for (const c of creatures.values()) scene.remove(c); creatures.clear(); },
    canvas, stop, start,
  };
  resize();
  return api;
}
