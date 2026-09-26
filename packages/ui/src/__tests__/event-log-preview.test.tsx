import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchState } from "@mutation/engine/types"
import type { TimelineEvent } from "@mutation/engine/events"
import { EventLog } from "../EventLog"

const rolled = (n: number): TimelineEvent =>
  ({ _tag: "Rolled", playerId: "a", dice: [n], total: n, momentumBonus: 0 }) as TimelineEvent

const withTimeline = (): MatchState => ({
  ...initialMatch(defaultConfig(7)),
  timeline: [rolled(1), rolled(2), rolled(3), rolled(4)],
})

describe("EventLog", () => {
  // The preview shows two lines, but clips the rest visually rather than
  // dropping them: this list is the live region, and slicing it to two lines
  // meant a screen reader heard only the end of each round.
  it("keeps every line of the round inside the preview's live region", () => {
    const html = renderToStaticMarkup(<EventLog state={withTimeline()} mode="preview" />)
    expect(html).toMatch(/^<ul[^>]*aria-live="polite"/)
    expect(html.match(/<li/g)).toHaveLength(4)
    for (const n of [1, 2, 3, 4]) expect(html).toContain(`a rolled ${n}`)
  })

  // ADR 0020 rule 2: the preview is never taken out of the tree, so it is the
  // screen's one live region. The full log is for reading back; a second live
  // copy would announce every line twice while the sheet is open.
  it("is live in preview mode and plain in full mode", () => {
    const preview = renderToStaticMarkup(<EventLog state={withTimeline()} mode="preview" />)
    const full = renderToStaticMarkup(<EventLog state={withTimeline()} mode="full" />)
    expect(preview.match(/aria-live=/g)).toHaveLength(1)
    expect(full).not.toContain("aria-live")
  })

  it("renders the live region even before anything has been narrated", () => {
    const empty = { ...withTimeline(), timeline: [] }
    const html = renderToStaticMarkup(<EventLog state={empty} mode="preview" />)
    expect(html).toContain('aria-live="polite"')
  })
})
