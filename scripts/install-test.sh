#!/bin/bash
# Проверка установщика в чистом контейнере (Debian 12 / Astra 1.8) без интернета для приложения.
#   scripts/install-test.sh <архив пакета>
set -euo pipefail
TAR="$1"

# В минимальных образах может не быть curl — ставим, если есть пакетный менеджер.
command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl >/dev/null; } || true

W="$(mktemp -d)"
tar -xzf "$TAR" -C "$W"
cd "$W"/rtspatom-*

./install.sh --no-start --port 18090 </dev/null
test -x /opt/rtspatom/node/bin/node
test -x /opt/rtspatom/mediamtx/mediamtx
test -f /etc/rtspatom/config.json
test -f /etc/rtspatom/mediamtx.yml
/opt/rtspatom/node/bin/node --version
/opt/rtspatom/mediamtx/mediamtx --version

echo 'install-test-pass' | rtspatom-admin create-admin admin --password-stdin
rtspatom-admin list-users | grep -q admin

cd /var/lib/rtspatom
runuser -u rtspatom -- /opt/rtspatom/mediamtx/mediamtx /etc/rtspatom/mediamtx.yml > /tmp/mtx.log 2>&1 &
runuser -u rtspatom -- env RTSPATOM_CONFIG=/etc/rtspatom/config.json \
  /opt/rtspatom/node/bin/node --disable-warning=ExperimentalWarning /opt/rtspatom/app/server/index.js > /tmp/srv.log 2>&1 &

for i in $(seq 1 30); do curl -sf http://127.0.0.1:18090/api/auth/status >/dev/null && break; sleep 0.5; done
curl -sf http://127.0.0.1:18090/ | grep -q 'id="root"'
curl -sf -c /tmp/c -H 'Content-Type: application/json' -H 'X-RTSPAtom: 1' \
  -d '{"login":"admin","password":"install-test-pass"}' http://127.0.0.1:18090/api/auth/login | grep -q '"isAdmin":true'
for i in $(seq 1 20); do
  curl -sf -b /tmp/c http://127.0.0.1:18090/api/system | grep -q '"reachable":true' && break
  sleep 0.5
done
curl -sf -b /tmp/c http://127.0.0.1:18090/api/system
echo
curl -sf -b /tmp/c http://127.0.0.1:18090/api/system | grep -q '"reachable":true' || { cat /tmp/mtx.log /tmp/srv.log; exit 1; }

# Повторная установка (обновление) не должна терять данные
cd "$W"/rtspatom-* && ./install.sh --no-start </dev/null
rtspatom-admin list-users | grep -q admin
/opt/rtspatom/uninstall.sh
test ! -d /opt/rtspatom
test -f /var/lib/rtspatom/rtspatom.db
echo "Установщик работает"
