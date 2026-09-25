import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch, newPlayer } from "@mutation/engine/match"
import { defaultConfig, type MatchState, type Player } from "@mutation/engine/types"
import { ProgressRows } from "../HUD"

const withPlayers = (positions: ReadonlyArray<number>): MatchState => {
  const base = initialMatch(defaultConfig(4242))
  return {
    ...base,
    players: positions.map((position, seat) => ({
      ...newPlayer(`p${seat}`, `P${seat}`, seat),
      position,
    })),
  }
}

// One player, seat 0, with the given fields overridden onto engine defaults —
// so a row that only sets `venom` still has a well-formed `connected`,
// `anchored`, etc. rather than `undefined`.
const withPlayer = (overrides: Partial<Player>): MatchState => {
  const base = initialMatch(defaultConfig(4242))
  return {
    ...base,
    players: [{ ...newPlayer("p0", "P0", 0), ...overrides }],
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

  // The attribute alone is a test hook, not something a player can see — the
  // acting row also gets a chevron neither colour nor a screen reader misses.
  it("marks whose turn it is with a visible cue, not colour alone", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([1, 1])} actingSeat="p1" />)
    expect(html).toContain('data-acting="true"')
    const rows = html.split("<li").slice(1).map((rest) => `<li${rest}`)
    expect(rows).toHaveLength(2)
    const actingRow = rows.find((row) => row.includes('data-acting="true"'))
    const restingRow = rows.find((row) => row.includes('data-acting="false"'))
    expect(actingRow).toContain("lucide-chevron-right")
    expect(restingRow).not.toContain("lucide-chevron-right")
  })

  it("shows venom, with its balance, only while a player is carrying any", () => {
    const carrying = renderToStaticMarkup(<ProgressRows state={withPlayer({ venom: 5 })} actingSeat="p0" />)
    expect(carrying).toContain('aria-label="5 venom"')

    const clean = renderToStaticMarkup(<ProgressRows state={withPlayer({ venom: 0 })} actingSeat="p0" />)
    expect(clean).not.toContain("venom")
  })

  it("shows momentum, with its count, only while a player is carrying any", () => {
    const carrying = renderToStaticMarkup(<ProgressRows state={withPlayer({ momentum: 2 })} actingSeat="p0" />)
    expect(carrying).toContain('aria-label="2 momentum"')

    const clean = renderToStaticMarkup(<ProgressRows state={withPlayer({ momentum: 0 })} actingSeat="p0" />)
    expect(clean).not.toContain("momentum")
  })

  it("shows an anchor marker only while a player is anchored", () => {
    const anchored = renderToStaticMarkup(<ProgressRows state={withPlayer({ anchored: true })} actingSeat="p0" />)
    expect(anchored).toContain('aria-label="anchored"')

    const free = renderToStaticMarkup(<ProgressRows state={withPlayer({ anchored: false })} actingSeat="p0" />)
    expect(free).not.toContain('aria-label="anchored"')
  })

  it("shows a stun marker only while a player is sitting out", () => {
    const stunned = renderToStaticMarkup(<ProgressRows state={withPlayer({ stunned: 1 })} actingSeat="p0" />)
    expect(stunned).toContain('aria-label="sitting out"')

    const active = renderToStaticMarkup(<ProgressRows state={withPlayer({ stunned: 0 })} actingSeat="p0" />)
    expect(active).not.toContain('aria-label="sitting out"')
  })

  it("marks a finished player the way the old strip did, without relying on emoji", () => {
    const finished = renderToStaticMarkup(
      <ProgressRows state={withPlayer({ finishedAtRound: 3 })} actingSeat="p0" />,
    )
    expect(finished).toContain("c_finish")

    const racing = renderToStaticMarkup(<ProgressRows state={withPlayer({ finishedAtRound: null })} actingSeat="p0" />)
    expect(racing).not.toContain("c_finish")
  })

  it("marks a disconnected player as away, dimmed and struck through", () => {
    const away = renderToStaticMarkup(<ProgressRows state={withPlayer({ connected: false })} actingSeat="p0" />)
    expect(away).toContain("op_0.35")
    expect(away).toContain("td_line-through")

    const present = renderToStaticMarkup(<ProgressRows state={withPlayer({ connected: true })} actingSeat="p0" />)
    expect(present).not.toContain("op_0.35")
    expect(present).not.toContain("td_line-through")
  })
})
