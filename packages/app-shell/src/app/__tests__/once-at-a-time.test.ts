import { describe, expect, it } from "vitest"
import { onceAtATime } from "../once-at-a-time"

/** A promise plus the handles to settle it, so a test controls the timing. */
const deferred = () => {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("onceAtATime", () => {
  it("drops a call made while the first is still in flight", async () => {
    const gate = deferred()
    let calls = 0
    const guarded = onceAtATime(async () => {
      calls += 1
      await gate.promise
    }, () => {})

    const first = guarded()
    await guarded()
    expect(calls).toBe(1)

    gate.resolve()
    await first
    expect(calls).toBe(1)
  })

  it("runs again once the first has settled", async () => {
    let calls = 0
    const guarded = onceAtATime(async () => {
      calls += 1
    }, () => {})

    await guarded()
    await guarded()
    expect(calls).toBe(2)
  })

  it("reports busy around the call, in order", async () => {
    const gate = deferred()
    const reported: boolean[] = []
    const guarded = onceAtATime(async () => {
      await gate.promise
    }, (busy) => reported.push(busy))

    const running = guarded()
    expect(reported).toEqual([true])
    gate.resolve()
    await running
    expect(reported).toEqual([true, false])
  })

  // The screen would otherwise be wedged by the one outcome that most needs a
  // retry: a join that threw rather than returning a reason.
  it("clears after a rejection, and lets the caller see it", async () => {
    const reported: boolean[] = []
    let calls = 0
    const guarded = onceAtATime(async () => {
      calls += 1
      throw new Error("no")
    }, (busy) => reported.push(busy))

    await expect(guarded()).rejects.toThrow("no")
    expect(reported).toEqual([true, false])

    await expect(guarded()).rejects.toThrow("no")
    expect(calls).toBe(2)
  })

  it("passes its arguments through", async () => {
    const seen: Array<[string, number]> = []
    const guarded = onceAtATime(async (addr: string, seed: number) => {
      seen.push([addr, seed])
    }, () => {})

    await guarded("192.168.1.24:5000", 7)
    expect(seen).toEqual([["192.168.1.24:5000", 7]])
  })
})
