function normalizeRoutePath(pathname: string): string {
  const trimmed = pathname.trim() || "/"
  if (trimmed === "/") {
    return "/"
  }

  const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return prefixed.replace(/\/+$/, "") || "/"
}

export function buildIrisUsernameRedirectPath(
  currentPathname: string,
  nip05: string | undefined
): string | null {
  if (!nip05?.endsWith("@iris.to") || nip05 === "_@iris.to") {
    return null
  }

  const normalizedCurrentPath = normalizeRoutePath(currentPathname)
  const currentSegments = normalizedCurrentPath.split("/").filter(Boolean)
  const username = nip05.replace("@iris.to", "")

  const nestedPath = currentSegments.slice(1).join("/")
  const targetPath = nestedPath ? `/${username}/${nestedPath}` : `/${username}`

  if (normalizedCurrentPath === targetPath) {
    return null
  }

  return targetPath
}
