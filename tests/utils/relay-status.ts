import {expect, type Page} from "@playwright/test"

function firstCount(value: string | null): number {
  return Number(value?.match(/\d+/)?.[0] ?? 0)
}

export async function waitForConnectedRelays(page: Page, timeout = 10_000) {
  const headerIndicator = page.locator('[title*="relays connected"]').first()
  const networkSummary = page.getByRole("link", {name: /^Network \(\d+\/\d+\)$/}).first()

  await expect
    .poll(
      async () => {
        const [headerCount, summaryCount] = await Promise.all([
          headerIndicator
            .textContent()
            .then(firstCount)
            .catch(() => 0),
          networkSummary
            .textContent()
            .then(firstCount)
            .catch(() => 0),
        ])
        return Math.max(headerCount, summaryCount)
      },
      {timeout}
    )
    .toBeGreaterThan(0)
}
