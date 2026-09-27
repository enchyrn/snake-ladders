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

- [x] **Step 1: Write the failing test**

- [x] **Step 2: Run it and verify it fails**

- [x] **Step 3: Implement the store**

- [x] **Step 4: Run the test and verify it passes**

- [x] **Step 5: Commit**

**Execution note:** Controller ruling R2 applied — colour validation changed from hex regex to palette-based validation. The `hex` validator was replaced with `paletteColour`, which checks against `seatColours` from `@mutation/render/palette` case-insensitively and stores the palette's own spelling. Added two test cases: a stored colour not in the palette falls back to "", and a palette colour (e.g., `#4CC2FF`) is kept with the palette's spelling (`#4cc2ff`).

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/render/src/__tests__/timing.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement it**

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

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/render/src/__tests__/timing.test.ts
```

Expected: PASS.

- [x] **Step 5: Thread the speed through the scene**

In `packages/render/src/scene.ts`:

- Add a private field `private speed = SPEEDS.calm` and a public
  `setSpeed(multiplier: number): void { this.speed = multiplier }`. Speed is
  **not** structural — unlike `quality` it must be changeable without rebuilding
  the scene, because the settings overlay sits above a live match.
- In `step`, replace `clip.duration` with
  `effectiveDuration(clip.duration, this.speed)`. Change it **only there** —
  the `duration` values pushed in `play` stay as authored, so the clip table
  above remains the source of truth and a future reader sees the real numbers.

- [x] **Step 6: Typecheck, test, and build**

```bash
nub run typecheck && nub run test && nub run build
```

Expected: all PASS.

- [x] **Step 7: Commit**

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/render/src/__tests__/motion.test.ts
```

Expected: FAIL — `motionLevel` is not exported.

- [x] **Step 3: Implement it**

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

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/render/src/__tests__/motion.test.ts
```

Expected: PASS.

- [x] **Step 5: Gate the flourishes, not the clips**

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

**Execution note:** Controller ruling R4 also applied here, since the brief's
list of flourishes wasn't exhaustive: under reduced motion, also flatten (a)
the non-absorbed `MineTripped` lift (`Math.sin(k * Math.PI) * 1.1` → the token
hugs the board, the lerp stays) and (b) `walk`'s per-step hop
(`Math.sin(local * Math.PI) * 0.28`, in the private helper `walk` just below
`play` — the tile-to-tile travel stays, only the rise per hop drops). Both are
the same flourish class the spec names ("momentum overshoot arc", "mine
shudder"); durations are unchanged and no clip left the queue. Implemented as
one `rise(amount)` helper (returns 0 when `this.motion === "reduced"`, else
`amount`) applied at every flourish site instead of a ternary at each one, to
keep each clip's `update` legible.

- [x] **Step 6: Typecheck and build**

```bash
nub run typecheck && nub run build
```

Expected: PASS.

- [x] **Step 7: Commit**

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

- [x] **Step 1: Write the failing test**

- [x] **Step 2: Run it and verify it fails**

- [x] **Step 3: Implement it**

- [x] **Step 4: Run the test and verify it passes**

- [x] **Step 5: Commit**

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/settings-panel.test.tsx
```

Expected: FAIL — module not found.

- [x] **Step 3: Build the panel**

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

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/settings-panel.test.tsx
```

Expected: PASS.

- [x] **Step 5: Wire the two entry points**

The match screen's header button (built inert in plan 1, Task 9) and a settings
button on the home screen both set the same `open` state.

- [x] **Step 6: Build, drive, and check the thing the overlay exists for**

```bash
nub run build && nub run verify:ui
```

Expected: PASS. Then confirm by hand or in a throwaway driver script that
**opening the panel mid-round does not interrupt the replay** — the board is
still animating behind it. That is the entire reason this is not a route, and a
screenshot of a static panel does not show it.

- [x] **Step 7: Commit**

```bash
git add packages/app-shell/src/app/settings-panel.tsx packages/app-shell/src/app/__tests__/settings-panel.test.tsx packages/app-shell/src/routes/match.tsx packages/app-shell/src/routes/home.tsx
git commit -m "feat: the settings overlay, which keeps the board mounted"
```

**Execution note:** `SettingsPanel` reads `useSession()` for the name field
(it writes through `session.rename`, per the You group's spec), so the given
test needed a `SessionProvider` ancestor the brief's snippet did not include.
Per controller ruling R5, the test wraps the render call in `<SessionProvider>`
and keeps the three assertions verbatim (`packages/app-shell/src/app/__tests__/settings-panel.test.tsx`).
`@effect-atom/atom-react`'s `RegistryContext` already has a module-level
default, so no extra registry wrapper was needed for `useAtom(settingsAtom)`.

Boolean settings render as the lobby's existing toggle-variant button
(label + On/Off text); the three-way settings (`rollButton`, `speed`,
`reducedMotion`, `quality`) render as a row of toggle-variant buttons with
`aria-pressed`, matching the seat switcher's existing convention rather than
introducing a radio role. Colour swatches use inline `style={{ background }}`
for the hex value (matching the seat switcher's own precedent) rather than a
dynamic Panda token string, which Panda's static extractor cannot resolve
(Panda trap #2). `haptics`/`keepAwake` are gated by `hasHaptics`/`hasWakeLock`
and simply omitted, never rendered disabled, when the probe is false.

Both match.tsx and home.tsx mount `<SettingsPanel open={..} onClose={..} />`
unconditionally (never `{open && ...}`) since the component gates its own
visibility on `open` — this is what keeps `BoardCanvas` mounted regardless of
the panel's state. home.tsx gained the same background-`inert` pattern
match.tsx already used for the round-log sheet, since it had no such overlay
before.

Step 6 verification: `nub run build && nub run verify:ui` passed clean (no
console/page errors, no horizontal overflow). For the overlay's own reason to
exist — the board must keep animating behind it — a throwaway Playwright
script (not committed) started a pass-and-play match, rolled, and opened
Settings immediately mid-replay. It wrapped `requestAnimationFrame` to count
frames rather than diffing composited screenshots (the panel sits above the
canvas in z-index, so a full-page screenshot shows only the opaque panel
either way, not what the canvas is doing underneath). The frame counter
advanced while the dialog was open (e.g. 27 → 29 across ~200ms), and after
closing, `.log li` carried the round's narration (e.g. "Taipan rolled 6") —
proving the replay was never reset or discarded. It also screenshotted the
open panel at 390×844 and 320×800 with no horizontal overflow at either
width; both were inspected by eye. Extending `scripts/drive-app.mjs` itself
was considered and skipped: the gate's existing flow doesn't yet leave a
round mid-replay at the point it would need to open Settings, and stitching
that in read as scope this task's brief didn't ask for.

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

- [x] **Step 1: Write the failing test for the one that can silently break accessibility**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/event-log-hidden.test.tsx
```

Expected: FAIL — `visible` is not a prop.

- [x] **Step 3: Wire each setting to its consumer**

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

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/event-log-hidden.test.tsx
```

Expected: PASS.

- [x] **Step 5: Prove `rollButton: "hidden"` does not strand a keyboard player**

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

- [x] **Step 6: Prove the tile-numbers toggle actually redraws**

```bash
nub run build && nub run verify:ui
```

Then drive the app, toggle `tileNumbers`, and screenshot before and after. The
stale-texture trap is invisible in the source and obvious in a screenshot:
**if the numbers are still there after turning them off, the invalidation is
missing.** A passing gate proves nothing here.

- [x] **Step 7: Lint, typecheck, test**

```bash
nub run lint && nub run typecheck && nub run test
```

Expected: all PASS. `lint` especially — if any of `packages/ui` or
`packages/render` acquired an import from `app-shell`, the layer rule fails and
the architecture has quietly been abandoned.

- [x] **Step 8: Commit**

```bash
git add packages/ui packages/render packages/app-shell/src/routes/match.tsx packages/app-shell/src/app/__tests__/roll-controls.test.tsx
git commit -m "feat: deliver each setting to its consumer as an explicit parameter"
```

**Execution note:** Step 2's RED only showed under `tsc`: vitest does not
typecheck, and the preview was already always live, so the brief's assertion
passed at runtime before `visible` existed. A second case was added (keeping
the first verbatim) asserting the list carries the `srOnly` class when off and
not when on; that one failed at runtime first. Off renders the `log` hook class
plus `srOnly` alone — not `cx`'d over the panel's classes (Panda trap 3) — and
match.tsx stops treating the empty band as a tap target, leaving the header
button as the way to the full log.

Ruling R6: importing `routes/match` in the node test environment works, so
`RollControls` is exported from match.tsx as the brief says. `ControlBar` no
longer renders `DiceTray` or takes `onRoll`/`rollDisabled`; the roll row is its
`children` whole, and card-rail.test.tsx passes `DiceTray` plus a Roll child so
its separate-rows regex and seven-button count are unchanged. No Panda class
name contains "disabled", so `not.toContain("disabled")` stayed verbatim.
`RollButton`'s atom-reading isolation was dropped: `RollControls` takes
`disabled`, and `MatchScreen` already reads `canRollAtom` to render the header,
so the isolation saved nothing.

Ruling R7: `confirmRoll` is a local arm, never sent and never `window.confirm`.
The first tap arms; the tray's name and a visible label and Roll's text become
"Confirm roll"; the second tap sends `Commit`. The arm clears on round, phase,
acting seat or the setting changing, and after the commit. A fifth
roll-controls case pins the armed labels on both controls. `DiceTray` gained an
optional `label` for this.

`tileNumbers` needed `BoardTexture` to remember the last board so
`setTileNumbers` can redraw on its own authority; `BoardScene.setTileNumbers`
forwards it, and `SceneOptions.tileNumbers` sets the first draw. Minesweeper
counts and flags are unaffected. `BoardCanvas` applies speed, motion and tile
numbers in a non-structural effect, and also applies them from a ref right
after constructing the scene, because a `quality` rebuild would otherwise
start at the scene's defaults: the presentation effect's deps do not change
on a rebuild. "Follow system" tracks `prefers-reduced-motion` live through a
`change` listener and is guarded where `matchMedia` is absent.

Step 6 was driven, not assumed: after `nub run build && nub run verify:ui`
passed, a throwaway Playwright script (not committed) started a pass-and-play
match and screenshotted the board canvas with tile numbers on, off, and on
again. The numbers were present, then gone, then back. With `rollButton`
hidden, zero "Roll" buttons remained; Tab reached "Roll the dice" and Enter
committed ("Boa rolled 3"). With confirm on, the first Enter relabelled the
tray "Confirm roll" and left the log unchanged, and the second Enter rolled.
With the round log off, `[aria-live="polite"]` was still in the DOM (1×1px,
still holding its line). No horizontal overflow.

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
