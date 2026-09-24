import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchState, type Player } from "@mutation/engine/types"
import { ProgressRows } from "../HUD"

const withPlayers = (overrides: ReadonlyArray<Partial<Player>>): MatchState => {
  const base = initialMatch(defaultConfig(4242))
  return {
    ...base,
    players: overrides.map((over, seat) => ({
      ...base.players[0]!,
      id: `p${seat}`,
      name: `P${seat}`,
      seat,
      ...over,
    })),
  }
}

const at = (positions: ReadonlyArray<number>) => withPlayers(positions.map((position) => ({ position })))

describe("ProgressRows", () => {
  it("draws one row per player", () => {
    const html = renderToStaticMarkup(<ProgressRows state={at([10, 50])} actingSeat="p0" />)
    expect(html.match(/role="progressbar"/g)).toHaveLength(2)
  })

  // ADR 0020: the race is shown, not reported. A tile number on this row would
  // be the number game leaking back into the chrome it was removed from.
  it("shows the race rather than printing the tile", () => {
    const html = renderToStaticMarkup(<ProgressRows state={at([37])} actingSeat="p0" />)
    expect(html).not.toContain(">37<")
    expect(html).toContain('aria-valuenow="37"')
  })

  it("marks whose turn it is without relying on colour alone", () => {
    const html = renderToStaticMarkup(<ProgressRows state={at([1, 1])} actingSeat="p1" />)
    expect(html).toContain('data-acting="true"')
  })
})

// PlayerStrip carried six pieces of player state that the spec's row
// (swatch, name, bar) drops, and nothing in Tasks 8-14 restores them. Venom is
// the sharp one: Task 8 prices cards in venom, so a player would read "costs 2"
// with no way to see they hold 1. Carried onto the row instead, as the Task 5
// glyphs, on the owner's call.
describe("the state PlayerStrip used to carry", () => {
  it("shows venom when the player has any", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([{ venom: 3 }])} actingSeat="p0" />)
    expect(html).toContain('data-venom="3"')
  })

  it("says nothing about venom at zero, rather than showing a zero", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([{ venom: 0 }])} actingSeat="p0" />)
    expect(html).not.toContain("data-venom")
  })

  it.each([
    ["momentum", { momentum: 2 }, "data-momentum"],
    ["anchored", { anchored: true }, "data-anchored"],
    ["stunned", { stunned: 1 }, "data-stunned"],
  ])("shows %s", (_label, over, attr) => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([over])} actingSeat="p0" />)
    expect(html).toContain(attr)
  })

  // A dropped player freezing a round is a defect this repo has already fixed
  // once; the HUD must not go quiet about who is gone.
  it("marks a disconnected player", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([{ connected: false }])} actingSeat="p0" />)
    expect(html).toContain('data-away="true"')
  })

  it("marks a player who has finished", () => {
    const html = renderToStaticMarkup(
      <ProgressRows state={withPlayers([{ finishedAtRound: 4 }])} actingSeat="p0" />,
    )
    expect(html).toContain('data-done="true"')
  })

  // Every badge is an inline SVG from the icon set, never an emoji in a text
  // node: that was the whole point of Task 5.
  it("uses the drawn glyphs rather than emoji", () => {
    const html = renderToStaticMarkup(
      <ProgressRows
        state={withPlayers([{ venom: 1, momentum: 1, anchored: true, stunned: 1 }])}
        actingSeat="p0"
      />,
    )
    expect(html.match(/<svg/g)).toHaveLength(4)
    expect(html).not.toMatch(/[☣»⚓💤]/)
  })
})
