import * as utils from "@noble/curves/abstract/utils"
import {sha256} from "@noble/hashes/sha256"
import {hmac} from "@noble/hashes/hmac"
import {base64} from "@scure/base"

export const DefaultImgProxy = {
  url: "https://imgproxy.iris.to",
  key: "f66233cb160ea07078ff28099bfa3e3e654bc10aa4a745e12176c433d79b8996",
  salt: "5e608e60945dcd2a787e8465d76ba34149894765061d39287609fb9d776caa0c",
}

export const DefaultVidProxy = {
  url: "https://vidproxy.iris.to",
  key: "f66233cb160ea07078ff28099bfa3e3e654bc10aa4a745e12176c433d79b8996",
  salt: "5e608e60945dcd2a787e8465d76ba34149894765061d39287609fb9d776caa0c",
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
  config?: Partial<ImgProxyConfig>
) {
  const proxyConfig = {
    url: config?.url || DefaultImgProxy.url,
    key: config?.key || DefaultImgProxy.key,
    salt: config?.salt || DefaultImgProxy.salt,
  }
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

export function generateVideoProxyUrl(
  originalSrc: string,
  config?: Partial<ImgProxyConfig>
) {
  const proxyConfig = {
    url: config?.url || DefaultVidProxy.url,
    key: config?.key || DefaultVidProxy.key,
    salt: config?.salt || DefaultVidProxy.salt,
  }
  const te = new TextEncoder()
  const encodedUrl = urlSafe(base64.encode(te.encode(originalSrc)))

  const path = `/thumb/${encodedUrl}`
  const signature = signUrl(path, proxyConfig.key, proxyConfig.salt)

  return `${proxyConfig.url}/${signature}${path}`
}
