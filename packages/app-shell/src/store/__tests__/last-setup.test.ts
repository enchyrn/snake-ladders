import { beforeEach, describe, expect, it, vi } from "vitest"
import { defaultConfig } from "@mutation/engine/types"
import { loadLastSetup, saveLastSetup } from "../settings"

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
})

describe("the host's last match setup", () => {
  it("is empty before anything is saved", () => {
    expect(loadLastSetup()).toEqual({})
  })

  // The seed is the room code. Remembering it would build the previous match's
  // board under a new room's code, and two devices would disagree on the first roll.
  it("never remembers the seed", () => {
    saveLastSetup({ ...defaultConfig(12345), size: 8 })
    expect(loadLastSetup()).not.toHaveProperty("seed")
    expect(loadLastSetup().size).toBe(8)
  })

  it("survives junk in storage", () => {
    store.set("sl:last-setup", "{{{")
    expect(() => loadLastSetup()).not.toThrow()
    expect(loadLastSetup()).toEqual({})
  })

  // Controller ruling R8: each field is validated and clamped on its own.
  it("clamps out-of-range fields and drops unknown modules, keeping the rest", () => {
    store.set(
      "sl:last-setup",
      JSON.stringify({
        size: 999,
        mineCount: -5,
        mutationInterval: 3,
        exactFinish: "yes",
        modules: ["mutation", "haunted", "mutation"],
      }),
    )
    const loaded = loadLastSetup()
    expect(loaded.size).toBeUndefined()
    expect(loaded.mineCount).toBeUndefined()
    expect(loaded.mutationInterval).toBe(3)
    expect(loaded.exactFinish).toBeUndefined()
    expect(loaded.modules).toEqual(["mutation"])
  })

  it("writes the repair back", () => {
    store.set("sl:last-setup", JSON.stringify({ size: 999 }))
    loadLastSetup()
    expect(JSON.parse(store.get("sl:last-setup")!)).toEqual({})
  })
})
