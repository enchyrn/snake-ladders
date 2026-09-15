import { describe, expect, it } from "vitest"
import { closeIfOwned, makeClientSlot } from "../client-slot"

const spy = (id: string, log: string[]) => ({ id, dispose: () => log.push(id) })

// Exercises exactly what `SessionProvider.closeIf` wires together —
// `closeIfOwned` is the same function it calls, not a re-implementation —
// because rendering `SessionProvider` itself needs a React renderer this repo
// doesn't have (see CLAUDE.md).
describe("closeIfOwned", () => {
  // The bug this guards: a stale join continuation that settles after the
  // player has already joined elsewhere must not tear the live session down.
  // A `closeIf` written as `clearIf(owned); teardown()` — ignoring the
  // boolean — passes every `ClientSlot` test (it never touches `held`) while
  // still running `teardown`, which calls `leave` on every shared transport
  // and would close the *live* session's socket.
  it("runs neither dispose nor teardown for a client that no longer owns the slot", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    const first = slot.put(spy("first", log))
    const second = slot.put(spy("second", log))
    log.length = 0
    let teardownRuns = 0

    const owned = closeIfOwned(slot, first, () => {
      teardownRuns++
    })

    expect(owned).toBe(false)
    expect(log).toEqual([])
    expect(teardownRuns).toBe(0)
    expect(slot.current).toBe(second)
  })

  it("disposes and tears down for the client that still owns the slot", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    const only = slot.put(spy("only", log))
    let teardownRuns = 0

    const owned = closeIfOwned(slot, only, () => {
      teardownRuns++
    })

    expect(owned).toBe(true)
    expect(log).toEqual(["only"])
    expect(teardownRuns).toBe(1)
    expect(slot.current).toBeNull()
  })
})
