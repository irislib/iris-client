# Changelog

## 2.5.9

- Hide notification replies, reactions, reposts, pictures, highlights, and zaps
  from unknown or overmuted senders, using the same threshold as profile warnings.
- Wait for the signed-in social graph before loading notification history and
  revalidate cached groups, badge state, account changes, and graph/settings updates.
- Preserve notifications from explicitly followed users unless directly muted,
  and attribute zap visibility to the actual sender instead of the receipt service.

## 2.5.8

- Restore the logged-out Popular feed by waiting for reaction-backed recommendations
  from the default Sirius social graph instead of letting its disabled chronological
  source complete an empty initial load.
- Keep mixed recommendation feeds retryable while an enabled source is still loading,
  settle quiet chronological windows, and fill underfull batches from whichever ready
  source has posts.

## 2.5.7

- Make For You wait for a settled social-graph snapshot and keep that snapshot
  stable until refresh, including across cold starts and account switches.
- Exclude unknown, muted, and overmuted note, reaction, and repost authors from
  recommendations; count unique visible actors and revalidate scoped feed caches.
- Add local-relay journeys for reaction/repost recommendations and graph warning
  parity, plus deterministic coverage for readiness, stale fetches, and auth races.
- Improve iOS feed and infinite-scroll performance, cached-event fetching, and
  service-worker startup behavior.
- Fix NIP-07 reactions on cached posts and surface reply-signing failures.
- Polish profile and read-only sidebar surfaces and update the double-ratchet
  runtime to 0.0.166.

## 2.5.6

- Upgrade the Cashu wallet to the maintained 3.7 LTS API, including cached wallet
  hydration, fee-correct token handling, atomic deterministic counters, restoration,
  and crash-safe Lightning payment recovery.
- Add fast cryptographic fake-mint journeys for mint, send, receive, duplicate-spend,
  melt, lost-response, signed-change, and restart-recovery behavior.
- Refresh compatible cryptography, Nostr, React, Markdown, and CSS tooling
  dependencies, move the supported runtime to Node 22, and clear the remaining
  dependency audit finding.
- Disable raw HTML and JSX parsing in untrusted long-form Nostr articles and add
  regression coverage for signatures, HMAC URLs, Cashu outputs, and hostile
  Markdown.
- Keep Tailwind and DaisyUI on their current stable major versions until their
  coordinated theme and plugin migration can be tested separately.

## 2.5.5

- Harden encrypted messaging startup, backfill deduplication, delivery status,
  device linking and revocation, and single-tab ratchet ownership.
- Add a production-like signup, post, reaction, session-restore, and navigation
  journey with browser performance metrics and faster parallel test gates.
- Serialize notification reconciliation, honor direct-message preferences, and
  report the browser's actual push-subscription state.
- Defer Cashu wallet code, shrink the service-worker precache by about 48%,
  preserve unrelated runtime caches, and accelerate feed and cache operations.
- Fix rapid follow publication races, corrupt-session recovery, signature
  verification recursion, and worker relay-status recovery.
- Replace the browser-opening bundle analyzer with concise CLI build output and
  remove redundant tests, unused dependencies, exports, and source files.

## 2.5.4

- Publish uploaded image metadata only when the exact media URL remains in the
  final post content, preventing removed composer images from leaking into
  ordinary notes and marketplace image tags.

## 2.5.3

- Pin the audited double-ratchet TypeScript 0.0.165 release and verify same-key messaging across two and three browser sessions.
- Remove 149 packages and the remaining development-lock advisory by running the pinned Lighthouse CLI on demand.
- Preserve pending same-origin notification navigation fixes and keep their service-worker implementation lint-clean.
- Share relay-readiness logic between private-message browser gates instead of depending on an optional header indicator.

## 2.5.2

- Pin Hashtree core and index, the shared social graph, and the double-ratchet runtime to immutable audited release archives.
- Route group rosters and messages through the runtime's authenticated group controller, removing the duplicate legacy metadata carrier.
- Replace the local Hashtree override graph and duplicate site-release driver with shared release tooling from Iris Kit.
- Refresh compatible dependencies and replace the full Node browser shim with the one required `buffer` import.
- Gate builds, tests, and releases on the expected archive URLs and checksums.
