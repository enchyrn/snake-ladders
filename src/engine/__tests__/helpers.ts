import { Effect, Exit } from "effect"
import type { Action } from "../actions"
import { applyAction, initialMatch, newPlayer } from "../match"
import { nextRange, seedRng, type RngState } from "../rng"
import { buildTiles } from "../board"
import type { Board, Link, MatchConfig, MatchState, RuleModule } from "../types"
import { defaultConfig } from "../types"

export const run = (state: MatchState, action: Action): MatchState =>
  Effect.runSync(applyAction(state, action))

export const runAll = (state: MatchState, actions: ReadonlyArray<Action>): MatchState =>
  actions.reduce(run, state)

export const failureOf = (state: MatchState, action: Action): string => {
  const exit = Effect.runSyncExit(applyAction(state, action))
  if (Exit.isSuccess(exit)) throw new Error("expected the action to be rejected")
  const err = exit.cause
  return JSON.stringify(err)
}

export const succeeds = (state: MatchState, action: Action): boolean =>
  Exit.isSuccess(Effect.runSyncExit(applyAction(state, action)))

/**
 * Search for a seed whose first d6 draws are exactly `wanted`. Lets a rules
 * test say "now roll a 3" without reaching into the generator's internals.
 */
export const rngYielding = (wanted: ReadonlyArray<number>): RngState => {
  for (let seed = 1; seed < 5_000_000; seed++) {
    let st = seedRng(seed)
    let ok = true
    for (const want of wanted) {
      const [v, s] = nextRange(st, 1, 6)
      st = s
      if (v !== want) {
        ok = false
        break
      }
    }
    if (ok) return seedRng(seed)
  }
  throw new Error(`no seed produced the dice sequence ${wanted.join(",")}`)
}

export interface Scenario {
  readonly modules?: ReadonlyArray<RuleModule>
  readonly links?: ReadonlyArray<Link>
  readonly mines?: ReadonlyArray<number>
  readonly players: ReadonlyArray<{ id: string; position?: number; venom?: number }>
  readonly dice: ReadonlyArray<number>
  readonly config?: Partial<MatchConfig>
}

/**
 * A match with a hand-built board, so a test can state exactly which snake or
 * mine it is exercising instead of hunting for one in a generated layout.
 */
export const scenario = (s: Scenario): MatchState => {
  const config: MatchConfig = {
    ...defaultConfig(1),
    modules: s.modules ?? ["mutation", "simultaneous", "momentum", "minesweeper"],
    mineCount: 0,
    ...s.config,
  }
  const board: Board = {
    size: config.size,
    tiles: buildTiles(config.size, new Set(s.mines ?? [])),
    links: s.links ?? [],
  }
  const base = initialMatch(config)
  return {
    ...base,
    board,
    phase: "committing",
    round: 1,
    rng: rngYielding(s.dice),
    players: s.players.map((p, i) => ({
      ...newPlayer(p.id, p.id, i),
      position: p.position ?? 0,
      venom: p.venom ?? 0,
    })),
  }
}

export const at = (state: MatchState, id: string) => state.players.find((p) => p.id === id)!

export const events = (state: MatchState, tag: string) =>
  state.timeline.filter((e) => e._tag === tag)

export const ladder = (id: string, from: number, to: number): Link => ({
  id,
  kind: "ladder",
  from,
  to,
  uses: 0,
  maxUses: 2,
})

export const snake = (id: string, from: number, to: number): Link => ({
  id,
  kind: "snake",
  from,
  to,
  uses: 0,
  maxUses: Number.MAX_SAFE_INTEGER,
})
