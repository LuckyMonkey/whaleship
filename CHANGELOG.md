# Changelog

## 0.20.0 — 2026-11-07

**3 captains: a quick game for three.** A new mode; two-player games, and games already in progress, are unchanged.

- **Three 9×9 maps**, one per captain, labelled **a–i**, **z–r** and **1–9**. Aim with the map's sector first, then the
  square inside (`b5`, `y3`, `47`), the same way as the other modes; typing a letter or number picks that map.
- **Everyone fires at once.** Each round every captain plans a volley of **5 pings** (more once a rival is down to its
  last creature) and splits them freely between both rivals. The round resolves when every captain still afloat has
  fired. A captain whose fleet is sunk is out; the last fleet afloat wins (a draw if the last two go down together).
- **Any mix of captains:** fridge players, someone holding the invite link, a second person on the same device
  (pass-and-play behind a curtain), and CPU captains (🐧 Penguin AI, 🐙 Squid AI). Empty seats can be filled from the
  lobby with a link, a CPU or a local captain.
- **Captains bar** over the map: who is aiming, who has fired, how many creatures each has left, and a **🔁 pass**
  chip for captains sharing your device.
- **Attract mode:** leave the home screen alone for a minute and a CPU-vs-CPU quick battle plays behind it (silently,
  never saved or scored). Any tap or key brings the menu straight back, without starting a game; it also leaves by
  itself when the battle ends or after four minutes.

## 0.19.0 — 2026-11-07

**Restore moves your creature.** Pinned per match (`pace` 2): games started before this release keep the old
one-segment repair until they finish.

- **💾 Restore** (warfare and chaos): pick a damaged (not sunk) segment of one of your creatures. The whole creature is
  restored from backup, undamaged, at a random spot whose bow lies inside the 5×5 square around that segment. It never
  lands on another creature, a decoy, an iceberg or water the enemy has already ruled out.
- **The enemy has to search again**: its misses in that 5×5 square, and every hit it had on the restored creature, are
  wiped, along with its scan results there. Its hits on other creatures stay.
- Nothing about the new spot is sent to the enemy; the record only carries the square and the segment you picked.
- **Link previews**: a cleaner cartoon whale on every card (proper raised tail, flipper, pale belly, a spout from the
  blowhole, containers on its back).

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
