import {afterEach, describe, expect, it} from "vitest"
import {IndexedDbRepositories} from ".."

const openDatabases: IndexedDbRepositories[] = []

afterEach(async () => {
  const [first, ...rest] = openDatabases.splice(0)
  rest.forEach(({db}) => db.close())
  if (first) await first.db.delete()
})

describe("IdbCounterRepository", () => {
  it("atomically reserves unique ranges across concurrent database clients", async () => {
    const name = `cashu-counter-${crypto.randomUUID()}`
    const first = new IndexedDbRepositories({name})
    const second = new IndexedDbRepositories({name})
    openDatabases.push(first, second)
    await first.init()
    await second.init()

    const repositories = [first.counterRepository, second.counterRepository]
    const starts = await Promise.all(
      Array.from({length: 20}, (_, index) =>
        repositories[index % repositories.length].reserveCounter(
          "https://mint.example",
          "keyset",
          1
        )
      )
    )

    expect(starts.toSorted((a, b) => a - b)).toEqual(
      Array.from({length: 20}, (_, index) => index)
    )
    await expect(
      first.counterRepository.getCounter("https://mint.example", "keyset")
    ).resolves.toMatchObject({counter: 20})

    await Promise.all([
      first.counterRepository.advanceCounter("https://mint.example", "keyset", 1),
      second.counterRepository.reserveCounter("https://mint.example", "keyset", 1),
    ])
    await expect(
      first.counterRepository.getCounter("https://mint.example", "keyset")
    ).resolves.toMatchObject({counter: 21})
  })
})
