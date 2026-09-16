import { lastTile } from "../board"
import type { MatchConfig } from "../types"

/**
 * Momentum stays *integer* on purpose. The 3D view renders an overshooting
 * arc, but the landing tile is computed here with the same arithmetic on every
 * device — a physics solver would desync peers within a handful of rounds.
 */

export const enabled = (config: MatchConfig): boolean => config.modules.includes("momentum")

/** A link's length converted into carry-over speed for the next move. */
export const gainFromLink = (config: MatchConfig, span: number): number =>
  enabled(config) ? Math.floor(Math.abs(span) / config.size) : 0

/** Momentum bleeds off rather than compounding without limit. */
export const decay = (carried: number, gained: number): number =>
  Math.max(gained, Math.floor(carried / 2))

export interface Landing {
  readonly tile: number
  readonly bounced: boolean
}

/**
 * Walk `steps` from `from`. Overshooting the final tile bounces back off it
 * when the match demands an exact finish, and clamps when it does not.
 */
export const advance = (config: MatchConfig, from: number, steps: number): Landing => {
  const top = lastTile(config.size)
  const raw = from + steps
  if (raw <= top) return { tile: Math.max(0, raw), bounced: false }
  if (!config.exactFinish) return { tile: top, bounced: false }
  // Reflect off the top edge; repeat in case momentum overshot twice over.
  let pos = raw
  let bounced = false
  while (pos > top) {
    pos = top - (pos - top)
    bounced = true
  }
  return { tile: Math.max(0, pos), bounced }
}
