import type {Page} from "@playwright/test"

export async function enableHeaderConnectivity(page: Page) {
  await page.addInitScript(() => {
    const raw = window.localStorage.getItem("ui-storage")
    const stored = raw ? JSON.parse(raw) : {}
    window.localStorage.setItem(
      "ui-storage",
      JSON.stringify({
        ...stored,
        state: {
          ...(stored.state ?? {}),
          showRelayIndicator: true,
        },
        version: typeof stored.version === "number" ? stored.version : 0,
      })
    )
  })
}
