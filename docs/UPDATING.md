# Updating WHALESHIP without losing games

Games have no time limit, so there are almost always matches in progress when a new version ships.
An update must never lose one, corrupt one, or change its rules halfway through.

## How state carries across an update

- **Matches live on disk, not in the container.** Each match is `DATA_DIR/matches/<id>.json`, written atomically
  (`.tmp` + rename). Mount `DATA_DIR` as a volume; rebuilding or replacing the container doesn't touch it.
- **Clean shutdown.** On `SIGTERM` the server flushes every pending save before exiting.
- **Clients reconnect themselves.** Each browser keeps its seat credential; after the swap it reconnects, notices
  the new build, reloads once and resumes the same seat.
- **Schema versions + migrations** (`server.js`: `SCHEMA`, `MIGRATIONS`, `migrate()`). Every match records `v`.
  On load, older files are upgraded one step at a time in memory and written back on their next save.
  A file from a *newer* schema (you rolled back) is skipped and left byte-for-byte untouched; it loads again once
  the newer server is back.
- **Rules are pinned per match.** Rule changes are gated on a field stamped at creation (e.g. `m.pace` for the
  0.18 endgame salvo), so games started before the update finish under the rules they started with.
- **Validation.** Every loaded match is checked (seat boards match the board size, ship cells are in range).
  A match that fails is logged and left on disk, never deleted or rewritten.

## Adding a rule or schema change

1. Bump `SCHEMA`. Add `MIGRATIONS[oldVersion] = m => { ... }` that fills in the new field for old matches,
   choosing the value that keeps their *old* behaviour.
2. Stamp the new value on new matches in `CREATE_MATCH`, and gate the new behaviour on it.
3. Extend the `state transfer` test in `test/rules.test.mjs`.

## Deploying (fridge)

`tools/deploy-fridge.sh` (on fridge: `~/fridge-recovery/scripts/whaleship2-deploy.sh`):

1. snapshot the data directory to a private tarball
2. build the new image; the old container keeps serving
3. **dry run**: the new image runs `node server.js --check-data` against a read-only copy of the saved matches,
   with no network. Any failure aborts here and leaves the live game untouched
4. `docker compose up -d`: the old server flushes and exits, the new one loads the same files
5. verify the new server is healthy and loaded at least as many matches as the dry run; otherwise it prints the
   rollback commands

Run the dry run on its own at any time:

```sh
DATA_DIR=$(mktemp -d) node server.js --check-data /path/to/copy/of/matches
```

## Rollback

Older servers ignore fields they don't know, so pointing the container back at the previous image is safe and
keeps every move made since. Restore the data snapshot only if saves were actually damaged; that loses the moves
made after the snapshot.
