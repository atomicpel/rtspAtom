#!/bin/bash
# Сквозная проверка: тестовая «камера» (ffmpeg -> RTSP) -> MediaMTX панели -> сервер панели -> HLS.
#   scripts/e2e.sh <node> <mediamtx> <каталог приложения: server/ и public/>
set -Eeuo pipefail

NODE="$1"; MTX="$2"; APP="$3"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="${E2E_DIR:-$(mktemp -d)}"; mkdir -p "$W"
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  if [ "${E2E_FAILED:-0}" = "1" ]; then
    echo "----- журнал камеры -----"; tail -n 40 "$W/camera.log" || true
    echo "----- журнал MediaMTX панели -----"; tail -n 60 "$W/mediamtx.log" || true
    echo "----- журнал сервера -----"; tail -n 60 "$W/server.log" || true
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      for f in camera ffmpeg mediamtx server; do
        [ -s "$W/$f.log" ] || continue
        echo "::error title=E2E: $f.log::$(tail -n 30 "$W/$f.log" | sed ':a;N;$!ba;s/%/%25/g;s/\r//g;s/\n/%0A/g')"
      done
    fi
  fi
}
trap cleanup EXIT
fail() { echo "E2E ОШИБКА: $*" >&2; echo "::error title=E2E::$*"; E2E_FAILED=1; exit 1; }
trap 'E2E_FAILED=1; echo "::error title=E2E строка $LINENO::$BASH_COMMAND"' ERR

# 1. «Камера»: отдельный MediaMTX на 18554 + ffmpeg с тестовой картинкой H.264
cat > "$W/camera.yml" <<'EOF'
logLevel: info
api: no
rtsp: yes
rtspAddress: 127.0.0.1:18554
rtpAddress: :18000
rtcpAddress: :18001
rtmp: no
hls: no
webrtc: no
srt: no
moq: no
paths:
  all_others:
EOF
"$MTX" "$W/camera.yml" > "$W/camera.log" 2>&1 & PIDS+=($!)
sleep 1
ffmpeg -hide_banner -loglevel error -re -f lavfi -i testsrc=size=640x360:rate=25 \
  -c:v libx264 -preset ultrafast -tune zerolatency -g 25 -pix_fmt yuv420p \
  -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:18554/cam > "$W/ffmpeg.log" 2>&1 & PIDS+=($!)

# 2. MediaMTX панели с боевой конфигурацией
SECRET=e2e-cdn-secret-$RANDOM$RANDOM
sed "s/@CDN_SECRET@/$SECRET/" "$ROOT/deploy/mediamtx.yml" > "$W/mediamtx.yml"
"$MTX" "$W/mediamtx.yml" > "$W/mediamtx.log" 2>&1 & PIDS+=($!)
MTX_PID=$!

# 3. Сервер панели
cat > "$W/config.json" <<EOF
{ "host": "127.0.0.1", "port": 18080, "dataDir": "$W/data", "publicDir": "$APP/public",
  "mediamtx": { "apiUrl": "http://127.0.0.1:9997", "hlsUrl": "http://127.0.0.1:8888", "cdnSecret": "$SECRET" } }
EOF
export RTSPATOM_CONFIG="$W/config.json"
echo 'e2e-password' | "$NODE" --disable-warning=ExperimentalWarning "$APP/server/cli.js" create-admin admin --password-stdin
"$NODE" --disable-warning=ExperimentalWarning "$APP/server/index.js" > "$W/server.log" 2>&1 & PIDS+=($!)

B=http://127.0.0.1:18080
J="$W/cookies"
for i in $(seq 1 30); do curl -sf "$B/api/auth/status" >/dev/null && break; sleep 0.5; done
curl -sf "$B/" | grep -q '<div id="root">' || fail "фронтенд не отдаётся"

H=(-H 'Content-Type: application/json' -H 'X-RTSPAtom: 1' -b "$J" -c "$J")
curl -sf "${H[@]}" -d '{"login":"admin","password":"e2e-password"}' "$B/api/auth/login" >/dev/null || fail "вход"
COMP=$(curl -sf "${H[@]}" -d '{"name":"Тестовый объект"}' "$B/api/computers" | "$NODE" -pe 'JSON.parse(require("fs").readFileSync(0)).id')

# MediaMTX панели не должен слушать внешние адреса
sleep 1
kill -0 "$MTX_PID" 2>/dev/null || fail "MediaMTX с deploy/mediamtx.yml не запустился"
EXPOSED=$(ss -ltnupH 2>/dev/null | grep "pid=$MTX_PID," | awk '{print $5}' | grep -vE '^(127\.0\.0\.1|\[::1\]):' || true)
[ -z "$EXPOSED" ] || fail "MediaMTX слушает внешние адреса: $EXPOSED"
echo "MediaMTX слушает: $(ss -ltnupH | grep "pid=$MTX_PID," | awk '{print $5}' | tr '\n' ' ')"

# Панель должна увидеть MediaMTX
for i in $(seq 1 20); do
  curl -sf -b "$J" "$B/api/system" | grep -q '"reachable":true' && break
  sleep 0.5
done
curl -sf -b "$J" "$B/api/system" | grep -q '"reachable":true' || fail "панель не видит MediaMTX"

# Проверка источника до добавления
PROBE=$(curl -sf "${H[@]}" -d '{"url":"rtsp://127.0.0.1:18554/cam","transport":"tcp"}' "$B/api/streams/probe")
echo "Проверка источника: $PROBE"
echo "$PROBE" | grep -q '"ok":true' || fail "probe не получил видео"
echo "$PROBE" | grep -q 'H264' || fail "probe не определил H264"

STREAM=$(curl -sf "${H[@]}" -d '{"name":"Камера","url":"rtsp://127.0.0.1:18554/cam","transport":"tcp"}' \
  "$B/api/computers/$COMP/streams" | "$NODE" -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo "Поток: $STREAM"

STATUS=""
for i in $(seq 1 40); do
  STATUS=$(curl -sf -b "$J" "$B/api/computers" | "$NODE" -pe 'JSON.parse(require("fs").readFileSync(0))[0].streams[0].status')
  [ "$STATUS" = "online" ] && break
  sleep 1
done
[ "$STATUS" = "online" ] || fail "поток не перешёл в online (статус: $STATUS)"
echo "Статус потока: $STATUS"

# HLS через прокси панели: мастер-плейлист -> плейлист потока -> сегмент
CODE=""
for i in $(seq 1 30); do
  CODE=$(curl -s -b "$J" -D "$W/master.hdr" -o "$W/master.m3u8" -w '%{http_code}' "$B/hls/$STREAM/index.m3u8" || true)
  [ "$CODE" = "200" ] && [ -s "$W/master.m3u8" ] && break
  sleep 1
done
if ! { [ "$CODE" = "200" ] && [ -s "$W/master.m3u8" ]; }; then
  DIRECT=$(curl -s -D - -H "Authorization: Bearer $SECRET" "http://127.0.0.1:8888/s_$STREAM/index.m3u8" | head -c 600 | tr '\r\n' '  ')
  fail "index.m3u8 не получен: код $CODE; заголовки: $(tr '\r\n' '  ' < "$W/master.hdr"); тело: $(head -c 300 "$W/master.m3u8" | tr '\r\n' '  '); напрямую из MediaMTX: $DIRECT"
fi
echo "----- index.m3u8 -----"; cat "$W/master.m3u8"
grep -q '#EXTM3U' "$W/master.m3u8" || fail "некорректный плейлист"
VARIANT=$(grep -v '^#' "$W/master.m3u8" | grep -m1 '\.m3u8')
[ -n "$VARIANT" ] || fail "в мастер-плейлисте нет вариантов"
curl -sf -b "$J" "$B/hls/$STREAM/$VARIANT" -o "$W/variant.m3u8" || fail "$VARIANT не получен"
echo "----- $VARIANT (начало) -----"; head -n 20 "$W/variant.m3u8"
# Первый настоящий сегмент (записи после #EXT-X-GAP — заглушки), иначе — часть LL-HLS
SEG=$(awk '/^#EXT-X-GAP/{gap=1; next} /^#/{next} NF{ if(!gap){print; exit} gap=0 }' "$W/variant.m3u8")
[ -n "$SEG" ] || SEG=$(grep -oE '#EXT-X-PART:[^ ]*URI="[^"]+"' "$W/variant.m3u8" | head -1 | sed -E 's/.*URI="([^"]+)".*/\1/')
INIT=$(grep -oE 'URI="[^"]+"' "$W/variant.m3u8" | head -1 | cut -d'"' -f2 || true)
if [ -n "$INIT" ]; then
  CODE=$(curl -s -b "$J" -o "$W/init.bin" -w '%{http_code}' "$B/hls/$STREAM/$INIT" || true)
  [ "$CODE" = "200" ] || fail "init-сегмент $INIT не получен: код $CODE, ответ: $(head -c 300 "$W/init.bin" | tr -cd '[:print:] ')"
fi
[ -n "$SEG" ] || fail "в плейлисте нет сегментов"
CODE=$(curl -s -b "$J" -o "$W/seg.bin" -w '%{http_code}' "$B/hls/$STREAM/$SEG" || true)
[ "$CODE" = "200" ] || fail "сегмент $SEG не получен: код $CODE, ответ: $(head -c 300 "$W/seg.bin" | tr -cd '[:print:] '); плейлист: $(head -n 25 "$W/variant.m3u8" | tr '\n' '|')"
SIZE=$(stat -c %s "$W/seg.bin")
[ "$SIZE" -gt 500 ] || fail "сегмент слишком мал ($SIZE байт)"
echo "Сегмент $SEG: $SIZE байт"

# Напрямую из MediaMTX без секрета видео не отдаётся (cookie-проверка/сессия)
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8888/s_$STREAM/$VARIANT")
[ "$CODE" != "200" ] || fail "MediaMTX отдал плейлист без секрета"

# Без сессии видео недоступно
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/hls/$STREAM/index.m3u8")
[ "$CODE" = "401" ] || fail "HLS без входа вернул $CODE, ожидался 401"

# Отключение потока убирает его из MediaMTX
curl -sf "${H[@]}" -X PUT -d '{"isActive":false}' "$B/api/streams/$STREAM" >/dev/null
sleep 2
curl -sf http://127.0.0.1:9997/v3/config/paths/list | grep -q "s_$STREAM" && fail "путь не удалён из MediaMTX"

echo "E2E: всё работает"
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice title=E2E::Камера RTSP -> MediaMTX -> панель -> HLS: сегмент $SEG ($SIZE байт) получен через прокси; MediaMTX слушает только 127.0.0.1"
