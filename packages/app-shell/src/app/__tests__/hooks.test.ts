import { describe, expect, it } from "vitest"
import { roomCode, seedFromRoom } from "../hooks"

describe("seedFromRoom", () => {
  it("round-trips every code roomCode can produce", () => {
    for (const seed of [0, 1, 30, 31, 12345, 31 ** 4 - 1]) {
      expect(seedFromRoom(roomCode(seed))).toBe(seed)
    }
  })

  it("refuses anything that is not exactly four valid characters", () => {
    // The room code IS the seed. A short code that decodes anyway builds a
    // different board with no desync banner, because every frame still parses.
    expect(seedFromRoom("ABC")).toBeNull()
    expect(seedFromRoom("ABCDE")).toBeNull()
    expect(seedFromRoom("")).toBeNull()
    expect(seedFromRoom("AB1D")).toBeNull() // 1 is not in the alphabet
    expect(seedFromRoom("AB D")).toBeNull()
  })

  it("still accepts the lower-case spelling a person types", () => {
    expect(seedFromRoom(roomCode(4242).toLowerCase())).toBe(4242)
  })
})
