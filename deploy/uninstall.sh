#!/bin/bash
# Удаление RTSP Atom.
#   sudo /opt/rtspatom/uninstall.sh          — удалить программу, сохранить данные и настройки
#   sudo /opt/rtspatom/uninstall.sh --purge  — удалить всё, включая базу и настройки
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Запустите от root" >&2; exit 1; }

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

if command -v systemctl >/dev/null; then
  systemctl disable --now rtspatom.service rtspatom-mediamtx.service 2>/dev/null || true
  rm -f /etc/systemd/system/rtspatom.service /etc/systemd/system/rtspatom-mediamtx.service
  systemctl daemon-reload 2>/dev/null || true
fi
rm -f /usr/local/bin/rtspatom-admin
rm -rf /opt/rtspatom

if [ $PURGE -eq 1 ]; then
  rm -rf /var/lib/rtspatom /etc/rtspatom
  userdel rtspatom 2>/dev/null || true
  echo "RTSP Atom удалён полностью."
else
  echo "RTSP Atom удалён. Данные сохранены в /var/lib/rtspatom, настройки — в /etc/rtspatom."
fi
