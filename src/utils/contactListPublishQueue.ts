const queues = new Map<string, Promise<void>>()

export function enqueueContactListPublish(
  account: string,
  publish: () => Promise<void>
): Promise<void> {
  const previous = queues.get(account)
  const queued = previous ? previous.catch(() => undefined).then(publish) : publish()
  queues.set(account, queued)

  const clear = () => {
    if (queues.get(account) === queued) queues.delete(account)
  }
  void queued.then(clear, clear)
  return queued
}
