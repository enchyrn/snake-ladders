import { describe, expect, it } from "vitest"
import { nextInt, nextRange, nextU32, seedFromString, seedRng, shuffle } from "../rng"

describe("rng", () => {
  it("produces the same stream for the same seed", () => {
    const draw = (seed: number) => {
      let st = seedRng(seed)
      return Array.from({ length: 32 }, () => {
        const [v, s] = nextU32(st)
        st = s
        return v
      })
    }
    expect(draw(12345)).toEqual(draw(12345))
    expect(draw(12345)).not.toEqual(draw(12346))
  })

  it("never mutates the state handed to it", () => {
    const st = seedRng(7)
    const snapshot = [...st]
    nextU32(st)
    nextInt(st, 6)
    shuffle(st, [1, 2, 3, 4])
    expect([...st]).toEqual(snapshot)
  })

  it("stays inside the requested bounds", () => {
    let st = seedRng(99)
    for (let i = 0; i < 5000; i++) {
      const [v, s] = nextRange(st, 1, 6)
      st = s
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  it("covers every face of a d6 without bias", () => {
    let st = seedRng(4)
    const counts = new Map<number, number>()
    for (let i = 0; i < 60_000; i++) {
      const [v, s] = nextRange(st, 1, 6)
      st = s
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6])
    // Each face should land within a few percent of 10,000.
    for (const n of counts.values()) expect(Math.abs(n - 10_000)).toBeLessThan(600)
  })

  it("hashes room codes into stable seeds", () => {
    expect(seedFromString("MUTATE")).toBe(seedFromString("MUTATE"))
    expect(seedFromString("MUTATE")).not.toBe(seedFromString("MUTATF"))
  })

  it("shuffles into a permutation, not a new set", () => {
    const input = Array.from({ length: 50 }, (_, i) => i)
    const [out] = shuffle(seedRng(3), input)
    expect(out.slice().sort((a, b) => a - b)).toEqual(input)
    expect(out).not.toEqual(input)
  })
})
