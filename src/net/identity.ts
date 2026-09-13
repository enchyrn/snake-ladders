const KEY = "sl:identity"

export interface LocalIdentity {
  readonly playerId: string
  readonly name: string
}

const randomId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `p-${Math.random().toString(36).slice(2, 10)}`
}

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
