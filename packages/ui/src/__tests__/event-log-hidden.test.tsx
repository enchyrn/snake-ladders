import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig } from "@mutation/engine/types"
import { EventLog } from "../EventLog"

describe("EventLog when the player has turned the log off", () => {
  // The naive implementation returns null, which removes the aria-live region
  // — turning a cosmetic toggle into an accessibility switch. Off means
  // visually hidden, not absent (ADR 0020 rule 2).
  it("hides it visually and leaves the live region in the tree", () => {
    const html = renderToStaticMarkup(
      <EventLog state={initialMatch(defaultConfig(3))} mode="preview" visible={false} />,
    )
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toBe("")
  })

  // The case above already held before `visible` existed, since the preview
  // was always live — so it cannot tell "hidden" from "ignored the prop".
  // This one can: off must actually take the list off screen.
  it("applies the screen-reader-only class only when off", () => {
    const render = (visible: boolean) =>
      renderToStaticMarkup(<EventLog state={initialMatch(defaultConfig(3))} mode="preview" visible={visible} />)
    expect(render(false)).toMatch(/<ul[^>]*class="[^"]*sr_true/)
    expect(render(true)).not.toContain("sr_true")
  })
})
