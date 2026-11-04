# Changelog

## 0.18.1 — 2026-11-04

**Smoother turns: no more flashing between your ocean and theirs.** Client-only; the server, saved matches and their
rules are unchanged, so games in progress carry on exactly as they were.

- **No background flash**: in 3D the camera now glides across the ocean to the other fleet. Before, the whole 3D
  canvas slid and faded, and the flat sky colour behind it flashed through on every turn change.
- **One move per volley**: a shot no longer jumps to your own fleet and back before it lands. The ocean changes at most
  once, before the packets fly.
- **Cleaner launch paths**: packets come in from the sender's edge (yours from the bottom, theirs from the top) on a
  low arc sized to the distance, instead of steep arcs from random cells that crossed the whole screen.
- **Switching games**: a short fade instead of a hard cut when you jump between matches.
- 2D board (no WebGL2): a shorter slide that keeps the board visible through the swap.

## 0.18.0 — 2026-11-03

**Quick games, faster endgames, link previews that sell the game, and updates that never break a game in progress.**

### Gameplay
- **⚡ Quick board**: 9×9, sectors `A`–`I` (3×3 keypads), one vessel of each role (Moby 5, carrier 4, walrus 3,
  Tux 3, squid 2), salvo 3, two firewall icebergs, one charge per special. QUICK / FULL picker on the start screen
  and in Games; terminal `new … quick|full`.
- **Faster endgames**: losing vessels costs at most one ping (the salvo no longer collapses to one shot), and once the
  enemy is down to two vessels you get a +1 mop-up ping. Applies to matches created from 0.18 on.

### Safe updates (game-state transfer)
- Saved matches carry a schema version (`SCHEMA = 4`); `MIGRATIONS` upgrade old saves on load; files from a newer
  schema are left untouched; invalid saves are logged, never deleted.
- Rules are pinned per match (`m.pace`): games in progress finish under the rules they started with.
- `node server.js --check-data DIR` dry run; `tools/deploy-fridge.sh` (snapshot → build → dry run → swap → verify).
  See [docs/UPDATING.md](docs/UPDATING.md). First real run: 17 saved games (4 in progress) carried over, 0 failed.

### Link previews
- Every page gets Open Graph / Twitter tags. `?j=` invites and `?r=` brag links unfurl with a **1200×630 card drawn
  from the live match** (`/whaleship/og/<id>.jpg`): "X challenges you" + ACCEPT & FIRE BACK, a scoreboard for games in
  progress, an INCIDENT REPORT for results, and a default card. Cartoon whale mascot. Rendered with resvg → JPEG
  (~150–200 KB) from an SVG template ([og.js](og.js)); fonts Lilita One + Nunito (OFL) bundled in `og/fonts`.
- The BRAG button shares a `?r=` result link instead of the bare game URL.

### Art and how-to
- How-to rewritten for both boards; new screenshots, creature portraits, hero art, promo banners — all rendered from
  the game itself (`web/img/`).

### Tests
- 15 server tests: quick board, endgame pace, state transfer across an update, link previews.
