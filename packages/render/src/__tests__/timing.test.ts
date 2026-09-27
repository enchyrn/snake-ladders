import { describe, expect, it } from "vitest"
import { effectiveDuration, FLOOR_MS, rescaleElapsed, SPEEDS } from "../timing"

/** Every clip `Scene.play` can push, at scene.ts:399. A clip added there
 *  without a row here is what this table exists to catch. */
const CLIPS = {
  Rolled: 700,
  "Moved (1 step)": 130 + 95,
  "Moved (3 steps)": 130 + 95 * 3,
  "Moved (max)": 1100,
  TookLink: 620,
  Knocked: 520,
  "MineTripped (absorbed)": 320,
  MineTripped: 640,
  Swapped: 520,
}

describe("effectiveDuration", () => {
  // A beat that renders in one frame is a teleport, and ADR 0020 rule 1 says
  // the causal beats stay separable at every speed.
  it.each(Object.entries(SPEEDS))("keeps every clip above the floor at %s", (_name, speed) => {
    for (const [clip, duration] of Object.entries(CLIPS)) {
      expect(effectiveDuration(duration, speed), clip).toBeGreaterThanOrEqual(FLOOR_MS)
    }
  })

  it("scales a long clip fully rather than clamping it", () => {
    expect(effectiveDuration(700, SPEEDS.quick)).toBe(280)
  })

  // The clamp, not a multiplier cap, is what makes `quick` safe: without it the
  // shortest clip would decide the cap for all of them.
  it("clamps the clips that would otherwise vanish", () => {
    expect(effectiveDuration(225, SPEEDS.quick)).toBe(FLOOR_MS)
    expect(effectiveDuration(320, SPEEDS.quick)).toBe(FLOOR_MS)
  })

  it("changes nothing at calm", () => {
    for (const duration of Object.values(CLIPS)) {
      expect(effectiveDuration(duration, SPEEDS.calm)).toBe(duration)
    }
  })

  it("never returns a duration a frame budget cannot render", () => {
    // step() clamps delta to 64ms, so the floor buys at least three frames.
    expect(FLOOR_MS / 64).toBeGreaterThanOrEqual(2)
  })
})

describe("rescaleElapsed", () => {
  const progress = (elapsed: number, duration: number, speed: number) =>
    elapsed / effectiveDuration(duration, speed)

  // Scene.step reads t live from elapsed / effectiveDuration, so a speed change
  // mid-clip that kept `elapsed` as it was made the token jump along its path —
  // backwards when slowing down.
  it.each([
    ["quick", "calm"],
    ["calm", "quick"],
    ["brisk", "calm"],
  ] as const)("keeps a clip where it was when speed goes %s -> %s", (from, to) => {
    for (const duration of Object.values(CLIPS)) {
      const elapsed = effectiveDuration(duration, SPEEDS[from]) * 0.6
      const next = rescaleElapsed(elapsed, duration, SPEEDS[from], SPEEDS[to])
      expect(progress(next, duration, SPEEDS[to])).toBeCloseTo(0.6, 9)
    }
  })

  it("holds progress across the floor, where only one side is clamped", () => {
    const next = rescaleElapsed(75, 225, SPEEDS.quick, SPEEDS.calm)
    expect(progress(75, 225, SPEEDS.quick)).toBe(0.5)
    expect(progress(next, 225, SPEEDS.calm)).toBeCloseTo(0.5, 9)
  })
})
