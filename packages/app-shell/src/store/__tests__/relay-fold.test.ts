import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { makeRelayHarness } from "@mutation/net/__tests__/harness"
import { defaultConfig } from "@mutation/engine/types"
import { MatchClient } from "../match-client"

/**
 * Two `MatchClient`s folding one relay's log.
 *
 * These live here rather than beside the websocket tests because the fold is
 * `app-shell`'s, not the transport's: `net` may not import `app-shell`, so a
 * test that needs both belongs on the side that is allowed to depend on the
 * other. The harness comes from `net`, which that direction permits.
 *
 */
const { relay, joined, until, teardown } = makeRelayHarness()

afterEach(teardown)

describe("two devices folding one relay log", () => {
  it("gives two independent clients the identical fold", async () => {
    const { port } = await relay()
    const a = await joined(port, "a")
    const b = await joined(port, "b")

    const clientA = new MatchClient(a.transport, defaultConfig(2024), "peer", "a")
    const clientB = new MatchClient(b.transport, defaultConfig(2024), "peer", "b")

    // Two sockets race: awaiting a submit only confirms the local send, not
    // that the relay sequenced it. Wait for each commit before sending the
    // next so this test exercises the fold rather than the race — the race
    // itself is covered separately below.
    const settled = (n: number) =>
      until(() => a.commits.length === n && b.commits.length === n)

    await Effect.runPromise(a.transport.submit({ _tag: "Join", playerId: "a", name: "A" }))
    await settled(1)
    await Effect.runPromise(b.transport.submit({ _tag: "Join", playerId: "b", name: "B" }))
    await settled(2)
    await Effect.runPromise(a.transport.submit({ _tag: "Start" }))
    await settled(3)
    await until(() => clientA.state.applied === 3 && clientB.state.applied === 3)

    // The whole point: two devices, one relay, byte-identical match state.
    expect(JSON.stringify(clientA.state.match)).toBe(JSON.stringify(clientB.state.match))
    expect(clientA.state.match.players.map((p) => p.id)).toEqual(["a", "b"])
    expect(clientA.state.desync).toBeNull()

    clientA.dispose()
    clientB.dispose()
  })

  it("leaves both devices agreeing even when two sockets race", async () => {
    const { port } = await relay()
    const a = await joined(port, "a")
    const b = await joined(port, "b")
    const clientA = new MatchClient(a.transport, defaultConfig(7), "peer", "a")
    const clientB = new MatchClient(b.transport, defaultConfig(7), "peer", "b")

    // Fired without waiting, on two different sockets: the relay orders them
    // by arrival, so `Start` may land before `b`'s join and that join is then
    // legitimately refused. Whatever order wins, both devices must fold to
    // the same state — that is the invariant the whole design rests on.
    await Promise.all([
      Effect.runPromise(a.transport.submit({ _tag: "Join", playerId: "a", name: "A" })),
      Effect.runPromise(b.transport.submit({ _tag: "Join", playerId: "b", name: "B" })),
      Effect.runPromise(a.transport.submit({ _tag: "Start" })),
    ])
    await until(() => a.commits.length === 3 && b.commits.length === 3)
    await until(() => clientA.state.applied + clientB.state.applied >= 4)

    expect(JSON.stringify(clientA.state.match)).toBe(JSON.stringify(clientB.state.match))
    // Rejecting an action both devices reject is not a divergence.
    expect(clientA.state.desync).toBeNull()
    expect(clientB.state.desync).toBeNull()

    clientA.dispose()
    clientB.dispose()
  })

})
