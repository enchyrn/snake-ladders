import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchState } from "@mutation/engine/types"
import { ProgressRows } from "../HUD"

const withPlayers = (positions: ReadonlyArray<number>): MatchState => {
  const base = initialMatch(defaultConfig(4242))
  return {
    ...base,
    players: positions.map((position, seat) => ({
      ...base.players[0]!,
      id: `p${seat}`,
      name: `P${seat}`,
      seat,
      position,
    })),
  }
}

describe("ProgressRows", () => {
  it("draws one row per player", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([10, 50])} actingSeat="p0" />)
    expect(html.match(/role="progressbar"/g)).toHaveLength(2)
  })

  // ADR 0020: the race is shown, not reported. A tile number on this row would
  // be the number game leaking back into the chrome it was removed from.
  it("shows the race rather than printing the tile", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([37])} actingSeat="p0" />)
    expect(html).not.toContain(">37<")
    expect(html).toContain('aria-valuenow="37"')
  })

  it("marks whose turn it is without relying on colour alone", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([1, 1])} actingSeat="p1" />)
    expect(html).toContain('data-acting="true"')
  })
})
