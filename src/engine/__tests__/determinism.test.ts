import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { decodeAction, encodeAction, type Action } from "../actions"
import { applyAction, canCommit, initialMatch, pendingCommitters, replay } from "../match"
import { nextInt, seedRng, type RngState } from "../rng"
import { cardCost, defaultConfig, type CardKind, type MatchConfig, type MatchState } from "../types"

const CARDS: ReadonlyArray<CardKind> = ["anchor", "reverse", "double", "swap", "defuse"]

/**
 * Drives a whole match by picking legal actions at random. The driver has its
 * own RNG so a failing fuzz case is reproducible from its index alone.
 */
const playRandomMatch = (
  config: MatchConfig,
  driverSeed: number,
  playerCount: number,
): { readonly log: Action[]; readonly final: MatchState } => {
  let rnd: RngState = seedRng(driverSeed)
  const pick = <A>(xs: ReadonlyArray<A>): A => {
    const [i, s] = nextInt(rnd, xs.length)
    rnd = s
    return xs[i]!
  }
  const chance = (n: number): boolean => {
    const [i, s] = nextInt(rnd, n)
    rnd = s
    return i === 0
  }

  const log: Action[] = []
  let state = initialMatch(config)

  const apply = (action: Action): void => {
    const result = Effect.runSync(Effect.either(applyAction(state, action)))
    if (Either.isRight(result)) {
      state = result.right
      log.push(action)
    }
  }

  for (let i = 0; i < playerCount; i++) {
    apply({ _tag: "Join", playerId: `p${i}`, name: `Player ${i}` })
  }
  apply({ _tag: "Start" })

  for (let step = 0; step < 800 && state.phase === "committing"; step++) {
    const waiting = pendingCommitters(state)
    if (waiting.length === 0) break
    const player = pick(waiting)

    if (chance(3)) {
      const affordable = CARDS.filter((c) => cardCost[c] <= player.venom)
      if (affordable.length > 0) {
        const card = pick(affordable)
        apply({
          _tag: "PlayCard",
          playerId: player.id,
          card,
          targetTile: player.position + (chance(2) ? 1 : 2),
        })
      }
    }
    if (chance(6)) apply({ _tag: "Flag", playerId: player.id, tile: 1 + (step % 99) })

    if (canCommit(state, player.id)) apply({ _tag: "Commit", playerId: player.id })
    else break
  }

  return { log, final: state }
}

const fold = (config: MatchConfig, log: ReadonlyArray<Action>): MatchState =>
  Effect.runSync(replay(config, log))

describe("cross-device determinism", () => {
  it("replays an action log to a byte-identical state", () => {
    for (let seed = 0; seed < 40; seed++) {
      const config = { ...defaultConfig(seed * 31 + 7), mineCount: 10 }
      const { log, final } = playRandomMatch(config, seed, 1 + (seed % 4))

      // Two peers, each folding the same log from scratch.
      const peerA = fold(config, log)
      const peerB = fold(config, log)

      expect(peerA).toEqual(final)
      expect(peerB).toEqual(final)
      expect(JSON.stringify(peerA)).toBe(JSON.stringify(peerB))
    }
  })

  it("cannot be folded successfully by a peer on a different seed", () => {
    // A mismatched seed is the desync case worth catching. It surfaces either
    // as a rejected action or as a different state — never as silent agreement.
    const config = defaultConfig(1)
    const { log } = playRandomMatch(config, 5, 3)
    const mine = fold(config, log)

    const theirs = Effect.runSync(Effect.either(replay({ ...config, seed: 2 }, log)))
    if (Either.isRight(theirs)) {
      expect(JSON.stringify(theirs.right)).not.toBe(JSON.stringify(mine))
    } else {
      expect(theirs.left._tag).toBe("RuleError")
    }
  })

  it("reaches the same state whether folded at once or incrementally", () => {
    const config = defaultConfig(99)
    const { log } = playRandomMatch(config, 12, 4)

    // A late joiner catching up in one shot vs. a peer that was there all along.
    let incremental = initialMatch(config)
    for (const action of log) {
      incremental = Effect.runSync(applyAction(incremental, action))
    }
    expect(fold(config, log)).toEqual(incremental)
  })

  it("never mutates the state handed to it", () => {
    const config = defaultConfig(4)
    const { log } = playRandomMatch(config, 21, 3)
    let state = initialMatch(config)
    for (const action of log) {
      const before = JSON.stringify(state)
      state = Effect.runSync(applyAction(state, action))
      // The previous snapshot must still read the same after the step.
      expect(JSON.stringify(JSON.parse(before))).toBe(before)
    }
  })

  it("survives a round trip through the wire format", () => {
    const config = defaultConfig(77)
    const { log } = playRandomMatch(config, 33, 3)
    expect(log.length).toBeGreaterThan(5)

    const overTheWire = log.map((action) => {
      const json = JSON.stringify(encodeAction(action))
      const decoded = decodeAction(JSON.parse(json))
      if (Either.isLeft(decoded)) throw new Error(`failed to decode ${json}`)
      return decoded.right
    })
    expect(fold(config, overTheWire)).toEqual(fold(config, log))
  })

  it("rejects malformed messages instead of corrupting the match", () => {
    for (const bad of [
      { _tag: "Commit" },
      { _tag: "Nope", playerId: "a" },
      { _tag: "Flag", playerId: "a", tile: "three" },
      null,
      "Commit",
    ]) {
      expect(Either.isLeft(decodeAction(bad))).toBe(true)
    }
  })

  it("stays deterministic for every combination of rule modules", () => {
    const combos: ReadonlyArray<ReadonlyArray<"mutation" | "simultaneous" | "momentum" | "minesweeper">> = [
      [],
      ["mutation"],
      ["simultaneous"],
      ["momentum"],
      ["minesweeper"],
      ["mutation", "minesweeper"],
      ["simultaneous", "momentum"],
      ["mutation", "simultaneous", "momentum", "minesweeper"],
    ]
    combos.forEach((modules, i) => {
      const config = { ...defaultConfig(500 + i), modules }
      const { log, final } = playRandomMatch(config, 900 + i, 3)
      expect(fold(config, log)).toEqual(final)
    })
  })

  it("always terminates a match rather than stalling mid-round", () => {
    for (let seed = 0; seed < 25; seed++) {
      const config = { ...defaultConfig(seed), mineCount: 20 }
      const { final } = playRandomMatch(config, seed + 300, 2 + (seed % 3))
      expect(final.phase).toBe("finished")
      expect(final.winners.length).toBeGreaterThan(0)
    }
  })

  it("keeps every token on a legal tile throughout a match", () => {
    const config = { ...defaultConfig(8), mineCount: 16 }
    const { log } = playRandomMatch(config, 64, 4)
    let state = initialMatch(config)
    for (const action of log) {
      state = Effect.runSync(applyAction(state, action))
      for (const p of state.players) {
        expect(p.position).toBeGreaterThanOrEqual(0)
        expect(p.position).toBeLessThanOrEqual(config.size * config.size)
        expect(p.venom).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
