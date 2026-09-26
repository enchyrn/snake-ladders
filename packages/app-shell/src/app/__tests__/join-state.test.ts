import { describe, expect, it } from "vitest"
import { joinState, manualPlacement, promotedHint, SEARCH_GRACE_MS } from "../join-state"

describe("joinState", () => {
  it("is searching while the grace period is open and nothing has answered", () => {
    expect(joinState([], true, 0)).toBe("searching")
    expect(joinState([], true, SEARCH_GRACE_MS - 1)).toBe("searching")
  })

  // The state that does not exist today: after the grace period with no rooms,
  // the screen must say so rather than render nothing.
  it("gives up once the grace period closes", () => {
    expect(joinState([], true, SEARCH_GRACE_MS)).toBe("none")
  })

  // A browser has no UDP, so its discovery is a no-op that can never find a
  // room. Four seconds of "Looking for games…" followed by blaming the Wi-Fi
  // was a wait for an answer that was never coming.
  it("does not search at all where this build cannot discover rooms", () => {
    expect(joinState([], false, 0)).toBe("unavailable")
    expect(joinState([], false, SEARCH_GRACE_MS)).toBe("unavailable")
  })

  it("shows rooms the moment any arrive, however early", () => {
    expect(joinState([{}], true, 0)).toBe("found")
    expect(joinState([{}], true, SEARCH_GRACE_MS * 10)).toBe("found")
  })
})

describe("manualPlacement", () => {
  it("is always the open disclosure once rooms are found, arrival or not", () => {
    expect(manualPlacement("found", false)).toBe("disclosure")
    expect(manualPlacement("found", true)).toBe("disclosure")
  })

  it("hides the field while searching with nothing to fill it", () => {
    expect(manualPlacement("searching", false)).toBe("hidden")
  })

  it("promotes the field at once where there is no search to wait for", () => {
    expect(manualPlacement("unavailable", false)).toBe("promoted")
    expect(manualPlacement("unavailable", true)).toBe("promoted")
  })

  it("promotes the field once the search gives up, arrival or not", () => {
    expect(manualPlacement("none", false)).toBe("promoted")
    expect(manualPlacement("none", true)).toBe("promoted")
  })

  // The dead end this exists to fix: a scanned QR code already carries the
  // address, so it must not be stranded behind a wait that a guest with no
  // link would rightly sit through.
  it("promotes the field for an arrival even while still searching", () => {
    expect(manualPlacement("searching", true)).toBe("promoted")
  })
})

describe("promotedHint", () => {
  // A scanned code promotes the field while discovery is still running, and
  // "didn't show up automatically" sat directly under "Looking for games…" —
  // a verdict the search had not reached yet.
  it("does not announce a failed search while the search is still running", () => {
    const hint = promotedHint("searching", true)
    expect(hint).not.toMatch(/didn't show up/)
    expect(hint).toMatch(/code you scanned/)
    expect(hint).toMatch(/tap Join/)
  })

  it("says the code did not show up once the search has given up", () => {
    expect(promotedHint("none", true)).toMatch(/didn't show up automatically/)
  })

  it("points a guest with no code at the host's screen", () => {
    expect(promotedHint("none", false)).toMatch(/No games showed up/)
  })

  // Nothing searched, so nothing failed: the copy must not blame the network.
  it("does not blame the Wi-Fi where no search ran", () => {
    const hint = promotedHint("unavailable", false)
    expect(hint).not.toMatch(/showed up|same network/)
    expect(hint).toMatch(/host's screen/)
  })

  it("points an arrival at the scanned code where no search ran", () => {
    const hint = promotedHint("unavailable", true)
    expect(hint).not.toMatch(/didn't show up|wait a moment/)
    expect(hint).toMatch(/code you scanned/)
  })
})
