/* eslint-disable @typescript-eslint/no-explicit-any */

type Comparator<K, V> = (a: [K, V], b: [K, V]) => number

export class SortedMap<K, V extends Record<string, any>> {
  private map: Map<K, V>
  private sortedKeys: K[]
  private compare: Comparator<K, V>

  constructor(
    initialEntries?: Iterable<readonly [K, V]>,
    compare?: string | Comparator<K, V>
  ) {
    this.map = new Map(initialEntries || [])

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

  set(key: K, value: V) {
    if (this.map.has(key)) {
      const existingIndex = this.sortedKeys.indexOf(key)
      this.sortedKeys.splice(existingIndex, 1)
    }

    this.map.set(key, value)
    const insertAt = this.binarySearch(key, value)
    this.sortedKeys.splice(insertAt, 0, key)
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

  has(key: K): boolean {
    return this.map.has(key)
  }

  delete(key: K): boolean {
    if (this.map.delete(key)) {
      const index = this.sortedKeys.indexOf(key)
      if (index >= 0) {
        this.sortedKeys.splice(index, 1)
      }
      return true
    }
    return false
  }

  clear(): void {
    this.map.clear()
    this.sortedKeys = []
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
