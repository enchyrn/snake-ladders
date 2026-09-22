import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import * as icons from "../icons"

const all = Object.entries(icons)

describe("the game's own glyphs", () => {
  it("draws all eight", () => {
    expect(all).toHaveLength(8)
  })

  // currentColor is the whole point: an emoji could not be tinted per seat,
  // and these have to sit on a board whose palette they must obey.
  it("inherits its colour rather than hard-coding one", () => {
    for (const [name, Icon] of all) {
      const html = renderToStaticMarkup(<Icon />)
      expect(html, name).toContain("currentColor")
      expect(html, name).not.toMatch(/#[0-9a-f]{3,6}/i)
    }
  })

  it("matches Lucide's 24-unit grid and 2px stroke", () => {
    for (const [name, Icon] of all) {
      const html = renderToStaticMarkup(<Icon />)
      expect(html, name).toContain('viewBox="0 0 24 24"')
      expect(html, name).toContain('stroke-width="2"')
    }
  })
})
