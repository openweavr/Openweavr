#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="Weavr Launcher"
BUILD_DIR="$ROOT_DIR/build/macos"
APP_DIR="$BUILD_DIR/$APP_NAME.app"
DMG_PATH="$BUILD_DIR/Weavr-Launcher.dmg"

if [[ ! -d "$APP_DIR" ]]; then
  echo "App not found. Run scripts/macos/build-launcher.sh first." >&2
  exit 1
fi

rm -f "$DMG_PATH"

hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$APP_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "Built: $DMG_PATH"
