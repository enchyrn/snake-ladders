/**
 * Speed scales a clip's duration; the clamp is what keeps a beat visible. A
 * per-clip floor beats capping the multiplier, because long clips then speed
 * up fully while short ones cannot vanish — without it the shortest clip (a
 * one-step Moved, 225ms) would decide the cap for all of them.
 *
 * 150ms because `Scene.step` already clamps delta to 64ms, so a 150ms clip
 * renders at least three frames even on a phone dropping them. Below that a
 * causal beat can become one frame, which is a teleport (ADR 0020 rule 1).
 */
export const FLOOR_MS = 150

export const SPEEDS = { calm: 1, brisk: 1.5, quick: 2.5 } as const

export const effectiveDuration = (duration: number, speed: number): number =>
  Math.max(FLOOR_MS, duration / speed)
