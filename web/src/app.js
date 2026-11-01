// WHALESHIP client v0.7 — infrastructure battleship. The board is one canvas (no per-cell DOM), creatures are a
// handful of standing SVG cards, effects run on a single canvas that only animates while something is happening.
import * as audio from './audio.js';
import * as prefs from './settings.js';
import {creatureSVG, bergSVG, slotFor, ROLES} from './creatures.js';

const BUILD = '__BUILD__';   // stamped at deploy; if the server reports a newer build, this tab reloads itself once
const GEN = '0.7';           // bump to give every browser a fresh start (old matches stay under ＋)
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = window.history;
const ts = () => new Date().toISOString().slice(11, 19);
const CRITTERS = ['🐋', '🐋', '🐳', '🐳', '🐬', '🐬', '🦭', '🦈', '🐙', '🦑', '🐡', '🐠', '🐧'];
// Specials. v3 matches (warfare/chaos) use scan/trace/flood/oom/dns/restore, gated by which creatures are still alive;
// pre-v3 matches keep sonar/depth/tail. area: 'sq' 3×3 · 'line' 5 · 'one' single cell. own: targets your own waters.
const POWER_INFO = {
  tail3: {emoji: '🐋', label: 'TAIL SLAP', short: 'TAIL', cmd: 'docker kill --pattern=tee', what: 'T-shaped slam · 5 cells', pattern: 'tee', rot: true, needs: 'moby', fx: 'damage',
    tip: 'Tail slap: the flukes slam a T-shape (5 cells). Rotate it with ⟳ (or Space).'},
  breach: {emoji: '🐳', label: 'BREACH', short: 'BREACH', cmd: 'docker kill --pattern=cross', what: '+ splash · 5 cells', pattern: 'cross', needs: 'swarm', fx: 'damage',
    tip: 'Breach: a whale launches out of the water and crashes down in a + shape (5 cells).'},
  grab: {emoji: '🦑', label: 'TENTACLE GRAB', short: 'GRAB', cmd: 'kubectl delete --pattern=ell', what: 'L-shaped grab · 5 cells', pattern: 'ell', rot: true, needs: 'squid', fx: 'damage',
    tip: 'Tentacle grab: the proxy squid grabs an L-shape (5 cells). Rotate it with ⟳ (or Space).'},
  scan: {emoji: '📡', label: 'PORT SCAN', short: 'SCAN', cmd: 'nmap -sS', what: 'scan a sector for activity', area: 'sq', pattern: 'square', needs: 'tux', fx: 'reveal',
    tip: 'Port scan: counts running containers in a 3×3 sector. If their proxy (squid) is alive the exact spots stay masked.'},
  trace: {emoji: '🛰️', label: 'TRACEROUTE', short: 'TRACE', cmd: 'traceroute', what: 'ping + hop distance clue', area: 'one', pattern: 'one', needs: 'tux', fx: 'damage',
    tip: 'Traceroute: one ping that also reports how many hops away the nearest live target is.'},
  flood: {emoji: '🌊', label: 'PACKET FLOOD', short: 'FLOOD', cmd: 'hping3 --flood --pattern=diamond', what: 'cordon creatures in a ◆ (no damage)', area: 'sq', pattern: 'diamond', needs: 'swarm', fx: 'disrupt',
    tip: 'Packet flood: no damage — every enemy creature touched by the diamond is cordoned for 2 turns (its abilities go offline) and their specials jam.'},
  oom: {emoji: '💀', label: 'OOM KILL', short: 'OOM', cmd: 'kill -9 --oom', what: 'finish off a damaged host', area: 'one', pattern: 'one', needs: 'moby', fx: 'damage',
    tip: 'OOM killer: aim at a damaged creature (a hit square) and the whole thing is killed. On fresh water it is a normal ping.'},
  dns: {emoji: '☠️', label: 'DNS POISON', short: 'DNS', cmd: 'dnsmasq --poison', what: 'plant a decoy (free action)', area: 'one', own: true, needs: 'squid',
    tip: 'DNS poison: plant a fake host in your own waters. It shows up on their scans and traceroutes. Free action.'},
  restore: {emoji: '💾', label: 'RESTORE', short: 'RESTORE', cmd: 'restic restore latest --target', what: 'repair a damaged part (free)', area: 'one', own: true, needs: 'walrus',
    tip: 'Restore from backup: repair one damaged (not sunk) segment of your creature. Needs your walrus (storage). Free action.'},
  sonar: {emoji: '📡', label: 'PORT SCAN', short: 'SCAN', cmd: 'nmap -sS', what: 'reveal a 3×3 block', area: 'sq', pattern: 'square'},
  depth: {emoji: '🌊', label: 'SYN FLOOD', short: 'FLOOD', cmd: 'hping3 --flood', what: 'hit a 3×3 block', area: 'sq', pattern: 'square'},
  tail: {emoji: '🛰️', label: 'TRACEROUTE', short: 'TRACE', cmd: 'traceroute -m 5', what: 'hit a line of 5', area: 'line', pattern: 'line'},
  chaos: {emoji: '☸️', label: 'OOMKilled', short: 'K8S', cmd: 'kubelet --evict', what: '', area: 'one'},
};
const PI = p => (p === 'tail' && state?.rules ? POWER_INFO.tail3 : POWER_INFO[p]) || POWER_INFO.chaos;
// Same offset table as the server (X = [0, 0]); rotatable patterns turn 90° per step and follow the real grid across sectors.
const PATTERNS = {one: [[0, 0]], square: [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]], tee: [[-1, -2], [0, -2], [1, -2], [0, -1], [0, 0]],
  cross: [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]], diamond: [[0, -2], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]], ell: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]};
const rotOff = ([x, y], r) => { for (let i = 0; i < (r & 3); i++) [x, y] = [-y, x]; return [x, y]; };
let rotN = 0, lastPointer = 'mouse';
const ROLE_FX = {moby: 'FLOOD + OOM KILL offline (Cannot connect to the Docker daemon)', swarm: '−1 ping per turn (orchestrator lost)', walrus: 'RESTORE offline (no backups found)', tux: 'SCAN + TRACEROUTE offline (no diagnostics)', squid: 'proxy down: their scans now see exact positions'};
const RULE_INFO = {classic: {label: 'CLASSIC', small: 'just pings'}, warfare: {label: 'WARFARE', small: '★ roles + specials'}, chaos: {label: 'CHAOS', small: '+ Kubernetes events'}};
const CTAS = ['keypad', 'sizes', 'rules', 'cta-solo', 'difficulty', 'cta-friend', 'cta-invite', 'cta-shuffle', 'cta-ready', 'cta-fire', 'specials', 'cta-notify', 'cta-forfeit', 'cta-again', 'cta-share'];
const DEFAULT_FLEET = [5, 4, 3, 3, 2].map((len, id) => ({id, len, kind: id, name: ['moby-5', 'swarm-4', 'walrus-3', 'tux-3', 'squid-2'][id]}));
const EXITS = ['exit 137', 'SIGKILL', 'OOMKilled', 'core dumped', 'segfault', 'EOF', 'ECONNRESET', 'panic: nil map'];

let settings = prefs.load();
let socket, profile = {}, state = null, active = null, seatKeys = {}, connected = false, retries = 0, pending = false;
let N = 0, HT = 0, SIZE = 0, FLEET = DEFAULT_FLEET;   // N = columns, HT = rows; SIZE 18 = the 18×12 sector map
let sel = -1, seenEvents = 0, lastSpecials = '';
let chosenRules = (() => { try { return localStorage.getItem('whaleship:rules') || 'warfare'; } catch { return 'warfare'; } })();                                           // selected sector (sector mode)
let view = 'target', held = null, armed = null, tailVertical = false;
const targets = new Set(), locked = new Set();
let queue = [], animating = false, seen = 0, sliding = false, shownSonar = 0;
const hidden = {home: new Set(), target: new Set()}, hiddenSunk = new Set(), freshSink = new Set();
let lastWinner = null, joining = false, justCreated = false, lastTurnMine = null;
const autoFleet = new Set(), autoReadied = new Set(), printedFleet = new Set();
let cmdHistory = [], drag = null, suppressClick = false;
let zoom = {z: 1, x: 0, y: 0};
let R3 = null;   // the Three.js world when WebGL2 is available (otherwise the 2D board below is used)
let hover = -1, kb = -1, area = [], previewCells = null;
const stats = {sent: 0};

/* ---------------- fleet + coordinates ---------------- */
const F = id => FLEET.find(f => f.id === id) || {id, len: 1, kind: 4, name: 'whale-' + id};
const LEN = id => F(id).len, POD = id => F(id).name, IMG = id => `${POD(id).replace(/-(\d+)\w?$/, ':$1')}`;
const ROLE = id => ROLES[F(id).kind % 5];
const NICE = id => `${ROLE(id).kind} (${POD(id)} · ${ROLE(id).role})`;
const TOTAL = () => FLEET.reduce((n, f) => n + f.len, 0);
const colLabel = i => i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(39 + i);
const CELLS = () => N * HT, SECT = () => [15, 18, 36].includes(SIZE), dims = s => s === 18 ? [18, 12] : s === 36 ? [18, 18] : [s, s];
const SC = () => N / 3, SR = () => HT / 3, NSEC = () => SC() * SR();   // sector columns / rows / count
// Sector addressing: 6×4 sectors A–X, each a 3×3 keypad 1–9. K5 = centre of sector K. Sectors are addresses, not walls.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';   // sectors A–Z then 0–9 (6×6 = 36); subsectors stay 1–9
const secOf = c => Math.floor(Math.floor(c / N) / 3) * SC() + Math.floor((c % N) / 3);
const subOf = c => (Math.floor(c / N) % 3) * 3 + (c % N) % 3 + 1;
const cellOf = (si, sub) => (Math.floor(si / SC()) * 3 + Math.floor((sub - 1) / 3)) * N + (si % SC()) * 3 + (sub - 1) % 3;
const subnet = (si, enemy = true) => `${enemy ? '172.20' : '10.0'}.${si + 1}.0/24`;
const coord = c => SECT() ? LETTERS[secOf(c)] + subOf(c) : colLabel(c % N) + (Math.floor(c / N) + 1);
const lc = c => coord(c).toLowerCase();
const ip = (c, enemy) => SECT() ? `${enemy ? '172.20' : '10.0'}.${secOf(c) + 1}.${subOf(c)}` : `${enemy ? '172.20' : '10.0'}.${Math.floor(c / N) + 1}.${c % N + 1}`;
function parseCoord(v) {
  if (SECT()) { const m = /^([a-z0-9])([1-9])$/i.exec((v || '').trim()), si = m ? LETTERS.indexOf(m[1].toUpperCase()) : -1; return si >= 0 && si < NSEC() ? cellOf(si, Number(m[2])) : -1; }
  const m = /^([a-z]{1,2})(\d{1,2})$/i.exec((v || '').trim()); if (!m) return -1;
  const L = m[1].toUpperCase(), x = L.length === 1 ? L.charCodeAt(0) - 65 : 26 + L.charCodeAt(1) - 65, y = Number(m[2]) - 1;
  return x >= 0 && x < N && y >= 0 && y < HT ? y * N + x : -1;
}
const prefSize = () => 36;   // the 6×6 sector map is the only play mode (older matches still load in their own size)
let chosenSize = prefSize();
const coarse = () => matchMedia('(pointer:coarse)').matches;
const touchLayout = () => coarse() || innerWidth < 700;   // phones/tablets: tap the map; no sector keypad

/* ---------------- helpers ---------------- */
let toastTimer;
function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 4200); }
const myName = () => profile.authenticated ? profile.name : (prefs.callsign() || profile.name || '');
const oppName = () => state?.opponent?.name || (state && state.mode !== 'multiplayer' ? 'AI captain' : 'your opponent');
const slug = s => (s || 'enemy').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'enemy';
const deploying = () => !!state && ['lobby', 'deploy'].includes(state.phase);
const myTurn = () => state?.phase === 'playing' && state.turn === state.seat;
const isVertical = cells => { const s = [...cells].sort((a, b) => a - b); return s.length > 1 && s[1] - s[0] === N; };
const salvo = () => state?.salvo || 1;

/* ---------------- terminal output: an ordered queue; commands are typed out when the terminal is on screen ---------------- */
let termChain = Promise.resolve();
const termVisible = () => document.body.classList.contains('term-open') && !document.hidden && !settings.reduced;
function termDo(fn) { termChain = termChain.then(fn).catch(() => {}); }
function termRow(cls) { const r = document.createElement('div'); if (cls) r.className = cls; const L = $('#terminal-log'); L.append(r); while (L.children.length > 400) L.firstChild.remove(); return r; }
function scrollTerm() { const L = $('#terminal-log'); L.scrollTop = L.scrollHeight; }
function prompt(cmd, o = {}) {
  const user = o.user || 'captain', host = o.host || 'whaleship', enemy = !!o.enemy;
  $('#ticker-text').textContent = `${user}@${host}$ ${cmd}`;
  termDo(async () => {
    const row = termRow('log-command' + (enemy ? ' enemy' : ''));
    row.innerHTML = `<b class="${enemy ? 'eu' : 'pu'}"></b>:<b class="pp">~</b>$ <span></span><i class="cursor"></i>`;
    row.firstChild.textContent = `${user}@${host}`; const out = row.querySelector('span');
    if (o.typed !== false && termVisible()) for (const ch of cmd) { out.textContent += ch; audio.sound('key'); scrollTerm(); await sleep(16 + Math.random() * 26); }
    else out.textContent = cmd;
    row.querySelector('.cursor').remove(); scrollTerm();
  });
}
function log(text, kind = '') {
  $('#ticker-text').textContent = String(text).split('\n').pop();
  termDo(() => { const r = termRow(kind ? 'log-' + kind : ''); r.textContent = text; scrollTerm(); });
}

/* ---------------- session + network ---------------- */
function saveSession() { try { localStorage.setItem('whaleship:seats:' + profile.identity, JSON.stringify(seatKeys)); if (active) localStorage.setItem('whaleship:active:' + profile.identity, active); else localStorage.removeItem('whaleship:active:' + profile.identity); } catch { toast('Browser storage is blocked. Keep this tab open to keep your seat.'); } }
function raw(v) { if (!connected || socket?.readyState !== 1) { toast('Reconnecting to the harbor…'); return false; } socket.send(JSON.stringify(v)); return true; }
function act(type, data = {}) { if (!state || pending) return; pending = true; raw({type, session: state.id, revision: state.revision, action_id: crypto.randomUUID(), ...data}); setTimeout(() => pending = false, 3000); }
function newGame(mode, size = chosenSize) {
  if (pending) return; pending = true; justCreated = mode === 'multiplayer';
  prompt(`docker compose --profile ${chosenRules} up -d --scale grid=${dims(size).join('x')}${mode === 'multiplayer' ? ' --wait-for friend' : ' --ai ' + mode}`); audio.sound('select');
  raw({type: 'CREATE_MATCH', mode, size, rules: chosenRules, name: myName()}); setTimeout(() => pending = false, 10000);
}
const toShort = hex => btoa(String.fromCharCode(...hex.match(/../g).map(h => parseInt(h, 16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromShort(s) { try { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return b.length === 16 ? [...b].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') : null; } catch { return null; } }
function invitation(value) {
  value = (value || '').trim(); if (/^[a-f0-9]{32}$/.test(value)) return value; if (/^[A-Za-z0-9_-]{22}$/.test(value)) return fromShort(value);
  try { const u = new URL(value, location.href), q = u.searchParams, h = new URLSearchParams(u.hash.slice(1)); const j = q.get('j') || h.get('j'), join = q.get('join') || h.get('join'); return join && /^[a-f0-9]{32}$/.test(join) ? join : j ? fromShort(j) : null; } catch { return null; }
}
function join(id) { if (!/^[a-f0-9]{32}$/.test(id || '')) { toast('That invitation is not valid. Paste the complete link.'); return; } const credential = seatKeys[id]; raw({type: credential ? 'RESUME_MATCH' : 'JOIN_MATCH', session: id, credential, name: myName()}); }
function historyReplace() { H.replaceState(null, '', location.pathname); }
const inviteUrl = id => `https://fridge.run/whaleship?j=${toShort(id)}`;
function syncUrl() { if (state?.mode === 'multiplayer' && state.phase !== 'finished') { const q = '?j=' + toShort(state.id); if (location.search !== q || location.hash) H.replaceState(null, '', location.pathname + q); } else if (/(join|j)=/.test(location.search + location.hash)) historyReplace(); }
function showMenu() { state = null; active = null; queue = []; hidden.home.clear(); hidden.target.clear(); hiddenSunk.clear(); held = null; armed = null; targets.clear(); view = 'target'; saveSession(); syncUrl(); setSize(chosenSize); autoZoom(); render(); }

function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/whaleship/ws`);
  socket.onopen = () => { connected = true; retries = 0; render(); setTimeout(pollGames, 600); };
  socket.onclose = () => { connected = false; pending = false; render(); setTimeout(connect, Math.min(15000, 750 * 2 ** retries++)); };
  socket.onerror = () => {};
  socket.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'CONNECTED') {
      if (msg.build && msg.build !== 'dev' && BUILD !== '__BUILD__' && msg.build !== BUILD) { const k = 'whaleship:reload:' + msg.build; let first = true; try { first = !sessionStorage.getItem(k); sessionStorage.setItem(k, '1'); } catch {} if (first) { location.reload(); return; } }
      const requested = invitation(location.href);
      if (requested) { joining = true; join(requested); }
      else if (active && seatKeys[active]) raw({type: 'RESUME_MATCH', session: active, credential: seatKeys[active]});
      return;
    }
    if (msg.type === 'MATCH_LIST') { onMatchList(msg.matches || []); return; }
    pending = false;
    if (msg.error) {
      log(`Error response from daemon: ${msg.error}`, 'error'); audio.sound('error');
      toast(joining && !state ? `${msg.error} — start your own with ＋` : msg.error);
      if (joining && !state) historyReplace(); joining = false;
    }
    if (msg.state?.id) onState(msg);
    if (msg.type === 'MATCH_CLOSED') { log(`${ts()} network disconnect whaleship_default (match closed)`, 'event'); toast('Match closed. Start a fresh one with ＋'); showMenu(); }
  };
}

function onState(msg) {
  const incoming = msg.state;
  if (state?.id === incoming.id && incoming.revision < state.revision) return;
  const restoring = !state || state.id !== incoming.id || msg.type === 'MATCH_RESUMED';
  const prev = restoring ? null : state;
  if (restoring) { FLEET = incoming.fleet || DEFAULT_FLEET; setSize(incoming.size || 10); seen = incoming.attacks.length; queue = []; hidden.home.clear(); hidden.target.clear(); hiddenSunk.clear(); targets.clear(); armed = null; shownSonar = incoming.opponent?.sonar?.length || 0; clearShips(); }
  else for (const a of incoming.attacks.slice(seen)) {
    const mine = a.seat === incoming.seat;
    if (!a.reveal) hidden[mine ? 'target' : 'home'].add(a.cell);
    if (a.sunk && mine) hiddenSunk.add(a.sunk.id);
    queue.push(a);
  }
  seen = incoming.attacks.length;
  const evs = incoming.events || [];
  if (restoring) seenEvents = evs.length; const fresh = evs.slice(Math.min(seenEvents, evs.length)); seenEvents = evs.length;
  state = incoming; active = state.id;
  if (fresh.length) setTimeout(() => fresh.forEach(showEvent), queue.length ? 900 : 0);
  if (msg.credential) { seatKeys[active] = msg.credential; saveSession(); }
  if (restoring) {
    held = null; view = deploying() ? 'home' : (myTurn() || state.phase === 'finished') ? 'target' : 'home';
    prompt(`docker compose -p ${toShort(state.id).slice(0, 8).toLowerCase()} up --attach`);
    log(`[+] ${msg.type === 'MATCH_CREATED' ? 'Running' : 'Attaching'} · ${state.mode} · ${SECT() ? `${NSEC()} sectors (${N}x${HT})` : N + 'x' + HT} · salvo ${state.salvo} · rev ${state.revision} · subnet 172.20.0.0/16`);
    autoZoom();
  }
  if (state.me.ships.length === FLEET.length && !printedFleet.has(state.id)) {
    printedFleet.add(state.id);
    log(`Creating network "whaleship_default" with driver "overlay"\n${FLEET.map(f => { const s = state.me.ships.find(s => s.id === f.id), a = s ? lc(Math.min(...s.cells)) : '--'; return ` ✔ Container ${f.name.padEnd(12)} ${ROLES[f.kind % 5].role.padEnd(13)} @ ${a.padEnd(4)} Started`; }).join('\n')}`);
  }
  if (prev && prev.phase !== 'playing' && state.phase === 'playing') { log(`Attaching to ${FLEET.map(f => f.name).join(', ')}`); audio.sound('join'); if (!queue.length) slideTo(myTurn() ? 'target' : 'home'); }
  if (prev && !prev.opponent && state.opponent) { log(`${ts()} network connect ${state.opponent.name} → whaleship_default (172.20.0.0/16)`, 'event'); audio.sound('join'); notify(`${state.opponent.name} joined your battle`, 'Your fleet is deployed — fire away!'); }
  if (state.phase === 'finished' && prev?.phase === 'playing') log(state.winner === state.seat ? '[+] Stopping enemy stack ... done\n[+] Removing network enemy_default ... done' : 'ERROR: fleet exited with code 137 — it works on my machine', state.winner === state.seat ? 'hit' : 'error');
  if (deploying() && !state.me.ready && view !== 'home' && !sliding) view = 'home';
  if (!myTurn()) { targets.clear(); armed = null; }
  syncUrl();
  if (deploying() && !state.me.ready && state.me.ships.length === 0 && !autoFleet.has(state.id)) {
    autoFleet.add(state.id); setTimeout(() => { pending = false; act('RANDOMIZE_FLEET'); }, 60);
    if (joining) toast(`You joined ${state.opponent?.name ? state.opponent.name + '’s' : 'the'} battle! Fleet auto-deployed.`);
  }
  if (!settings.manual && autoFleet.has(state.id) && deploying() && state.me.ships.length === FLEET.length && !state.me.ready && !autoReadied.has(state.id)) {
    autoReadied.add(state.id); setTimeout(() => { pending = false; act('READY'); }, 350);
  }
  joining = false;
  if (justCreated && state.mode === 'multiplayer') { justCreated = false; openShare(); }
  const mineNow = myTurn();
  if (mineNow && lastTurnMine === false && !queue.length) { notify('Your turn in WHALESHIP', `${oppName()} fired. Your move, captain.`); audio.sound('turn'); }
  lastTurnMine = mineNow;
  rememberMatch(); render(); playNext();
}

/* ---------------- ongoing games ---------------- */
function matches() { try { return JSON.parse(localStorage.getItem('whaleship:matches') || '{}'); } catch { return {}; } }
function rememberMatch() {
  const m = matches();
  m[state.id] = {mode: state.mode, size: state.size, opp: state.opponent?.name || '', mine: myTurn(), phase: state.phase, t: Date.now()};
  try { localStorage.setItem('whaleship:matches', JSON.stringify(Object.fromEntries(Object.entries(m).sort((a, b) => b[1].t - a[1].t).slice(0, 20)))); } catch {}
  const g = games.get(state.id); if (g) { g.myTurn = myTurn(); g.phase = state.phase; } paintGames();
}
/* ---------------- my games: play several at once ---------------- */
const games = new Map();   // id → server status (only for matches this browser holds a seat in)
function pollGames() { if (!connected || document.hidden) return; const list = Object.entries(seatKeys).slice(-30).map(([session, credential]) => ({session, credential})); if (list.length) raw({type: 'LIST_MATCHES', matches: list}); }
setInterval(pollGames, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) pollGames(); });
function onMatchList(list) {
  const seenIds = new Set();
  for (const g of list) {
    seenIds.add(g.id); const prev = games.get(g.id); games.set(g.id, g);
    if (!prev || g.id === state?.id) continue;   // the game on screen already has its own cues
    const who = g.opponent || (g.mode === 'multiplayer' ? 'your friend' : 'the AI');
    if (g.myTurn && !prev.myTurn) alertGame(g.id, `🟢 Your move vs ${who}`, `Turn ${g.turn_number} — ${who} fired. Your move, captain.`);
    else if (g.opponent && !prev.opponent) alertGame(g.id, `🤝 ${g.opponent} joined your battle`, 'Their fleet is deploying. Your seat is waiting.');
    else if (g.phase === 'finished' && prev.phase !== 'finished') alertGame(g.id, g.winner === g.seat ? '🏆 You won a game' : '💀 A game ended', `vs ${who}`);
  }
  for (const id of games.keys()) if (!seenIds.has(id)) games.delete(id);   // match closed or expired on the server
  paintGames();
}
function alertGame(id, title, body) {
  audio.sound('turn'); toast(`${title} · open 🗂 Games to switch`);
  if ('Notification' in window && Notification.permission === 'granted') { try { const n = new Notification(title, {body, tag: 'whaleship-' + id}); n.onclick = () => { window.focus(); switchGame(id); n.close(); }; } catch {} }
}
function switchGame(id) { if (id === state?.id) return; $('#new-dialog').open && $('#new-dialog').close(); $('#result-overlay').hidden = true; H.replaceState(null, '', location.pathname + '?j=' + toShort(id)); joining = true; join(id); }
function paintGames() {
  const waiting = [...games.values()].filter(g => g.myTurn && g.id !== state?.id).length, b = $('#games-btn');
  b.dataset.count = waiting || ''; b.setAttribute('aria-label', waiting ? `Games — your move in ${waiting}` : 'Games');
  renderTitle();
  if ($('#new-dialog').open) renderGameList();
}
function renderGameList() {
  const list = $('#recent'); list.replaceChildren();
  const local = matches(), ids = [...new Set([...games.keys(), ...Object.keys(local)])].filter(id => seatKeys[id]);
  const rows = ids.map(id => ({id, g: games.get(id), l: local[id] || {}})).filter(r => r.g || r.l.phase !== 'finished')
    .sort((a, b) => (b.g?.myTurn ? 1 : 0) - (a.g?.myTurn ? 1 : 0) || (b.l.t || 0) - (a.l.t || 0));
  for (const {id, g, l} of rows) {
    const mode = g?.mode || l.mode, opp = g?.opponent || l.opp, here = id === state?.id;
    const who = mode === 'multiplayer' ? (opp ? `vs ${opp}` : 'waiting for a friend') : `solo · ${mode}`;
    const st = here ? '👁 on screen' : !g ? '… checking' : g.phase === 'finished' ? (g.winner === g.seat ? '🏆 you won' : '💀 you lost') : g.phase === 'playing' ? (g.myTurn ? '🟢 your move' : '⏳ their move') : (opp || mode !== 'multiplayer') ? '⚓ deploying' : '📨 invite sent';
    const b = document.createElement('button'); b.className = 'recent-row' + (g?.myTurn && !here ? ' hot' : ''); b.disabled = here;
    b.innerHTML = '<code></code><span></span><b></b>'; b.children[0].textContent = g ? `turn ${g.turn_number || 0}` : '—'; b.children[1].textContent = who; b.children[2].textContent = st;
    b.onclick = () => switchGame(id); list.append(b);
  }
  $('#recent-wrap').hidden = !rows.length;
  $('#notify-wrap').hidden = !('Notification' in window) || Notification.permission !== 'default';
}
function paintSizes() { document.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.size) === chosenSize))); }
function openNewGame() { renderGameList(); paintSizes(); $('#new-dialog').showModal(); pollGames(); }
let qrLoaded = null;
function loadQr() { return qrLoaded ??= new Promise((ok, no) => { const s = document.createElement('script'); s.src = './src/vendor/qrcode.min.js'; s.onload = ok; s.onerror = no; document.head.append(s); }); }
async function openShare() {
  if (!state || state.mode !== 'multiplayer') return;
  const url = inviteUrl(state.id); $('#share-url').value = url;
  $('#share-native').hidden = !navigator.share; if (!$('#share-dialog').open) $('#share-dialog').showModal();
  try { await loadQr(); const q = window.qrcode(0, 'M'); q.addData(url); q.make(); const img = $('#share-qr'); img.src = q.createDataURL(5, 2); img.hidden = false; } catch {}
}

/* ---------------- Conway foam: the water is a slowly drifting Game of Life ---------------- */
class Life {
  constructor(w, h, d = .16) { this.w = w; this.h = h; this.a = new Uint8Array(w * h); this.b = new Uint8Array(w * h); this.age = new Uint8Array(w * h); for (let i = 0; i < this.a.length; i++) this.a[i] = Math.random() < d ? 1 : 0; }
  step() {
    const {w, h, a, b, age} = this; let alive = 0;
    for (let y = 0; y < h; y++) {
      const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
      for (let x = 0; x < w; x++) {
        const xm = (x - 1 + w) % w, xp = (x + 1) % w, i = y0 + x;
        const n = a[ym + xm] + a[ym + x] + a[ym + xp] + a[y0 + xm] + a[y0 + xp] + a[yp + xm] + a[yp + x] + a[yp + xp];
        const v = n === 3 || (n === 2 && a[i]) ? 1 : 0; b[i] = v; age[i] = v ? (a[i] ? Math.min(age[i] + 1, 9) : 0) : 0; alive += v;
      }
    }
    this.a = b; this.b = a;
    if (alive < w * h * .06) this.speckle(); else if (Math.random() < .3) this.glider();
  }
  speckle() { const x0 = Math.random() * this.w | 0, y0 = Math.random() * this.h | 0; for (let k = 0; k < 40; k++) { const x = (x0 + (Math.random() * 8 | 0)) % this.w, y = (y0 + (Math.random() * 8 | 0)) % this.h; this.a[y * this.w + x] = 1; } }
  glider() { const x0 = Math.random() * this.w | 0, y0 = Math.random() * this.h | 0, fx = Math.random() < .5 ? 1 : -1, fy = Math.random() < .5 ? 1 : -1;
    for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) this.a[((y0 + y * fy + this.h) % this.h) * this.w + (x0 + x * fx + this.w) % this.w] = 1; }
  shiftY(dy) { const {w, h} = this, s = arr => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) o.set(arr.subarray(((y - dy + h) % h) * w, ((y - dy + h) % h) * w + w), y * w); return o; }; this.a = s(this.a); this.age = s(this.age); this.b = new Uint8Array(w * h); }
  shift(dx) { const {w, h} = this, s = arr => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = arr[y * w + (x - dx + w) % w]; return o; }; this.a = s(this.a); this.age = s(this.age); this.b = new Uint8Array(w * h); }
}
const FOAM_CELL = 12;
let foam = null, planeLife = null, lifeGen = 0;
function sizeFoam() {
  if (R3) return;   // the 3D ocean runs its own Game of Life on the water plane
  // The foam canvas lies on a plane tilted away from the camera (CSS perspective), so near cells are big and far
  // cells shrink toward the horizon. It's simulated at low resolution and up-scaled smoothly into soft whitecaps.
  const sea = $('#sea'), cv = $('#foam'), plane = $('#foam-plane'); if (!sea.clientWidth) return;
  const pw = sea.clientWidth * 3, ph = sea.clientHeight * 2.4, cols = Math.ceil(pw / FOAM_CELL), rows = Math.ceil(ph / FOAM_CELL) + 1;
  if (foam && foam.w === cols && foam.h === rows) return;
  plane.style.width = pw + 'px'; plane.style.height = rows * FOAM_CELL + 'px'; plane.style.left = -(pw - sea.clientWidth) / 2 + 'px';
  foam = new Life(cols, rows, .13); cv.width = cols * 4; cv.height = rows * 4; foam.ctx = cv.getContext('2d'); drawFoam();
}
function drawFoam() {
  if (!foam) return; const {w, h, a, age, ctx} = foam;
  ctx.clearRect(0, 0, w * 4, h * 4);
  for (const young of [false, true]) {
    ctx.fillStyle = young ? '#ffffffd0' : '#e6f7ff70';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (a[i] && (age[i] < 2) === young) ctx.fillRect(x * 4 + .5, y * 4 + .5, 3, 3); }
  }
}
// the drifting canvas slides one cell left per CSS iteration; we shift the data to match so the motion is seamless
function foamDrift() { if (foam) { foam.shiftY(1); drawFoam(); } }
function lifeTick() {
  if (document.hidden || settings.reduced) return;
  lifeGen++;
  if (foam) { foam.step(); drawFoam(); }
  if (view === 'home' && state && !R3) drawPlane();   // marching packets on my fleet's links (2D only; 3D avoids re-uploading the texture)
}

/* ---------------- board: geometry ---------------- */
// Three probes at the board's corners give the affine map board→screen (the iso projection is orthographic).
function geo() {
  if (R3) return {sea: $('#sea').getBoundingClientRect()};
  const s = $('#sea').getBoundingClientRect(), p = [...$('#board').querySelectorAll('.probe')].map(e => { const r = e.getBoundingClientRect(); return {x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top}; });
  return {o: p[0], ux: p[1].x - p[0].x, uy: p[1].y - p[0].y, vx: p[2].x - p[0].x, vy: p[2].y - p[0].y, sea: s};
}
function cellPoint(c, g = geo()) { if (R3) return R3.cellScreen(c); const u = ((c % N) + .5) / N, v = (Math.floor(c / N) + .5) / HT; return {x: g.o.x + u * g.ux + v * g.vx, y: g.o.y + u * g.uy + v * g.vy, w: Math.hypot(g.ux, g.uy) / N}; }
function cellFromClient(cx, cy) {
  if (R3) return R3.pick(cx, cy);
  const g = geo(), px = cx - g.sea.left - g.o.x, py = cy - g.sea.top - g.o.y, det = g.ux * g.vy - g.uy * g.vx; if (!det) return -1;
  const u = (px * g.vy - py * g.vx) / det, v = (g.ux * py - g.uy * px) / det;
  return u < 0 || v < 0 || u >= 1 || v >= 1 ? -1 : Math.floor(v * HT) * N + Math.floor(u * N);
}

/* ---------------- board: the plane canvas ---------------- */
const plane = {ctx: null, w: 0, k: 1};
function setSize(n) {
  if (n === SIZE && planeLife) return;
  SIZE = n; [N, HT] = dims(n); sel = -1; const b = $('#board');
  $('.iso').style.setProperty('--n', N); $('.iso').style.setProperty('--ar', HT / N); $('.iso').classList.toggle('sectors', SECT());
  b.style.gridTemplateColumns = `repeat(${N},minmax(0,1fr))`; b.style.gridTemplateRows = `repeat(${HT},minmax(0,1fr))`; b.style.aspectRatio = `${N} / ${HT}`; b.dataset.n = N;
  planeLife = true; clearShips();
  const ax = $('.axis-x'), ay = $('.axis-y'); ax.replaceChildren(); ay.replaceChildren();
  ax.style.gridTemplateColumns = `repeat(${N},1fr)`; ay.style.gridTemplateRows = `repeat(${HT},1fr)`;
  const show = i => N <= 10 || i === 0 || (i + 1) % 5 === 0;
  for (let i = 0; i < N; i++) { const a = document.createElement('span'); a.textContent = show(i) ? colLabel(i) : ''; ax.append(a); }
  for (let i = 0; i < HT; i++) { const r = document.createElement('span'); r.textContent = show(i) ? i + 1 : ''; ay.append(r); }
  kb = -1; hover = -1; plane.w = 0; planeSig = '';
  if (R3) { const cv = plane.cv ||= document.createElement('canvas'), px = Math.min(96, Math.floor(1536 / Math.max(N, HT))); cv.width = N * px; cv.height = HT * px; plane.w = cv.width; plane.k = 1; plane.ctx = cv.getContext('2d'); R3.setBoard(N, HT, cv); layout3D(); drawPlane(); return; }
  sizePlane();
}
function sizePlane() {
  if (R3) return;
  const b = $('#board'), cv = $('#plane'), w = b.clientWidth; if (!w) return;
  const k = Math.min(4, (devicePixelRatio || 1) * Math.max(1, zoom.z) * 1.6, 3200 / w);
  if (Math.abs(w - plane.w) < .5 && Math.abs(k - plane.k) / plane.k < .2) return;
  plane.w = w; plane.k = k; cv.width = Math.round(w * k); cv.height = Math.round(w * HT / N * k); plane.ctx = cv.getContext('2d'); drawPlane();
}
function shotsFor(v) { const src = v === 'home' ? state?.me.shots : state?.opponent?.shots; if (!src) return new Array(CELLS()).fill(0); return src.map((m, c) => hidden[v].has(c) ? 0 : m); }
// 3D: the board canvas is uploaded to the GPU as a texture, so only redraw when something visible changed.
let planeSig = '';
function drawPlane() {
  if (R3) { const sig = [view, state?.id, state?.revision, hidden.home.size, hidden.target.size, hiddenSunk.size, shownSonar, sel, kb, armed, rotN, [...targets], [...locked], area, previewCells?.cells, previewCells?.ok, SECT() ? '' : hover].join('|'); if (sig === planeSig) return; planeSig = sig; }
  drawPlane2(); R3?.boardDirty();
}
function drawPlane2() {
  const c = plane.ctx; if (!c || !N) return;
  const W = plane.w, cs = W / N, k = plane.k, enemy = view === 'target';
  c.setTransform(k, 0, 0, k, 0, 0);
  const WH = W * HT / N;
  c.clearRect(0, 0, W, WH);
  if (R3) { c.fillStyle = enemy ? '#ff9a7c10' : '#7fe3ff12'; c.fillRect(0, 0, W, WH); }   // 3D: a holographic overlay on the real water
  else {
  const water = c.createLinearGradient(0, 0, W, WH);
  if (enemy) { water.addColorStop(0, '#1a6aa3cc'); water.addColorStop(1, '#0d4778cc'); } else { water.addColorStop(0, '#2183c2cc'); water.addColorStop(1, '#0f5a92cc'); }
  c.fillStyle = water; c.fillRect(0, 0, W, WH);
  // a few soft light patches so it reads as water, not a slab
  for (const [u, v, r] of [[.25, .3, .35], [.7, .65, .3], [.6, .15, .2]]) { const g = c.createRadialGradient(u * W, v * WH, 0, u * W, v * WH, r * W); g.addColorStop(0, '#ffffff1c'); g.addColorStop(1, '#ffffff00'); c.fillStyle = g; c.fillRect(0, 0, W, WH); }
  }
  const shots = shotsFor(view);
  // faded addresses on every square: J5 on the sector map, E4 on the classic grids
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = R3 ? '#ffffff5c' : '#ffffff30'; c.font = `700 ${cs * .28}px ui-monospace,Menlo,monospace`;
  for (let i = 0; i < CELLS(); i++) if (!shots[i]) c.fillText(coord(i), (i % N + .5) * cs, (Math.floor(i / N) + .5) * cs);
  // submerged network cables (static per board size)
  c.strokeStyle = '#bff3ff22'; c.fillStyle = c.strokeStyle; c.lineWidth = Math.max(.6, cs * .05); c.beginPath();
  for (const t of traces()) { c.moveTo(t[0][0] * cs, t[0][1] * cs); for (const [x, y] of t.slice(1)) c.lineTo(x * cs, y * cs); }
  c.stroke(); for (const t of traces()) { const [x, y] = t[t.length - 1]; c.beginPath(); c.arc(x * cs, y * cs, cs * .09, 0, 6.283); c.fill(); }
  // marks
  const sonar = new Map(enemy ? (state?.opponent?.sonar || []).slice(0, shownSonar).map(s => [s.cell, s.fuzzy ? 'fuzzy' : s.ship]) : []);
  c.lineCap = 'round';
  for (let i = 0; i < CELLS(); i++) {
    const m = shots[i], x = (i % N) * cs, y = Math.floor(i / N) * cs, cx = x + cs / 2, cy = y + cs / 2;
    if (m === 5) { c.fillStyle = '#dff6ff26'; c.fillRect(x + 1, y + 1, cs - 2, cs - 2); continue; }
    if (m === 4) { c.strokeStyle = '#c9a7ff'; c.lineWidth = cs * .08; c.setLineDash([cs * .12, cs * .08]); c.beginPath(); c.arc(cx, cy, cs * .3, 0, 6.283); c.stroke(); c.setLineDash([]); c.beginPath(); c.moveTo(cx - cs * .15, cy - cs * .15); c.lineTo(cx + cs * .15, cy + cs * .15); c.moveTo(cx + cs * .15, cy - cs * .15); c.lineTo(cx - cs * .15, cy + cs * .15); c.stroke(); continue; }
    if (m === 1) { c.strokeStyle = '#dff6ffcc'; c.lineWidth = cs * .07; c.beginPath(); c.arc(cx, cy, cs * .24, 0, 6.283); c.stroke(); c.fillStyle = '#dff6ff'; c.beginPath(); c.arc(cx, cy, cs * .07, 0, 6.283); c.fill(); }
    else if (m === 2 || m === 3) {
      c.fillStyle = m === 2 ? '#ff5a2ebb' : '#4a0f0fdd'; c.fillRect(x + cs * .06, y + cs * .06, cs * .88, cs * .88);
      c.strokeStyle = m === 2 ? '#ffd34d' : '#ff754f'; c.lineWidth = cs * .12; c.beginPath(); c.moveTo(x + cs * .28, y + cs * .28); c.lineTo(x + cs * .72, y + cs * .72); c.moveTo(x + cs * .72, y + cs * .28); c.lineTo(x + cs * .28, y + cs * .72); c.stroke();
    } else if (sonar.has(i)) {
      if (sonar.get(i) === 'fuzzy') { c.strokeStyle = '#ffd34dbb'; c.lineWidth = cs * .06; c.setLineDash([cs * .08, cs * .08]); c.strokeRect(x + cs * .18, y + cs * .18, cs * .64, cs * .64); c.setLineDash([]); c.fillStyle = '#ffd34d'; c.font = `900 ${cs * .5}px ui-monospace,monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', cx, cy + cs * .03); }
      else if (sonar.get(i)) { c.fillStyle = '#23e4d055'; c.fillRect(x + cs * .06, y + cs * .06, cs * .88, cs * .88); c.fillStyle = '#23e4d0'; c.beginPath(); c.arc(cx, cy, cs * .16, 0, 6.283); c.fill(); }
      else { c.strokeStyle = '#7fe3ff99'; c.lineWidth = cs * .05; c.setLineDash([cs * .1, cs * .1]); c.beginPath(); c.arc(cx, cy, cs * .2, 0, 6.283); c.stroke(); c.setLineDash([]); }
    }
  }
  // schematic grid: thin lines, every 5th brighter (a network diagram, not a painted sea)
  const line = '230,248,255';
  const major = SECT() ? 3 : 5;
  c.lineWidth = Math.max(.5, cs * .025); c.strokeStyle = `rgba(${line},.17)`; c.beginPath();
  for (let i = 0; i <= N; i++) if (i % major) { c.moveTo(i * cs, 0); c.lineTo(i * cs, WH); }
  for (let i = 0; i <= HT; i++) if (i % major) { c.moveTo(0, i * cs); c.lineTo(W, i * cs); }
  c.stroke(); c.lineWidth = Math.max(.8, cs * (SECT() ? .06 : .05)); c.strokeStyle = `rgba(${line},${SECT() ? .5 : .36})`; c.beginPath();
  for (let i = 0; i <= N; i += major) { c.moveTo(i * cs, 0); c.lineTo(i * cs, WH); }
  for (let i = 0; i <= HT; i += major) { c.moveTo(0, i * cs); c.lineTo(W, i * cs); }
  c.stroke();
  if (SECT()) {   // big faded sector letters, subtle selection glow
    c.font = `900 ${cs * 1.9}px ui-monospace,Menlo,monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let si = 0; si < NSEC(); si++) { const x = (si % SC() + .5) * cs * 3, y = (Math.floor(si / SC()) + .5) * cs * 3; c.fillStyle = si === sel && enemy ? '#ffffff55' : R3 ? '#ffffff30' : '#ffffff14'; c.fillText(LETTERS[si], x, y + cs * .1); }
    const hs = hover >= 0 && enemy && myTurn() && !animating && lastPointer !== 'mouse' ? secOf(hover) : -1;
    for (const [si, fill, stroke] of [[hs, '#ffffff0c', '#ffffff40'], [enemy ? sel : -1, '#ffffff18', '#ffffffb0']]) if (si >= 0) {
      const x = (si % SC()) * cs * 3, y = Math.floor(si / SC()) * cs * 3; c.fillStyle = fill; c.fillRect(x, y, cs * 3, cs * 3); c.strokeStyle = stroke; c.lineWidth = cs * .06; c.strokeRect(x + cs * .03, y + cs * .03, cs * 2.94, cs * 2.94); }
  }
  // my own decoys (only I can see them) and my fleet's network: every live creature linked to the docker host
  if (!enemy && state) {
    for (const d of state.me.decoys || []) if (!shots[d]) { const x = (d % N + .5) * cs, y = (Math.floor(d / N) + .5) * cs; c.strokeStyle = '#c9a7ffaa'; c.lineWidth = cs * .06; c.setLineDash([cs * .1, cs * .1]); c.beginPath(); c.arc(x, y, cs * .32, 0, 6.283); c.stroke(); c.setLineDash([]); c.fillStyle = '#c9a7ff'; c.font = `900 ${cs * .42}px ${'ui-monospace,monospace'}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('☠', x, y); }
    const home = shots, ctr = sh => { const xs = sh.cells.map(q => q % N), ys = sh.cells.map(q => Math.floor(q / N)); return [(Math.min(...xs) + Math.max(...xs) + 1) / 2 * cs, (Math.min(...ys) + Math.max(...ys) + 1) / 2 * cs]; };
    const up = sh => sh.cells.some(q => (home[q] || 0) < 2), ships = state.me.ships, hub = ships.find(sh => F(sh.id).kind === 0 && up(sh)) || ships.find(up);
    if (hub) { const [hx, hy] = ctr(hub);
      for (const sh of ships) { if (sh === hub) continue; const [x, y] = ctr(sh), alive = up(sh);
        c.strokeStyle = alive ? '#7fe3ff88' : '#ff754f66'; c.lineWidth = cs * (alive ? .07 : .05); c.setLineDash(alive ? [cs * .25, cs * .2] : [cs * .08, cs * .2]); c.lineDashOffset = alive ? -lifeGen * cs * .15 : 0;
        c.beginPath(); c.moveTo(hx, hy); c.lineTo(x, hy); c.lineTo(x, y); c.stroke(); }
      c.setLineDash([]); c.lineDashOffset = 0; c.fillStyle = '#23e4d0'; c.beginPath(); c.arc(hx, hy, cs * .18, 0, 6.283); c.fill(); }
  }
  // overlays: targeting crosshair, salvo targets, power area, placement preview, keyboard cursor
  const box = (i, fill, stroke, lw = .08) => { const x = (i % N) * cs, y = Math.floor(i / N) * cs; if (fill) { c.fillStyle = fill; c.fillRect(x + 1, y + 1, cs - 2, cs - 2); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = cs * lw; c.strokeRect(x + cs * .08, y + cs * .08, cs * .84, cs * .84); } };
  if (enemy && myTurn() && !animating && hover >= 0 && !armed && !shots[hover] && !SECT()) {
    const hx = (hover % N + .5) * cs, hy = (Math.floor(hover / N) + .5) * cs;
    c.strokeStyle = '#ffd34d55'; c.lineWidth = Math.max(.6, cs * .04); c.beginPath(); c.moveTo(hx, 0); c.lineTo(hx, WH); c.moveTo(0, hy); c.lineTo(W, hy); c.stroke();
    box(hover, '#ffd34d40', '#ffd34d');
  }
  for (const i of locked) box(i, '#ffd34d99', null);
  for (const i of area) box(i, '#7fe3ff55', '#bff3ff', .05);
  if (enemy) [...targets].forEach((i, n) => { box(i, '#ffd34dcc', '#fff2b0'); const x = (i % N + .5) * cs, y = (Math.floor(i / N) + .5) * cs; c.fillStyle = '#04121c'; c.font = `900 ${cs * .55}px ui-monospace,monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n + 1), x, y + cs * .03); });
  if (previewCells) for (const i of previewCells.cells) if (i < CELLS()) box(i, previewCells.ok ? '#a2f33d99' : '#ff754faa', null);
  if (kb >= 0 && document.activeElement === $('#board')) { c.setLineDash([cs * .15, cs * .1]); box(kb, null, '#ffffff', .07); c.setLineDash([]); }
}

// deterministic pseudo-random PCB traces along grid lines, regenerated per board size
let traceCache = null;
function traces() {
  if (traceCache?.key === `${N}x${HT}`) return traceCache.t;
  let seed = N * 131 + HT; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, out = [];
  for (let k = 0; k < Math.round(N * HT / 14); k++) {
    let x = Math.floor(rnd() * (N + 1)), y = Math.floor(rnd() * (HT + 1)); const pts = [[x, y]];
    for (let seg = 0; seg < 2 + Math.floor(rnd() * 3); seg++) { const len = 1 + Math.floor(rnd() * 3); if (seg % 2 === 0) x = Math.max(0, Math.min(N, x + (rnd() < .5 ? -len : len))); else y = Math.max(0, Math.min(HT, y + (rnd() < .5 ? -len : len))); pts.push([x, y]); }
    out.push(pts);
  }
  traceCache = {key: `${N}x${HT}`, t: out}; return out;
}
/* ---------------- board: creatures (standing SVG cards) ---------------- */
const shipCache = new Map();   // key → signature, so a card is only touched when something about it changed
function clearShips() { shipCache.clear(); $('#board').querySelectorAll('.ship').forEach(e => e.remove()); }
function render3D(shots) {
  const items = [];
  if (state) {
    const list = view === 'home' ? state.me.ships.map(s => ({...s, own: true})) : (state.opponent?.sunk || []).filter(s => !hiddenSunk.has(s.id)).map(s => ({...s, own: false, sunk: true}));
    for (const s of list) {
      const cells = [...s.cells].sort((a, b) => a - b), f = F(s.id), hits = cells.map((c, j) => (shots[c] || 0) >= 2 ? j : -1).filter(j => j >= 0);
      const mf = (s.own ? state.me.manifest : state.opponent?.manifest)?.[s.id] || [];
      items.push({key: `${view}:${s.id}`, kind: f.kind % 5, len: cells.length, cells, vertical: isVertical(cells), hits, sunk: !!s.sunk || hits.length === cells.length, fresh: freshSink.has(s.id), seed: s.id, labels: mf.map(x => `${x.image}|${x.name}`)});
    }
    (state.firewalls || []).forEach((cell, i) => items.push({key: `berg:${cell}`, kind: 'berg', len: 1, cells: [cell], seed: i + 1}));
  }
  R3.syncCreatures(items);
}
function renderShips(shots) {
  if (R3) return render3D(shots);
  const b = $('#board');
  let ships = [];
  if (state) ships = view === 'home' ? state.me.ships.map(s => ({...s, own: true})) : (state.opponent?.sunk || []).filter(s => !hiddenSunk.has(s.id)).map(s => ({...s, own: false, sunk: true}));
  const live = new Set();
  for (const s of ships) {
    const key = `${view}:${s.id}`; live.add(key);
    const cells = [...s.cells].sort((a, b) => a - b), v = isVertical(cells), len = cells.length, f = F(s.id);
    const hitIdx = cells.map((c, j) => (shots[c] || 0) >= 2 ? j : -1).filter(j => j >= 0);
    const sunk = !!s.sunk || hitIdx.length === len, isHeld = held === s.id && deploying();
    const sig = `${cells.join(',')}|${hitIdx.join(',')}|${sunk}|${isHeld}|${freshSink.has(s.id)}`;
    let el = b.querySelector(`.ship[data-key="${key}"]`);
    const prev = shipCache.get(key);
    if (el && prev === sig) continue;
    shipCache.set(key, sig);
    if (!el || !prev || prev.split('|')[0] !== sig.split('|')[0]) {
      el?.remove(); el = document.createElement('div'); el.dataset.key = key;
      el.innerHTML = `<div class="wake"></div><div class="bb"><div class="spr">${creatureSVG(f.kind, len, s.id)}</div></div><div class="tag"><span></span></div>`;
      b.append(el);
    }
    const x = cells[0] % N, y = Math.floor(cells[0] / N);
    el.className = `ship k${f.kind % 5} ${v ? 'vertical' : 'horizontal'} ${s.own ? 'own' : 'enemy'}${sunk ? ' sunk' : ''}${isHeld ? ' held' : ''}${freshSink.has(s.id) ? ' sinking' : ''}`;
    el.style.gridArea = `${y + 1} / ${x + 1} / span ${v ? len : 1} / span ${v ? 1 : len}`;
    el.style.setProperty('--len', len); el.style.setProperty('--i', s.id % 7);
    el.style.setProperty('--list', `${sunk ? 0 : Math.min(14, hitIdx.length / len * 20)}deg`);
    // containers blow off the creature over the segments that were hit
    const gone = new Set(hitIdx.map(j => slotFor(f.kind % 5, len, j)));
    el.querySelectorAll('.box').forEach(bx => { if ((sunk || gone.has(Number(bx.dataset.slot))) && !bx.classList.contains('gone')) { bx.classList.add('gone'); if (prev) bx.classList.add('blow'); } });
    el.querySelector('.tag span').textContent = sunk ? `NodeNotReady · ${f.name}` : s.own && state.me.drained === Object.keys(ROLE_FX)[f.kind % 5] ? `⛔ ${f.name} cordoned` : '';
  }
  for (const [i, cell] of (state?.firewalls || []).entries()) {
    const key = `berg:${cell}`; live.add(key); if (b.querySelector(`.ship[data-key="${key}"]`)) continue;
    const el = document.createElement('div'); el.dataset.key = key; el.className = 'ship berg horizontal'; el.title = 'Firewall iceberg — packets bounce off. A penguin admin lives here.';
    el.style.gridArea = `${Math.floor(cell / N) + 1} / ${cell % N + 1}`; el.style.setProperty('--len', 1); el.style.setProperty('--i', i);
    el.innerHTML = `<div class="bb"><div class="spr">${bergSVG(i)}</div></div>`; b.append(el);
  }
  b.querySelectorAll('.ship').forEach(e => { if (!live.has(e.dataset.key)) { e.remove(); shipCache.delete(e.dataset.key); } });
}
function renderBoard() {
  const b = $('#board'); b.dataset.view = view;
  b.classList.toggle('my-turn', myTurn() && !animating && view === 'target');
  b.classList.toggle('placing', deploying() && !state.me.ready && view === 'home');
  b.classList.toggle('armed', !!armed);
  renderShips(shotsFor(view)); drawPlane();
  const home = shotsFor('home'), afloat = state ? state.me.ships.reduce((n, s) => n + s.cells.filter(c => (home[c] || 0) < 2).length, 0) : TOTAL();
  const L = $('#board-label'); L.dataset.view = view;
  L.textContent = view === 'target' ? `🎯 ENEMY CLUSTER — k8s.production · ${state ? oppName() : 'unknown'}` : `⚓ YOUR CLUSTER — docker.local · ${afloat}/${TOTAL()} pods running`;
  b.setAttribute('aria-label', `${view === 'target' ? 'Enemy waters' : 'My fleet'}${kb >= 0 ? ', cursor ' + coord(kb) : ''}. Arrow keys move, Enter acts.`);
}

/* ---------------- board: input ---------------- */
function buildBoardEvents() {
  const b = R3 ? R3.canvas : $('#board');
  b.addEventListener('pointerdown', e => { lastPointer = e.pointerType; }, {capture: true});
  b.addEventListener('click', e => { if (suppressClick) { suppressClick = false; return; }
    if (R3 && state && view === 'home' && !armed && !(deploying() && !state.me.ready)) { const pc = R3.pickContainer(e.clientX, e.clientY); if (pc) { inspect(pc); return; } }
    const c = cellFromClient(e.clientX, e.clientY); if (c >= 0) tileTap(c); });
  b.addEventListener('keydown', e => {
    if (!N) return; if (kb < 0) kb = Math.floor(HT / 2) * N + Math.floor(N / 2);
    const x = kb % N, y = Math.floor(kb / N); let n = kb;
    if (e.key === 'ArrowRight') n = y * N + Math.min(N - 1, x + 1); else if (e.key === 'ArrowLeft') n = y * N + Math.max(0, x - 1);
    else if (e.key === 'ArrowDown') n = Math.min(HT - 1, y + 1) * N + x; else if (e.key === 'ArrowUp') n = Math.max(0, y - 1) * N + x;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tileTap(kb); return; } else return;
    e.preventDefault(); kb = n; preview(n); renderBoard();
  });
  b.addEventListener('focus', () => { if (kb < 0 && N) kb = Math.floor(HT / 2) * N + Math.floor(N / 2); drawPlane(); });
  b.addEventListener('blur', () => drawPlane());
  b.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' || drag) return; const c = cellFromClient(e.clientX, e.clientY); if (c !== hover) preview(c); });
  b.addEventListener('pointerleave', () => { hover = -1; area = []; drawPlane(); });
  b.addEventListener('pointerdown', e => {
    if (!deploying() || state.me.ready || view !== 'home') return;
    const c = cellFromClient(e.clientX, e.clientY); if (c < 0) return;
    const s = state.me.ships.find(s => s.cells.includes(c)); if (!s) return;
    const sorted = [...s.cells].sort((a, b) => a - b);
    drag = {id: s.id, offset: sorted.indexOf(c), v: isVertical(s.cells), start: c, moved: false, anchor: sorted[0]};
    try { b.setPointerCapture(e.pointerId); } catch {}
  });
  b.addEventListener('pointermove', e => {
    if (!drag) return; const c = cellFromClient(e.clientX, e.clientY); if (c < 0) return;
    if (c !== drag.start) drag.moved = true; if (!drag.moved) return;
    drag.anchor = anchorFrom(c, drag.offset, drag.id, drag.v); previewAt(drag.anchor, drag.id, drag.v);
  });
  b.addEventListener('pointerup', () => { if (!drag) return; const d = drag; drag = null; clearPreview(); if (d.moved) { suppressClick = true; setTimeout(() => suppressClick = false, 60); if (place(d.id, d.anchor, d.v)) held = null; } });
  b.addEventListener('pointercancel', () => { drag = null; clearPreview(); });
}
function anchorFrom(c, offset, id, v) {
  const len = LEN(id); let x = c % N, y = Math.floor(c / N);
  if (v) y -= offset; else x -= offset;
  x = Math.max(0, Math.min(v ? N - 1 : N - len, x)); y = Math.max(0, Math.min(v ? HT - len : HT - 1, y));
  return y * N + x;
}
const footprint = (a, id, v) => Array.from({length: LEN(id)}, (_, i) => a + (v ? N * i : i));
function legal(a, id, v) { const x = a % N, y = Math.floor(a / N); if ((v ? y : x) + LEN(id) > (v ? HT : N)) return false; const occ = new Set(state.me.ships.filter(s => s.id !== id).flatMap(s => s.cells)); return footprint(a, id, v).every(c => c < CELLS() && !occ.has(c)); }
function previewAt(a, id, v) { previewCells = {cells: footprint(a, id, v), ok: legal(a, id, v)}; drawPlane(); }
function clearPreview() { if (previewCells) { previewCells = null; drawPlane(); } }
function place(id, a, v) {
  if (!legal(a, id, v)) { toast('No room there — creatures can’t overlap or leave the grid.'); audio.sound('error'); bump('#board-wrap'); return false; }
  audio.sound('place'); act('PLACE_SHIP', {ship: id, x: a % N, y: Math.floor(a / N), vertical: v}); return true;
}
function rotateShip(id) {
  const s = state.me.ships.find(s => s.id === id); if (!s) return;
  const v = !isVertical(s.cells), a0 = Math.min(...s.cells);
  for (const a of [a0, anchorFrom(a0, 0, id, v)]) if (legal(a, id, v)) { place(id, a, v); return; }
  toast('No room to rotate here — drag it somewhere roomier.'); audio.sound('error');
}
function areaOf(cell, power, r = rotN) {
  const x = cell % N, y = Math.floor(cell / N), out = [], P = PI(power);
  if (P.pattern && P.pattern !== 'line') return PATTERNS[P.pattern].map(o => rotOff(o, P.rot ? r : 0)).map(([dx, dy]) => [x + dx, y + dy]).filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < N && cy < HT).map(([cx, cy]) => cy * N + cx);
  if (P.area === 'line') for (let d = -2; d <= 2; d++) { const cx = tailVertical ? x : x + d, cy = tailVertical ? y + d : y; if (cx >= 0 && cy >= 0 && cx < N && cy < HT) out.push(cy * N + cx); }
  else for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const cx = x + dx, cy = y + dy; if (cx >= 0 && cy >= 0 && cx < N && cy < HT) out.push(cy * N + cx); }
  return out;
}
function preview(c) {
  const hadArea = area.length; hover = c; area = armed && view === (PI(armed).own ? 'home' : 'target') && myTurn() && c >= 0 ? areaOf(SECT() && (armed === 'scan' || armed === 'sonar') ? cellOf(secOf(c), 5) : c, armed) : [];
  if (R3) { R3.setHover(!armed && c >= 0 && ((view === 'target' && myTurn()) || deploying()) ? c : -1); if (area.length || hadArea) drawPlane(); return; }
  drawPlane();
}
// Fit the board into the free part of the screen (left of the side console on desktop, above the console on phones).
function layout3D() {
  if (!R3) return; const side = matchMedia('(min-width:900px) and (min-aspect-ratio:1/1)').matches, dock = $('#dock');
  R3.setInsets({top: 74, left: 0, right: side ? dock.offsetWidth + 24 : 0, bottom: side ? 10 : dock.offsetHeight + 4});
}

/* ---------------- taps ---------------- */
function tileTap(c) {
  if (animating || sliding) return;
  if (!state) { if (connected && !pending) newGame($('#difficulty').value); return; }
  if (c < 0) return;
  if (deploying() && !state.me.ready) {
    if (view !== 'home') { slideTo('home'); return; }
    const s = state.me.ships.find(s => s.cells.includes(c));
    if (s) { if (held === s.id) rotateShip(s.id); else { held = s.id; audio.sound('select'); render(); } return; }
    const missing = FLEET.map(f => f.id).find(id => !state.me.ships.some(s => s.id === id));
    const id = held ?? missing;
    if (id == null) { toast('Tap a creature to pick it up, then tap water to drop it. Tap it again to rotate.'); bump('#hint'); return; }
    const cur = state.me.ships.find(s => s.id === id), v = cur ? isVertical(cur.cells) : false;
    if (place(id, anchorFrom(c, 0, id, v), v)) held = null;
    return;
  }
  if (state.phase !== 'playing') return;
  if (armed && PI(armed).own) { if (view !== 'home') { slideTo('home'); return; } if (!myTurn()) return; aimAt(c); return; }
  if (view === 'home') { slideTo('target'); return; }
  if (!myTurn()) { toast(`${oppName()} is aiming — hang tight.`); bump('#turn'); return; }
  // Tap/click aims at the exact square (pinch or drag to zoom and pan); typing a sector then 1–9 is the keyboard route.
  sel = -1; aimAt(c);
}
function selectSector(si) {
  if (si < 0 || si >= NSEC()) return;
  sel = si; audio.sound('select'); render();
}
// Input state machine: AwaitingSector (sel < 0) → AwaitingSubsector (sel ≥ 0) → commit → AwaitingSector.
function keypad(k) {
  if (!SECT() || !myTurn() || animating || sliding) return;
  if (sel < 0) { toast('Pick a sector first — its letter, or tap the map.'); bump('#hint'); return; }
  const c = cellOf(sel, k), m = state.opponent?.shots[c] || 0;
  if (!armed && m) { toast(`${coord(c)} is ${m === 5 ? 'a firewall iceberg' : 'already probed'} — pick another number.`); audio.sound('error'); bump('#keypad'); return; }
  if (view !== 'target' && !(armed && PI(armed).own)) slideTo('target');
  sel = -1; aimAt(c);
}
function backspace() {
  if (sel >= 0) { sel = -1; audio.sound('select'); render(); return; }
  const last = [...targets].pop(); if (last != null) { targets.delete(last); audio.sound('select'); log(`unarm ${coord(last)}`, 'event'); render(); }
}
function aimAt(c) {
  if (SECT() && (armed === 'sonar' || armed === 'scan')) c = cellOf(secOf(c), 5);   // a port scan covers exactly one sector
  if (armed) {
    const p = armed, P = PI(p), own = !!P.own, r = P.rot ? rotN : 0; armed = null; area = [];
    prompt(`${P.cmd} ${p === 'tail' && !state.rules ? `--${tailVertical ? 'col' : 'row'} ` : ''}${P.rot ? `--rotate=${r * 90} ` : ''}${ip(c, !own)}${P.pattern === 'square' && SECT() ? ` # sector ${LETTERS[secOf(c)]}` : `  # ${coord(c)}`}`);
    act('POWER', {power: p, cell: c, vertical: tailVertical, rot: r});
    if (p === 'dns') { log(`${ts()} decoy A-record planted at ${coord(c)} → shows up on their scans`, 'hit'); if (!settings.reduced) fxText(cellPoint(c), '☠ DECOY', '#c9a7ff', 16); audio.sound('select'); }
    return;
  }
  if (state.opponent?.shots[c] === 5) { toast(`${coord(c)} is a firewall iceberg — packets bounce off. 🐧☕`); audio.sound('error'); return; }
  if (state.opponent?.shots[c]) { toast(`${coord(c)} is already probed. Pick fresh water.`); audio.sound('error'); return; }
  if (targets.has(c)) { targets.delete(c); audio.sound('select'); render(); return; }
  const open = state.opponent.shots.filter(v => v === 0).length, need = Math.min(salvo(), open);
  if (settings.confirm && salvo() === 1) { targets.clear(); targets.add(c); audio.sound('select'); render(); return; }
  if (SECT() && targets.size >= need) { toast(`Queue full (${need}) — ENTER / TRANSMIT to send, ⌫ to drop the last one.`); audio.sound('error'); bump('#cta-fire'); return; }
  targets.add(c); audio.sound('packet');
  if (SECT()) log(`armed ${coord(c)}  ${ip(c, true)}  ● READY  (${targets.size}/${need})`, 'event');
  if (targets.size >= need && !SECT()) { fireVolley(); return; }
  render();
}
function fireVolley() {
  if (!myTurn() || !targets.size) return;
  const cells = [...targets]; targets.clear(); sel = -1;
  prompt(`ping -c1 ${cells.map(c => lc(c)).join(' ')}`);
  act('FIRE', {cells}); cells.forEach(c => locked.add(c)); drawPlane(); setTimeout(() => { cells.forEach(c => locked.delete(c)); drawPlane(); }, 1500);
}

/* ---------------- zoom + pan: starts with ~80% of the board on screen; drag to look around ---------------- */
const baseZoom = () => SIZE === 36 ? (R3 ? (touchLayout() ? 1.45 : 1.06) : 1.15) : SIZE >= 30 ? (coarse() ? 1.6 : 1.3) : SIZE >= 20 ? 1.25 : SIZE === 15 ? (R3 ? 1.12 : 1.3) : 1;   // zoomed in: the ocean feels vast, drag to look around
let planeResize = 0;
function applyZoom(glide = false) {
  const w = $('#zoom'); if (!w) return;
  const sea = $('#sea').getBoundingClientRect(), lim = (zoom.z - 1) * 0.55 + .02;
  zoom.x = Math.max(-sea.width * lim, Math.min(sea.width * lim, zoom.x)); zoom.y = Math.max(-sea.height * lim, Math.min(sea.height * lim, zoom.y));
  if (R3) { R3.setZoomPan(zoom.z, zoom.x, zoom.y, glide); $('#zoom-out').disabled = zoom.z <= 1; return; }
  w.classList.toggle('glide', glide);
  w.style.transform = `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.z})`;
  $('#zoom-out').disabled = zoom.z <= 1; document.body.classList.toggle('zoomed', zoom.z > 1);
  clearTimeout(planeResize); planeResize = setTimeout(sizePlane, 200);
}
function setZoom(z, cx = 0, cy = 0, glide = false) { const nz = Math.max(1, Math.min(4, z)), k = nz / zoom.z; zoom.x = cx - (cx - zoom.x) * k; zoom.y = cy - (cy - zoom.y) * k; zoom.z = nz; applyZoom(glide); }
function autoZoom() { zoom = {z: baseZoom(), x: 0, y: 0}; applyZoom(true); }
// Keep the action on screen: glide the camera so these cells sit inside the visible sea.
async function ensureVisible(cells) {
  if (!cells.length || zoom.z <= 1) return;
  const g = geo(), pts = cells.map(c => cellPoint(c, g)), sea = g.sea, hud = $('#dock').offsetHeight;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const left = 50, right = sea.width - 50, top = 90, bottom = sea.height - hud - 20;
  const dx = cx < left ? left - cx : cx > right ? right - cx : 0, dy = cy < top ? top - cy : cy > bottom ? bottom - cy : 0;
  if (!dx && !dy) return;
  zoom.x += dx; zoom.y += dy; applyZoom(true); await sleep(settings.fast ? 160 : 320);
}
function zoomGestures() {
  const sea = $('#sea'), pts = new Map(); let pinch = null, pan = null;
  const center = () => { const r = sea.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; };
  sea.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a, select, .views')) return;
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pts.size === 2) { const [a, b] = [...pts.values()], c = center(); pinch = {d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom.z, mx: (a.x + b.x) / 2 - c.x, my: (a.y + b.y) / 2 - c.y, x: zoom.x, y: zoom.y}; pan = null; drag = null; clearPreview(); }
    else if (pts.size === 1) pan = {x: e.clientX, y: e.clientY, ox: zoom.x, oy: zoom.y, moved: false};
  });
  sea.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()], c = center(), d = Math.hypot(a.x - b.x, a.y - b.y); const nz = Math.max(1, Math.min(4, pinch.z * d / pinch.d)), k = nz / pinch.z; zoom.z = nz; zoom.x = ((a.x + b.x) / 2 - c.x) - (pinch.mx - pinch.x) * k; zoom.y = ((a.y + b.y) / 2 - c.y) - (pinch.my - pinch.y) * k; applyZoom(); suppressClick = true; }
    else if (pan && !drag && zoom.z > 1) { const dx = e.clientX - pan.x, dy = e.clientY - pan.y; if (!pan.moved && Math.hypot(dx, dy) > 9) pan.moved = true; if (pan.moved) { zoom.x = pan.ox + dx; zoom.y = pan.oy + dy; applyZoom(); suppressClick = true; } }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { if (pan?.moved || suppressClick) setTimeout(() => suppressClick = false, 60); pan = null; } };
  sea.addEventListener('pointerup', up); sea.addEventListener('pointercancel', up);
  sea.addEventListener('wheel', e => { if (!state) return; e.preventDefault(); const c = center(); setZoom(zoom.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - c.x, e.clientY - c.y); }, {passive: false});
  $('#zoom-in').onclick = () => setZoom(zoom.z * 1.3, 0, 0, true); $('#zoom-out').onclick = () => setZoom(zoom.z / 1.3, 0, 0, true);
}

/* ---------------- slide between oceans ---------------- */
async function slideTo(v, dir) {
  if (v === view) { render(); return; }
  dir = dir || (v === 'target' ? 'left' : 'right');
  const w = R3 ? R3.canvas : $('#board-wrap');
  if (settings.reduced || document.hidden || sliding) { view = v; render(); return; }
  sliding = true; const ms = settings.fast ? 170 : 300, out = dir === 'left' ? -1 : 1;
  await w.animate([{transform: 'none', opacity: 1}, {transform: `translateX(${out * 115}%)`, opacity: .2}], {duration: ms, easing: 'cubic-bezier(.55,0,.9,.45)', fill: 'forwards'}).finished.catch(() => {});
  view = v; render();
  await w.animate([{transform: `translateX(${-out * 115}%)`, opacity: .2}, {transform: 'none', opacity: 1}], {duration: ms + 60, easing: 'cubic-bezier(.15,.7,.3,1.1)', fill: 'forwards'}).finished.catch(() => {});
  w.getAnimations().forEach(a => a.cancel());
  sliding = false; render();
}

/* ---------------- effects: one canvas, one rAF loop that sleeps when idle ---------------- */
const FX = {ctx: null, w: 0, h: 0, items: [], raf: 0, dpr: 1};
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif', MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
function sizeFx() { const s = $('#sea'), cv = $('#fx'); FX.w = s.clientWidth; FX.h = s.clientHeight; FX.dpr = Math.min(3, devicePixelRatio || 1); cv.width = FX.w * FX.dpr; cv.height = FX.h * FX.dpr; FX.ctx = cv.getContext('2d'); }
function fxAdd(item, delay = 0) { item.t0 = performance.now() + delay; FX.items.push(item); if (!FX.raf) FX.raf = requestAnimationFrame(fxFrame); return item; }
function fxFrame(now) {
  const c = FX.ctx; c.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0); c.clearRect(0, 0, FX.w, FX.h);
  FX.items = FX.items.filter(it => {
    if (it.kill) { it.done?.(); return false; }
    const p = (now - it.t0) / it.dur; if (p < 0) return true;
    if (p >= 1) { it.done?.(); return false; }
    c.save(); it.draw(c, p, now); c.restore(); return true;
  });
  FX.raf = FX.items.length ? requestAnimationFrame(fxFrame) : 0;
  if (!FX.raf) c.clearRect(0, 0, FX.w, FX.h);
}
const bez = (s, C, e, t) => ({x: (1 - t) ** 2 * s.x + 2 * (1 - t) * t * C.x + t * t * e.x, y: (1 - t) ** 2 * s.y + 2 * (1 - t) * t * C.y + t * t * e.y});
function curve(c, s, C, e, t1, color, width, alpha = 1, dash = null, off = 0) {
  c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.setLineDash(dash || []); c.lineDashOffset = off;
  c.beginPath(); c.moveTo(s.x, s.y); const n = Math.max(2, Math.ceil(30 * t1)); for (let i = 1; i <= n; i++) { const p = bez(s, C, e, t1 * i / n); c.lineTo(p.x, p.y); } c.stroke(); c.setLineDash([]);
}
function node(c, p, color, label, alpha = 1) {
  c.globalAlpha = alpha; c.fillStyle = '#04121c'; c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, 5, 0, 6.283); c.fill(); c.stroke();
  if (label) { c.font = `700 11px ${MONO}`; c.textAlign = 'left'; c.textBaseline = 'middle'; const w = c.measureText(label).width + 8; c.fillStyle = '#04121cdd'; c.fillRect(p.x + 8, p.y - 8, w, 16); c.strokeStyle = color; c.lineWidth = 1; c.strokeRect(p.x + 8, p.y - 8, w, 16); c.fillStyle = color; c.fillText(label, p.x + 12, p.y); }
}
function glyph(c, g, x, y, size, rot = 0, alpha = 1) { c.globalAlpha = alpha; c.translate(x, y); c.rotate(rot); c.font = `${size}px ${EMOJI}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(g, 0, 0); c.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0); }
// A launch is drawn as a topology link: source node → packet along a ballistic arc → target node with its address.
function fly(start, end, T, opt = {}) {
  const color = opt.color || '#23e4d0', g0 = opt.glyph || '🚀', size = Math.max(24, Math.min(44, Math.min(FX.w, FX.h) * .07));
  const C = {x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - Math.max(100, FX.h * .42)};
  return new Promise(resolve => fxAdd({dur: T, draw(c, p, now) {
    const t = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, pt = bez(start, C, end, t), q = bez(start, C, end, Math.min(1, t + .01));
    curve(c, start, C, end, 1, color, 1.2, .25, [3, 6], -now / 40);                          // planned route
    curve(c, start, C, end, t, color, 6, .18); curve(c, start, C, end, t, color, 2.2, .95);    // travelled link (glow + core)
    node(c, start, color, opt.from); node(c, end, color, opt.to, .5 + .5 * Math.sin(now / 90) ** 2);
    if (opt.hops) for (let h = 1; h <= 5; h++) { if (t < h / 6) break; const hp = bez(start, C, end, h / 6); c.globalAlpha = 1; c.fillStyle = color; c.font = `700 10px ${MONO}`; c.textAlign = 'center'; c.fillText(`ttl=${h}`, hp.x, hp.y - 10); c.beginPath(); c.arc(hp.x, hp.y, 3, 0, 6.283); c.fill(); }
    const rot = g0 === '🚀' ? Math.atan2(q.y - pt.y, q.x - pt.x) + Math.PI / 4 : g0 === '📨' ? Math.atan2(q.y - pt.y, q.x - pt.x) * .25 : now / 120;
    glyph(c, g0, pt.x, pt.y, size * (1 + .5 * Math.sin(Math.PI * t)), rot);
  }, done() { resolve(); fxAdd({dur: 2200, draw(c, p, now) { curve(c, start, C, end, 1, color, 2, (1 - p) * .7, [6, 6], -now / 25); node(c, end, color, opt.to, 1 - p); }}); }}));
}
function fxBurst(p, g, size, dur = 700, delay = 0) { fxAdd({dur, draw(c, q) { const s = q < .5 ? .3 + 2 * q : 1.3; glyph(c, g, p.x, p.y - size * .15, size * s, 0, q < .55 ? 1 : 1 - (q - .55) / .45); }}, delay); }
function fxRing(p, r0, r1, color, dur = 700, delay = 0, width = 3) { fxAdd({dur, draw(c, q) { const r = r0 + (r1 - r0) * q; c.globalAlpha = 1 - q; c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.ellipse(p.x, p.y, r, r * .62, 0, 0, 6.283); c.stroke(); }}, delay); }
function fxSparks(p, n, colors, spread = 90, dur = 700) {
  const parts = Array.from({length: n}, () => ({a: Math.random() * 6.283, r: spread * (.35 + Math.random() * .65), s: 3 + Math.random() * 4, col: colors[Math.random() * colors.length | 0]}));
  fxAdd({dur, draw(c, q) { const e = 1 - (1 - q) ** 3; c.globalAlpha = 1 - q; for (const s of parts) { c.fillStyle = s.col; c.fillRect(p.x + Math.cos(s.a) * s.r * e - s.s / 2, p.y + Math.sin(s.a) * s.r * e * .7 + 30 * q * q - s.s / 2, s.s, s.s); } }});
}
function fxText(p, text, color, size = 26, dur = 1200, delay = 0) {
  fxAdd({dur, draw(c, q) { const y = p.y - 20 - 60 * q, s = q < .15 ? .6 + q / .15 * .5 : 1.1 - .1 * Math.min(1, (q - .15) * 4);
    c.globalAlpha = q < .7 ? 1 : 1 - (q - .7) / .3; c.font = `900 ${size * s}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = 5; c.strokeStyle = '#04121c'; c.strokeText(text, p.x, y); c.fillStyle = color; c.fillText(text, p.x, y); }}, delay);
}
function fxFlash(color = '#fff6dd', dur = 260) { fxAdd({dur, draw(c, q) { c.globalAlpha = .45 * (1 - q); c.fillStyle = color; c.fillRect(0, 0, FX.w, FX.h); }}); }
function fxLock(p) { return fxAdd({dur: 1e9, draw(c, q, now) { const k = (now / 450) % 1, r = 10 + 30 * k; c.globalAlpha = 1 - k; c.strokeStyle = '#ffd34d'; c.lineWidth = 3; c.beginPath(); c.ellipse(p.x, p.y, r, r * .62, 0, 0, 6.283); c.stroke(); }}); }
function fxBubbles(p, words) { words.forEach((w, i) => fxText({x: p.x + (Math.random() - .5) * 60, y: p.y}, w, '#9fc3d6', 11, 2200, 250 + i * 260)); }
function fxFlood(start, end, T) {   // SYN flood: a torrent of small red packets
  const C = {x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - Math.max(80, FX.h * .35)}, jit = Array.from({length: 40}, () => ({d: Math.random() * .35, o: (Math.random() - .5) * 26}));
  return new Promise(resolve => fxAdd({dur: T, draw(c, p) { curve(c, start, C, end, 1, '#ff5a2e', 1.2, .25, [3, 6]);
    for (const j of jit) { const t = Math.min(1, Math.max(0, (p - j.d) / .65)); if (t <= 0 || t >= 1) continue; const q = bez(start, C, end, t), ox = j.o * Math.sin(t * 3); c.globalAlpha = .9; c.fillStyle = '#ff5a2e'; c.fillRect(q.x + ox - 3, q.y + j.o * .5 - 2, 7, 5); c.fillStyle = '#ffd34d'; c.fillRect(q.x + ox - 1, q.y + j.o * .5 - 1, 2, 2); }
    node(c, start, '#ff5a2e', 'hping3'); node(c, end, '#ff5a2e', 'SYN×∞');
  }, done: resolve}));
}
function kernelPanic(name, incoming) {
  const s = document.createElement('div'); s.className = 'panic'; s.innerHTML = '<pre></pre>';
  s.firstChild.textContent = `[${(performance.now() / 1000).toFixed(6)}] Out of memory: Killed process 137 (${name || 'containerd-shim'})\n[${(performance.now() / 1000 + .000412).toFixed(6)}] oom-kill: constraint=CONSTRAINT_MEMCG, task_memcg=/docker/${(state?.id || '').slice(0, 12)}\n${incoming ? '⚠  YOUR HOST IS BEING OOM-KILLED' : '💀 OOM KILLER INVOKED'}`;
  $('#sea').append(s); setTimeout(() => s.remove(), settings.fast ? 1200 : 2200);
}
function stamp(text, bad, extra = '') { const s = document.createElement('div'); s.className = 'stamp' + (bad ? ' bad' : '') + (extra ? ' ' + extra : ''); const b = document.createElement('b'); b.textContent = text; s.append(b); $('#sea').append(s); setTimeout(() => s.remove(), settings.fast ? 900 : 1700); }
function lifeEl(cls, x, y, text = '') { const e = document.createElement('span'); e.className = cls; e.textContent = text; e.style.translate = `${x}px ${y}px`; $('#life').append(e); return e; }
function bump(sel) { const e = sel === '#board-wrap' && R3 ? R3.canvas : $(sel); if (!e || settings.reduced) return; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }

/* ---------------- resolving strikes ---------------- */
async function resolveStrike(a, incoming, small) {
  const p = cellPoint(a.cell);
  hidden[incoming ? 'home' : 'target'].delete(a.cell);
  const victim = incoming ? state.me.ships.find(s => s.cells.includes(a.cell)) : null;
  R3?.splash(a.cell, a.decoy ? 'decoy' : a.hit ? (a.sunk ? 'sunk' : 'hit') : 'miss');
  if (a.decoy) {
    fxBurst(p, '☠️', small ? 40 : 60, 900); fxRing(p, 4, 50, '#c9a7ff', 900); audio.sound('error');
    fxText(p, incoming ? 'DECOY WORKED' : 'NXDOMAIN · DECOY', '#c9a7ff', small ? 15 : 20, 1500);
    log(incoming ? `${ts()} ✔ ${oppName()} hit your DNS decoy at ${coord(a.cell)} — wasted packet` : `${coord(a.cell)} (${ip(a.cell, true)}): NXDOMAIN — DNS POISONED, that host was a decoy`, incoming ? 'hit' : 'error');
  } else if (a.hit) {
    fxBurst(p, '💥', small ? 46 : 78); fxSparks(p, small ? 10 : 22, ['#ffd34d', '#ff754f', '#fff6dd', '#2f7bff']); fxRing(p, 6, small ? 40 : 70, '#ff754f');
    fxBurst({x: p.x + 16, y: p.y - 26}, '📦', 24, 1000, 120);       // a container gets knocked off
    if (!small) fxFlash(); bump('#board-wrap'); audio.sound('hit', incoming);
    if (victim && F(victim.id).kind % 5 === 0) setTimeout(() => audio.sound('whale', true), 350);   // the whale feels that fxText(p, incoming ? 'OUCH' : 'HIT', '#ffd34d', small ? 20 : 28);
    log(incoming ? `${ts()} container die ${lc(a.cell)} (exitCode=137, image=${victim ? IMG(victim.id) : '?'}, name=${victim ? POD(victim.id) : '?'})`
      : `64 bytes from ${ip(a.cell, true)} (${lc(a.cell)}): icmp_seq=${stats.sent} ttl=64 → HIT  container killed (exitCode=137)${a.health != null ? `\n  TARGET ACQUIRED · CONTAINER HEALTH: ${a.health}%` : ''}`, incoming ? 'error' : 'hit');
    if (a.container) log(`$ docker events --since 1s\ncontainer die  name=${a.container.name}  image=${a.container.image}  exitCode=137\n⚠ UNEXPECTED MARITIME TERMINATION`, incoming ? 'error' : 'event');
  } else {
    fxBurst(p, '💦', small ? 30 : 50, 800); fxRing(p, 4, small ? 30 : 46, '#dff6ff', 900); fxRing(p, 4, small ? 22 : 34, '#dff6ff', 900, 150, 2);
    audio.sound('miss', incoming); fxText(p, incoming ? 'MISSED US' : 'MISS', '#dff6ff', small ? 16 : 22);
    log(incoming ? `${ts()} kill ${lc(a.cell)}: no such container (they missed)` : `From ${ip(a.cell, true)} (${lc(a.cell)}): Destination Host Unreachable → MISS`, incoming ? 'event' : 'miss');
  }
  renderBoard();
  if (a.sunk) {
    await sleep(settings.fast ? 180 : 380); hiddenSunk.delete(a.sunk.id); freshSink.add(a.sunk.id); renderBoard();
    setTimeout(() => freshSink.delete(a.sunk.id), 3000);
    const ship = incoming ? state.me.ships.find(s => s.id === a.sunk.id) : state.opponent?.sunk?.find(s => s.id === a.sunk.id);
    const g = geo(), cells = ship?.cells || [a.cell];
    cells.forEach((c, i) => { const q = cellPoint(c, g); fxBurst(q, i % 2 ? '🔥' : '💥', 34, 650, i * (settings.fast ? 40 : 90)); if (i % 2 === 0) fxBurst({x: q.x + 10, y: q.y - 18}, '📦', 22, 1200, 200 + i * 90); });
    fxBubbles(cellPoint(cells[Math.floor(cells.length / 2)], g), [...EXITS].sort(() => Math.random() - .5).slice(0, 4));
    audio.sound('sunk');
    if (state.phase === 'finished' && !incoming) { stamp(`$ docker rm -f ${POD(a.sunk.id)}`, true, 'rmf'); prompt(`docker rm -f ${POD(a.sunk.id)}`); log(POD(a.sunk.id)); }
    else stamp(`${POD(a.sunk.id)} · Exited (137)`, incoming);
    const r = ROLE(a.sunk.id);
    log(`⚠ KUBERNETES EVENT\nNamespace: whale-${incoming ? 'local' : 'production'}  Pod: ${POD(a.sunk.id)}-${(state.id || '').slice(0, 5)}\nSTATUS: NodeNotReady   RESTARTS: 0\n🐋 NODE DAMAGE DETECTED`, incoming ? 'error' : 'hit');
    { const mf = (incoming ? state.me.manifest : state.opponent?.manifest)?.[a.sunk.id] || [], k = F(a.sunk.id).kind % 5;
      const [cmd, err] = [['docker compose up -d', 'Error response from daemon:\nCannot connect to the Docker daemon.\n\nReason: The daemon is underwater.'],
        ['docker service update --force ocean_api', 'Error: no suitable node (scheduling constraints not satisfied on 1 node: node is underwater)'],
        ['kubectl get pvc', 'NAME     STATUS   VOLUME\npgdata   Lost     pvc-0cea  (volume is at the bottom of the ocean)'],
        ['kubectl get nodes', `${POD(a.sunk.id)}   NotReady   (the penguin went for coffee)`],
        ['curl -I https://ocean.internal', 'HTTP/1.1 502 Bad Gateway\nVia: squid (the proxy is calamari now)']][k];
      log(`🐋 ${POD(a.sunk.id).toUpperCase()} HAS SUNK\n\n${mf.length} container${mf.length === 1 ? '' : 's'} lost:\n${mf.map(x => `✖ ${x.name}  (${x.image})`).join('\n')}\n\n$ ${cmd}\n\n${err}`, incoming ? 'error' : 'hit'); }
    log(`╭─ HOST TERMINATED ──────────────────────\n│ ${POD(a.sunk.id)} (${r.kind}, ${r.role})${incoming ? '' : ' — enemy'}\n│ Exit code: 137 · containers lost: ${LEN(a.sunk.id)} · uptime: ${state.turn_number} turns\n│ RESTART POLICY: never\n╰────────────────────────────────────────`, incoming ? 'error' : 'hit');
    await sleep(settings.fast ? 450 : 1000);
  }
}
function takeGroup() { const a = queue.shift(), g = [a]; while (!a.reveal && queue.length && queue[0].seat === a.seat && queue[0].turn === a.turn && queue[0].power === a.power && !queue[0].reveal) g.push(queue.shift()); return g; }
async function playNext() {
  if (animating || !queue.length || !state) return;
  animating = true;
  const g = takeGroup(), a = g[0], incoming = a.seat !== state.seat, power = a.power;
  const from = incoming ? 'target' : 'home', to = incoming ? 'home' : 'target', fast = settings.fast;
  const enemyUser = {user: slug(oppName()), host: state.mode === 'multiplayer' ? 'enemy' : 'ai-captain', enemy: true};
  if (power === 'chaos') log(`[ KUBERNETES EVENT ] OOMKilled: container at ${coord(a.cell)} exceeded its memory limit`, incoming ? 'error' : 'hit');
  else if (incoming) prompt(power ? `${PI(power).cmd} ${ip(a.cell, power === 'restore')}  # ${coord(a.cell)}` : `ping -c1 ${g.map(x => lc(x.cell)).join(' ')}`, enemyUser);
  else { stats.sent += g.length; if (!power) log(`PING 172.20.0.0/16: ${g.length} packet${g.length > 1 ? 's' : ''} → ${g.map(x => `${lc(x.cell)}(${ip(x.cell, true)})`).join(' ')}`); }
  setTurnBanner(power === 'restore' ? `💾 ${incoming ? 'ENEMY ' : ''}RESTORE` : power === 'chaos' ? '☸ OOMKilled' : incoming ? `🚨 INCOMING ${power ? PI(power).label : '×' + g.length}` : power ? `${PI(power).emoji} ${PI(power).label}!` : `📡 PING ×${g.length}`, incoming ? 'alarm' : 'mine');
  if (settings.reduced || document.hidden) {
    view = to; g.forEach(x => { hidden[to].delete(x.cell); if (x.sunk) hiddenSunk.delete(x.sunk.id); }); if (a.reveal) shownSonar = state.opponent?.sonar?.length || 0; render();
    if (!document.hidden) { const hits = g.filter(x => x.hit).length; fxText(cellPoint(a.cell), a.reveal ? `SCAN: ${a.found} up` : hits ? `${hits} HIT${hits > 1 ? 'S' : ''}` : 'MISS', hits ? '#ffd34d' : '#dff6ff'); audio.sound(hits ? 'hit' : 'miss', incoming); await sleep(500); }
    if (!a.reveal) g.forEach(x => log(incoming ? `${ts()} ${x.hit ? 'container die' : 'missed'} ${lc(x.cell)}` : `${lc(x.cell)} (${ip(x.cell, true)}): ${x.hit ? 'HIT' : 'MISS'}`, x.hit ? (incoming ? 'error' : 'hit') : 'miss'));
  } else if (a.restored) {
    const v = incoming ? 'target' : 'home'; if (view !== v) await slideTo(v);
    const p = cellPoint(a.cell); fxBurst(p, '💾', 44, 900); fxRing(p, 4, 50, '#3ddc84', 900); fxText(p, 'RESTORED', '#3ddc84', 18); audio.sound('join');
    renderBoard();
    log(incoming ? `${ts()} ⚠ ${oppName()} ran restic restore: ${coord(a.cell)} is back online (hit it again)` : `restoring snapshot latest → ${coord(a.cell)} ... done (1 segment repaired)`, incoming ? 'error' : 'hit');
    await sleep(fast ? 500 : 1100);
  } else if (a.pattern) {
    // animal attacks: show the creature and the exact pattern, then resolve the strikes that follow it
    const strikes = []; while (queue.length && queue[0].power === a.power && queue[0].seat === a.seat && !queue[0].reveal) strikes.push(queue.shift());
    if (view !== to) await slideTo(to);
    await ensureVisible(a.area);
    const P = PI(a.power), g2 = geo(), pts = a.area.map(c => cellPoint(c, g2)), ctr = cellPoint(a.cell, g2), col = incoming ? '#ff8a5c' : '#7fe3ff';
    pts.forEach((q, i) => fxRing(q, 3, q.w * .7, col, 700, i * 50, 2.5));
    if (R3) {   // the creature really does it: a whale breaches / slams its flukes, or a squid rises and grabs
      audio.sound('whale', incoming); setTimeout(() => audio.sound(a.power === 'tail' ? 'tail' : 'miss', incoming), a.power === 'breach' ? 1200 : 900);
      await R3.stunt(a.cell, a.power === 'grab' ? 'grab' : a.power === 'tail' ? 'tail' : 'breach', a.rot || 0);
      bump('#board-wrap');
    } else {
      const top = {x: ctr.x - 40, y: -60};
      fxAdd({dur: fast ? 450 : 800, draw(c, q) { const e = q * q, x = top.x + (ctr.x - top.x) * e, y = top.y + (ctr.y - top.y) * e; glyph(c, P.emoji, x, y - 20, 70 + 40 * Math.sin(Math.PI * q), a.power === 'tail' ? -1.2 + q * 2.6 : a.power === 'grab' ? Math.sin(q * 9) * .4 : 0); }});
      audio.sound(a.power === 'tail' ? 'tail' : 'launch', incoming); await sleep(fast ? 420 : 760);
      fxFlash(); fxRing(ctr, 6, ctr.w * 4, '#ffffff', 600); bump('#board-wrap');
    }
    for (const x of strikes) await resolveStrike(x, incoming, true);
    if (!strikes.length) fxText(ctr, 'ALL MISSED', '#dff6ff', 18);
    const hits = strikes.filter(x => x.hit).length;
    log(`${P.label.toLowerCase()} --pattern=${P.pattern}${a.rot ? ' --rotate=' + a.rot * 90 : ''} @ ${coord(a.cell)}: ${strikes.length} cells, ${hits} hit`, hits ? (incoming ? 'error' : 'hit') : 'miss');
    await sleep(fast ? 250 : 550);
  } else if (a.power === 'flood' && a.area) {
    if (view !== to) await slideTo(to);
    await ensureVisible([a.cell]);
    const g2 = geo(), ctr = cellPoint(a.cell, g2), src = {x: incoming ? FX.w * .9 : FX.w * .1, y: FX.h * .85};
    audio.sound('depth', incoming); if (R3) await R3.floodFx(a.cell, a.area); else await fxFlood(src, ctr, fast ? 700 : 1300);
    a.area.forEach((c, i) => { const q = cellPoint(c, g2); fxRing(q, 3, q.w * .8, '#ff5a2e', 800, i * 40, 2); });
    fxText(ctr, a.disrupted ? `${a.disrupted} NODE${a.disrupted > 1 ? 'S' : ''} CORDONED` : 'NO NODES IN RANGE', a.disrupted ? '#ffd34d' : '#dff6ff', 20, 1600);
    log(incoming ? `⚠ packet flood around ${coord(a.cell)}: ${a.disrupted} of your nodes cordoned · specials jammed next turn` : `packet flood @ ${coord(a.cell)}: ${a.disrupted} node${a.disrupted === 1 ? '' : 's'} cordoned (2 turns) · their specials jammed`, incoming ? 'error' : 'hit');
    await sleep(fast ? 500 : 1000);
  } else if (a.reveal) {
    if (view !== to) await slideTo(to);
    await ensureVisible([a.cell]);
    const p = cellPoint(a.cell), sw = p.w;
    if (R3) R3.scanFx(a.cell); else for (let i = 0; i < 3; i++) fxRing(p, 4, sw * 3.2, '#23e4d0', 1000, i * 260, 3);
    fxAdd({dur: 1100, draw(c, q) { c.globalAlpha = .45 * (1 - q); c.translate(p.x, p.y); c.scale(1, .62); c.rotate(q * 6.283); c.fillStyle = '#23e4d0'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, sw * 3, -.35, .35); c.closePath(); c.fill(); }});
    audio.sound('sonar', incoming); await sleep(fast ? 400 : 900);
    if (!incoming) {
      shownSonar = state.opponent?.sonar?.length || 0; renderBoard(); fxText(p, a.masked ? `${a.found} SIGNAL${a.found === 1 ? '' : 'S'} · MASKED` : `${a.found} UP`, a.found ? '#23e4d0' : '#dff6ff', a.masked ? 18 : 26);
      const block = areaOf(a.cell, 'scan'), up = (state.opponent?.sonar || []).filter(s => s.ship && block.includes(s.cell)).map(s => lc(s.cell));
      log(`Nmap scan report for ${SECT() ? subnet(secOf(a.cell)) + ' (sector ' + LETTERS[secOf(a.cell)] + ')' : ip(a.cell, true) + '/3x3 (' + lc(a.cell) + ')'}\n${block.length} hosts scanned · ${a.found} up${a.masked ? ' · filtered by proxy — exact hosts unknown (sink their squid to unmask)' : up.length ? ': ' + up.join(' ') : ''}\nPORT     STATE  SERVICE\n2375/tcp ${a.found ? (a.masked ? 'filtered' : 'open  ') : 'closed'} docker`, a.found ? 'hit' : '');
    } else { fxText(p, 'SCANNED', '#ff9a7c'); log(`${ts()} ⚠ ENEMY NETWORK ACTIVITY: port scan around ${lc(a.cell)}`, 'error'); }
    await sleep(fast ? 300 : 700);
  } else {
    view = from; render();
    await ensureVisible(g.map(x => x.cell));
    const afloat = state.me.ships.flatMap(s => s.cells).filter(c => (state.me.shots[c] || 0) < 2);
    const T = fast ? 750 : 1150, center = power ? g[Math.floor(g.length / 2)] : null, shots = power ? [center] : g;
    const color = incoming ? '#ff8a5c' : power === 'depth' || power === 'flood' ? '#ff5a2e' : power === 'tail' || power === 'trace' ? '#8ab4ff' : power === 'oom' ? '#ff3b6b' : '#23e4d0';
    if (power === 'oom' && !settings.reduced) { const sh = (incoming ? state.me.ships : state.opponent?.sunk || []).find(s => s.cells.includes(g[0].cell)); kernelPanic(sh ? POD(sh.id) : null, incoming); }
    const geom = geo();
    const flights = shots.map((x, i) => sleep(i * (fast ? 60 : 120)).then(() => {
      const srcCell = incoming ? Math.floor(Math.random() * CELLS()) : afloat[Math.floor(Math.random() * afloat.length)] ?? x.cell;
      const ship = !incoming && state.me.ships.find(s => s.cells.includes(srcCell));
      audio.sound(i === 0 ? (power === 'depth' ? 'depth' : 'launch') : 'packet', incoming);
      const s = cellPoint(srcCell, geom), e = cellPoint(x.cell, geom);
      if (power === 'depth' || power === 'flood') return fxFlood(s, e, T);
      if (R3) return R3.launch(srcCell, x.cell, {color, dur: T / 1000});   // a glowing 3D packet with a light trail
      return fly(s, e, T, {color, glyph: power === 'tail' || power === 'trace' ? '🛰️' : power === 'oom' ? '💀' : power === 'chaos' ? '☸️' : incoming ? '🚀' : '📨', hops: power === 'tail' || power === 'trace', from: incoming ? enemyUser.user : ship ? POD(ship.id) : '', to: `${coord(x.cell)} ${ip(x.cell, !incoming)}`});
    }));
    await sleep(T * 0.3); slideTo(to, incoming ? 'right' : 'left');       // oceans swap mid-flight; links keep their arcs
    await Promise.all(flights);
    if (power === 'tail') { const g2 = geo(); g.forEach((x, i) => fxText(cellPoint(x.cell, g2), `hop ${i + 1}`, '#8ab4ff', 12, 900, i * 70)); audio.sound('tail'); await sleep(fast ? 120 : 260); }
    const lock = fxLock(cellPoint(g[0].cell)); await sleep(fast ? 140 : 320); lock.kill = true;
    for (const x of g) { await resolveStrike(x, incoming, g.length > 1); if (g.length > 1) await sleep(fast ? 50 : 120); }
    if (power === 'trace' && a.hops != null) {
      const hp = a.hops; fxText(cellPoint(a.cell), hp === 0 ? 'HOP 0 · HIT' : `${hp} HOP${hp > 1 ? 'S' : ''} AWAY`, '#8ab4ff', 18, 1800);
      log(`traceroute to ${ip(a.cell, !incoming)} (${coord(a.cell)}), 30 hops max\n${Array.from({length: Math.min(hp, 6)}, (_, i) => ` ${i + 1}  10.${i}.${(a.cell * 7 + i) % 250}.1  ${(2 + i * 3.1).toFixed(1)} ms`).join('\n')}${hp > 6 ? '\n …' : ''}\n${hp === 0 ? ' → destination reached: container answered' : ` → nearest live container is ${hp} hop${hp > 1 ? 's' : ''} from ${coord(a.cell)} (grid steps)`}`, incoming ? 'event' : 'hit');
    }
    if ((power === 'flood') && !incoming) log('SYN flood complete · their specials are rate-limited next turn', 'hit');
    if ((power === 'flood') && incoming) log('⚠ SYN flood: your specials are rate-limited this turn', 'error');
    if (!incoming) { const hits = g.filter(x => x.hit).length; log(`--- ${power ? PI(power).label.toLowerCase() : 'ping'} statistics ---\n${g.length} packet${g.length > 1 ? 's' : ''} transmitted, ${hits} hit, ${Math.round((g.length - hits) / g.length * 100)}% packet loss`); }
    await sleep(fast ? 250 : 550);
  }
  animating = false;
  if (!queue.length && state?.phase === 'playing') {
    await sleep(fast ? 200 : 400);
    const want = myTurn() ? 'target' : 'home'; if (view !== want) await slideTo(want);
    if (myTurn()) { notify('Your turn in WHALESHIP', `${oppName()} fired. Your move, captain.`); audio.sound('turn'); log(`${ts()} ⏎ your turn · ${salvo()} ping${salvo() > 1 ? 's' : ''} · ${specList().filter(x => x.ok).map(x => PI(x.id).short.toLowerCase()).join(' ') || 'no specials ready'}`, 'event'); }
  }
  render(); playNext();
}

/* ---------------- idle life ---------------- */
function critterTick() {
  if (R3 || document.hidden || settings.reduced || !$('#sea').offsetWidth) return;   // the 3D world has its own life
  const sea = $('#sea'), r = Math.random();
  const x = sea.clientWidth * (0.05 + Math.random() * 0.9), y = sea.clientHeight * (0.18 + Math.random() * 0.7);
  const add = (cls, text, life) => { const e = lifeEl(cls, x, y, text); setTimeout(() => e.remove(), life); return e; };
  if (r < 0.5) { add('whale' + (Math.random() < .5 ? ' flip' : ''), CRITTERS[Math.floor(Math.random() * CRITTERS.length)], 4300); add('ripple', '', 1500); }
  else if (r < 0.78) { add('whale-back', Math.random() < .6 ? '🐳' : '🐋', 3000); add('spout', '💦', 2600); }
  else { const e = add('packet-bit', ['0x7F', 'SYN', 'ACK', '200 OK', 'ICMP', '::1', 'TTL 64', 'RST'][Math.random() * 8 | 0], 3600); e.style.setProperty('--dx', `${(Math.random() - .5) * 120}px`); }
}

/* ---------------- banner, HUD, title ---------------- */
let bannerOverride = null;
function setTurnBanner(text, kind) { bannerOverride = {text, kind}; paintBanner(); }
function paintBanner() {
  let text, kind;
  if (animating && bannerOverride) ({text, kind} = bannerOverride);
  else if (!state) { text = connected ? '🐳 Tap the ocean to play' : '📡 Contacting harbor…'; kind = 'idle'; }
  else if (deploying()) {
    if (!state.me.ready) { text = settings.manual ? '⚓ Arrange your stack' : '⚓ Deploying your stack…'; kind = 'deploy'; }
    else if (state.mode === 'multiplayer' && !state.opponent) { text = '📨 Waiting for a friend to open your link'; kind = 'wait'; }
    else { text = `⏳ Waiting for ${oppName()} to deploy`; kind = 'wait'; }
  } else if (state.phase === 'playing') {
    if (myTurn()) { text = salvo() > 1 ? `🟢 YOUR TURN — ${salvo()} pings` : '🟢 YOUR TURN — ping one'; kind = 'mine'; }
    else { text = `🟠 ${oppName()}’s turn`; kind = 'theirs'; }
  } else { const won = state.winner === state.seat; text = won ? '🏆 DEPLOYMENT SUCCESSFUL' : '💀 It works on my machine.'; kind = won ? 'won' : 'lost'; }
  const t = $('#turn'); if (t.textContent !== text) { t.textContent = text; bump('#turn'); } t.className = 'turn ' + kind;
}
function showCtas(ids, pulse) { for (const id of CTAS) { const e = $('#' + id); if (!e) continue; e.hidden = !ids.includes(id); e.classList.toggle('cta', id === pulse); } }
function renderHud() {
  $('#views').hidden = !state;
  for (const [id, v] of [['#view-target', 'target'], ['#view-home', 'home']]) { $(id).setAttribute('aria-selected', String(view === v)); $(id).disabled = animating; }
  const canNotify = 'Notification' in window && Notification.permission === 'default';
  let hint = '', ids = [], pulse = null;
  if (!state) { hint = `sink their infrastructure · 36 sectors · type Q5 or 35 · ${RULE_INFO[chosenRules].label.toLowerCase()}`; ids = ['rules', 'cta-solo', 'difficulty', 'cta-friend']; pulse = 'cta-solo'; paintSizes(); }
  else if (deploying()) {
    const waitingFriend = state.mode === 'multiplayer' && !state.opponent;
    if (!state.me.ready) { hint = held != null ? `tap water to move ${NICE(held)} · tap it again to rotate` : 'drag a creature to move it · tap one, then tap water'; ids = ['cta-shuffle', 'cta-ready', ...(waitingFriend ? ['cta-invite'] : [])]; pulse = state.me.ships.length === FLEET.length ? 'cta-ready' : null; }
    else { hint = waitingFriend ? 'no rush — close the tab if you like, your seat waits' : `${oppName()} is deploying…`; ids = [...(waitingFriend ? ['cta-invite'] : []), ...(canNotify && waitingFriend ? ['cta-notify'] : [])]; pulse = waitingFriend ? 'cta-invite' : null; }
  } else if (state.phase === 'playing') {
    const claim = state.mode === 'multiplayer' && state.disconnect_seconds?.[1 - state.seat] >= state.forfeit_after;
    if (animating) hint = '📡 packets in flight…';
    else if (myTurn()) {
      const need = salvo() - targets.size, pw = state.me.powers || {};
      if (armed) hint = `${PI(armed).emoji} ${PI(armed).own ? 'tap a square in YOUR waters' : 'tap enemy water'} to ${PI(armed).what}${armed === 'tail' ? ` (${tailVertical ? 'column' : 'row'})` : ''} · tap the button again to ${armed === 'tail' && !tailVertical ? 'turn it ↕' : 'cancel'}`;
      else if (settings.confirm && salvo() === 1) hint = targets.size ? `locked on ${coord([...targets][0])} — PING!` : '🎯 tap a square in enemy waters, then PING';
      else hint = salvo() > 1 ? (targets.size ? `🎯 ${need} more — or PING now` : `🎯 tap ${salvo()} squares in enemy waters`) : '🎯 tap a square in enemy waters to ping it';
      ids = [...(SECT() && !touchLayout() ? ['keypad'] : []), ...(targets.size || SECT() ? ['cta-fire'] : []), ...(specList().length ? ['specials'] : [])];
      if (SECT() && !armed && touchLayout()) hint = need <= 0 ? '📡 queue full — tap TRANSMIT' : `👆 tap ${need} square${need === 1 ? '' : 's'} on the enemy map · pinch to zoom`;
      else if (SECT() && !armed) hint = need <= 0 ? '⏎ queue full — TRANSMIT (Enter or Space) · ⌫ drops the last one' : sel < 0 ? `⌨ type a target like J5 · ${need} packet${need === 1 ? '' : 's'} left` : `sector ${LETTERS[sel]} → now 1–9`;
      pulse = targets.size && (need <= 0 || settings.confirm) ? 'cta-fire' : null;
      $('#cta-fire').disabled = !targets.size;
    } else { hint = state.mode === 'multiplayer' ? `${oppName()} is aiming · no time limit — come back anytime` : '🤖 the AI is aiming…'; if (canNotify && state.mode === 'multiplayer') ids = ['cta-notify']; }
    if (claim && !animating) ids.push('cta-forfeit');
  } else { hint = state.winner === state.seat ? 'deployment successful · again?' : 'this incident has been logged · rematch?'; ids = ['cta-again', 'cta-share']; pulse = 'cta-again'; }
  $('#hint').textContent = hint ? '❯ ' + hint : ''; showCtas(ids, pulse); renderKeypad(ids.includes('keypad'));
  $('#fire-label').textContent = SECT() ? `📡 TRANSMIT ${targets.size}/${salvo()}${touchLayout() ? '' : ' ⏎'}` : salvo() > 1 ? `📡 PING ${targets.size}/${salvo()}` : '📡 PING';
  $('#fire-cmd').textContent = `$ ping ${[...targets].map(c => lc(c)).join(' ') || '—'}`;
  renderSpecials(ids.includes('specials'));
  document.querySelectorAll('[data-rules]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rules === chosenRules)));
  $('#cta-ready').disabled = !state || state.me.ships.length !== FLEET.length || state.me.ready || !connected;
  $('#cta-shuffle').disabled = !state || state.me.ready || !connected;
  document.body.dataset.phase = !state ? 'menu' : state.phase;
}
function specList() {
  if (!state) return [];
  if (state.rules) return state.me.specials || [];
  return ['sonar', 'depth', 'tail'].map(id => ({id, charges: state.me.powers?.[id] ?? 0, cool: 0, ok: (state.me.powers?.[id] ?? 0) > 0, why: 'no charges left'}));
}
function renderSpecials(on) {
  const box = $('#specials'); if (!on) return;
  const list = specList(), sig = JSON.stringify(list) + armed + tailVertical + rotN;
  if (sig === lastSpecials) return; lastSpecials = sig;
  box.replaceChildren(...list.map(x => {
    const P = PI(x.id), b = document.createElement('button');
    b.type = 'button'; b.className = 'sp' + (P.own ? ' own' : ''); b.dataset.sp = x.id; b.disabled = !x.ok; b.setAttribute('aria-pressed', String(armed === x.id));
    b.title = `${P.label} — ${P.tip || P.what}${x.ok ? '' : ` (${x.why})`}`;
    b.innerHTML = '<b></b><small></small>';
    b.firstChild.textContent = `${P.emoji} ${P.short}${x.id === 'tail' && armed === 'tail' ? (tailVertical ? ' ↕' : ' ↔') : ''}`;
    b.lastChild.textContent = x.ok ? (x.charges == null ? '∞' : `×${x.charges}`) + ` · ${x.free ? 'free' : {damage: 'dmg', reveal: 'scan', disrupt: 'jam'}[P.fx] || 'dmg'}` : x.why;
    b.onclick = () => armSpecial(x.id);
    return b;
  }));
  if (armed && PI(armed).rot) { const b = document.createElement('button'); b.type = 'button'; b.className = 'sp rot'; b.innerHTML = `<b>⟳ ${rotN * 90}°</b><small>rotate · space</small>`; b.onclick = () => { rotN = (rotN + 1) & 3; if (hover >= 0) preview(hover); audio.sound('select'); render(); }; box.append(b); }
}
function armSpecial(p) {
  if (armed === p) { if (p === 'tail' && !state.rules && !tailVertical) tailVertical = true; else { armed = null; tailVertical = false; } }
  else { armed = p; tailVertical = false; rotN = 0; targets.clear(); const want = PI(p).own ? 'home' : 'target'; if (view !== want) slideTo(want); }
  area = []; audio.sound('select'); toast(`${PI(p).emoji} ${PI(p).label}: ${PI(p).tip || PI(p).what}`); render();
}
function inspect({key, j}) {
  const id = Number(key.split(':')[1]), mf = state.me.manifest?.[id]?.[j], f = F(id); if (!mf) return;
  const cells = state.me.ships.find(s => s.id === id)?.cells.slice().sort((a, b) => a - b) || [], c = cells[j], dead = (state.me.shots[c] || 0) >= 2;
  const box = $('#inspect'); box.hidden = false;
  box.textContent = `$ docker inspect ${mf.name}\nName:      /${mf.name}\nImage:     ${mf.image}\nKind:      ${mf.kind}\nStatus:    ${dead ? 'exited (137)' : 'running'}\nHealth:    ${dead ? 'unhealthy' : 'healthy'}\nNode:      ${f.name} (${ROLES[f.kind % 5].role})\nNamespace: default\nAddress:   ${coord(c)} · ${ip(c, false)}`;
  clearTimeout(inspect.t); inspect.t = setTimeout(() => box.hidden = true, 6000); audio.sound('select');
}
function renderKeypad(on) {
  document.body.classList.toggle('sect-aim', on); if (!on) return;
  const shots = shotsFor('target'), son = new Map((state?.opponent?.sonar || []).slice(0, shownSonar).map(s => [s.cell, s.fuzzy ? 'fuzzy' : s.ship]));
  const pods = state.me.ships.filter(sh => sh.cells.some(c => (state.me.shots[c] || 0) < 2)).length;
  $('#kp-head').textContent = sel < 0 ? `k8s.production · ${armed ? PI(armed).label + ' · ' : ''}pick a SECTOR` : `SECTOR ${LETTERS[sel]} · ${subnet(sel)} · pick 1–9`;
  $('#kp-cluster').textContent = `docker.local · nodes ${pods}/${FLEET.length} Ready · ⚡ ${salvo()} packet${salvo() > 1 ? 's' : ''}`;
  const grid = $('#kp-grid'), mode = sel < 0 ? 'letters' : 'digits';
  if (grid.dataset.mode !== mode || grid.dataset.n !== String(NSEC())) {
    grid.dataset.mode = mode; grid.dataset.n = NSEC(); grid.style.setProperty('--cols', mode === 'letters' ? SC() : 3);
    grid.replaceChildren(...(mode === 'letters' ? LETTERS.slice(0, NSEC()).split('').map((L, i) => Object.assign(document.createElement('button'), {type: 'button', className: 'kl', onclick: () => selectSector(i), innerHTML: `<b>${L}</b><i></i>`}))
      : [1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => Object.assign(document.createElement('button'), {type: 'button', className: 'kd', onclick: () => keypad(k), innerHTML: `<b>${k}</b><i></i>`}))));
  }
  if (mode === 'letters') [...grid.children].forEach((b, si) => {
    const cells = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => cellOf(si, k)), hits = cells.filter(c => shots[c] === 2).length, probed = cells.filter(c => shots[c] && shots[c] !== 5).length, q = cells.filter(c => targets.has(c)).length;
    b.dataset.st = q ? 'armed' : hits ? 'hit' : probed === cells.filter(c => shots[c] !== 5).length ? 'done' : ''; b.lastChild.textContent = q ? '●'.repeat(q) : hits ? '✕'.repeat(Math.min(3, hits)) : probed ? `${probed}/9` : '';
  });
  else [...grid.children].forEach((b, i) => {
    const k = i + 1, c = cellOf(sel, k), m = shots[c];
    const st = m === 5 ? 'ice' : m === 4 ? 'decoy' : m === 1 ? 'miss' : m >= 2 ? 'hit' : targets.has(c) ? 'armed' : son.get(c) === 'fuzzy' ? 'signal' : son.get(c) ? 'contact' : son.has(c) ? 'clear' : '';
    b.dataset.st = st; b.disabled = m === 5 || (!!m && !(armed === 'oom' && m === 2) && !armed);
    b.firstChild.textContent = LETTERS[sel] + k; b.lastChild.textContent = {miss: '· miss', hit: '💥 hit', armed: '● armed', contact: '◉ contact', clear: '- clear', signal: '? signal', decoy: '☠ decoy', ice: '🧊 fw'}[st] || '';
  });
  const q = [...targets];
  $('#queue').replaceChildren(...q.map((c, i) => Object.assign(document.createElement('button'), {type: 'button', className: 'chip', title: 'remove', onclick: () => { targets.delete(c); render(); }, textContent: `${'①②③④⑤⑥'[i]} ${coord(c)} ${ip(c, true)} ●`})),
    ...Array.from({length: Math.max(0, salvo() - q.length)}, () => Object.assign(document.createElement('span'), {className: 'chip empty', textContent: '○ —'})));
}
const EV_TIP = {
  selfheal: 'Kubernetes Deployments keep the desired number of replicas: a failed Pod gets replaced automatically.',
  crashloop: 'CrashLoopBackOff: a container keeps crashing, so Kubernetes waits longer and longer before restarting it.',
  imagepull: 'ImagePullBackOff: the image could not be pulled from the registry, so the workload cannot start yet.',
  dnsfail: 'DNS failure: name lookups fail, so the next scan returns garbage.',
  rolling: 'Rolling update: pods are replaced a few at a time — capacity dips while it rolls.',
  drain: 'kubectl drain: a node is cordoned and its workloads are evicted for maintenance.',
  oomkilled: 'OOMKilled: a container used more memory than its limit and the kernel killed it.',
  flooded: 'Cordoned nodes accept no new work: their abilities are offline until the flood clears (2 turns).',
  roledown: 'Every creature runs part of the stack. Lose one and the abilities it powers go with it.',
};
function showEvent(ev) {
  const mine = ev.seat === state?.seat, who = mine ? 'your cluster' : `${oppName()}’s cluster`, at = ev.cell != null ? ' @ ' + coord(ev.cell) : '';
  const txt = {
    roledown: mine ? `⚠ your ${ev.role} is down — ${ROLE_FX[ev.role]}` : `✔ enemy ${ev.role} down — ${ev.role === 'squid' ? 'their proxy is gone: your masked scans are now exact' : ROLE_FX[ev.role].replace(/^[^(]*/, m => 'their ' + m)}`,
    selfheal: `☸ Deployment recovered in ${who}: replica rescheduled${at}`,
    crashloop: `☸ CrashLoopBackOff in ${who}: ${PI(ev.special).label} +2 turns cooldown`,
    imagepull: `☸ ImagePullBackOff in ${who}: every special delayed 1 turn`,
    dnsfail: `☸ DNS failure in ${who}: the next port scan comes back masked`,
    rolling: `☸ Rolling update in ${who}: −1 ping this turn`,
    drain: `☸ kubectl drain in ${who}: ${ev.role} cordoned for 2 turns — ${ROLE_FX[ev.role]}`,
    oomkilled: `☸ OOMKilled in ${who}${at}: a container blew its memory limit`,
    flooded: `🌊 NodeNotReady in ${who}: ${(ev.roles || []).join(', ')} cordoned by a packet flood`,
  }[ev.kind] || `☸ ${ev.kind}`;
  log(`[ KUBERNETES EVENT ] turn ${ev.turn}\n${txt}`, mine && ev.kind !== 'selfheal' ? 'error' : 'hit');
  if (EV_TIP[ev.kind]) log(`  ℹ ${EV_TIP[ev.kind]}`, 'tip');
  toast(txt); audio.sound(mine && ev.kind !== 'selfheal' ? 'error' : 'join');
  if (ev.kind === 'selfheal' && ev.cell != null && !settings.reduced) { const v = mine ? 'home' : 'target'; if (view === v) fxText(cellPoint(ev.cell), '☸ RECOVERED', '#3ddc84', 16, 1600); }
}
function setFavicon(emoji) { const href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>`)}`; if ($('#favicon').href !== href) $('#favicon').href = href; }
function renderTitle() {
  let t = 'WHALESHIP — Sink their stack.', f = '🐳';
  if (state?.phase === 'playing') { if (myTurn()) { t = '🟢 Your turn · WHALESHIP'; f = '🟢'; } else { t = `⏳ ${oppName()}’s turn · WHALESHIP`; f = '⏳'; } }
  else if (state?.phase === 'finished') { const won = state.winner === state.seat; t = `${won ? '🏆 Victory' : '💀 It works on my machine'} · WHALESHIP`; f = won ? '🏆' : '💀'; }
  else if (deploying() && state.mode === 'multiplayer' && !state.opponent) { t = '📨 Waiting for a friend · WHALESHIP'; f = '📨'; }
  const others = [...games.values()].filter(g => g.myTurn && g.id !== state?.id).length; if (others) t = `(${others}) ${t}`;
  if (document.title !== t) document.title = t; setFavicon(f);
  $('#status').textContent = connected ? (state ? `● ${state.mode === 'multiplayer' ? (state.opponent ? 'vs ' + oppName() : 'waiting for a friend') : 'solo · ' + state.mode} · ${SECT() ? 'sectors' : N + '²'} · turn ${state.turn_number ?? 0}` : '● harbor online') : '○ reconnecting…';
  $('#status').classList.toggle('offline', !connected);
}

/* ---------------- terminal watch pane: ASCII network map + docker ps ---------------- */
function asciiMap(which, html = true) {
  const shots = shotsFor(which), enemy = which === 'target', own = new Map();
  if (!enemy && state) state.me.ships.forEach(s => s.cells.forEach(c => own.set(c, s.id)));
  if (enemy) (state?.opponent?.sunk || []).filter(s => !hiddenSunk.has(s.id)).forEach(s => s.cells.forEach(c => own.set(c, s.id)));
  const sonar = new Map(enemy ? (state?.opponent?.sonar || []).slice(0, shownSonar).map(s => [s.cell, s.fuzzy ? 'fuzzy' : s.ship]) : []);
  const w = (cls, ch) => html ? `<span class="${cls}">${ch}</span>` : ch;
  const glyphAt = c => { const m = shots[c]; return m === 5 ? w('m-ice', '^') : m === 4 ? w('m-dec', '%') : m === 3 ? w('m-sunk', '#') : m === 2 ? w('m-hit', 'X') : m === 1 ? w('m-miss', 'o')
    : enemy && targets.has(c) ? w('m-tgt', '+') : sonar.has(c) ? (sonar.get(c) === 'fuzzy' ? w('m-tgt', '?') : sonar.get(c) ? w('m-son', '@') : w('dim', '-'))
    : own.has(c) ? w('m-own', 'MSWTQ'[F(own.get(c)).kind % 5]) : w('dim', '·'); };
  if (SECT()) {   // sector view: 6×4 blocks of 3×3, labelled, no row/column numbers
    const out = [];
    for (let sr = 0; sr < SR(); sr++) {
      out.push(' ' + Array.from({length: SC()}, (_, sc) => { const si = sr * SC() + sc, L = LETTERS[si]; return enemy && si === sel ? w('m-tgt', ` [${L}] `) : w('dim', `  ${L}  `); }).join('   '));
      for (let r = 0; r < 3; r++) out.push(' ' + Array.from({length: SC()}, (_, sc) => [0, 1, 2].map(k => glyphAt((sr * 3 + r) * N + sc * 3 + k)).join(' ')).join(w('dim', ' │ ')));
    }
    return out.join('\n');
  }
  const rows = [w('dim', '    ' + Array.from({length: N}, (_, i) => colLabel(i).slice(-1)).join(' '))];
  for (let y = 0; y < HT; y++) {
    const cells = [];
    for (let x = 0; x < N; x++) {
      const c = y * N + x, m = shots[c];
      cells.push(m === 5 ? w('m-ice', '^') : m === 4 ? w('m-dec', '%') : m === 3 ? w('m-sunk', '#') : m === 2 ? w('m-hit', 'X') : m === 1 ? w('m-miss', 'o')
        : enemy && targets.has(c) ? w('m-tgt', '+') : sonar.has(c) ? (sonar.get(c) === 'fuzzy' ? w('m-tgt', '?') : sonar.get(c) ? w('m-son', '@') : w('dim', '-'))
        : own.has(c) ? w('m-own', 'MSWTQ'[F(own.get(c)).kind % 5]) : w('dim', '·'));
    }
    rows.push(w('dim', String(y + 1).padStart(3)) + ' ' + cells.join(' '));
  }
  return rows.join('\n');
}
function podsText(kind = 'docker') {
  const narrow = innerWidth < 640, home = shotsFor('home'), t = state?.turn_number || 0;
  if (!state) return 'CONTAINER ID   IMAGE   STATUS   NAMES';
  const rows = [];
  for (const f of FLEET) {
    const s = state.me.ships.find(s => s.id === f.id), cells = s ? [...s.cells].sort((a, b) => a - b) : [];
    (state.me.manifest?.[f.id] || []).forEach((m, j) => { if (kind === 'k8s' ? m.kind === 'container' : m.kind !== 'container' && kind === 'docker' && false) return;
      const dead = s && (home[cells[j]] || 0) >= 2, id = (state.id.slice((f.id * 7 + j * 3) % 20) + state.id).slice(0, 12);
      rows.push({id, image: m.image, name: m.name, kind: m.kind, node: f.name, status: !s ? 'Created' : dead ? 'Exited (137)' : `Up ${t} turn${t === 1 ? '' : 's'}`}); });
  }
  if (kind === 'k8s') return ['NAME' + ' '.repeat(Math.max(1, 34 - 4)) + 'READY   STATUS      NODE', ...rows.map(r => `${r.name.padEnd(34)}${r.status.startsWith('Exited') ? '0/1' : '1/1'}     ${(r.status.startsWith('Exited') ? 'OOMKilled' : r.status === 'Created' ? 'Pending' : 'Running').padEnd(12)}${r.node}`)].join('\n');
  const fmt = r => narrow ? `${r.name.slice(0, 24).padEnd(25)}${r.status}` : `${r.id.padEnd(14)}${r.image.padEnd(24)}${r.status.padEnd(16)}${r.name}`;
  return [narrow ? 'NAMES                    STATUS' : 'CONTAINER ID  IMAGE                   STATUS          NAMES', ...rows.filter(r => r.kind === 'container').map(fmt)].join('\n');
}
let watchSig = '';
function renderWatch() {
  $('#release').textContent = state ? `${toShort(state.id).slice(0, 8).toLowerCase()} · ${state.mode} · ${N}x${HT}${SECT() && sel >= 0 ? ' · sector ' + LETTERS[sel] : ''}` : 'idle';
  $('#watch-clock').textContent = new Date().toString().slice(16, 24);
  if (!document.body.classList.contains('term-open') || !document.body.classList.contains('term-watch')) return;
  const wide= $('#screen-term').clientWidth >= (N * 2 + (SECT() ? 12 : 4)) * 2 * 7 + 140, maps = !state ? [] : wide ? ['target', 'home'] : [view];
  const sig = `${state?.revision}|${maps}|${[...hidden.home, ...hidden.target, ...hiddenSunk].join()}|${shownSonar}|${[...targets]}|${innerWidth}`;
  if (sig === watchSig) return; watchSig = sig;
  $('#map').innerHTML = !state ? '<span class="dim">no cluster attached — try: new 20</span>' : maps.map(m => `<div class="map-block"><span class="${m === 'target' ? 'm-hit' : 'm-own'}">${m === 'target' ? '▼ enemy 172.20.0.0/16' : '▼ mine 10.0.0.0/16'}</span>\n${asciiMap(m)}</div>`).join('');
  $('#pods').textContent = podsText();
}

/* ---------------- result: incident report ---------------- */
let resultShownFor = null;
function renderResult() {
  const o = $('#result-overlay');
  if (state?.phase !== 'finished' || animating || queue.length) { o.hidden = true; return; }
  if (resultShownFor === state.id) return;
  resultShownFor = state.id;
  const won = state.winner === state.seat, mine = state.attacks.filter(a => a.seat === state.seat && !a.reveal), theirs = state.attacks.filter(a => a.seat !== state.seat && !a.reveal);
  const hits = mine.filter(a => a.hit).length;
  const pad = (k, v) => `${k.padEnd(24)}${String(v).padStart(6)}`;
  $('#result-emoji').textContent = won ? '🏆' : '💀';
  $('#result-title').textContent = won ? 'DEPLOYMENT SUCCESSFUL' : 'It works on my machine.';
  $('#result-report').textContent = [
    '╔════════════════════════════════╗', '║   WHALESHIP INCIDENT REPORT    ║', '╚════════════════════════════════╝', '',
    `CLUSTER: ${won ? slug(oppName()) : slug(myName() || 'captain')}-production`, 'STATUS:  CATASTROPHIC FAILURE', '',
    pad('Hosts destroyed:', won ? mine.filter(a => a.sunk).length : theirs.filter(a => a.sunk).length),
    pad('Containers terminated:', won ? hits : theirs.filter(a => a.hit).length),
    pad('Packets transmitted:', mine.length), pad('Packets dropped:', mine.length - hits),
    pad('Accuracy:', Math.round(hits / Math.max(1, mine.length) * 100) + '%'), pad('Turns:', state.turn_number), '',
    'ROOT CAUSE:', state.reason === 'forfeit' ? '  Operator went dark. Forfeit.' : won ? '  Hostile infrastructure activity (you).' : '  Hostile infrastructure activity.', '',
    'RECOMMENDED ACTION:', won ? '  Take the rest of the day off.' : '  Restore from backup.', ...(won ? [] : ['', 'BACKUP STATUS:', '  No backups found.']), '',
    won ? '🐋 ship it.' : '🐋 WELL, SHIT.',
  ].join('\n');
  $('#result-line').textContent = state.score_saved ? 'score saved ✓ · tap to close' : 'tap to close';
  o.hidden = false; o.className = 'result-overlay ' + (won ? 'won' : 'lost');
  if (lastWinner !== state.id) { audio.sound(won ? 'victory' : 'defeat'); lastWinner = state.id; }
  if (!settings.reduced) { const set = won ? ['🎉', '🐳', '📦', '⭐', '🚀'] : ['💀', '📦', '🔥', '⚠️']; for (let i = 0; i < 18; i++) fxBurst({x: FX.w * (.05 + Math.random() * .9), y: FX.h * (.1 + Math.random() * .6)}, set[i % set.length], 30, 1100, i * 70); }
}
function render() { renderBoard(); paintBanner(); renderHud(); renderTitle(); renderWatch(); renderResult(); }

/* ---------------- notifications ---------------- */
function notify(title, body) { if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return; try { const n = new Notification(title, {body, tag: 'whaleship'}); n.onclick = () => { window.focus(); n.close(); }; } catch {} }

/* ---------------- terminal (second screen) ---------------- */
function openTerminal(open) { document.body.classList.toggle('term-open', open); $('#to-terminal').setAttribute('aria-expanded', String(open)); if (open) { watchSig = ''; renderWatch(); scrollTerm(); if (matchMedia('(pointer:fine)').matches) setTimeout(() => $('#command').focus({preventScroll: true}), 380); } }
const statusText = () => state ? `match ${toShort(state.id).slice(0, 8)} · ${state.phase} · ${N}x${HT} · revision ${state.revision}\nturn ${state.turn_number} · salvo ${state.salvo} · ${state.me.remaining}/${TOTAL()} friendly segments\nrules ${state.rules || 'legacy'} · specials: ${specList().map(x => `${PI(x.id).short.toLowerCase()}${x.ok ? (x.charges == null ? '' : '×' + x.charges) : '(' + x.why + ')'}`).join(' ')}\nroles: ${Object.entries(state.me.roles || {}).map(([r, up]) => `${r}:${up ? 'up' : 'DOWN'}`).join(' ')}` : 'No active deployment. Try: new hard 18';
const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen is unavailable here.')); };
const POWER_CMDS_LEGACY = {nmap: 'sonar', scan: 'sonar', sonar: 'sonar', hping3: 'depth', flood: 'depth', depth: 'depth', traceroute: 'tail', trace: 'tail', tail: 'tail'};
const POWER_CMDS_V3 = {nmap: 'scan', scan: 'scan', traceroute: 'trace', trace: 'trace', hping3: 'flood', flood: 'flood', oom: 'oom', kill: 'oom', dns: 'dns', dnsmasq: 'dns', poison: 'dns', restore: 'restore', restic: 'restore'};
const powerCmd = c => (state?.rules ? POWER_CMDS_V3 : POWER_CMDS_LEGACY)[c];
function command(line) {
  line = line.trim(); if (!line) return; cmdHistory.push(line); cmdHistory = cmdHistory.slice(-100); prompt(line, {typed: false});
  const parts = line.toLowerCase().split(/\s+/), cmd = parts[0];
  if ((cmd === 'fire' && !SECT()) || cmd === 'ping' || (cmd === 'docker' && ['kill', 'rm'].includes(parts[1]))) {
    const cells = parts.slice(1).map(parseCoord).filter(c => c >= 0);
    if (!cells.length) return log('usage: ping E4 [F5 …]', 'error');
    if (!myTurn()) return log('Error response from daemon: not your turn', 'error');
    targets.clear(); cells.slice(0, salvo()).forEach(c => targets.add(c)); view = 'target'; render(); fireVolley(); return;
  }
  if (powerCmd(cmd)) {
    const p = powerCmd(cmd), c = parts.map(parseCoord).find(c => c >= 0) ?? -1;
    if (c < 0) return log(`usage: ${cmd} E4${p === 'tail' ? ' [v]' : ''}`, 'error');
    if (!myTurn()) return log('Error response from daemon: not your turn', 'error');
    const sp = specList().find(x => x.id === p); if (!sp?.ok) return log(`${cmd}: ${sp?.why || 'not available in this mode'}`, 'error');
    view = PI(p).own ? 'home' : 'target'; render(); act('POWER', {power: p, cell: c, vertical: parts.includes('v')}); return;
  }
  if (cmd === 'target' || cmd === 'cd') { const L = (parts[1] || '').toUpperCase(); if (!SECT()) return log('target: only on the sector map (new 15)', 'error'); if (!(L.length === 1 && LETTERS.indexOf(L) >= 0 && LETTERS.indexOf(L) < NSEC())) return log(`usage: target K   (sectors A–${LETTERS[NSEC() - 1]})`, 'error'); selectSector(LETTERS.indexOf(L)); const si = LETTERS.indexOf(L), open = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(k => !(state?.opponent?.shots[cellOf(si, k)])).length; log(`ENTERING SECTOR ${L} · ${subnet(si)}\n${open} ADDRESSES AVAILABLE`, 'event'); return; }
  if (cmd === 'fire' && SECT() && /^[1-9]$/.test(parts[1] || '')) { if (sel < 0) return log('fire: no sector selected (try: target K)', 'error'); if (!myTurn()) return log('Error response from daemon: not your turn', 'error'); log(`TARGET RESOLVED: ${LETTERS[sel]}${parts[1]} (${ip(cellOf(sel, Number(parts[1])), true)}) · DEPLOYING PACKET…`, 'hit'); keypad(Number(parts[1])); return; }
  if (cmd === 'help') return log('Usage:  <command> [args]      (coordinates like e4 · nothing here touches a real host)\n\n  ping E4 [F5 …]          fire your salvo          (also: docker kill)\n  nmap K5 · traceroute K5 · hping3 K5 · oom K5      specials (warfare/chaos)\n  dnsmasq K5 · restic K5  decoy / repair in YOUR waters (free actions)\n  target K · fire 5       sector map: pick sector K, fire at K5\n  nmap E4                 PORT SCAN a 3×3 block    (reveals, no damage)\n  hping3 E4               SYN FLOOD a 3×3 block    (damage)\n  traceroute E4 [v]       TRACEROUTE a line of 5   (damage; v = column)\n  docker ps · map [mine]  fleet table · ASCII network map\n  new [easy|normal|hard|friend] [10|20|30]\n  invite · shuffle · ready · status · whoami · history · clear · fullscreen · exit');
  if (line.startsWith('docker ps') || cmd === 'fleet') return log(podsText());
  if (line.startsWith('kubectl get pods') || line.startsWith('docker service ps')) return log(podsText('k8s'));
  if (line.startsWith('kubectl get nodes') || line === 'kubectl get no') { if (!state) return log('No resources found in default namespace.'); const home = shotsFor('home');
    return log(['NAME            STATUS                     ROLES          AGE', ...FLEET.map(f => { const sh = state.me.ships.find(x => x.id === f.id), up = sh && sh.cells.some(c => (home[c] || 0) < 2), dr = (state.me.drains || []).includes(Object.keys(ROLE_FX)[f.kind % 5]);
      return `${f.name.padEnd(16)}${(up ? (dr ? 'Ready,SchedulingDisabled' : 'Ready') : 'NotReady').padEnd(27)}${ROLES[f.kind % 5].role.padEnd(15)}${state.turn_number}t`; }), '', state.me.ships.some(sh => sh.cells.every(c => (home[c] || 0) >= 2)) ? 'WARNING: Unexpected whale activity.' : ''].join('\n')); }
  if (cmd === 'map' || cmd === 'whalemap') return log(state ? asciiMap(parts[1] === 'mine' ? 'home' : 'target', false) : 'no cluster attached');
  if (cmd === 'shuffle') return act('RANDOMIZE_FLEET'); if (cmd === 'ready') return act('READY');
  if (cmd === 'status') return log(statusText()); if (cmd === 'whoami') return log(`${myName()} · ${profile.authenticated ? 'Fridge account' : 'guest captain'}`);
  if (cmd === 'clear') { termDo(() => $('#terminal-log').replaceChildren()); return; } if (cmd === 'history') return log(cmdHistory.join('\n'));
  if (cmd === 'exit') return state ? $('#leave-dialog').showModal() : openTerminal(false);
  if (cmd === 'fullscreen') return fullscreen();
  if (cmd === 'invite') { if (state?.mode === 'multiplayer') { log(inviteUrl(state.id)); copy(inviteUrl(state.id), 'Invite link copied!'); } else log('invite: no multiplayer match running (try: new friend)', 'error'); return; }
  if (cmd === 'new') { const rw = parts.find(p => RULE_INFO[p]); if (rw) { chosenRules = rw; try { localStorage.setItem('whaleship:rules', rw); } catch {} } const word = parts.slice(1).find(p => isNaN(Number(p)) && !RULE_INFO[p]) || 'solo', m = {solo: 'normal', easy: 'easy', normal: 'normal', hard: 'hard', friend: 'multiplayer'}[word], sz = 36; if (!m) return log('usage: new [easy|normal|hard|friend] [classic|warfare|chaos]', 'error'); openTerminal(false); return newGame(m, sz); }
  const eggs = {sudo: 'captain is not in the sudoers file. This incident will be reported.', uname: 'WhaleOS krill-6.8 x86_64 extremely-buoyant', fortune: 'A watched container never boils. Unless it is on fire.', 'docker whale': 'Whale is healthy. Emotionally, we cannot comment.', 'helm list': 'NAME   CHART              STATUS\nfleet  whaleship-0.7.0    deployed', 'kubectl get nodes': 'NAME     STATUS     ROLES\nmoby     Ready      docker-host\nwalrus   Ready      storage\ntux      NotReady   coffee-break', 'rm -rf /': 'nice try. the whales are read-only.', ls: 'Dockerfile  compose.yaml  krill/  definitely-not-secrets.env', top: 'PID  USER     %CPU COMMAND\n  1  moby     99.9 swim\n 42  tux       0.1 coffee'};
  log(eggs[line] || eggs[cmd] || `bash: ${cmd}: command not found`, eggs[line] || eggs[cmd] ? '' : 'error');
}

/* ---------------- sound: on by default, unlocked by the first tap ---------------- */
let soundOn = (() => { try { return localStorage.getItem('whaleship:sound') !== 'off'; } catch { return true; } })();
function paintSound() { const b = $('#sound-toggle'); b.setAttribute('aria-pressed', String(soundOn)); b.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off'); b.textContent = soundOn ? '🔊' : '🔇'; }
async function setSound(on, persist) { soundOn = on; if (persist) { try { localStorage.setItem('whaleship:sound', on ? 'on' : 'off'); } catch {} } paintSound(); try { await audio.enable(on); } catch { if (on) toast('Audio unavailable — every cue is also visual.'); } }
const unlock = e => { if (e.target.closest?.('#sound-toggle')) return; if (soundOn && !audio.isEnabled()) setSound(true); };
addEventListener('pointerdown', unlock, {capture: true}); addEventListener('keydown', unlock, {capture: true});

/* ---------------- wiring ---------------- */
async function copy(text, msg = 'Copied!') { try { await navigator.clipboard.writeText(text); toast(msg); audio.sound('copy'); } catch { toast('Copy this: ' + text); } }
async function share(url, text) { if (navigator.share && coarse()) { try { await navigator.share({title: 'WHALESHIP', text, url}); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(`${text} ${url}`, 'Copied — paste it anywhere!'); }
function pickSize(n) { chosenSize = n; try { localStorage.setItem('whaleship:size8', String(n)); } catch {} if (!state) { setSize(n); autoZoom(); } paintSizes(); render(); }
document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => pickSize(Number(b.dataset.size)));
$('#cta-solo').onclick = () => newGame($('#difficulty').value);
$('#cta-friend').onclick = () => newGame('multiplayer');
$('#cta-invite').onclick = () => openShare();
$('#share-copy').onclick = () => { copy($('#share-url').value, 'Link copied — send it! 🚀'); $('#share-url').select(); };
$('#share-native').onclick = async () => { try { await navigator.share({title: 'WHALESHIP', text: 'Battle me in WHALESHIP 🐋📡 — tap to play:', url: $('#share-url').value}); } catch {} };
$('#share-url').onclick = () => $('#share-url').select();
$('#new-game').onclick = () => openNewGame(); $('#games-btn').onclick = () => openNewGame();
$('#notify-enable').onclick = async () => { try { const p = await Notification.requestPermission(); toast(p === 'granted' ? '🔔 Desktop notifications on — we’ll tell you when it’s your move in any game.' : 'Notifications stay off. The 🗂 badge and tab title still show waiting games.'); } catch {} renderGameList(); };
document.querySelectorAll('#new-dialog [data-mode]').forEach(b => b.onclick = () => { $('#new-dialog').close(); $('#result-overlay').hidden = true; openTerminal(false); newGame(b.dataset.mode, chosenSize); });
$('#cta-shuffle').onclick = () => { held = null; act('RANDOMIZE_FLEET'); audio.sound('place'); };
$('#cta-ready').onclick = () => act('READY');
$('#cta-fire').onclick = () => fireVolley();
document.querySelectorAll('[data-rules]').forEach(b => b.onclick = () => { chosenRules = b.dataset.rules; try { localStorage.setItem('whaleship:rules', chosenRules); } catch {} audio.sound('select'); toast(`${RULE_INFO[chosenRules].label}: ${{classic: 'plain salvo battleship — no specials.', warfare: 'each creature powers abilities; specials have charges + cooldowns.', chaos: 'warfare plus random Kubernetes events (self-healing, CrashLoopBackOff, drains…).'}[chosenRules]}`); render(); });
$('#cta-forfeit').onclick = () => act('CLAIM_FORFEIT');
$('#cta-again').onclick = () => { $('#result-overlay').hidden = true; newGame(state?.mode || 'multiplayer', state?.size || chosenSize); };
$('#cta-share').onclick = () => { const won = state?.winner === state?.seat, mine = state?.attacks.filter(a => a.seat === state.seat && !a.reveal) || []; share('https://fridge.run/whaleship', `WHALESHIP ${SECT() ? 'sector map' : N + '×' + HT} incident report: ${won ? 'enemy cluster CATASTROPHIC FAILURE 🏆' : 'it works on my machine 💀'} · ${state?.turn_number} turns · ${mine.length} packets · ${mine.filter(a => a.hit).length} hits.`); };
$('#cta-notify').onclick = async () => { try { const p = await Notification.requestPermission(); toast(p === 'granted' ? '🔔 We’ll ping you when it’s your move (keep this tab open in the background).' : 'Notifications are off — the tab title still shows 🟢 on your turn.'); } catch {} render(); };
$('#view-target').onclick = () => slideTo('target'); $('#view-home').onclick = () => slideTo('home');
$('#result-overlay').onclick = () => $('#result-overlay').hidden = true;
$('#to-terminal').onclick = () => openTerminal(true); $('#to-game').onclick = () => openTerminal(false);
$('#term-back').onclick = () => openTerminal(false);
$('#term-watch').onclick = () => { const on = !document.body.classList.contains('term-watch'); document.body.classList.toggle('term-watch', on); $('#term-watch').setAttribute('aria-pressed', String(on)); watchSig = ''; renderWatch(); };
setInterval(renderWatch, 1000);
$('#terminal-form').onsubmit = e => { e.preventDefault(); command($('#command').value); $('#command').value = ''; };
$('#command').addEventListener('input', () => audio.sound('key'));
$('#stay').onclick = () => $('#leave-dialog').close();
document.querySelectorAll('#keypad [data-k]').forEach(b => b.onclick = () => keypad(Number(b.dataset.k)));
document.querySelectorAll('#chips [data-cmd]').forEach(b => b.onclick = () => command(b.dataset.cmd));
$('#confirm-leave').onclick = () => { if (state) act('LEAVE_MATCH'); showMenu(); $('#leave-dialog').close(); openTerminal(false); };
$('#sound-toggle').onclick = async () => { await setSound(!soundOn, true); if (soundOn) audio.sound('join'); };
$('#foam').addEventListener('animationiteration', foamDrift);
$('#sea').addEventListener('click', e => { if (!state && !suppressClick && !e.target.closest('button, a, select')) tileTap(-1); });
let sw = null;
for (const el of [$('#dock'), $('#screen-term')]) {
  el.addEventListener('touchstart', e => { const t = e.touches[0]; sw = {x: t.clientX, y: t.clientY}; }, {passive: true});
  el.addEventListener('touchend', e => { if (!sw) return; const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y; sw = null; if (Math.abs(dx) > 70 && Math.abs(dy) < 50) openTerminal(dx < 0); }, {passive: true});
}
document.addEventListener('keydown', e => {
  if (e.key === '`') { e.preventDefault(); openTerminal(!document.body.classList.contains('term-open')); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { if (e.key === 'Escape') openTerminal(false); return; }
  const k = e.key.toLowerCase();
  if (SECT() && myTurn() && !animating && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const li = /^[a-z]$/.test(k) || (sel < 0 && /^[0-9]$/.test(k)) ? LETTERS.indexOf(k.toUpperCase()) : -1;
    if (li >= 0 && li < NSEC()) { e.preventDefault(); if (view !== 'target' && !(armed && PI(armed).own)) slideTo('target'); selectSector(li); return; }
    if (/^[1-9]$/.test(k)) { e.preventDefault(); keypad(Number(k)); return; }
    if (k === 'enter') { e.preventDefault(); if (targets.size) fireVolley(); return; }
    if (k === 'backspace') { e.preventDefault(); backspace(); return; }
    if (k === 'escape' && sel >= 0) { e.preventDefault(); sel = -1; render(); return; }
    if (k === ' ' && armed && PI(armed).rot) { e.preventDefault(); rotN = (rotN + 1) & 3; if (hover >= 0) preview(hover); render(); return; }
    if (k === ' ') { e.preventDefault(); if (targets.size) fireVolley(); return; }   // Space or Enter transmits
  }
  if (k === ' ' && armed && PI(armed).rot) { e.preventDefault(); rotN = (rotN + 1) & 3; if (hover >= 0) preview(hover); render(); return; }
  if (k === 'r' && deploying() && !state.me.ready && held != null) { e.preventDefault(); rotateShip(held); }
  else if (k === 'r' && armed === 'tail') { tailVertical = !tailVertical; if (hover >= 0) preview(hover); render(); }
  else if (k === 'escape') { held = null; armed = null; targets.clear(); area = []; openTerminal(false); render(); }
  else if ((k === 'f' || k === ' ' || k === 'enter') && targets.size && myTurn()) { e.preventDefault(); fireVolley(); }
  else if (k === 'v' && state?.phase === 'playing') slideTo(view === 'target' ? 'home' : 'target');
  else if (k === '+' || k === '=') setZoom(zoom.z * 1.3, 0, 0, true); else if (k === '-') setZoom(zoom.z / 1.3, 0, 0, true); else if (k === '0') autoZoom();
});
window.addEventListener('storage', e => { if (e.key === prefs.KEY) { settings = prefs.load(); prefs.applyDocument(settings); audio.setLevels(settings); render(); } });
window.addEventListener('popstate', () => { const id = invitation(location.href); if (id && connected && id !== state?.id) { joining = true; join(id); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
new ResizeObserver(() => { $('#screen-game').style.setProperty('--hud-h', `${$('#dock').offsetHeight}px`); layout3D(); }).observe($('#dock'));
new ResizeObserver(() => { sizeFx(); sizeFoam(); applyZoom(); }).observe($('#sea'));
new ResizeObserver(() => sizePlane()).observe($('#board'));

R3 = await init3D();
async function init3D() {
  if (/[?&]2d\b/.test(location.search)) return null;
  try {
    if (!document.createElement('canvas').getContext('webgl2')) return null;
    const {createWorld} = await import('./ocean3d.js');
    const w = createWorld($('#world3d'), {quality: new URLSearchParams(location.search).get('q') || (coarse() ? 'low' : 'medium')});
    document.body.classList.add('r3d'); w.onSpout = () => audio.sound('blow'); return w;
  } catch (e) { console.warn('3D unavailable, using the 2D board', e); return null; }
}
paintSound(); setSize(chosenSize); buildBoardEvents(); zoomGestures(); prefs.applyDocument(settings); audio.setLevels(settings); sizeFx(); sizeFoam(); autoZoom(); render();
log(`Last login: ${new Date().toString().slice(0, 24)} on ttys001\nWhaleOS (moby) — infrastructure battleship\n\n * Your fleet is a stack: moby=docker host · k8s=orchestrator · walrus=storage · tux=linux host · squid=proxy\n * Fire:  ping q5      Specials:  nmap q5 · hping3 q5 · traceroute q5      How to play: the ? button\n * Type help. Nothing here runs on a real host.\n`);
setInterval(lifeTick, 850); setInterval(critterTick, 3000); setTimeout(critterTick, 700);
try {
  const r = await fetch('./api/profile'); if (!r.ok) throw Error(); profile = await r.json();
  try { seatKeys = JSON.parse(localStorage.getItem('whaleship:seats:' + profile.identity) || '{}'); active = localStorage.getItem('whaleship:active:' + profile.identity); } catch {}
  try { if (localStorage.getItem('whaleship:gen') !== GEN) { localStorage.setItem('whaleship:gen', GEN); if (active) toast(`WHALESHIP ${GEN} — fresh start. Your earlier games are under ＋.`); active = null; saveSession(); } } catch {}
  connect();
} catch { toast('Could not reach the harbor. Reload to try again.'); $('#status').textContent = '○ harbor offline'; }
