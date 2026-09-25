import { describe, expect, it } from "vitest"
import { joinState, SEARCH_GRACE_MS } from "../join-state"

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
