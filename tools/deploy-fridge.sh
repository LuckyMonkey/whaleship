#!/bin/sh
# WHALESHIP deploy with game-state transfer — games in progress are never lost or rewritten under new rules.
#
#   1. snapshot the live data directory (private tarball)
#   2. build the new image while the old container keeps serving
#   3. DRY RUN: the new image loads a copy of every saved match (read-only, no network); any failure aborts here
#   4. swap containers — SIGTERM makes the old server flush pending saves; the data volume carries over
#   5. verify the new server loaded at least as many matches as the dry run, else print rollback steps
#
# Run on fridge (needs sudo for docker):  sh ~/fridge-recovery/scripts/whaleship2-deploy.sh
# Matches keep the rules they started with (server.js: SCHEMA / MIGRATIONS / m.pace). Older servers ignore new fields,
# so rolling back the image is safe; newer-schema files are left untouched by an older-aware server.
set -eu
APP=${APP:-/srv/apps/whaleship2}
DATA=${DATA:-/srv/data/whaleship2}
CTR=${CTR:-whaleship2-api}
TS=$(date -u +%Y%m%dT%H%M%SZ)
SNAP="$HOME/fridge-recovery/whaleship2-data-$TS.tgz"
LOG="$HOME/bootstrap-notes/agent-command-log.md"
log() { echo "$(date -Is) whaleship2-deploy: $*" | tee -a "$LOG"; }
num() { sed -n "s/.*\"$1\": *\([0-9]*\).*/\1/p" "$2" | head -1; }

cd "$APP"
NEW=$(sed -n 's/^ *image: *\(whaleship2:[^ ]*\).*/\1/p' compose.override.yaml)
OLD=$(sudo docker inspect -f '{{.Config.Image}}' "$CTR" 2>/dev/null || echo none)
log "start: $OLD -> $NEW (build $(cat web/BUILD))"

# 1 — snapshot
( umask 077; tar czf "$SNAP" -C "$(dirname "$DATA")" "$(basename "$DATA")" )
log "1/5 snapshot $SNAP ($(tar tzf "$SNAP" | grep -c 'matches/.*\.json$') match files)"

# 2 — build (old container still serving)
sudo docker compose build
log "2/5 built $NEW"

# 3 — dry run against a copy of the snapshot
CHK=$(mktemp -d); trap 'rm -rf "$CHK"' EXIT
tar xzf "$SNAP" -C "$CHK"; chmod -R a+rX "$CHK/$(basename "$DATA")/matches"
if ! sudo docker run --rm --network none -e DATA_DIR=/tmp/chk -v "$CHK/$(basename "$DATA")/matches:/check:ro" "$NEW" \
     node server.js --check-data /check > "$CHK/report.json"; then
  cat "$CHK/report.json"; log "ABORT at 3/5: $NEW cannot load every saved game. Live container untouched ($OLD)."; exit 1
fi
PRE=$(num loaded "$CHK/report.json"); ACTIVE=$(num active "$CHK/report.json"); MIG=$(num migrated "$CHK/report.json")
log "3/5 dry run ok: $PRE matches load ($ACTIVE in progress, $MIG migrated)"

# 4 — swap
sudo docker compose up -d
log "4/5 swapped to $NEW"

# 5 — verify
ok=
for i in $(seq 40); do sudo docker exec "$CTR" wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 && ok=1 && break; sleep 1; done
LINE=$(sudo docker logs "$CTR" 2>&1 | grep 'loaded [0-9]* matches' | tail -1)
POST=$(echo "$LINE" | sed -n 's/.*loaded \([0-9]*\) matches.*/\1/p')
if [ -z "$ok" ] || [ -z "$POST" ] || [ "$POST" -lt "$PRE" ]; then
  log "VERIFY FAILED: healthy=${ok:-no} loaded=${POST:-?} expected>=$PRE — $LINE"
  echo "Rollback (games stay on disk; old servers read newer saves):"
  echo "  cd $APP && sed -i 's#image: $NEW#image: $OLD#' compose.override.yaml && sudo docker compose up -d"
  echo "Data restore ONLY if saves were damaged (loses moves made since $TS):"
  echo "  sudo docker compose stop && sudo tar xzf $SNAP -C $(dirname "$DATA") && sudo docker compose up -d"
  exit 1
fi
log "5/5 verified: $LINE"
