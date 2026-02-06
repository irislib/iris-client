# Dev Relay

Local Nostr relay used by Playwright E2E tests.

- WebSocket: `ws://127.0.0.1:7777`
- Health: `http://127.0.0.1:7777/health`

The app's E2E suite starts this Node.js in-memory relay automatically (no Docker).

## Run

```bash
pnpm relay:start
```

## Seed with test data

Seeding is optional and uses the Wellorder dataset:

- https://wiki.wellorder.net/wiki/nostr-datasets/
- https://wellorder.xyz/nostr/nostr-wellorder-early-500k-v1.jsonl.bz2

Requires `bzip2` to be installed.

```bash
pnpm relay:start -- --seed 80000 --port 7777
```

## Important

Clear browser cache/storage to only see events from this relay (`ws://127.0.0.1:7777`).
