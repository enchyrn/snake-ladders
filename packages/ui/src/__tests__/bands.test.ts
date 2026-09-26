import { describe, expect, it } from "vitest"
import { bands, BOARD_PX, LOG_LINE_PX, SWITCHER_ROW_PX } from "../layout/bands"

const PHONE = 844

describe("the match screen's band budget", () => {
  // match.ts:195 caps a match at six players, so the worst case is bounded and
  // the board never has to give way. That is the whole claim.
  it.each([2, 3, 4, 5, 6])("keeps the board at its full size with %i players", (players) => {
    expect(bands(players, PHONE).board).toBe(BOARD_PX)
  })

  it.each([2, 3, 4, 5, 6])("leaves room for two log lines with %i players", (players) => {
    expect(bands(players, PHONE).log).toBeGreaterThanOrEqual(2 * LOG_LINE_PX)
  })

  // Rederived from the real, driven-app CONTROLS_PX (139, see bands.ts) —
  // the design doc's worked table used the original 130 estimate, not a
  // measurement, and Task 9's carried finding is what corrected it.
  it("matches the spec's worked numbers", () => {
    expect(bands(2, PHONE)).toMatchObject({ rows: 61, switcher: 0, log: 226 })
    expect(bands(3, PHONE)).toMatchObject({ rows: 90, switcher: 0, log: 197 })
    expect(bands(6, PHONE)).toMatchObject({ rows: 177, switcher: 0, log: 110 })
  })

  // On a shorter screen the log gives way first and the board still does not.
  it("sacrifices the log before the board", () => {
    const short = bands(6, 700)
    expect(short.board).toBe(BOARD_PX)
    expect(short.log).toBe(0)
  })

  // Simultaneous pass-and-play puts one button per local seat on screen. They
  // used to wrap inside the 52px header, which grew to ~170px at six seats,
  // squeezed the log to nothing and pushed the control bar over the board.
  // They are their own band now, and the budget has to carry it.
  describe("with the seat switcher", () => {
    it("budgets one 44px row of switcher buttons plus its padding", () => {
      expect(bands(6, PHONE, 1).switcher).toBe(SWITCHER_ROW_PX + 8)
    })

    it.each([2, 3, 4, 5, 6])("keeps the board at its full size with %i local seats", (players) => {
      expect(bands(players, PHONE, 1).board).toBe(BOARD_PX)
    })

    it.each([2, 3, 4, 5, 6])("still leaves two log lines with %i local seats", (players) => {
      expect(bands(players, PHONE, 1).log).toBeGreaterThanOrEqual(2 * LOG_LINE_PX)
    })

    it("takes its height from the log, not the board", () => {
      const without = bands(6, PHONE)
      const withSwitcher = bands(6, PHONE, 1)
      expect(withSwitcher.board).toBe(without.board)
      expect(without.log - withSwitcher.log).toBe(withSwitcher.switcher)
      expect(withSwitcher).toMatchObject({ switcher: 52, log: 58 })
    })

    it("sacrifices the log before the board on a short screen", () => {
      const short = bands(6, 740, 1)
      expect(short.board).toBe(BOARD_PX)
      expect(short.log).toBe(0)
    })
  })
})
