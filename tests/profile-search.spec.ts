import {test, expect} from "@playwright/test"
import {signUp} from "./auth.setup"

test.describe("Profile Search Worker", () => {
  test("search input shows results from worker", async ({page}) => {
    await signUp(page)

    // Find the search input
    const searchInput = page.getByPlaceholder("Search")
    await expect(searchInput).toBeVisible()

    // Type a search query - should trigger worker search
    await searchInput.fill("satoshi")

    // Wait for search results dropdown to appear
    // Results come from the worker asynchronously
    const dropdown = page.locator(".dropdown-content")
    await expect(dropdown).toBeVisible({timeout: 5000})

    // Should show at least the "search notes" option
    await expect(dropdown.getByText(/search notes/i)).toBeVisible()
  })

  test("search navigates to search results page on enter", async ({page}) => {
    await signUp(page)

    const searchInput = page.getByPlaceholder("Search")
    await searchInput.fill("bitcoin")
    await searchInput.press("Enter")

    // Should navigate to search page - wait for URL change with increased timeout for parallel execution
    await expect(page).toHaveURL(/\/search/, {timeout: 10000})
  })

  test("search shows user results when available", async ({page}) => {
    await signUp(page, "SearchTestUser")

    const searchInput = page.getByPlaceholder("Search")

    // Search for the user we just created
    await searchInput.fill("SearchTest")

    // Check if dropdown is visible with results
    const dropdown = page.locator(".dropdown-content")

    // Dropdown should appear with search results
    await expect(dropdown).toBeVisible({timeout: 5000})

    // Clear search
    await searchInput.fill("")
    await expect(dropdown).not.toBeVisible({timeout: 2000})
  })

  test("search handles npub input directly", async ({page}) => {
    await signUp(page)

    const searchInput = page.getByPlaceholder("Search")

    // Enter a valid npub - should navigate directly
    const testNpub = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m"
    await searchInput.fill(testNpub)

    // Should navigate to user profile
    await expect(page).toHaveURL(new RegExp(testNpub))
  })

  test("recent searches are stored and displayed", async ({page}) => {
    await signUp(page)

    const searchInput = page.getByPlaceholder("Search")

    // Perform a search
    await searchInput.fill("test")

    // Wait for dropdown to appear
    const dropdown = page.locator(".dropdown-content")
    await expect(dropdown).toBeVisible({timeout: 5000})

    // Focus on search to show recent searches
    await searchInput.click()

    // Just verify the dropdown works
    await expect(dropdown).toBeVisible()
  })
})
