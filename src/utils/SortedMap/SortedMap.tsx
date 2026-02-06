/* eslint-disable @typescript-eslint/no-explicit-any */

type Comparator<K, V> = (a: [K, V], b: [K, V]) => number

export class SortedMap<K, V extends Record<string, any>> {
  private map: Map<K, V>
  private sortedKeys: K[]
  private keyToIndex: Map<K, number> // O(1) index lookup
  private compare: Comparator<K, V>

  constructor(
    initialEntries?: Iterable<readonly [K, V]>,
    compare?: string | Comparator<K, V>
  ) {
    this.map = new Map(initialEntries || [])
    this.keyToIndex = new Map()

    /* eslint-disable no-nested-ternary */
    if (compare) {
      if (typeof compare === "string") {
        this.compare = (a, b) =>
          (a[1] as any)[compare] > (b[1] as any)[compare]
            ? 1
            : (a[1] as any)[compare] < (b[1] as any)[compare]
              ? -1
              : 0
      } else {
        this.compare = compare
      }
    } else {
      this.compare = (a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0)
    }
    /* eslint-enable no-nested-ternary */

    this.sortedKeys = initialEntries
      ? [...this.map.entries()].sort(this.compare).map(([key]) => key)
      : []

    // Build initial index map
    this.sortedKeys.forEach((key, idx) => this.keyToIndex.set(key, idx))
  }

  private binarySearch(key: K, value: V): number {
    let left = 0
    let right = this.sortedKeys.length
    while (left < right) {
      const mid = (left + right) >> 1
      const midKey = this.sortedKeys[mid]
      const midValue = this.map.get(midKey) as V

      if (this.compare([key, value], [midKey, midValue]) < 0) {
        right = mid
      } else {
        left = mid + 1
      }
    }
    return left
  }

  // Update keyToIndex for a range of sortedKeys
  private updateIndexRange(start: number, end: number) {
    for (let i = start; i < end; i++) {
      this.keyToIndex.set(this.sortedKeys[i], i)
    }
  }

  set(key: K, value: V) {
    const existingIndex = this.keyToIndex.get(key)
    this.map.set(key, value)

    if (existingIndex !== undefined) {
      // Remove from old position - O(n) splice but O(1) lookup
      this.sortedKeys.splice(existingIndex, 1)
      // Update indices for shifted elements
      this.updateIndexRange(existingIndex, this.sortedKeys.length)
    }

    const insertAt = this.binarySearch(key, value)
    this.sortedKeys.splice(insertAt, 0, key)
    // Update indices for shifted elements (including new one)
    this.updateIndexRange(insertAt, this.sortedKeys.length)
  }

  get(key: K): V | undefined {
    return this.map.get(key)
  }

  last(): [K, V] | undefined {
    if (this.sortedKeys.length === 0) {
      return undefined
    }
    const key = this.sortedKeys[this.sortedKeys.length - 1]
    return [key, this.map.get(key) as V]
  }

  first(): [K, V] | undefined {
    if (this.sortedKeys.length === 0) {
      return undefined
    }
    const key = this.sortedKeys[0]
    return [key, this.map.get(key) as V]
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    for (const key of this.sortedKeys) {
      yield [key, this.map.get(key) as V]
    }
  }

  *reverse(): IterableIterator<[K, V]> {
    for (let i = this.sortedKeys.length - 1; i >= 0; i--) {
      const key = this.sortedKeys[i]
      yield [key, this.map.get(key) as V]
    }
  }

  *keys(): IterableIterator<K> {
    for (const key of this.sortedKeys) {
      yield key
    }
  }

  *values(): IterableIterator<V> {
    for (const key of this.sortedKeys) {
      yield this.map.get(key) as V
    }
  }

  *entries(): IterableIterator<[K, V]> {
    for (const key of this.sortedKeys) {
      yield [key, this.map.get(key) as V]
    }
  }

  *range(
    options: {
      gte?: K
      lte?: K
      direction?: "asc" | "desc"
    } = {}
  ): IterableIterator<[K, V]> {
    const {gte, lte, direction = "asc"} = options

    const startIndex = gte ? this.binarySearch(gte, this.map.get(gte) as V) : 0
    const endIndex = lte
      ? this.binarySearch(lte, this.map.get(lte) as V)
      : this.sortedKeys.length

    if (direction === "asc") {
      for (let i = startIndex; i < endIndex; i++) {
        const key = this.sortedKeys[i]
        yield [key, this.map.get(key) as V]
      }
    } else {
      for (let i = endIndex - 1; i >= startIndex; i--) {
        const key = this.sortedKeys[i]
        yield [key, this.map.get(key) as V]
      }
    }
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  delete(key: K): boolean {
    if (this.map.delete(key)) {
      const index = this.keyToIndex.get(key)
      if (index !== undefined) {
        this.sortedKeys.splice(index, 1)
        this.keyToIndex.delete(key)
        // Update indices for shifted elements
        this.updateIndexRange(index, this.sortedKeys.length)
      }
      return true
    }
    return false
  }

  clear(): void {
    this.map.clear()
    this.sortedKeys = []
    this.keyToIndex.clear()
  }

  get size(): number {
    return this.map.size
  }

  nth(n: number): [K, V] | undefined {
    return this.sortedKeys[n]
      ? [this.sortedKeys[n], this.map.get(this.sortedKeys[n]) as V]
      : undefined
  }
}
