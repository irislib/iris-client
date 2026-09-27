# Iris Groups fact profile

Groups are public Nostr communities with a group-scoped kind-1 feed. Membership,
engagement, and poll totals are personal projections of the signed facts and
social graph available to the client. They are not a global registry, proof of
unique humans, a complete census, or a binding election system.

## Group identity and discovery

A group has a canonical lowercase UUID and a creator public key. Its address is
`37368:<creator pubkey>:<group UUID>`. Both parts are required: an unrelated
publisher may reuse a UUID, but cannot update the original creator's group.

Every group fact, post, and poll carries both `h` (the UUID) and `a` (this address).
Consumers require both to agree with the selected group. A bare `h` tag never
establishes the group owner. Group feeds use ordinary kind-1 notes, not NIP-72
moderated-community threads. Replies and engagement use the same scope.

Metadata uses the shared `nostr-social-graph` `buildFactSnapshotDraft` and
`parseFactSnapshotEvent` envelope, kind `37368`, with empty content and subject
and `d` tags equal to the group UUID. Profile facts are:

| Predicate                 | Values                       |
| ------------------------- | ---------------------------- |
| `type`                    | `iris_group`                 |
| `schema`                  | `1`                          |
| `creator`                 | Signing creator's public key |
| `name`                    | 1–80 characters              |
| `description`             | Up to 2000 characters        |
| `direct_threshold`        | Integer 1–20                 |
| `second_degree_threshold` | Integer 1–20                 |

The discovery marker is `t=iris-group`. To fetch a known group, filter metadata
by creator and `#d`; fetch membership facts by kind `7368` and `#a`. Group facts
also index the UUID with `i`, following the shared envelope's subject/index
distinction. Relay result limits and partial histories must not be presented as
complete membership records.

## Member identity, consent, and attestations

The first profile version has one voting identity per signing public key. It
uses the same `controls` vocabulary and shared fact envelopes as Iris Contacts.
Contacts can store independently authored UUIDv4 identities and multiple asserted
keys; this group profile does **not** interpret those assertions as permission to
merge accounts or ballots. Key rotation and verified-human uniqueness are outside
this profile.

Membership alone is not voting or ranking authority. A compromised creator or a
trusted member can endorse many accounts; unique routes checked separately for
each candidate do not bound their combined influence. The authority rules below
separate those account admissions from the trusted result.

For repeatable member statements, the fact subject is a deterministic UUIDv8:
take the first 16 bytes of SHA-256 of UTF-8 `iris-group-member:<hex pubkey>`, set
the UUID version to 8 and the RFC variant, then encode as lowercase UUID. This
subject is an envelope identifier, not an independent source of identity
authority. Parsers require it to match the single `controls` key, and decisions
remain keyed by the complete public key.

Both consent and attestations use the shared `buildFactOpDraft` and
`parseFactOpEvent` envelope, kind `7368`, and empty content:

| Predicate   | Consent                 | Attestation              |
| ----------- | ----------------------- | ------------------------ |
| `type`      | `iris_group_membership` | `iris_group_attestation` |
| `schema`    | `1`                     | `1`                      |
| `controls`  | Member public key       | Member public key        |
| `member_of` | Group UUID, creator key | Group UUID, creator key  |

An inactive state substitutes `not_member_of` for `member_of`; containing both
is invalid. Consent must be signed by the member's own key. An attestation is signed by
its issuer and cannot provide consent on behalf of the member. Self-attestations do
not count. A withdrawal applies only to its own signer and target; fact `replace`
or `dispute` links cannot withdraw somebody else's consent or attestation.

Creation supplies initial consent and eligibility for the creator, allowing the
group to begin. Any explicit creator consent state overrides that bootstrap;
metadata updates never undo a leave. A member's leave suppresses their eligibility
and their ability to provide counted attestations. Rejoining re-enables currently
active attestations; leaving does not publish withdrawals on other people's behalf.

For each group and member, keep the latest consent. For each group, member, and
attestation issuer, keep the latest attestation. Larger `created_at` wins; at equal timestamps
the lexicographically smaller event ID wins, matching NIP-01 replacement order.
Metadata uses the same order. Draft callers should avoid making consecutive
state changes in the same second if they need predictable user-intended ordering.

Parsers verify signatures and reject malformed envelopes, ambiguous required
facts, wrong owner addresses, oversized tags, and future timestamps. A valid
`expiration` is evaluated **after** selecting the latest state: an expired latest
join/attestation is inactive, rather than restoring an older active claim. An expired
latest metadata event likewise does not restore older metadata. Stores must
refresh projections as time advances and treat received event objects as
immutable so signature-verification caching remains valid.

## Personal trust

The default view uses the creator's contact network and published thresholds.
The optional personal view uses the viewer's network and chosen thresholds. The
same events, graph snapshot, time, and policy yield the same membership result;
different views or incomplete relay histories can yield different results.

Direct attestations come from the trust root itself or its direct followees. A
second-degree attestation must come from a followee of a direct contact. Direct attestation issuers
are excluded from the second-degree count. Maximum bipartite matching pairs each
counted second-degree issuer with a different direct contact: one contact's large
fan-out cannot create many independent votes of confidence. The prospective
member cannot serve as their own bridge. The default acceptance threshold is one
direct attestation **or** three independent second-degree attestations, plus active consent.

Only already eligible members supply counted attestations. Eligibility is the least
fixed point starting from the consenting creator: repeatedly admit consenting
members who meet a threshold through existing eligible members. Recompute this
closure after every relevant state change; a mutually confirming pending cluster
cannot admit itself, and withdrawal can remove downstream eligibility. With this
initial single-founder rule, the creator leaving removes the only seed. Likewise,
setting both thresholds above one leaves no path beyond that single seed, even
if accounts were eligible under an earlier policy. Creation therefore uses the
default policy (one direct or three second-degree attestations); the initial UI does
not offer custom thresholds. Multi-confirmation policies need a future explicit
founding-set design. These are explicit baseline limitations, not a hardened
founding policy.

Trust traversal is bounded to 256 direct contacts, 2048 scanned entries per contact,
and 32768 total scanned entries. The returned `truncated` flag signals that the
network view may omit evidence. Invalid or duplicate contact entries consume the
scan budget as well, so malformed iterables cannot cause unlimited work.

## Voting and ranking authority

The shared `nostr-social-graph` `chooseTrustedAuthors` helper selects the root
itself and its **direct** followees, intersected with currently eligible members.
The resulting `authorityPubkeys` never includes descendants merely because they
received membership attestations. An admitted member does not gain the power to create more
trusted voting accounts. `countDistinctTrustedAuthors` counts at most one signal
per authorized key, including when events are repeated or relayed many times.

The canonical helper source is the library's `trustedAuthors.ts`, introduced in
commit `40eceb3`. Until a pinned package release includes that commit, this app
consumes its compiled exports through a reproducible pnpm dependency patch.
Remove the patch when the package version includes the helper; do not maintain a
second application implementation.

Member ballots and the trusted result are separate visible counts. A member can
participate without being in the selected view's authority set; that distinction
must be explained before voting. Engagement ranking uses distinct authority
accounts, while member activity remains visible. These are accounts, not verified
humans, and the trusted result is not a claim to represent everyone equally.

One compromised directly trusted member can admit 1000 or 10000 accounts, but
cannot turn them into additional trusted votes. The creator choosing new trusted
accounts and collusion among existing trusted accounts are explicit assumption
boundaries. The helper does not protect against a compromised trust root. It also
does not solve content-volume floods: many low-ranked posts still require normal
feed limits, diversity, and moderation controls.

## Poll electorate snapshots

`deriveGroupElectorate` freezes the creator's published policy and observed
membership view at poll opening. It supplies the metadata event ID, root, policy,
eligible member keys, authority keys, and positive membership/attestation evidence IDs.
It refuses a truncated graph view, more than 257 authority accounts (root plus
256 direct contacts), or more than 2048 required evidence events. The member
roster is an explicitly observed subset capped at 512: it preserves every known
authority account, the creator, and the current publisher before filling the
remaining slots deterministically. `memberSnapshotLimited` records when member
discovery or this roster bound omitted accounts. The publisher separately checks
protected-evidence readiness and its serialized-event size limit. An overflowing
untrusted join inbox must not block retrieval of known trusted accounts.

The signed poll commits those explicit keys. Later membership, attestation, follow, or
threshold changes affect new views and polls, not the frozen roster. Positive
evidence documents the author's observed projection; it cannot prove no facts
were omitted or that a relay supplied a complete history. The signed root contact
event is required for non-root authority, and second-degree contact events are
included when membership depends on those paths. Receivers fetch and replay the
committed evidence through the same membership rules before enabling counts or
voting. Missing consent, forged attestations, unrelated policy, unsupported authority,
and known preopening root-list rollback fail closed.

The live group view reads the latest signed creator and bridge contact lists
directly, independently of the viewer's personal graph cache. Admission proofs
retain only the required attestations and their earlier admission dependencies;
only the root and bridges used by those proofs add contact-list evidence. A
direct admission does not embed every contact's follow list in the poll.

Known creator/direct-member evidence has stable per-author subscriptions and
bounded semantic state slots. Open join discovery and its expanding candidate
queries use separate bounds, so outsider request floods do not restart trusted
queries or consume their retained consent and withdrawal slots. Discovery can
still miss members; the displayed roster and poll remain observed subsets.

Self-declared Nostr timestamps also do not prove receipt before a poll closes.
An eligible key can backdate a late event. Without an independently agreed
receipt/closure mechanism, results remain advisory and may change with late
relay data. A frozen roster supplies stable participation rules, not certified
election finality.
