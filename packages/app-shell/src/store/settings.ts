import { Atom } from "@effect-atom/atom"
import { seatColours } from "@mutation/render/palette"

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
