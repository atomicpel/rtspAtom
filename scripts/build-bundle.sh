#!/bin/bash
# Сборка офлайн-пакета для Astra Linux SE 1.8 (x86_64).
#   scripts/build-bundle.sh <node-linux-x64.tar.xz> <mediamtx_linux_amd64.tar.gz> <выходной каталог>
# Перед запуском должен быть собран фронтенд (npm run build -> dist/).
set -euo pipefail

NODE_TAR="$1"
MTX_TAR="$2"
OUT="$3"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NAME="rtspatom-${VERSION}-astra-x86_64"
STAGE="$(mktemp -d)/$NAME"

[ -f "$ROOT/dist/index.html" ] || { echo "Нет dist/ — выполните npm run build" >&2; exit 1; }

mkdir -p "$STAGE"/{node/bin,app,mediamtx,deploy/systemd}

# Node.js: нужен только исполняемый файл и лицензия
tmp="$(mktemp -d)"
tar -xf "$NODE_TAR" -C "$tmp"
nd="$(find "$tmp" -maxdepth 1 -mindepth 1 -type d | head -1)"
cp "$nd/bin/node" "$STAGE/node/bin/node"
cp "$nd/LICENSE" "$STAGE/node/LICENSE"
NODE_VER="$("$STAGE/node/bin/node" --version)"

# MediaMTX
tmp2="$(mktemp -d)"
tar -xzf "$MTX_TAR" -C "$tmp2"
cp "$tmp2/mediamtx" "$STAGE/mediamtx/mediamtx"
[ -f "$tmp2/LICENSE" ] && cp "$tmp2/LICENSE" "$STAGE/mediamtx/LICENSE"
[ -f "$tmp2/mediamtx.yml" ] && cp "$tmp2/mediamtx.yml" "$STAGE/mediamtx/mediamtx.default.yml"
MTX_VER="$("$STAGE/mediamtx/mediamtx" --version 2>/dev/null | head -1 || echo unknown)"

# Приложение: сервер без тестов + собранный фронтенд
mkdir -p "$STAGE/app/server"
cp -r "$ROOT/server/lib" "$ROOT/server/routes" "$STAGE/app/server/"
cp "$ROOT/server/index.js" "$ROOT/server/cli.js" "$ROOT/server/package.json" "$STAGE/app/server/"
cp -r "$ROOT/dist" "$STAGE/app/public"

# Установщик и службы
cp "$ROOT/deploy/install.sh" "$STAGE/install.sh"
cp "$ROOT/deploy/uninstall.sh" "$STAGE/uninstall.sh"
cp "$ROOT/deploy/update.sh" "$STAGE/update.sh"
cp "$ROOT/deploy/rtspatom-admin" "$ROOT/deploy/mediamtx.yml" "$ROOT/deploy/ports.mjs" "$STAGE/deploy/"
cp "$ROOT/deploy/systemd/"*.service "$STAGE/deploy/systemd/"
cp "$ROOT/INSTALL.md" "$STAGE/INSTALL.md"
chmod 755 "$STAGE/install.sh" "$STAGE/uninstall.sh" "$STAGE/update.sh" "$STAGE/deploy/rtspatom-admin" \
  "$STAGE/node/bin/node" "$STAGE/mediamtx/mediamtx"

cat > "$STAGE/VERSION" <<EOF
RTSP Atom ${VERSION} (сборка $(date -u +%Y-%m-%d), git ${GITHUB_SHA:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)})
Node.js ${NODE_VER}
MediaMTX ${MTX_VER}
EOF

(cd "$STAGE" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
tar -C "$(dirname "$STAGE")" -czf "$OUT/$NAME.tar.gz" "$NAME"
(cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
echo "$OUT/$NAME.tar.gz"
cat "$STAGE/VERSION"
