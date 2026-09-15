import { describe, expect, it } from "vitest"
import { cellToTile, generateBoard, lastTile, linkAt, neighbours, revealFrom, tileToCell } from "../board"
import { seedRng } from "../rng"
import { defaultConfig, type MatchConfig } from "../types"

const config = (over: Partial<MatchConfig> = {}): MatchConfig => ({ ...defaultConfig(2024), ...over })

describe("board geometry", () => {
  it("numbers tiles boustrophedon-style", () => {
    // Bottom row runs left to right, the row above runs right to left.
    expect(tileToCell(1, 10)).toEqual({ row: 0, col: 0 })
    expect(tileToCell(10, 10)).toEqual({ row: 0, col: 9 })
    expect(tileToCell(11, 10)).toEqual({ row: 1, col: 9 })
    expect(tileToCell(20, 10)).toEqual({ row: 1, col: 0 })
    expect(tileToCell(100, 10)).toEqual({ row: 9, col: 0 })
  })

  it("round-trips tiles through grid cells", () => {
    for (let t = 1; t <= 100; t++) expect(cellToTile(tileToCell(t, 10), 10)).toBe(t)
  })

  it("gives corner tiles three neighbours and interior tiles eight", () => {
    expect(neighbours(1, 10)).toHaveLength(3)
    expect(neighbours(100, 10)).toHaveLength(3)
    expect(neighbours(45, 10)).toHaveLength(8)
  })

  it("keeps adjacency symmetric", () => {
    for (let t = 1; t <= 100; t++) {
      for (const n of neighbours(t, 10)) expect(neighbours(n, 10)).toContain(t)
    }
  })
})

describe("board generation", () => {
  it("is a pure function of the seed", () => {
    const [a] = generateBoard(config(), seedRng(2024))
    const [b] = generateBoard(config(), seedRng(2024))
    const [c] = generateBoard(config({ seed: 7 }), seedRng(7))
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it("never links the start or finish tiles", () => {
    for (let seed = 0; seed < 60; seed++) {
      const [board] = generateBoard(config({ seed }), seedRng(seed))
      for (const l of board.links) {
        for (const t of [l.from, l.to]) {
          expect(t).toBeGreaterThan(1)
          expect(t).toBeLessThan(lastTile(board.size))
        }
      }
    }
  })

  it("never chains links, so a single roll cannot cascade forever", () => {
    for (let seed = 0; seed < 60; seed++) {
      const [board] = generateBoard(config({ seed }), seedRng(seed))
      for (const l of board.links) expect(linkAt(board, l.to)).toBeUndefined()
    }
  })

  it("points ladders up and snakes down", () => {
    for (let seed = 0; seed < 60; seed++) {
      const [board] = generateBoard(config({ seed }), seedRng(seed))
      for (const l of board.links) {
        if (l.kind === "ladder") expect(l.to).toBeGreaterThan(l.from)
        else expect(l.to).toBeLessThan(l.from)
      }
    }
  })

  it("counts adjacent mines correctly", () => {
    const [board] = generateBoard(config({ mineCount: 15 }), seedRng(2024))
    const mined = new Set(board.tiles.filter((t) => t.mined).map((t) => t.index))
    expect(mined.size).toBe(15)
    for (const tile of board.tiles.slice(1)) {
      const expected = neighbours(tile.index, board.size).filter((n) => mined.has(n)).length
      expect(tile.adjacentMines).toBe(expected)
    }
  })

  it("keeps mines off link endpoints and off the finish", () => {
    const [board] = generateBoard(config({ mineCount: 20 }), seedRng(11))
    const endpoints = new Set(board.links.flatMap((l) => [l.from, l.to]))
    for (const tile of board.tiles) {
      if (tile.mined) {
        expect(endpoints.has(tile.index)).toBe(false)
        expect(tile.index).toBeLessThan(lastTile(board.size))
      }
    }
  })

  it("places no mines when the module is off", () => {
    const [board] = generateBoard(config({ modules: ["mutation"] }), seedRng(1))
    expect(board.tiles.some((t) => t.mined)).toBe(false)
  })
})

describe("minesweeper reveal", () => {
  it("cascades out of a blank tile but stops at numbered ones", () => {
    const [board] = generateBoard(config({ mineCount: 8 }), seedRng(5))
    const blank = board.tiles.find((t) => t.index > 0 && !t.mined && t.adjacentMines === 0)!
    const [next, opened] = revealFrom(board, blank.index)
    expect(opened.length).toBeGreaterThan(1)
    // Every tile that cascaded further was itself blank.
    for (const t of opened) {
      const tile = next.tiles[t]!
      if (tile.adjacentMines > 0 || tile.mined) {
        expect(neighbours(t, board.size).some((n) => opened.includes(n))).toBe(true)
      }
    }
  })

  it("opens only the landing tile when it carries a number", () => {
    const [board] = generateBoard(config({ mineCount: 12 }), seedRng(6))
    const numbered = board.tiles.find((t) => t.index > 0 && !t.mined && t.adjacentMines > 0)!
    const [, opened] = revealFrom(board, numbered.index)
    expect(opened).toEqual([numbered.index])
  })

  it("leaves an already-revealed region untouched", () => {
    const [board] = generateBoard(config(), seedRng(9))
    const [once] = revealFrom(board, 34)
    const [twice, opened] = revealFrom(once, 34)
    expect(opened).toEqual([])
    expect(twice).toEqual(once)
  })
})
