// (C) 2023 Doug Hoyte. MIT license
// Modified by hzrd149 to be TypeScript and work without the window.crypto.subtle API
// Further adapted for iris-client

import {sha256} from "@noble/hashes/sha2.js"

const PROTOCOL_VERSION = 0x61 // Version 1
const ID_SIZE = 32
const FINGERPRINT_SIZE = 16

type Item = {timestamp: number; id: Uint8Array}

const Mode = {
  Skip: 0,
  Fingerprint: 1,
  IdList: 2,
}

class WrappedBuffer {
  _raw: Uint8Array
  length: number

  constructor(buffer?: any) {
    this._raw = new Uint8Array(buffer || 512)
    this.length = buffer ? buffer.length : 0
  }

  unwrap() {
    return this._raw.subarray(0, this.length)
  }

  get capacity() {
    return this._raw.byteLength
  }

  extend(buf: WrappedBuffer | Uint8Array | number[]) {
    if (buf instanceof WrappedBuffer) buf = buf.unwrap()
    if (typeof buf.length !== "number") throw Error("bad length")
    const targetSize = buf.length + this.length
    if (this.capacity < targetSize) {
      const oldRaw = this._raw
      const newCapacity = Math.max(this.capacity * 2, targetSize)
      this._raw = new Uint8Array(newCapacity)
      this._raw.set(oldRaw)
    }

    this._raw.set(buf, this.length)
    this.length += buf.length
  }

  shift() {
    const first = this._raw[0]
    this._raw = this._raw.subarray(1)
    this.length--
    return first
  }

  shiftN(n = 1) {
    const firstSubarray = this._raw.subarray(0, n)
    this._raw = this._raw.subarray(n)
    this.length -= n
    return firstSubarray
  }
}

function decodeVarInt(buf: WrappedBuffer) {
  let res = 0

  while (1) {
    if (buf.length === 0) throw Error("parse ends prematurely")
    const byte = buf.shift()
    res = (res << 7) | (byte & 127)
    if ((byte & 128) === 0) break
  }

  return res
}

function encodeVarInt(n: number) {
  if (n === 0) return new WrappedBuffer([0])

  const o = []

  while (n !== 0) {
    o.push(n & 127)
    n >>>= 7
  }

  o.reverse()

  for (let i = 0; i < o.length - 1; i++) o[i] |= 128

  return new WrappedBuffer(o)
}

function getByte(buf: WrappedBuffer) {
  return getBytes(buf, 1)[0]
}

function getBytes(buf: WrappedBuffer, n: number) {
  if (buf.length < n) throw Error("parse ends prematurely")
  return buf.shiftN(n)
}

class Accumulator {
  buf: Uint8Array
  sha256: (slice: Uint8Array) => Uint8Array

  constructor() {
    this.buf = new Uint8Array(ID_SIZE)
    this.sha256 = (slice: Uint8Array) => sha256.create().update(slice).digest()
  }

  setToZero() {
    this.buf = new Uint8Array(ID_SIZE)
  }

  add(otherBuf: Uint8Array) {
    let currCarry = 0,
      nextCarry = 0
    const p = new DataView(this.buf.buffer)
    const po = new DataView(otherBuf.buffer)

    for (let i = 0; i < 8; i++) {
      const offset = i * 4
      const orig = p.getUint32(offset, true)
      const otherV = po.getUint32(offset, true)

      let next = orig

      next += currCarry
      next += otherV
      if (next > 0xffffffff) nextCarry = 1

      p.setUint32(offset, next & 0xffffffff, true)
      currCarry = nextCarry
      nextCarry = 0
    }
  }

  negate() {
    const p = new DataView(this.buf.buffer)

    for (let i = 0; i < 8; i++) {
      const offset = i * 4
      p.setUint32(offset, ~p.getUint32(offset, true))
    }

    const one = new Uint8Array(ID_SIZE)
    one[0] = 1
    this.add(one)
  }

  getFingerprint(n: number) {
    const input = new WrappedBuffer()
    input.extend(this.buf)
    input.extend(encodeVarInt(n))

    const hash = this.sha256(input.unwrap())

    return hash.subarray(0, FINGERPRINT_SIZE)
  }
}

class NegentropyStorageVector {
  items: Item[]
  sealed: boolean

  constructor() {
    this.items = []
    this.sealed = false
  }

  insert(timestamp: number, id: Uint8Array | string) {
    if (this.sealed) throw Error("already sealed")
    id = loadInputBuffer(id)
    if (id.byteLength !== ID_SIZE) throw Error("bad id size for added item")
    this.items.push({timestamp, id})
  }

  seal() {
    if (this.sealed) throw Error("already sealed")
    this.sealed = true

    this.items.sort(itemCompare)

    for (let i = 1; i < this.items.length; i++) {
      if (itemCompare(this.items[i - 1], this.items[i]) === 0)
        throw Error("duplicate item inserted")
    }
  }

  unseal() {
    this.sealed = false
  }

  size() {
    this._checkSealed()
    return this.items.length
  }

  getItem(i: number) {
    this._checkSealed()
    if (i >= this.items.length) throw Error("out of range")
    return this.items[i]
  }

  iterate(begin: number, end: number, cb: (item: Item, i: number) => boolean) {
    this._checkSealed()
    this._checkBounds(begin, end)

    for (let i = begin; i < end; ++i) {
      if (!cb(this.items[i], i)) break
    }
  }

  findLowerBound(begin: number, end: number, bound: Item) {
    this._checkSealed()
    this._checkBounds(begin, end)

    return this._binarySearch(this.items, begin, end, (a) => itemCompare(a, bound) < 0)
  }

  fingerprint(begin: number, end: number) {
    const out = new Accumulator()
    out.setToZero()

    this.iterate(begin, end, (item) => {
      out.add(item.id)
      return true
    })

    return out.getFingerprint(end - begin)
  }

  _checkSealed() {
    if (!this.sealed) throw Error("not sealed")
  }

  _checkBounds(begin: number, end: number) {
    if (begin > end || end > this.items.length) throw Error("bad range")
  }

  _binarySearch<T>(arr: T[], first: number, last: number, cmp: (a: T) => boolean) {
    let count = last - first

    while (count > 0) {
      let it = first
      const step = Math.floor(count / 2)
      it += step

      if (cmp(arr[it])) {
        first = ++it
        count -= step + 1
      } else {
        count = step
      }
    }

    return first
  }
}

class Negentropy {
  storage: NegentropyStorageVector
  frameSizeLimit: number
  lastTimestampIn: number
  lastTimestampOut: number
  isInitiator?: boolean
  wantUint8ArrayOutput?: boolean

  constructor(storage: NegentropyStorageVector, frameSizeLimit = 0) {
    if (frameSizeLimit !== 0 && frameSizeLimit < 4096) throw Error("frameSizeLimit too small")

    this.storage = storage
    this.frameSizeLimit = frameSizeLimit

    this.lastTimestampIn = 0
    this.lastTimestampOut = 0
  }

  _bound(timestamp: number, id?: Uint8Array) {
    return {timestamp, id: id ? id : new Uint8Array(0)}
  }

  initiate<T extends Uint8Array | string>() {
    if (this.isInitiator) throw Error("already initiated")
    this.isInitiator = true

    const output = new WrappedBuffer()
    output.extend([PROTOCOL_VERSION])

    this.splitRange(0, this.storage.size(), this._bound(Number.MAX_VALUE), output)

    return this._renderOutput<T>(output)
  }

  setInitiator() {
    this.isInitiator = true
  }

  reconcile<T extends Uint8Array | string>(
    input: Uint8Array | string
  ): [T | null, T[], T[]] {
    const haveIds: T[] = []
    const needIds: T[] = []
    const query = new WrappedBuffer(loadInputBuffer(input))

    this.lastTimestampIn = this.lastTimestampOut = 0 // reset for each message

    const fullOutput = new WrappedBuffer()
    fullOutput.extend([PROTOCOL_VERSION])

    const protocolVersion = getByte(query)
    if (protocolVersion < 0x60 || protocolVersion > 0x6f)
      throw Error("invalid negentropy protocol version byte")
    if (protocolVersion !== PROTOCOL_VERSION) {
      if (this.isInitiator)
        throw Error("unsupported negentropy protocol version requested: " + (protocolVersion - 0x60))
      else return [this._renderOutput<T>(fullOutput), haveIds, needIds]
    }

    const storageSize = this.storage.size()
    let prevBound = this._bound(0)
    let prevIndex = 0
    let skip = false

    while (query.length !== 0) {
      let o = new WrappedBuffer()

      const doSkip = () => {
        if (skip) {
          skip = false
          o.extend(this.encodeBound(prevBound))
          o.extend(encodeVarInt(Mode.Skip))
        }
      }

      const currBound = this.decodeBound(query)
      const mode = decodeVarInt(query)

      const lower = prevIndex
      let upper = this.storage.findLowerBound(prevIndex, storageSize, currBound)

      if (mode === Mode.Skip) {
        skip = true
      } else if (mode === Mode.Fingerprint) {
        const theirFingerprint = getBytes(query, FINGERPRINT_SIZE)
        const ourFingerprint = this.storage.fingerprint(lower, upper)

        if (compareUint8Array(theirFingerprint, ourFingerprint) !== 0) {
          doSkip()
          this.splitRange(lower, upper, currBound, o)
        } else {
          skip = true
        }
      } else if (mode === Mode.IdList) {
        const numIds = decodeVarInt(query)

        const theirElems: Record<string, Uint8Array> = {} // stringified Uint8Array -> original Uint8Array
        for (let i = 0; i < numIds; i++) {
          const e = getBytes(query, ID_SIZE)
          theirElems[uint8ArrayToHex(e)] = e
        }

        if (this.isInitiator) {
          skip = true

          this.storage.iterate(lower, upper, (item) => {
            const k = uint8ArrayToHex(item.id)

            if (!theirElems[k]) {
              // ID exists on our side, but not their side
              haveIds.push((this.wantUint8ArrayOutput ? item.id : k) as T)
            } else {
              // ID exists on both sides
              delete theirElems[k]
            }

            return true
          })

          for (const [_k, v] of Object.entries(theirElems)) {
            // ID exists on their side, but not our side
            needIds.push((this.wantUint8ArrayOutput ? v : uint8ArrayToHex(v)) as T)
          }
        } else {
          doSkip()

          const responseIds = new WrappedBuffer()
          let numResponseIds = 0
          let endBound = currBound

          this.storage.iterate(lower, upper, (item, index) => {
            if (this.exceededFrameSizeLimit(fullOutput.length + responseIds.length)) {
              endBound = item
              upper = index // shrink upper so that remaining range gets correct fingerprint
              return false
            }

            responseIds.extend(item.id)
            numResponseIds++
            return true
          })

          o.extend(this.encodeBound(endBound))
          o.extend(encodeVarInt(Mode.IdList))
          o.extend(encodeVarInt(numResponseIds))
          o.extend(responseIds)

          fullOutput.extend(o)
          o = new WrappedBuffer()
        }
      } else {
        throw Error("unexpected mode")
      }

      if (this.exceededFrameSizeLimit(fullOutput.length + o.length)) {
        // frameSizeLimit exceeded: Stop range processing and return a fingerprint for the remaining range
        const remainingFingerprint = this.storage.fingerprint(upper, storageSize)

        fullOutput.extend(this.encodeBound(this._bound(Number.MAX_VALUE)))
        fullOutput.extend(encodeVarInt(Mode.Fingerprint))
        fullOutput.extend(remainingFingerprint)
        break
      } else {
        fullOutput.extend(o)
      }

      prevIndex = upper
      prevBound = currBound
    }

    return [
      fullOutput.length === 1 && this.isInitiator ? null : this._renderOutput<T>(fullOutput),
      haveIds,
      needIds,
    ]
  }

  splitRange(lower: number, upper: number, upperBound: Item, o: WrappedBuffer) {
    const numElems = upper - lower
    const buckets = 16

    if (numElems < buckets * 2) {
      o.extend(this.encodeBound(upperBound))
      o.extend(encodeVarInt(Mode.IdList))

      o.extend(encodeVarInt(numElems))
      this.storage.iterate(lower, upper, (item) => {
        o.extend(item.id)
        return true
      })
    } else {
      const itemsPerBucket = Math.floor(numElems / buckets)
      const bucketsWithExtra = numElems % buckets
      let curr = lower

      for (let i = 0; i < buckets; i++) {
        const bucketSize = itemsPerBucket + (i < bucketsWithExtra ? 1 : 0)
        const ourFingerprint = this.storage.fingerprint(curr, curr + bucketSize)
        curr += bucketSize

        let nextBound

        if (curr === upper) {
          nextBound = upperBound
        } else {
          let prevItem: Item, currItem: Item

          this.storage.iterate(curr - 1, curr + 1, (item, index) => {
            if (index === curr - 1) prevItem = item
            else currItem = item
            return true
          })

          nextBound = this.getMinimalBound(prevItem!, currItem!)
        }

        o.extend(this.encodeBound(nextBound))
        o.extend(encodeVarInt(Mode.Fingerprint))
        o.extend(ourFingerprint)
      }
    }
  }

  _renderOutput<T extends Uint8Array | string>(o: WrappedBuffer): T {
    const buf = o.unwrap()
    if (!this.wantUint8ArrayOutput) return uint8ArrayToHex(buf) as T
    return buf as T
  }

  exceededFrameSizeLimit(n: number) {
    return this.frameSizeLimit && n > this.frameSizeLimit - 200
  }

  // Decoding

  decodeTimestampIn(encoded: WrappedBuffer) {
    let timestamp = decodeVarInt(encoded)
    timestamp = timestamp === 0 ? Number.MAX_VALUE : timestamp - 1
    if (this.lastTimestampIn === Number.MAX_VALUE || timestamp === Number.MAX_VALUE) {
      this.lastTimestampIn = Number.MAX_VALUE
      return Number.MAX_VALUE
    }
    timestamp += this.lastTimestampIn
    this.lastTimestampIn = timestamp
    return timestamp
  }

  decodeBound(encoded: WrappedBuffer) {
    const timestamp = this.decodeTimestampIn(encoded)
    const len = decodeVarInt(encoded)
    if (len > ID_SIZE) throw Error("bound key too long")
    const id = getBytes(encoded, len)
    return {timestamp, id}
  }

  // Encoding

  encodeTimestampOut(timestamp: number) {
    if (timestamp === Number.MAX_VALUE) {
      this.lastTimestampOut = Number.MAX_VALUE
      return encodeVarInt(0)
    }

    const temp = timestamp
    timestamp -= this.lastTimestampOut
    this.lastTimestampOut = temp
    return encodeVarInt(timestamp + 1)
  }

  encodeBound(key: Item) {
    const output = new WrappedBuffer()

    output.extend(this.encodeTimestampOut(key.timestamp))
    output.extend(encodeVarInt(key.id.length))
    output.extend(key.id)

    return output
  }

  getMinimalBound(prev: Item, curr: Item) {
    if (curr.timestamp !== prev.timestamp) {
      return this._bound(curr.timestamp)
    } else {
      let sharedPrefixBytes = 0
      const currKey = curr.id
      const prevKey = prev.id

      for (let i = 0; i < ID_SIZE; i++) {
        if (currKey[i] !== prevKey[i]) break
        sharedPrefixBytes++
      }

      return this._bound(curr.timestamp, curr.id.subarray(0, sharedPrefixBytes + 1))
    }
  }
}

function loadInputBuffer(inp: Uint8Array | string) {
  if (typeof inp === "string") inp = hexToUint8Array(inp)
  return inp
}

function hexToUint8Array(h: string) {
  if (h.startsWith("0x")) h = h.substr(2)
  if (h.length % 2 === 1) throw Error("odd length of hex string")
  const arr = new Uint8Array(h.length / 2)
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(h.substr(i * 2, 2), 16)
  return arr
}

const uint8ArrayToHexLookupTable = new Array(256)
{
  const hexAlphabet = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"]
  for (let i = 0; i < 256; i++) {
    uint8ArrayToHexLookupTable[i] = hexAlphabet[(i >>> 4) & 0xf] + hexAlphabet[i & 0xf]
  }
}

function uint8ArrayToHex(arr: Uint8Array) {
  let out = ""
  for (let i = 0, edx = arr.length; i < edx; i++) {
    out += uint8ArrayToHexLookupTable[arr[i]]
  }
  return out
}

function compareUint8Array(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }

  if (a.byteLength > b.byteLength) return 1
  if (a.byteLength < b.byteLength) return -1

  return 0
}

function itemCompare(a: Item, b: Item) {
  if (a.timestamp === b.timestamp) {
    return compareUint8Array(a.id, b.id)
  }

  return a.timestamp - b.timestamp
}

export {Negentropy, NegentropyStorageVector}
