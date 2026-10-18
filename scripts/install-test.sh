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

# Посторонние программы на порту панели и порту HLS: установщик должен взять следующие свободные
BUNDLE_NODE="$(pwd)/node/bin/node"
"$BUNDLE_NODE" -e "require('net').createServer().listen(18090,'0.0.0.0')" & B1=$!
"$BUNDLE_NODE" -e "require('net').createServer().listen(8888,'127.0.0.1')" & B2=$!
# и на порту RTMP (1935) и SRT (8890/udp)
"$BUNDLE_NODE" -e "require('net').createServer().listen(1935,'0.0.0.0')" & B3=$!
"$BUNDLE_NODE" -e "require('dgram').createSocket('udp4').bind(8890,'0.0.0.0')" & B4=$!
sleep 1
./install.sh --no-start --port 18090 </dev/null
grep -q '"port": 18091' /etc/rtspatom/config.json || { echo "порт панели не подобран"; cat /etc/rtspatom/config.json; exit 1; }
grep -q 'hlsAddress: 127.0.0.1:8889' /etc/rtspatom/mediamtx.yml || { echo "порт HLS не подобран"; exit 1; }
grep -q '"hlsUrl": "http://127.0.0.1:8889"' /etc/rtspatom/config.json || { echo "hlsUrl не совпадает"; exit 1; }
grep -q '^rtmpAddress: :1936' /etc/rtspatom/mediamtx.yml || { echo "порт RTMP не подобран"; grep -n 'rtmp\|srt' /etc/rtspatom/mediamtx.yml; exit 1; }
grep -q '^srtAddress: :8891' /etc/rtspatom/mediamtx.yml || { echo "порт SRT не подобран"; exit 1; }
grep -q '"srtPort": 8891' /etc/rtspatom/config.json || { echo "srtPort не записан в config.json"; exit 1; }
grep -q '^webrtcAddress: 127.0.0.1:8890' /etc/rtspatom/mediamtx.yml || { echo "WHEP не должен уступать порт SRT (разные протоколы)"; exit 1; }
grep -q '^playbackAddress: 127.0.0.1:9996' /etc/rtspatom/mediamtx.yml || { echo "нет адреса выдачи архива"; exit 1; }
grep -q '^rtspAddress: 127.0.0.1:8554' /etc/rtspatom/mediamtx.yml || { echo "нет локального RTSP"; exit 1; }
grep -q '"rtspUrl": "rtsp://127.0.0.1:8554"' /etc/rtspatom/config.json || { echo "rtspUrl не записан"; exit 1; }
grep -q '"archiveDir": "/var/lib/rtspatom/archive"' /etc/rtspatom/config.json || { echo "каталог архива не записан"; cat /etc/rtspatom/config.json; exit 1; }
[ "$(stat -c %U /var/lib/rtspatom/archive)" = "rtspatom" ] || { echo "каталог архива не принадлежит службе"; exit 1; }
test -x /opt/rtspatom/node/bin/node
test -x /opt/rtspatom/mediamtx/mediamtx
test -f /etc/rtspatom/config.json
test -f /etc/rtspatom/mediamtx.yml
/opt/rtspatom/node/bin/node --version
/opt/rtspatom/mediamtx/mediamtx --version

echo 'install-test-pass' | rtspatom-admin create-admin admin --password-stdin
rtspatom-admin list-users | grep -q admin

cd /var/lib/rtspatom
runuser -u rtspatom -- /opt/rtspatom/mediamtx/mediamtx /etc/rtspatom/mediamtx.yml > /tmp/mtx.log 2>&1 & MTX_PID=$!
runuser -u rtspatom -- env RTSPATOM_CONFIG=/etc/rtspatom/config.json \
  /opt/rtspatom/node/bin/node --disable-warning=ExperimentalWarning /opt/rtspatom/app/server/index.js > /tmp/srv.log 2>&1 & SRV_PID=$!

for i in $(seq 1 30); do curl -sf http://127.0.0.1:18091/api/auth/status >/dev/null && break; sleep 0.5; done
curl -sf http://127.0.0.1:18091/ | grep -q 'id="root"'
curl -sf -c /tmp/c -H 'Content-Type: application/json' -H 'X-RTSPAtom: 1' \
  -d '{"login":"admin","password":"install-test-pass"}' http://127.0.0.1:18091/api/auth/login | grep -q '"isAdmin":true'
for i in $(seq 1 20); do
  curl -sf -b /tmp/c http://127.0.0.1:18091/api/system | grep -q '"reachable":true' && break
  sleep 0.5
done
curl -sf -b /tmp/c http://127.0.0.1:18091/api/system
echo
curl -sf -b /tmp/c http://127.0.0.1:18091/api/system | grep -q '"reachable":true' || { cat /tmp/mtx.log /tmp/srv.log; exit 1; }

# Повторная установка (обновление) не должна терять данные и менять порты.
# Как и службы при настоящем обновлении, останавливаем запущенные вручную процессы.
kill $SRV_PID $MTX_PID 2>/dev/null || true
sleep 2
cd "$W"/rtspatom-* && ./install.sh --no-start </dev/null
grep -q '"port": 18091' /etc/rtspatom/config.json || { echo "порт сменился при обновлении"; exit 1; }
kill $B1 $B2 $B3 $B4 2>/dev/null || true
rtspatom-admin list-users | grep -q admin
/opt/rtspatom/uninstall.sh
test ! -d /opt/rtspatom
test -f /var/lib/rtspatom/rtspatom.db
echo "Установщик работает"
