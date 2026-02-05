#!/usr/bin/env bash
set -euo pipefail

LAUNCHAGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCHAGENTS_DIR/ai.openweavr.server.plist"
WEAVR_BIN="$(command -v weavr || true)"

if [[ -z "$WEAVR_BIN" ]]; then
  echo "weavr CLI not found in PATH. Install it first." >&2
  exit 1
fi

mkdir -p "$LAUNCHAGENTS_DIR"

cat > "$PLIST_PATH" << EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.openweavr.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>$WEAVR_BIN</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/Weavr/serve.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/Weavr/serve.log</string>
</dict>
</plist>
EOF_PLIST

mkdir -p "$HOME/Library/Logs/Weavr"

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load "$PLIST_PATH"

echo "Installed LaunchAgent: $PLIST_PATH"
