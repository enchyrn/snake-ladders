import { describe, expect, it } from "vitest"
import { makeClientSlot } from "../client-slot"

const spy = (id: string, log: string[]) => ({ id, dispose: () => log.push(id) })

describe("makeClientSlot", () => {
  it("disposes what it replaces", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    slot.put(spy("first", log))
    slot.put(spy("second", log))
    expect(log).toEqual(["first"])
  })

  // The defect this exists for: JoinScreen opens a session and, on a failed
  // join, closes it — both inside one render. A handler closed over the
  // render's state value disposes the client from *before* the open, leaving
  // the one just created alive and still writing into the shared atom.
  it("clears the client put since the handler was built", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    slot.put(spy("before", log))
    log.length = 0

    const close = () => slot.clear() // captured now, called after the next put
    slot.put(spy("after", log))
    close()

    // "before" is disposed here too — put() replacing it triggers that, same
    // as the first test. What this test actually guards is that close()
    // reaches "after": a stale closure over the pre-open client would dispose
    // "before" a second time and leave "after" untouched.
    expect(log).toEqual(["before", "after"])
    expect(slot.current).toBeNull()
  })

  it("is safe to clear twice", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    slot.put(spy("only", log))
    slot.clear()
    slot.clear()
    expect(log).toEqual(["only"])
  })

  // Two joins overlap: the first stalls behind a handshake timer, the player
  // taps a second room, and the first's continuation finally runs and tries to
  // tear its session down. It no longer owns the slot, so tearing down would
  // kill the match the player is actually in.
  it("ignores a clear from a caller that no longer holds the slot", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    const first = slot.put(spy("first", log))
    const second = slot.put(spy("second", log))
    log.length = 0

    expect(slot.clearIf(first)).toBe(false)

    expect(log).toEqual([])
    expect(slot.current).toBe(second)
  })

  it("clears when the caller still holds the slot", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    const only = slot.put(spy("only", log))

    expect(slot.clearIf(only)).toBe(true)

    expect(log).toEqual(["only"])
    expect(slot.current).toBeNull()
  })
})
