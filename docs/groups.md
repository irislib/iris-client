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

## Member identity, consent, and vouches

The first profile version has one voting identity per signing public key. It
uses the same `controls` vocabulary and shared fact envelopes as Iris Contacts.
Contacts can store independently authored UUIDv4 identities and multiple asserted
keys; this group profile does **not** interpret those assertions as permission to
merge accounts or ballots. Key rotation and verified-human uniqueness are outside
this profile.

This baseline is not sufficient for adversarial civic decisions. A compromised
creator or a trusted member can endorse many accounts; unique routes checked
separately for each candidate do not bound their combined voting influence.
Stronger founding trust, admission limits, and a frozen poll electorate need a
separate adversarial acceptance gate before a public decision-making release.

For repeatable member statements, the fact subject is a deterministic UUIDv8:
take the first 16 bytes of SHA-256 of UTF-8 `iris-group-member:<hex pubkey>`, set
the UUID version to 8 and the RFC variant, then encode as lowercase UUID. This
subject is an envelope identifier, not an independent source of identity
authority. Parsers require it to match the single `controls` key, and decisions
remain keyed by the complete public key.

Both consent and vouches use the shared `buildFactOpDraft` and
`parseFactOpEvent` envelope, kind `7368`, and empty content:

| Predicate   | Consent                 | Vouch                   |
| ----------- | ----------------------- | ----------------------- |
| `type`      | `iris_group_membership` | `iris_group_vouch`      |
| `schema`    | `1`                     | `1`                     |
| `controls`  | Member public key       | Member public key       |
| `member_of` | Group UUID, creator key | Group UUID, creator key |

An inactive state substitutes `not_member_of` for `member_of`; containing both
is invalid. Consent must be signed by the member's own key. A vouch is signed by
its issuer and cannot provide consent on behalf of the member. Self-vouches do
not count. A withdrawal applies only to its own signer and target; fact `replace`
or `dispute` links cannot withdraw somebody else's consent or vouch.

Creation supplies initial consent and eligibility for the creator, allowing the
group to begin. Any explicit creator consent state overrides that bootstrap;
metadata updates never undo a leave. A member's leave suppresses their eligibility
and their ability to provide counted vouches. Rejoining re-enables currently
active vouches; leaving does not publish withdrawals on other people's behalf.

For each group and member, keep the latest consent. For each group, member, and
vouch issuer, keep the latest vouch. Larger `created_at` wins; at equal timestamps
the lexicographically smaller event ID wins, matching NIP-01 replacement order.
Metadata uses the same order. Draft callers should avoid making consecutive
state changes in the same second if they need predictable user-intended ordering.

Parsers verify signatures and reject malformed envelopes, ambiguous required
facts, wrong owner addresses, oversized tags, and future timestamps. A valid
`expiration` is evaluated **after** selecting the latest state: an expired latest
join/vouch is inactive, rather than restoring an older active claim. An expired
latest metadata event likewise does not restore older metadata. Stores must
refresh projections as time advances and treat received event objects as
immutable so signature-verification caching remains valid.

## Personal trust

The default view uses the creator's contact network and published thresholds.
The optional personal view uses the viewer's network and chosen thresholds. The
same events, graph snapshot, time, and policy yield the same membership result;
different views or incomplete relay histories can yield different results.

Direct vouches come from the trust root itself or its direct followees. A
second-degree vouch must come from a followee of a direct contact. Direct vouchers
are excluded from the second-degree count. Maximum bipartite matching pairs each
counted second-degree voucher with a different direct contact: one contact's large
fan-out cannot create many independent votes of confidence. The prospective
member cannot serve as their own bridge. The default acceptance threshold is one
direct vouch **or** three independent second-degree vouches, plus active consent.

Only already eligible members supply counted vouches. Eligibility is the least
fixed point starting from the consenting creator: repeatedly admit consenting
members who meet a threshold through existing eligible members. Recompute this
closure after every relevant state change; a mutually vouching pending cluster
cannot admit itself, and withdrawal can remove downstream eligibility. With this
initial single-founder rule, the creator leaving removes the only seed. Likewise,
setting both thresholds above one before admitting any other members prevents
growth. These are explicit baseline limitations, not a hardened founding policy.

Trust traversal is bounded to 256 direct contacts, 2048 scanned entries per contact,
and 32768 total scanned entries. The returned `truncated` flag signals that the
network view may omit evidence. Invalid or duplicate contact entries consume the
scan budget as well, so malformed iterables cannot cause unlimited work.

Polls and engagement must use the selected view's current `eligiblePubkeys`.
Counts may change when consent, vouches, contact lists, thresholds, or available
relay data change. One signed account is one participant; the UI must describe
the result as an advisory count of eligible accounts in the selected view.
