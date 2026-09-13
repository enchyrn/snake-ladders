import { Schema } from "effect"
import { TimelineEvent } from "./events"
import { CardKind, LinkKind, RuleModule } from "./primitives"

export * from "./primitives"

/* ------------------------------------------------------------------ *
 * Rule modules. Each twist is a flag, not a fork of the game — a match
 * can run any combination, including none (classic Snakes & Ladders).
 * ------------------------------------------------------------------ */

export const MatchConfig = Schema.Struct({
  /** Board edge length. 10 gives the familiar 100-tile board. */
  size: Schema.Int.pipe(Schema.between(5, 12)),
  seed: Schema.Int,
  modules: Schema.Array(RuleModule),
  /** Rounds between board "breaths" (mutation module). */
  mutationInterval: Schema.Int.pipe(Schema.between(1, 50)),
  /** Mines placed when the minesweeper module is on. */
  mineCount: Schema.Int.pipe(Schema.between(0, 40)),
  /** Exact landing needed to win, vs. any roll that reaches or passes the top. */
  exactFinish: Schema.Boolean,
})
export type MatchConfig = typeof MatchConfig.Type

export const defaultConfig = (seed: number): MatchConfig => ({
  size: 10,
  seed,
  modules: ["mutation", "simultaneous", "momentum", "minesweeper"],
  mutationInterval: 5,
  mineCount: 12,
  exactFinish: true,
})

/* ------------------------------------------------------------------ *
 * Board
 * ------------------------------------------------------------------ */

export const Link = Schema.Struct({
  id: Schema.String,
  kind: LinkKind,
  /** Tile the link is entered from. */
  from: Schema.Int,
  /** Tile the link deposits you on. */
  to: Schema.Int,
  uses: Schema.Int,
  /** Ladders collapse into snakes once `uses` reaches this (mutation module). */
  maxUses: Schema.Int,
})
export type Link = typeof Link.Type

export const Tile = Schema.Struct({
  index: Schema.Int,
  mined: Schema.Boolean,
  /** Live mines among the 8 grid-neighbours. Minesweeper's number. */
  adjacentMines: Schema.Int,
  revealed: Schema.Boolean,
  flagged: Schema.Boolean,
  /** A defused mine stays visible but is inert for everyone. */
  defused: Schema.Boolean,
})
export type Tile = typeof Tile.Type

export const Board = Schema.Struct({
  size: Schema.Int,
  /** size * size, index 0 is the start pad and is never linked or mined. */
  tiles: Schema.Array(Tile),
  links: Schema.Array(Link),
})
export type Board = typeof Board.Type

/* ------------------------------------------------------------------ *
 * Cards — the venom economy of the mutation module
 * ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ *
 * Players
 * ------------------------------------------------------------------ */

export const Player = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Stable seat index — the tiebreaker that keeps resolution deterministic. */
  seat: Schema.Int,
  position: Schema.Int,
  venom: Schema.Int,
  /** Carried into the next move by the momentum module. */
  momentum: Schema.Int,
  /** Cards played this round, consumed at resolution. */
  pending: Schema.Array(CardKind),
  /** Anchor charges banked from a previously played card. */
  anchored: Schema.Boolean,
  /** Rounds still to sit out after a mine blast. */
  stunned: Schema.Int,
  finishedAtRound: Schema.NullOr(Schema.Int),
  connected: Schema.Boolean,
})
export type Player = typeof Player.Type

/* ------------------------------------------------------------------ *
 * Match state
 * ------------------------------------------------------------------ */

export const Phase = Schema.Literal(
  "lobby",
  "committing", // waiting on rolls (all players, or just the active one)
  "resolving", // animation window; state already settled
  "finished",
)
export type Phase = typeof Phase.Type

export const MatchState = Schema.Struct({
  config: MatchConfig,
  board: Board,
  players: Schema.Array(Player),
  round: Schema.Int,
  phase: Phase,
  /** Seat whose turn it is. Ignored when the simultaneous module is on. */
  activeSeat: Schema.Int,
  /** seat -> roll, filled during `committing`. */
  commitments: Schema.Record({ key: Schema.String, value: Schema.Int }),
  rng: Schema.Tuple(Schema.Int, Schema.Int, Schema.Int, Schema.Int),
  /** Ordered, replayable narration of the last resolution — drives the 3D view. */
  timeline: Schema.Array(TimelineEvent),
  winners: Schema.Array(Schema.String),
})
export type MatchState = typeof MatchState.Type
