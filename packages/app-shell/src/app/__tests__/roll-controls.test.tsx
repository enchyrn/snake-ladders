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

  const render = (rollButton: "hidden" | "left" | "right", armed = false) =>
    renderToStaticMarkup(<RollControls rollButton={rollButton} disabled={false} onRoll={() => {}} armed={armed} />)

  it("puts the button on the side asked for", () => {
    const left = render("left")
    expect(left.indexOf(">Roll</button>")).toBeLessThan(left.indexOf("Roll the dice"))
    const right = render("right")
    expect(right.indexOf("Roll the dice")).toBeLessThan(right.indexOf(">Roll</button>"))
  })

  it("leaves only the tray when Roll is hidden", () => {
    const html = render("hidden")
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Roll the dice"')
    expect(html).not.toContain(">Roll</button>")
  })

  // Roll is `flex: none`, so a second visible "Confirm roll" in the tray beside
  // it pushed Roll 28px past a 320px viewport. With Roll shown, Roll carries
  // the armed text and the tray only its accessible name.
  it.each(["left", "right"] as const)("draws the armed text once, on Roll, with rollButton=%s", (rollButton) => {
    const html = render(rollButton, true)
    expect(html.match(/>Confirm roll</g)).toHaveLength(1)
    expect(html).toContain(">Confirm roll</button>")
    expect(html).toContain('aria-label="Confirm roll"')
  })

  it("draws the armed text on the tray when it stands alone", () => {
    expect(render("hidden", true)).toContain(">Confirm roll</span>")
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
