import { describe, expect, it } from "vitest"
import { joinState, manualPlacement, promotedHint, SEARCH_GRACE_MS } from "../join-state"

describe("joinState", () => {
  it("is searching while the grace period is open and nothing has answered", () => {
    expect(joinState([], 0)).toBe("searching")
    expect(joinState([], SEARCH_GRACE_MS - 1)).toBe("searching")
  })

  // The state that does not exist today: after the grace period with no rooms,
  // the screen must say so rather than render nothing.
  it("gives up once the grace period closes", () => {
    expect(joinState([], SEARCH_GRACE_MS)).toBe("none")
  })

  it("shows rooms the moment any arrive, however early", () => {
    expect(joinState([{}], 0)).toBe("found")
    expect(joinState([{}], SEARCH_GRACE_MS * 10)).toBe("found")
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
})
