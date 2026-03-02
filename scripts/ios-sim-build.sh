#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_TAURI_TARGET="${IOS_TAURI_TARGET:-aarch64-sim}"
IOS_SMOKE_OUT="${IOS_SMOKE_OUT:-$ROOT_DIR/build/ios-smoke}"
IOS_LAST_APP_PATH_FILE="${IOS_LAST_APP_PATH_FILE:-$IOS_SMOKE_OUT/last-app-path.txt}"
IOS_BUILD_LOG="${IOS_BUILD_LOG:-$IOS_SMOKE_OUT/ios-sim-build.log}"

mkdir -p "$IOS_SMOKE_OUT"

find_latest_app_path() {
  local raw
  raw="$(
    find "$HOME/Library/Developer/Xcode/DerivedData" "$ROOT_DIR/src-tauri/gen/apple/build" \
      -type d \
      -path '*/Build/Products/debug-iphonesimulator/iris.app' \
      -print0 2>/dev/null \
      | xargs -0 stat -f '%m %N' 2>/dev/null \
      | sort -nr \
      | head -n1 || true
  )"

  if [[ -n "$raw" ]]; then
    echo "${raw#* }"
  fi
}

echo "[ios-sim-build] running tauri iOS simulator build"
set +e
pnpm tauri ios build --debug --target "$IOS_TAURI_TARGET" --ci >"$IOS_BUILD_LOG" 2>&1
TAURI_STATUS=$?
set -e
cat "$IOS_BUILD_LOG"

APP_PATH="$(find_latest_app_path)"

if [[ $TAURI_STATUS -eq 0 ]]; then
  if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
    echo "tauri build succeeded but simulator app path was not found" >&2
    exit 1
  fi

  printf '%s\n' "$APP_PATH" > "$IOS_LAST_APP_PATH_FILE"
  echo "[ios-sim-build] app: $APP_PATH"
  exit 0
fi

if grep -q 'failed to rename app .*Directory not empty' "$IOS_BUILD_LOG"; then
  if [[ -n "$APP_PATH" && -d "$APP_PATH" ]]; then
    printf '%s\n' "$APP_PATH" > "$IOS_LAST_APP_PATH_FILE"
    echo "[ios-sim-build] tauri hit known simulator rename bug; using built app at $APP_PATH"
    exit 0
  fi
fi

echo "[ios-sim-build] tauri build failed (see $IOS_BUILD_LOG)" >&2
exit "$TAURI_STATUS"
