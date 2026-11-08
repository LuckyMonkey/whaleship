// Server rules tests: run with `node --test test/` (spawns a throwaway server on a random port).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 2000), DIR = mkdtempSync(path.join(tmpdir(), 'ws-test-'));
let srv;
before(async () => {
  srv = spawn(process.execPath, ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT, DATA_DIR: DIR, WEB_ROOT: path.resolve(import.meta.dirname, '../web'), NODE_TLS_REJECT_UNAUTHORIZED: '0' /* test-only: reach the fake HTTPS push service */ }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { srv?.kill(); rmSync(DIR, { recursive: true, force: true }); });

// tiny client: send a message, wait for the next reply (state or error)
function client(cookie) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/whaleship/ws`, cookie ? { headers: { Cookie: cookie } } : undefined); let st; const waiters = [];
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

test('END_MATCH: forfeits a game in progress from anywhere; needs the seat credential', async () => {
  const a = await solo(), c = client(); await c.open;
  assert.ok((await c.send({ type: 'END_MATCH', session: a.st.id, credential: 'wrong' })).error);
  const r = await c.send({ type: 'END_MATCH', session: a.st.id, credential: a.created.credential });
  assert.equal(r.type, 'MATCH_ENDED'); assert.equal(r.result, 'forfeit');
  const back = await a.send({ type: 'RESUME_MATCH', session: a.st.id, credential: a.created.credential });   // the game itself still records the forfeit
  assert.equal(back.state.phase, 'finished'); assert.equal(back.state.reason, 'forfeit'); assert.notEqual(back.state.winner, back.state.seat);
  a.close(); c.close();
});

test('one player, two devices: both keep a working key to the same seat', async () => {
  const cookie = 'ws_guest=' + 'ab'.repeat(24);                       // same identity on "laptop" and "phone"
  const laptop = client(cookie); await laptop.open;
  const created = await laptop.send({ type: 'CREATE_MATCH', mode: 'easy', name: 't' });
  const phone = client(cookie); await phone.open;
  const joined = await phone.send({ type: 'JOIN_MATCH', session: created.state.id });   // no key on the phone yet
  assert.equal(joined.type, 'MATCH_RESUMED'); assert.equal(joined.state.seat, 0); assert.ok(joined.credential);
  const c = client(); await c.open;
  const res = await c.send({ type: 'LIST_MATCHES', matches: [{ session: created.state.id, credential: created.credential }, { session: created.state.id, credential: joined.credential }] });
  assert.equal(res.matches.length, 2, 'the laptop key still works after the phone joined');
  laptop.close(); phone.close(); c.close();
});

test('profile exposes the push key; guests get no account game list; bad push subscriptions are refused', async () => {
  const prof = await (await fetch(`http://127.0.0.1:${PORT}/whaleship/api/profile`)).json();
  assert.ok(prof.pushKey && prof.pushKey.length > 60); assert.equal(prof.authenticated, false);
  const c = client(); await c.open;
  assert.deepEqual((await c.send({ type: 'MY_MATCHES' })).matches, []);
  assert.ok((await c.send({ type: 'PUSH_SUBSCRIBE', subscription: { endpoint: 'http://evil', keys: {} } })).error);
  assert.equal((await c.send({ type: 'PUSH_SUBSCRIBE', subscription: { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'x', auth: 'y' } } })).type, 'PUSH_OK');
  c.close();
});

test('Web Push: battle-on to the host, your-move to the friend after the host fires (encrypted + VAPID-signed)', async () => {
  // a fake push service over HTTPS with a throwaway self-signed certificate
  const key = path.join(DIR, 'k.pem'), crt = path.join(DIR, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const got = [];
  const svc = https.createServer({ key: readFileSync(key), cert: readFileSync(crt) }, (req, res) => { let n = 0; req.on('data', d => n += d.length); req.on('end', () => { got.push({ path: req.url, enc: req.headers['content-encoding'], auth: req.headers.authorization || '', ttl: req.headers.ttl, bytes: n }); res.writeHead(201); res.end(); }); });
  await new Promise(r => svc.listen(0, '127.0.0.1', r)); const sport = svc.address().port;
  const subFor = name => { const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); return { endpoint: `https://127.0.0.1:${sport}/push/${name}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } }; };
  const host = client('ws_guest=' + '11'.repeat(24)); await host.open;
  const friend = client('ws_guest=' + '22'.repeat(24)); await friend.open;
  const created = await host.send({ type: 'CREATE_MATCH', mode: 'multiplayer', name: 'host' });
  assert.equal((await host.send({ type: 'PUSH_SUBSCRIBE', subscription: subFor('host') })).type, 'PUSH_OK');
  assert.equal((await friend.send({ type: 'PUSH_SUBSCRIBE', subscription: subFor('friend') })).type, 'PUSH_OK');
  await friend.send({ type: 'JOIN_MATCH', session: created.state.id, name: 'friend' });
  await new Promise(r => setTimeout(r, 300));
  await host.act('RANDOMIZE_FLEET'); await host.act('READY'); await friend.act('RANDOMIZE_FLEET'); await friend.act('READY');
  await new Promise(r => setTimeout(r, 300));
  await host.send({ type: 'RESUME_MATCH', session: created.state.id, credential: created.credential });
  await host.act('FIRE', { cells: openCells(host.st).slice(0, 2) });
  for (let i = 0; i < 30 && !got.some(g => g.path === '/push/friend'); i++) await new Promise(r => setTimeout(r, 100));
  svc.close(); host.close(); friend.close();
  const toHost = got.filter(g => g.path === '/push/host'), toFriend = got.filter(g => g.path === '/push/friend');
  assert.ok(toHost.length >= 2, 'host told: friend joined + battle on');
  assert.ok(toFriend.length >= 1, 'friend told: your move');
  for (const g of got) { assert.equal(g.enc, 'aes128gcm'); assert.match(g.auth, /^vapid t=.+, k=.+/); assert.ok(g.bytes > 100); }
});

test('deleted games stay deleted: END_MATCH hides the game from that player for good', async () => {
  const a = await solo(), c = client(); await c.open;
  const key = { session: a.st.id, credential: a.created.credential };
  assert.equal((await c.send({ type: 'END_MATCH', ...key })).hidden, true);                    // in progress → forfeit + hidden
  assert.deepEqual((await c.send({ type: 'LIST_MATCHES', matches: [key] })).matches, [], 'not listed again');
  assert.equal((await c.send({ type: 'END_MATCH', ...key })).type, 'MATCH_ENDED');             // deleting again is harmless
  const b = await solo(); await b.act('LEAVE_MATCH');                                           // a finished game, then deleted
  const kb = { session: b.st.id, credential: b.created.credential };
  assert.equal((await c.send({ type: 'LIST_MATCHES', matches: [kb] })).matches.length, 1);
  await c.send({ type: 'END_MATCH', ...kb });
  assert.deepEqual((await c.send({ type: 'LIST_MATCHES', matches: [kb] })).matches, []);
  a.close(); b.close(); c.close();
});

test('QUICK: 9×9, sectors A–I, one vessel of every role, salvo 3 (+1 carrier), two firewalls', async () => {
  const c = await solo({ size: 9 });
  const st = c.st;
  assert.equal(st.size, 9); assert.equal(st.w, 9); assert.equal(st.h, 9); assert.equal(st.sectors, true);
  assert.deepEqual(st.fleet.map(f => f.len), [5, 4, 3, 3, 2]); assert.deepEqual(st.fleet.map(f => f.kind), [0, 1, 2, 3, 4]);
  assert.equal(st.firewalls.length, 2); assert.equal(st.salvo, 4, 'salvo 3 + 1 for the living kubernetes carrier');
  assert.ok(st.me.specials.every(sp => sp.ok || sp.why.startsWith('cooldown') || sp.free), 'every role is afloat, so no special starts offline');
  const res = await c.act('FIRE', { cells: openCells(st).slice(0, 3) }); assert.ok(!res.error, res.error);
  c.close();
});

test('endgame pace: salvo never drops more than one below the board max, and a quick game always finishes', async () => {
  const c = await solo({ size: 9, rules: 'classic' }); let low = 9, turns = 0, st = c.st;
  while (st.phase === 'playing' && turns++ < 60) {
    low = Math.min(low, st.salvo);
    const res = await c.act('FIRE', { cells: openCells(st).slice(0, st.salvo) }); assert.ok(!res.error, res.error);
    st = res.state; if (st.phase === 'playing' && st.turn !== st.seat) st = (await new Promise(r => setTimeout(r, 900)), c.st);
  }
  assert.equal(st.phase, 'finished'); assert.ok(low >= 2, `salvo fell to ${low}`); assert.ok(turns <= 30, `took ${turns} turns`);
  c.close();
});

// ---- updates must never ruin a game in progress ----
async function bootServer(dir, port) {
  const p = spawn(process.execPath, ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT: port, DATA_DIR: dir, WEB_ROOT: path.resolve(import.meta.dirname, '../web') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return p; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
}
const stop = p => new Promise(r => { p.once('exit', r); p.kill('SIGTERM'); });
function clientAt(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/whaleship/ws`); let st; const waiters = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.state) st = m.state; if (m.type === 'CONNECTED') return; const w = waiters.shift(); if (w) w(m); };
  const open = new Promise(r => { ws.onopen = r; });
  return { open, get st() { return st; }, send(msg) { const p = new Promise(r => waiters.push(r)); ws.send(JSON.stringify(msg)); return p; },
    act(type, data = {}) { return this.send({ type, session: st.id, revision: st.revision, action_id: crypto.randomUUID(), ...data }); }, close: () => ws.close() };
}

test('state transfer: a game in progress survives a server update + schema migration, under the rules it started with', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ws-xfer-')), port = PORT + 1;
  let srvA = await bootServer(dir, port);
  const a = clientAt(port); await a.open;
  const created = await a.send({ type: 'CREATE_MATCH', mode: 'easy', rules: 'warfare', size: 36, name: 't' });
  await a.act('RANDOMIZE_FLEET'); await a.act('READY');
  const fired = await a.act('FIRE', { cells: openCells(a.st).slice(0, a.st.salvo) }); assert.ok(!fired.error, fired.error);
  await new Promise(r => setTimeout(r, 400)); const before = a.st; a.close();
  await stop(srvA);                                                    // SIGTERM flushes pending saves
  // rewrite the save as the previous release would have written it (schema v3, no pace field)
  const f = path.join(dir, 'matches', created.state.id + '.json'), saved = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(saved.v, 4); assert.equal(saved.pace, 2); delete saved.pace; saved.v = 3; writeFileSync(f, JSON.stringify(saved));
  // a file from a FUTURE schema (e.g. after a rollback) must be left alone, byte for byte
  const fut = path.join(dir, 'matches', 'f'.repeat(32) + '.json'), futBody = JSON.stringify({ ...saved, id: 'f'.repeat(32), v: 99 }); writeFileSync(fut, futBody);
  const check = JSON.parse(execFileSync(process.execPath, ['server.js', '--check-data', path.join(dir, 'matches')], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, DATA_DIR: mkdtempSync(path.join(tmpdir(), 'ws-chk-')) } }).toString());
  assert.equal(check.active, 1); assert.equal(check.migrated, 1); assert.equal(check.failed.length, 0); assert.equal(check.newer.length, 1);
  assert.equal(readFileSync(f, 'utf8'), JSON.stringify(saved), '--check-data never writes');
  const srvB = await bootServer(dir, port);
  const b = clientAt(port); await b.open;
  const resumed = await b.send({ type: 'RESUME_MATCH', session: created.state.id, credential: created.credential });
  assert.equal(resumed.type, 'MATCH_RESUMED'); const st = resumed.state;
  assert.equal(st.phase, before.phase); assert.equal(st.turn_number, before.turn_number); assert.equal(st.attacks.length, before.attacks.length);
  assert.deepEqual(st.me.ships, before.me.ships); assert.deepEqual(st.opponent.shots, before.opponent.shots);
  const next = await b.act('FIRE', { cells: openCells(st).slice(0, st.salvo) }); assert.ok(!next.error, next.error);   // and it keeps playing
  b.close(); await stop(srvB);
  const after = JSON.parse(readFileSync(f, 'utf8')); assert.equal(after.v, 4); assert.equal(after.pace, 0, 'old game keeps the old salvo rule');
  assert.equal(readFileSync(fut, 'utf8'), futBody, 'newer-schema file untouched');
  rmSync(dir, { recursive: true, force: true });
});

test('link previews: dynamic PNG cards per match for invites, battles and results, nothing leaked', async () => {
  const og = async q => { const html = await (await fetch(`http://127.0.0.1:${PORT}/whaleship/${q}`)).text(); const g = k => (html.match(new RegExp(`property="og:${k}" content="([^"]*)"`)) || [])[1]; return { title: g('title'), desc: g('description'), image: g('image'), html }; };
  const png = async u => { const r = await fetch(u.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${PORT}`)); const b = Buffer.from(await r.arrayBuffer()); assert.equal(r.headers.get('content-type'), 'image/jpeg'); assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8); assert.ok(b.length > 20000 && b.length < 300000, `card is ${b.length} bytes`); return b; };
  const host = client(); await host.open;
  const created = await host.send({ type: 'CREATE_MATCH', mode: 'multiplayer', size: 9, rules: 'chaos', name: 'Salty "Q" & co' });
  const j = Buffer.from(created.state.id, 'hex').toString('base64url');
  let p = await og(`?j=${j}`);
  assert.match(p.title, /challenges you to WHALESHIP/); assert.match(p.title, /Salty &quot;Q&quot; &amp; co/, 'names are HTML-escaped');
  assert.match(p.desc, /Quick/); assert.match(p.desc, /Chaos/); assert.match(p.image, new RegExp(`/whaleship/og/${j}\\.jpg\\?s=lobby`));
  assert.ok(!p.html.includes(created.credential), 'no seat credential in the page');
  assert.equal(p.html.match(/property="og:title"/g).length, 1, 'generic block replaced, not duplicated');
  const lobbyPng = await png(p.image);
  const guest = client(); await guest.open; await guest.send({ type: 'JOIN_MATCH', session: created.state.id, name: 'Kelp-7' });
  p = await og(`?j=${j}`); assert.match(p.title, / vs /); assert.notEqual(p.image.split('?s=')[1], undefined);
  assert.ok(!(await png(p.image)).equals(lobbyPng), 'the card changes when the match changes');
  // a finished solo game shared with ?r= gets a result card
  const solo = await (async () => { const c = client(); await c.open; await c.send({ type: 'CREATE_MATCH', mode: 'easy', size: 9, rules: 'classic', name: 'Ace' }); await c.act('RANDOMIZE_FLEET'); await c.act('READY');
    for (let i = 0; i < 60 && c.st.phase === 'playing'; i++) { const r = await c.act('FIRE', { cells: openCells(c.st).slice(0, c.st.salvo) }); if (r.state?.phase === 'playing' && r.state.turn !== r.state.seat) await new Promise(res => setTimeout(res, 50)); } return c; })();
  assert.equal(solo.st.phase, 'finished');
  const rr = await og(`?r=${Buffer.from(solo.st.id, 'hex').toString('base64url')}`); assert.match(rr.title, /won a WHALESHIP battle/); await png(rr.image);
  for (const q of ['', '?j=nope', `?j=${Buffer.from('0'.repeat(32), 'hex').toString('base64url')}`]) { const d = await og(q); assert.match(d.title, /Sink their stack/); assert.match(d.image, /\/og\/default\.jpg/); }
  await png(`http://x/whaleship/og/default.jpg`);
  host.close(); guest.close(); solo.close();
});

test('restore (pace 2): the damaged creature comes back whole somewhere in the 5×5 square, the enemy forgets that water; old games keep the old repair', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ws-restore-')), port = PORT + 2;
  let srv1 = await bootServer(dir, port);
  const a = clientAt(port); await a.open;
  const made = await a.send({ type: 'CREATE_MATCH', mode: 'easy', rules: 'warfare', size: 36, name: 't' });
  await a.act('RANDOMIZE_FLEET'); await a.act('READY'); await new Promise(r => setTimeout(r, 400)); a.close(); await stop(srv1);
  const f = path.join(dir, 'matches', made.state.id + '.json'), saved = JSON.parse(readFileSync(f, 'utf8')), W = 18;
  assert.equal(saved.pace, 2, 'new matches are pace 2');
  const me = saved.seats[0], ship = me.ships.find(sh => sh.cells.length >= 3 && saved.fleet[sh.id].kind !== 2) || me.ships.find(sh => sh.cells.length >= 3);
  const pick = ship.cells[1], px = pick % W, py = Math.floor(pick / W), inSq = c => Math.abs(c % W - px) <= 2 && Math.abs(Math.floor(c / W) - py) <= 2;
  me.board[pick] = 2;                                                         // the enemy hit it once
  const allShip = new Set(me.ships.flatMap(sh => sh.cells)), misses = [];
  for (let c = 0; c < W * W; c++) if (inSq(c) && me.board[c] === 0 && !allShip.has(c) && misses.length < 3) { me.board[c] = 1; misses.push(c); }
  const other = me.ships.find(sh => sh !== ship && sh.cells.some(inSq)), otherHit = other ? other.cells.find(inSq) : null;
  if (otherHit != null) me.board[otherHit] = 2;                               // a hit on ANOTHER creature in the square: must survive
  me.charges.restore = 1; me.cool.restore = 0;
  writeFileSync(f, JSON.stringify(saved));
  // the same game, but started before the update (pace 1): restore keeps repairing one segment in place
  const oldId = 'a'.repeat(32), oldBody = { ...JSON.parse(JSON.stringify(saved)), id: oldId, pace: 1 }; oldBody.seats[0].credHash = saved.seats[0].credHash;
  writeFileSync(path.join(dir, 'matches', oldId + '.json'), JSON.stringify(oldBody));

  let srv2 = await bootServer(dir, port);
  const b = clientAt(port); await b.open;
  const settle = () => new Promise(r => setTimeout(r, 300));                  // a resume is followed by a PRESENCE broadcast
  try {
  await b.send({ type: 'RESUME_MATCH', session: made.state.id, credential: made.credential }); await settle();
  const res = await b.act('POWER', { power: 'restore', cell: pick }); assert.ok(!res.error, res.error); await settle();
  const st = b.st, moved = st.me.ships.find(sh => sh.id === ship.id);
  assert.notDeepEqual(moved.cells, ship.cells, 'it moved');
  assert.ok(inSq(moved.cells[0]), 'bow inside the 5×5 square around the picked segment');
  const rest = new Set(st.me.ships.filter(sh => sh.id !== ship.id).flatMap(sh => sh.cells));
  for (const c of moved.cells) { assert.ok(!rest.has(c), 'no collision'); assert.equal(st.me.shots[c], 0, 'whole, on unexplored water'); assert.ok(!st.firewalls.includes(c), 'not on an iceberg'); }
  for (const c of misses) assert.equal(st.me.shots[c], 0, 'the enemy\'s misses in the square are wiped');
  assert.equal(st.me.shots[pick] === 2 && moved.cells.includes(pick), false, 'the old hit is gone');
  if (otherHit != null) assert.equal(st.me.shots[otherHit], 2, 'hits on other creatures stay');
  const rec = st.attacks.find(x => x.power === 'restore');
  assert.equal(rec.moved, true); assert.equal(rec.cell, pick); assert.ok(rec.area.every(c => inSq(c) || ship.cells.includes(c)), 'the record shows only the square');
  assert.ok(!('cells' in rec) && !JSON.stringify(rec).includes(JSON.stringify(moved.cells)), 'the new spot is never in the record');
  const o = clientAt(port); await o.open;
  await o.send({ type: 'RESUME_MATCH', session: oldId, credential: made.credential }); await settle();
  const old = await o.act('POWER', { power: 'restore', cell: pick }); assert.ok(!old.error, old.error); await settle();
  assert.deepEqual(o.st.me.ships.find(sh => sh.id === ship.id).cells, ship.cells, 'old game: stays put');
  assert.equal(o.st.me.shots[pick], 0, 'old game: that one segment repaired');
  for (const c of misses) assert.equal(o.st.me.shots[c], 1, 'old game: nothing else forgotten');
  o.close();
  } finally { b.close(); await stop(srv2); rmSync(dir, { recursive: true, force: true }); }
});
