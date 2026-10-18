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
{ "host": "127.0.0.1", "port": 18080, "dataDir": "$W/data", "publicDir": "$APP/public", "archiveDir": "$W/archive",
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

# MediaMTX панели снаружи: ICE 8189 (видео WebRTC), RTMP 1935 и SRT 8890 (приём от энкодеров); остальное — 127.0.0.1
sleep 1
kill -0 "$MTX_PID" 2>/dev/null || fail "MediaMTX с deploy/mediamtx.yml не запустился"
EXPOSED=$(ss -ltnupH 2>/dev/null | grep "pid=$MTX_PID," | awk '{print $5}' | grep -vE '^(127\.0\.0\.1|\[::1\]):' | grep -vE ':(8189|1935|8890)$' || true)
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
  "$B/api/streams" | "$NODE" -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo "Поток: $STREAM"

STATUS=""
for i in $(seq 1 40); do
  STATUS=$(curl -sf -b "$J" "$B/api/streams" | "$NODE" -pe 'JSON.parse(require("fs").readFileSync(0))[0].status')
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

# WebRTC (WHEP): без входа — 401, со входом запрос доходит до MediaMTX
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-RTSPAtom: 1' -H 'Content-Type: application/sdp' -d 'v=0' "$B/webrtc/$STREAM/whep")
[ "$CODE" = "401" ] || fail "WHEP без входа вернул $CODE, ожидался 401"
WHEP=$(curl -s -w ' %{http_code}' -b "$J" -H 'X-RTSPAtom: 1' -H 'Content-Type: application/sdp' --data-binary 'v=0' "$B/webrtc/$STREAM/whep")
echo "WHEP с неверным SDP: $WHEP"
case "$WHEP" in *WebRTC:*) ;; *) fail "WHEP-прокси не дошёл до MediaMTX: $WHEP" ;; esac

# Архив: поток пишется на диск, промежутки записи и видео отдаются через панель
SPANS=""
for i in $(seq 1 40); do
  FROM=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ); TO=$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ)
  SPANS=$(curl -sf -b "$J" "$B/api/archive/$STREAM/spans?start=$FROM&end=$TO" || true)
  DUR=$(echo "${SPANS:-[]}" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d||"[]");console.log(Math.floor(a.reduce((n,x)=>n+x.duration,0)))})')
  [ "${DUR:-0}" -ge 8 ] && break
  sleep 1
done
echo "Архив: промежутки $SPANS"
[ "${DUR:-0}" -ge 8 ] || { ls -la "$W/archive" "$W/archive/s_$STREAM" 2>&1; grep -i 'record\|playback' "$W/mediamtx.log" | tail -20; fail "запись в архив не идёт (записано ${DUR:-0} с)"; }
ls "$W/archive/s_$STREAM/"*.mp4 >/dev/null || fail "в каталоге архива нет файлов"
ASTART=$(echo "$SPANS" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);console.log(new Date(Date.parse(a[0].start)+2000).toISOString())})')
CODE=$(curl -s -o "$W/archive.mp4" -w '%{http_code}' -b "$J" "$B/archive/$STREAM/video?start=$ASTART&duration=4")
ASIZE=$(stat -c %s "$W/archive.mp4" 2>/dev/null || echo 0)
[ "$CODE" = "200" ] && [ "$ASIZE" -gt 10000 ] || fail "видео из архива не отдаётся (код $CODE, $ASIZE байт): $(head -c 300 "$W/archive.mp4")"
[ "$(head -c 8 "$W/archive.mp4" | tail -c 4)" = "ftyp" ] || fail "из архива пришёл не MP4"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/archive.mp4" > "$W/archive.dur" 2>&1 || true
echo "Фрагмент архива: $ASIZE байт, длительность $(cat "$W/archive.dur")"
curl -s -D - -o /dev/null -b "$J" "$B/archive/$STREAM/video?start=$ASTART&duration=3&download=1" | grep -qi 'content-disposition: attachment' \
  || fail "выгрузка из архива без Content-Disposition"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/archive/$STREAM/video?start=$ASTART&duration=3")
[ "$CODE" = "401" ] || fail "архив без входа вернул $CODE"
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice title=Архив::записано $DUR с, фрагмент MP4 $ASIZE байт ($(cat "$W/archive.dur") с) отдан через панель; без входа — 401"

# Скриншоты интерфейса (только в CI): ещё три тестовые камеры с разными картинками
if [ -n "${SHOTS_DIR:-}" ]; then
  i=2
  for src in "smptehdbars=size=640x360:rate=25" "testsrc2=size=640x360:rate=25" "rgbtestsrc=size=640x360:rate=25"; do
    ffmpeg -hide_banner -loglevel error -re -f lavfi -i "$src" \
      -c:v libx264 -preset ultrafast -tune zerolatency -g 25 -pix_fmt yuv420p \
      -f rtsp -rtsp_transport tcp "rtsp://127.0.0.1:18554/cam$i" > "$W/ffmpeg$i.log" 2>&1 & PIDS+=($!)
    i=$((i+1))
  done
  curl -sf "${H[@]}" -X PUT -d '{"name":"Въезд, ворота 1","description":"КПП"}' "$B/api/streams/$STREAM" >/dev/null
  for n in "2|Периметр, север|Северный участок" "3|Склад, западные ворота|" "4|Стоянка|Гостевая"; do
    IFS='|' read -r num name desc <<<"$n"
    curl -sf "${H[@]}" -d "{\"name\":\"$name\",\"description\":\"$desc\",\"url\":\"rtsp://127.0.0.1:18554/cam$num\",\"transport\":\"tcp\"}" "$B/api/streams" >/dev/null
  done
  # Замер задержки по протоколам: один кодировщик с часами в кадре (время UTC в момент кодирования)
  # отдаёт одну и ту же картинку четырьмя способами, как это делает HDMI-энкодер:
  #   RTSP (сервер забирает), RTMP и SRT (энкодер отправляет сам), MPEG-TS по UDP.
  [ -f /usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf ] || echo "::warning title=Замер задержки::нет шрифта DejaVu, часы в кадре не появятся"
  sed "s|@FONT@|/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf|" > "$W/clock.filter" <<'EOF'
setpts=RTCTIME/(TB*1000000),drawtext=fontfile=@FONT@:fontsize=72:fontcolor=white:box=1:boxcolor=black@0.85:boxborderw=12:x=30:y=30:text='%{pts\:gmtime\:0\:%H\\\:%M\\\:%S}.%{eif\:1000*mod(t\,1)\:d\:3}',setpts=N/(30*TB)
EOF
  add_stream() { curl -sf "${H[@]}" -d "$1" "$B/api/streams" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);console.log(s.id, s.push ? s.push.key : "-")})'; }
  read -r ID_RTSP _ < <(add_stream '{"name":"Задержка RTSP","description":"сервер забирает","url":"rtsp://127.0.0.1:18554/clock","transport":"tcp"}')
  read -r ID_RTMP KEY_RTMP < <(add_stream '{"name":"Задержка RTMP","description":"энкодер отправляет","mode":"push"}')
  read -r ID_SRT KEY_SRT < <(add_stream '{"name":"Задержка SRT","description":"энкодер отправляет","mode":"push"}')
  read -r ID_UDP _ < <(add_stream '{"name":"Задержка UDP","description":"MPEG-TS","url":"udp+mpegts://127.0.0.1:5004"}')
  [[ "$KEY_RTMP" =~ ^[a-z0-9]{20}$ ]] || fail "push-поток без ключа: $KEY_RTMP"
  sleep 3
  ffmpeg -hide_banner -loglevel error -re -f lavfi -i "testsrc2=size=1280x720:rate=30" -filter_script:v "$W/clock.filter" \
    -map 0:v -c:v libx264 -preset ultrafast -tune zerolatency -g 30 -bf 0 -pix_fmt yuv420p -flags +global_header -x264-params repeat-headers=1 \
    -f tee "[f=rtsp:rtsp_transport=tcp:onfail=ignore]rtsp://127.0.0.1:18554/clock|[f=flv:onfail=ignore]rtmp://127.0.0.1:1935/live/$KEY_RTMP|[f=mpegts:onfail=ignore]srt://127.0.0.1:8890?streamid=publish:live/$KEY_SRT&latency=20000&pkt_size=1316|[f=mpegts:onfail=ignore]udp://127.0.0.1:5004?pkt_size=1316" \
    > "$W/ffmpeg-clock.log" 2>&1 & PIDS+=($!)
  for i in $(seq 1 30); do
    ST=$(curl -sf -b "$J" "$B/api/streams" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);console.log(process.argv.slice(1).map(id=>(a.find(s=>s.id===id)||{}).status).join(" "))})' "$ID_RTSP" "$ID_RTMP" "$ID_SRT" "$ID_UDP")
    [ "$ST" = "online online online online" ] && break
    sleep 1
  done
  echo "Состояние RTSP RTMP SRT UDP: $ST"
  read -r S_RTSP S_RTMP S_SRT S_UDP <<<"$ST"
  [ "$S_RTMP" = "online" ] || { cat "$W/ffmpeg-clock.log"; grep -i 'rtmp\|live/' "$W/mediamtx.log" | tail -20; fail "энкодер по RTMP не принят ($S_RTMP)"; }
  [ "$S_SRT" = "online" ] || { cat "$W/ffmpeg-clock.log"; grep -i 'srt\|live/' "$W/mediamtx.log" | tail -20; fail "энкодер по SRT не принят ($S_SRT)"; }
  [ "$S_UDP" = "online" ] || echo "::warning title=UDP::поток MPEG-TS по UDP не принят ($S_UDP)"
  # Публикация с неверным ключом должна отклоняться
  if timeout 8 ffmpeg -hide_banner -loglevel error -re -f lavfi -i testsrc=size=320x240:rate=10 -t 4 -c:v libx264 -preset ultrafast -f flv \
      "rtmp://127.0.0.1:1935/live/aaaaaaaaaaaaaaaaaaaa" >/dev/null 2>&1; then
    fail "MediaMTX принял публикацию по неверному ключу"
  fi
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice title=Энкодеры::RTMP и SRT от энкодера приняты по ключу, неверный ключ отклонён; UDP: $S_UDP"
  # Камера со звуком G.711 — проверка показа такого архива в браузере
  ffmpeg -hide_banner -loglevel error -re -f lavfi -i "testsrc=size=640x360:rate=25" -f lavfi -i "sine=frequency=440:sample_rate=8000" \
    -c:v libx264 -preset ultrafast -tune zerolatency -g 25 -pix_fmt yuv420p -c:a pcm_alaw -ar 8000 -ac 1 \
    -f rtsp -rtsp_transport tcp "rtsp://127.0.0.1:18554/g711" > "$W/ffmpeg-g711.log" 2>&1 & PIDS+=($!)
  sleep 2
  curl -sf "${H[@]}" -d '{"name":"Звук G711","description":"видео + G.711","url":"rtsp://127.0.0.1:18554/g711","transport":"tcp"}' "$B/api/streams" >/dev/null
  curl -sf "${H[@]}" -d '{"login":"operator","password":"operator-pass","role":"operator"}' "$B/api/users" >/dev/null
  sleep 6
  node "$ROOT/scripts/screenshots.mjs" "$B" admin e2e-password "$SHOTS_DIR" || echo "::warning title=Скриншоты::не удалось снять скриншоты"
fi

# Отключение потока: камера в MediaMTX больше не подключается, остаётся только архивный путь без источника
curl -sf "${H[@]}" -X PUT -d '{"isActive":false}' "$B/api/streams/$STREAM" >/dev/null
sleep 2
SRC=$(curl -sf "http://127.0.0.1:9997/v3/config/paths/get/s_$STREAM" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d||"{}");console.log(p.source+"/"+p.record)})' || echo "нет")
[ "$SRC" = "publisher/false" ] || fail "отключённый поток в MediaMTX: $SRC (ожидался архивный путь publisher/false)"
curl -sf -b "$J" "$B/api/archive/$STREAM/spans?start=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)&end=$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ)" | grep -q '"start"' \
  || fail "архив отключённого потока не виден"

echo "E2E: всё работает"
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice title=E2E::Камера RTSP -> MediaMTX -> панель -> HLS: сегмент $SEG ($SIZE байт) получен через прокси; MediaMTX снаружи открыт только портами ICE 8189, RTMP 1935, SRT 8890"
