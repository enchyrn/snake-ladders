import { Effect, Either } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { makeWebSocketTransport, refuseInsecure, relayUrl } from "../websocket"
import type { Committed, ConnectionStatus } from "../transport"
import { makeRelayHarness } from "./harness"

const { relay, joined, until, track, teardown } = makeRelayHarness(46_200)

afterEach(teardown)

describe("relayUrl", () => {
  it("fills in the scheme and the default port", () => {
    expect(relayUrl("192.168.1.5")).toBe("ws://192.168.1.5:4455")
    expect(relayUrl("192.168.1.5:9000")).toBe("ws://192.168.1.5:9000")
    expect(relayUrl("  ws://10.0.0.2:4455 ")).toBe("ws://10.0.0.2:4455")
  })

  it("refuses an empty address", () => {
    expect(() => relayUrl("   ")).toThrow()
  })

  it("keeps an explicit wss, rather than downgrading it", () => {
    // A relay behind TLS is the only kind an https page can reach at all, so
    // rewriting the scheme the player pasted would break the one address
    // that could have worked.
    expect(relayUrl("wss://relay.example.com:443")).toBe("wss://relay.example.com:443")
    expect(relayUrl("wss://relay.example.com")).toBe("wss://relay.example.com:4455")
  })
})

describe("refuseInsecure", () => {
  const insecure = "ws://192.168.1.2:38355"

  it("explains the refusal an https page cannot avoid", () => {
    const message = refuseInsecure(insecure, "https:")
    expect(message).toContain("HTTPS")
    expect(message).toContain(insecure)
    // The failure the browser reports is indistinguishable from an
    // unreachable host, so the message has to rule that reading out: telling
    // a player to check the relay sends them after something that is fine.
    expect(message).toMatch(/will not help|makes no difference/i)
  })

  it("allows everything it has no reason to refuse", () => {
    expect(refuseInsecure(insecure, "http:")).toBeNull()
    expect(refuseInsecure(insecure, null)).toBeNull()
    expect(refuseInsecure("wss://relay.example.com:443", "https:")).toBeNull()
  })

  it("allows loopback, which counts as a trustworthy origin", () => {
    expect(refuseInsecure("ws://localhost:4455", "https:")).toBeNull()
    expect(refuseInsecure("ws://127.0.0.1:4455", "https:")).toBeNull()
  })
})

describe("WebSocket transport against a live relay", () => {
  it("reports connected and delivers commits in order", async () => {
    const { port } = relay()
    const a = await joined(port, "a")

    await Effect.runPromise(a.transport.submit({ _tag: "Join", playerId: "a", name: "A" }))
    await Effect.runPromise(a.transport.submit({ _tag: "Start" }))
    await until(() => a.commits.length === 2)

    expect(a.commits.map((c) => c.seq)).toEqual([0, 1])
  })

  it("hands a late joiner the history so it catches up", async () => {
    const { port } = relay()
    const a = await joined(port, "a")
    await Effect.runPromise(a.transport.submit({ _tag: "Join", playerId: "a", name: "A" }))
    await until(() => a.commits.length === 1)

    const b = await joined(port, "b")
    await until(() => b.commits.length === 1)
    expect(b.commits[0]!.seq).toBe(0)
  })

  it("does not resolve join before the late joiner history is delivered", async () => {
    const { port } = relay()
    const a = await joined(port, "a")
    await Effect.runPromise(a.transport.submit({ _tag: "Join", playerId: "a", name: "A" }))
    await until(() => a.commits.length === 1)

    const transport = track(makeWebSocketTransport())
    const commits: Committed[] = []
    transport.onCommit((commit) => commits.push(commit))

    await Effect.runPromise(
      transport.join(`127.0.0.1:${port}`, { player_id: "b", name: "B" }),
    )

    expect(commits).toEqual([{ seq: 0, action: { _tag: "Join", playerId: "a", name: "A" } }])
  })

  it("surfaces the relay's refusal rather than hanging", async () => {
    const { port, sequencer } = relay()
    const a = await joined(port, "a")
    expect(a.statuses.at(-1)!.connected).toBe(true)
    sequencer.lock()

    const late = track(makeWebSocketTransport())
    const statuses: ConnectionStatus[] = []
    late.onStatus((s) => statuses.push(s))
    const result = await Effect.runPromise(
      Effect.either(late.join(`127.0.0.1:${port}`, { player_id: "x", name: "X" })),
    )

    await until(() => statuses.some((s) => !s.connected && s.reason !== null))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left.reason).toBe("match already started")
    expect(statuses.at(-1)!.reason).toMatch(/already started/)
  })

  it("fails submit when nothing is connected", async () => {
    const transport = track(makeWebSocketTransport())
    const result = await Effect.runPromise(
      Effect.either(transport.submit({ _tag: "Start" })),
    )
    expect(Either.isLeft(result)).toBe(true)
  })

  it("explains that a browser cannot host", async () => {
    const transport = track(makeWebSocketTransport())
    const result = await Effect.runPromise(
      Effect.either(transport.host({ seed: 1, name: "x", capacity: 6 })),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left.reason).toMatch(/cannot host/)
  })
})
