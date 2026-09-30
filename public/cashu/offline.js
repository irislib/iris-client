const root = new URL("./", import.meta.url)

// The parent view and standalone wallet use the same registration path. An
// existing worker can keep serving its own complete build while an update waits.
export async function updateLegacyWallet() {
  if (!("serviceWorker" in navigator)) return
  const response = await fetch(new URL("offline-manifest.json", root), {
    cache: "no-cache",
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error("Wallet manifest unavailable")
  const {worker} = await response.json()
  if (!/^service-worker\.[0-9a-f]{64}\.js$/.test(worker)) {
    throw new Error("Invalid wallet worker")
  }
  const registration = await navigator.serviceWorker.register(new URL(worker, root), {
    scope: root.href,
  })
  const installing = registration.installing
  if (installing) {
    await new Promise((resolve) => {
      let waiting
      const done = () => {
        clearTimeout(waiting)
        installing.removeEventListener("statechange", ready)
        resolve()
      }
      const ready = () => {
        if (["activated", "redundant"].includes(installing.state)) done()
        // An installed update may wait behind another open wallet. Only start
        // this fallback after all assets arrive, so a slow install can finish.
        else if (installing.state === "installed") waiting = setTimeout(done, 5000)
      }
      installing.addEventListener("statechange", ready)
      ready()
    })
  }
}

if (location.pathname.startsWith(root.pathname)) {
  // Normalize the legacy history router's direct entry before its module runs.
  if (location.pathname === new URL("index.html", root).pathname) {
    history.replaceState(
      history.state,
      "",
      root.pathname + location.search + location.hash
    )
  }
  const update = () => updateLegacyWallet().catch(() => {})
  window.addEventListener("online", update)
  update()
}
