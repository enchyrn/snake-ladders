import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchState } from "@mutation/engine/types"
import type { TimelineEvent } from "@mutation/engine/events"
import { RoundLogSheet } from "../RoundLogSheet"

const rolled = (n: number): TimelineEvent =>
  ({ _tag: "Rolled", playerId: "a", dice: [n], total: n, momentumBonus: 0 }) as TimelineEvent

const match = (modules: MatchState["config"]["modules"]): MatchState => {
  const base = initialMatch({ ...defaultConfig(7), modules })
  return { ...base, timeline: [rolled(1), rolled(2), rolled(3)] }
}

const render = (state: MatchState) => renderToStaticMarkup(<RoundLogSheet state={state} onClose={() => {}} />)

describe("RoundLogSheet", () => {
  // Focus moving in and back, Escape and the inert background are behaviour a
  // static render cannot see; the driven app checks those. This pins the
  // markup a screen reader needs to know it is in a modal and what it is.
  it("is a named modal dialog", () => {
    const html = render(match([]))
    expect(html).toMatch(/^<div role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/)
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1]
    expect(html).toContain(`<h2 id="${id}"`)
    expect(html).toContain(">Round log</h2>")
    expect(html).toContain('aria-label="Close round log"')
  })

  it("shows the whole round", () => {
    expect(render(match([])).match(/<li/g)).toHaveLength(3)
  })

  // The preview underneath stays the one live region; this copy is for
  // reading back, and a live one would announce every line a second time.
  it("adds no live region of its own", () => {
    expect(render(match(["minesweeper"]))).not.toContain("aria-live")
  })

  // Spec: once the first tile is revealed the legend leaves the board and
  // "retires to the round-log sheet", so the key is still one tap away.
  it("carries the minefield key when minesweeper is on, and only then", () => {
    expect(render(match(["minesweeper"]))).toContain('aria-label="Minefield key"')
    expect(render(match([]))).not.toContain("Minefield key")
  })
})
