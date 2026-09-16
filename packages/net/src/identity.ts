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

const validate = (parsed: unknown): Profile[] => {
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  return (parsed as unknown[]).filter((candidate): candidate is Profile => {
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
}

/**
 * Drop a guest from the roster. Owners are refused: an owner is the device
 * itself, so removing one would leave the person holding it with no seat, and
 * `loadProfiles` would put it straight back on the next load anyway.
 *
 * Returns the original array when nothing matched, so a caller can skip the
 * write and the re-render.
 */
export const removeProfile = (
  profiles: ReadonlyArray<Profile>,
  id: string,
): ReadonlyArray<Profile> => {
  const next = profiles.filter((profile) => !(profile.kind === "guest" && profile.id === id))
  return next.length === profiles.length ? profiles : next
}

const ownerFromIdentity = (): Profile => {
  const identity = loadIdentity()
  return { id: identity.playerId, name: identity.name, kind: "owner", createdAt: Date.now() }
}

/**
 * The roster is repaired on read and the repair is written back, because a
 * caller that reads `sl:profiles` directly would otherwise still see the junk
 * this dropped, and the same entries would be re-validated on every load.
 *
 * A roster with no owner is repaired too: seats are derived from this list, so
 * an owner-less roster leaves the person holding the device with no player.
 */
export const loadProfiles = (): ReadonlyArray<Profile> => {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    const stored = raw === null ? [] : validate(JSON.parse(raw) as unknown)
    const repaired = stored.some((profile) => profile.kind === "owner")
      ? stored
      : [ownerFromIdentity(), ...stored]
    if (repaired.length === 0) repaired.push(ownerFromIdentity())
    // Only rewrite when the parse actually changed something; an untouched
    // roster should not churn storage on every load.
    if (raw === null || JSON.stringify(repaired) !== raw) saveProfiles(repaired)
    return repaired
  } catch {
    // Private browsing, disabled storage, or unparseable JSON.
    return [ownerFromIdentity()]
  }
}
