import { Data, Schema } from "effect"
import { CardKind, MatchConfig } from "./types"

/**
 * The entire wire protocol. A round of four players costs a few hundred bytes,
 * because dice are drawn from the shared RNG rather than sent by the client —
 * which also means a tampered peer cannot roll itself a six.
 */
export const Action = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("Join"),
    playerId: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal("Leave"), playerId: Schema.String }),
  Schema.Struct({
    _tag: Schema.Literal("Configure"),
    config: MatchConfig,
  }),
  Schema.Struct({ _tag: Schema.Literal("Start") }),
  Schema.Struct({
    _tag: Schema.Literal("PlayCard"),
    playerId: Schema.String,
    card: CardKind,
    /** Tile for `defuse`; ignored otherwise. */
    targetTile: Schema.optional(Schema.Int),
  }),
  /** Ask for a roll. The value is drawn from match RNG during resolution. */
  Schema.Struct({ _tag: Schema.Literal("Commit"), playerId: Schema.String }),
  /** Free minesweeper annotation — no rules effect, shared across devices. */
  Schema.Struct({
    _tag: Schema.Literal("Flag"),
    playerId: Schema.String,
    tile: Schema.Int,
  }),
)
export type Action = typeof Action.Type

export const decodeAction = Schema.decodeUnknownEither(Action)
export const encodeAction = Schema.encodeSync(Action)

export class RuleError extends Data.TaggedError("RuleError")<{
  readonly reason: string
  readonly action?: Action["_tag"]
}> {}
