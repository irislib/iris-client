# Iris

> Main development is on [decentralized git](https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/iris-client): `htree://npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/iris-client`

Highly performant and normie-friendly offline-first Nostr web client that is not dependent on any single relay or other server. Featuring a Cashu wallet, secure DMs and social graph based content filtering.

Source code for [iris.to](https://iris.to)

[![Checks](https://github.com/irislib/iris-client/actions/workflows/checks.yml/badge.svg)](https://github.com/irislib/iris-client/actions/workflows/checks.yml)
[![Tests](https://github.com/irislib/iris-client/actions/workflows/tests.yml/badge.svg)](https://github.com/irislib/iris-client/actions/workflows/tests.yml)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/irislib/iris-client)

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Publish a dev tree for testing inside Iris
pnpm devpublish

# Run tests
pnpm test    # Run all tests
pnpm test:ui # E2E tests with UI mode
```
