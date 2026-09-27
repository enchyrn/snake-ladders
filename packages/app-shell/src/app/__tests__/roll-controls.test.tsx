import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RollControls } from "../../routes/match"

describe("RollControls", () => {
  // RollButton was the only keyboard-reachable path to Commit, and Scene.pick
  // raycasts the board plane only — so hiding Roll without the tray being a
  // real button would take the turn away from anyone who cannot use a pointer.
  it.each(["hidden", "left", "right"] as const)(
    "always leaves a focusable control that can commit, with rollButton=%s",
    (rollButton) => {
      const html = renderToStaticMarkup(
        <RollControls rollButton={rollButton} disabled={false} onRoll={() => {}} />,
      )
      expect(html.match(/<button/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(html).not.toContain("disabled")
    },
  )

  it("puts the button on the side asked for", () => {
    const left = renderToStaticMarkup(
      <RollControls rollButton="left" disabled={false} onRoll={() => {}} />,
    )
    expect(left.indexOf("Roll")).toBeLessThan(left.indexOf("Roll the dice"))
  })

  // Both controls share one confirm path, so an arm taken on either has to
  // read as armed on both — including the tray, alone when Roll is hidden.
  it("names every roll control 'Confirm roll' once armed", () => {
    const shown = renderToStaticMarkup(
      <RollControls rollButton="right" disabled={false} onRoll={() => {}} armed />,
    )
    expect(shown).toContain('aria-label="Confirm roll"')
    expect(shown).toContain(">Confirm roll</button>")
    const hidden = renderToStaticMarkup(
      <RollControls rollButton="hidden" disabled={false} onRoll={() => {}} armed />,
    )
    expect(hidden).toContain('aria-label="Confirm roll"')
    expect(hidden).not.toContain("Roll the dice")
  })
})
