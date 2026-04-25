import {test, expect} from "@playwright/test"

test("popular feed renders posts", async ({page}) => {
  test.setTimeout(60000)

  await page.goto("/")
  await expect(page.locator("#main-content")).toBeVisible({timeout: 10000})

  const popularWidget = page.getByRole("heading", {name: "Popular"}).locator("..")

  await expect
    .poll(
      async () => {
        const text = await popularWidget.innerText()
        if (text.includes("No popular posts found")) {
          return "empty"
        }
        if (text.includes("Loading popular posts")) {
          return "loading"
        }

        const visibleLines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => line.toLowerCase() !== "popular")

        return visibleLines.length > 0 ? "ready" : "loading"
      },
      {
        timeout: 45000,
        intervals: [1000, 2000, 3000],
      }
    )
    .toBe("ready")
})
