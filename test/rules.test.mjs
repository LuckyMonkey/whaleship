// Server rules tests: run with `node --test test/` (spawns a throwaway server on a random port).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 2000), DIR = mkdtempSync(path.join(tmpdir(), 'ws-test-'));
let srv;
before(async () => {
  srv = spawn(process.execPath, ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT, DATA_DIR: DIR, WEB_ROOT: path.resolve(import.meta.dirname, '../web') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { srv?.kill(); rmSync(DIR, { recursive: true, force: true }); });

// tiny client: send a message, wait for the next reply (state or error)
function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/whaleship/ws`); let st; const waiters = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.state) st = m.state; if (m.type === 'CONNECTED') return; const w = waiters.shift(); if (w) w(m); };
  const next = () => new Promise(r => waiters.push(r));
  const open = new Promise(r => { ws.onopen = r; });
  return { open, get st() { return st; }, async send(msg) { const p = next(); ws.send(JSON.stringify(msg)); return p; },
    async act(type, data = {}) { return this.send({ type, session: st.id, revision: st.revision, action_id: crypto.randomUUID(), ...data }); }, close: () => ws.close() };
}
async function solo(opts = {}) { const c = client(); await c.open; const created = await c.send({ type: 'CREATE_MATCH', mode: 'easy', rules: 'warfare', name: 't', ...opts }); await c.act('RANDOMIZE_FLEET'); await c.act('READY'); return Object.assign(c, { created }); }
const openCells = st => st.opponent.shots.map((v, i) => v === 0 ? i : -1).filter(i => i >= 0);   // avoids the random firewall icebergs
const rot = ([x, y], r) => { for (let i = 0; i < r; i++) [x, y] = [-y, x]; return [x, y]; };
const TEE = [[-1, -2], [0, -2], [1, -2], [0, -1], [0, 0]];

test('the 6×6 sector map is the default: 18×18, 36 sectors, kubernetes carrier in the fleet', async () => {
  const c = client(); await c.open;
  const m = await c.send({ type: 'CREATE_MATCH', mode: 'easy', name: 't' });
  assert.equal(m.state.size, 36); assert.equal(m.state.w, 18); assert.equal(m.state.h, 18); assert.equal(m.state.sectors, true);
  assert.ok(m.state.fleet.some(f => f.kind === 1 && f.name.startsWith('k8s-')));
  assert.equal(m.state.firewalls.length, 5); for (const fw of m.state.firewalls) assert.equal(m.state.me.shots[fw], 5);
  const f = await c.act('RANDOMIZE_FLEET');
  for (const sh of f.state.me.ships) for (const cell of sh.cells) assert.ok(!f.state.firewalls.includes(cell), 'ship on a firewall');
  c.close();
});

test('tail slap hits exactly the rotated T, across sector borders, clipped at the edge', async () => {
  for (const r of [0, 1, 2, 3]) {
    const c = await solo();
    const res = await c.act('POWER', { power: 'tail', cell: 7 * 18 + 7, rot: r });
    assert.ok(!res.error, res.error);
    const rec = res.state.attacks.find(a => a.pattern && a.power === 'tail');
    const want = TEE.map(o => rot(o, r)).map(([dx, dy]) => (7 + dy) * 18 + 7 + dx).sort((a, b) => a - b);
    assert.deepEqual([...rec.area].sort((a, b) => a - b), want);
    c.close();
  }
  const c = await solo();
  const res = await c.act('POWER', { power: 'tail', cell: 0, rot: 0 });
  assert.deepEqual(res.state.attacks.find(a => a.pattern).area, [0]);
  c.close();
});

test('specials respect roles, charges and the classic ruleset', async () => {
  const c = await solo({ rules: 'classic' });
  assert.deepEqual(c.st.me.specials, []);
  assert.ok((await c.act('POWER', { power: 'tail', cell: 50 })).error); c.close();
  const d = await solo();
  const ok = await d.act('POWER', { power: 'breach', cell: 100 }); assert.ok(!ok.error, ok.error);
  // refused either way: out of charges — or, if the AI's reply sank the carrier / jammed us, the role is offline
  const again = await d.act('POWER', { power: 'breach', cell: 40 }); assert.match(again.error || '', /charges|offline|rate-limited/);
  d.close();
});

test('salvo fire validates targets server-side', async () => {
  const c = await solo(), open = openCells(c.st);
  assert.match((await c.act('FIRE', { cells: open.slice(0, 9) })).error, /shot/);
  assert.match((await c.act('FIRE', { cells: [c.st.firewalls[0]] })).error, /firewall/);
  const ok = await c.act('FIRE', { cells: open.slice(0, 3) }); assert.ok(!ok.error, ok.error);
  c.close();
});

test('docker-style container names: format, uniqueness, stable on reconnect, nothing leaked', async () => {
  const c = await solo(), st = c.st, mf = st.me.manifest, all = Object.values(mf).flat();
  assert.equal(all.length, st.fleet.reduce((n, f) => n + f.len, 0), 'one container per segment');
  assert.equal(new Set(all.map(x => x.name)).size, all.length, 'names unique');
  for (const x of all) {
    if (x.kind === 'container') { assert.match(x.name, /^[a-z]+_[a-z]+\d?$/); assert.notEqual(x.name, 'boring_wozniak'); }
    if (x.kind === 'statefulset-pod') assert.match(x.name, /-\d+$/);
    if (x.kind === 'deployment-pod') assert.match(x.name, /^[a-z0-9]+-api-[a-z0-9]{10}-[a-z0-9]{5}$/);
  }
  assert.deepEqual(st.opponent.manifest, {}, 'no enemy names before anything is sunk');
  const d = client(); await d.open;
  const res = await d.send({ type: 'RESUME_MATCH', session: st.id, credential: c.created.credential });
  assert.deepEqual(res.state.me.manifest, mf, 'same names after reconnect');
  const fired = await c.act('FIRE', { cells: openCells(st).slice(0, 3) }); assert.ok(!fired.error, fired.error);
  for (const a of fired.state.attacks) { if (a.hit) assert.ok(a.container?.name); else assert.equal(a.container, undefined); }
  c.close(); d.close();
});

test('LIST_MATCHES: status of every game you hold a seat in, nothing for wrong credentials', async () => {
  const a = await solo(), b = await solo();
  const c = client(); await c.open;
  const res = await c.send({ type: 'LIST_MATCHES', matches: [
    { session: a.st.id, credential: a.created.credential }, { session: b.st.id, credential: b.created.credential }, { session: a.st.id, credential: 'not-my-seat' }, { session: 'nope', credential: 'x' } ] });
  assert.equal(res.type, 'MATCH_LIST'); assert.equal(res.matches.length, 2);
  for (const g of res.matches) { assert.equal(g.phase, 'playing'); assert.equal(g.myTurn, true); assert.equal(g.seat, 0); assert.ok(g.opponent); assert.equal(g.manifest, undefined); assert.equal(g.ships, undefined); }
  a.close(); b.close(); c.close();
});
