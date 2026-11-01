#!/bin/bash
# Build + deploy WHALESHIP to the fridge.
#  - stamps a build id into every asset URL (?v=BUILD) so browser/Cloudflare caches can never mix versions
#  - stamps ONLY the `const BUILD = '__BUILD__'` declaration (the reload check compares against the literal)
#  - backs up the running version, rebuilds the container
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VER=${1:?usage: tools/ship.sh <version>}; B="$VER-$(date -u +%Y%m%d%H%M%S)"
( cd "$ROOT" && node --test test/ >/tmp/whaleship-test.log 2>&1 ) || { echo "tests failed — not deploying (see /tmp/whaleship-test.log)"; exit 1; }
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
cp -r "$ROOT"/{server.js,names.js,compose.yaml,Dockerfile,.dockerignore,package.json,package-lock.json,web} "$D"/
echo "$B" > "$D/web/BUILD"
sed -i "s|\./styles/game\.css\"|./styles/game.css?v=$B\"|; s|\./src/app\.js\"|./src/app.js?v=$B\"|; s|\./src/control\.js\"|./src/control.js?v=$B\"|" "$D/web/index.html" "$D/web/control.html"
sed -i "s|'\./audio\.js'|'./audio.js?v=$B'|; s|'\./settings\.js'|'./settings.js?v=$B'|; s|'\./creatures\.js'|'./creatures.js?v=$B'|; s|'\./ocean3d\.js'|'./ocean3d.js?v=$B'|; s|\./src/vendor/qrcode\.min\.js|./src/vendor/qrcode.min.js?v=$B|" "$D/web/src/app.js"
sed -i "s|^const BUILD = '__BUILD__';|const BUILD = '$B';|" "$D/web/src/app.js"
sed -i "s|'\./settings\.js'|'./settings.js?v=$B'|" "$D/web/src/control.js"
sed -i "s|url('\./mono\.css')|url('./mono.css?v=$B')|" "$D/web/styles/game.css"
sed -i "s|\./styles/how\.css\"|./styles/how.css?v=$B\"|" "$D/web/how.html"
sed -i "s|'\./vendor/three\.module\.min\.js'|'./vendor/three.module.min.js?v=$B'|" "$D/web/src/ocean3d.js"
sed -i "s|image: whaleship2:.*|image: whaleship2:$VER|" "$D/compose.yaml"
grep -q "const BUILD = '$B'" "$D/web/src/app.js" && grep -q "BUILD !== '__BUILD__'" "$D/web/src/app.js" && grep -q "ocean3d.js?v=$B" "$D/web/src/app.js" && grep -q "three.module.min.js?v=$B" "$D/web/src/ocean3d.js" || { echo "stamp check failed"; exit 1; }
node --check "$D/server.js"; node --check "$D/web/src/app.js"
tar czf "$D.tgz" -C "$D" . && scp -q "$D.tgz" fridge:/home/fridge/ship.tgz && rm -f "$D.tgz"
ssh fridge "TS=\$(date -u +%Y%m%dT%H%M%SZ); echo fridge | sudo -S -p '' sh -c \"cp -a /srv/apps/whaleship2 /srv/apps/deploy-backups/whaleship2-before-$VER-\$TS && tar xzf /home/fridge/ship.tgz -C /srv/apps/whaleship2 && cd /srv/apps/whaleship2 && docker compose build -q && docker compose up -d 2>&1 | tail -1\"; rm -f /home/fridge/ship.tgz; echo backup: whaleship2-before-$VER-\$TS"
echo "BUILD $B"
