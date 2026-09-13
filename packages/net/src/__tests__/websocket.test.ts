import { Effect, Either } from "effect"
import { afterEach, describe, expect, it } from "vitest"
// @ts-expect-error -- plain .mjs with no type declarations
import { startRelay } from "../../../../apps/relay/lan-relay.mjs"
import { makeWebSocketTransport, refuseInsecure, relayUrl } from "../websocket"
import { MatchClient } from "@mutation/app-shell/store/match-client"
import { defaultConfig } from "@mutation/engine/types"
import type { Committed, ConnectionStatus, TransportService } from "../transport"

const servers: Array<{ wss: { close: (cb?: () => void) => void } }> = []
const transports: TransportService[] = []

afterEach(async () => {
  for (const t of transports.splice(0)) await Effect.runPromise(t.leave)
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.wss.close(() => r()))),
  )
})

let nextPort = 46_200
const relay = (opts: Record<string, unknown> = {}) => {
  const started = startRelay({ port: nextPort++, room: "TEST", ...opts })
  servers.push(started)
  return started as { port: number; sequencer: { lock: () => void } }
}

const joined = async (port: number, id: string) => {
  const transport = makeWebSocketTransport()
  transports.push(transport)
  const commits: Committed[] = []
  const statuses: ConnectionStatus[] = []
  transport.onCommit((c) => commits.push(c))
  transport.onStatus((s) => statuses.push(s))
  await Effect.runPromise(
    transport.join(`127.0.0.1:${port}`, { player_id: id, name: id }),
  )
  await until(() => statuses.some((s) => s.connected))
  return { transport, commits, statuses }
}

const until = async (predicate: () => boolean, ms = 4000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error("condition never became true")
}

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

  it("gives two independent clients the identical fold", async () => {
    const { port } = relay()
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
    const { port } = relay()
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

    const transport = makeWebSocketTransport()
    transports.push(transport)
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

    const late = makeWebSocketTransport()
    transports.push(late)
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
    const transport = makeWebSocketTransport()
    transports.push(transport)
    const result = await Effect.runPromise(
      Effect.either(transport.submit({ _tag: "Start" })),
    )
    expect(Either.isLeft(result)).toBe(true)
  })

  it("explains that a browser cannot host", async () => {
    const transport = makeWebSocketTransport()
    transports.push(transport)
    const result = await Effect.runPromise(
      Effect.either(transport.host({ seed: 1, name: "x", capacity: 6 })),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left.reason).toMatch(/cannot host/)
  })
})
