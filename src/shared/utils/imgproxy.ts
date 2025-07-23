import * as utils from "@noble/curves/abstract/utils"
import {sha256} from "@noble/hashes/sha256"
import {hmac} from "@noble/hashes/hmac"
import {base64} from "@scure/base"

export const DefaultImgProxy = {
  url: "https://imgproxy.coracle.social",
  key: "a82fcf26aa0ccb55dfc6b4bd6a1c90744d3be0f38429f21a8828b43449ce7cebe6bdc2b09a827311bef37b18ce35cb1e6b1c60387a254541afa9e5b4264ae942",
  salt: "a897770d9abf163de055e9617891214e75a9016d748f8ef865e6ffbcb9ed932295659549773a22a019a5f06d0b440c320be411e3fddfe784e199e4f03d74bd9b",
}

function urlSafe(s: string) {
  return s.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function hmacSha256(key: Uint8Array, ...messages: Uint8Array[]) {
  return hmac(sha256, key, utils.concatBytes(...messages))
}

function signUrl(path: string, key: string, salt: string) {
  const te = new TextEncoder()
  const result = hmacSha256(
    utils.hexToBytes(key),
    utils.hexToBytes(salt),
    te.encode(path)
  )
  return urlSafe(base64.encode(result))
}

interface ImgProxyOptions {
  width?: number
  height?: number
  square?: boolean
}

interface ImgProxyConfig {
  url: string
  key: string
  salt: string
}

export function generateProxyUrl(
  originalSrc: string,
  options: ImgProxyOptions = {},
  config?: ImgProxyConfig
) {
  const proxyConfig = config || DefaultImgProxy
  const te = new TextEncoder()
  const encodedUrl = urlSafe(base64.encode(te.encode(originalSrc)))

  const opts = []
  if (options.width || options.height) {
    const resizeType = options.square ? "fill" : "fit"
    const w = options.width ? options.width : options.height!
    const h = options.height ? options.height : options.width!
    opts.push(`rs:${resizeType}:${w}:${h}`)
    opts.push("dpr:2")
  } else {
    opts.push("dpr:2")
  }

  const path = `/${opts.join("/")}/${encodedUrl}`
  const signature = signUrl(path, proxyConfig.key, proxyConfig.salt)

  return `${proxyConfig.url}/${signature}${path}`
}
