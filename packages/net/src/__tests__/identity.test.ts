import { beforeEach, describe, expect, it } from "vitest"
import { loadProfiles, saveProfiles, type Profile } from "../identity"

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
})

describe("local profiles", () => {
  it("migrates the existing identity as the first owner profile", () => {
    storage.set("sl:identity", JSON.stringify({ playerId: "p1", name: "Sam" }))

    expect(loadProfiles()).toEqual([
      expect.objectContaining({ id: "p1", name: "Sam", kind: "owner" }),
    ])
  })

  it("persists an ordered profile roster", () => {
    const profiles: Profile[] = [
      { id: "p1", name: "Sam", kind: "owner", createdAt: 1 },
      { id: "p2", name: "Guest", kind: "guest", createdAt: 2 },
    ]

    saveProfiles(profiles)

    expect(loadProfiles()).toEqual(profiles)
  })

  it("drops malformed and duplicate profiles while preserving valid order", () => {
    storage.set(
      "sl:profiles",
      JSON.stringify([
        { id: "p1", name: "Sam", kind: "owner", createdAt: 1 },
        { id: "p1", name: "Duplicate", kind: "guest", createdAt: 2 },
        { id: "", name: "Empty", kind: "guest", createdAt: 3 },
        { id: "p2", name: "Guest", kind: "guest", createdAt: "bad" },
        { id: "p3", name: "Jo", kind: "guest", createdAt: 3 },
      ]),
    )

    expect(loadProfiles()).toEqual([
      { id: "p1", name: "Sam", kind: "owner", createdAt: 1 },
      { id: "p3", name: "Jo", kind: "guest", createdAt: 3 },
    ])
  })
  it("writes the repaired roster back so the junk is not re-parsed every load", () => {
    storage.set(
      "sl:profiles",
      JSON.stringify([
        { id: "p1", name: "Sam", kind: "owner", createdAt: 1 },
        { id: "p1", name: "Duplicate", kind: "guest", createdAt: 2 },
      ]),
    )

    loadProfiles()

    expect(JSON.parse(storage.get("sl:profiles")!)).toEqual([
      { id: "p1", name: "Sam", kind: "owner", createdAt: 1 },
    ])
  })

  it("leaves an already-clean roster untouched in storage", () => {
    const clean: Profile[] = [{ id: "p1", name: "Sam", kind: "owner", createdAt: 1 }]
    storage.set("sl:profiles", JSON.stringify(clean))

    loadProfiles()

    expect(JSON.parse(storage.get("sl:profiles")!)).toEqual(clean)
  })

  it("seats this device even when the stored roster is all guests", () => {
    storage.set("sl:identity", JSON.stringify({ playerId: "owner-1", name: "Sam" }))
    storage.set(
      "sl:profiles",
      JSON.stringify([{ id: "g1", name: "Guest", kind: "guest", createdAt: 1 }]),
    )

    const profiles = loadProfiles()

    expect(profiles[0]).toEqual(
      expect.objectContaining({ id: "owner-1", name: "Sam", kind: "owner" }),
    )
    expect(profiles.map((p) => p.id)).toEqual(["owner-1", "g1"])
  })
})
