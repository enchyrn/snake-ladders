import { Schema } from "effect"

/**
 * Leaf vocabulary shared by the state types and the timeline events. It lives
 * on its own so those two modules can both depend on it without forming a
 * cycle — Effect schemas are built at module-init time and a cycle leaves one
 * side holding `undefined`.
 */

export const RuleModule = Schema.Literal(
  "mutation", // ladders wear out and turn into snakes; venom + cards
  "simultaneous", // everyone rolls each round; landing on a token knocks it back
  "momentum", // links impart momentum; tokens overshoot and bounce off the top
  "minesweeper", // hidden mines on tiles, revealed minesweeper-style
)
export type RuleModule = typeof RuleModule.Type

export const allModules: ReadonlyArray<RuleModule> = [
  "mutation",
  "simultaneous",
  "momentum",
  "minesweeper",
]

export const moduleLabels: Record<RuleModule, string> = {
  mutation: "Mutation",
  simultaneous: "Simultaneous",
  momentum: "Momentum",
  minesweeper: "Minefield",
}

export const moduleBlurbs: Record<RuleModule, string> = {
  mutation: "Ladders wear out after two climbs and invert into snakes. Snake bites pay venom, venom buys cards, and the board rearranges itself every few rounds.",
  simultaneous: "Everyone rolls at once. Lowest roll resolves first, so the biggest roll lands last — and landing on an occupied tile throws that token down the nearest snake.",
  momentum: "Snakes and ladders impart speed. Carry it into your next roll, overshoot the hundredth tile, and bounce back off it.",
  minesweeper: "Mines hide under the board. Tiles reveal their neighbour counts as tokens land on them; step on a live one and you are thrown back and lose a round.",
}

export const LinkKind = Schema.Literal("ladder", "snake")
export type LinkKind = typeof LinkKind.Type

export const CardKind = Schema.Literal(
  "reverse", // the next link you enter this round runs backwards
  "anchor", // ignore the next snake bite or mine blast
  "double", // roll twice this round and sum
  "swap", // trade places with whoever is furthest ahead
  "defuse", // permanently disarm a mine you can reach
)
export type CardKind = typeof CardKind.Type

export const cardCost: Record<CardKind, number> = {
  anchor: 1,
  reverse: 2,
  defuse: 2,
  double: 3,
  swap: 4,
}

export const cardBlurbs: Record<CardKind, string> = {
  anchor: "Shrug off the next snake bite or mine blast.",
  reverse: "The next snake or ladder you enter runs the other way.",
  double: "Roll two dice this round instead of one.",
  swap: "Trade places with whoever is furthest ahead.",
  defuse: "Disarm a tile within two of your token. A correct read refunds a venom.",
}
