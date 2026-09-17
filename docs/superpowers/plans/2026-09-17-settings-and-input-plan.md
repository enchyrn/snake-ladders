# Settings and Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player device-local control over input, motion and what is on screen, plus a host-only surface for the match settings that are currently editable nowhere.

**Architecture:** Settings live in `app-shell` and are never imported by a lower layer — `layer:ui` may depend only on `engine` and `render`, so every consumer below app-shell receives the slice it needs as an explicit parameter. Storage follows `identity.ts`: one key, try/catch everywhere, validate-and-repair on read with the repair written back, and no version field. Animation speed scales each clip's duration and then clamps it, so a beat can never become a single frame.

**Tech Stack:** TypeScript 6.0.3, React 19.3, Effect Atom, vitest, Panda CSS (from plan 1), nub.

**Spec:** `docs/superpowers/specs/2026-09-16-settings-and-input-design.md`
(governed by ADR 0020; the overlay is laid out per
`docs/superpowers/specs/2026-09-17-chrome-and-layout-design.md`)

**This is plan 2 of 2, and it runs after
`2026-09-17-chrome-and-layout-plan.md`.** That order is not the handoff's
original one: ADR 0021 requires the Panda beta to be proven before anything is
written against it, and the dice tray this plan's `rollButton` setting depends
on is built in plan 1, Task 8.

## Global Constraints

- **nub, not npm.** `nub run`, `nubx`. `npm ci` fails (ADR 0017).
- **`layer:ui` may depend only on `engine` and `render`.** Nothing below `app-shell` may import the settings store. Run `nub run lint` after any move between packages.
- **`nub run verify:ui` does NOT build.** Always `nub run build && nub run verify:ui`.
- **The engine stays pure.** Nothing in this plan may make a rule depend on a setting, and `colour` must never be priced into one — that is exactly how `venom` went wrong.
- **Every storage read and write is wrapped in try/catch.** Private browsing and disabled storage degrade to defaults; they never throw.
- **No version field in stored settings.** Each field validates and falls back independently.
- **Speed presets are `calm` 1×, `brisk` 1.5×, `quick` 2.5×; `FLOOR_MS` is 150.**
- **Reduced motion removes flourish, never causal beats** (ADR 0020 rule 1 outranks it).
- **Capability probes, never platform checks**, for haptics and wake lock.
- **Tests** live in `<package>/src/__tests__/*.test.{ts,tsx}`, run in vitest's **node** environment; component tests use `renderToStaticMarkup`.
- **Commit at the end of every task.**

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/app-shell/src/store/settings.ts` | The shape, defaults, validation, repair, persistence, atoms. |
| `packages/app-shell/src/app/capabilities.ts` | Probes: does a haptics or wake-lock backend exist here? |
| `packages/app-shell/src/app/settings-panel.tsx` | The overlay. Four groups, laid out per spec B. |
| `packages/render/src/timing.ts` | `effectiveDuration` — the speed scale and its floor. |

---

### Task 1: The settings store

**Files:**
- Create: `packages/app-shell/src/store/settings.ts`
- Create: `packages/app-shell/src/store/__tests__/settings.test.ts`

**Interfaces:**
- Produces: `Settings` (the interface below), `DEFAULTS: Settings`, `loadSettings(): Settings`, `saveSettings(s: Settings): void`, `settingsAtom` (an `Atom.keepAlive` holding `Settings`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-shell/src/store/__tests__/settings.test.ts
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
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/app-shell/src/store/__tests__/settings.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```ts
// packages/app-shell/src/store/settings.ts
import { Atom } from "@effect-atom/atom"

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
  /** Empty means "take the seat's colour", which is the default for everyone. */
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
const hex = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^(#[0-9a-f]{6})?$/i.test(v) ? v : fallback

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
    colour: hex(o.colour, DEFAULTS.colour),
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
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/app-shell/src/store/__tests__/settings.test.ts
```

Expected: PASS, all eight cases.

- [ ] **Step 5: Commit**

```bash
git add packages/app-shell/src/store/settings.ts packages/app-shell/src/store/__tests__/settings.test.ts
git commit -m "feat: the device settings store, with per-field repair written back"
```

---

### Task 2: effectiveDuration — the speed scale and its floor

ADR 0020 allows an animation-speed control because ADR 0007 already guarantees
a skipped animation cannot change a result. It also demands the floor be
defended. This is the defence, and it is a pure function so it can be tested
rather than watched.

**Files:**
- Create: `packages/render/src/timing.ts`
- Create: `packages/render/src/__tests__/timing.test.ts`
- Modify: `packages/render/src/scene.ts`

**Interfaces:**
- Produces: `SPEEDS: Record<"calm" | "brisk" | "quick", number>`, `FLOOR_MS = 150`, `effectiveDuration(duration: number, speed: number): number`; and `Scene.setSpeed(multiplier: number): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/render/src/__tests__/timing.test.ts
import { describe, expect, it } from "vitest"
import { effectiveDuration, FLOOR_MS, SPEEDS } from "../timing"

/** Every clip `Scene.play` can push, at scene.ts:399. A clip added there
 *  without a row here is what this table exists to catch. */
const CLIPS = {
  Rolled: 700,
  "Moved (1 step)": 130 + 95,
  "Moved (3 steps)": 130 + 95 * 3,
  "Moved (max)": 1100,
  TookLink: 620,
  Knocked: 520,
  "MineTripped (absorbed)": 320,
  "MineTripped": 640,
  Swapped: 520,
}

describe("effectiveDuration", () => {
  // A beat that renders in one frame is a teleport, and ADR 0020 rule 1 says
  // the causal beats stay separable at every speed.
  it.each(Object.entries(SPEEDS))("keeps every clip above the floor at %s", (_name, speed) => {
    for (const [clip, duration] of Object.entries(CLIPS)) {
      expect(effectiveDuration(duration, speed), clip).toBeGreaterThanOrEqual(FLOOR_MS)
    }
  })

  it("scales a long clip fully rather than clamping it", () => {
    expect(effectiveDuration(700, SPEEDS.quick)).toBe(280)
  })

  // The clamp, not a multiplier cap, is what makes `quick` safe: without it the
  // shortest clip would decide the cap for all of them.
  it("clamps the clips that would otherwise vanish", () => {
    expect(effectiveDuration(225, SPEEDS.quick)).toBe(FLOOR_MS)
    expect(effectiveDuration(320, SPEEDS.quick)).toBe(FLOOR_MS)
  })

  it("changes nothing at calm", () => {
    for (const duration of Object.values(CLIPS)) {
      expect(effectiveDuration(duration, SPEEDS.calm)).toBe(duration)
    }
  })

  it("never returns a duration a frame budget cannot render", () => {
    // step() clamps delta to 64ms, so the floor buys at least three frames.
    expect(FLOOR_MS / 64).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/render/src/__tests__/timing.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
// packages/render/src/timing.ts
/**
 * Speed scales a clip's duration; the clamp is what keeps a beat visible. A
 * per-clip floor beats capping the multiplier, because long clips then speed
 * up fully while short ones cannot vanish — without it the shortest clip (a
 * one-step Moved, 225ms) would decide the cap for all of them.
 *
 * 150ms because `Scene.step` already clamps delta to 64ms, so a 150ms clip
 * renders at least three frames even on a phone dropping them. Below that a
 * causal beat can become one frame, which is a teleport (ADR 0020 rule 1).
 */
export const FLOOR_MS = 150

export const SPEEDS = { calm: 1, brisk: 1.5, quick: 2.5 } as const

export const effectiveDuration = (duration: number, speed: number): number =>
  Math.max(FLOOR_MS, duration / speed)
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/render/src/__tests__/timing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Thread the speed through the scene**

In `packages/render/src/scene.ts`:

- Add a private field `private speed = SPEEDS.calm` and a public
  `setSpeed(multiplier: number): void { this.speed = multiplier }`. Speed is
  **not** structural — unlike `quality` it must be changeable without rebuilding
  the scene, because the settings overlay sits above a live match.
- In `step`, replace `clip.duration` with
  `effectiveDuration(clip.duration, this.speed)`. Change it **only there** —
  the `duration` values pushed in `play` stay as authored, so the clip table
  above remains the source of truth and a future reader sees the real numbers.

- [ ] **Step 6: Typecheck, test, and build**

```bash
nub run typecheck && nub run test && nub run build
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/timing.ts packages/render/src/__tests__/timing.test.ts packages/render/src/scene.ts
git commit -m "feat: animation speed with a per-clip floor derived from the frame budget"
```

---

### Task 3: Reduced motion — precedence, and flourish without beats

**Files:**
- Create: `packages/render/src/__tests__/motion.test.ts`
- Modify: `packages/render/src/timing.ts`
- Modify: `packages/render/src/scene.ts`

**Interfaces:**
- Produces: `motionLevel(setting: "system" | "on" | "off", systemPrefersReduced: boolean): "full" | "reduced"`, exported from `packages/render/src/timing.ts`; `Scene.setMotion(level: "full" | "reduced"): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/render/src/__tests__/motion.test.ts
import { describe, expect, it } from "vitest"
import { motionLevel } from "../timing"

describe("motionLevel", () => {
  // The OS preference sets the default, it does not override the player: an
  // accessibility setting nobody can escape is its own kind of hostility.
  it("follows the system when the player has expressed no choice", () => {
    expect(motionLevel("system", true)).toBe("reduced")
    expect(motionLevel("system", false)).toBe("full")
  })

  it("lets an explicit choice win in both directions", () => {
    expect(motionLevel("off", true)).toBe("full")
    expect(motionLevel("on", false)).toBe("reduced")
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/render/src/__tests__/motion.test.ts
```

Expected: FAIL — `motionLevel` is not exported.

- [ ] **Step 3: Implement it**

Append to `packages/render/src/timing.ts`:

```ts
export type MotionLevel = "full" | "reduced"

/**
 * `prefers-reduced-motion` sets the first-run default and never overrides an
 * explicit choice. Reduced removes flourish — the momentum arc, the board's
 * breathing, the mine shudder's oscillation — and never a causal beat: you
 * rolled, you moved, the snake bit stays legible, because ADR 0020 rule 1
 * outranks the preference.
 */
export const motionLevel = (
  setting: "system" | "on" | "off",
  systemPrefersReduced: boolean,
): MotionLevel =>
  setting === "system" ? (systemPrefersReduced ? "reduced" : "full") : setting === "on" ? "reduced" : "full"
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/render/src/__tests__/motion.test.ts
```

Expected: PASS.

- [ ] **Step 5: Gate the flourishes, not the clips**

In `scene.ts`, add `private motion: MotionLevel = "full"` and
`setMotion(level: MotionLevel): void`. Then, in `play`, when `this.motion` is
`"reduced"`:

- `Moved`: keep the walk, drop any arc — the token travels the path flat.
- `TookLink`: keep the lerp, set the rise to 0 (`Math.sin(k * Math.PI) * 0.45`
  becomes 0 for a climb).
- `Knocked` and `Swapped`: keep the lerp, drop the `lift`.
- `MineTripped` absorbed: hold position instead of oscillating.
- **Every clip still runs, and still takes its full duration.** Nothing is
  removed from the queue. Reduced motion changes what a clip draws, never
  whether the player sees that it happened.

- [ ] **Step 6: Typecheck and build**

```bash
nub run typecheck && nub run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/timing.ts packages/render/src/__tests__/motion.test.ts packages/render/src/scene.ts
git commit -m "feat: reduced motion removes flourish and never a causal beat"
```

---

### Task 4: Capability probes, not platform checks

A control that offers something the device cannot do is a lie. `navigator.vibrate`
is absent in every WebKit browser, and `navigator.wakeLock` is `[SecureContext]`
— so it is missing on exactly the guest phones that scanned the host's QR, because
the host-served join is plain HTTP.

**Files:**
- Create: `packages/app-shell/src/app/capabilities.ts`
- Create: `packages/app-shell/src/app/__tests__/capabilities.test.ts`

**Interfaces:**
- Produces: `hasHaptics(nav: Partial<Navigator>): boolean`, `hasWakeLock(nav: Partial<Navigator>, isSecureContext: boolean): boolean`, `vibrate(nav: Partial<Navigator>, pattern: number | ReadonlyArray<number>): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-shell/src/app/__tests__/capabilities.test.ts
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
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/capabilities.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
// packages/app-shell/src/app/capabilities.ts
/**
 * Every environment-dependent setting asks what this device can do, never what
 * platform it is. Haptics has one backend today (navigator.vibrate, absent in
 * all of WebKit) and could gain a second (a Tauri plugin, which would reach
 * only the installed iOS app ADR 0011 keeps manual) without this layer moving.
 *
 * Wake lock is [SecureContext], and the host-served join serves plain HTTP, so
 * it is absent on precisely the guest phones that scanned in. The probe is what
 * keeps the control from claiming otherwise.
 */
export const hasHaptics = (nav: Partial<Navigator>): boolean => typeof nav.vibrate === "function"

export const hasWakeLock = (nav: Partial<Navigator>, isSecureContext: boolean): boolean =>
  isSecureContext && nav.wakeLock !== undefined

export const vibrate = (nav: Partial<Navigator>, pattern: number | ReadonlyArray<number>): void => {
  if (!hasHaptics(nav)) return
  try {
    nav.vibrate?.(pattern as number | number[])
  } catch {
    // A denied or throwing backend is a cosmetic loss, never a failed round.
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-shell/src/app/capabilities.ts packages/app-shell/src/app/__tests__/capabilities.test.ts
git commit -m "feat: capability probes for haptics and wake lock"
```

---

### Task 5: The settings overlay

An overlay, not a route. A `/settings` route would replace the match screen,
unmounting `BoardCanvas`, whose effect constructs `BoardScene` and tears it down
on cleanup — discarding the clip queue of a round mid-replay.

**Files:**
- Create: `packages/app-shell/src/app/settings-panel.tsx`
- Create: `packages/app-shell/src/app/__tests__/settings-panel.test.tsx`
- Modify: `packages/app-shell/src/routes/match.tsx`
- Modify: `packages/app-shell/src/routes/home.tsx`

**Interfaces:**
- Consumes: `settingsAtom`, `saveSettings` (Task 1); `hasHaptics`, `hasWakeLock` (Task 4).
- Produces: `SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app-shell/src/app/__tests__/settings-panel.test.tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { SettingsPanel } from "../settings-panel"

describe("SettingsPanel", () => {
  it("groups the settings under the four headings", () => {
    const html = renderToStaticMarkup(<SettingsPanel open onClose={() => {}} />)
    for (const heading of ["You", "Controls", "Motion", "Screen"]) {
      expect(html, heading).toContain(heading)
    }
  })

  it("is a dialog, so it sits over the screen it was opened from", () => {
    const html = renderToStaticMarkup(<SettingsPanel open onClose={() => {}} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain("aria-modal")
  })

  it("renders nothing when closed", () => {
    expect(renderToStaticMarkup(<SettingsPanel open={false} onClose={() => {}} />)).toBe("")
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/settings-panel.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Build the panel**

Four `<section>`s with `<h2>` headings — **not tabs**; four groups do not earn a
tab bar:

- **You** — name (writes through to `sl:identity`, which stays the single store
  for it), colour.
- **Controls** — `rollButton` (hidden / left / right), `confirmRoll`, `haptics`.
- **Motion** — `speed`, `reducedMotion`, `quality`.
- **Screen** — `tileNumbers`, `roundLog`, `keepAwake`.

The root is `role="dialog" aria-modal="true"` with an accessible name, rendered
above the current screen. **Do not add a route.** Controls whose probe returns
false (`haptics`, `keepAwake`) are not rendered at all — a disabled control
still claims the capability exists.

Every change calls `saveSettings` and updates `settingsAtom` in the same
handler, so a reload and the live UI cannot disagree.

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/settings-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Wire the two entry points**

The match screen's header button (built inert in plan 1, Task 9) and a settings
button on the home screen both set the same `open` state.

- [ ] **Step 6: Build, drive, and check the thing the overlay exists for**

```bash
nub run build && nub run verify:ui
```

Expected: PASS. Then confirm by hand or in a throwaway driver script that
**opening the panel mid-round does not interrupt the replay** — the board is
still animating behind it. That is the entire reason this is not a route, and a
screenshot of a static panel does not show it.

- [ ] **Step 7: Commit**

```bash
git add packages/app-shell/src/app/settings-panel.tsx packages/app-shell/src/app/__tests__/settings-panel.test.tsx packages/app-shell/src/routes/match.tsx packages/app-shell/src/routes/home.tsx
git commit -m "feat: the settings overlay, which keeps the board mounted"
```

---

### Task 6: Deliver each setting to its consumer

Nothing below `app-shell` imports the store. Each lower layer takes the slice it
needs as an explicit parameter — which is what `BoardCanvas`'s dangling
`quality` prop already was, half-built.

**Files:**
- Modify: `packages/ui/src/BoardCanvas.tsx`
- Modify: `packages/ui/src/EventLog.tsx`
- Modify: `packages/render/src/board-texture.ts`
- Modify: `packages/app-shell/src/routes/match.tsx`
- Create: `packages/ui/src/__tests__/event-log-hidden.test.tsx`

- [ ] **Step 1: Write the failing test for the one that can silently break accessibility**

```tsx
// packages/ui/src/__tests__/event-log-hidden.test.tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig } from "@mutation/engine/types"
import { EventLog } from "../EventLog"

describe("EventLog when the player has turned the log off", () => {
  // The naive implementation returns null, which removes the aria-live region
  // — turning a cosmetic toggle into an accessibility switch. Off means
  // visually hidden, not absent (ADR 0020 rule 2).
  it("hides it visually and leaves the live region in the tree", () => {
    const html = renderToStaticMarkup(
      <EventLog state={initialMatch(defaultConfig(3))} mode="preview" visible={false} />,
    )
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toBe("")
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/event-log-hidden.test.tsx
```

Expected: FAIL — `visible` is not a prop.

- [ ] **Step 3: Wire each setting to its consumer**

| Setting | How it arrives | What it does |
|---|---|---|
| `roundLog` | `EventLog`'s new `visible` prop | Applies a visually-hidden class. **Never** returns `null`. |
| `quality` | `BoardCanvas`'s existing `quality` prop | Already structural, already in the effect's dependency array. Only the overlay may change it. |
| `speed` | `BoardCanvas` → `scene.setSpeed(SPEEDS[speed])` in an effect | Not structural: changing it must not rebuild the scene. |
| `reducedMotion` | `BoardCanvas` → `scene.setMotion(motionLevel(setting, matchMedia("(prefers-reduced-motion: reduce)").matches))` | Same effect, same reason. |
| `tileNumbers` | `BoardCanvas` → a `BoardTexture` option | **Must invalidate the texture explicitly.** ADR 0007: one canvas, no dirty-tracking, redrawn only on board change — and a setting is not board change. |
| `rollButton` | `match.tsx` | Chooses whether `RollButton` renders and on which side of `DiceTray`. |
| `confirmRoll` | `match.tsx` | A local confirm before sending `Commit`. **Nothing resembling undo** — the log is append-only and the PRNG has advanced. |
| `haptics` | `match.tsx` → `vibrate(navigator, 20)` on a committed roll | Via Task 4's probe. |
| `keepAwake` | `match.tsx`, in an effect | `navigator.wakeLock.request("screen")`, released on unmount, guarded by `hasWakeLock`. |

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/event-log-hidden.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Prove `rollButton: "hidden"` does not strand a keyboard player**

Spec A calls this the one that catches the accessibility regression, so it is a
test rather than a promise.

```tsx
// packages/app-shell/src/app/__tests__/roll-controls.test.tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RollControls } from "../../routes/match"

describe("RollControls", () => {
  // RollButton was the only keyboard-reachable path to Commit, and Scene.pick
  // raycasts the board plane only — so hiding Roll without the tray being a
  // real button would take the turn away from anyone who cannot use a pointer.
  it.each(["hidden", "left", "right"] as const)(
    "always leaves a focusable control that can commit, with rollButton=%s",
    (rollButton) => {
      const html = renderToStaticMarkup(
        <RollControls rollButton={rollButton} disabled={false} onRoll={() => {}} />,
      )
      expect(html.match(/<button/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(html).not.toContain("disabled")
    },
  )

  it("puts the button on the side asked for", () => {
    const left = renderToStaticMarkup(
      <RollControls rollButton="left" disabled={false} onRoll={() => {}} />,
    )
    expect(left.indexOf("Roll")).toBeLessThan(left.indexOf("Roll the dice"))
  })
})
```

Run it, watch it fail (`RollControls` is not exported yet), then extract the
control bar's roll area from `match.tsx` into an exported
`RollControls({ rollButton, disabled, onRoll })` that renders `DiceTray`
always and `RollButton` per the setting. Run it again and watch it pass.

- [ ] **Step 6: Prove the tile-numbers toggle actually redraws**

```bash
nub run build && nub run verify:ui
```

Then drive the app, toggle `tileNumbers`, and screenshot before and after. The
stale-texture trap is invisible in the source and obvious in a screenshot:
**if the numbers are still there after turning them off, the invalidation is
missing.** A passing gate proves nothing here.

- [ ] **Step 7: Lint, typecheck, test**

```bash
nub run lint && nub run typecheck && nub run test
```

Expected: all PASS. `lint` especially — if any of `packages/ui` or
`packages/render` acquired an import from `app-shell`, the layer rule fails and
the architecture has quietly been abandoned.

- [ ] **Step 8: Commit**

```bash
git add packages/ui packages/render packages/app-shell/src/routes/match.tsx packages/app-shell/src/app/__tests__/roll-controls.test.tsx
git commit -m "feat: deliver each setting to its consumer as an explicit parameter"
```

---

### Task 7: Tier 2 — the match settings that are editable nowhere

`MatchConfig` has `size`, `mutationInterval`, `mineCount` and `exactFinish`, and
the lobby edits **only** `modules` (`lobby.tsx:54`). The rest sit at whatever
`defaultConfig` gave them, for every match anyone has ever played.

**Files:**
- Modify: `packages/app-shell/src/routes/lobby.tsx`
- Modify: `packages/app-shell/src/store/settings.ts`
- Create: `packages/app-shell/src/store/__tests__/last-setup.test.ts`

**Interfaces:**
- Produces: `loadLastSetup(): Partial<MatchConfig>`, `saveLastSetup(config: MatchConfig): void` in `settings.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-shell/src/store/__tests__/last-setup.test.ts
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
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/app-shell/src/store/__tests__/last-setup.test.ts
```

Expected: FAIL — not exported.

- [ ] **Step 3: Implement it**

Add to `settings.ts` a `sl:last-setup` key holding `size`, `modules`,
`mutationInterval`, `mineCount` and `exactFinish` — **and never `seed`**, with
a comment saying why, because the next person to read it will be tempted.

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/app-shell/src/store/__tests__/last-setup.test.ts
```

Expected: PASS.

- [ ] **Step 5: Expose the rest of MatchConfig in the lobby**

Beneath the module rows, add controls for board `size` (5–12), `mineCount`
(0–40, only when minesweeper is on), `mutationInterval` (1–50, only when
mutation is on) and `exactFinish`. Each sends
`{ _tag: "Configure", config: { ...match.config, <field> } }`, exactly as
`toggleModule` does.

Apply `loadLastSetup()` when the host opens a room, and call `saveLastSetup` on
`Start`.

- [ ] **Step 6: Write this section as the host's screen, not an enforced permission**

`canHost` (`lobby.tsx:27`) is `role !== "peer"` and is a **UI gate only** —
`Configure` has no authorship check in the engine, so a peer that sent one would
have it sequenced and applied everywhere. Under ADR 0009 that is consistent:
trust is social. Do not add an engine check, and do not write copy claiming only
the host can change these.

- [ ] **Step 7: Build, drive, look**

```bash
nub run build && nub run verify:ui
```

Expected: PASS, and `screenshots/2-lobby.png` shows the new controls without
pushing `Start` off the screen.

- [ ] **Step 8: Commit**

```bash
git add packages/app-shell/src/routes/lobby.tsx packages/app-shell/src/store/settings.ts packages/app-shell/src/store/__tests__/last-setup.test.ts
git commit -m "feat: the rest of MatchConfig is editable, and the host's setup is remembered"
```

---

### Task 8: Seat colour, the one wire change

Last on purpose: it is the only change that touches the wire format, and the
easiest to defer if the plan runs long.

**Files:**
- Modify: `packages/engine/src/types.ts`
- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/match.ts`
- Create: `packages/engine/src/__tests__/colour.test.ts`
- Modify: `packages/app-shell/src/routes/lobby.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/src/__tests__/colour.test.ts
import { describe, expect, it } from "vitest"
import { decodeAction } from "../actions"

describe("Join with a colour", () => {
  // A required field makes an older build's frame undecodable, and CLAUDE.md
  // classifies that as desync — meaning mismatched builds. Optional is what
  // keeps a cosmetic feature from becoming a version wall.
  it("still decodes a frame from a build that does not send one", () => {
    const older = { _tag: "Join", playerId: "p1", name: "Mamba" }
    expect(decodeAction(older)._tag).toBe("Right")
  })

  it("decodes a frame that does", () => {
    const newer = { _tag: "Join", playerId: "p1", name: "Mamba", colour: "#4cc2ff" }
    expect(decodeAction(newer)._tag).toBe("Right")
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/engine/src/__tests__/colour.test.ts
```

Expected: FAIL — the second case is rejected as an unknown key.

- [ ] **Step 3: Add the optional field**

In `actions.ts`, add `colour: Schema.optional(Schema.String)` to the `Join`
struct. In `types.ts`, add `colour: Schema.optional(Schema.String)` to `Player`.
In `match.ts`, carry it onto the player the `Join` case creates.

Add a comment at `Player.colour` saying plainly that it is presentation only and
**nothing may ever price a rule on it** — that is exactly how `venom` became
core state fed by one optional module.

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/engine/src/__tests__/colour.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the determinism suite — this is the one that matters**

```bash
nubx vitest run packages/engine/src/__tests__/determinism.test.ts
```

Expected: PASS. An inert field must not change a fold. If this goes red, the
field is not inert and the change is wrong.

- [ ] **Step 6: Add the picker**

In the lobby, each player's swatch opens a palette. The palette is
`seatColours`, which Task 3 of plan 1 already cleared of the reserved link-tint
band — do not add a colour without re-running that predicate. Conflicts resolve
by log order; seat assignment does not change, because seat is the deterministic
tiebreaker and the dice draw order.

Wire `settings.colour` into the `Join` the lobby sends.

- [ ] **Step 7: Run every gate**

```bash
nub run test && nub run typecheck && nub run lint && nub run build && nub run verify:ui
cargo test -p lan-sync
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src packages/app-shell/src/routes/lobby.tsx
git commit -m "feat: players pick a colour, carried optionally in Join"
```

---

### Task 9: Checkpoint

**Files:**
- Modify: `docs/handoff.md`, `CLAUDE.md`, both plans

- [ ] **Step 1: Tick every checkbox** in this plan and add a note under any task
      where the implementation found something the plan did not anticipate.

- [ ] **Step 2: Update CLAUDE.md** with the settings store's location and the
      rule that lower layers receive slices rather than importing it — that is
      the architecture decision most likely to be undone by someone who does not
      know why it is there.

- [ ] **Step 3: Update the handoff** with the gate numbers, what is verified and
      what is not, and the next task. After this plan the highest-value action is
      unchanged and still hardware: play a match on two real devices, per
      `docs/android-debugging.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: checkpoint the settings and input plan"
```

---

## What this plan does not do

- **Nothing is verified on hardware.** Haptics needs a device, wake lock needs a
  real secure/insecure origin pair, and whether the three speeds *feel* right
  cannot be answered in a container. All three wait on the hardware run.
- **No second currency.** `venom`'s two defects — stranded at zero without
  `mutation`, and nothing worth buying — still gate any addition, unchanged.
- **The renderer's legibility work is untouched**, including the eight
  `TimelineEvent` variants that still have no board depiction.
