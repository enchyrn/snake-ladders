import { describe, expect, it } from "vitest"
import { at, run, scenario, succeeds } from "./helpers"

/**
 * `Leave` sets `connected: false`; it must not be a one-way door. Both LAN
 * sequencers (`lan-sync`, `lan-relay.mjs`) already readmit a returning client
 * mid-match on the assumption that a re-`Join` restores them — the reducer
 * has to honour that assumption or the transport and the engine disagree.
 */
describe("reconnecting mid-match", () => {
  it("lets a player who left rejoin and marks them connected again", () => {
    const start = scenario({ players: [{ id: "p1" }, { id: "p2" }], dice: [3, 4] })
    const left = run(start, { _tag: "Leave", playerId: "p2" })
    expect(at(left, "p2").connected).toBe(false)

    const rejoined = run(left, { _tag: "Join", playerId: "p2", name: "p2" })
    expect(at(rejoined, "p2").connected).toBe(true)
  })

  it("makes the returning player a full participant, not a spectator", () => {
    const start = scenario({ players: [{ id: "p1" }, { id: "p2" }], dice: [3, 4] })
    const left = run(start, { _tag: "Leave", playerId: "p2" })
    const rejoined = run(left, { _tag: "Join", playerId: "p2", name: "p2" })

    // p1 has not committed either, so this Commit cannot trigger round
    // resolution and erase the evidence: if p2 is still being treated as
    // disconnected, canCommit/pendingCommitters excludes them and this fails
    // with "not your roll".
    expect(succeeds(rejoined, { _tag: "Commit", playerId: "p2" })).toBe(true)
  })

  it("still refuses a Join from a player the match never seated once play has started", () => {
    const start = scenario({ players: [{ id: "p1" }, { id: "p2" }], dice: [3, 4] })
    expect(succeeds(start, { _tag: "Join", playerId: "stranger", name: "new" })).toBe(false)
  })
})
