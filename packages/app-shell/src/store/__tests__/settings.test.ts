import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULTS, loadSettings, saveSettings } from "../settings"

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
})

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULTS)
  })

  it("keeps a valid stored value", () => {
    store.set("sl:settings", JSON.stringify({ ...DEFAULTS, speed: "quick" }))
    expect(loadSettings().speed).toBe("quick")
  })

  // Each field falls back on its own: there is no version number, so a single
  // corrupt field must not cost the other eight.
  it("repairs one bad field without discarding the rest", () => {
    store.set("sl:settings", JSON.stringify({ ...DEFAULTS, speed: "ludicrous", roundLog: false }))
    const loaded = loadSettings()
    expect(loaded.speed).toBe(DEFAULTS.speed)
    expect(loaded.roundLog).toBe(false)
  })

  it("drops keys it does not know", () => {
    store.set("sl:settings", JSON.stringify({ ...DEFAULTS, legacyThing: 1 }))
    expect(loadSettings()).not.toHaveProperty("legacyThing")
  })

  // The loadProfiles defect, in a new place: without the write-back the same
  // junk is re-validated on every load and a direct reader still sees it.
  it("writes the repair back", () => {
    store.set("sl:settings", JSON.stringify({ speed: "ludicrous" }))
    loadSettings()
    expect(JSON.parse(store.get("sl:settings")!)).toEqual(DEFAULTS)
  })

  it("does not churn storage when nothing needed repairing", () => {
    const clean = JSON.stringify(DEFAULTS)
    store.set("sl:settings", clean)
    loadSettings()
    expect(store.get("sl:settings")).toBe(clean)
  })

  it("degrades to defaults when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("private browsing") },
      setItem: () => { throw new Error("private browsing") },
    })
    expect(() => loadSettings()).not.toThrow()
    expect(loadSettings()).toEqual(DEFAULTS)
  })

  it("repairs a stored colour not in the palette by falling back to empty", () => {
    store.set("sl:settings", JSON.stringify({ ...DEFAULTS, colour: "#00ff00" }))
    const loaded = loadSettings()
    expect(loaded.colour).toBe("")
  })

  it("keeps a palette colour and stores its own spelling", () => {
    store.set("sl:settings", JSON.stringify({ ...DEFAULTS, colour: "#4CC2FF" }))
    const loaded = loadSettings()
    expect(loaded.colour).toBe("#4cc2ff")
  })
})

describe("saveSettings", () => {
  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("quota") },
    })
    expect(() => saveSettings(DEFAULTS)).not.toThrow()
  })
})
