import {expect, type Page} from "@playwright/test"

export async function expectPersistedDraft(page: Page, content: string, present = true) {
  // Read committed storage before reloading so the test cannot race an async save.
  await expect
    .poll(() =>
      page.evaluate(
        (expectedContent) =>
          new Promise<boolean>((resolve, reject) => {
            const open = indexedDB.open("localforage")
            open.onerror = () => reject(open.error)
            open.onsuccess = () => {
              const db = open.result
              const transaction = db.transaction("keyvaluepairs", "readonly")
              const request = transaction
                .objectStore("keyvaluepairs")
                .get("draft-storage")
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                const drafts: Record<string, {content: string}> = request.result
                  ? JSON.parse(request.result).state.drafts
                  : {}
                resolve(
                  Object.values(drafts).some((draft) => draft.content === expectedContent)
                )
              }
              transaction.oncomplete = () => db.close()
            }
          }),
        content
      )
    )
    .toBe(present)
}
