#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/macos/WeavrLauncher"
BUILD_DIR="$ROOT_DIR/build/macos"
APP_NAME="Weavr Launcher"
APP_DIR="$BUILD_DIR/$APP_NAME.app"
ICON_SRC="$ROOT_DIR/assets/weavr-icon.png"

mkdir -p "$BUILD_DIR"
rm -rf "$APP_DIR"

xcrun swiftc \
  -O \
  -framework AppKit \
  -framework SwiftUI \
  "$SRC_DIR/WeavrLauncher.swift" \
  "$SRC_DIR/main.swift" \
  -o "$BUILD_DIR/$APP_NAME"

mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

cp "$BUILD_DIR/$APP_NAME" "$APP_DIR/Contents/MacOS/$APP_NAME"
cp "$SRC_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
if [[ -f "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "$APP_DIR/Contents/Resources/weavr-icon.png"
fi

chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

echo "Built: $APP_DIR"
