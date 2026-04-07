import {RouteMatchCallbackOptions} from "workbox-core"

const HASHTREE_BLOB_ORIGINS = new Set(["https://cdn.iris.to", "https://hashtree.iris.to"])

const HASHTREE_BLOB_PATH_RE = /^\/[0-9a-f]{64}\.bin$/i

export function isHashtreeBlobRequest({
  request,
  url,
}: Pick<RouteMatchCallbackOptions, "request" | "url">): boolean {
  if (request.method !== "GET") {
    return false
  }

  if (!HASHTREE_BLOB_ORIGINS.has(url.origin)) {
    return false
  }

  return HASHTREE_BLOB_PATH_RE.test(url.pathname)
}
