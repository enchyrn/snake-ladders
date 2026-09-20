import { describe, expect, it } from "vitest"
import { hueOf, RESERVED_LINK_HUE, seatColours } from "../palette"

describe("hueOf", () => {
  it("reads the hue of a hex colour", () => {
    expect(Math.round(hueOf("#ff0000"))).toBe(0)
    expect(Math.round(hueOf("#00ff00"))).toBe(120)
    expect(Math.round(hueOf("#0000ff"))).toBe(240)
  })
})

describe("seat colours", () => {
  // renderer-legibility reserves the green family for link tinting, so a seat
  // in that band is indistinguishable from the snakes it has to be read against.
  it("keeps every seat out of the reserved link-tint band", () => {
    const [low, high] = RESERVED_LINK_HUE
    const offenders = seatColours.filter((hex) => {
      const hue = hueOf(hex)
      return hue >= low && hue <= high
    })

    expect(offenders).toEqual([])
  })

  it("has one colour per seat, for a match capped at six players", () => {
    expect(seatColours).toHaveLength(6)
  })
})
