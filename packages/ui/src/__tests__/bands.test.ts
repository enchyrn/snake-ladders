import { describe, expect, it } from "vitest"
import { bands, BOARD_PX, CONTROLS_PX, HEADER_PX, LOG_LINE_PX } from "../layout/bands"

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

  it("matches the spec's worked numbers", () => {
    expect(bands(2, PHONE)).toMatchObject({ rows: 61, log: 235 })
    expect(bands(3, PHONE)).toMatchObject({ rows: 90, log: 206 })
    expect(bands(6, PHONE)).toMatchObject({ rows: 177, log: 119 })
  })

  // On a shorter screen the log gives way first and the board still does not.
  it("sacrifices the log before the board", () => {
    const short = bands(6, 700)
    expect(short.board).toBe(BOARD_PX)
    expect(short.log).toBe(0)
  })
})

// The band budget closes at 844. It does not close on every phone, and
// `bands` cannot say so: once the log is gone, `log: 0` means both "fits
// exactly" and "overflows by 58px". These pin the real numbers so the limit
// is visible to whoever lays the bands out, and so a constant that made it
// worse would fail here rather than on someone's handset.
describe("where the budget stops closing", () => {
  const FIXED = HEADER_PX + BOARD_PX + CONTROLS_PX
  const required = (players: number) => FIXED + bands(players, 0).rows

  it("costs 548px before a single player row", () => {
    expect(FIXED).toBe(548)
  })

  // 375x667: iPhone SE and iPhone 8, and that is before browser chrome.
  it.each([
    [2, 609],
    [3, 638],
    [4, 667],
    [5, 696],
    [6, 725],
  ])("needs %ipx of viewport for %i players", (players, total) => {
    expect(required(players)).toBe(total)
  })

  it("overflows a 667px phone at five players and above", () => {
    const overflowing = [2, 3, 4, 5, 6].filter((p) => required(p) > 667)
    expect(overflowing).toEqual([5, 6])
  })

  // 360x740 is a Galaxy S8. Six players leaves 15px, which is not one line.
  it("cannot show even one log line at 740px with six players", () => {
    expect(bands(6, 740).log).toBeLessThan(LOG_LINE_PX)
  })
})
