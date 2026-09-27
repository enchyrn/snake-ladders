import { describe, expect, it } from "vitest"
import { motionLevel } from "../timing"

describe("motionLevel", () => {
  // The OS preference sets the default, it does not override the player: an
  // accessibility setting nobody can escape is its own kind of hostility.
  it("follows the system when the player has expressed no choice", () => {
    expect(motionLevel("system", true)).toBe("reduced")
    expect(motionLevel("system", false)).toBe("full")
  })

  it("lets an explicit choice win in both directions", () => {
    expect(motionLevel("off", true)).toBe("full")
    expect(motionLevel("on", false)).toBe("reduced")
  })
})
