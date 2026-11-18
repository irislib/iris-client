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

### Nostr event index

Iris reads public events from its relays and from the same public Hashtree archive as Iris Social. To use a different index or a downstream fork, set `VITE_NOSTR_EVENT_INDEX` to the publisher’s `npub/tree-name` or an immutable `nhash` before building. An empty value disables index reads. The client verifies signed events and fetches missing index blocks by hash from Hashtree peers and the CDN.

Nostr peers receive an account-wide feed of posts from the signed public follow list, or the latest public posts, and public notifications tagged with the signed-in account. A profile or note lookup filters that feed locally. Two upgraded peers compare their warm inventories with Negentropy. Explicit publication uses INV/WANT. A block provider can still recognize a requested hash. Private inbox subscriptions and peer discovery use separate Nostr requests.

### Public-post search

Automatic search uses a ready browser model when available and otherwise runs
MiniLM on the device. When MiniLM finds no additional words or hashtags for a
multi-word query, it can now select one observed hashtag using a 3.2 KB scoring
layer trained from signed public notes. It reuses the existing tag embeddings,
keeps original tag spelling and stays within the existing relay request budget.
Matching posts from cache and relays appear while MiniLM works. With a
compatible GPU, Iris starts with up to four posts when search is empty and
scores up to 64 at a time when 16 matching authors are already available.
It downloads a 22.9 MB model on demand. Other browsers use the 17.5 MB CPU
model. Both paths reuse recent text embeddings in the search worker.

Training and evaluation used 28,130 English-language notes from 8,056 authors
after filtering and deduplication. Authors and near-duplicate note text were
separated before training. Held-out query labels came from author-supplied
hashtags absent from the note body. In a 32-result-per-filter offline relay
replay, relevant results retrieved rose from 293 to 1,137 across 253 queries.
In a separate 32-query review of 192 public notes, both full plans retrieved
25 of 41 directly relevant notes. A second, earlier sample with unseen authors
retrieved 152 relevant results versus 45 across 51 queries. The sampled relays
and weak tag labels limit how widely these results generalize. Model training
and evaluation commands are in `scripts/search-notes`.

### Discovery graph

Anonymous discovery and accounts with no follows start from Sirius Business Ltd's
public network. Personal accounts keep their own graph root, follows and mutes.
The bundled `src/assets/socialGraph.bin` contains the reviewed Iris mobile member
of the signed Hashtree `social-graph` snapshot. The publisher, name event, immutable
directory, member, crawl time and checksum are recorded in `src/assets/socialGraph.json`.
The mobile projection retains follow and mute revisions, including incomplete lists.
The public app shell in Iris and Groups shows this bundle immediately, then checks
for a fresh signed mobile snapshot in the background when using the default relays.
Public updates must contain at least 10,000 users and half the bundled coverage,
within the SDK's mobile byte, node and edge limits. Malformed, undersized or
unavailable snapshots leave the bundle usable in memory. An untouched bundle is
not saved as a personal cache, so a later visit retries. Retained personal graphs
and actual follow/mute events received during loading stay authoritative; fresh
public partial rows can replace packaged rows without overwriting personal lists.
Custom relay choices disable the public bootstrap. Groups membership and trust
still use their explicit signed group facts.

`pnpm verify:social-graph` checks the committed bytes and topology offline on each
build. To refresh the bundled asset and its receipt, run `pnpm update:social-graph`
and review both files together. It reads the root-specific mobile file directly
from the signed generation. The update command leaves the existing asset in place
if the selected generation has no valid Iris projection or fails the same coverage checks.

In Settings, check the download sizes to see the complete mobile and full file sizes.
The import size, user, edge and distance limits trim the mobile file locally. Users
can merge, replace or save the selected slice. Select **My current graph** to save a
size-limited copy of an imported or personal graph from its own root. Saving the
full published file is a separate action.
After building, run `IRIS_E2E_BUILT_DIST=true pnpm test:graph-bootstrap` to check
the real bundle, legacy-cache migration, personal mutes, and graph import/export.
