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
// Cartoon mascot: a smiling Docker-ish whale with a container rack, a spout, and a speech bubble.
function whale(x, y, s, say, mood = 'happy') {
  const eye = mood === 'dizzy'
    ? '<path d="M258 108 L282 132 M282 108 L258 132" stroke="#04121c" stroke-width="7" stroke-linecap="round"/>'
    : '<circle cx="270" cy="118" r="17" fill="#fff" stroke="#04121c" stroke-width="5"/><circle cx="274" cy="121" r="9" fill="#04121c"/><circle cx="277" cy="116" r="3.5" fill="#fff"/>';
  const mouth = mood === 'dizzy' ? '<path d="M250 168 Q262 156 274 168 Q286 180 298 166" stroke="#04121c" stroke-width="6" fill="none" stroke-linecap="round"/>'
    : '<path d="M246 158 Q276 190 306 156" stroke="#04121c" stroke-width="6" fill="#ff8fb1" stroke-linecap="round"/>';
  const bw = Math.round(say.length * 15.5 + 48);
  return `<g transform="translate(${x} ${y}) scale(${s})">
  <g transform="translate(${330 - bw} -150) rotate(3)"><rect x="3" y="6" width="${bw}" height="68" rx="22" fill="#04121c"/><rect width="${bw}" height="68" rx="22" fill="#fff" stroke="#04121c" stroke-width="5"/><path d="M${bw - 90} 64 L${bw - 70} 100 L${bw - 50} 64 Z" fill="#fff" stroke="#04121c" stroke-width="5" stroke-linejoin="round"/><rect x="${bw - 95}" y="58" width="50" height="9" fill="#fff"/>
    <text x="${bw / 2}" y="45" text-anchor="middle" font-family="Lilita One" font-size="30" fill="#04121c">${esc(say)}</text></g>
  <g fill="#9fe6ff" stroke="#04121c" stroke-width="4" stroke-linejoin="round"><path transform="translate(292 30) rotate(-32)" d="M0 0 C-12 -16 -10 -34 0 -48 C10 -34 12 -16 0 0 Z"/><path transform="translate(300 26) scale(1.15)" d="M0 0 C-12 -16 -10 -34 0 -48 C10 -34 12 -16 0 0 Z"/><path transform="translate(308 30) rotate(32)" d="M0 0 C-12 -16 -10 -34 0 -48 C10 -34 12 -16 0 0 Z"/><circle cx="246" cy="-40" r="7"/><circle cx="356" cy="-44" r="6"/></g>
  <path d="M58 150 C34 128 18 96 2 66 C30 70 52 92 64 116 C70 84 88 62 116 50 C104 88 88 122 72 152 Z" fill="#1d63ed" stroke="#04121c" stroke-width="6" stroke-linejoin="round"/>
  <path d="M40 140 C40 76 126 40 214 44 C298 48 344 100 344 152 C344 210 280 232 196 232 C106 232 40 206 40 140 Z" fill="#1d63ed" stroke="#04121c" stroke-width="6"/>
  <path d="M72 180 C130 222 262 222 330 176 C318 210 266 226 198 226 C130 226 88 210 72 180 Z" fill="#cfeaff"/>
  <g stroke="#04121c" stroke-width="5" stroke-linejoin="round">
    <rect x="112" y="-2" width="62" height="46" rx="4" fill="#ffcb3b"/><rect x="176" y="-2" width="62" height="46" rx="4" fill="#ff754f"/><rect x="138" y="-44" width="62" height="44" rx="4" fill="#23e4d0"/>
  </g>
  <g stroke="#04121c" stroke-width="3" opacity=".45"><path d="M128 6v30M143 6v30M158 6v30M192 6v30M207 6v30M222 6v30M154 -36v28M169 -36v28M184 -36v28"/></g>
  ${eye}<ellipse cx="300" cy="150" rx="15" ry="8" fill="#ff8fb1" opacity=".75"/>${mouth}
  <path d="M150 170 C170 196 206 200 226 176" stroke="#0b3fa8" stroke-width="5" fill="none" stroke-linecap="round" opacity=".6"/>
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
