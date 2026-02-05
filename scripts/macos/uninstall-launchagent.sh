#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="$HOME/Library/LaunchAgents/ai.openweavr.server.plist"

if [[ -f "$PLIST_PATH" ]]; then
  launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "Removed LaunchAgent: $PLIST_PATH"
else
  echo "LaunchAgent not found: $PLIST_PATH"
fi
