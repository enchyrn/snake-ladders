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
})