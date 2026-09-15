import { useEffect, useState } from "react"

/** Re-render on viewport changes, so the canvas can resize with the window. */
export const useViewport = (): { width: number; height: number } => {
  const [size, setSize] = useState(() => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener("resize", onResize)
    window.addEventListener("orientationchange", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("orientationchange", onResize)
    }
  }, [])
  return size
}

/** A short code derived from the seed, matching `lan_sync::room_code`. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

export const roomCode = (seed: number): string => {
  let n = seed >>> 0
  let out = ""
  for (let i = 0; i < 4; i++) {
    out += ALPHABET[n % ALPHABET.length]
    n = Math.floor(n / ALPHABET.length)
  }
  return out
}

export const seedFromRoom = (code: string): number | null => {
  const upper = code.toUpperCase()
  // The code is the seed, so a short one is not a partial match — it is a
  // different board, built silently and with every frame still decoding.
  if (upper.length !== 4) return null
  let seed = 0
  for (let i = 0; i < 4; i++) {
    const digit = ALPHABET.indexOf(upper[i]!)
    if (digit < 0) return null
    seed += digit * Math.pow(ALPHABET.length, i)
  }
  return seed
}

/** Seeds are capped at the four-character code space so every match a device
 *  opens can be named by a code a person can read aloud. */
export const randomSeed = (): number => Math.floor(Math.random() * ALPHABET.length ** 4)
