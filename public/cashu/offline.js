// The wallet has its own worker and update lifecycle. Never replace the root
// Client worker or force an update while another wallet is still open.
const root = new URL("./", document.currentScript.src)
// The legacy history router has a root route, but no /index.html route.
if (location.pathname === new URL("index.html", root).pathname) {
  history.replaceState(history.state, "", root.pathname + location.search + location.hash)
}
if ("serviceWorker" in navigator) {
  const update = () =>
    fetch(new URL("offline-manifest.json", root), {cache: "no-cache"})
      .then((response) => {
        if (!response.ok) throw new Error("Wallet manifest unavailable")
        return response.json()
      })
      .then(({worker}) => {
        if (!/^service-worker\.[0-9a-f]{64}\.js$/.test(worker)) {
          throw new Error("Invalid wallet worker")
        }
        return navigator.serviceWorker.register(new URL(worker, root), {scope: root.href})
      })
      .catch(() => {}) // The active wallet remains usable when offline.
  window.addEventListener("online", update)
  update()
}
