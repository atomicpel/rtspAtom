#!/bin/bash
# Сборка офлайн-пакета для Windows 11 x64.
#   scripts/build-bundle-windows.sh <node-win-x64.zip> <mediamtx_windows_amd64.zip> <WinSW-x64.exe> <выходной каталог>
# Перед запуском должен быть собран фронтенд (npm run build -> dist/).
set -euo pipefail

NODE_ZIP="$1"; MTX_ZIP="$2"; WINSW="$3"; OUT="$4"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NAME="rtspatom-${VERSION}-windows-x64"
STAGE="$(mktemp -d)/$NAME"

[ -f "$ROOT/dist/index.html" ] || { echo "Нет dist/ — выполните npm run build" >&2; exit 1; }
command -v unzip >/dev/null && command -v zip >/dev/null || { echo "Нужны zip и unzip" >&2; exit 1; }

mkdir -p "$STAGE"/{node,mediamtx,service,app/server,deploy/windows}

# Node.js: только node.exe и лицензия
tmp="$(mktemp -d)"
unzip -q "$NODE_ZIP" -d "$tmp"
nd="$(find "$tmp" -maxdepth 1 -mindepth 1 -type d | head -1)"
cp "$nd/node.exe" "$nd/LICENSE" "$STAGE/node/"
NODE_VER="$(basename "$nd" | sed -E 's/^node-(v[0-9.]+)-.*/\1/')"

# MediaMTX
tmp2="$(mktemp -d)"
unzip -q "$MTX_ZIP" -d "$tmp2"
cp "$tmp2/mediamtx.exe" "$STAGE/mediamtx/"
[ -f "$tmp2/LICENSE" ] && cp "$tmp2/LICENSE" "$STAGE/mediamtx/"
[ -f "$tmp2/mediamtx.yml" ] && cp "$tmp2/mediamtx.yml" "$STAGE/mediamtx/mediamtx.default.yml"
MTX_VER="$(basename "$MTX_ZIP" | sed -E 's/^mediamtx_(v[0-9.]+)_.*/\1/')"

# WinSW — обёртка, превращающая node.exe и mediamtx.exe в службы Windows
cp "$WINSW" "$STAGE/service/WinSW.exe"

# Приложение
cp -r "$ROOT/server/lib" "$ROOT/server/routes" "$STAGE/app/server/"
cp "$ROOT/server/index.js" "$ROOT/server/cli.js" "$ROOT/server/package.json" "$STAGE/app/server/"
cp -r "$ROOT/dist" "$STAGE/app/public"

# Установщик
cp "$ROOT/deploy/mediamtx.yml" "$STAGE/deploy/"
cp "$ROOT/deploy/windows/"* "$STAGE/deploy/windows/"
mv "$STAGE/deploy/windows/install.ps1" "$STAGE/deploy/windows/install.cmd" "$STAGE/"
cp "$ROOT/INSTALL-WINDOWS.md" "$STAGE/INSTALL.md"

# Windows-окончания строк; PowerShell 5.1 читает .ps1 без BOM в кодировке ANSI — добавляем BOM.
for f in "$STAGE"/*.cmd "$STAGE"/*.ps1 "$STAGE"/INSTALL.md "$STAGE"/deploy/windows/*.cmd "$STAGE"/deploy/windows/*.ps1 "$STAGE"/deploy/windows/*.xml; do
  sed -i 's/\r$//; s/$/\r/' "$f"
done
for f in "$STAGE"/*.ps1 "$STAGE"/deploy/windows/*.ps1; do
  printf '\xEF\xBB\xBF' | cat - "$f" > "$f.bom" && mv "$f.bom" "$f"
done

printf 'RTSP Atom %s для Windows x64 (сборка %s, git %s)\r\nNode.js %s\r\nMediaMTX %s\r\n' \
  "$VERSION" "$(date -u +%Y-%m-%d)" "${GITHUB_SHA:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)}" \
  "$NODE_VER" "$MTX_VER" > "$STAGE/VERSION.txt"

(cd "$STAGE" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
rm -f "$OUT/$NAME.zip"
(cd "$(dirname "$STAGE")" && zip -qr -9 "$OUT/$NAME.zip" "$NAME")
(cd "$OUT" && sha256sum "$NAME.zip" > "$NAME.zip.sha256")
echo "$OUT/$NAME.zip"
cat "$STAGE/VERSION.txt"
