type IntersectionCallback = (entry: IntersectionObserverEntry) => void

class SharedIntersectionObserver {
  private observer: IntersectionObserver
  private callbacks = new Map<Element, IntersectionCallback>()

  constructor(options: object = {}) {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const callback = this.callbacks.get(entry.target)
          if (callback) {
            callback(entry)
          }
        })
      },
      {
        rootMargin: "-200px 0px 0px 0px",
        ...options,
      }
    )
  }

  observe(element: Element, callback: IntersectionCallback): () => void {
    this.callbacks.set(element, callback)
    this.observer.observe(element)

    return () => {
      this.callbacks.delete(element)
      this.observer.unobserve(element)
    }
  }

  disconnect() {
    this.observer.disconnect()
    this.callbacks.clear()
  }
}

export const feedItemVisibilityObserver = new SharedIntersectionObserver({
  rootMargin: "-200px 0px 0px 0px",
})

export const infiniteScrollObserver = new SharedIntersectionObserver({
  rootMargin: "1000px",
  threshold: 1.0,
})
