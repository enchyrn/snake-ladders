/**
 * Deterministic PRNG (xoshiro128**), carried *inside* match state.
 *
 * Every device replays the same action log through the same reducer, so the
 * random stream must be a pure function of state — never of Math.random or of
 * wall-clock time. That is what lets the LAN transport ship a 20-byte action
 * per turn instead of a full board snapshot.
 */

export type RngState = readonly [number, number, number, number]

const u32 = (n: number): number => n >>> 0
const rotl = (x: number, k: number): number => u32((x << k) | (x >>> (32 - k)))

/** SplitMix32, used only to expand a single seed into the four xoshiro words. */
const splitmix32 = (seed: number): (() => number) => {
  let a = u32(seed)
  return () => {
    a = u32(a + 0x9e3779b9)
    let t = a
    t = u32(Math.imul(t ^ (t >>> 16), 0x21f0aaad))
    t = u32(Math.imul(t ^ (t >>> 15), 0x735a2d97))
    return u32(t ^ (t >>> 15))
  }
}

export const seedRng = (seed: number): RngState => {
  const next = splitmix32(seed)
  return [next(), next(), next(), next()]
}

/** Hash an arbitrary string (room code, player id) into a seed. */
export const seedFromString = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h = u32(h ^ s.charCodeAt(i))
    h = u32(Math.imul(h, 0x01000193))
  }
  return h
}

/** Advance the stream. Returns the drawn word and the successor state. */
export const nextU32 = (st: RngState): readonly [number, RngState] => {
  const [s0, s1, s2, s3] = st
  const result = u32(Math.imul(rotl(u32(Math.imul(s1, 5)), 7), 9))
  const t = u32(s1 << 9)
  let n2 = u32(s2 ^ s0)
  let n3 = u32(s3 ^ s1)
  const n1 = u32(s1 ^ n2)
  const n0 = u32(s0 ^ n3)
  n2 = u32(n2 ^ t)
  n3 = rotl(n3, 11)
  return [result, [n0, n1, n2, n3]] as const
}

/** Uniform integer in [0, bound). Rejection-sampled so it stays unbiased. */
export const nextInt = (st: RngState, bound: number): readonly [number, RngState] => {
  if (bound <= 0) throw new Error(`nextInt bound must be positive, got ${bound}`)
  // Deliberately NOT wrapped through u32: for a power-of-two bound the largest
  // usable multiple is 2**32 exactly, and wrapping it would give 0 — a rejection
  // limit nothing can fall under, i.e. an infinite loop.
  const limit = Math.floor(0x100000000 / bound) * bound
  let cur = st
  for (;;) {
    const [v, s] = nextU32(cur)
    cur = s
    if (v < limit) return [v % bound, cur] as const
  }
}

/** Inclusive range, the shape dice rolls actually want. */
export const nextRange = (
  st: RngState,
  min: number,
  max: number,
): readonly [number, RngState] => {
  const [v, s] = nextInt(st, max - min + 1)
  return [min + v, s] as const
}

/** Fisher-Yates over a copy. Used for board generation and mine placement. */
export const shuffle = <A>(st: RngState, xs: ReadonlyArray<A>): readonly [A[], RngState] => {
  const out = xs.slice()
  let cur = st
  for (let i = out.length - 1; i > 0; i--) {
    const [j, s] = nextInt(cur, i + 1)
    cur = s
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return [out, cur] as const
}
