# Tauri-driver DM smoke test

This suite validates a basic private DM path with two real Tauri app sessions:

1. Create sender + receiver users
2. Register both devices
3. Sender opens receiver profile and sends a DM
4. Receiver opens sender profile and verifies the DM

## Run

```bash
pnpm tauri:test:dm
```

## Requirements

- OS: Linux or Windows (Tauri does not support `tauri-driver` on macOS)
- `tauri-driver` installed and available in `PATH`
- Native driver:
  - Linux: `WebKitWebDriver`
  - Windows: `msedgedriver`

## Useful env vars

- `IRIS_TAURI_APP_PATH`: path to app binary (without `.exe` on Windows preferred)
- `IRIS_TAURI_FORCE_BUILD=1`: force `pnpm tauri build --debug --no-bundle`
- `IRIS_TAURI_SKIP_BUILD=1`: skip build step if binary already exists
- `TAURI_DRIVER_BIN`: override `tauri-driver` executable name/path
- `TAURI_DRIVER_PORT`, `TAURI_NATIVE_DRIVER_PORT`: override ports (defaults `4444`/`4445`)
- `IRIS_DM_TEST_RELAY_PORT`: override relay port (default `7777`)

On failure, screenshots are saved under `/tmp/iris-tauri-driver/`.
