#!/bin/bash
# Быстрое обновление панели RTSP Atom на уже установленном сервере (Astra Linux SE 1.8 и др.).
# Заменяет только программу панели в /opt/rtspatom/app. Node.js, MediaMTX, настройки, база и архив
# не трогаются; видеосервер продолжает писать архив, пока панель перезапускается (несколько секунд).
#
#   sudo ./update.sh              обновить
#   sudo ./update.sh --rollback   вернуть предыдущую версию панели
#
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/rtspatom

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die()  { printf '\033[1;31mОшибка:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите через sudo: sudo $0 $*"
[ -x "$PREFIX/node/bin/node" ] && [ -d "$PREFIX/app" ] \
  || die "RTSP Atom не установлен в $PREFIX — для первой установки нужен полный пакет (install.sh)"

HAVE_SYSTEMD=0
if command -v systemctl >/dev/null && [ -d /run/systemd/system ] && [ -f /etc/systemd/system/rtspatom.service ]; then HAVE_SYSTEMD=1; fi

panel_stop()  { [ $HAVE_SYSTEMD -eq 1 ] && systemctl stop rtspatom.service || true; }
panel_start() {
  [ $HAVE_SYSTEMD -eq 1 ] || return 0
  systemctl start rtspatom.service
  local i
  for i in 1 2 3 4 5 6; do
    sleep 1
    # служба при ошибке падает сразу; жива 6 с подряд — запустилась
    systemctl is-active --quiet rtspatom.service || return 1
  done
  return 0
}
version_of() { head -1 "$1/VERSION" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1; }

if [ "${1:-}" = "--rollback" ]; then
  [ -d "$PREFIX/app.prev" ] || die "предыдущей версии нет ($PREFIX/app.prev)"
  say "Возвращаю предыдущую версию панели"
  panel_stop
  rm -rf "$PREFIX/app.bad"
  mv "$PREFIX/app" "$PREFIX/app.bad"
  mv "$PREFIX/app.prev" "$PREFIX/app"
  [ -f "$PREFIX/VERSION.prev" ] && mv -f "$PREFIX/VERSION.prev" "$PREFIX/VERSION"
  panel_start || die "панель не запустилась. Подробности: journalctl -u rtspatom -n 50"
  say "Готово: $(head -1 "$PREFIX/VERSION" 2>/dev/null || echo 'предыдущая версия')"
  exit 0
fi

[ -f "$SRC/app/server/index.js" ] && [ -f "$SRC/VERSION" ] || die "пакет неполный — распакуйте архив целиком и запускайте update.sh из его каталога"
[ -f "$SRC/MIN_VERSION" ] || die "это не пакет обновления (rtspatom-…-update.tar.gz). Полный пакет ставится командой sudo ./install.sh"
if [ -f "$SRC/SHA256SUMS" ] && command -v sha256sum >/dev/null; then
  say "Проверка целостности пакета"
  (cd "$SRC" && sha256sum --quiet -c SHA256SUMS) || die "файлы пакета повреждены (не совпали контрольные суммы)"
fi

NEW="$(version_of "$SRC")"
OLD="$(version_of "$PREFIX")"
MIN="$(cat "$SRC/MIN_VERSION" 2>/dev/null || echo 0.0.0)"
[ -n "$OLD" ] || OLD=0.0.0
# Пакет обновления подходит, только если установлена версия не старше MIN (иначе менялись настройки видеосервера)
if [ "$(printf '%s\n%s\n' "$MIN" "$OLD" | sort -V | head -1)" != "$MIN" ]; then
  die "установлена версия $OLD, а этот пакет обновляет с версии $MIN и новее. Обновите полным пакетом: sudo ./install.sh"
fi
# Нужная версия Node.js (из package.json пакета) — проверяем установленным Node
NEED_NODE="$("$PREFIX/node/bin/node" -p "require('$SRC/app/server/package.json').engines?.node || ''" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)"
if [ -n "$NEED_NODE" ]; then
  HAVE_NODE="$("$PREFIX/node/bin/node" -p 'process.versions.node' | grep -oE '^[0-9]+\.[0-9]+')"
  if [ "$(printf '%s\n%s\n' "$NEED_NODE" "$HAVE_NODE" | sort -V | head -1)" != "$NEED_NODE" ]; then
    die "нужен Node.js $NEED_NODE или новее, установлен $HAVE_NODE — обновите полным пакетом: sudo ./install.sh"
  fi
fi

say "Обновление панели: ${OLD} → ${NEW}"
rm -rf "$PREFIX/app.new"
cp -a "$SRC/app" "$PREFIX/app.new"
chown -R root:root "$PREFIX/app.new"
chmod -R u=rwX,go=rX "$PREFIX/app.new"

panel_stop
rm -rf "$PREFIX/app.prev"
mv "$PREFIX/app" "$PREFIX/app.prev"
mv "$PREFIX/app.new" "$PREFIX/app"
cp -p "$PREFIX/VERSION" "$PREFIX/VERSION.prev" 2>/dev/null || true
# первая строка — версия панели; строки о Node.js и MediaMTX остаются от установленных
{ head -1 "$SRC/VERSION"; tail -n +2 "$PREFIX/VERSION.prev" 2>/dev/null || true; } > "$PREFIX/VERSION.tmp"
mv -f "$PREFIX/VERSION.tmp" "$PREFIX/VERSION"
chmod 644 "$PREFIX/VERSION"
install -m 755 "$SRC/deploy/rtspatom-admin" /usr/local/bin/rtspatom-admin
install -m 755 "$SRC/uninstall.sh" "$PREFIX/uninstall.sh"
[ -f "$SRC/update.sh" ] && install -m 755 "$SRC/update.sh" "$PREFIX/update.sh"

if [ $HAVE_SYSTEMD -eq 1 ]; then
  # описание службы панели меняется редко; если в пакете другое — ставим его
  if [ -f "$SRC/deploy/systemd/rtspatom.service" ] && ! cmp -s "$SRC/deploy/systemd/rtspatom.service" /etc/systemd/system/rtspatom.service; then
    install -m 644 "$SRC/deploy/systemd/rtspatom.service" /etc/systemd/system/rtspatom.service
    systemctl daemon-reload
  fi
  say "Запускаю панель"
  if ! panel_start; then
    warn "новая версия не запустилась — возвращаю предыдущую"
    journalctl -u rtspatom -n 20 --no-pager 2>/dev/null || true
    systemctl stop rtspatom.service || true
    rm -rf "$PREFIX/app.bad"
    mv "$PREFIX/app" "$PREFIX/app.bad"
    mv "$PREFIX/app.prev" "$PREFIX/app"
    mv -f "$PREFIX/VERSION.prev" "$PREFIX/VERSION" 2>/dev/null || true
    systemctl start rtspatom.service || true
    die "обновление не применено, работает прежняя версия ${OLD}. Подробности: journalctl -u rtspatom -n 50"
  fi
else
  warn "systemd не обнаружен — перезапустите панель вручную"
fi

echo
say "Готово: $(head -1 "$PREFIX/VERSION")"
echo "    Обновите страницу в браузерах (Ctrl+F5)."
echo "    Вернуть прежнюю версию: sudo $PREFIX/update.sh --rollback"
