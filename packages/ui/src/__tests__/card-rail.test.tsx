import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch, newPlayer } from "@mutation/engine/match"
import { defaultConfig } from "@mutation/engine/types"
import { CardRail, ControlBar, DiceTray } from "../HUD"

// `initialMatch` starts with an empty roster — players join via a `Join`
// action, not at construction — so the brief's `state().players[0]!` is
// `undefined` at runtime despite the non-null assertion. Seat one player the
// way progress-rows.test.tsx does.
const state = () => {
  const base = initialMatch({ ...defaultConfig(11), modules: ["mutation", "minesweeper"] })
  return { ...base, players: [newPlayer("p0", "P0", 0)] }
}

describe("CardRail", () => {
  // A card that cannot be afforded used to be indistinguishable from one that
  // is not there. ADR 0020: a state change the player is not shown is a defect.
  it("keeps an unaffordable card on screen, disabled", () => {
    const me = { ...state().players[0]!, venom: 0 }
    const html = renderToStaticMarkup(
      <CardRail me={me} state={state()} onPlay={() => {}} disabled={false} />,
    )
    expect(html.match(/<button/g)).toHaveLength(5)
    expect(html).toContain("disabled")
  })

  // The cost is drawn as a venom glyph plus a digit; without a word for the
  // glyph a screen reader announced "anchor 1".
  it("names each card's cost with its unit", () => {
    const me = { ...state().players[0]!, venom: 0 }
    const html = renderToStaticMarkup(
      <CardRail me={me} state={state()} onPlay={() => {}} disabled={false} />,
    )
    const buttons = html.split("<button").slice(1)
    expect(buttons).toHaveLength(5)
    for (const card of buttons) expect(card).toMatch(/\d<span class="[^"]*sr_true[^"]*"> venom<\/span>/)
  })

  // The control bar used to squeeze the rail into a shared row with the dice
  // tray and Roll, driving every card under the 44px tap minimum (~26px at
  // phone width) — this only checks the static half of that regression: every
  // card still carries the button recipe's `size: "sm"` variant, which is
  // what applies `minHeight: tap` (44px). The width half (each card actually
  // getting the rail's full row) is a real layout computation
  // `renderToStaticMarkup` cannot see; that is covered by driving the built
  // app and reading the control bar's rendered widths (see task-8-report.md).
  it("gives every card the recipe's tap-height size variant", () => {
    const me = { ...state().players[0]!, venom: 0 }
    const html = renderToStaticMarkup(
      <CardRail me={me} state={state()} onPlay={() => {}} disabled={false} />,
    )
    const buttons = html.match(/<button[^>]*>/g) ?? []
    expect(buttons).toHaveLength(5)
    for (const button of buttons) {
      expect(button).toContain("btn--size_sm")
    }
  })
})

describe("DiceTray", () => {
  // The tray is what lets plan 2 offer rollButton: hidden. If it is not a real
  // button, hiding Roll removes the only keyboard route to Commit.
  it("is a real button, not a canvas hit target", () => {
    const html = renderToStaticMarkup(<DiceTray onRoll={() => {}} disabled={false} />)
    expect(html).toContain("<button")
    expect(html).toContain("aria-label")
  })
})

describe("ControlBar", () => {
  // Sharing one row between the five cards, the dice tray and Roll crushed
  // every card under the 44px tap minimum (~26px at phone width). The fix is
  // two *separate* row containers — the cards' own row closes before the
  // tray/Roll row opens — not just "the tray happens to render after the
  // cards" or "the cards render at all", which the `size: "sm"` check above
  // is blind to. This is the static half of that regression a real browser
  // layout still has to confirm (the row containers exist; whether they
  // still render at a legible width is a flex computation
  // `renderToStaticMarkup` cannot perform — see task-8-report.md for the
  // driven-app measurements).
  it("puts the cards and the roll controls in separate row containers", () => {
    const me = { ...state().players[0]!, venom: 0 }
    const html = renderToStaticMarkup(
      <ControlBar
        me={me}
        state={state()}
        onPlay={() => {}}
        cardsDisabled={false}
        onRoll={() => {}}
        rollDisabled={false}
      >
        <button type="button">Roll</button>
      </ControlBar>,
    )

    // The dice tray's button must be the first thing inside a *fresh* <div>
    // — i.e. the cards' own row div closed (`</div>`) immediately before a
    // new row div opened — rather than sitting as a direct sibling of the
    // card buttons inside one shared row.
    expect(html).toMatch(/<\/div><div[^>]*><button[^>]*aria-label="Roll the dice"/)

    // Sanity: both rows are actually present with their expected buttons,
    // so the regex above isn't vacuously matching an unrelated div boundary.
    expect(html.match(/<button/g)).toHaveLength(7) // 5 cards + dice tray + the injected Roll child
    expect(html).toContain(">anchor<")
    expect(html).toContain('aria-label="Roll the dice"')
    expect(html).toContain(">Roll<")
  })
})
