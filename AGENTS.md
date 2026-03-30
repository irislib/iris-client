# AGENTS.md

Testing preference:
- Prefer Playwright e2e tests for user-visible behavior, regressions, and cross-component flows.
- Do not add Vitest tests for React component behavior or UI workflows when the same behavior can be covered end-to-end.
- Use Vitest only for narrow pure-logic or low-level library code where e2e would be disproportionate.
- When replacing a shallow UI Vitest test with meaningful e2e coverage, prefer deleting the Vitest test.
