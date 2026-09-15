import type { Board, MatchConfig, Player } from "../types"

/**
 * Simultaneous rolls turn the board into a contact sport. Everyone commits in
 * the same round; resolution order is lowest roll first, so the biggest roll
 * lands last and gets to do the knocking.
 */

export const enabled = (config: MatchConfig): boolean =>
  config.modules.includes("simultaneous")

export interface Commitment {
  readonly player: Player
  readonly total: number
}

/** Deterministic ordering — seat index breaks every tie. */
export const resolutionOrder = (commitments: ReadonlyArray<Commitment>): Commitment[] =>
  commitments.slice().sort((a, b) => a.total - b.total || a.player.seat - b.player.seat)

/**
 * Where a knocked player lands: the nearest snake mouth below them, so being
 * shoved on a snake-dense stretch of board hurts far more than on open ground.
 */
export const knockbackTile = (board: Board, from: number): number => {
  let best = 0
  for (const link of board.links) {
    if (link.kind !== "snake") continue
    if (link.from < from && link.from > best) best = link.from
  }
  return best
}
