#!/bin/bash
# Установка / обновление RTSP Atom на Astra Linux SE 1.8 (и других Debian-подобных x86_64).
# Работает без интернета: всё необходимое лежит в этом каталоге.
#
#   sudo ./install.sh [--port 8080] [--tls] [--admin ЛОГИН] [--no-start]
#
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/rtspatom
CONF_DIR=/etc/rtspatom
DATA_DIR=/var/lib/rtspatom
SVC_USER=rtspatom

PORT=""
TLS=0
ADMIN_LOGIN=""
START=1

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mОшибка:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --tls) TLS=1; shift ;;
    --admin) ADMIN_LOGIN="${2:-}"; shift 2 ;;
    --no-start) START=0; shift ;;
    -h|--help)
      sed -n '2,7p' "$0"; exit 0 ;;
    *) die "неизвестный параметр: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "запустите от root: sudo ./install.sh"
[ "$(uname -m)" = "x86_64" ] || die "пакет собран для x86_64, а эта машина: $(uname -m)"
[ -x "$SRC/node/bin/node" ] && [ -x "$SRC/mediamtx/mediamtx" ] && [ -f "$SRC/app/server/index.js" ] \
  || die "пакет неполный — распакуйте архив целиком и запускайте install.sh из его каталога"
if [ -n "$PORT" ] && ! [[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65535 ]]; then
  die "неверный порт: $PORT"
fi

# Проверка целостности файлов пакета
if [ -f "$SRC/SHA256SUMS" ] && command -v sha256sum >/dev/null; then
  say "Проверка целостности пакета"
  (cd "$SRC" && sha256sum --quiet -c SHA256SUMS) || die "файлы пакета повреждены (не совпали контрольные суммы)"
fi

# Node.js из пакета требует glibc >= 2.28 (в Astra 1.8 — 2.36)
GLIBC="$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || true)"
if [ -n "$GLIBC" ]; then
  if [ "$(printf '%s\n2.28\n' "$GLIBC" | sort -V | head -1)" != "2.28" ]; then
    die "слишком старая glibc ($GLIBC), нужна 2.28 или новее"
  fi
fi
"$SRC/node/bin/node" --disable-warning=ExperimentalWarning -e 'require("node:sqlite")' 2>/dev/null \
  || die "Node.js из пакета не запускается на этой системе"

if [ -f /etc/astra_version ]; then
  say "Обнаружена Astra Linux $(cat /etc/astra_version)"
fi

UPGRADE=0
[ -d "$PREFIX/app" ] && UPGRADE=1

HAVE_SYSTEMD=0
if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then HAVE_SYSTEMD=1; fi

if [ $UPGRADE -eq 1 ] && [ $HAVE_SYSTEMD -eq 1 ]; then
  say "Обновление: останавливаю службы"
  systemctl stop rtspatom.service rtspatom-mediamtx.service 2>/dev/null || true
fi

# Служебный пользователь
if ! id "$SVC_USER" >/dev/null 2>&1; then
  say "Создаю служебного пользователя $SVC_USER"
  NOLOGIN=/usr/sbin/nologin; [ -x "$NOLOGIN" ] || NOLOGIN=/bin/false
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell "$NOLOGIN" "$SVC_USER"
fi

say "Копирую файлы в $PREFIX"
install -d -m 755 "$PREFIX"
rm -rf "$PREFIX/app.new" "$PREFIX/node.new" "$PREFIX/mediamtx.new"
cp -a "$SRC/app" "$PREFIX/app.new"
cp -a "$SRC/node" "$PREFIX/node.new"
cp -a "$SRC/mediamtx" "$PREFIX/mediamtx.new"
for d in app node mediamtx; do
  rm -rf "$PREFIX/$d"
  mv "$PREFIX/$d.new" "$PREFIX/$d"
done
chown -R root:root "$PREFIX"
chmod -R u=rwX,go=rX "$PREFIX"
chmod 755 "$PREFIX/node/bin/node" "$PREFIX/mediamtx/mediamtx"
[ -f "$SRC/VERSION" ] && install -m 644 "$SRC/VERSION" "$PREFIX/VERSION"
install -m 755 "$SRC/uninstall.sh" "$PREFIX/uninstall.sh"
install -m 755 "$SRC/deploy/rtspatom-admin" /usr/local/bin/rtspatom-admin

say "Каталоги данных и настроек"
install -d -m 750 -o "$SVC_USER" -g "$SVC_USER" "$DATA_DIR"
install -d -m 755 "$CONF_DIR"

NODE="$PREFIX/node/bin/node"
CONF="$CONF_DIR/config.json"
if [ ! -f "$CONF" ]; then
  "$NODE" -e '
    const fs = require("fs");
    const cfg = {
      host: "0.0.0.0",
      port: 8080,
      dataDir: "/var/lib/rtspatom",
      publicDir: "/opt/rtspatom/app/public",
      trustProxy: false,
      tls: { enabled: false, cert: "/etc/rtspatom/tls/cert.pem", key: "/etc/rtspatom/tls/key.pem" },
      mediamtx: { apiUrl: "http://127.0.0.1:9997", hlsUrl: "http://127.0.0.1:8888" },
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2) + "\n");
  ' "$CONF"
fi
chmod 640 "$CONF"
chown root:"$SVC_USER" "$CONF"

# Общий секрет панели и MediaMTX (hlsCDNSecret): создаётся один раз и хранится в config.json
SECRET="$("$NODE" -e '
  const fs = require("fs"), crypto = require("crypto");
  const file = process.argv[1];
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  cfg.mediamtx = cfg.mediamtx || {};
  if (!cfg.mediamtx.cdnSecret) {
    cfg.mediamtx.cdnSecret = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  }
  console.log(cfg.mediamtx.cdnSecret);
' "$CONF")"

YML="$CONF_DIR/mediamtx.yml"
RENDERED="$(mktemp)"
sed "s/@CDN_SECRET@/$SECRET/" "$SRC/deploy/mediamtx.yml" > "$RENDERED"
if [ -f "$YML" ]; then
  if ! grep -q '^hlsCDNSecret:' "$YML"; then
    printf '\n# Добавлено установщиком RTSP Atom\nhlsCDNSecret: "%s"\n' "$SECRET" >> "$YML"
  fi
  if ! cmp -s "$RENDERED" "$YML"; then
    install -m 640 -o root -g "$SVC_USER" "$RENDERED" "$YML.new"
    warn "Ваш $YML изменён и оставлен как есть; новая версия — mediamtx.yml.new"
  fi
else
  install -m 640 -o root -g "$SVC_USER" "$RENDERED" "$YML"
fi
chown root:"$SVC_USER" "$YML"
chmod 640 "$YML"
rm -f "$RENDERED"

if [ $TLS -eq 1 ]; then
  install -d -m 750 -o root -g "$SVC_USER" "$CONF_DIR/tls"
  if [ ! -f "$CONF_DIR/tls/cert.pem" ]; then
    command -v openssl >/dev/null || die "для --tls нужен openssl"
    say "Создаю самоподписанный сертификат (10 лет)"
    SAN="DNS:$(hostname),DNS:localhost,IP:127.0.0.1"
    for ip in $(hostname -I 2>/dev/null || true); do SAN="$SAN,IP:$ip"; done
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$(hostname)" \
      -addext "subjectAltName=$SAN" \
      -keyout "$CONF_DIR/tls/key.pem" -out "$CONF_DIR/tls/cert.pem" 2>/dev/null
    chown root:"$SVC_USER" "$CONF_DIR/tls/"*.pem
    chmod 640 "$CONF_DIR/tls/"*.pem
  fi
fi

# Применяем --port / --tls к существующему конфигу
if [ -n "$PORT" ] || [ $TLS -eq 1 ]; then
  "$NODE" -e '
    const fs = require("fs");
    const [file, port, tls] = process.argv.slice(1);
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (port) cfg.port = Number(port);
    if (tls === "1") {
      cfg.tls = cfg.tls || {};
      cfg.tls.enabled = true;
      cfg.tls.cert = cfg.tls.cert || "/etc/rtspatom/tls/cert.pem";
      cfg.tls.key = cfg.tls.key || "/etc/rtspatom/tls/key.pem";
    }
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  ' "$CONF" "$PORT" "$TLS"
fi
PORT_NOW="$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port)' "$CONF")"
TLS_NOW="$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tls?.enabled ? "https" : "http")' "$CONF")"

if [ $HAVE_SYSTEMD -eq 1 ]; then
  say "Устанавливаю службы systemd"
  install -m 644 "$SRC/deploy/systemd/rtspatom.service" /etc/systemd/system/rtspatom.service
  install -m 644 "$SRC/deploy/systemd/rtspatom-mediamtx.service" /etc/systemd/system/rtspatom-mediamtx.service
  systemctl daemon-reload
  systemctl enable rtspatom-mediamtx.service rtspatom.service >/dev/null
else
  warn "systemd не обнаружен — службы не установлены (запуск вручную, см. INSTALL.md)"
fi

# Межсетевой экран (если ufw включён)
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Открываю порт $PORT_NOW/tcp в ufw"
  ufw allow "$PORT_NOW/tcp" >/dev/null || warn "не удалось открыть порт в ufw"
fi

# Первый администратор
USERS="$(/usr/local/bin/rtspatom-admin list-users 2>/dev/null | grep -vc '^Пользователей нет' || true)"
if [ "${USERS:-0}" = "0" ]; then
  if [ -t 0 ]; then
    LOGIN="${ADMIN_LOGIN:-admin}"
    say "Создание администратора «$LOGIN»"
    /usr/local/bin/rtspatom-admin create-admin "$LOGIN"
  else
    warn "Администратор не создан. Выполните: sudo rtspatom-admin create-admin"
  fi
fi

if [ $START -eq 1 ] && [ $HAVE_SYSTEMD -eq 1 ]; then
  say "Запускаю службы"
  systemctl restart rtspatom-mediamtx.service
  systemctl restart rtspatom.service
  sleep 2
  if systemctl is-active --quiet rtspatom.service && systemctl is-active --quiet rtspatom-mediamtx.service; then
    say "Службы работают"
  else
    warn "Служба не запустилась. Подробности: journalctl -u rtspatom -u rtspatom-mediamtx -n 50"
  fi
fi

echo
say "Готово: $(head -1 "$PREFIX/VERSION" 2>/dev/null || echo "RTSP Atom")"
echo "    Панель:   $TLS_NOW://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT_NOW"
echo "    Журнал:   journalctl -u rtspatom -f"
echo "    Утилита:  sudo rtspatom-admin help"
echo "    Удаление: sudo $PREFIX/uninstall.sh"
