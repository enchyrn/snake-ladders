import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { MatchClient } from "../match-client"
import { actingSeatFor, emptyState } from "../atoms"
import { makeLocalTransport } from "@mutation/net/local"
import { emitter, TransportError, type Committed, type TransportService } from "@mutation/net/transport"
import { newPlayer } from "@mutation/engine/match"
import { defaultConfig } from "@mutation/engine/types"

/** A transport whose commit stream the test drives by hand. */
const controllable = (lock: TransportService["lock"] = Effect.void) => {
  const commits = emitter<Committed>()
  const rosters = emitter<ReadonlyArray<{ player_id: string; name: string; connected: boolean }>>()
  const sent: unknown[] = []
  const transport = { locked: false }
  const service: TransportService = {
    ...makeLocalTransport(),
    lock,
    submit: (action) => Effect.sync(() => {
      sent.push(action)
    }),
    onCommit: commits.subscribe,
    onRoster: rosters.subscribe,
    lock: Effect.sync(() => {
      transport.locked = true
    }),
  }
  return { service, commits, sent, rosters, transport }
}

const config = defaultConfig(2024)

const client = (service: TransportService) => new MatchClient(service, config, "peer", "a")

const join = (id: string) => ({ _tag: "Join" as const, playerId: id, name: id })

/**
 * Seat the given players by emitting Join commits on the given commits emitter.
 * This simulates them having been seated by the host without polluting the sent array.
 */
const seatPlayers = (
  commits: ReturnType<typeof emitter<Committed>>,
  ids: string[],
) => {
  let seq = 0
  for (const id of ids) {
    commits.emit({ seq: seq++, action: join(id) })
  }
}

describe("MatchClient", () => {
  it("keeps a local seat roster and active seat for pass-and-play", () => {
    const state = emptyState(config, "local", "a")

    expect(state.seats).toEqual(["a"])
    expect(state.actingSeat).toBe("a")
    expect(state.me).toBe("a")
  })

  it("selects the first owned seat that still owes a roll", () => {
    const state = emptyState(
      { ...config, modules: ["simultaneous"] },
      "local",
      "a",
    )
    const match = {
      ...state.match,
      phase: "committing" as const,
      players: [
        newPlayer("a", "A", 0),
        newPlayer("b", "B", 1),
      ],
      commitments: { a: 1 },
    }

    expect(actingSeatFor(match, ["a", "b"])).toBe("b")
  })

  it("adds a newly joined local seat to ownership", () => {
    const { service } = controllable()
    const c = client(service)

    c.setSeats(["a", "b"])

    expect(c.state.seats).toEqual(["a", "b"])
    expect(c.state.actingSeat).toBe("a")
    c.dispose()
  })

  it("folds commits in sequence order", () => {
    const { service, commits } = controllable()
    const c = client(service)

    commits.emit({ seq: 0, action: join("a") })
    commits.emit({ seq: 1, action: join("b") })

    expect(c.state.match.players.map((p) => p.id)).toEqual(["a", "b"])
    expect(c.state.applied).toBe(2)
    c.dispose()
  })

  it("holds an out-of-order commit until the gap is filled", () => {
    const { service, commits } = controllable()
    const c = client(service)

    // #1 arrives before #0 — nothing may be applied yet.
    commits.emit({ seq: 1, action: join("b") })
    expect(c.state.applied).toBe(0)

    commits.emit({ seq: 0, action: join("a") })
    // Both land, and in the order the host chose, not the order they arrived.
    expect(c.state.match.players.map((p) => p.id)).toEqual(["a", "b"])
    c.dispose()
  })

  it("ignores a commit delivered twice", () => {
    const { service, commits } = controllable()
    const c = client(service)

    commits.emit({ seq: 0, action: join("a") })
    commits.emit({ seq: 0, action: join("a") })

    expect(c.state.match.players).toHaveLength(1)
    expect(c.state.applied).toBe(1)
    c.dispose()
  })

  it("notes an unapplicable action without calling it a desync", () => {
    const { service, commits } = controllable()
    const c = client(service)

    commits.emit({ seq: 0, action: join("a") })
    // No Start has been committed, so a roll cannot be legal here.
    commits.emit({ seq: 1, action: { _tag: "Commit", playerId: "a" } })

    // Every device folds this same log through this same reducer, so they all
    // reject it identically and remain consistent. Two players acting at once
    // produces this legitimately.
    expect(c.state.notice).toMatch(/Commit could not be applied/)
    expect(c.state.desync).toBeNull()
    c.dispose()
  })

  it("reports a desync rather than folding an undecodable action", () => {
    const { service, commits } = controllable()
    const c = client(service)

    commits.emit({ seq: 0, action: { _tag: "Nonsense" } })
    expect(c.state.desync).toMatch(/undecodable action at #0/)
    expect(c.state.applied).toBe(0)
    c.dispose()
  })

  it("refuses an illegal local action without sending it", () => {
    const { service, commits, sent } = controllable()
    const c = client(service)
    commits.emit({ seq: 0, action: join("a") })

    c.send({ _tag: "Commit", playerId: "a" })

    expect(sent).toHaveLength(0)
    expect(c.state.notice).toBeTruthy()
    c.dispose()
  })

  it("never applies a local action before the host commits it", () => {
    const { service, commits, sent } = controllable()
    const c = client(service)
    commits.emit({ seq: 0, action: join("a") })

    c.send(join("b"))
    // Sent, but not yet folded: applying early would diverge the RNG stream.
    expect(sent).toHaveLength(1)
    expect(c.state.match.players).toHaveLength(1)

    commits.emit({ seq: 1, action: join("b") })
    expect(c.state.match.players).toHaveLength(2)
    c.dispose()
  })

  it("stops listening once disposed", () => {
    const { service, commits } = controllable()
    const c = client(service)
    c.dispose()

    commits.emit({ seq: 0, action: join("a") })
    expect(c.state.applied).toBe(0)
  })

  it("the host turns a roster disconnect into a sequenced Leave", () => {
    const { service, commits, rosters, sent } = controllable()
    const c = new MatchClient(service, config, "host", "me")
    seatPlayers(commits, ["me", "them"])

    rosters.emit([
      { player_id: "me", name: "Me", connected: true },
      { player_id: "them", name: "Them", connected: false },
    ])

    expect(sent).toContainEqual({ _tag: "Leave", playerId: "them" })
    c.dispose()
  })

  it("a peer does not submit Leave — only the host does", () => {
    const { service, commits, rosters, sent } = controllable()
    const c = new MatchClient(service, config, "peer", "me")
    seatPlayers(commits, ["me", "them"])

    rosters.emit([
      { player_id: "me", name: "Me", connected: true },
      { player_id: "them", name: "Them", connected: false },
    ])

    expect(sent).toEqual([])
    c.dispose()
  })

  it("does not submit Leave twice for the same disconnect", () => {
    const { service, commits, rosters, sent } = controllable()
    const c = new MatchClient(service, config, "host", "me")
    seatPlayers(commits, ["me", "them"])

    const roster = [
      { player_id: "me", name: "Me", connected: true },
      { player_id: "them", name: "Them", connected: false },
    ]
    rosters.emit(roster)
    rosters.emit(roster)

    expect(sent.filter((a) => typeof a === "object" && a !== null && "_tag" in a && a._tag === "Leave")).toHaveLength(1)
    c.dispose()
  })

  it("submits a second Leave after a rejoin and a second disconnect", () => {
    const { service, commits, rosters, sent } = controllable()
    const c = new MatchClient(service, config, "host", "me")
    seatPlayers(commits, ["me", "them"])

    rosters.emit([
      { player_id: "me", name: "Me", connected: true },
      { player_id: "them", name: "Them", connected: false },
    ])
    rosters.emit([
      { player_id: "me", name: "Me", connected: true },
      { player_id: "them", name: "Them", connected: true },
    ])
    rosters.emit([
      { player_id: "me", name: "Me", connected: true },
      { player_id: "them", name: "Them", connected: false },
    ])

    const leaves = sent.filter(
      (a) => typeof a === "object" && a !== null && "_tag" in a && a._tag === "Leave",
    )
    expect(leaves).toHaveLength(2)
    c.dispose()
  })

  it("never submits a Leave for the host's own seat", () => {
    const { service, commits, rosters, sent } = controllable()
    const c = new MatchClient(service, config, "host", "me")
    seatPlayers(commits, ["me", "them"])

    rosters.emit([
      { player_id: "me", name: "Me", connected: false },
      { player_id: "them", name: "Them", connected: true },
    ])

    expect(sent).not.toContainEqual({ _tag: "Leave", playerId: "me" })
    c.dispose()
  })

  it("locks the room when the host starts the match", () => {
    const { service, commits, transport } = controllable()
    const c = new MatchClient(service, config, "host", "me")
    seatPlayers(commits, ["me", "them"])

    c.send({ _tag: "Start" })
    c.lock()

    expect(transport.locked).toBe(true)
    c.dispose()
  })

  it("does not lock the room for a peer", () => {
    const { service, commits, transport } = controllable()
    const c = new MatchClient(service, config, "peer", "me")
    seatPlayers(commits, ["me", "them"])

    c.lock()

    expect(transport.locked).toBe(false)
    c.dispose()
  })

  it("turns a failed lock into a notice, not a thrown error", async () => {
    const { service, commits } = controllable()
    const failing: TransportService = { ...service, lock: Effect.fail(new TransportError({ reason: "room not found" })) }
    const c = new MatchClient(failing, config, "host", "me")
    seatPlayers(commits, ["me", "them"])

    expect(() => c.lock()).not.toThrow()
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))

    expect(c.state.notice).toMatch(/could not close the room: room not found/)

  it("reconciles a disconnect that arrived before its Join commit", () => {
    const { service, commits, rosters, sent } = controllable()
    const c = new MatchClient(service, config, "host", "me")

    rosters.emit([{ player_id: "them", name: "Them", connected: false }])
    commits.emit({ seq: 0, action: join("them") })

    expect(sent).toContainEqual({ _tag: "Leave", playerId: "them" })
    c.dispose()
  })

  it("locks the room when the host starts the match", async () => {
    let locked = false
    const { service } = controllable(Effect.sync(() => {
      locked = true
    }))
    const c = new MatchClient(service, config, "host", "me")
    c.lock()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(locked).toBe(true)
    c.dispose()
  })
})

describe("local transport", () => {
  it("delivers a submitted action back as a numbered commit", async () => {
    const service = makeLocalTransport()
    const c = new MatchClient(service, config, "local", "a")

    c.send(join("a"))
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))

    expect(c.state.match.players.map((p) => p.id)).toEqual(["a"])
    c.dispose()
  })
})
