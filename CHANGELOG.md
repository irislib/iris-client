# Changelog

## 2.5.2

- Pin Hashtree core and index, the shared social graph, and the double-ratchet runtime to immutable audited release archives.
- Route group rosters and messages through the runtime's authenticated group controller, removing the duplicate legacy metadata carrier.
- Replace the local Hashtree override graph and duplicate site-release driver with shared release tooling from Iris Kit.
- Refresh compatible dependencies and replace the full Node browser shim with the one required `buffer` import.
- Gate builds, tests, and releases on the expected archive URLs and checksums.
