import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch, newPlayer } from "@mutation/engine/match"
import { defaultConfig } from "@mutation/engine/types"
import { CardRail, DiceTray } from "../HUD"

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
