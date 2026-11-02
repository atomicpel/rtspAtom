#!/bin/bash
# Сборка пакета быстрого обновления панели (только программа панели, без Node.js и MediaMTX).
#   scripts/build-update.sh <выходной каталог>
# Перед запуском должен быть собран фронтенд (npm run build -> dist/).
# На сервере: tar -xzf rtspatom-<версия>-update.tar.gz && sudo ./rtspatom-<версия>-update/update.sh
set -euo pipefail

OUT="$1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
# С какой версии можно обновляться этим пакетом: начиная с 1.6.0 настройки видеосервера (mediamtx.yml) не менялись
MIN_VERSION="1.6.0"
NAME="rtspatom-${VERSION}-update"
STAGE="$(mktemp -d)/$NAME"

[ -f "$ROOT/dist/index.html" ] || { echo "Нет dist/ — выполните npm run build" >&2; exit 1; }

mkdir -p "$STAGE"/{app/server,deploy/systemd}
cp -r "$ROOT/server/lib" "$ROOT/server/routes" "$STAGE/app/server/"
cp "$ROOT/server/index.js" "$ROOT/server/cli.js" "$ROOT/server/package.json" "$STAGE/app/server/"
cp -r "$ROOT/dist" "$STAGE/app/public"
cp "$ROOT/deploy/update.sh" "$STAGE/update.sh"
cp "$ROOT/deploy/uninstall.sh" "$STAGE/uninstall.sh"
cp "$ROOT/deploy/rtspatom-admin" "$STAGE/deploy/"
cp "$ROOT/deploy/systemd/rtspatom.service" "$STAGE/deploy/systemd/"
chmod 755 "$STAGE/update.sh" "$STAGE/uninstall.sh" "$STAGE/deploy/rtspatom-admin"
echo "$MIN_VERSION" > "$STAGE/MIN_VERSION"
echo "RTSP Atom ${VERSION} (сборка $(date -u +%Y-%m-%d), git ${GITHUB_SHA:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)})" > "$STAGE/VERSION"
cat > "$STAGE/README.txt" <<EOF
Пакет быстрого обновления панели RTSP Atom ${VERSION}.
Подходит для серверов, где уже установлена версия ${MIN_VERSION} или новее.
Заменяет только программу панели; Node.js, MediaMTX, настройки, база и архив остаются.

  tar -xzf ${NAME}.tar.gz
  sudo ./${NAME}/update.sh

Вернуть прежнюю версию: sudo /opt/rtspatom/update.sh --rollback
EOF

(cd "$STAGE" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar -C "$(dirname "$STAGE")" -czf "$OUT/$NAME.tar.gz" "$NAME"
(cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
echo "$OUT/$NAME.tar.gz"
