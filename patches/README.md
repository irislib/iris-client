# Social graph runtime patch

The pinned `nostr-social-graph` 2.0.0 release clears its live distance maps during
asynchronous recalculation and queues one full traversal per concurrent request.
The patch builds distances separately, publishes them atomically, and coalesces
pending requests. It includes the TypeScript source and both distributed entry
points; the CommonJS bundle is minified, so its diff is necessarily large.

`src/utils/socialGraphRecalculation.test.ts` verifies complete reads throughout
recalculation and that a burst of requests includes concurrent graph changes
without scheduling a traversal for each request.
