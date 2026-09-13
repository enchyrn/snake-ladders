import { describe, expect, it } from "vitest"
import { at, events, ladder, run, runAll, scenario, snake, succeeds } from "./helpers"
import { advance } from "../rules/momentum"
import { knockbackTile } from "../rules/simultaneous"
import { defaultConfig } from "../types"

const commit = (id: string) => ({ _tag: "Commit" as const, playerId: id })
const card = (id: string, c: "reverse" | "anchor" | "double" | "swap" | "defuse", tile?: number) =>
  ({ _tag: "PlayCard" as const, playerId: id, card: c, ...(tile === undefined ? {} : { targetTile: tile }) })

describe("classic movement", () => {
  it("moves by the roll and climbs a ladder", () => {
    const s = scenario({
      modules: [],
      links: [ladder("L", 4, 40)],
      players: [{ id: "a" }],
      dice: [4],
    })
    const next = run(s, commit("a"))
    expect(at(next, "a").position).toBe(40)
    expect(events(next, "TookLink")).toHaveLength(1)
  })

  it("slides down a snake", () => {
    const s = scenario({
      modules: [],
      links: [snake("S", 5, 2)],
      players: [{ id: "a" }],
      dice: [5],
    })
    expect(at(run(s, commit("a")), "a").position).toBe(2)
  })

  it("never chains one link straight into another", () => {
    const s = scenario({
      modules: [],
      links: [ladder("L", 3, 50), snake("S", 50, 10)],
      players: [{ id: "a" }],
      dice: [3],
    })
    // The ladder deposits the token on 50; the snake there must not fire.
    expect(at(run(s, commit("a")), "a").position).toBe(50)
  })
})

describe("momentum module", () => {
  it("bounces back off the final tile when an exact finish is required", () => {
    const config = { ...defaultConfig(1), exactFinish: true }
    expect(advance(config, 98, 5)).toEqual({ tile: 97, bounced: true })
    expect(advance(config, 100, 0)).toEqual({ tile: 100, bounced: false })
  })

  it("clamps instead of bouncing when an exact finish is not required", () => {
    const config = { ...defaultConfig(1), exactFinish: false }
    expect(advance(config, 98, 5)).toEqual({ tile: 100, bounced: false })
  })

  it("carries speed from a ladder into the next roll", () => {
    const s = scenario({
      modules: ["momentum"],
      links: [ladder("L", 3, 63)],
      players: [{ id: "a" }],
      dice: [3, 1],
    })
    const afterClimb = run(s, commit("a"))
    // A 60-tile ladder on a size-10 board is worth 6 momentum.
    expect(at(afterClimb, "a").momentum).toBe(6)
    const afterRoll = run(afterClimb, commit("a"))
    // Rolling a 1 with 6 carried moves 7 tiles, not 1.
    expect(at(afterRoll, "a").position).toBe(70)
  })

  it("bleeds momentum off rather than compounding it", () => {
    const s = scenario({
      modules: ["momentum"],
      links: [ladder("L", 3, 63)],
      players: [{ id: "a" }],
      dice: [3, 1, 1],
    })
    const one = run(s, commit("a"))
    const two = run(one, commit("a"))
    expect(at(two, "a").momentum).toBe(3)
    expect(at(run(two, commit("a")), "a").momentum).toBe(1)
  })

  it("leaves momentum at zero when the module is off", () => {
    const s = scenario({
      modules: [],
      links: [ladder("L", 3, 63)],
      players: [{ id: "a" }],
      dice: [3],
    })
    expect(at(run(s, commit("a")), "a").momentum).toBe(0)
  })
})

describe("mutation module", () => {
  it("collapses a ladder into a snake after two climbs", () => {
    const s = scenario({
      modules: ["mutation"],
      links: [ladder("L", 3, 30)],
      players: [{ id: "a" }, { id: "b" }],
      dice: [3, 3, 6, 6],
    })
    const first = run(s, commit("a"))
    expect(first.board.links[0]!.uses).toBe(1)
    expect(first.board.links[0]!.kind).toBe("ladder")

    const second = run(first, commit("b"))
    const link = second.board.links[0]!
    expect(link.kind).toBe("snake")
    // It inverts in place: the climb becomes a drop along the same span.
    expect(link.from).toBe(30)
    expect(link.to).toBe(3)
    expect(events(second, "LinkCollapsed")).toHaveLength(1)
  })

  it("pays venom for a snake bite, scaled by the drop", () => {
    const s = scenario({
      modules: ["mutation"],
      links: [snake("S", 4, 1)],
      players: [{ id: "a" }],
      dice: [4],
    })
    const short = run(s, commit("a"))
    expect(at(short, "a").venom).toBe(1)

    const long = run(
      scenario({
        modules: ["mutation"],
        links: [snake("S", 44, 4)],
        players: [{ id: "a", position: 40 }],
        dice: [4],
      }),
      commit("a"),
    )
    expect(at(long, "a").venom).toBe(5)
  })

  it("pays no venom when the module is off", () => {
    const s = scenario({
      modules: [],
      links: [snake("S", 4, 1)],
      players: [{ id: "a" }],
      dice: [4],
    })
    expect(at(run(s, commit("a")), "a").venom).toBe(0)
  })

  it("rearranges links on the breathing round and keeps them un-chained", () => {
    const s = scenario({
      modules: ["mutation"],
      links: [ladder("L", 12, 42), snake("S", 77, 37)],
      players: [{ id: "a" }],
      dice: [1, 1, 1, 1, 1, 1, 1, 1],
      config: { mutationInterval: 2 },
    })
    const before = s.board.links.map((l) => `${l.from}->${l.to}`)
    // Round 1 resolves into round 2, which is a breathing round.
    const breathed = run(s, commit("a"))
    const after = breathed.board.links.map((l) => `${l.from}->${l.to}`)
    expect(after).not.toEqual(before)
    expect(events(breathed, "BoardBreathed")).toHaveLength(1)
    const mouths = new Set(breathed.board.links.map((l) => l.from))
    for (const l of breathed.board.links) expect(mouths.has(l.to)).toBe(false)

    // Round 3 is not a breathing round, so the layout holds still.
    const quiet = run(breathed, commit("a"))
    expect(quiet.board.links.map((l) => `${l.from}->${l.to}`)).toEqual(after)
  })
})

describe("cards", () => {
  it("refuses a card the player cannot pay for", () => {
    const s = scenario({ players: [{ id: "a", venom: 0 }], dice: [1] })
    expect(succeeds(s, card("a", "anchor"))).toBe(false)
  })

  it("anchor absorbs exactly one snake bite", () => {
    const s = scenario({
      modules: ["mutation"],
      links: [snake("S", 4, 1)],
      players: [{ id: "a", venom: 1 }],
      dice: [4, 4],
    })
    const played = run(s, card("a", "anchor"))
    expect(at(played, "a").anchored).toBe(true)
    const safe = run(played, commit("a"))
    expect(at(safe, "a").position).toBe(4)
    // The charge is spent, so the same bite would land next time.
    expect(at(safe, "a").anchored).toBe(false)
    expect(at(run(s, commit("a")), "a").position).toBe(1)
  })

  it("reverse turns a snake into a climb of the same length", () => {
    const s = scenario({
      modules: ["mutation"],
      links: [snake("S", 24, 4)],
      players: [{ id: "a", position: 20, venom: 2 }],
      dice: [4],
    })
    const next = run(run(s, card("a", "reverse")), commit("a"))
    expect(at(next, "a").position).toBe(44)
    expect(events(next, "TookLink")[0]).toMatchObject({ reversed: true })
  })

  it("double rolls two dice", () => {
    const s = scenario({
      modules: ["mutation"],
      players: [{ id: "a", venom: 3 }],
      dice: [3, 5],
    })
    const next = run(run(s, card("a", "double")), commit("a"))
    expect(at(next, "a").position).toBe(8)
    expect(events(next, "Rolled")[0]).toMatchObject({ dice: [3, 5], total: 8 })
  })

  it("swap trades places with the leader, and is refused when already ahead", () => {
    const s = scenario({
      modules: ["mutation"],
      players: [{ id: "a", position: 10, venom: 4 }, { id: "b", position: 70 }],
      dice: [1, 1],
    })
    const next = run(s, card("a", "swap"))
    expect(at(next, "a").position).toBe(70)
    expect(at(next, "b").position).toBe(10)
    expect(succeeds(next, card("a", "swap"))).toBe(false)
  })

  it("charges a card only once per round", () => {
    const s = scenario({ modules: ["mutation"], players: [{ id: "a", venom: 5 }], dice: [1] })
    const once = run(s, card("a", "reverse"))
    expect(succeeds(once, card("a", "reverse"))).toBe(false)
  })

  it("refuses cards once the player has rolled", () => {
    // Simultaneous mode keeps the round open after a commit, which is the only
    // window in which "already rolled" is observable.
    const s = scenario({
      modules: ["mutation", "simultaneous"],
      players: [{ id: "a", venom: 5 }, { id: "b" }],
      dice: [1, 1],
    })
    const rolled = run(s, commit("a"))
    expect(rolled.phase).toBe("committing")
    expect(succeeds(rolled, card("a", "anchor"))).toBe(false)
  })

  it("refuses cards from a player whose turn it is not", () => {
    const s = scenario({
      modules: ["mutation"],
      players: [{ id: "a", venom: 5 }, { id: "b", venom: 5 }],
      dice: [1, 1],
    })
    expect(succeeds(s, card("a", "anchor"))).toBe(true)
    expect(succeeds(s, card("b", "anchor"))).toBe(false)
  })
})

describe("minesweeper module", () => {
  it("reveals the tile it lands on", () => {
    const s = scenario({
      modules: ["minesweeper"],
      mines: [30],
      players: [{ id: "a" }],
      dice: [4],
    })
    const next = run(s, commit("a"))
    expect(next.board.tiles[4]!.revealed).toBe(true)
  })

  it("throws a player back and stuns them on a live mine", () => {
    const s = scenario({
      modules: ["minesweeper", "simultaneous"],
      mines: [24],
      players: [{ id: "a", position: 20 }, { id: "b" }],
      dice: [4, 1],
    })
    const boom = runAll(s, [commit("a"), commit("b")])
    expect(at(boom, "a").position).toBe(14)
    expect(at(boom, "a").stunned).toBe(1)
    expect(events(boom, "MineTripped")[0]).toMatchObject({ absorbed: false })
    // A spent mine does not detonate a second time.
    expect(boom.board.tiles[24]!.defused).toBe(true)
  })

  it("lets a stunned player sit out exactly one round", () => {
    const s = scenario({
      modules: ["minesweeper", "simultaneous"],
      mines: [24],
      players: [{ id: "a", position: 20 }, { id: "b" }],
      dice: [4, 1, 1, 1],
    })
    const boom = runAll(s, [commit("a"), commit("b")])
    expect(at(boom, "a").stunned).toBe(1)
    expect(succeeds(boom, commit("a"))).toBe(false)

    // Round two runs without them, and clears the stun as it closes.
    const afterSitOut = run(boom, commit("b"))
    expect(at(afterSitOut, "a").stunned).toBe(0)
    expect(succeeds(afterSitOut, commit("a"))).toBe(true)
  })

  it("auto-advances rather than deadlocking when everyone is stunned", () => {
    const s = scenario({
      modules: ["minesweeper"],
      mines: [24],
      players: [{ id: "a", position: 20 }],
      dice: [4, 1, 1],
    })
    const boom = run(s, commit("a"))
    // A lone stunned player would otherwise owe a roll nobody can make.
    expect(boom.phase).toBe("committing")
    expect(succeeds(boom, commit("a"))).toBe(true)
  })

  it("lets an anchor absorb a blast", () => {
    const s = scenario({
      modules: ["minesweeper", "mutation"],
      mines: [24],
      players: [{ id: "a", position: 20, venom: 1 }],
      dice: [4],
    })
    const next = run(run(s, card("a", "anchor")), commit("a"))
    expect(at(next, "a").position).toBe(24)
    expect(at(next, "a").stunned).toBe(0)
    expect(events(next, "MineTripped")[0]).toMatchObject({ absorbed: true })
  })

  it("defuses a mine in range and refunds a correct read", () => {
    const s = scenario({
      modules: ["minesweeper", "mutation"],
      mines: [22],
      players: [{ id: "a", position: 20, venom: 2 }],
      dice: [2],
    })
    const next = run(s, card("a", "defuse", 22))
    expect(next.board.tiles[22]!.defused).toBe(true)
    expect(at(next, "a").venom).toBe(1) // cost 2, refunded 1
    // Walking onto it is now safe.
    expect(at(run(next, commit("a")), "a").position).toBe(22)
  })

  it("charges full price for a wasted defuse and refuses out-of-reach tiles", () => {
    const s = scenario({
      modules: ["minesweeper", "mutation"],
      mines: [40],
      players: [{ id: "a", position: 20, venom: 2 }],
      dice: [1],
    })
    expect(at(run(s, card("a", "defuse", 21)), "a").venom).toBe(0)
    expect(succeeds(s, card("a", "defuse", 40))).toBe(false)
  })
})

describe("simultaneous module", () => {
  it("resolves the lowest roll first so the biggest roll lands last", () => {
    const s = scenario({
      modules: ["simultaneous"],
      players: [{ id: "a" }, { id: "b" }],
      dice: [6, 2],
    })
    const next = runAll(s, [{ _tag: "Commit", playerId: "a" }, { _tag: "Commit", playerId: "b" }])
    const order = events(next, "Moved").map((e) => (e as { playerId: string }).playerId)
    expect(order).toEqual(["b", "a"])
  })

  it("knocks a sitting token down the nearest snake below it", () => {
    const s = scenario({
      modules: ["simultaneous"],
      links: [snake("S", 30, 8)],
      players: [{ id: "a", position: 40 }, { id: "b", position: 44 }],
      dice: [6, 2],
    })
    const next = runAll(s, [{ _tag: "Commit", playerId: "a" }, { _tag: "Commit", playerId: "b" }])
    // b moves to 46 first, a follows to 46 and displaces b to snake mouth 30.
    expect(at(next, "a").position).toBe(46)
    expect(at(next, "b").position).toBe(30)
    expect(events(next, "Knocked")).toHaveLength(1)
  })

  it("falls back to the start pad when no snake lies below", () => {
    expect(knockbackTile({ size: 10, tiles: [], links: [] }, 40)).toBe(0)
  })

  it("takes strict turns when the module is off", () => {
    const s = scenario({
      modules: [],
      players: [{ id: "a" }, { id: "b" }],
      dice: [1, 1],
    })
    expect(succeeds(s, { _tag: "Commit", playerId: "b" })).toBe(false)
    const afterA = run(s, { _tag: "Commit", playerId: "a" })
    expect(afterA.activeSeat).toBe(1)
    expect(succeeds(afterA, { _tag: "Commit", playerId: "a" })).toBe(false)
  })
})

describe("finishing", () => {
  it("requires an exact landing and ends the match", () => {
    const s = scenario({
      modules: [],
      players: [{ id: "a", position: 97 }],
      dice: [3],
      config: { exactFinish: true },
    })
    const next = run(s, commit("a"))
    expect(next.phase).toBe("finished")
    expect(next.winners).toEqual(["a"])
    expect(at(next, "a").finishedAtRound).toBe(1)
  })

  it("keeps playing when a roll overshoots the top", () => {
    const s = scenario({
      modules: [],
      players: [{ id: "a", position: 97 }],
      dice: [5],
      config: { exactFinish: true },
    })
    const next = run(s, commit("a"))
    expect(next.phase).toBe("committing")
    expect(at(next, "a").position).toBe(98)
    expect(events(next, "Moved")[0]).toMatchObject({ bounced: true })
  })
})
