import { Atom } from "@effect-atom/atom"
import { seatColours } from "@mutation/render/palette"
import { allModules, type RuleModule } from "@mutation/engine/primitives"
import type { MatchConfig } from "@mutation/engine/types"

/**
 * Device-local presentation and input. Nothing here reaches the reducer, is
 * sent over the wire, or appears in MatchState, so by construction a setting
 * can never desync a match (ADR 0001). Match settings are a different thing
 * and live in the lobby: device settings are remembered, match settings are not.
 */
const KEY = "sl:settings"

export interface Settings {
  readonly rollButton: "hidden" | "left" | "right"
  readonly confirmRoll: boolean
  readonly haptics: boolean
  readonly speed: "calm" | "brisk" | "quick"
  readonly reducedMotion: "system" | "on" | "off"
  readonly quality: "high" | "low"
  readonly tileNumbers: boolean
  readonly roundLog: boolean
  readonly keepAwake: boolean
  /** One of the seat palette colours, or empty to take the seat's colour. */
  readonly colour: string
}

export const DEFAULTS: Settings = {
  rollButton: "right",
  confirmRoll: false,
  haptics: true,
  speed: "calm",
  reducedMotion: "system",
  quality: "high",
  tileNumbers: true,
  roundLog: true,
  keepAwake: true,
  colour: "",
}

const oneOf =
  <T extends string>(...allowed: ReadonlyArray<T>) =>
  (v: unknown, fallback: T): T =>
    typeof v === "string" && (allowed as ReadonlyArray<string>).includes(v) ? (v as T) : fallback

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback)

const paletteColour = (v: unknown, fallback: string): string => {
  if (typeof v !== "string") return fallback
  // Compare case-insensitively and store the palette's own spelling
  const normalized = v.toLowerCase()
  const found = seatColours.find(c => c.toLowerCase() === normalized)
  return found ?? fallback
}

/** Every field falls back on its own. There is no version number, so a rename
 *  silently resets that one key — and owes the old key a read-once migration. */
const validate = (raw: unknown): Settings => {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    rollButton: oneOf("hidden", "left", "right")(o.rollButton, DEFAULTS.rollButton),
    confirmRoll: bool(o.confirmRoll, DEFAULTS.confirmRoll),
    haptics: bool(o.haptics, DEFAULTS.haptics),
    speed: oneOf("calm", "brisk", "quick")(o.speed, DEFAULTS.speed),
    reducedMotion: oneOf("system", "on", "off")(o.reducedMotion, DEFAULTS.reducedMotion),
    quality: oneOf("high", "low")(o.quality, DEFAULTS.quality),
    tileNumbers: bool(o.tileNumbers, DEFAULTS.tileNumbers),
    roundLog: bool(o.roundLog, DEFAULTS.roundLog),
    keepAwake: bool(o.keepAwake, DEFAULTS.keepAwake),
    colour: paletteColour(o.colour, DEFAULTS.colour),
  }
}

export const saveSettings = (settings: Settings): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Private browsing or a full quota: the choice just will not survive a reload.
  }
}

export const loadSettings = (): Settings => {
  try {
    const raw = localStorage.getItem(KEY)
    const repaired = validate(raw === null ? {} : (JSON.parse(raw) as unknown))
    // Write the repair back, or the same junk is re-validated on every load and
    // anything reading the key directly still sees it — the loadProfiles fix.
    if (raw === null || JSON.stringify(repaired) !== raw) saveSettings(repaired)
    return repaired
  } catch {
    return DEFAULTS
  }
}

export const settingsAtom = Atom.keepAlive(Atom.make(loadSettings()))

/*
 * The host's last match setup — everything `Configure`-able except the seed.
 * Match settings, unlike device settings above, are per-match and normally
 * forgotten; this is the one exception, so the lobby doesn't reset to
 * `defaultConfig` every time someone hosts.
 *
 * `seed` is deliberately absent from this list, however tempting it looks to
 * add: the room code IS the seed (CLAUDE.md, "the room code is the match
 * seed"). Remembering it here would build a previous match's board under a
 * new room's code, and two devices would silently disagree on the first
 * roll — so it is never read from storage, and never written to it either.
 */
const LAST_SETUP_KEY = "sl:last-setup"

const clampedInt = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined

const cleanModules = (v: unknown): ReadonlyArray<RuleModule> | undefined => {
  if (!Array.isArray(v)) return undefined
  const known = (allModules as ReadonlyArray<string>)
  const deduped = new Set<RuleModule>()
  for (const m of v) if (typeof m === "string" && known.includes(m)) deduped.add(m as RuleModule)
  return [...deduped]
}

/** Each field validated and clamped independently, and a bad or missing one
 *  is simply left out — there is no per-field default to repair it to, since
 *  the lobby spreads this over the match's *current* config (`{ ...match.config,
 *  ...lastSetup }`), so an absent field just keeps whatever the match already has. */
const validateLastSetup = (raw: unknown): Partial<MatchConfig> => {
  const o = (raw ?? {}) as Record<string, unknown>
  // `MatchConfig`'s fields are readonly (an Effect Schema.Struct), so each
  // valid field is folded in with a spread rather than assigned in place.
  let out: Partial<MatchConfig> = {}
  const size = clampedInt(o.size, 5, 12)
  if (size !== undefined) out = { ...out, size }
  const mineCount = clampedInt(o.mineCount, 0, 40)
  if (mineCount !== undefined) out = { ...out, mineCount }
  const mutationInterval = clampedInt(o.mutationInterval, 1, 50)
  if (mutationInterval !== undefined) out = { ...out, mutationInterval }
  if (typeof o.exactFinish === "boolean") out = { ...out, exactFinish: o.exactFinish }
  const modules = cleanModules(o.modules)
  if (modules !== undefined) out = { ...out, modules }
  return out
}

const writeLastSetup = (setup: Partial<MatchConfig>): void => {
  try {
    localStorage.setItem(LAST_SETUP_KEY, JSON.stringify(setup))
  } catch {
    // Private browsing or a full quota: the setup just will not survive a reload.
  }
}

export const saveLastSetup = (config: MatchConfig): void => {
  // Built field by field, not spread-then-stripped, so a future field added
  // to `MatchConfig` is remembered only once someone decides it belongs here
  // — and `seed` can never slip back in by a careless spread.
  writeLastSetup({
    size: config.size,
    modules: config.modules,
    mutationInterval: config.mutationInterval,
    mineCount: config.mineCount,
    exactFinish: config.exactFinish,
  })
}

export const loadLastSetup = (): Partial<MatchConfig> => {
  try {
    const raw = localStorage.getItem(LAST_SETUP_KEY)
    const repaired = validateLastSetup(raw === null ? {} : (JSON.parse(raw) as unknown))
    // Write the repair back, or the same junk is re-validated on every load —
    // the loadProfiles fix, again.
    if (raw === null || JSON.stringify(repaired) !== raw) writeLastSetup(repaired)
    return repaired
  } catch {
    return {}
  }
}
