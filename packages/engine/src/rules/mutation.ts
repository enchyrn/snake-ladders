import { nextInt, type RngState } from "../rng"
import { lastTile } from "../board"
import type { Board, Link, MatchConfig } from "../types"

/**
 * The mutation module: ladders are consumable, snakes pay out venom, and the
 * board periodically rearranges itself. Every rearrangement is drawn from
 * match RNG, so peers agree on the new layout without exchanging a board.
 */

export const enabled = (config: MatchConfig): boolean => config.modules.includes("mutation")

/** Venom scales with how far the snake dropped you. */
export const venomForBite = (config: MatchConfig, span: number): number =>
  enabled(config) ? 1 + Math.floor(Math.abs(span) / config.size) : 0

/**
 * A worn-out ladder does not vanish — it inverts into a snake along the same
 * span, so the geometry players memorised turns against them.
 */
export const collapse = (link: Link): Link => ({
  ...link,
  kind: "snake",
  from: link.to,
  to: link.from,
  uses: 0,
  maxUses: Number.MAX_SAFE_INTEGER,
})

export const isSpent = (link: Link): boolean =>
  link.kind === "ladder" && link.uses >= link.maxUses

export const shouldBreathe = (config: MatchConfig, round: number): boolean =>
  enabled(config) && round > 0 && round % config.mutationInterval === 0

/**
 * "The board breathes": relocate a couple of links onto free tiles. Occupied
 * tiles and existing endpoints are avoided so the no-chaining invariant that
 * keeps resolution loop-free still holds afterwards.
 */
export const breathe = (
  board: Board,
  config: MatchConfig,
  occupied: ReadonlySet<number>,
  rng: RngState,
): readonly [Board, string[], RngState] => {
  const top = lastTile(config.size)
  let cur = rng
  const moved: string[] = []
  const links = board.links.slice()
  const endpoints = new Set<number>()
  for (const l of links) {
    endpoints.add(l.from)
    endpoints.add(l.to)
  }

  const free: number[] = []
  for (let t = 2; t < top; t++) {
    if (!endpoints.has(t) && !occupied.has(t)) free.push(t)
  }

  const relocations = Math.min(2, links.length, Math.floor(free.length / 2))
  for (let i = 0; i < relocations; i++) {
    const [pick, s1] = nextInt(cur, links.length)
    cur = s1
    const link = links[pick]!
    if (moved.includes(link.id)) continue

    const [slot, s2] = nextInt(cur, free.length)
    cur = s2
    const anchor = free[slot]!
    const span = Math.abs(link.to - link.from)
    const partner = link.kind === "ladder" ? anchor + span : anchor - span
    if (partner <= 1 || partner >= top || endpoints.has(partner) || occupied.has(partner)) continue
    // A previous relocation in this same call added its endpoints to
    // `endpoints` but only took its anchor out of `free`, so both of its
    // tiles could still be drawn here.
    if (endpoints.has(anchor)) continue

    endpoints.delete(link.from)
    endpoints.delete(link.to)
    endpoints.add(anchor)
    endpoints.add(partner)
    // Drop the higher index first so the lower one does not shift.
    const partnerSlot = free.indexOf(partner)
    for (const s of [slot, partnerSlot].filter((s) => s >= 0).sort((a, b) => b - a)) {
      free.splice(s, 1)
    }

    links[pick] = { ...link, from: anchor, to: partner }
    moved.push(link.id)
  }

  return [{ ...board, links }, moved, cur] as const
}
