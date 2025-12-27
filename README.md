# Iris

Highly performant and normie-friendly offline-first Nostr web client that is not dependent on any single relay or other server. Featuring a Cashu wallet, secure DMs and social graph based content filtering. Can be packaged as a Tauri app for desktop/android/ios.

Source code for [iris.to](https://iris.to)

[![Checks](https://github.com/irislib/iris-client/actions/workflows/checks.yml/badge.svg)](https://github.com/irislib/iris-client/actions/workflows/checks.yml)
[![Tests](https://github.com/irislib/iris-client/actions/workflows/tests.yml/badge.svg)](https://github.com/irislib/iris-client/actions/workflows/tests.yml)
[![Tauri Build](https://github.com/irislib/iris-client/actions/workflows/tauri.yml/badge.svg)](https://github.com/irislib/iris-client/actions/workflows/tauri.yml)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/irislib/iris-client)

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test    # Run all tests
pnpm test:ui # E2E tests with UI mode
```

### Tauri

```bash
# Desktop
pnpm tauri dev
pnpm tauri build

# Mobile
pnpm tauri [android|ios] init
pnpm tauri [android|ios] dev

# App Store builds
pnpm tauri ios build --open        # Opens Xcode → Archive → Distribute
pnpm tauri android build --aab     # Requires keystore setup: https://v2.tauri.app/distribute/sign/android/
```
