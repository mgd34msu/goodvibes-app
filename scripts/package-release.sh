#!/usr/bin/env bash
# Package the built app into a distributable archive with an installer.
# Usage: scripts/package-release.sh <version>   (expects `bun run build` done)
set -euo pipefail

VERSION="${1:?usage: package-release.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
mkdir -p "$OUT"

case "$(uname -s)" in
  Linux)  PLATFORM="linux-x64" ;;
  Darwin) PLATFORM="macos-$(uname -m | sed 's/x86_64/x64/;s/arm64/arm64/')" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows-x64" ;;
  *) echo "unsupported platform"; exit 1 ;;
esac

# Find the newest built bundle (dev/canary/stable channel).
BUNDLE=""
for c in stable-linux-x64/GoodVibes canary-linux-x64/GoodVibes-canary dev-linux-x64/GoodVibes-dev \
         stable-macos-x64/GoodVibes.app dev-macos-x64/GoodVibes-dev.app \
         stable-macos-arm64/GoodVibes.app dev-macos-arm64/GoodVibes-dev.app \
         stable-win-x64/GoodVibes dev-win-x64/GoodVibes-dev; do
  if [ -e "$ROOT/build/$c" ]; then BUNDLE="$ROOT/build/$c"; break; fi
done
# Fallback: take whatever single bundle electrobun produced on this platform.
if [ -z "$BUNDLE" ]; then
  BUNDLE="$(find "$ROOT/build" -maxdepth 2 \( -name 'GoodVibes*' \) -not -path '*/artifacts/*' | head -1)"
fi
[ -n "$BUNDLE" ] || { echo "no built bundle under build/ — run: bun run build"; ls -R "$ROOT/build" | head -20; exit 1; }
echo "packaging bundle: $BUNDLE"

STAGE="$(mktemp -d)/goodvibes-app-$VERSION"
mkdir -p "$STAGE"
cp -a "$BUNDLE" "$STAGE/GoodVibes"

if [ "$PLATFORM" = "linux-x64" ]; then
  # Runtime wrapper: the same env fixes scripts/launch.ts applies in dev,
  # minus the dev eval driver. User env is untouched (child process only).
  cat > "$STAGE/goodvibes-app" <<'WRAP'
#!/usr/bin/env bash
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# WebKitGTK paints a blank window without this on some hardware.
export WEBKIT_DISABLE_DMABUF_RENDERER=1
# GDK_SCALE doubles the XWayland webview on scaled desktops; GTK4 apps ignore it.
unset GDK_SCALE GDK_DPI_SCALE
exec "$HERE/GoodVibes/bin/launcher" "$@"
WRAP
  chmod +x "$STAGE/goodvibes-app"

  cat > "$STAGE/goodvibes-app.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Name=GoodVibes
Comment=Desktop operator console for the GoodVibes daemon
Exec=__INSTALL_DIR__/goodvibes-app
Terminal=false
Categories=Development;Utility;
DESK

  cat > "$STAGE/install.sh" <<'INST'
#!/usr/bin/env bash
# Installs GoodVibes App for the current user (no root needed).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${GOODVIBES_INSTALL_DIR:-$HOME/.local/opt/goodvibes-app}"
BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"

mkdir -p "$DEST" "$BIN" "$APPS"
rm -rf "$DEST/GoodVibes"
cp -a "$SRC/GoodVibes" "$SRC/goodvibes-app" "$DEST/"
ln -sf "$DEST/goodvibes-app" "$BIN/goodvibes-app"
sed "s|__INSTALL_DIR__|$DEST|" "$SRC/goodvibes-app.desktop" > "$APPS/goodvibes-app.desktop"

echo "Installed to $DEST"
echo "  Run:      goodvibes-app   (ensure $BIN is on your PATH)"
echo "  Or launch 'GoodVibes' from your application menu."
echo
echo "Requires: WebKit2GTK + GTK3 system libraries, and a goodvibes-daemon"
echo "(auto-adopted from 127.0.0.1:3421, spawned if found on PATH)."
echo "Uninstall: rm -rf $DEST $BIN/goodvibes-app $APPS/goodvibes-app.desktop"
INST
  chmod +x "$STAGE/install.sh"
fi

ARCHIVE="$OUT/goodvibes-app-$VERSION-$PLATFORM"
if [ "$PLATFORM" = "windows-x64" ]; then
  (cd "$(dirname "$STAGE")" && 7z a -tzip "$ARCHIVE.zip" "$(basename "$STAGE")" > /dev/null) || \
  (cd "$(dirname "$STAGE")" && powershell -Command "Compress-Archive -Path '$(basename "$STAGE")' -DestinationPath '$ARCHIVE.zip'")
  echo "$ARCHIVE.zip"
else
  tar -C "$(dirname "$STAGE")" -czf "$ARCHIVE.tar.gz" "$(basename "$STAGE")"
  echo "$ARCHIVE.tar.gz"
fi
