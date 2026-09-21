# Chrome and Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every screen's layout on a real design system — Panda CSS tokens and recipes, Lucide icons — so the board is the primary channel and the chrome stops being 784 lines of ad-hoc CSS.

**Architecture:** Panda generates atomic CSS at build time from tokens derived from `packages/render/src/palette.ts`, so the DOM overlay and the WebGL board cannot drift. One button recipe with variants replaces eight hand-written classes. The match screen becomes five vertical bands whose heights are a pure, tested function of player count, with the board fixed at 366 CSS px and never reduced.

**Tech Stack:** Panda CSS `1.12.1`, `lucide-react` `1.46.0`, React 19.3, Vite 8.3, TypeScript 6.0.3, Nx, nub, vitest, Playwright via `scripts/drive-app.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-17-chrome-and-layout-design.md`
(governed by ADR 0020 and ADR 0021; the match layout is drawn at
<https://claude.ai/artifact/MXucAxxrRbVbr1uo8ZYAAR>, artboard
"A — CHOSEN: edges + progress rows")

**This is plan 1 of 2.** Plan 2 implements spec A
(`2026-09-16-settings-and-input-design.md`). **This one goes first**, which
reverses what `docs/handoff.md` said before spec B existed: ADR 0021 requires
the Panda beta to be proven before anything is written against it, and spec A's
settings overlay and dice tray are UI that would otherwise be built twice.

## Global Constraints

- **nub, not npm.** `nub add`, `nub run`, `nubx`. `npm ci` fails — there is no `package-lock.json` (ADR 0017).
- **Exact versions, pinned.** `@pandacss/dev@1.12.1` and `lucide-react@1.46.0`, both added with `-E` so no `^` appears. `1.12.1` is Panda's `latest`. Do **not** "helpfully" move to the `2.0.0-beta` line: it was the original choice, and ADR 0021 was amended away from it on 2026-09-17 because `@pandacss/cli` lost its provenance attestation at `beta.11` and `nub`'s `trustPolicy=no-downgrade` refuses to install it.
- **Layer boundaries are enforced.** `layer:ui` may depend only on `engine` and `render`; `layer:render` only on `engine`. Run `nub run lint` after moving anything between packages.
- **`nub run verify:ui` does NOT build.** Always `nub run build && nub run verify:ui`. A session already watched a change pass against an eight-hour-stale `dist/`.
- **The board band is 366 CSS px and is never reduced** for any player count. Every other band gives way first.
- **No emoji in any rendered output.** Icons are Lucide or inline SVG, inheriting `currentColor`.
- **Colour tokens are derived from `packages/render/src/palette.ts`, never transcribed.**
- **Every tap target is ≥44px** (`--tap-min` today).
- **Tests** live in `<package>/src/__tests__/*.test.{ts,tsx}` and run in vitest's **node** environment. Component tests use `renderToStaticMarkup` from `react-dom/server` — there is no jsdom in this repo, and none is being added.
- **Commit at the end of every task.** Never at the end of the plan.
- Comments explain **why**, never what.

---

## File Structure

| Path | Responsibility |
|---|---|
| `panda.config.ts` | Tokens, recipes, output target. Reads the palette module. |
| `postcss.config.cjs` | Wires Panda into Vite's CSS pipeline. |
| `scripts/palette-tokens.mjs` | Turns `palette.ts`'s exports into Panda colour tokens. The single source rule, made mechanical. |
| `styled-system/` | Panda's generated output. Gitignored; produced by the codegen target. |
| `packages/ui/src/layout/bands.ts` | The match screen's band budget as a pure function. No React. |
| `packages/ui/src/icons/index.tsx` | The eight hand-drawn game glyphs. |
| `packages/ui/src/HUD.tsx` | Progress rows, card rail, legend residency. |
| `packages/ui/src/EventLog.tsx` | Preview mode and full mode; the live region is invariant. |
| `packages/app-shell/src/routes/join.tsx` | Three states, one of which does not exist today. |

---

### Task 1: Prove the Panda beta builds before anything is written against it

ADR 0021 mandates this as the first task: Panda must be proven against React
19.3, Vite 8.3, TypeScript 6.0.3 and nub's non-hoisting linker before anything
is written against it. If it fails here, it fails cheaply; if it fails in Task 9,
it fails after eight tasks of work written against it.

**This gate has already fired once.** On 2026-09-17 it refused
`@pandacss/dev@2.0.0-beta.17` — not on compatibility, but because the transitive
`@pandacss/cli` lost its provenance attestation at `beta.11`. The version was
reversed to stable `1.12.1`, which has no `@pandacss/cli` dependency and installs
cleanly. The steps below are the stable path; the evidence is in ADR 0021.

**Files:**
- Modify: `package.json` (dependencies only — via `nub add`, not by hand)
- Create: `panda.config.ts`
- Create: `postcss.config.cjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `panda codegen` and a Vite build that includes Panda's CSS. Later tasks assume `styled-system/css` and `styled-system/patterns` resolve.

- [x] **Step 1: Add the dependencies, pinned exactly**

```bash
nub add -D -E @pandacss/dev@1.12.1
nub add -E lucide-react@1.46.0
```

- [x] **Step 2: Confirm the versions landed without a caret**

```bash
grep -n "pandacss\|lucide-react" package.json
```

Expected: `"@pandacss/dev": "1.12.1"` and `"lucide-react": "1.46.0"`, no `^`.
If either shows a `^`, re-add with `-E`.

- [x] **Step 3: Write a minimal Panda config**

Tokens come in Task 3. This one only has to prove the toolchain runs.

```ts
// panda.config.ts
import { defineConfig } from "@pandacss/dev"

export default defineConfig({
  preflight: false, // apps/game-web/styles.css already owns the resets
  include: ["./packages/**/src/**/*.{ts,tsx}", "./apps/game-web/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  jsxFramework: undefined, // no styled() factory: this codebase writes plain JSX
})
```

- [x] **Step 4: Wire PostCSS**

```js
// postcss.config.cjs
module.exports = { plugins: { "@pandacss/dev/postcss": {} } }
```

- [x] **Step 5: Ignore the generated output**

Append to `.gitignore`:

```
styled-system
```

- [x] **Step 6: Run codegen and confirm it produces the entrypoints**

```bash
nubx panda codegen
ls styled-system/css
```

Expected: the directory exists and contains an `index.mjs` (or `index.js`) plus
`.d.ts` files.
**If this fails on a missing module:** declare the dependency — do not change the
linker. That is CLAUDE.md's standing rule for nub's no-hoist layout.

- [x] **Step 7: Add Panda's layers to the stylesheet**

At the very top of `apps/game-web/styles.css`, above the existing comment:

```css
@layer reset, base, tokens, recipes, utilities;
```

- [x] **Step 8: Build, and confirm the toolchain survives it**

```bash
nub run build
```

Expected: PASS. This is the ADR-mandated gate. If Panda is incompatible with
Vite 8.3 or TS 6.0.3, stop here and report it — do not work around it silently,
because ADR 0021 was accepted on the assumption that this step is cheap to
reverse.

- [x] **Step 9: Commit**

```bash
git add package.json nub.lock panda.config.ts postcss.config.cjs .gitignore apps/game-web/styles.css
git commit -m "build: adopt Panda CSS 1.12.1 and Lucide, and prove they build"
```

> **Executed 2026-09-17.** Gates on the commit: `nub run build` clean,
> `nub run test` 185 passed in 19 files, `nub run typecheck` clean,
> `nub run lint` clean. Four things the plan did not anticipate.
>
> **The version changed under this task.** `2.0.0-beta.17` is not installable:
> `nub` refuses it because the transitive `@pandacss/cli` lost its provenance
> attestation at `beta.11`, and `trustPolicy=no-downgrade` reads that as a
> supply-chain downgrade. Keeping it needed a `trustPolicyExclude` bypass. The
> tarball was verified clean anyway (ADR 0021, "Supply-chain verification") and
> the owner reversed the version to stable `1.12.1`, which has no
> `@pandacss/cli` dependency. ADR 0021 is amended; this plan's Task 1 is now the
> stable path.
>
> **"It built" is not the same as "Panda ran".** With `preflight: false` and no
> utilities authored yet, Panda contributes almost nothing visible, so a green
> build proves less than it looks. What actually proves the PostCSS plugin ran
> is `--made-with-panda:"🐼"` and Panda's `@layer base` variable block in
> `dist/assets/*.css`. Check the built CSS, not the exit code.
>
> **The `@layer` line does not survive verbatim, and that is fine.** The
> minifier splits `@layer reset, base, tokens, recipes, utilities;` into
> `@layer reset; @layer base{…} @layer tokens{…} @layer recipes,utilities;`.
> Grepping the built CSS for the original line returns zero. Order is what
> matters and it is preserved — first appearance is reset → base → tokens →
> recipes → utilities, so recipes still beat base in Task 9.
>
> **nub's vulnerability scan is silently degraded in this environment.** Every
> `nub add` printed `WARN OSV advisory check failed` because `api.osv.dev` is
> not on the egress allowlist. The install still succeeds, so it is easy to miss
> in the scroll: no advisory check ran for either dependency. The trust-policy
> check is independent of it and did run.

---

### Task 2: Make the codegen an Nx target that cannot serve stale tokens

ADR 0018 records two projects in this repo whose Nx inputs are fictional, and
`verify-ui` driving a stale `dist/` is the same defect one layer down. Panda's
`styled-system` is generated, so a target with no `outputs` means a cache hit
skips codegen and leaves whatever happens to be on disk.

**Files:**
- Modify: `apps/game-web/project.json`

**Interfaces:**
- Consumes: Task 1's `panda.config.ts`.
- Produces: an `nx run game-web:panda` target that `build` depends on.

- [x] **Step 1: Add the target and the dependency**

Replace the `targets` block of `apps/game-web/project.json` with:

```json
{
  "lint": { "executor": "nx:run-commands", "options": { "command": "eslint apps/game-web" } },
  "panda": {
    "executor": "nx:run-commands",
    "options": { "command": "panda codegen" },
    "inputs": [
      "{workspaceRoot}/panda.config.ts",
      "{workspaceRoot}/packages/render/src/palette.ts",
      "{workspaceRoot}/packages/*/src/**/*.{ts,tsx}",
      "{workspaceRoot}/apps/game-web/**/*.{ts,tsx}"
    ],
    "outputs": ["{workspaceRoot}/styled-system"]
  },
  "build": {
    "executor": "nx:run-commands",
    "dependsOn": ["panda"],
    "options": { "command": "tsc --noEmit -p apps/game-web/tsconfig.json && vite build --config apps/game-web/vite.config.ts" }
  },
  "serve": { "executor": "nx:run-commands", "dependsOn": ["panda"], "options": { "command": "vite --config apps/game-web/vite.config.ts" } },
  "typecheck": { "executor": "nx:run-commands", "dependsOn": ["panda"], "options": { "command": "tsc --noEmit -p apps/game-web/tsconfig.json" } },
  "test": { "executor": "nx:run-commands", "options": { "command": "vitest run apps/game-web" } }
}
```

`typecheck` depends on `panda` because `styled-system`'s `.d.ts` files must
exist before `tsc` runs, or a clean clone fails typecheck with missing modules.

- [x] **Step 2: Prove a cache hit RESTORES the output rather than skipping it**

This is the whole point of the task, and it is the step that catches the
ADR 0018 defect.

```bash
nubx nx run game-web:panda          # populate the cache
rm -rf styled-system
nubx nx run game-web:panda          # must be a cache hit
ls styled-system/css
```

Expected: the second run reports a cache hit **and** `styled-system/css` exists
again. If the directory is missing after a cache hit, `outputs` is wrong — fix
it before continuing. A cache that restores nothing is worse than no cache,
because it looks like it worked.

- [x] **Step 3: Confirm the full build still passes**

```bash
nub run build
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add apps/game-web/project.json
git commit -m "build: make panda codegen a cached Nx target with declared outputs"
```


> **Executed 2026-09-17.** Gates: `nub run build` clean, `nub run test` 185 in
> 19 files, `nub run lint` clean. Step 2 caught two defects in the JSON this
> plan prescribes, which is the task working as intended.
>
> **The prescribed target never caches, so Step 2 cannot pass as written.** An
> `nx:run-commands` target is not cacheable by default; it needs an explicit
> `"cache": true`, and `nx.json`'s `targetDefaults` has no `panda` entry to
> supply one. Without it every run reports `Cache: 0/1 hit (0%)` and `outputs`
> is inert — codegen simply re-runs each time. Safe, but not what the task asks
> for, and the "prove a cache hit restores the output" step silently has nothing
> to prove. With `"cache": true`, deleting `styled-system/` and re-running gives
> `Cache: 1/1 hit (100%)` **and** puts the directory back.
>
> **`nub run typecheck` does not go through Nx at all**, so the `dependsOn:
> ["panda"]` this task adds to the `typecheck` target never fires for the
> command CLAUDE.md documents — the root script was a bare `tsc --noEmit`.
> Verified by deleting `styled-system/` and running it: codegen did not run.
> That is this task's stated rationale for the dependency ("a clean clone fails
> typecheck with missing modules") defeated by the script layer, and it would
> have fired in Task 3 at the first `styled-system/css` import.
>
> Fixed as `nx run game-web:panda && tsc --noEmit`, **not** by pointing the
> script at `nx run game-web:typecheck`: that target compiles only
> `apps/game-web/tsconfig.json`, so the obvious one-line swap would have
> narrowed the gate from the whole workspace to one app while looking like a
> tidy-up. Same shape as the `verify-ui` trap — a documented command that does
> less than its name says.
>
> **Still open, same root cause:** `nub run test` is a bare `vitest run` and is
> not covered by this fix. It does not matter yet, but Task 10 writes component
> tests, and if any of them import `styled-system/*` a clean clone will fail
> there for exactly the reason typecheck would have.

---

### Task 3: Derive colour tokens from palette.ts, and fix the seat colour that is already wrong

`apps/game-web/styles.css` opens by claiming it "mirrors `src/render/palette.ts`
so the DOM overlay and the WebGL board never drift into two different dark
themes". Nothing enforces that. This task makes it mechanical — and the test
written to enforce it fails immediately on a real defect.

**Files:**
- Create: `scripts/palette-tokens.mjs`
- Create: `packages/render/src/__tests__/palette.test.ts`
- Modify: `packages/render/src/palette.ts`
- Modify: `panda.config.ts`

**Interfaces:**
- Consumes: Task 1's config.
- Produces: `hueOf(hex: string): number` and `RESERVED_LINK_HUE: readonly [number, number]` exported from `packages/render/src/palette.ts`; Panda tokens `colors.seat.0`–`colors.seat.5`, `colors.void`, `colors.surface`, `colors.surfaceRaised`, `colors.border`, `colors.text`, `colors.textDim`, `colors.ladder`, `colors.snake`, `colors.mine`, `colors.flag`, `colors.finish`.

- [x] **Step 1: Write the failing test**

`renderer-legibility` reserves the green family for link tinting. A seat colour
inside that band fights the snakes.

```ts
// packages/render/src/__tests__/palette.test.ts
import { describe, expect, it } from "vitest"
import { hueOf, RESERVED_LINK_HUE, seatColours } from "../palette"

describe("hueOf", () => {
  it("reads the hue of a hex colour", () => {
    expect(Math.round(hueOf("#ff0000"))).toBe(0)
    expect(Math.round(hueOf("#00ff00"))).toBe(120)
    expect(Math.round(hueOf("#0000ff"))).toBe(240)
  })
})

describe("seat colours", () => {
  // renderer-legibility reserves the green family for link tinting, so a seat
  // in that band is indistinguishable from the snakes it has to be read against.
  it("keeps every seat out of the reserved link-tint band", () => {
    const [low, high] = RESERVED_LINK_HUE
    const offenders = seatColours.filter((hex) => {
      const hue = hueOf(hex)
      return hue >= low && hue <= high
    })

    expect(offenders).toEqual([])
  })

  it("has one colour per seat, for a match capped at six players", () => {
    expect(seatColours).toHaveLength(6)
  })
})
```

- [x] **Step 2: Run it and watch it fail on the real defect**

```bash
nubx vitest run packages/render/src/__tests__/palette.test.ts
```

Expected: FAIL. `hueOf` is not exported yet. Once it is, the second test fails
with `["#4ee39b"]` — seat 4's mint sits at ~151°, inside the reserved band. That
is a live defect, not a hypothetical: the fifth player's token already fights
the snakes today.

- [x] **Step 3: Add the hue helper and the reserved band**

Append to `packages/render/src/palette.ts`:

```ts
/** The green family `renderer-legibility` reserves for tinting snakes and
 *  ladders. A seat inside it cannot be told from the links it sits on. */
export const RESERVED_LINK_HUE = [100, 165] as const

export const hueOf = (hex: string): number => {
  const n = Number.parseInt(hex.replace("#", ""), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  const h =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (h * 60 + 360) % 360
}
```

- [x] **Step 4: Replace the offending seat colour**

In `seatColours`, replace `"#4ee39b", // mint` with:

```ts
  "#3fd0c9", // teal — mint (#4ee39b, ~151°) sat inside the reserved link band
```

- [x] **Step 5: Run the test and watch it pass**

```bash
nubx vitest run packages/render/src/__tests__/palette.test.ts
```

Expected: PASS.

**Record this in the spec's margin when you commit:** teal is ~177°, which is
23° from seat 0's cyan (~200°). Six hues minus a 65° reserved band is genuinely
tight, and hue alone is near its limit at six seats. The proper fix — re-spacing
all six across the 300° of non-reserved arc, or distinguishing seats by shape as
well as hue — belongs to `renderer-legibility` §"Identity without colour",
which is unbuilt. Do not attempt it here.

- [x] **Step 6: Write the token generator**

```js
// scripts/palette-tokens.mjs
/**
 * Panda's colour tokens are generated from palette.ts rather than written
 * beside it, because the DOM overlay and the WebGL board drifting apart is a
 * bug nobody sees until two devices look different. ADR 0021.
 */
import { palette, seatColours } from "../packages/render/src/palette.ts"

const value = (v) => ({ value: v })

export const colourTokens = {
  ...Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, value(v)])),
  seat: Object.fromEntries(seatColours.map((hex, i) => [String(i), value(hex)])),
}
```

- [x] **Step 7: Read the palette module's actual exports before wiring it**

```bash
grep -n "^export" packages/render/src/palette.ts
```

The generator above assumes a `palette` object export. If `palette.ts` exports
individual constants instead, adjust `palette-tokens.mjs` to name them
explicitly — do not invent an export that is not there.

- [x] **Step 8: Add spacing and type scales, and the tokens, to the config**

In `panda.config.ts`, add a `theme` block:

```ts
import { colourTokens } from "./scripts/palette-tokens.mjs"

// ... inside defineConfig:
  theme: {
    extend: {
      tokens: {
        colors: colourTokens,
        spacing: {
          "1": { value: "4px" }, "2": { value: "8px" }, "3": { value: "12px" },
          "4": { value: "16px" }, "5": { value: "24px" }, "6": { value: "32px" },
        },
        fontSizes: {
          xs: { value: "12px" }, sm: { value: "13px" }, md: { value: "15px" },
          lg: { value: "18px" }, xl: { value: "24px" }, display: { value: "32px" },
        },
        sizes: { tap: { value: "44px" }, board: { value: "366px" } },
      },
    },
  },
```

- [x] **Step 9: Declare the one breakpoint the app actually has**

The app is phone-first and stays so. The existing single `@media (max-width:
380px)` rule becomes a named breakpoint, so the 320–380 band — where the
progress rows and card rail are tightest — is expressible in a recipe rather
than in one hand-written query at the bottom of the stylesheet.

In `panda.config.ts`, inside `theme.extend`:

```ts
      breakpoints: { sm: "380px" },
```

Panda's breakpoints are min-width, so `sm` means "380px and wider" and the
tight band is the **unprefixed** base. Author the base styles for 320px and
widen at `sm`, not the other way round — inverting this is how a layout ends
up untested at its narrowest.

- [x] **Step 10: Regenerate, build, and run the full suite**

```bash
nubx nx run game-web:panda && nub run build && nub run test
```

Expected: all PASS.

- [x] **Step 11: Commit**

```bash
git add panda.config.ts scripts/palette-tokens.mjs packages/render/src/palette.ts packages/render/src/__tests__/palette.test.ts
git commit -m "feat: derive colour tokens from palette.ts, and move seat 4 out of the link-tint band"
```


> **Executed 2026-09-17.** Gates: `nub run test` **188 passed in 20 files**
> (was 185 in 19 — the three new ones are this task's), `nub run typecheck`
> clean, `nub run lint` clean, `nub run build` clean, and `nub run verify:ui`
> clean on that fresh build with the board, HUD, card rail and legend
> rendering correctly. Step 2 failed exactly as written — `["#4ee39b"]`, the
> lone offender — so the defect was observed before it was fixed rather than
> taken on the plan's word.
>
> **The stylesheet had already drifted, and the task's own Step 4 would have
> widened the gap.** `apps/game-web/styles.css` transcribed all six seat
> colours as `--seat-0` … `--seat-5`, including `--seat-4: #4ee39b`. Changing
> only `palette.ts` leaves the DOM overlay holding mint while the WebGL board
> gets teal — precisely the drift this task exists to make impossible, created
> by the fix for it. The six declarations turned out to have **zero
> consumers** (nothing reads `var(--seat-N)`; every real consumer calls
> `seatColour()` from `palette.ts`, in `HUD.tsx`, `scene.ts` and `lobby.tsx`),
> so they were **deleted** rather than re-transcribed with the new value.
> Re-transcribing would have left the trap armed for the next palette edit.
> `verify:ui` confirms nothing regressed.
>
> **Step 6's generator does not produce three tokens the task's own
> "Interfaces" section promises.** `colors.surface`, `colors.surfaceRaised` and
> `colors.border` are not in `palette`; the stylesheet defines them as aliases
> (`--surface: var(--board-dark)` and so on). The generator now derives them
> from `palette.boardDark`/`boardLight`/`boardEdge` rather than restating the
> hexes, so a palette edit still reaches them and the "never transcribed"
> constraint holds.
>
> **`panda.config.ts` is not in the tsc program**, so `nub run typecheck` does
> not cover it — verified with `tsc --noEmit --listFiles`, which matches it
> zero times. A type error in the config surfaces only as a codegen failure.
> That is survivable because codegen runs ahead of both `build` and
> `typecheck` (Task 2), but it means the config is gated by Panda, not by TypeScript.
>
> **A second seat/link collision the predicate does not catch.** Seat 2's amber
> is ~45° and `ladder` is ~40°. `RESERVED_LINK_HUE` covers only the green
> family, so the test passes; the two are separated by saturation, not hue.
> Recorded in the spec's margin and left to `renderer-legibility` with the
> re-spacing work, per this task's own instruction not to attempt it here.

---

### Task 4: One button recipe replaces eight hand-written classes

The survey found `.primary`, `.roll`, `.module-toggle`, `.card`, `.add-player`,
`.remove-player`, `.view-reset` and `.seat-switch` styled independently, which
is why the join screen's button is small and left-aligned while home's are
full-width slabs.

**Files:**
- Modify: `panda.config.ts`
- Create: `packages/ui/src/__tests__/button-recipe.test.ts`

**Interfaces:**
- Produces: a `button` recipe with `variant: "primary" | "secondary" | "ghost" | "card" | "toggle"` and `size: "sm" | "md" | "lg"`, imported as `import { button } from "styled-system/recipes"`.

- [x] **Step 1: Write the failing test**

A recipe is config, so the test pins the contract other tasks rely on rather
than the CSS it emits.

```ts
// packages/ui/src/__tests__/button-recipe.test.ts
import { describe, expect, it } from "vitest"
import config from "../../../../panda.config"

const recipe = () => {
  const recipes = config.theme?.extend?.recipes ?? {}
  return recipes.button
}

describe("the button recipe", () => {
  it("covers every button this app has", () => {
    expect(Object.keys(recipe().variants.variant).sort()).toEqual([
      "card", "ghost", "primary", "secondary", "toggle",
    ])
  })

  // Every variant is a real tap target on a phone; the survey found buttons
  // that were not.
  it("never defines a size below the 44px tap minimum", () => {
    for (const size of Object.values(recipe().variants.size)) {
      expect(size.minHeight).toBe("tap")
    }
  })
})
```

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/button-recipe.test.ts
```

Expected: FAIL — `recipe()` returns `undefined`.

- [x] **Step 3: Define the recipe**

In `panda.config.ts`, inside `theme.extend`:

```ts
      recipes: {
        button: {
          className: "btn",
          base: {
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            gap: "2", borderRadius: "10px", fontFamily: "inherit", fontWeight: 600,
            cursor: "pointer", border: "1px solid transparent",
            _disabled: { opacity: 0.45, cursor: "default" },
          },
          variants: {
            variant: {
              primary: { bg: "finish", color: "void", fontWeight: 700 },
              secondary: { bg: "surfaceRaised", color: "text", borderColor: "border" },
              ghost: { bg: "transparent", color: "textDim" },
              card: { bg: "surfaceRaised", color: "text", borderColor: "border", flexDirection: "column", gap: "1" },
              toggle: { bg: "surfaceRaised", color: "text", borderColor: "border" },
            },
            size: {
              sm: { minHeight: "tap", px: "3", fontSize: "xs" },
              md: { minHeight: "tap", px: "4", fontSize: "md" },
              lg: { minHeight: "tap", px: "5", fontSize: "lg", height: "64px" },
            },
          },
          defaultVariants: { variant: "secondary", size: "md" },
        },
      },
```

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/button-recipe.test.ts
```

Expected: PASS.

- [x] **Step 5: Regenerate and typecheck**

```bash
nubx nx run game-web:panda && nub run typecheck
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add panda.config.ts packages/ui/src/__tests__/button-recipe.test.ts
git commit -m "feat: one button recipe with variants, replacing eight ad-hoc classes"
```


> **Executed 2026-09-21.** Gates: `nub run test` **190 passed in 21 files**
> (was 188 in 20), `nub run typecheck` clean, `nub run lint` clean, `nub run
> build` clean, `nub run verify:ui` clean on that fresh build.
>
> **The task's title overclaims, and the commit message it prescribes repeats
> the overclaim.** Nothing is replaced here. The recipe is defined and pinned;
> all eight hand-written classes are still in `styles.css` (`button.primary`,
> `.roll`, `.module-toggle`, `.card`, `.add-player`, `.remove-player`,
> `.view-reset`, `.seat-switch`), the file is still 779 lines, **nothing
> imports `styled-system/recipes`, and therefore Panda emits no `.btn` CSS at
> all** — it only generates rules for recipes the scanned source actually uses.
> That is correct for this task, whose Files list touches no component, but it
> means the replacement is entirely ahead in Tasks 7-9. The commit message was
> reworded to say what the change does.
>
> **Step 1's test as written fails `nub run lint`.** `import config from
> "../../../../panda.config"` escapes the package, and
> `@nx/enforce-module-boundaries` rejects it: *"External resources cannot be
> imported using a relative or absolute path"*. The plan's own Global
> Constraints require that gate, so the task contradicts itself. Fixed the way
> the repo already handles this exact shape — `@mutation/relay` is aliased and
> named in the rule's `allow` list, with a comment saying the point is "one
> visible line rather than a `../../../..` that reaches past the rule unseen".
> Added `@mutation/panda-config` to `tsconfig.json` paths, `vitest.config.ts`
> aliases and the `allow` list.
>
> **Testing the generated output instead was considered and rejected**, though
> the task's own Interfaces section describes consumers importing from
> `styled-system/recipes`. `styled-system/` is gitignored and `nub run test` is
> a bare `vitest run` that does not invoke codegen — so a test importing it
> fails on a clean clone. That is the trap Task 2's note already flagged as
> waiting for Task 10, and it is still open.
>
> **This task falsifies Task 3's note that `panda.config.ts` is not in the tsc
> program.** Importing the config from a test pulls it in, and it arrived with
> a latent error: `TS7016`, because `scripts/palette-tokens.mjs` had no
> declarations. Added `scripts/palette-tokens.d.mts` typing `colourTokens` as
> Panda's own `NonNullable<Tokens["colors"]>`, so the boundary is typed rather
> than suppressed. The config is now genuinely covered by `nub run typecheck`,
> which it was not before.
>
> **Step 1's test could not fail for the right reason under strict TS.**
> `recipe().variants.variant` is `possibly undefined` with
> `noUncheckedIndexedAccess`, so it cost three `TS2532`/`TS2769` errors. It now
> throws an explicit "panda.config defines no button recipe" instead of
> optional-chaining into a vacuous pass — verified by deleting the recipe and
> watching both tests fail, then restoring it.

---

### Task 5: Icons — Lucide for the vocabulary, hand-drawn for the game's nouns

Every glyph today is an emoji in a text node (`☣ » ⚓ 💤 ⚑ ✸ ⟲ ‹`), so it renders
in the platform emoji font: a different picture on Android, iOS and desktop,
un-recolourable, un-alignable.

**Files:**
- Create: `packages/ui/src/icons/index.tsx`
- Create: `packages/ui/src/__tests__/icons.test.tsx`

**Interfaces:**
- Produces: `VenomIcon`, `MineIcon`, `LadderIcon`, `SnakeIcon`, `FlagIcon`, `MomentumIcon`, `AnchorIcon`, `StunIcon`, each `(props: { readonly size?: number; readonly title?: string }) => JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/icons.test.tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import * as icons from "../icons"

const all = Object.entries(icons)

describe("the game's own glyphs", () => {
  it("draws all eight", () => {
    expect(all).toHaveLength(8)
  })

  // currentColor is the whole point: an emoji could not be tinted per seat,
  // and these have to sit on a board whose palette they must obey.
  it("inherits its colour rather than hard-coding one", () => {
    for (const [name, Icon] of all) {
      const html = renderToStaticMarkup(<Icon />)
      expect(html, name).toContain("currentColor")
      expect(html, name).not.toMatch(/#[0-9a-f]{3,6}/i)
    }
  })

  it("matches Lucide's 24-unit grid and 2px stroke", () => {
    for (const [name, Icon] of all) {
      const html = renderToStaticMarkup(<Icon />)
      expect(html, name).toContain('viewBox="0 0 24 24"')
      expect(html, name).toContain('stroke-width="2"')
    }
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/icons.test.tsx
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Draw the eight glyphs**

```tsx
// packages/ui/src/icons/index.tsx
/**
 * The game's own nouns. Lucide has no venom, mine or ladder, so these are
 * drawn to its grid and stroke weight — a mismatch reads as two icon sets
 * rather than one (ADR 0021).
 */
import type { JSX } from "react"

interface IconProps {
  readonly size?: number
  readonly title?: string
}

const Svg = ({ size = 20, title, d }: IconProps & { readonly d: JSX.Element }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title ? <title>{title}</title> : null}
    {d}
  </svg>
)

export const VenomIcon = (p: IconProps) => (
  <Svg {...p} d={<><circle cx="12" cy="12" r="3" /><path d="M12 9V4M9.4 13.5 5.1 16M14.6 13.5l4.3 2.5" /></>} />
)
export const MineIcon = (p: IconProps) => (
  <Svg {...p} d={<><circle cx="12" cy="12" r="5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>} />
)
export const LadderIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="M7 3v18M17 3v18M7 8h10M7 13h10M7 18h10" /></>} />
)
export const SnakeIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="M4 18c4 0 4-5 8-5s4 5 8 5" /><path d="M20 18v-2" /><circle cx="19" cy="14" r="1" /></>} />
)
export const FlagIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" /></>} />
)
export const MomentumIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="m5 7 5 5-5 5M13 7l5 5-5 5" /></>} />
)
export const AnchorIcon = (p: IconProps) => (
  <Svg {...p} d={<><circle cx="12" cy="5" r="2" /><path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 11H5M19 11h-3" /></>} />
)
export const StunIcon = (p: IconProps) => (
  <Svg {...p} d={<><path d="M4 8h7l-7 8h7M14 5h6l-6 7h6" /></>} />
)
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/icons.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/icons packages/ui/src/__tests__/icons.test.tsx
git commit -m "feat: the game's eight glyphs as inline SVG on Lucide's grid"
```

---

### Task 6: The band budget as a pure, tested function

The match screen's layout is arithmetic, and the spec claims it closes for every
legal player count. Claims like that are tested, not hoped.

**Files:**
- Create: `packages/ui/src/layout/bands.ts`
- Create: `packages/ui/src/__tests__/bands.test.ts`

**Interfaces:**
- Produces: `bands(players: number, viewportPx: number): Bands` where `Bands` is `{ header, rows, board, log, controls }`, all numbers in CSS px; and the constants `BOARD_PX = 366`, `LOG_LINE_PX = 22`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/__tests__/bands.test.ts
import { describe, expect, it } from "vitest"
import { bands, BOARD_PX, LOG_LINE_PX } from "../layout/bands"

const PHONE = 844

describe("the match screen's band budget", () => {
  // match.ts:195 caps a match at six players, so the worst case is bounded and
  // the board never has to give way. That is the whole claim.
  it.each([2, 3, 4, 5, 6])("keeps the board at its full size with %i players", (players) => {
    expect(bands(players, PHONE).board).toBe(BOARD_PX)
  })

  it.each([2, 3, 4, 5, 6])("leaves room for two log lines with %i players", (players) => {
    expect(bands(players, PHONE).log).toBeGreaterThanOrEqual(2 * LOG_LINE_PX)
  })

  it("matches the spec's worked numbers", () => {
    expect(bands(2, PHONE)).toMatchObject({ rows: 61, log: 235 })
    expect(bands(3, PHONE)).toMatchObject({ rows: 90, log: 206 })
    expect(bands(6, PHONE)).toMatchObject({ rows: 177, log: 119 })
  })

  // On a shorter screen the log gives way first and the board still does not.
  it("sacrifices the log before the board", () => {
    const short = bands(6, 700)
    expect(short.board).toBe(BOARD_PX)
    expect(short.log).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/bands.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
// packages/ui/src/layout/bands.ts
/**
 * The match screen is five vertical bands. The board is square while the phone
 * is 1:2.2, so the board can never fill the height — at 390 wide it maxes out
 * at 366, about 43%. The design question is what the rest does, and this is
 * the answer in numbers. Spec: 2026-09-17-chrome-and-layout-design.md.
 */
export const BOARD_PX = 366
export const HEADER_PX = 52
export const CONTROLS_PX = 130
export const ROW_PX = 20
export const ROW_GAP_PX = 9
export const ROWS_PAD_PX = 12
export const LOG_LINE_PX = 22

export interface Bands {
  readonly header: number
  readonly rows: number
  readonly board: number
  readonly log: number
  readonly controls: number
}

const rowsHeight = (players: number): number =>
  players <= 0 ? 0 : players * ROW_PX + (players - 1) * ROW_GAP_PX + ROWS_PAD_PX

export const bands = (players: number, viewportPx: number): Bands => {
  const rows = rowsHeight(players)
  // The board is the primary channel (ADR 0020): it is subtracted, never
  // squeezed, and the log absorbs whatever is left over or missing.
  const log = Math.max(0, viewportPx - HEADER_PX - rows - BOARD_PX - CONTROLS_PX)
  return { header: HEADER_PX, rows, board: BOARD_PX, log, controls: CONTROLS_PX }
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/bands.test.ts
```

Expected: PASS, including the three worked numbers from the spec.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/layout packages/ui/src/__tests__/bands.test.ts
git commit -m "feat: the match screen's band budget as a tested pure function"
```

---

### Task 7: Progress rows replace the bare digit and the 40px stub

`PlayerStrip` renders position as a numeral ("● Mamba 5") and `.progress-bar`
renders as a ~40px stub that reads as a rendering artifact. ADR 0020 rule 3
allows digits where a digit is the honest unit; a player's position in a race
is not one — the race is.

**Files:**
- Modify: `packages/ui/src/HUD.tsx`
- Create: `packages/ui/src/__tests__/progress-rows.test.tsx`

**Interfaces:**
- Consumes: `bands` (Task 6), `seatColour` from `@mutation/render/palette`.
- Produces: `ProgressRows({ state, actingSeat }: { state: MatchState; actingSeat: string })`, replacing the exported `PlayerStrip` and `Progress`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/progress-rows.test.tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchState } from "@mutation/engine/types"
import { ProgressRows } from "../HUD"

const withPlayers = (positions: ReadonlyArray<number>): MatchState => {
  const base = initialMatch(defaultConfig(4242))
  return {
    ...base,
    players: positions.map((position, seat) => ({
      ...base.players[0]!,
      id: `p${seat}`,
      name: `P${seat}`,
      seat,
      position,
    })),
  }
}

describe("ProgressRows", () => {
  it("draws one row per player", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([10, 50])} actingSeat="p0" />)
    expect(html.match(/role="progressbar"/g)).toHaveLength(2)
  })

  // ADR 0020: the race is shown, not reported. A tile number on this row would
  // be the number game leaking back into the chrome it was removed from.
  it("shows the race rather than printing the tile", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([37])} actingSeat="p0" />)
    expect(html).not.toContain(">37<")
    expect(html).toContain('aria-valuenow="37"')
  })

  it("marks whose turn it is without relying on colour alone", () => {
    const html = renderToStaticMarkup(<ProgressRows state={withPlayers([1, 1])} actingSeat="p1" />)
    expect(html).toContain('data-acting="true"')
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/progress-rows.test.tsx
```

Expected: FAIL — `ProgressRows` is not exported.

- [ ] **Step 3: Replace PlayerStrip and Progress with ProgressRows**

In `packages/ui/src/HUD.tsx`, delete the `PlayerStrip` and `Progress` exports
and add:

```tsx
/**
 * One row per player: swatch, name, and a bar showing how far along the board
 * they are. This replaces both the tile numeral in the old PlayerStrip and the
 * 5%-wide stub the old Progress rendered — a player reads the race off the
 * bars' relative lengths (ADR 0020). The tile number stays on the board.
 */
export const ProgressRows = ({
  state,
  actingSeat,
}: {
  readonly state: MatchState
  readonly actingSeat: string
}) => {
  const top = lastTile(state.config.size)
  return (
    <ul className={css({ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: "9px" })}>
      {state.players.map((player) => (
        <li
          key={player.id}
          data-acting={player.id === actingSeat}
          className={css({ display: "flex", alignItems: "center", gap: "9px" })}
        >
          <span
            className={css({ w: "14px", h: "14px", borderRadius: "50%", flex: "none" })}
            style={{ background: seatColour(player.seat) }}
          />
          <span className={css({ fontSize: "sm", fontWeight: 600, w: "54px", truncate: true })}>
            {player.name}
          </span>
          <span
            role="progressbar"
            aria-label={player.name}
            aria-valuenow={player.position}
            aria-valuemin={0}
            aria-valuemax={top}
            className={css({ flexGrow: 1, h: "10px", borderRadius: "5px", bg: "surface", overflow: "hidden" })}
          >
            <span
              className={css({ display: "block", h: "100%", borderRadius: "5px" })}
              style={{ width: `${(player.position / top) * 100}%`, background: seatColour(player.seat) }}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}
```

Add `import { css } from "styled-system/css"` at the top of the file.

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/progress-rows.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Update the one consumer**

In `packages/app-shell/src/routes/match.tsx`, replace the `PlayerStrip` and
`Progress` imports and usages with `ProgressRows`, passing `state={match}` and
`actingSeat={actingSeat}`.

- [ ] **Step 6: Typecheck, lint and test**

```bash
nub run typecheck && nub run lint && nub run test
```

Expected: all PASS. `lint` matters here — `HUD.tsx` is `layer:ui` and must not
have acquired an import from `app-shell`.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/HUD.tsx packages/ui/src/__tests__/progress-rows.test.tsx packages/app-shell/src/routes/match.tsx
git commit -m "feat: progress rows replace the tile numeral and the progress stub"
```

---

### Task 8: The control bar — five cards that flex, and a real dice tray

The survey found `.roll` at `flex: none; min-width: 6rem` leaving ~294px for
~440px of cards. They scroll, so they are reachable, but the only hint is a
half-clipped "Double". Flexing five across 366px is ~70px each — above the 44px
minimum — so the problem disappears by construction.

The dice tray is built here, as a DOM control. Plan 2's `rollButton` setting
depends on it existing: `RollButton` is currently the only keyboard-reachable
path to `Commit`, and `Scene.pick` raycasts the board plane only, so a
canvas-picked tray would not be reachable at all.

**Files:**
- Modify: `packages/ui/src/HUD.tsx`
- Modify: `packages/app-shell/src/routes/match.tsx`
- Create: `packages/ui/src/__tests__/card-rail.test.tsx`

**Interfaces:**
- Consumes: the button recipe (Task 4), the icons (Task 5).
- Produces: `CardRail` keeps its existing props; `DiceTray({ onRoll, disabled }: { onRoll: () => void; disabled: boolean })` exported from `packages/ui/src/HUD.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/card-rail.test.tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig } from "@mutation/engine/types"
import { CardRail, DiceTray } from "../HUD"

const state = () => initialMatch({ ...defaultConfig(11), modules: ["mutation", "minesweeper"] })

describe("CardRail", () => {
  // A card that cannot be afforded used to be indistinguishable from one that
  // is not there. ADR 0020: a state change the player is not shown is a defect.
  it("keeps an unaffordable card on screen, disabled", () => {
    const me = { ...state().players[0]!, venom: 0 }
    const html = renderToStaticMarkup(
      <CardRail me={me} state={state()} onPlay={() => {}} disabled={false} />,
    )
    expect(html.match(/<button/g)).toHaveLength(5)
    expect(html).toContain("disabled")
  })
})

describe("DiceTray", () => {
  // The tray is what lets plan 2 offer rollButton: hidden. If it is not a real
  // button, hiding Roll removes the only keyboard route to Commit.
  it("is a real button, not a canvas hit target", () => {
    const html = renderToStaticMarkup(<DiceTray onRoll={() => {}} disabled={false} />)
    expect(html).toContain("<button")
    expect(html).toContain("aria-label")
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/card-rail.test.tsx
```

Expected: FAIL — `DiceTray` is not exported, and `CardRail` renders four
buttons because `defuse` is filtered and unaffordable cards are dropped.

- [ ] **Step 3: Make the rail flex and keep disabled cards present**

In `CardRail`, change the wrapper to `css({ display: "flex", gap: "6px" })` —
**no `overflow-x`** — and give each card `flex: "1 1 0"` with `minWidth: 0`.
Render all five cards; a card the player cannot afford or has already played
renders with `disabled` rather than being filtered out. Replace the `☣{cost}`
span with `<VenomIcon size={12} />{cost}`.

- [ ] **Step 4: Add the dice tray**

```tsx
/**
 * The input affordance, which is a different object from `Dice.show`'s
 * rendered outcome — an input control inside the renderer is what ADR 0007
 * exists to prevent. It is a real <button> so that hiding the Roll button
 * (plan 2) does not remove the only keyboard path to Commit.
 */
export const DiceTray = ({
  onRoll,
  disabled,
}: {
  readonly onRoll: () => void
  readonly disabled: boolean
}) => (
  <button
    type="button"
    aria-label="Roll the dice"
    disabled={disabled}
    onClick={onRoll}
    className={button({ variant: "secondary", size: "lg" })}
  >
    <span aria-hidden className={css({ display: "flex", gap: "5px" })}>
      <span className={css({ w: "24px", h: "24px", borderRadius: "5px", bg: "text" })} />
      <span className={css({ w: "24px", h: "24px", borderRadius: "5px", bg: "text" })} />
    </span>
  </button>
)
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/card-rail.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Wire the tray into the match screen**

In `match.tsx`, put `DiceTray` beside `RollButton` in the control bar, both
sending `{ _tag: "Commit", playerId: seat }`. Both read `canRollAtom` for their
disabled state.

- [ ] **Step 7: Build and drive it**

```bash
nub run build && nub run verify:ui
```

Expected: PASS, no console errors, no horizontal overflow. **Open
`screenshots/5-rolled.png` and confirm all five cards are visible at once.**
This is the survey finding; a green gate that still shows three cards means the
flex did not take.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/HUD.tsx packages/ui/src/__tests__/card-rail.test.tsx packages/app-shell/src/routes/match.tsx
git commit -m "feat: the card rail flexes to five, and the dice tray is a real button"
```

---

### Task 9: The five bands, the log preview, and the legend's residency

**Files:**
- Modify: `packages/app-shell/src/routes/match.tsx`
- Modify: `packages/ui/src/EventLog.tsx`
- Create: `packages/ui/src/__tests__/event-log-preview.test.tsx`

**Interfaces:**
- Consumes: `bands` (Task 6), `ProgressRows` (Task 7), `DiceTray` (Task 8).
- Produces: `EventLog({ state, mode }: { state: MatchState; mode?: "preview" | "full" })`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/event-log-preview.test.tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { initialMatch } from "@mutation/engine/match"
import { defaultConfig, type MatchState } from "@mutation/engine/types"
import type { TimelineEvent } from "@mutation/engine/events"
import { EventLog } from "../EventLog"

const rolled = (n: number): TimelineEvent =>
  ({ _tag: "Rolled", playerId: "a", dice: [n], total: n, momentumBonus: 0 }) as TimelineEvent

const withTimeline = (): MatchState => ({
  ...initialMatch(defaultConfig(7)),
  timeline: [rolled(1), rolled(2), rolled(3), rolled(4)],
})

describe("EventLog", () => {
  it("shows the last two lines in preview mode", () => {
    const html = renderToStaticMarkup(<EventLog state={withTimeline()} mode="preview" />)
    expect(html.match(/<li/g)).toHaveLength(2)
  })

  // ADR 0020 rule 2: this list is how a screen-reader player receives a round
  // at all, so no mode may take it out of the tree.
  it("keeps the live region in every mode", () => {
    for (const mode of ["preview", "full"] as const) {
      const html = renderToStaticMarkup(<EventLog state={withTimeline()} mode={mode} />)
      expect(html, mode).toContain('aria-live="polite"')
    }
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/event-log-preview.test.tsx
```

Expected: FAIL — `mode` is not a prop; preview renders all four lines.

- [ ] **Step 3: Add the mode**

In `EventLog.tsx`, accept `mode: "preview" | "full" = "full"` and slice the
lines to the last two in preview. **Do not early-return `null` for an empty
timeline in preview mode** — return the empty `<ul>` with its `aria-live`
attribute, so the live region is present before the first round.

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/event-log-preview.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Lay the match screen out as five bands**

Rewrite `MatchScreen`'s returned tree as, top to bottom: a 52px header (turn
text, round-log button, settings button — the settings button is inert until
plan 2); `ProgressRows`; a fixed 366px board band holding `BoardCanvas`; the
log preview, taking the remaining space; and the control bar holding `CardRail`
then `DiceTray` and `RollButton`.

Use `bands(match.players.length, window.innerHeight)` only for the log band's
`maxHeight`; the board band gets a literal `h: "board"` token so it cannot be
squeezed by a flex miscalculation.

- [ ] **Step 6: Turn `⟲ Reset view` into an icon button**

`BoardCanvas.tsx:130` renders `⟲ Reset view` — an emoji in a text node, so it
is a different picture per platform. Replace the glyph with Lucide's
`RotateCcw` beside the text, keeping the visible label: the control appears
only after the player has orbited, so it has no established shape to recognise
and an icon alone would be a puzzle.

- [ ] **Step 7: Make the legend conditional**

`MineLegend` renders only when the minesweeper module is on **and** no tile has
been revealed yet. Once a tile is revealed the board shows what the legend
explains, and it retires.

- [ ] **Step 8: Build and drive it**

```bash
nub run build && nub run verify:ui
```

Expected: PASS. **Open `screenshots/4-match.png` and `5-rolled.png`** and
confirm: the board is visibly the dominant element, the progress rows are at the
top, the log sits below the board rather than above it, and the legend is gone
once a tile is revealed.

- [ ] **Step 9: Commit**

```bash
git add packages/app-shell/src/routes/match.tsx packages/ui/src/BoardCanvas.tsx packages/ui/src/EventLog.tsx packages/ui/src/__tests__/event-log-preview.test.tsx
git commit -m "feat: the match screen as five bands, with the log below the board"
```

---

### Task 10: The join screen's missing state

The empty room list renders nothing at all — no spinner, no empty state, just a
gap. A guest whose discovery fails cannot tell the app from a dead page. This is
the plan's only correctness-grade fix.

**Files:**
- Create: `packages/app-shell/src/app/join-state.ts`
- Create: `packages/app-shell/src/app/__tests__/join-state.test.ts`
- Modify: `packages/app-shell/src/routes/join.tsx`

**Interfaces:**
- Produces: `joinState(rooms: ReadonlyArray<unknown>, elapsedMs: number): "searching" | "found" | "none"`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-shell/src/app/__tests__/join-state.test.ts
import { describe, expect, it } from "vitest"
import { joinState, SEARCH_GRACE_MS } from "../join-state"

describe("joinState", () => {
  it("is searching while the grace period is open and nothing has answered", () => {
    expect(joinState([], 0)).toBe("searching")
    expect(joinState([], SEARCH_GRACE_MS - 1)).toBe("searching")
  })

  // The state that does not exist today: after the grace period with no rooms,
  // the screen must say so rather than render nothing.
  it("gives up once the grace period closes", () => {
    expect(joinState([], SEARCH_GRACE_MS)).toBe("none")
  })

  it("shows rooms the moment any arrive, however early", () => {
    expect(joinState([{}], 0)).toBe("found")
    expect(joinState([{}], SEARCH_GRACE_MS * 10)).toBe("found")
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/join-state.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
// packages/app-shell/src/app/join-state.ts
/**
 * The join screen had one state and needed three. With none of these, an empty
 * roster rendered nothing at all, so a guest whose discovery failed could not
 * tell the app from a dead page.
 */
export const SEARCH_GRACE_MS = 4000

export type JoinState = "searching" | "found" | "none"

export const joinState = (rooms: ReadonlyArray<unknown>, elapsedMs: number): JoinState =>
  rooms.length > 0 ? "found" : elapsedMs < SEARCH_GRACE_MS ? "searching" : "none"
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/join-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Render all three states**

In `join.tsx`: change the heading to "Join a game"; track elapsed time since
mount; render a live "Looking for games on this Wi-Fi" indicator in `searching`,
the room list in `found`, and in `none` an explanation plus the address field
**promoted out of the `<details>`**. Keep the disclosure only in `found`.

Leave `join-link.ts`'s arrival behaviour alone — a scanned QR still fills the
field and opens the disclosure, and that is already tested.

- [ ] **Step 6: Build and drive it**

```bash
nub run build && nub run verify:ui
```

Then confirm the fix by eye — the standard driver never visits `#/join`:

```bash
nubx playwright screenshot --viewport-size=390,844 \
  "http://localhost:8910/#/join" screenshots/join-none.png
```

If that port is not serving, reuse the pattern from `scripts/drive-app.mjs`'s
exported `serveDist`. Expected: the screenshot shows either a searching
indicator or a "no games found" block — **never the blank gap it shows today.**

- [ ] **Step 7: Commit**

```bash
git add packages/app-shell/src/app/join-state.ts packages/app-shell/src/app/__tests__/join-state.test.ts packages/app-shell/src/routes/join.tsx
git commit -m "fix: the join screen renders nothing when no rooms are found"
```

---

### Task 11: Lobby — module rows, one add-player label, colour swatches

**Files:**
- Modify: `packages/app-shell/src/routes/lobby.tsx`

- [ ] **Step 1: Collapse the module cards into rows**

Each module becomes a single `toggle`-variant button: name on the left, state on
the right, blurb revealed on demand rather than as a permanent paragraph. Four
paragraphs currently push `Start` below the fold.

- [ ] **Step 2: Move the twists' prose here**

The home screen's "The twists" section text becomes these rows' on-demand
blurbs. Under ADR 0020 the twists belong at the toggle that turns them on, not
narrated on the front door.

- [ ] **Step 3: Fix the doubled label**

The field keeps its "Add a player" placeholder; the button becomes an icon
button with `aria-label="Add player"`. Two near-identical labels side by side
was one too many.

- [ ] **Step 4: Change the "On" colour**

The toggle's active state must not use the reserved link-tint band. Use
`colors.seat.0` (cyan) or `colors.finish`, not a green. Task 3's predicate
covers seats, not this — check it by eye against `RESERVED_LINK_HUE`.

- [ ] **Step 5: Add the seat swatch to each player row**

A filled circle in `seatColour(player.seat)`, which is where plan 2's colour
picker will attach.

- [ ] **Step 6: Leave the room code and QR exactly as they are**

They are the one part of the current lobby that works. In particular the QR's
quiet zone is drawn **inside the SVG** (`QUIET_ZONE = 4`) and must not become
CSS padding again — that was a real defect, and a test pins it.

- [ ] **Step 7: Build, drive, and look**

```bash
nub run build && nub run verify:ui
```

Expected: PASS. **Open `screenshots/2-lobby.png`** and confirm `Start` is
reachable without scrolling past four paragraphs.

- [ ] **Step 8: Commit**

```bash
git add packages/app-shell/src/routes/lobby.tsx
git commit -m "feat: lobby module rows, one add-player label, and seat swatches"
```

---

### Task 12: Home — one primary action, and the twists move out

**Files:**
- Modify: `packages/app-shell/src/routes/home.tsx`

- [ ] **Step 1: Give the three actions a hierarchy**

"Pass and play on this device" becomes `variant="primary"` and goes first — it
is the only action that works in every environment. "Join a game" and "Host on
Wi-Fi" become `secondary`. Today all three are identical slabs with the
*disabled* one first.

- [ ] **Step 2: Put the host button's reason on the button**

When hosting is unavailable in a browser, the reason belongs on the disabled
control, not in a paragraph below all three explaining which one it refers to.

- [ ] **Step 3: Delete "The twists"**

Its text moved to the lobby in Task 11. Keep one line saying what the game is.

- [ ] **Step 4: Build, drive, and look**

```bash
nub run build && nub run verify:ui
```

Expected: PASS. **Open `screenshots/1-home.png`** and confirm the primary action
is visibly primary and the wall of prose is gone.

- [ ] **Step 5: Commit**

```bash
git add packages/app-shell/src/routes/home.tsx
git commit -m "feat: one primary action on home, and the twists move to the lobby"
```

---

### Task 13: The PWA toast stops covering content, and styles.css shrinks

The toast was sitting on the lobby's module list and on the join screen in both
survey screenshots.

**Files:**
- Modify: `packages/ui/src/PwaPrompt.tsx`
- Modify: `apps/game-web/styles.css`

- [ ] **Step 1: Make the toast inline**

Remove its `position: fixed` and render it in the flow of the screen that raises
it, so it can never overlay a control.

- [ ] **Step 2: Reduce the stylesheet to what is genuinely global**

Delete every rule now expressed as a token or recipe. What remains: the
`@layer` declaration, the `:root` custom properties the WebGL side still reads,
`box-sizing`, `html/body/#root` sizing, and the `-webkit-tap-highlight-color`
reset. Everything else is dead.

- [ ] **Step 3: Confirm nothing was using what you deleted**

```bash
nub run build && nub run verify:ui
```

Expected: PASS, no horizontal overflow, no console errors. A deleted rule that
was load-bearing shows up here as a broken layout in the screenshots — **look at
all five.**

- [ ] **Step 4: Check the narrowest supported width**

`drive-app.mjs` drives at 390. The 320–380 band is the one the `sm` breakpoint
exists for and the one nothing has ever looked at:

```bash
node scripts/drive-app.mjs --viewport 320x800 ||   echo "no --viewport flag: drive it with a short script using the exported serveDist"
```

If the driver has no width flag, write a throwaway script against its exported
`serveDist` (the pattern is in Task 10, Step 6), screenshot every route at
320×800, and delete the script afterwards. Expected: no horizontal overflow on
any screen, and all five cards still meet 44px.

- [ ] **Step 5: Run every gate**

```bash
nub run test && nub run typecheck && nub run lint && nub run build
cargo test -p lan-sync
```

Expected: all PASS. `cargo` is included because the plan touched nothing in
`crates/`, so a failure there means something unrelated broke and is worth
knowing before the checkpoint.

- [ ] **Step 6: Confirm no emoji survived**

```bash
grep -rn "☣\|»\|⚓\|💤\|⚑\|✸\|⟲" packages/ui/src packages/app-shell/src --include=*.tsx
```

Expected: no matches. The `‹` in the two back buttons becomes a Lucide
`ChevronLeft`.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/PwaPrompt.tsx apps/game-web/styles.css
git commit -m "refactor: inline the PWA toast and reduce styles.css to globals"
```

---

### Task 14: Checkpoint the plan

**Files:**
- Modify: `docs/handoff.md`
- Modify: `docs/superpowers/plans/2026-09-17-chrome-and-layout-plan.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Tick every checkbox in this plan** and add a short note under any
      task where the implementation found something the plan did not anticipate.
      That note is the expensive part to rediscover.

- [ ] **Step 2: Add Panda to CLAUDE.md's command block**

`nubx nx run game-web:panda` regenerates `styled-system`, and `build`,
`serve` and `typecheck` now depend on it. Note that `styled-system` is
gitignored, so a fresh clone must run a build before `tsc` will resolve it.

- [ ] **Step 3: Update the handoff** with the gate numbers, what is verified,
      and the next task — plan 2, spec A's settings subsystem.

- [ ] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: checkpoint the chrome and layout plan"
```

---

## What this plan does not do

- **The renderer is untouched.** `renderer-legibility`'s camera, layering
  contract, per-link tinting, entry-end badges, tap-to-trace and token variety
  all remain unbuilt. This plan gives the board a 366px band and nothing inside
  it changes.
- **ADR 0020 rule 1 still fails in eight places.** `Scene.play` clips six of
  fifteen `TimelineEvent` variants; `LinkCollapsed`, `Revealed`, `MineDefused`,
  `CardPlayed`, `VenomGained`, `BoardBreathed`, `Stunned` and `Finished` have no
  board depiction. That is renderer work.
- **No setting is readable yet.** The settings button in Task 9's header is
  inert until plan 2.
- **Light mode is possible but not built.** Semantic tokens make it reachable;
  nothing in this plan adds it.
