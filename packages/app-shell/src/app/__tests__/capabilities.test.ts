import { describe, expect, it, vi } from "vitest"
import { hasHaptics, hasWakeLock, vibrate } from "../capabilities"

describe("hasHaptics", () => {
  it("is true where a backend answers", () => {
    expect(hasHaptics({ vibrate: () => true })).toBe(true)
  })

  // WebKit has never shipped the Vibration API, in Safari or in an installed
  // PWA. The probe asks whether a backend exists, not which OS this is, so a
  // Tauri plugin can become backend two without touching the settings layer.
  it("is false where none does", () => {
    expect(hasHaptics({})).toBe(false)
  })
})

describe("hasWakeLock", () => {
  it("needs both the API and a secure context", () => {
    expect(hasWakeLock({ wakeLock: {} as WakeLock }, true)).toBe(true)
    expect(hasWakeLock({ wakeLock: {} as WakeLock }, false)).toBe(false)
    expect(hasWakeLock({}, true)).toBe(false)
  })
})

describe("vibrate", () => {
  it("does nothing, and does not throw, where there is no backend", () => {
    expect(() => vibrate({}, 20)).not.toThrow()
  })

  it("calls through where there is one", () => {
    const spy = vi.fn(() => true)
    vibrate({ vibrate: spy }, 20)
    expect(spy).toHaveBeenCalledWith(20)
  })

  // Android's vibrate throws on some embedded webviews rather than returning
  // false; a cosmetic buzz must never take the round with it.
  it("swallows a throwing backend", () => {
    expect(() => vibrate({ vibrate: () => { throw new Error("denied") } }, 20)).not.toThrow()
  })
})
