const RECOVERY_ROOT = "/old"

export function getRecoveryMountRoot(
  pathname = typeof window === "undefined" ? "" : window.location.pathname
): string {
  return pathname === RECOVERY_ROOT || pathname.startsWith(`${RECOVERY_ROOT}/`)
    ? RECOVERY_ROOT
    : ""
}

export function stripRecoveryMount(pathname: string): string {
  return pathname.slice(getRecoveryMountRoot(pathname).length) || "/"
}

/** Prefix an app URL only when it is a root-relative path within the old app. */
export function withRecoveryMount(
  path: string,
  mountRoot = getRecoveryMountRoot()
): string {
  if (!mountRoot || !path.startsWith("/") || path.startsWith("//")) return path
  if (path === mountRoot || path.startsWith(`${mountRoot}/`)) return path
  return `${mountRoot}${path}`
}
