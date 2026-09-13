import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { MatchClient } from "../match-client"
import { makeLocalTransport } from "@/net/local"
import { emitter, type Committed, type TransportService } from "@/net/transport"
import { defaultConfig } from "@/engine/types"

/** A transport whose commit stream the test drives by hand. */
const controllable = () => {
  const commits = emitter<Committed>()
  const sent: unknown[] = []
  const service: TransportService = {
    ...makeLocalTransport(),
    submit: (action) => Effect.sync(() => {
      sent.push(action)
    }),
    onCommit: commits.subscribe,
  }
  return { service, commits, sent }
}

const config = defaultConfig(2024)

const client = (service: TransportService) => new MatchClient(service, config, "peer", "a")

const join = (id: string) => ({ _tag: "Join" as const, playerId: id, name: id })

describe("MatchClient", () => {
  it("folds commits in sequence order", () => {
    const { service, commits } = controllable()
    const c = client(service)

    commits.emit({ seq: 0, action: join("a") })
    commits.emit({ seq: 1, action: join("b") })

    expect(c.store.state.match.players.map((p) => p.id)).toEqual(["a", "b"])
    expect(c.store.state.applied).toBe(2)
    c.dispose()
  })

  it("holds an out-of-order commit until the gap is filled", () => {
    const { service, commits } = controllable()
    const c = client(service)

    // #1 arrives before #0 — nothing may be applied yet.
    commits.emit({ seq: 1, action: join("b") })
    expect(c.store.state.applied).toBe(0)

    commits.emit({ seq: 0, action: join("a") })
    // Both land, and in the order the host chose, not the order they arrived.
    expect(c.store.state.match.players.map((p) => p.id)).toEqual(["a", "b"])
    c.dispose()
  })

  it("ignores a commit delivered twice", () => {
    const { service, commits } = controllable()
    const c = client(service)

    commits.emit({ seq: 0, action: join("a") })
    commits.emit({ seq: 0, action: join("a") })

    expect(c.store.state.match.players).toHaveLength(1)
    expect(c.store.state.applied).toBe(1)
    c.dispose()
  })

  it("reports a desync when the host commits something this device refuses", () => {
    const { service, commits } = controllable()
    const c = client(service)

    commits.emit({ seq: 0, action: join("a") })
    // No Start has been committed, so a roll cannot be legal here.
    commits.emit({ seq: 1, action: { _tag: "Commit", playerId: "a" } })

    expect(c.store.state.desync).toMatch(/Commit rejected at #1/)
    c.dispose()
  })

  it("reports a desync rather than folding an undecodable action", () => {
    const { service, commits } = controllable()
    const c = client(service)

    commits.emit({ seq: 0, action: { _tag: "Nonsense" } })
    expect(c.store.state.desync).toMatch(/undecodable action at #0/)
    expect(c.store.state.applied).toBe(0)
    c.dispose()
  })

  it("refuses an illegal local action without sending it", () => {
    const { service, commits, sent } = controllable()
    const c = client(service)
    commits.emit({ seq: 0, action: join("a") })

    c.send({ _tag: "Commit", playerId: "a" })

    expect(sent).toHaveLength(0)
    expect(c.store.state.notice).toBeTruthy()
    c.dispose()
  })

  it("never applies a local action before the host commits it", () => {
    const { service, commits, sent } = controllable()
    const c = client(service)
    commits.emit({ seq: 0, action: join("a") })

    c.send(join("b"))
    // Sent, but not yet folded: applying early would diverge the RNG stream.
    expect(sent).toHaveLength(1)
    expect(c.store.state.match.players).toHaveLength(1)

    commits.emit({ seq: 1, action: join("b") })
    expect(c.store.state.match.players).toHaveLength(2)
    c.dispose()
  })

  it("stops listening once disposed", () => {
    const { service, commits } = controllable()
    const c = client(service)
    c.dispose()

    commits.emit({ seq: 0, action: join("a") })
    expect(c.store.state.applied).toBe(0)
  })
})

describe("local transport", () => {
  it("delivers a submitted action back as a numbered commit", async () => {
    const service = makeLocalTransport()
    const c = new MatchClient(service, config, "local", "a")

    c.send(join("a"))
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))

    expect(c.store.state.match.players.map((p) => p.id)).toEqual(["a"])
    c.dispose()
  })
})
