const KEY = "sl:identity"
const PROFILES_KEY = "sl:profiles"

export interface LocalIdentity {
  readonly playerId: string
  readonly name: string
}

export type ProfileKind = "owner" | "guest"

export interface Profile {
  readonly id: string
  readonly name: string
  readonly kind: ProfileKind
  readonly createdAt: number
}

const randomId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `p-${Math.random().toString(36).slice(2, 10)}`
}

export const newGuest = (name: string): Profile => ({
  id: randomId(),
  name,
  kind: "guest",
  createdAt: Date.now(),
})

const ANIMALS = ["Adder", "Cobra", "Mamba", "Viper", "Python", "Krait", "Taipan", "Boa"]

export const suggestName = (): string =>
  `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!}`

/**
 * A stable per-device identity. It has to survive a reload, because it is what
 * lets a player who dropped off Wi-Fi mid-match reclaim their seat instead of
 * joining as a stranger.
 */
export const loadIdentity = (): LocalIdentity => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalIdentity>
      if (typeof parsed.playerId === "string" && typeof parsed.name === "string") {
        return { playerId: parsed.playerId, name: parsed.name }
      }
    }
  } catch {
    // Private browsing, or storage disabled: fall through to a fresh identity.
  }
  const fresh = { playerId: randomId(), name: suggestName() }
  saveIdentity(fresh)
  return fresh
}

export const saveIdentity = (identity: LocalIdentity): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity))
  } catch {
    // Non-fatal: the identity just will not survive a reload.
  }
}

export const saveProfiles = (profiles: ReadonlyArray<Profile>): void => {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
  } catch {
    // Profiles are a convenience for this device; a storage failure is non-fatal.
  }
}

export const loadProfiles = (): ReadonlyArray<Profile> => {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const seen = new Set<string>()
        const valid = (parsed as unknown[]).filter((candidate): candidate is Profile => {
          if (!candidate || typeof candidate !== "object") return false
          const profile = candidate as Partial<Profile>
          if (
            typeof profile.id !== "string" ||
            typeof profile.name !== "string" ||
            (profile.kind !== "owner" && profile.kind !== "guest") ||
            typeof profile.createdAt !== "number" ||
            !profile.id ||
            !profile.name ||
            !Number.isFinite(profile.createdAt) ||
            seen.has(profile.id)
          ) {
            return false
          }
          seen.add(profile.id)
          return true
        })
        if (valid.length > 0) return valid
      }
    }

    const identity = loadIdentity()
    const migrated: Profile = {
      id: identity.playerId,
      name: identity.name,
      kind: "owner",
      createdAt: Date.now(),
    }
    saveProfiles([migrated])
    return [migrated]
  } catch {
    const identity = loadIdentity()
    return [{ id: identity.playerId, name: identity.name, kind: "owner", createdAt: Date.now() }]
  }
}
