'use strict';
// WHALESHIP — infrastructure battleship server.
// One small process: WebSocket game protocol + static client + JSON-on-disk persistence.
// Boards 10/20/30, salvo fire, whale powers, AI captains. No time limits: matches persist across restarts.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const names = require('./names.js');

const PORT = Number(process.env.PORT || 8080);
const DATA = process.env.DATA_DIR || '/data';
const WEB = path.resolve(process.env.WEB_ROOT || path.join(__dirname, 'web'));
const BASE = '/whaleship';
const AUTH_BRIDGE = process.env.AUTH_BRIDGE || '';
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const AUTH_COOKIE = process.env.AUTH_COOKIE || 'session';   // cookie forwarded to the optional identity bridge
const INVITE_BASE = process.env.INVITE_BASE || '';
const LOGIN_URL = process.env.LOGIN_URL || '';               // e.g. https://example.com/login/?next= — shows a Sign in button           // e.g. https://example.com/whaleship — defaults to the page's own URL
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE || 400);
const FORFEIT_AFTER = Number(process.env.FORFEIT_AFTER || 7 * 24 * 3600);     // opponent silent this long → you may claim
const LOBBY_TTL = 30 * 24 * 3600 * 1000;                                       // nobody joined in 30 days → close
const MDIR = path.join(DATA, 'matches'), RESULTS = path.join(DATA, 'results.jsonl');
fs.mkdirSync(MDIR, { recursive: true });

/* ---------------- rules ---------------- */
const SIZES = [9, 10, 15, 18, 20, 30, 36];   // 9 = QUICK: 3×3 sectors (A–I) of 3×3 = 9×9 cells (v0.18)
   // 36 = the sector map: 6×6 sectors (A–Z, 0–9) of 3×3 = 18×18 cells — the default and only new mode   // 15 = square sector map (5×5 sectors A–Y); 18 = 18×12 sector map (v0.7)                                                 // 18 = sector map: 18×12 = 6×4 sectors of 3×3
const DIM = size => size === 18 ? { w: 18, h: 12 } : size === 36 ? { w: 18, h: 18 } : { w: size, h: size };
const FLEET_LENS = { 9: [5, 4, 3, 3, 2], 36: [6, 5, 5, 4, 4, 3, 3, 3, 2, 2], 10: [5, 4, 3, 3, 2], 15: [6, 5, 4, 4, 3, 3, 2, 2], 18: [6, 5, 4, 4, 3, 3, 2, 2], 20: [6, 5, 5, 4, 4, 3, 3, 3, 2, 2], 30: [7, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2] };
const SALVO = { 9: 3, 36: 4, 10: 1, 15: 3, 18: 3, 20: 4, 30: 6 };
const POWERS = { 9: { sonar: 1, depth: 1, tail: 1 }, 36: { sonar: 2, depth: 1, tail: 2 }, 10: { sonar: 1, depth: 1, tail: 1 }, 15: { sonar: 2, depth: 1, tail: 2 }, 18: { sonar: 2, depth: 1, tail: 2 }, 20: { sonar: 2, depth: 1, tail: 2 }, 30: { sonar: 3, depth: 2, tail: 2 } };
const KINDS = ['moby', 'k8s', 'walrus', 'tux', 'squid'];   // docker host · orchestrator · storage · linux host · proxy
function fleetFor(size) {
  const lens = FLEET_LENS[size];
  const kinds = lens.map((len, id) => size <= 10 ? id : len >= 6 ? 0 : len === 5 ? 1 : len === 4 ? 2 : len === 3 ? 3 : 4);
  const bases = lens.map((len, i) => `${KINDS[kinds[i]]}-${len}`), total = {}, seen = {};
  bases.forEach(b => total[b] = (total[b] || 0) + 1);
  return lens.map((len, id) => { const b = bases[id]; seen[b] = (seen[b] || 0) + 1; return { id, len, kind: kinds[id], name: total[b] > 1 ? b + String.fromCharCode(96 + seen[b]) : b }; });
}
const salvoFor = (m, s) => {
  const me = m.seats[s], live = sh => !isSunk(me, sh); let k = m.size === 10 ? 1 : Math.min(SALVO[m.size], me.ships.filter(live).length);
  // v0.18 endgame pace (rules matches): losing vessels costs at most one ping, and once the enemy is down to its last
  // two vessels everyone gets +1 "mop-up" ping — the final hunt no longer crawls along at one shot a turn.
  if (m.pace >= 1 && m.rules && m.size !== 10) { const op = m.seats[1 - s]; k = Math.max(k, SALVO[m.size] - 1); if (op && op.ships.filter(sh => !isSunk(op, sh)).length <= 2) k++; }
  if (warfare(m)) { if (roleUp(m, me, 'swarm')) k++; if (me.rolling) k--; }      // swarm orchestrates +1 ping; a rolling update costs one
  return Math.max(1, k);
};

/* ---------------- v3 rules: infrastructure roles, specials, firewalls, cluster chaos ---------------- */
// rules: 'classic' (plain salvo), 'warfare' (roles + specials), 'chaos' (warfare + Kubernetes events). Matches without
// m.rules are pre-v3 and keep the legacy sonar/depth/tail powers.
const RULES = ['classic', 'warfare', 'chaos'];
const warfare = m => m.rules === 'warfare' || m.rules === 'chaos';
const ROLE = { moby: 0, swarm: 1, walrus: 2, tux: 3, squid: 4 };
const C1 = { 9: 1, 10: 1, 15: 1, 18: 1, 20: 1, 30: 2, 36: 1 };
// Attack patterns are logical (dx, dy) offsets from the aimed cell (X = [0, 0]); rotatable ones turn 90° per step.
// They follow the real grid and cross sector borders; off-board cells are dropped. The client imports the same table.
const PATTERNS = {
  one: [[0, 0]],
  square: [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
  tee: [[-1, -2], [0, -2], [1, -2], [0, -1], [0, 0]],                    // tail slap: flukes over the target
  cross: [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]],                     // breach splash
  diamond: [[0, -2], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]],
  ell: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],                         // tentacle grab
};
const rot = ([x, y], r) => { for (let i = 0; i < (r & 3); i++) [x, y] = [-y, x]; return [x, y]; };
function patternCells(size, cell, pattern, r = 0) {
  const { w, h } = DIM(size), x = cell % w, y = Math.floor(cell / w);
  return PATTERNS[pattern].map(o => rot(o, r)).map(([dx, dy]) => [x + dx, y + dy]).filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < w && cy < h).map(([cx, cy]) => cy * w + cx);
}
// effect: damage | reveal | disrupt. needs: the creature role that powers it (sink it and the special goes offline).
const SPECIALS = {
  scan:    { needs: 'tux',    effect: 'reveal',  pattern: 'square',  cd: 3, charges: { 9: 1, 10: 1, 15: 2, 18: 2, 20: 2, 30: 3, 36: 2 } },
  trace:   { needs: 'tux',    effect: 'damage',  pattern: 'one',     cd: 2, charges: null },
  tail:    { needs: 'moby',   effect: 'damage',  pattern: 'tee',     cd: 0, charges: C1, rotates: true },
  oom:     { needs: 'moby',   effect: 'damage',  pattern: 'one',     cd: 0, charges: C1 },
  breach:  { needs: 'swarm',  effect: 'damage',  pattern: 'cross',   cd: 0, charges: C1 },
  flood:   { needs: 'swarm',  effect: 'disrupt', pattern: 'diamond', cd: 0, charges: C1 },
  grab:    { needs: 'squid',  effect: 'damage',  pattern: 'ell',     cd: 0, charges: C1, rotates: true },
  dns:     { needs: 'squid',  effect: 'decoy',   pattern: 'one',     cd: 0, charges: C1 },
  restore: { needs: 'walrus', effect: 'repair',  pattern: 'one',     cd: 0, charges: C1 },
};
const FREE = new Set(['dns', 'restore']);
const FIREWALLS = { 9: 2, 10: 0, 15: 3, 18: 3, 20: 4, 30: 6, 36: 5 };                                   // iceberg cells: no ships, can't be targeted
const drainedRoles = seat => [...(seat.drains || []), ...(seat.drained ? [seat.drained] : [])].filter(d => d.turns > 0).map(d => d.role);
const roleUp = (m, seat, role) => !drainedRoles(seat).includes(role) && seat.ships.some(sh => m.fleet[sh.id].kind === ROLE[role] && !isSunk(seat, sh));
const rolesOf = (m, seat) => Object.fromEntries(Object.keys(ROLE).map(r => [r, roleUp(m, seat, r)]));
function specialsView(m, me) {
  if (!warfare(m) || !me.charges) return [];
  return Object.entries(SPECIALS).map(([id, sp]) => {
    const charges = sp.charges ? me.charges[id] : null, cool = me.cool[id] || 0;
    const why = !roleUp(m, me, sp.needs) ? `${sp.needs} offline` : me.frozen && !FREE.has(id) ? 'rate-limited by SYN flood' : cool ? `cooldown ${cool} turn${cool > 1 ? 's' : ''}` : charges === 0 ? 'no charges left' : '';
    return { id, charges, cool, needs: sp.needs, effect: sp.effect, pattern: sp.pattern, rotates: !!sp.rotates, free: FREE.has(id), ok: !why, why };
  });
}
// Container identities: generated once per match from its id (stable across reconnects/restarts), unique in the match.
function ensureManifest(m) { if (!m.manifest) { const used = new Set(); m.manifest = [0, 1].map(seat => names.manifest(m.id, seat, m.fleet, used)); } return m.manifest; }
function pushEvent(m, ev) { (m.events ||= []).push({ turn: m.turn_number, ...ev }); if (m.events.length > 40) m.events.shift(); }
const CHAOS = [['selfheal', 2], ['crashloop', 3], ['imagepull', 2], ['dnsfail', 2], ['rolling', 2], ['drain', 2], ['oomkilled', 1]];
function chaosEvent(m, s) {
  const me = m.seats[s], r = Math.random() * CHAOS.reduce((t, [, w]) => t + w, 0); let acc = 0, kind = CHAOS[0][0];
  for (const [k, w] of CHAOS) { acc += w; if (r < acc) { kind = k; break; } }
  const ev = { seat: s, kind };
  if (kind === 'selfheal') {                     // a Deployment replaces one failed replica — once per match, never a whole creature
    const dmg = me.ships.filter(sh => !isSunk(me, sh)).flatMap(sh => sh.cells.filter(c => me.board[c] === 2));
    if (me.healed || !dmg.length) return; const c = dmg[crypto.randomInt(dmg.length)]; me.board[c] = 0; me.healed = true; ev.cell = c;
  } else if (kind === 'crashloop') {
    const av = Object.keys(SPECIALS).filter(k => roleUp(m, me, SPECIALS[k].needs)); if (!av.length) return;
    const k = av[crypto.randomInt(av.length)]; me.cool[k] = (me.cool[k] || 0) + 2; ev.special = k;
  } else if (kind === 'imagepull') { for (const k of Object.keys(SPECIALS)) me.cool[k] = (me.cool[k] || 0) + 1; }
  else if (kind === 'dnsfail') me.dnsFail = true;
  else if (kind === 'rolling') me.rolling = true;
  else if (kind === 'drain') { const up = Object.keys(ROLE).filter(r => roleUp(m, me, r)); if (!up.length) return; ev.role = up[crypto.randomInt(up.length)]; (me.drains ||= []).push({ role: ev.role, turns: 2 }); }
  else if (kind === 'oomkilled') {
    const live = me.ships.filter(sh => !isSunk(me, sh) && sh.cells.filter(c => me.board[c] === 0).length > 1).flatMap(sh => sh.cells.filter(c => me.board[c] === 0));
    if (!live.length) return; const c = live[crypto.randomInt(live.length)]; strike(m, 1 - s, [c], 'chaos'); ev.cell = c;
  }
  pushEvent(m, ev);
}

/* ---------------- helpers ---------------- */
const now = () => Date.now();
const rid = (n = 16) => crypto.randomBytes(n).toString('hex');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const clean = (s, n = 28) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const ADJ = ['Salty', 'Krill', 'Barnacle', 'Brine', 'Kelp', 'Tidal', 'Foggy', 'Rusty', 'Plankton', 'Coral', 'Squall', 'Bilge'];
const guestName = h => `Captain ${ADJ[parseInt(h.slice(0, 4), 16) % ADJ.length]}-${parseInt(h.slice(4, 8), 16) % 100}`;
const isSunk = (seat, sh) => sh.cells.every(c => seat.board[c] >= 2);
const remaining = seat => seat.ships.reduce((n, sh) => n + sh.cells.filter(c => seat.board[c] < 2).length, 0);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; };

function footprint(size, len, x, y, v) { const { w, h } = DIM(size), out = []; for (let i = 0; i < len; i++) { const cx = x + (v ? 0 : i), cy = y + (v ? i : 0); if (cx < 0 || cy < 0 || cx >= w || cy >= h) return null; out.push(cy * w + cx); } return out; }
function randomFleet(size, fleet, blocked = []) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const taken = new Set(blocked), ships = [];
    let ok = true;
    for (const f of fleet) {
      let placed = false;
      for (let t = 0; t < 400 && !placed; t++) {
        const v = crypto.randomInt(2) === 1, x = crypto.randomInt(DIM(size).w), y = crypto.randomInt(DIM(size).h);
        const cells = footprint(size, f.len, x, y, v);
        if (cells && cells.every(c => !taken.has(c))) { cells.forEach(c => taken.add(c)); ships.push({ id: f.id, cells }); placed = true; }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return ships;
  }
  throw new Error('fleet placement failed');
}

/* ---------------- persistence ---------------- */
const matches = new Map();
const saveTimers = new Map();
function persist(m) {
  clearTimeout(saveTimers.get(m.id));
  saveTimers.set(m.id, setTimeout(() => {
    saveTimers.delete(m.id);
    const f = path.join(MDIR, m.id + '.json'), tmp = f + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(m)); fs.renameSync(tmp, f); } catch (e) { console.error('persist', m.id, e.message); }
  }, 150));
}
/* ---------------- saved-match schema: games in progress survive every update ----------------
   A match keeps the rules it started under. New rules are pinned to new matches (m.pace), never applied mid-game.
   Each schema bump adds one step to MIGRATIONS; load() upgrades old files in memory (written back on next save).
   Files from a NEWER schema (after a rollback) are left untouched on disk and not served, so they can't be damaged.
   `node server.js --check-data DIR` runs the same load against a copy of the data without writing anything. */
const SCHEMA = 4, PACE = 1;
const MIGRATIONS = {
  // v1–v2 (no m.v) and v3 → v4: record that the match started under the original salvo rule (pace 0).
  3: m => { m.pace ??= 0; },
};
function migrate(m) {
  let v = Number(m.v) || 3;              // pre-v3 legacy matches have no v; they share the v3 → v4 step (legacy rules untouched)
  if (v > SCHEMA) throw Object.assign(new Error(`schema v${v} is newer than this server (v${SCHEMA})`), { newer: true });
  const from = v;
  while (v < SCHEMA) { MIGRATIONS[v]?.(m); v++; }
  if (from !== SCHEMA || m.v !== SCHEMA) m.v = SCHEMA;
  return from;
}
function validate(m) {
  const { w, h } = DIM(m.size), n = w * h, bad = [];
  if (!m.id || !SIZES.includes(m.size)) bad.push('id/size');
  if (!Array.isArray(m.seats) || m.seats.length !== 2) bad.push('seats');
  else m.seats.forEach((st, i) => { if (!st) return; if (!Array.isArray(st.board) || st.board.length !== n) bad.push(`seat${i}.board`); if ((st.ships || []).some(sh => sh.cells.some(c => c < 0 || c >= n))) bad.push(`seat${i}.ships`); });
  if (!Array.isArray(m.fleet)) bad.push('fleet');
  return bad;
}
const expired = m => m.phase === 'finished' ? now() - (m.finished || 0) * 1000 > 7 * 864e5 : m.phase === 'lobby' && now() - m.created * 1000 > LOBBY_TTL;
function readMatches(dir, onMatch) {
  const report = { files: 0, loaded: 0, active: 0, finished: 0, expired: 0, migrated: 0, newer: [], failed: [] };
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue; report.files++;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (expired(m)) { report.expired++; onMatch?.(m, f, true); continue; }
      if (migrate(m) !== SCHEMA) report.migrated++;
      const bad = validate(m); if (bad.length) throw new Error('invalid: ' + bad.join(','));
      report.loaded++; m.phase === 'finished' ? report.finished++ : report.active++;
      onMatch?.(m, f, false);
    } catch (e) { (e.newer ? report.newer : report.failed).push(`${f}: ${e.message}`); }
  }
  return report;
}
function load() {
  const report = readMatches(MDIR, (m, f, isExpired) => {
    if (isExpired) { fs.unlinkSync(path.join(MDIR, f)); return; }
    m.seats.forEach(s => { if (s) s.connected = !!s.ai; });
    matches.set(m.id, m);
  });
  for (const x of report.newer) console.error('load skipped (left on disk untouched):', x);
  for (const x of report.failed) console.error('load FAILED (left on disk untouched):', x);
  console.log(`loaded ${matches.size} matches (${report.active} in progress, ${report.migrated} migrated to v${SCHEMA}, ${report.failed.length} failed, ${report.newer.length} newer)`);
  return report;
}
function recordResult(m) {
  if (m.score_saved) return;
  const lines = m.seats.map((s, i) => {
    if (!s || s.ai) return null;
    const mine = m.attacks.filter(a => a.seat === i && !a.reveal);
    return JSON.stringify({ match_id: m.id, player_id: s.identity, name: s.name, mode: m.mode, size: m.size, won: m.winner === i ? 1 : 0,
      forfeit: m.reason === 'forfeit' ? 1 : 0, hits: mine.filter(a => a.hit).length, shots: mine.length, sunk: mine.filter(a => a.sunk).length, finished: m.finished });
  }).filter(Boolean);
  try { if (lines.length) fs.appendFileSync(RESULTS, lines.join('\n') + '\n'); m.score_saved = true; } catch (e) { console.error('results', e.message); }
}
function leaderboard(mode, period) {
  let rows = [];
  try { rows = fs.readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
  const since = period === 'week' ? now() / 1000 - 7 * 86400 : 0;
  const by = new Map();
  for (const r of rows.filter(r => r.mode === mode && r.finished >= since).sort((a, b) => a.finished - b.finished)) {
    const p = by.get(r.player_id) || { name: r.name, games: 0, wins: 0, losses: 0, forfeit_wins: 0, hits: 0, shots: 0, ships_sunk: 0, streak: 0, longest_streak: 0 };
    p.name = r.name; p.games++; p.hits += r.hits; p.shots += r.shots; p.ships_sunk += r.sunk;
    if (r.won) { p.wins++; if (r.forfeit) p.forfeit_wins++; p.streak++; p.longest_streak = Math.max(p.longest_streak, p.streak); } else { p.losses++; p.streak = 0; }
    by.set(r.player_id, p);
  }
  return [...by.values()].map(p => ({ ...p, win_percentage: p.games ? 100 * p.wins / p.games : 0, accuracy: p.shots ? 100 * p.hits / p.shots : 0 }))
    .sort((a, b) => b.wins - a.wins || b.win_percentage - a.win_percentage || b.accuracy - a.accuracy).slice(0, 50).map((p, i) => ({ rank: i + 1, ...p }));
}

/* ---------------- views + broadcast ---------------- */
const sockets = new Map();  // matchId -> Set(ws)
function view(m, s) {
  const me = m.seats[s], op = m.seats[1 - s], t = now(), mf = ensureManifest(m);
  const gone = x => !x ? 0 : x.ai || x.connected ? 0 : Math.floor((t - (x.lastSeen || t)) / 1000);
  return {
    id: m.id, revision: m.revision, mode: m.mode, size: m.size, w: DIM(m.size).w, h: DIM(m.size).h, sectors: [9, 15, 18, 36].includes(m.size), fleet: m.fleet, salvo: m.phase === 'playing' ? salvoFor(m, s) : SALVO[m.size],
    phase: m.phase, seat: s, turn: m.turn, turn_number: m.turn_number, created: m.created, started: m.started, finished: m.finished,
    rules: m.rules || null, firewalls: m.firewalls || [], events: (m.events || []).slice(-20),
    me: { manifest: mf[s], ships: me.ships, shots: me.board, ready: me.ready, remaining: remaining(me), powers: me.powers, specials: specialsView(m, me), decoys: me.decoys || [], roles: rolesOf(m, me), frozen: !!me.frozen, drained: drainedRoles(me)[0] || null, drains: drainedRoles(me) },
    opponent: op ? { name: op.name, ready: op.ready, shots: op.board, sunk: op.ships.filter(sh => isSunk(op, sh)), manifest: Object.fromEntries(op.ships.filter(sh => isSunk(op, sh)).map(sh => [sh.id, mf[1 - s][sh.id]])), sonar: me.sonar, roles: Object.fromEntries(Object.keys(ROLE).map(r => [r, op.ships.some(sh => m.fleet[sh.id].kind === ROLE[r] && !isSunk(op, sh))])) } : null,
    attacks: m.attacks, connected: m.seats.map(x => !!x && (x.ai || x.connected)), disconnect_seconds: m.seats.map(gone), forfeit_after: FORFEIT_AFTER,
    winner: m.winner, reason: m.reason, score_saved: m.score_saved,
  };
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(m, type, extra = {}) {
  for (const ws of sockets.get(m.id) || []) if (ws.seat != null) send(ws, { type, state: view(m, ws.seat), ...extra });
}
function bump(m, type) { m.revision++; m.updated = Math.floor(now() / 1000); persist(m); broadcast(m, type); }
function attach(ws, m, seat) {
  if (ws.matchId && ws.matchId !== m.id) detach(ws);
  ws.matchId = m.id; ws.seat = seat;
  if (!sockets.has(m.id)) sockets.set(m.id, new Set());
  sockets.get(m.id).add(ws);
  const s = m.seats[seat]; s.connected = true; s.lastSeen = now();
}
function detach(ws) {
  const m = matches.get(ws.matchId), set = sockets.get(ws.matchId);
  if (set) { set.delete(ws); if (!set.size) sockets.delete(ws.matchId); }
  if (m && ws.seat != null) {
    const still = [...(sockets.get(m.id) || [])].some(o => o.seat === ws.seat);
    const s = m.seats[ws.seat]; if (s && !still) { s.connected = false; s.lastSeen = now(); persist(m); broadcast(m, 'PRESENCE'); }
  }
  ws.matchId = null; ws.seat = null;
}

/* ---------------- game actions ---------------- */
function newSeat(identity, name, m, ai = null) {
  const size = m.size, seat = { credHash: null, identity, name, ai, ships: [], ready: false, board: Array(DIM(size).w * DIM(size).h).fill(0), powers: m.rules ? {} : { ...POWERS[size] }, sonar: [], connected: !!ai, lastSeen: now(), recent: [] };
  for (const c of m.firewalls || []) seat.board[c] = 5;
  if (warfare(m)) Object.assign(seat, { charges: Object.fromEntries(Object.entries(SPECIALS).filter(([, sp]) => sp.charges).map(([k, sp]) => [k, sp.charges[size]])), cool: {}, decoys: [], frozen: 0 });
  return seat;
}
function issue(seat) { const cred = rid(24), h = sha(cred); seat.credHash = h; seat.credHashes = [...(seat.credHashes || []).filter(x => x !== h), h].slice(-6); return cred; }
const credOk = (seat, cred) => !!seat && !!cred && (seat.credHash === sha(String(cred)) || (seat.credHashes || []).includes(sha(String(cred))));
function createMatch(ws, msg) {
  if ([...matches.values()].filter(m => m.phase !== 'finished').length >= MAX_ACTIVE) return send(ws, { error: 'The harbor is full right now. Try again soon.' });
  const mode = ['multiplayer', 'easy', 'normal', 'hard'].includes(msg.mode) ? msg.mode : 'normal';
  const size = SIZES.includes(Number(msg.size)) ? Number(msg.size) : 36, rules = RULES.includes(msg.rules) ? msg.rules : 'warfare';
  const { w, h } = DIM(size), fw = new Set();
  while (fw.size < FIREWALLS[size]) fw.add(crypto.randomInt(w * h));
  const m = { v: SCHEMA, pace: PACE, rules, firewalls: [...fw], events: [], manifest: null, id: rid(16), mode, size, fleet: fleetFor(size), phase: mode === 'multiplayer' ? 'lobby' : 'deploy', revision: 1, turn: 0, turn_number: 0,
    winner: null, reason: null, score_saved: false, created: Math.floor(now() / 1000), started: null, finished: null, attacks: [], seats: [null, null] };
  m.seats[0] = newSeat(ws.identity, ws.authed ? ws.name : clean(msg.name) || ws.name, m);
  if (mode !== 'multiplayer') {
    const ai = newSeat('ai:' + mode, { easy: '🐧 Easy AI', normal: '🦭 Walrus AI', hard: '🐋 Whale AI' }[mode], m, mode);
    ai.ships = randomFleet(size, m.fleet, m.firewalls); ai.ready = true; m.seats[1] = ai;
  }
  matches.set(m.id, m);
  const cred = issue(m.seats[0]); attach(ws, m, 0); persist(m);
  send(ws, { type: 'MATCH_CREATED', state: view(m, 0), credential: cred });
}
function joinMatch(ws, msg, resume) {
  const m = matches.get(String(msg.session || ''));
  if (!m) return send(ws, { error: 'That match is no longer running.' });
  let seat = -1;
  if (resume && msg.credential) seat = m.seats.findIndex(s => credOk(s, msg.credential));
  if (seat < 0) seat = m.seats.findIndex(s => s && !s.ai && s.identity === ws.identity);       // same captain, new device/tab
  if (seat >= 0) {
    // you proved the seat with its key and you're signed in now: the guest seat moves onto your account (so it follows you)
    if (ws.authed && credOk(m.seats[seat], msg.credential) && String(m.seats[seat].identity).startsWith('guest:')) { m.seats[seat].identity = ws.identity; m.seats[seat].name = ws.name; }
    const cred = credOk(m.seats[seat], msg.credential) ? msg.credential : issue(m.seats[seat]);
    attach(ws, m, seat); persist(m);
    send(ws, { type: 'MATCH_RESUMED', state: view(m, seat), credential: cred });
    return broadcast(m, 'PRESENCE');
  }
  if (m.mode !== 'multiplayer' || m.seats[1]) return send(ws, { error: m.phase === 'finished' ? 'That battle is over.' : 'That match is full.' });
  m.seats[1] = newSeat(ws.identity, ws.authed ? ws.name : clean(msg.name) || ws.name, m);
  m.phase = 'deploy';
  const cred = issue(m.seats[1]); attach(ws, m, 1);
  m.revision++; persist(m);
  send(ws, { type: 'PLAYER_JOINED', state: view(m, 1), credential: cred }); notifyMatch(m, { phase: 'lobby', turn: m.turn, opp: false });
  for (const o of sockets.get(m.id) || []) if (o !== ws) send(o, { type: 'PLAYER_JOINED', state: view(m, o.seat) });
}
// Status of every match this browser holds a seat in (proved by its seat credential), without attaching to them —
// lets one tab follow several games and notify when it's your move elsewhere. Reveals nothing beyond the seat's own view.
function listMatches(ws, msg) {
  const list = (Array.isArray(msg.matches) ? msg.matches : []).slice(0, 30).map(x => {
    const m = matches.get(String(x && x.session || '')); if (!m || !x.credential) return null;
    const seat = m.seats.findIndex(s => credOk(s, x.credential)); if (seat < 0 || m.seats[seat].hidden) return null;
    const op = m.seats[1 - seat];
    return { id: m.id, mode: m.mode, size: m.size, rules: m.rules || null, phase: m.phase, seat, myTurn: m.phase === 'playing' && m.turn === seat,
      opponent: op ? op.name : null, turn_number: m.turn_number, winner: m.winner, reason: m.reason, revision: m.revision };
  }).filter(Boolean);
  send(ws, { type: 'MATCH_LIST', matches: list });
}
// End any of your matches from anywhere (the games list): forfeit if it's in progress, close it if nobody's playing yet.
function endMatch(ws, msg) {
  const m = matches.get(String(msg.session || ''));
  if (!m) return send(ws, { type: 'MATCH_ENDED', session: String(msg.session || ''), gone: true });
  let seat = m.seats.findIndex(s => credOk(s, msg.credential));
  if (seat < 0 && ws.authed) seat = m.seats.findIndex(s => s && !s.ai && s.identity === ws.identity);   // signed-in: your account owns the seat
  if (seat < 0) return send(ws, { error: 'That isn’t your game.' });
  m.seats[seat].hidden = true;   // deleted from your games list: never offered back to you (any device)
  if (m.phase === 'playing') { finish(m, 1 - seat, 'forfeit'); m.revision++; persist(m); broadcast(m, 'MATCH_FINISHED'); notifyMatch(m, { phase: 'playing', turn: m.turn, opp: true }); }
  else if (m.phase !== 'finished') { m.phase = 'finished'; m.finished = Math.floor(now() / 1000); m.reason = 'closed'; m.revision++; persist(m); for (const o of sockets.get(m.id) || []) send(o, { type: 'MATCH_CLOSED' }); }
  persist(m);
  send(ws, { type: 'MATCH_ENDED', session: m.id, result: m.reason, hidden: true });
}
// Signed-in players (fridge.run account) can find their games from any device; guests only see what this browser holds.
function myMatches(ws) {
  if (!ws.authed) return send(ws, { type: 'MY_MATCHES', matches: [] });
  const recent = now() / 1000 - 2 * 86400, list = [];
  for (const m of matches.values()) {
    const seat = m.seats.findIndex(s => s && !s.ai && s.identity === ws.identity); if (seat < 0 || m.seats[seat].hidden) continue;
    if (m.phase === 'finished' && (m.reason === 'closed' || (m.finished || 0) < recent)) continue;
    const op = m.seats[1 - seat];
    list.push({ id: m.id, mode: m.mode, size: m.size, rules: m.rules || null, phase: m.phase, seat, myTurn: m.phase === 'playing' && m.turn === seat,
      opponent: op ? op.name : null, turn_number: m.turn_number, winner: m.winner, reason: m.reason, revision: m.revision, updated: m.updated || m.created });
  }
  send(ws, { type: 'MY_MATCHES', matches: list.sort((a, b) => b.updated - a.updated).slice(0, 30) });
}

/* ---------------- Web Push: "your move" reaches you even when WHALESHIP is closed ---------------- */
const webpush = require('web-push');
const PUSH_FILE = path.join(DATA, 'push.json'), VAPID_FILE = path.join(DATA, 'vapid.json');
let vapid = null, pushSubs = {};
try { vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); } catch { vapid = webpush.generateVAPIDKeys(); try { fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid), { mode: 0o600 }); } catch (e) { console.error('vapid', e.message); } }
try { pushSubs = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')); } catch {}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://github.com/whaleship', vapid.publicKey, vapid.privateKey);
let pushSaveT = null;
function savePush() { clearTimeout(pushSaveT); pushSaveT = setTimeout(() => { try { fs.writeFileSync(PUSH_FILE + '.tmp', JSON.stringify(pushSubs)); fs.renameSync(PUSH_FILE + '.tmp', PUSH_FILE); } catch (e) { console.error('push save', e.message); } }, 200); }
function pushSubscribe(ws, msg) {
  const sub = msg.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string' || sub.endpoint.length > 1024) return send(ws, { error: 'Bad push subscription.' });
  const list = (pushSubs[ws.identity] || []).filter(x => x.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, t: now() });
  pushSubs[ws.identity] = list.slice(-5); savePush();     // up to 5 devices per player
  send(ws, { type: 'PUSH_OK' });
}
function pushTo(identity, payload) {
  for (const sub of pushSubs[identity] || []) {
    webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 86400, urgency: 'high', topic: String(payload.tag || '').slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '') || undefined })
      .catch(e => { if (e.statusCode === 404 || e.statusCode === 410) { pushSubs[identity] = (pushSubs[identity] || []).filter(x => x.endpoint !== sub.endpoint); savePush(); } else console.error('push', e.statusCode || e.message); });
  }
}
const shortId = hex => Buffer.from(hex, 'hex').toString('base64url');
const gameLink = m => `${INVITE_BASE || ''}?j=${shortId(m.id)}`;
// After every change in a friend match: tell whoever should act next (the server is the only one that knows).
function notifyMatch(m, before) {
  if (m.mode !== 'multiplayer') return;
  const human = s => m.seats[s] && !m.seats[s].ai;
  if (m.phase === 'playing' && (before.phase !== 'playing' || before.turn !== m.turn) && human(m.turn)) {
    const op = m.seats[1 - m.turn];
    pushTo(m.seats[m.turn].identity, { title: before.phase !== 'playing' ? `⚓ Battle on vs ${op?.name || 'your friend'}` : `🟢 Your move vs ${op?.name || 'your friend'}`,
      body: before.phase !== 'playing' ? 'Both fleets are deployed — fire away.' : `Turn ${m.turn_number}. They fired — your move, captain.`, tag: m.id, url: gameLink(m), match: shortId(m.id) });
  }
  if (!before.opp && m.seats[1] && human(0)) pushTo(m.seats[0].identity, { title: `🤝 ${m.seats[1].name} joined your battle`, body: 'Their fleet is deploying.', tag: m.id, url: gameLink(m), match: shortId(m.id) });
  if (m.phase === 'finished' && before.phase !== 'finished') for (const s of [0, 1]) if (human(s)) pushTo(m.seats[s].identity, { title: m.winner === s ? '🏆 You won' : '💀 It works on my machine.', body: `vs ${m.seats[1 - s]?.name || 'your opponent'} · ${m.turn_number} turns`, tag: m.id, url: gameLink(m), match: shortId(m.id) });
}
function legalPlacement(m, seat, shipId, cells) {
  if (!cells) return false;
  const taken = new Set(seat.ships.filter(s => s.id !== shipId).flatMap(s => s.cells));
  return cells.every(c => !taken.has(c) && seat.board[c] !== 5);
}
function maybeStart(m) {
  if (m.seats.every(s => s && s.ready) && ['deploy', 'lobby'].includes(m.phase)) { m.phase = 'playing'; m.turn = 0; m.turn_number = 1; m.started = Math.floor(now() / 1000); return true; }
  return false;
}
function areaCells(size, cell, kind, vertical) {
  const { w, h } = DIM(size), x = cell % w, y = Math.floor(cell / w), out = [];
  if (kind === 'tail') for (let d = -2; d <= 2; d++) { const cx = vertical ? x : x + d, cy = vertical ? y + d : y; if (cx >= 0 && cy >= 0 && cx < w && cy < h) out.push(cy * w + cx); }
  else for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const cx = x + dx, cy = y + dy; if (cx >= 0 && cy >= 0 && cx < w && cy < h) out.push(cy * w + cx); }
  return out;
}
function strike(m, s, cells, power = null) {
  const op = m.seats[1 - s], results = [];
  for (const c of cells) {
    if (op.board[c] !== 0) continue;
    if (op.decoys && op.decoys.includes(c)) { op.board[c] = 4; const a = { seat: s, cell: c, hit: false, decoy: true, sunk: null, turn: m.turn_number, power }; m.attacks.push(a); results.push(a); continue; }
    const ship = op.ships.find(sh => sh.cells.includes(c));
    const before = warfare(m) ? rolesOf(m, op) : null;
    op.board[c] = ship ? 2 : 1;
    let sunk = null;
    if (ship && isSunk(op, ship)) { ship.cells.forEach(x => op.board[x] = 3); sunk = { id: ship.id }; }
    const a = { seat: s, cell: c, hit: !!ship, sunk, turn: m.turn_number, power };
    if (ship) a.container = ensureManifest(m)[1 - s][ship.id][ship.cells.indexOf(c)];     // a hit reveals that one container's identity
    if (ship && !sunk) a.health = Math.round(100 * ship.cells.filter(x => op.board[x] === 0).length / ship.cells.length);
    m.attacks.push(a); results.push(a);
    if (before && sunk) for (const r of Object.keys(ROLE)) if (before[r] && !roleUp(m, op, r)) {
      pushEvent(m, { seat: 1 - s, kind: 'roledown', role: r });
      if (r === 'squid') {                          // proxy gone: everything it masked from the attacker's scans is exposed
        const me = m.seats[s];
        me.sonar = (me.sonar || []).map(x => x.fuzzy ? { cell: x.cell, ship: op.board[x.cell] === 0 && (op.ships.some(sh => sh.cells.includes(x.cell)) || (op.decoys || []).includes(x.cell)) } : x);
      }
    }
  }
  return results;
}
function endTurn(m, s) {
  const me = m.seats[s], op = m.seats[1 - s];
  if (op.ships.every(sh => isSunk(op, sh))) { finish(m, s, 'fleet'); return; }
  me.frozen = 0; me.rolling = false;
  m.turn = 1 - s; m.turn_number++;
  if (op.cool) for (const k of Object.keys(op.cool)) if (op.cool[k] > 0) op.cool[k]--;
  if (op.drained && op.drained.turns > 0) op.drained.turns--;
  if (op.drains) { op.drains.forEach(d => d.turns--); op.drains = op.drains.filter(d => d.turns > 0); }
  if (m.rules === 'chaos' && m.turn_number > 2 && Math.random() < .33) {
    chaosEvent(m, 1 - s);
    if (op.ships.every(sh => isSunk(op, sh))) finish(m, s, 'fleet');
  }
}
function special(m, s, msg) {
  const me = m.seats[s], op = m.seats[1 - s], id = String(msg.power), sp = SPECIALS[id], { w, h } = DIM(m.size);
  if (!warfare(m) || !sp) return 'That special isn’t available in this mode.';
  const v = specialsView(m, me).find(x => x.id === id); if (!v.ok) return `${id}: ${v.why}.`;
  const cell = Number(msg.cell); if (!Number.isInteger(cell) || cell < 0 || cell >= w * h) return 'Pick a square.';
  if (id === 'dns' && (me.board[cell] !== 0 || me.ships.some(sh => sh.cells.includes(cell)) || me.decoys.includes(cell))) return 'Plant the decoy on open water in your own cluster.';
  if (id === 'restore' && (me.board[cell] !== 2 || !me.ships.some(sh => sh.cells.includes(cell)))) return 'Pick a damaged (not sunk) segment of your own creature.';
  if (id === 'oom' && op.board[cell] !== 0 && op.board[cell] !== 2) return 'Aim OOM KILL at fresh water or a damaged host.';
  const r = Number(msg.rot) & 3;
  if ((id === 'trace') && op.board[cell] !== 0) return op.board[cell] === 5 ? 'That’s a firewall iceberg.' : 'Already probed — pick fresh water.';
  if (sp.charges) me.charges[id]--; if (sp.cd) me.cool[id] = sp.cd;
  const turn = m.turn_number;
  if (id === 'scan') {
    const area = patternCells(m.size, cell, 'square'), masked = roleUp(m, op, 'squid') || !!me.dnsFail; me.dnsFail = false;
    const real = c => op.board[c] === 0 && (op.ships.some(sh => sh.cells.includes(c)) || (op.decoys || []).includes(c));
    const open = area.filter(c => op.board[c] === 0);
    me.sonar = (me.sonar || []).filter(x => !area.includes(x.cell)).concat(open.map(c => masked ? { cell: c, fuzzy: true } : { cell: c, ship: real(c) }));
    m.attacks.push({ seat: s, cell, hit: false, sunk: null, turn, power: 'scan', reveal: true, area, found: open.filter(real).length, masked });
  } else if (id === 'trace') {
    const [a] = strike(m, s, [cell], 'trace');
    const live = [...op.ships.flatMap(sh => sh.cells).filter(c => op.board[c] === 0), ...(op.decoys || []).filter(c => op.board[c] === 0)];
    let best = 99; for (const c of live) best = Math.min(best, Math.abs(c % w - cell % w) + Math.abs(Math.floor(c / w) - Math.floor(cell / w)));
    if (a) a.hops = a.hit ? 0 : best;
  } else if (['tail', 'breach', 'grab'].includes(id)) { const area = patternCells(m.size, cell, sp.pattern, sp.rotates ? r : 0); m.attacks.push({ seat: s, cell, hit: false, sunk: null, turn, power: id, reveal: true, pattern: true, area, rot: sp.rotates ? r : 0 }); strike(m, s, area, id); }
  else if (id === 'flood') {                       // disruption, no damage: every creature touched is cordoned and their specials jam
    const area = patternCells(m.size, cell, 'diamond'), hitShips = op.ships.filter(sh => !isSunk(op, sh) && sh.cells.some(c => area.includes(c) && op.board[c] === 0));
    const roles = [...new Set(hitShips.map(sh => Object.keys(ROLE)[m.fleet[sh.id].kind]))];
    op.drains = [...(op.drains || []), ...roles.map(role => ({ role, turns: 2 }))]; op.frozen = 1;
    m.attacks.push({ seat: s, cell, hit: false, sunk: null, turn, power: 'flood', reveal: true, area, disrupted: roles.length });
    if (roles.length) pushEvent(m, { seat: 1 - s, kind: 'flooded', roles });
  }
  else if (id === 'oom') {
    const sh = op.ships.find(x => x.cells.includes(cell));
    if (op.board[cell] === 2 && sh && !isSunk(op, sh)) { const res = strike(m, s, sh.cells.filter(c => op.board[c] === 0), 'oom'); res.forEach(a => a.oom = true); if (!res.length) return null; }
    else strike(m, s, [cell], 'oom');
  } else if (id === 'dns') me.decoys.push(cell);
  else if (id === 'restore') { me.board[cell] = 0; m.attacks.push({ seat: s, cell, hit: false, sunk: null, turn, power: 'restore', reveal: true, restored: true }); }
  return null;
}
function finish(m, winner, reason) {
  m.phase = 'finished'; m.winner = winner; m.reason = reason; m.finished = Math.floor(now() / 1000); recordResult(m);
}
function fire(m, s, msg) {
  if (m.phase !== 'playing') return 'The battle has not started.';
  if (m.turn !== s) return 'Not your turn — the enemy is aiming.';
  const me = m.seats[s], op = m.seats[1 - s], n = DIM(m.size).w * DIM(m.size).h;
  const power = msg.type === 'POWER' ? String(msg.power) : null;
  if (power && m.rules) { const e = special(m, s, msg); if (e) return e; if (FREE.has(power)) return null; }
  else if (power) {
    if (!['sonar', 'depth', 'tail'].includes(power)) return 'Unknown power.';
    if (!(me.powers[power] > 0)) return `No ${power} left.`;
    const cell = Number(msg.cell); if (!Number.isInteger(cell) || cell < 0 || cell >= n) return 'Pick a square.';
    me.powers[power]--;
    const area = areaCells(m.size, cell, power, !!msg.vertical);
    if (power === 'sonar') {
      const found = area.map(c => ({ cell: c, ship: op.ships.some(sh => sh.cells.includes(c)) && op.board[c] === 0 }));
      me.sonar.push(...found.filter(f => op.board[f.cell] === 0));
      m.attacks.push({ seat: s, cell, hit: false, sunk: null, turn: m.turn_number, power: 'sonar', reveal: true, area, found: found.filter(f => f.ship).length });
    } else strike(m, s, area, power);
  } else {
    const cells = [...new Set((Array.isArray(msg.cells) ? msg.cells : [msg.cell]).map(Number))];
    const open = op.board.filter(v => v === 0).length;
    if (!cells.length || cells.some(c => !Number.isInteger(c) || c < 0 || c >= n)) return 'Pick a square.';
    if (cells.some(c => op.board[c] === 5)) return 'That’s a firewall iceberg — packets bounce off.';
    if (cells.some(c => op.board[c] !== 0)) return 'Already probed — pick fresh water.';
    if (cells.length > Math.min(salvoFor(m, s), open)) return `You can fire ${salvoFor(m, s)} shot(s) this turn.`;
    strike(m, s, cells);
  }
  endTurn(m, s);
  if (m.phase === 'playing' && m.seats[m.turn].ai) aiTurn(m, m.turn);
  return null;
}

/* ---------------- AI captains ---------------- */
function aiTargets(m, s, k) {
  const op = m.seats[1 - s], { w: N, h: HT } = DIM(m.size), T = N * HT, board = op.board, open = [];
  for (let c = 0; c < T; c++) if (board[c] === 0) open.push(c);
  if (!open.length) return [];
  const level = m.seats[s].ai;
  if (level === 'easy') return shuffle(open).slice(0, k);
  const score = new Float64Array(T);
  const hits = [];
  for (let c = 0; c < T; c++) if (board[c] === 2) hits.push(c);
  if (level === 'normal') {
    for (const h of hits) for (const d of [-1, 1, -N, N]) {
      const c = h + d; if (c < 0 || c >= T || board[c] !== 0) continue;
      if ((d === 1 || d === -1) && Math.floor(c / N) !== Math.floor(h / N)) continue;
      score[c] += 10;
    }
    for (const c of open) score[c] += ((c % N + Math.floor(c / N)) % 2 === 0 ? 1 : 0) + Math.random() * .5;
  } else {
    const alive = op.ships.filter(sh => !isSunk(op, sh)).map(sh => sh.cells.length);
    for (const len of alive) for (let y = 0; y < HT; y++) for (let x = 0; x < N; x++) for (const v of [false, true]) {
      const cells = footprint(m.size, len, x, y, v); if (!cells) continue;
      let w = 1, ok = true;
      for (const c of cells) { if (board[c] === 1 || board[c] >= 3) { ok = false; break; } if (board[c] === 2) w *= 25; }
      if (ok) for (const c of cells) if (board[c] === 0) score[c] += w;
    }
    for (const c of open) score[c] += Math.random() * .01;
  }
  for (const x of m.seats[s].sonar || []) if (x.ship && board[x.cell] === 0) score[x.cell] += 40; else if (x.fuzzy && board[x.cell] === 0) score[x.cell] += 3;
  return open.sort((a, b) => score[b] - score[a]).slice(0, k);
}
function aiTurn(m, s) {
  const k = salvoFor(m, s), me = m.seats[s], op = m.seats[1 - s];
  if (warfare(m)) {
    const ok = id => (specialsView(m, me).find(x => x.id === id) || {}).ok;
    if (ok('restore') && Math.random() < .5) { const d = me.ships.filter(sh => !isSunk(me, sh)).flatMap(sh => sh.cells.filter(c => me.board[c] === 2)); if (d.length) special(m, s, { power: 'restore', cell: d[0] }); }
    if (ok('dns') && m.turn_number >= 3 && Math.random() < .4) { const free = me.board.map((v, c) => v === 0 && !me.ships.some(sh => sh.cells.includes(c)) ? c : -1).filter(c => c >= 0); if (free.length) special(m, s, { power: 'dns', cell: free[crypto.randomInt(free.length)] }); }
    if (me.ai !== 'easy') {
      const damaged = op.ships.find(sh => !isSunk(op, sh) && sh.cells.some(c => op.board[c] === 2));
      if (ok('oom') && damaged && Math.random() < .55) { fire(m, s, { type: 'POWER', power: 'oom', cell: damaged.cells.find(c => op.board[c] === 2) }); return; }
      const t = aiTargets(m, s, 1)[0];
      for (const id of ['tail', 'breach', 'grab']) if (t != null && ok(id) && Math.random() < .14) { fire(m, s, { type: 'POWER', power: id, cell: t, rot: crypto.randomInt(4) }); return; }
      if (t != null && ok('flood') && Math.random() < .08) { fire(m, s, { type: 'POWER', power: 'flood', cell: t }); return; }
      if (t != null && ok('scan') && !op.board.includes(2) && Math.random() < .25) { fire(m, s, { type: 'POWER', power: 'scan', cell: t }); return; }
    }
    const cells = aiTargets(m, s, k); if (cells.length) fire(m, s, { type: 'FIRE', cells });
    return;
  }
  // legacy matches: whale-sized AIs occasionally use a power on big boards
  if (m.size > 10 && me.ai !== 'easy' && me.powers.depth > 0 && Math.random() < .12) {
    const t = aiTargets(m, s, 1)[0]; if (t != null) { fire(m, s, { type: 'POWER', power: 'depth', cell: t }); return; }
  }
  const cells = aiTargets(m, s, k);
  if (cells.length) fire(m, s, { type: 'FIRE', cells });
}

/* ---------------- message handling ---------------- */
function handle(ws, raw) {
  let msg; try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'CREATE_MATCH') return createMatch(ws, msg);
  if (msg.type === 'JOIN_MATCH') return joinMatch(ws, msg, false);
  if (msg.type === 'RESUME_MATCH') return joinMatch(ws, msg, true);
  if (msg.type === 'LIST_MATCHES') return listMatches(ws, msg);
  if (msg.type === 'END_MATCH') return endMatch(ws, msg);
  if (msg.type === 'MY_MATCHES') return myMatches(ws);
  if (msg.type === 'PUSH_SUBSCRIBE') return pushSubscribe(ws, msg);
  const m = matches.get(ws.matchId);
  if (!m || ws.seat == null || msg.session !== m.id) return send(ws, { error: 'Not in a match.' });
  const s = ws.seat, me = m.seats[s], before = { phase: m.phase, turn: m.turn, opp: !!m.seats[1] };
  if (msg.action_id) { if (me.recent.includes(msg.action_id)) return; me.recent.push(msg.action_id); if (me.recent.length > 40) me.recent.shift(); }
  let err = null, type = 'STATE';
  switch (msg.type) {
    case 'PLACE_SHIP': {
      if (!['lobby', 'deploy'].includes(m.phase) || me.ready) { err = 'Your fleet is already deployed.'; break; }
      const f = m.fleet.find(f => f.id === Number(msg.ship)); if (!f) { err = 'Unknown ship.'; break; }
      const cells = footprint(m.size, f.len, Number(msg.x), Number(msg.y), !!msg.vertical);
      if (!Number.isInteger(Number(msg.x)) || !Number.isInteger(Number(msg.y)) || !legalPlacement(m, me, f.id, cells)) { err = 'No room there.'; break; }
      me.ships = me.ships.filter(sh => sh.id !== f.id).concat({ id: f.id, cells }); type = 'FLEET_ACCEPTED'; break;
    }
    case 'RANDOMIZE_FLEET': if (me.ready || !['lobby', 'deploy'].includes(m.phase)) { err = 'Your fleet is already deployed.'; break; } me.ships = randomFleet(m.size, m.fleet, m.firewalls); type = 'FLEET_ACCEPTED'; break;
    case 'RESET_FLEET': if (me.ready) { err = 'Your fleet is already deployed.'; break; } me.ships = []; break;
    case 'READY':
      if (me.ships.length !== m.fleet.length) { err = 'Deploy every whale first.'; break; }
      me.ready = true; type = maybeStart(m) ? 'TURN_STARTED' : 'FLEET_READY'; break;
    case 'ATTACK': case 'FIRE': case 'POWER': err = fire(m, s, msg); type = m.phase === 'finished' ? 'MATCH_FINISHED' : 'ATTACK_RESOLVED'; break;
    case 'CLAIM_FORFEIT': {
      const op = m.seats[1 - s];
      if (m.phase !== 'playing' || !op || op.ai || op.connected || (now() - op.lastSeen) / 1000 < FORFEIT_AFTER) { err = 'Your opponent is still around.'; break; }
      finish(m, s, 'forfeit'); type = 'MATCH_FINISHED'; break;
    }
    case 'LEAVE_MATCH':
      if (m.phase === 'playing') { finish(m, 1 - s, 'forfeit'); type = 'MATCH_FINISHED'; break; }
      if (m.phase !== 'finished') { m.phase = 'finished'; m.finished = Math.floor(now() / 1000); m.reason = 'closed'; m.revision++; persist(m); for (const o of sockets.get(m.id) || []) send(o, { type: 'MATCH_CLOSED' }); return; }
      return;
    default: err = 'Unknown command.';
  }
  if (err) return send(ws, { error: err });
  bump(m, type); notifyMatch(m, before);
}

/* ---------------- identity (guest cookie or Fridge account) ---------------- */
function cookies(req) { const out = {}; for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return out; }
const bridgeCache = new Map();
async function bridgeUser(cookie) {   // optional SSO identity bridge (AUTH_BRIDGE); identities keep the historical "fridge:" prefix
  if (!AUTH_BRIDGE || AUTH_SECRET.length < 32 || !cookie) return null;
  const k = sha(cookie), hit = bridgeCache.get(k);
  if (hit && hit.t > now() - 60e3) return hit.u;
  let u = null;
  try {
    const r = await fetch(AUTH_BRIDGE, { headers: { 'X-Whaleship-Auth': AUTH_SECRET, Cookie: `${AUTH_COOKIE}=${encodeURIComponent(cookie)}` }, signal: AbortSignal.timeout(2500) });
    const j = r.ok ? await r.json() : {}; if (j && j.sub) u = { sub: String(j.sub), name: clean(j.name) || 'Captain' };
  } catch {}
  bridgeCache.set(k, { t: now(), u }); if (bridgeCache.size > 2000) bridgeCache.clear();
  return u;
}
async function identify(req) {
  const c = cookies(req);
  let guest = /^[a-f0-9]{48}$/.test(c.ws_guest || '') ? c.ws_guest : null, setCookie = null;
  if (!guest) { guest = rid(24); setCookie = `ws_guest=${guest}; Path=${BASE}; Max-Age=63072000; HttpOnly; Secure; SameSite=Lax`; }
  const u = await bridgeUser(c[AUTH_COOKIE]);
  const identity = u ? 'fridge:' + u.sub : 'guest:' + sha(guest).slice(0, 24);
  return { identity, authed: !!u, name: u ? u.name : guestName(sha(guest)), setCookie, pub: sha(identity).slice(0, 16) };
}

/* ---------------- HTTP: API + static client ---------------- */
const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function json(res, code, obj, headers = {}) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); }
// BUILD is stamped into web/BUILD at deploy; asset URLs carry ?v=BUILD so caches (browser + Cloudflare) can never mix versions
const BUILD = (() => { try { return fs.readFileSync(path.join(WEB, 'BUILD'), 'utf8').trim(); } catch { return 'dev'; } })();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (!url.pathname.startsWith(BASE)) { res.writeHead(404); return res.end(); }
    const p = url.pathname.slice(BASE.length) || '/';
    if (p === '') { res.writeHead(301, { Location: BASE + '/' + url.search }); return res.end(); }
    if (p === '/api/profile') { const id = await identify(req); return json(res, 200, { name: id.name, authenticated: id.authed, identity: id.pub, inviteBase: INVITE_BASE, loginUrl: id.authed ? '' : LOGIN_URL, pushKey: vapid.publicKey }, id.setCookie ? { 'Set-Cookie': id.setCookie } : {}); }
    if (p === '/api/metrics') { const active = [...matches.values()].filter(m => m.phase !== 'finished').length; return json(res, 200, { status: 'operational', infrastructure: { active_workers: active, max_workers: MAX_ACTIVE, backend: 'whaleship2', restarts: 0 } }); }
    if (p === '/api/leaderboard') return json(res, 200, leaderboard(['multiplayer', 'easy', 'normal', 'hard'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'multiplayer', url.searchParams.get('period')));
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': url.searchParams.get('v') === BUILD && BUILD !== 'dev' ? 'public, max-age=31536000, immutable' : 'no-cache, max-age=0' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  } catch (e) { console.error('http', e); try { res.writeHead(500); res.end(); } catch {} }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== BASE + '/ws') return socket.destroy();
  if (ORIGINS.length && !ORIGINS.includes(req.headers.origin)) return socket.destroy();
  const id = await identify(req);
  wss.handleUpgrade(req, socket, head, ws => {
    Object.assign(ws, { identity: id.identity, authed: id.authed, name: id.name, matchId: null, seat: null, tokens: 30, last: now() });
    ws.on('message', data => {
      const t = now(); ws.tokens = Math.min(30, ws.tokens + (t - ws.last) / 66); ws.last = t;      // ~15 msg/s sustained, burst 30
      if (ws.tokens < 1) return send(ws, { error: 'Slow down, captain.' }); ws.tokens--;
      try { handle(ws, data); } catch (e) { console.error('handle', e); send(ws, { error: 'Something went wrong. Try again.' }); }
    });
    ws.on('close', () => detach(ws));
    send(ws, { type: 'CONNECTED', build: BUILD });
  });
});
setInterval(() => { for (const ws of wss.clients) if (ws.readyState === 1) ws.ping(); }, 30e3);
// keep "opponent went dark" counters fresh for anyone watching a match with an absent player
setInterval(() => { for (const [id] of sockets) { const m = matches.get(id); if (m && m.phase === 'playing' && m.seats.some(s => s && !s.ai && !s.connected)) broadcast(m, 'PRESENCE'); } }, 60e3);

// one-time import of v1 leaderboard rows (if mounted read-only at /import/scores.json)
try { if (!fs.existsSync(RESULTS) && fs.existsSync('/import/scores.json')) { const rows = JSON.parse(fs.readFileSync('/import/scores.json', 'utf8')); fs.writeFileSync(RESULTS, rows.map(r => JSON.stringify({ ...r, size: 10 })).join('\n') + (rows.length ? '\n' : '')); console.log(`imported ${rows.length} v1 scores`); } } catch (e) { console.error('import', e.message); }
if (process.argv[2] === '--check-data') {           // dry run: no writes, no deletes, no network
  const r = readMatches(path.resolve(process.argv[3] || MDIR));
  console.log(JSON.stringify({ schema: SCHEMA, ...r }, null, 1));
  process.exit(r.failed.length ? 1 : 0);
}
load();
server.listen(PORT, () => console.log(`whaleship2 listening on ${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  for (const [id, t] of saveTimers) { clearTimeout(t); const m = matches.get(id); if (m) try { fs.writeFileSync(path.join(MDIR, id + '.json'), JSON.stringify(m)); } catch {} }
  process.exit(0);
});
