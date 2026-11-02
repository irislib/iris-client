# Iris

> Main development is on [decentralized git](https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/iris-client): `htree://npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/iris-client`

Highly performant and normie-friendly offline-first Nostr web client that is not dependent on any single relay or other server. Featuring a Cashu wallet, secure DMs and social graph based content filtering.

Source code for [iris.to](https://iris.to)

CI results are shown in the `git.iris.to` commit history for this repo.

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

### Discovery graph

Anonymous discovery and accounts with no follows start from Sirius Business Ltd's
public network. Personal accounts keep their own graph root, follows and mutes.
The bundled `src/assets/socialGraph.bin` is a 1.6 MB projection of the pinned public
snapshot recorded in `src/assets/socialGraph.json`: complete follow and mute lists
from owners within two hops, including their third-hop targets. It contains
31,187 identities and 4,149 mute relationships. Duplicate internal identities are
normalized by public key before traversal. Newest lists win; equally recent
conflicting mutes are combined conservatively, and conflicting latest follows
reject the update. This dated aggregate is a discovery starting point, not a
collection of individually verified signed events.

Builds verify the committed asset and never download changing graph data.
`pnpm update:social-graph` restores the same bytes from the checksum-pinned
[shared snapshot release](https://github.com/mmalmi/nostr-social-graph/releases/tag/v3.0.1).
To regenerate it from the original 50 MB input recorded in the manifest, use
`pnpm update:social-graph /path/to/source.bin` with the locked dependency. Both
source and projected hashes must match before the asset is replaced. The shared
data does not require upgrading the Client's graph SDK. Intentional updates require
reviewing the manifest, projection, and cold-start coverage together.
After building, run `IRIS_E2E_BUILT_DIST=true pnpm test:graph-bootstrap` to check
the real bundle, legacy-cache migration, personal mutes, and graph import/export.
