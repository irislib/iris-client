#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_CONFIGURATION="${IOS_CONFIGURATION:-debug}"
IOS_SDK="${IOS_SDK:-iphonesimulator}"
IOS_DERIVED_DATA="${IOS_DERIVED_DATA:-$ROOT_DIR/src-tauri/gen/apple/build/sim-derived-data}"
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-to.iris}"
IOS_SIM_DEVICE="${IOS_SIM_DEVICE:-iPhone 17}"
IOS_SMOKE_OUT="${IOS_SMOKE_OUT:-$ROOT_DIR/build/ios-smoke}"
IOS_LAST_APP_PATH_FILE="${IOS_LAST_APP_PATH_FILE:-$IOS_SMOKE_OUT/last-app-path.txt}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  "$ROOT_DIR/scripts/ios-sim-build.sh"
fi

APP_PATH="${IOS_APP_PATH:-}"
if [[ -z "$APP_PATH" && -f "$IOS_LAST_APP_PATH_FILE" ]]; then
  APP_PATH="$(cat "$IOS_LAST_APP_PATH_FILE")"
fi

if [[ -z "$APP_PATH" ]]; then
  APP_PATH="$IOS_DERIVED_DATA/Build/Products/${IOS_CONFIGURATION}-${IOS_SDK}/iris.app"
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "app not found at $APP_PATH" >&2
  exit 1
fi

SIM_UDID="${IOS_SIM_UDID:-}"
if [[ -z "$SIM_UDID" ]]; then
  SIM_UDID="$(
    xcrun simctl list devices --json | node -e '
      const fs = require("node:fs");
      const target = process.argv[1];
      const data = JSON.parse(fs.readFileSync(0, "utf8"));
      for (const runtimeDevices of Object.values(data.devices ?? {})) {
        for (const d of runtimeDevices ?? []) {
          if (d?.isAvailable && d?.name === target && d?.udid) {
            process.stdout.write(d.udid);
            process.exit(0);
          }
        }
      }
      process.exit(1);
    ' "$IOS_SIM_DEVICE"
  )"
fi

if [[ -z "$SIM_UDID" ]]; then
  echo "unable to find simulator for device name: $IOS_SIM_DEVICE" >&2
  exit 1
fi

echo "[ios-smoke] simulator: $IOS_SIM_DEVICE ($SIM_UDID)"
xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIM_UDID" -b

echo "[ios-smoke] installing app"
xcrun simctl install "$SIM_UDID" "$APP_PATH"

echo "[ios-smoke] launching app ($IOS_BUNDLE_ID)"
xcrun simctl terminate "$SIM_UDID" "$IOS_BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl launch "$SIM_UDID" "$IOS_BUNDLE_ID"

sleep 4

mkdir -p "$IOS_SMOKE_OUT"
SHOT_PATH="$IOS_SMOKE_OUT/launch-$(date +%Y%m%d-%H%M%S).png"
xcrun simctl io "$SIM_UDID" screenshot "$SHOT_PATH" >/dev/null

echo "[ios-smoke] screenshot: $SHOT_PATH"
echo "[ios-smoke] pass"
