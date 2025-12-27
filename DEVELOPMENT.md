# Development Guidelines

- vision: Highly performant and normie-friendly offline-first Nostr web client that is not dependent on any single relay or other server. Featuring a Cashu wallet, secure DMs and social graph based content filtering. Can be packaged as a Tauri app for desktop/android/ios.
- Don't hardcode Nostr event kinds or other magic numbers. Put them in a constants file`
- Don't import React. Instead import from "react", e.g. `import {RefObject} from "react"`
- Don't repeat yourself — build reusable hooks and components. Keep the code clean and beautiful.
- If file is larger than approximately 200-300 lines, it's probably time to break it into smaller files.
- Check run `pnpm lint --fix` and `pnpm typecheck` after changes
- Use `pnpm build:analyze` for detailed bundle analysis with verbose rollup output
- Avoid layout shift: component state should set on first render when possible, not e.g. empty setState and set on useEffect later. Cache if necessary. Use constant heights where applicable.
- Keep scroll position retention on back nav in feeds functional. Feed should be loaded from cache to reasonable extent. Avoid layout shift.
- Avoid loading spinners for Nostr fetch operations: they're bad UX and Nostr doesnt have a single source of truth anyway. Can't rely solely on "eose" (end of stored events)
- Avoid adding external dependencies, implement especially UI things in our own repo when feasible
- When creating new Playwright tests or debugging failing ones, capture screenshots (`page.screenshot()`) at key points to understand the visual state. Use temp directory (e.g., `/tmp/playwright-debug/`) or remove screenshots after debugging. Agents: Use headless mode if possible. Don't use the html reporter
- Dont add "edited/deleted this" comments
- If tests are not passing, adding long timeouts is usually not the solution. Publish & subscribe over nostr is fast.
- **E2E Test Guidelines**: Keep test times fast (~50s total). Avoid static waits (`waitForTimeout`) - use Playwright's auto-waiting assertions (`toBeVisible`, `toHaveURL`, etc.) instead. Tests run with 100% workers in parallel, so ensure tests are isolated and don't depend on shared state.
- Be careful with react hook dependency arrays — they can easily cause refresh loops
- Note that we're not using react-router-dom: we have our own custom stack router which keeps N previous views open in the background for fast back & fwd nav
- **Stack Router Navigation Pattern**: Background views stay mounted with `display: none` and continue executing useEffect hooks. Always guard navigation/history operations with `useIsTopOfStack()`:

  ```tsx
  import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"

  const isTopOfStack = useIsTopOfStack()

  useEffect(() => {
    if (!isTopOfStack) return // Skip when in background
    // Safe to call navigate(), window.history.pushState/replaceState, etc.
  }, [isTopOfStack, ...otherDeps])
  ```

  Without this guard, background views can trigger unwanted redirects when their state updates.

- Use commit log style similar to previous commits, no verbose descriptions. Make commits only if requested.
- Use the "debug" package for logging, see other logging in the application
