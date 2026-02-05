#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="Weavr Launcher"
BUILD_DIR="$ROOT_DIR/build/macos"
APP_DIR="$BUILD_DIR/$APP_NAME.app"
PKG_PATH="$BUILD_DIR/Weavr-Launcher.pkg"
STAGING_DIR="$(mktemp -d)"

if [[ ! -d "$APP_DIR" ]]; then
  echo "App not found. Run scripts/macos/build-launcher.sh first." >&2
  exit 1
fi

rm -f "$PKG_PATH"

mkdir -p "$STAGING_DIR"
cp -R "$APP_DIR" "$STAGING_DIR/$APP_NAME.app"

pkgbuild \
  --root "$STAGING_DIR" \
  --install-location "/Applications" \
  --identifier "ai.openweavr.launcher" \
  --version "0.1.0" \
  "$PKG_PATH"

rm -rf "$STAGING_DIR"

echo "Built: $PKG_PATH"
