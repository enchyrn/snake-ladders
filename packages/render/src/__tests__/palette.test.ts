import { describe, expect, it } from "vitest"
import { hueOf, playerColours, RESERVED_LINK_HUE, seatColours } from "../palette"

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

describe("playerColours", () => {
  const [cyan, coral, amber, violet, teal, pink] = seatColours
  const player = (id: string, seat: number, colour?: string) =>
    colour === undefined ? { id, seat } : { id, seat, colour }

  it("draws a player with no pick in their seat's colour", () => {
    const colours = playerColours([player("a", 0), player("b", 1)])
    expect(colours.get("a")).toBe(cyan)
    expect(colours.get("b")).toBe(coral)
  })

  it("keeps a pick from the palette", () => {
    const colours = playerColours([player("a", 0, violet), player("b", 1)])
    expect(colours.get("a")).toBe(violet)
    expect(colours.get("b")).toBe(coral)
  })

  // Log order, not seat order, is what every device agrees on for who asked first.
  it("gives a contested pick to the earlier player, and the later one falls back", () => {
    const colours = playerColours([player("b", 1, pink), player("a", 0, pink)])
    expect(colours.get("b")).toBe(pink)
    expect(colours.get("a")).toBe(cyan)
  })

  // The wire carries any string; only the palette is clear of the link band.
  it("ignores a pick outside the palette, green included", () => {
    const colours = playerColours([player("a", 0, "#4ee39b"), player("b", 1, "not a colour")])
    expect(colours.get("a")).toBe(cyan)
    expect(colours.get("b")).toBe(coral)
  })

  it("gives a free colour to a player whose seat colour someone else picked", () => {
    const colours = playerColours([player("a", 0), player("b", 1, cyan)])
    // Coral is b's seat colour, and b is not using it.
    expect(colours.get("b")).toBe(cyan)
    expect(colours.get("a")).toBe(coral)
  })

  // Otherwise a fallback earlier in the list takes a later player's seat colour
  // and bumps them too, and one pick repaints three tokens instead of two.
  it("never hands one player's seat colour to another player's fallback", () => {
    const colours = playerColours([player("a", 0), player("b", 1), player("c", 2, cyan)])
    expect(colours.get("c")).toBe(cyan)
    expect(colours.get("b")).toBe(coral)
    expect(colours.get("a")).toBe(amber)
  })

  it("gives six players six distinct colours, whatever they picked", () => {
    const picks = [cyan, cyan, teal, undefined, "#123456", amber]
    for (let shift = 0; shift < 6; shift++) {
      const players = picks.map((_, i) => player(`p${i}`, i, picks[(i + shift) % 6]))
      const colours = playerColours(players)
      expect(new Set(players.map((p) => colours.get(p.id))).size).toBe(6)
      for (const p of players) expect(seatColours).toContain(colours.get(p.id))
    }
  })
})
