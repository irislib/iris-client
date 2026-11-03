import {expect, it, vi} from "vitest"
import {createPostScorer} from "./scorer"

it("reuses the loaded worker and ignores a previous query's late reply", async () => {
  vi.useFakeTimers()
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: {data: object}) => void) | null,
  }
  const Worker = vi.fn(function () {
    return worker
  })
  vi.stubGlobal("Worker", Worker)
  const first = new AbortController()
  const next = new AbortController()
  const scorer = (query: string, lifetime: AbortController) =>
    createPostScorer(
      {model: "minilm", ollamaModel: ""},
      query,
      lifetime.signal,
      vi.fn(),
      vi.fn()
    )
  const answer = (call: number, scores: number[]) =>
    worker.onmessage!({
      data: {request: worker.postMessage.mock.calls[call][0].request, scores},
    })
  try {
    const initial = scorer("bicycle", first)
    const ready = initial([])
    answer(0, [])
    await ready
    const oldBatch = expect(initial(["a bike"])).rejects.toThrow()
    first.abort()
    await oldBatch
    const newBatch = scorer("gardening", next)(["a seedling"])
    expect(Worker).toHaveBeenCalledTimes(1)
    expect(worker.terminate).not.toHaveBeenCalled()
    answer(1, [0.1])
    answer(2, [0.9])
    await expect(newBatch).resolves.toEqual([0.9])
  } finally {
    next.abort()
    first.abort()
    vi.runAllTimers()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})
