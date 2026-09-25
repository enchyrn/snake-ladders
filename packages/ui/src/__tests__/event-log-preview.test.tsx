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
  it("shows the last two lines in preview mode", () => {
    const html = renderToStaticMarkup(<EventLog state={withTimeline()} mode="preview" />)
    expect(html.match(/<li/g)).toHaveLength(2)
  })

  // ADR 0020 rule 2: this list is how a screen-reader player receives a round
  // at all, so no mode may take it out of the tree.
  it("keeps the live region in every mode", () => {
    for (const mode of ["preview", "full"] as const) {
      const html = renderToStaticMarkup(<EventLog state={withTimeline()} mode={mode} />)
      expect(html, mode).toContain('aria-live="polite"')
    }
  })
})
