export function matchPath(
  pathname: string,
  pattern: string
): {params: Record<string, string>} | null {
  // Strip query params for matching
  const pathOnly = pathname.split("?")[0]

  // Special handling for /* patterns - should match both /path and /path/...
  if (pattern.endsWith("/*")) {
    const basePath = pattern.slice(0, -2)
    if (pathOnly === basePath || pathOnly.startsWith(basePath + "/")) {
      const wildcardPart =
        pathOnly === basePath ? "" : pathOnly.slice(basePath.length + 1)
      return {params: {"*": wildcardPart}}
    }
    return null
  }

  // Convert route pattern to regex
  const paramNames: string[] = []
  const segments = pattern.split("/")

  const regexPattern = segments
    .map((segment) => {
      if (segment.startsWith(":")) {
        const paramName = segment.slice(1).replace("?", "")
        const isOptional = segment.endsWith("?")
        paramNames.push(paramName)
        return isOptional ? "([^/]*)" : "([^/]+)"
      }
      if (segment === "*") {
        paramNames.push("*")
        // For wildcard at the end, match everything including nothing
        return "(.*)"
      }
      return segment
    })
    .join("/")

  const regex = new RegExp(`^${regexPattern}$`)
  const match = pathOnly.match(regex)

  if (!match) return null

  const params: Record<string, string> = {}
  paramNames.forEach((name, index) => {
    params[name] = match[index + 1] || ""
  })

  return {params}
}
