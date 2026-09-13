import { Schema } from "effect"
import { CardKind, LinkKind } from "./primitives"

/**
 * A resolution produces a timeline, not just a new state. The renderer replays
 * it as animation and the log view renders it as text; both devices derive the
 * identical timeline from the identical action, so nothing about the 3D scene
 * needs to go over the wire.
 */
export const TimelineEvent = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("Rolled"),
    playerId: Schema.String,
    dice: Schema.Array(Schema.Int),
    total: Schema.Int,
    momentumBonus: Schema.Int,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Moved"),
    playerId: Schema.String,
    from: Schema.Int,
    to: Schema.Int,
    bounced: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("TookLink"),
    playerId: Schema.String,
    kind: LinkKind,
    from: Schema.Int,
    to: Schema.Int,
    reversed: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("LinkCollapsed"),
    linkId: Schema.String,
    from: Schema.Int,
    to: Schema.Int,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Knocked"),
    playerId: Schema.String,
    byPlayerId: Schema.String,
    from: Schema.Int,
    to: Schema.Int,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MineTripped"),
    playerId: Schema.String,
    tile: Schema.Int,
    to: Schema.Int,
    absorbed: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Revealed"),
    tiles: Schema.Array(Schema.Int),
  }),
  Schema.Struct({
    _tag: Schema.Literal("MineDefused"),
    playerId: Schema.String,
    tile: Schema.Int,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CardPlayed"),
    playerId: Schema.String,
    card: CardKind,
    cost: Schema.Int,
  }),
  Schema.Struct({
    _tag: Schema.Literal("VenomGained"),
    playerId: Schema.String,
    amount: Schema.Int,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Swapped"),
    playerId: Schema.String,
    withPlayerId: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("BoardBreathed"),
    movedLinkIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Stunned"),
    playerId: Schema.String,
    rounds: Schema.Int,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Finished"),
    playerId: Schema.String,
    place: Schema.Int,
  }),
)
export type TimelineEvent = typeof TimelineEvent.Type
