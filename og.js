'use strict';
// WHALESHIP link-preview cards: 1200×630 PNGs drawn from live match state (who, board, mode, score, result) and
// rendered with resvg (SVG → pixels → JPEG, fonts bundled in og/fonts, no system fonts, no network).
// Backgrounds are text-free plates rendered from the game itself (og/plates/<quick|full>-<rules>.jpg).
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'og');
const FONTS = ['LilitaOne-Regular.ttf', 'Nunito-ExtraBold.ttf', 'Nunito-Black.ttf'].map(f => path.join(DIR, 'fonts', f));
const plates = {};
const plate = key => plates[key] ??= 'data:image/jpeg;base64,' + fs.readFileSync(path.join(DIR, 'plates', key + '.jpg')).toString('base64');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// names: drop characters the bundled fonts can't draw (emoji etc.), keep it short
const tidy = (s, n = 22) => { const t = String(s || '').replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').replace(/\s+/g, ' ').trim() || 'A captain'; return t.length > n ? t.slice(0, n - 1) + '…' : t; };
// no text layout engine: size text from an average glyph width so it always fits its box
const fit = (text, maxW, size, k) => Math.floor(Math.min(size, maxW / (Math.max(4, text.length) * k)));

const MODE = { classic: ['CLASSIC', '#4da3ff'], warfare: ['WARFARE', '#23e4d0'], chaos: ['CHAOS', '#ff5a36'] };
const BOARD = { quick: 'QUICK · 9 SECTORS · ~5 MIN', full: 'FULL OCEAN · 36 SECTORS' };
const H = (t, x, y, size, fill = '#fff', extra = '') =>      // display text: Lilita One with a chunky outline
  `<text x="${x}" y="${y}" font-family="Lilita One" font-size="${size}" fill="${fill}" stroke="#04121c" stroke-width="${Math.max(6, size * .12)}" stroke-linejoin="round" paint-order="stroke" ${extra}>${esc(t)}</text>`;
const T = (t, x, y, size, fill = '#d6f1ff', weight = 900, extra = '') =>
  `<text x="${x}" y="${y}" font-family="Nunito" font-weight="${weight}" font-size="${size}" fill="${fill}" ${extra}>${esc(t)}</text>`;
function sticker(text, x, y, fill, color = '#04121c', rot = -3, size = 30) {
  const w = Math.round(text.length * size * .56 + 44);
  return `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="3" y="6" width="${w}" height="${size + 26}" rx="${(size + 26) / 2}" fill="#04121c"/><rect width="${w}" height="${size + 26}" rx="${(size + 26) / 2}" fill="${fill}" stroke="#04121c" stroke-width="4"/>` +
    `<text x="${w / 2}" y="${size + 6}" text-anchor="middle" font-family="Lilita One" font-size="${size}" fill="${color}">${esc(text)}</text></g>`;
}
function chip(text, x, y, fill, color = '#04121c') {
  const w = Math.round(text.length * 15.2 + 36);
  return { w, svg: `<g transform="translate(${x} ${y})"><rect width="${w}" height="44" rx="22" fill="${fill}" stroke="#04121c" stroke-width="3"/><text x="${w / 2}" y="30" text-anchor="middle" font-family="Nunito" font-weight="900" font-size="22" fill="${color}">${esc(text)}</text></g>` };
}
function chips(list, x, y) { let out = ''; for (const [t, f, c] of list) { const ch = chip(t, x, y, f, c); out += ch.svg; x += ch.w + 12; } return out; }
function cta(text, x, y, sub) {
  const w = Math.round(text.length * 23.5 + 120), h = 92;
  return `<g transform="translate(${x} ${y})"><rect x="0" y="10" width="${w}" height="${h}" rx="28" fill="#04121c"/><rect width="${w}" height="${h}" rx="28" fill="#ffd34d" stroke="#04121c" stroke-width="5"/>` +
    `<rect x="10" y="8" width="${w - 20}" height="20" rx="10" fill="#fff" opacity=".35"/>` +
    `<text x="34" y="62" font-family="Lilita One" font-size="44" fill="#04121c">${esc(text)}</text>` +
    `<path d="M${w - 66} 26 L${w - 30} 46 L${w - 66} 66 Z" fill="#1d63ed" stroke="#04121c" stroke-width="4" stroke-linejoin="round"/></g>` +
    (sub ? T(sub, x + 6, y + h + 44, 22, '#9fd8ea', 800) : '');
}
// Cartoon mascot: a side-on whale facing right - big round head, a body that tapers into a raised two-lobed fluke,
// a flipper, a jaw-line smile, a pale belly with throat grooves, a blowhole spout, and the Docker-ish container stack
// tucked onto its back (drawn first, so the body overlaps the boxes' bottoms). Flat fills, one bold outline, no wobble.
function whale(x, y, s, say, mood = 'happy') {
  const O = 'stroke="#04121c" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"';
  const eye = mood === 'dizzy'
    ? '<path d="M290 116 L312 138 M312 116 L290 138" stroke="#04121c" stroke-width="7" stroke-linecap="round"/>'
    : '<circle cx="300" cy="126" r="16" fill="#fff" stroke="#04121c" stroke-width="5"/><circle cx="304" cy="129" r="8.5" fill="#04121c"/><circle cx="307" cy="124" r="3.2" fill="#fff"/>';
  const mouth = mood === 'dizzy'
    ? '<path d="M350 166 Q338 158 326 168 Q314 178 300 168" fill="none" ' + O + '/>'
    : '<path d="M351 160 C336 178 306 184 282 172" fill="none" ' + O + '/><path d="M284 166 C280 170 279 176 282 180" fill="none" stroke="#04121c" stroke-width="5" stroke-linecap="round"/>';
  const bw = Math.round(say.length * 15.5 + 48);
  return `<g transform="translate(${x} ${y}) scale(${s})">
  <g transform="translate(${330 - bw} -150) rotate(3)"><rect x="3" y="6" width="${bw}" height="68" rx="22" fill="#04121c"/><rect width="${bw}" height="68" rx="22" fill="#fff" stroke="#04121c" stroke-width="5"/><path d="M${bw - 90} 64 L${bw - 70} 100 L${bw - 50} 64 Z" fill="#fff" stroke="#04121c" stroke-width="5" stroke-linejoin="round"/><rect x="${bw - 95}" y="58" width="50" height="9" fill="#fff"/>
    <text x="${bw / 2}" y="45" text-anchor="middle" font-family="Lilita One" font-size="30" fill="#04121c">${esc(say)}</text></g>
  <path d="M40 252 C80 240 120 264 160 252 C200 240 240 264 280 252 C310 243 336 256 360 250" fill="none" stroke="#9fe6ff" stroke-width="7" stroke-linecap="round" opacity=".7"/>
  <g stroke="#04121c" stroke-width="5" stroke-linejoin="round">
    <rect x="146" y="18" width="58" height="50" rx="5" fill="#ffcb3b"/><rect x="206" y="18" width="58" height="50" rx="5" fill="#ff754f"/><rect x="176" y="-24" width="58" height="44" rx="5" fill="#23e4d0"/>
  </g>
  <g stroke="#04121c" stroke-width="3" opacity=".4"><path d="M161 26v34M175 26v34M189 26v34M221 26v34M235 26v34M249 26v34M191 -16v28M205 -16v28M219 -16v28"/></g>
  <path d="M44 132 C30 108 6 92 -20 94 C-8 110 6 124 22 134 C4 142 -14 158 -24 180 C2 178 28 162 44 146 Z" fill="#1d63ed" ${O}/>
  <path d="M352 150 C352 96 304 60 226 60 C160 60 118 86 90 118 C76 134 62 132 42 130 L44 150 C62 152 76 172 104 198 C146 228 208 236 262 234 C324 232 352 204 352 150 Z" fill="#1d63ed" ${O}/>
  <rect x="34" y="134" width="18" height="12" fill="#1d63ed"/>
  <path d="M112 194 C150 222 206 232 262 230 C318 228 348 202 351 166 C334 192 302 204 258 206 C204 210 152 206 112 194 Z" fill="#cfeaff"/>
  <g stroke="#9cc8ec" stroke-width="4" stroke-linecap="round"><path d="M214 214 C246 220 284 216 312 204M226 223 C258 228 292 223 322 210"/></g>
  <path d="M150 94 C192 72 252 66 296 82 C252 78 196 86 160 106 Z" fill="#fff" opacity=".22"/>
  <path d="M256 186 C258 214 246 236 222 250 C250 254 276 234 282 198 Z" fill="#1650c8" ${O}/>
  <ellipse cx="302" cy="70" rx="9" ry="4" fill="#04121c"/>
  <g fill="none" stroke-linecap="round"><g stroke="#04121c" stroke-width="15"><path d="M300 66 C296 40 282 24 262 18"/><path d="M304 66 C310 40 326 24 346 20"/></g><g stroke="#9fe6ff" stroke-width="7"><path d="M300 66 C296 40 282 24 262 18"/><path d="M304 66 C310 40 326 24 346 20"/></g></g>
  <g fill="#9fe6ff" stroke="#04121c" stroke-width="4"><circle cx="252" cy="4" r="7"/><circle cx="358" cy="2" r="6"/><circle cx="304" cy="10" r="5"/></g>
  ${eye}<ellipse cx="320" cy="168" rx="13" ry="7" fill="#ff8fb1" opacity=".8"/>${mouth}
</g>`;
}
function pips(total, sunk, x, y) {   // one hull per vessel: filled = afloat, red X = sunk
  let out = '';
  for (let i = 0; i < total; i++) {
    const px = x + i * 40, down = i >= total - sunk;
    out += `<rect x="${px}" y="${y}" width="32" height="20" rx="10" fill="${down ? '#3a1712' : '#23e4d0'}" stroke="#04121c" stroke-width="3"/>` +
      (down ? `<path d="M${px + 9} ${y + 3} L${px + 23} ${y + 17} M${px + 23} ${y + 3} L${px + 9} ${y + 17}" stroke="#ff754f" stroke-width="4" stroke-linecap="round"/>` : '');
  }
  return out;
}

// info: { kind: 'invite'|'battle'|'result'|'default', board, rules, a, b, turn, fleet, sunkA, sunkB, winner, loser, shots, hits }
function cardSvg(info) {
  const board = info.board === 'quick' ? 'quick' : 'full', rules = MODE[info.rules] ? info.rules : 'warfare', [modeName, modeCol] = MODE[rules];
  let body = '', say = 'your move, captain!', mood = 'happy';
  const L = 60, W = 680;
  if (info.kind === 'invite') {
    const name = tidy(info.a);
    body = sticker('INCOMING CHALLENGE!', L, 118, '#ffd34d') +
      H(name, L, 268, fit(name, W, 88, .5)) +
      T('wants to sink your stack.', L, 320, 38) +
      chips([[BOARD[board], '#e9f8ff'], [modeName + ' MODE', modeCol]], L, 350) +
      cta('ACCEPT & FIRE BACK', L, 432, 'free · no account · no install · works on your phone');
  } else if (info.kind === 'battle') {
    const a = tidy(info.a, 18), b = tidy(info.b, 18), size = Math.min(fit(a, 560, 60, .5), fit(b, 560, 60, .5));
    body = sticker(`BATTLE IN PROGRESS · TURN ${info.turn || 1}`, L, 112, '#23e4d0') +
      H(a, L, 236, size) + pips(info.fleet, info.sunkA, L + 4, 256) +
      `<g transform="translate(${L + 470} 266) rotate(-8)"><circle r="34" fill="#ff5a36" stroke="#04121c" stroke-width="5"/><text y="13" text-anchor="middle" font-family="Lilita One" font-size="36" fill="#fff">VS</text></g>` +
      H(b, L, 350, size) + pips(info.fleet, info.sunkB, L + 4, 370) +
      chips([[BOARD[board], '#e9f8ff'], [modeName, modeCol]], L, 410) +
      cta('JUMP INTO THE BATTLE', L, 476);
    say = 'glub glub… FIRE!';
  } else if (info.kind === 'trio-invite') {
    const name = tidy(info.a), open = info.open || 1;
    body = sticker('3-CAPTAIN BATTLE!', L, 118, '#ffd34d') +
      H(name, L, 262, fit(name, W, 84, .5)) +
      T(open > 1 ? 'needs two more captains. Grab a seat!' : `and ${tidy(info.b, 18)} need a third captain.`, L, 312, fit('and ' + tidy(info.b, 18) + ' need a third captain.', W, 36, .52)) +
      chips([['3 CAPTAINS · 3 MAPS', '#ffd34d'], ['QUICK · EVERYONE FIRES AT ONCE', '#e9f8ff']], L, 346) +
      cta('TAKE A SEAT', L, 432, 'free · no account · no install · works on your phone');
    say = 'three-way brawl!';
  } else if (info.kind === 'trio-battle') {
    const ns = info.names.map(n => tidy(n, 16)), size = Math.min(...ns.map(n => fit(n, 420, 50, .5)));
    body = sticker(`3-CAPTAIN BATTLE · ROUND ${info.turn || 1}`, L, 104, '#23e4d0') +
      ns.map((n, i) => H(n, L, 214 + i * 86, size, info.out[i] ? '#8aa3b3' : '#fff') + pips(info.fleet, info.sunk[i], L + 4, 230 + i * 86) +
        (info.out[i] ? sticker('SUNK', L + 470, 180 + i * 86, '#ff5a36', '#fff', -6, 26) : '')).join('') +
      cta('JUMP INTO THE BATTLE', L, 470);
    say = 'everyone fire!';
  } else if (info.kind === 'trio-result') {
    const w = tidy(info.winner, 18), rest = info.losers.map(n => tidy(n, 14)).join(' and ');
    body = sticker('LAST FLEET AFLOAT!', L, 118, '#ffd34d') +
      H(w + ' wins!', L, 262, fit(w + ' wins!', W, 84, .5), '#ffd34d') +
      T(`sank ${rest} in ${info.turn} rounds`, L, 314, fit(`sank ${rest} in ${info.turn} rounds`, W, 34, .52)) +
      chips([['3 CAPTAINS', '#ffd34d'], [`${info.turn} ROUNDS`, '#e9f8ff'], [`${info.hits} HITS`, '#ff754f', '#fff']], L, 346) +
      cta('THINK YOU CAN DO BETTER?', L, 432, 'play free · 3 captains, or 1-on-1');
    say = 'gg! rematch?'; mood = 'dizzy';
  } else if (info.kind === 'trio-draw') {
    body = sticker('3-CAPTAIN BATTLE', L, 118, '#ffd34d') + H('Nobody survived!', L, 262, 80) +
      T(info.names.map(n => tidy(n, 14)).join(', ') + ': all sunk in the same round', L, 314, 30) + cta('PLAY AGAIN', L, 432);
    say = 'glub…'; mood = 'dizzy';
  } else if (info.kind === 'result') {
    const w = tidy(info.winner, 18), l = tidy(info.loser, 20), acc = info.shots ? Math.round(100 * info.hits / info.shots) : 0;
    body = `<g transform="translate(${L + 330} 74) rotate(-7)" opacity=".92"><rect width="300" height="62" rx="10" fill="none" stroke="#ff5a36" stroke-width="6"/><rect x="8" y="8" width="284" height="46" rx="6" fill="none" stroke="#ff5a36" stroke-width="2"/><text x="150" y="44" text-anchor="middle" font-family="Lilita One" font-size="32" fill="#ff5a36">INCIDENT REPORT</text></g>` +
      sticker('VICTORY!', L, 118, '#ffd34d') +
      H(w + ' wins!', L, 262, fit(w + ' wins!', W, 84, .5), '#ffd34d') +
      T(`sank ${l}'s entire stack in ${info.turn} turns`, L, 314, fit(`sank ${l}'s entire stack in ${info.turn} turns`, W, 34, .52)) +
      chips([[`${info.turn} TURNS`, '#e9f8ff'], [`${acc}% ACCURACY`, '#23e4d0'], [`${info.hits} HITS`, '#ff754f', '#fff'], [modeName, modeCol]], L, 346) +
      cta('THINK YOU CAN DO BETTER?', L, 432, 'play free · solo vs AI or challenge a friend');
    say = 'gg! rematch?'; mood = 'dizzy';
  } else {
    body = sticker('BATTLESHIP, BUT INFRASTRUCTURE', L, 118, '#ffd34d') +
      H('Sink their stack.', L, 262, 92) +
      T('Container whales vs Kubernetes carriers.', L, 316, 34) +
      chips([['QUICK · ~5 MIN', '#ffd34d'], ['SOLO OR WITH A FRIEND', '#e9f8ff'], ['3 MODES', '#23e4d0']], L, 346) +
      cta('PLAY FREE NOW', L, 432, 'no account · no install · works on your phone');
    say = 'come play!';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<image href="${plate(board + '-' + rules)}" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>
<rect width="1200" height="8" fill="${modeCol}"/>
<g transform="translate(${L} 30)"><g transform="scale(.62)"><path d="M7 23H60V13L76 22L67 32C64 53 20 59 9 37Z" fill="#1d63ed" stroke="#e9f8ff" stroke-width="4"/><path d="M17 10h14v15H17zm16 0h14v15H33zm16 0h10v15H49z" fill="#ffcb3b" stroke="#e9f8ff" stroke-width="3"/></g>
<text x="58" y="30" font-family="Lilita One" font-size="32" fill="#fff">WHALESHIP</text></g>
${whale(870, 400, .78, say, mood)}
${body}
</svg>`;
}

let Resvg = null, Jpeg = null;
const jpeg = () => Jpeg ??= require('jpeg-js');   // JPEG keeps cards ~150 KB (WhatsApp ignores previews over ~300 KB)
function renderer() { return Resvg ??= require('@resvg/resvg-js'); }
const cache = new Map();                  // key → Promise<Buffer>; small LRU so crawlers can't make us re-render
let inflight = 0;
function renderCard(key, info) {
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  if (inflight >= 4) return Promise.reject(new Error('busy'));
  inflight++;
  const p = renderer().renderAsync(cardSvg(info), { fitTo: { mode: 'width', value: 1200 }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Nunito' } })
    .then(img => jpeg().encode({ data: img.pixels, width: img.width, height: img.height }, 84).data).finally(() => inflight--);
  cache.set(key, p); p.catch(() => cache.delete(key));
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  return p;
}
module.exports = { renderCard, cardSvg };
