import { revealFrom, tileAt } from "../board"
import type { Board, MatchConfig, Tile } from "../types"

/**
 * Minesweeper is an overlay, not a second game: the same 100 tiles carry
 * hidden mines and the familiar adjacency numbers. Tiles reveal as tokens land
 * on them, so the deduction puzzle unfolds from where players have actually
 * been — and a snake that drops you into unexplored territory is genuinely
 * scarier than one that does not.
 */

export const enabled = (config: MatchConfig): boolean =>
  config.modules.includes("minesweeper")

export const isLive = (tile: Tile): boolean => tile.mined && !tile.defused

/** Landing opens the tile and, if it is blank, its whole blank region. */
export const stepOn = (board: Board, tile: number): readonly [Board, number[]] =>
  revealFrom(board, tile)

/** A tripped mine is spent: it cannot bounce the same player twice. */
export const detonate = (board: Board, tile: number): Board => {
  const tiles = board.tiles.slice()
  const cur = tiles[tile]
  if (cur) tiles[tile] = { ...cur, revealed: true, defused: true }
  return { ...board, tiles }
}

export const setFlag = (board: Board, tile: number, flagged: boolean): Board => {
  const tiles = board.tiles.slice()
  const cur = tiles[tile]
  if (cur) tiles[tile] = { ...cur, flagged }
  return { ...board, tiles }
}

/**
 * `defuse` is a gamble priced by information: you may only reach tiles near
 * your token, so the adjacency numbers you have uncovered are what tell you
 * whether the card is worth spending.
 */
export const defuseRange = 2

export const canDefuse = (board: Board, from: number, tile: number): boolean => {
  if (tile <= 0 || tile >= board.tiles.length) return false
  if (Math.abs(tile - from) > defuseRange) return false
  return !tileAt(board, tile).defused
}

export const defuse = (board: Board, tile: number): readonly [Board, boolean] => {
  const target = tileAt(board, tile)
  const tiles = board.tiles.slice()
  tiles[tile] = { ...target, revealed: true, defused: true, flagged: false }
  return [{ ...board, tiles }, target.mined] as const
}

/** How far back a blast throws you, and how long you sit out. */
export const blastKnockback = (config: MatchConfig, from: number): number =>
  Math.max(0, from - config.size)

export const blastStun = 1
