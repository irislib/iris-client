import {expect, type Page} from "@playwright/test"

export async function waitForConnectedRelays(page: Page, timeout = 10_000) {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(async () => {
            const modulePath = "/src/utils/ndk.ts"
            const {getWorkerTransport} = await import(/* @vite-ignore */ modulePath)
            const statuses = await getWorkerTransport()?.getRelayStatus()
            return (
              statuses?.filter(({status}: {status: number}) => status >= 5).length ?? 0
            )
          })
        } catch {
          const summary = await page
            .getByRole("link", {name: /^Network \(\d+\/\d+\)$/})
            .first()
            .textContent()
            .catch(() => null)
          return Number(summary?.match(/\((\d+)\//)?.[1] ?? 0)
        }
      },
      {timeout}
    )
    .toBeGreaterThan(0)
}
