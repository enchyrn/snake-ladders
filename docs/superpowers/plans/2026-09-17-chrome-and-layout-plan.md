# Chrome and Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every screen's layout on a real design system — Panda CSS tokens and recipes, Lucide icons — so the board is the primary channel and the chrome stops being 784 lines of ad-hoc CSS.

**Architecture:** Panda generates atomic CSS at build time from tokens derived from `packages/render/src/palette.ts`, so the DOM overlay and the WebGL board cannot drift. One button recipe with variants replaces eight hand-written classes. The match screen becomes five vertical bands whose heights are a pure, tested function of player count, with the board fixed at 366 CSS px and never reduced.

**Tech Stack:** Panda CSS `2.0.0-beta.17`, `lucide-react` `1.46.0`, React 19.3, Vite 8.3, TypeScript 6.0.3, Nx, nub, vitest, Playwright via `scripts/drive-app.mjs`.

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
- **Exact versions, pinned.** `@pandacss/dev@2.0.0-beta.17` and `lucide-react@1.46.0`, both added with `-E` so no `^` appears. Panda's `latest` is 1.12.1; the beta is deliberate (ADR 0021) and must not be "helpfully" upgraded or downgraded.
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

ADR 0021 mandates this as the first task. Panda `2.0.0-beta.17` is unverified
against React 19.3, Vite 8.3, TypeScript 6.0.3 and nub's non-hoisting linker.
If it fails here, it fails cheaply; if it fails in Task 9, it fails after eight
tasks of work written against it.

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
nub add -D -E @pandacss/dev@2.0.0-beta.17
nub add -E lucide-react@1.46.0
```

- [x] **Step 2: Confirm the versions landed without a caret**

```bash
grep -n "pandacss\|lucide-react" package.json
```

Expected: `"@pandacss/dev": "2.0.0-beta.17"` and `"lucide-react": "1.46.0"`, no `^`.
If either shows a `^`, re-add with `-E`. A caret on a beta will drift to a
different beta.

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

Expected: PASS. This is the ADR-mandated gate. If the beta is incompatible with
Vite 8.3 or TS 6.0.3, stop here and report it — do not work around it silently,
because ADR 0021 was accepted on the assumption that this step is cheap to
reverse.

- [x] **Step 9: Commit**

```bash
git add package.json nub.lock panda.config.ts postcss.config.cjs .gitignore apps/game-web/styles.css
git commit -m "build: adopt Panda CSS 2.0.0-beta.17 and Lucide, and prove they build"
```

**Execution note:** the plan's own premise — "later tasks assume
`styled-system/css` and `styled-system/patterns` resolve" — had no task that
made it so. Nothing wired resolution: no `tsconfig` path, no Vite alias, no
vitest alias, and no codegen step on install. The controller ruled this into
Task 1 (Ruling R1): `styled-system/*` was added to `tsconfig.json`'s `paths`,
a Vite alias, and a vitest alias, and codegen runs via a root
`"prepare": "panda codegen"` script rather than an explicit CI step, so both
`nub install` and `nub ci` regenerate it. Proved with a throwaway probe import
from `packages/ui` through lint, typecheck, test and build.

A second thing surfaced later but belongs here: `apps/game-web/styles.css`
declared `@layer reset, base, tokens, recipes, utilities;` in this task's
Step 7, but every rule below it was unlayered — and an unlayered rule always
beats a layered one in the cascade, so the legacy CSS silently outranked every
Panda recipe and utility. Found while implementing Tasks 11+12, fixed
immediately (commit `1b6ad83`, wrapping the existing rules in `@layer base`)
rather than deferred to Task 13, because Tasks 8, 9, 11 and 12's visuals
depended on it.

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

**Execution note (T3/T4):** neither task's own gates caught this — the
controller found it by reading the generated CSS directly. Panda 2.0
beta.17 has **no implicit preset**: without `@pandacss/preset-base`,
`theme.extend.tokens` never becomes real utilities, so the cssgen output
emitted bare, unresolved token names verbatim (`background: surface;`
instead of a real colour value). `@pandacss/preset-base` was added to
`panda.config.ts`'s `presets`, and a regression test
(`packages/ui/src/__tests__/panda-tokens.test.ts`) parses the emitted CSS and
fails on any bare token name, so this class of defect cannot regress
silently again. Task 7's review was held until this landed, since it builds
directly on the recipe's colours.

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/icons.test.tsx
```

Expected: FAIL — the module does not exist.

- [x] **Step 3: Draw the eight glyphs**

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

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/icons.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit**

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/bands.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement it**

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

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/bands.test.ts
```

Expected: PASS, including the three worked numbers from the spec.

- [x] **Step 5: Commit**

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/progress-rows.test.tsx
```

Expected: FAIL — `ProgressRows` is not exported.

- [x] **Step 3: Replace PlayerStrip and Progress with ProgressRows**

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

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/progress-rows.test.tsx
```

Expected: PASS.

- [x] **Step 5: Update the one consumer**

In `packages/app-shell/src/routes/match.tsx`, replace the `PlayerStrip` and
`Progress` imports and usages with `ProgressRows`, passing `state={match}` and
`actingSeat={actingSeat}`.

- [x] **Step 6: Typecheck, lint and test**

```bash
nub run typecheck && nub run lint && nub run test
```

Expected: all PASS. `lint` matters here — `HUD.tsx` is `layer:ui` and must not
have acquired an import from `app-shell`.

- [x] **Step 7: Commit**

```bash
git add packages/ui/src/HUD.tsx packages/ui/src/__tests__/progress-rows.test.tsx packages/app-shell/src/routes/match.tsx
git commit -m "feat: progress rows replace the tile numeral and the progress stub"
```

**Execution note:** the brief's `ProgressRows` snippet drops every
per-player status the old `PlayerStrip` showed (venom, momentum, anchored,
stunned, done/away) and marks the acting row only with a test-only
attribute. Overridden: the spec is silent here and the old strip carried
this state, so rows carry it forward using Task 5's icons (venom as
icon+digit — the honest unit under ADR 0020 rule 3) inside the 20px row
height, and the acting row gets a visible, non-colour cue rather than relying
on `data-acting` alone. The final review later found these badges were
`aria-hidden` to assistive tech despite being visible cues; fixed in the
final fix wave (`role="img"` + `aria-label` per badge, `aria-current` plus
sr-only text on the acting row).

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/card-rail.test.tsx
```

Expected: FAIL — `DiceTray` is not exported, and `CardRail` renders four
buttons because `defuse` is filtered and unaffordable cards are dropped.

- [x] **Step 3: Make the rail flex and keep disabled cards present**

In `CardRail`, change the wrapper to `css({ display: "flex", gap: "6px" })` —
**no `overflow-x`** — and give each card `flex: "1 1 0"` with `minWidth: 0`.
Render all five cards; a card the player cannot afford or has already played
renders with `disabled` rather than being filtered out. Replace the `☣{cost}`
span with `<VenomIcon size={12} />{cost}`.

- [x] **Step 4: Add the dice tray**

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

- [x] **Step 5: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/card-rail.test.tsx
```

Expected: PASS.

- [x] **Step 6: Wire the tray into the match screen**

In `match.tsx`, put `DiceTray` beside `RollButton` in the control bar, both
sending `{ _tag: "Commit", playerId: seat }`. Both read `canRollAtom` for their
disabled state.

- [x] **Step 7: Build and drive it**

```bash
nub run build && nub run verify:ui
```

Expected: PASS, no console errors, no horizontal overflow. **Open
`screenshots/5-rolled.png` and confirm all five cards are visible at once.**
This is the survey finding; a green gate that still shows three cards means the
flex did not take.

- [x] **Step 8: Commit**

```bash
git add packages/ui/src/HUD.tsx packages/ui/src/__tests__/card-rail.test.tsx packages/app-shell/src/routes/match.tsx
git commit -m "feat: the card rail flexes to five, and the dice tray is a real button"
```

**Execution note:** the plan assumed `DiceTray` and `RollButton` could sit
beside the five-card rail in one row. They can't: squeezed next to a tray and
Roll, the cards drop to ~26px, violating both the ≥44px tap constraint and
the spec's ~70px-per-card premise. Ruling: the control bar becomes two rows —
the five-card rail full width, then `DiceTray` + `RollButton` below it.
`bands.ts`'s `CONTROLS_PX = 130` was written to budget exactly these two
~64px rows, and Task 9 lays them out in that order. (The measured height
later settled at ~139px, reconciled in Task 9's own note below.)

---

### Task 9: The five bands, the log preview, and the legend's residency

**Files:**
- Modify: `packages/app-shell/src/routes/match.tsx`
- Modify: `packages/ui/src/EventLog.tsx`
- Create: `packages/ui/src/__tests__/event-log-preview.test.tsx`

**Interfaces:**
- Consumes: `bands` (Task 6), `ProgressRows` (Task 7), `DiceTray` (Task 8).
- Produces: `EventLog({ state, mode }: { state: MatchState; mode?: "preview" | "full" })`.

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/ui/src/__tests__/event-log-preview.test.tsx
```

Expected: FAIL — `mode` is not a prop; preview renders all four lines.

- [x] **Step 3: Add the mode**

In `EventLog.tsx`, accept `mode: "preview" | "full" = "full"` and slice the
lines to the last two in preview. **Do not early-return `null` for an empty
timeline in preview mode** — return the empty `<ul>` with its `aria-live`
attribute, so the live region is present before the first round.

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/ui/src/__tests__/event-log-preview.test.tsx
```

Expected: PASS.

- [x] **Step 5: Lay the match screen out as five bands**

Rewrite `MatchScreen`'s returned tree as, top to bottom: a 52px header (turn
text, round-log button, settings button — the settings button is inert until
plan 2); `ProgressRows`; a fixed 366px board band holding `BoardCanvas`; the
log preview, taking the remaining space; and the control bar holding `CardRail`
then `DiceTray` and `RollButton`.

Use `bands(match.players.length, window.innerHeight)` only for the log band's
`maxHeight`; the board band gets a literal `h: "board"` token so it cannot be
squeezed by a flex miscalculation.

- [x] **Step 6: Turn `⟲ Reset view` into an icon button**

`BoardCanvas.tsx:130` renders `⟲ Reset view` — an emoji in a text node, so it
is a different picture per platform. Replace the glyph with Lucide's
`RotateCcw` beside the text, keeping the visible label: the control appears
only after the player has orbited, so it has no established shape to recognise
and an icon alone would be a puzzle.

- [x] **Step 7: Make the legend conditional**

`MineLegend` renders only when the minesweeper module is on **and** no tile has
been revealed yet. Once a tile is revealed the board shows what the legend
explains, and it retires.

- [x] **Step 8: Build and drive it**

```bash
nub run build && nub run verify:ui
```

Expected: PASS. **Open `screenshots/4-match.png` and `5-rolled.png`** and
confirm: the board is visibly the dominant element, the progress rows are at the
top, the log sits below the board rather than above it, and the legend is gone
once a tile is revealed.

- [x] **Step 9: Commit**

```bash
git add packages/app-shell/src/routes/match.tsx packages/ui/src/BoardCanvas.tsx packages/ui/src/EventLog.tsx packages/ui/src/__tests__/event-log-preview.test.tsx
git commit -m "feat: the match screen as five bands, with the log below the board"
```

**Execution note:** the measured control bar came in at 138.6px against
`bands.ts`'s `CONTROLS_PX = 130` budget from Task 8's note — `CONTROLS_PX`
was reconciled to 139 and the band tests rederived against the real number
rather than the guess. `MineLegend` still rendered the raw `⚑`/`✸` emoji
glyphs (missed by Task 5's icon pass because it wasn't touched there); this
task's Step 7 replaced them with `FlagIcon`/`MineIcon`. Also: `verify:ui`'s
"nothing was narrated after rolling" failure was reproduced here — 1/4 on the
unmodified base, 1/6 on the branch — and traced only as far as a hypothesis
(WebGL main-thread contention); it is pre-existing, not introduced by this
plan, and the fix belongs in `drive-app.mjs` or CI flags, outside this plan's
scope. It resurfaced in the final fix wave's own gate runs (2/5 in
development, 2/24 on a scratch probe of the pre-fix tree) and is flagged
below as an open thread for a task of its own.

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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run it and verify it fails**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/join-state.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement it**

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

- [x] **Step 4: Run the test and verify it passes**

```bash
nubx vitest run packages/app-shell/src/app/__tests__/join-state.test.ts
```

Expected: PASS.

- [x] **Step 5: Render all three states**

In `join.tsx`: change the heading to "Join a game"; track elapsed time since
mount; render a live "Looking for games on this Wi-Fi" indicator in `searching`,
the room list in `found`, and in `none` an explanation plus the address field
**promoted out of the `<details>`**. Keep the disclosure only in `found`.

Leave `join-link.ts`'s arrival behaviour alone — a scanned QR still fills the
field and opens the disclosure, and that is already tested.

- [x] **Step 6: Build and drive it**

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

- [x] **Step 7: Commit**

```bash
git add packages/app-shell/src/app/join-state.ts packages/app-shell/src/app/__tests__/join-state.test.ts packages/app-shell/src/routes/join.tsx
git commit -m "fix: the join screen renders nothing when no rooms are found"
```

**Execution note:** the plan's Step 5 said "keep the disclosure only in
`found`", which would hide a QR arrival's pre-filled address field for the
whole 4s `searching` window — a guest who scanned a code would watch it
vanish for four seconds before it reappeared. Overridden: when an arrival is
present the address field stays visible in every state (promoted in
`searching`/`none`, inside the opened disclosure in `found`), since a
scanned-and-then-hidden field would itself be the "dead page" this task
exists to fix. The final review separately found the `searching` copy
contradictory for an arrival ("Looking for games…" above "The code didn't
show up automatically…"); fixed in the final fix wave with
arrival-appropriate wording (`join-state.ts`'s `promotedHint`).

---

### Task 11: Lobby — module rows, one add-player label, colour swatches

**Files:**
- Modify: `packages/app-shell/src/routes/lobby.tsx`

- [x] **Step 1: Collapse the module cards into rows**

Each module becomes a single `toggle`-variant button: name on the left, state on
the right, blurb revealed on demand rather than as a permanent paragraph. Four
paragraphs currently push `Start` below the fold.

- [x] **Step 2: Move the twists' prose here**

The home screen's "The twists" section text becomes these rows' on-demand
blurbs. Under ADR 0020 the twists belong at the toggle that turns them on, not
narrated on the front door.

- [x] **Step 3: Fix the doubled label**

The field keeps its "Add a player" placeholder; the button becomes an icon
button with `aria-label="Add player"`. Two near-identical labels side by side
was one too many.

- [x] **Step 4: Change the "On" colour**

The toggle's active state must not use the reserved link-tint band. Use
`colors.seat.0` (cyan) or `colors.finish`, not a green. Task 3's predicate
covers seats, not this — check it by eye against `RESERVED_LINK_HUE`.

- [x] **Step 5: Add the seat swatch to each player row**

A filled circle in `seatColour(player.seat)`, which is where plan 2's colour
picker will attach.

- [x] **Step 6: Leave the room code and QR exactly as they are**

They are the one part of the current lobby that works. In particular the QR's
quiet zone is drawn **inside the SVG** (`QUIET_ZONE = 4`) and must not become
CSS padding again — that was a real defect, and a test pins it.

- [x] **Step 7: Build, drive, and look**

```bash
nub run build && nub run verify:ui
```

Expected: PASS. **Open `screenshots/2-lobby.png`** and confirm `Start` is
reachable without scrolling past four paragraphs.

- [x] **Step 8: Commit**

```bash
git add packages/app-shell/src/routes/lobby.tsx
git commit -m "feat: lobby module rows, one add-player label, and seat swatches"
```

---

### Task 12: Home — one primary action, and the twists move out

**Files:**
- Modify: `packages/app-shell/src/routes/home.tsx`

- [x] **Step 1: Give the three actions a hierarchy**

"Pass and play on this device" becomes `variant="primary"` and goes first — it
is the only action that works in every environment. "Join a game" and "Host on
Wi-Fi" become `secondary`. Today all three are identical slabs with the
*disabled* one first.

- [x] **Step 2: Put the host button's reason on the button**

When hosting is unavailable in a browser, the reason belongs on the disabled
control, not in a paragraph below all three explaining which one it refers to.

- [x] **Step 3: Delete "The twists"**

Its text moved to the lobby in Task 11. Keep one line saying what the game is.

- [x] **Step 4: Build, drive, and look**

```bash
nub run build && nub run verify:ui
```

Expected: PASS. **Open `screenshots/1-home.png`** and confirm the primary action
is visibly primary and the wall of prose is gone.

- [x] **Step 5: Commit**

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

- [x] **Step 1: Make the toast inline**

Remove its `position: fixed` and render it in the flow of the screen that raises
it, so it can never overlay a control.

- [x] **Step 2: Reduce the stylesheet to what is genuinely global**

Delete every rule now expressed as a token or recipe. What remains: the
`@layer` declaration, the `:root` custom properties the WebGL side still reads,
`box-sizing`, `html/body/#root` sizing, and the `-webkit-tap-highlight-color`
reset. Everything else is dead.

- [x] **Step 3: Confirm nothing was using what you deleted**

```bash
nub run build && nub run verify:ui
```

Expected: PASS, no horizontal overflow, no console errors. A deleted rule that
was load-bearing shows up here as a broken layout in the screenshots — **look at
all five.**

- [x] **Step 4: Check the narrowest supported width**

`drive-app.mjs` drives at 390. The 320–380 band is the one the `sm` breakpoint
exists for and the one nothing has ever looked at:

```bash
node scripts/drive-app.mjs --viewport 320x800 ||   echo "no --viewport flag: drive it with a short script using the exported serveDist"
```

If the driver has no width flag, write a throwaway script against its exported
`serveDist` (the pattern is in Task 10, Step 6), screenshot every route at
320×800, and delete the script afterwards. Expected: no horizontal overflow on
any screen, and all five cards still meet 44px.

- [x] **Step 5: Run every gate**

```bash
nub run test && nub run typecheck && nub run lint && nub run build
cargo test -p lan-sync
```

Expected: all PASS. `cargo` is included because the plan touched nothing in
`crates/`, so a failure there means something unrelated broke and is worth
knowing before the checkpoint.

- [x] **Step 6: Confirm no emoji survived**

```bash
grep -rn "☣\|»\|⚓\|💤\|⚑\|✸\|⟲" packages/ui/src packages/app-shell/src --include=*.tsx
```

Expected: no matches. The `‹` in the two back buttons becomes a Lucide
`ChevronLeft`.

- [x] **Step 7: Commit**

```bash
git add packages/ui/src/PwaPrompt.tsx apps/game-web/styles.css
git commit -m "refactor: inline the PWA toast and reduce styles.css to globals"
```

**Execution note:** this task's own review found `BoardCanvas.tsx` had
hand-mirrored the gutter `max()` expression instead of reusing the
`GUTTER_LEFT`/`GUTTER_RIGHT` constants — folded into fix round 1 (commit
`2fbff6b`). That fix also uncovered the trap that shaped the rest of the
branch: **Panda cannot extract a value interpolated from an import across the
`@mutation/*` path alias**, so `match.tsx`'s gutter padding, written through
that alias, was never picked up by codegen and had to be hand-mirrored as
literals in three places instead of referenced as a token. The re-review's
new Important (make the gutter a Panda token referenced by name rather than
triplicated literals) was deliberately deferred to the final whole-branch
review's fix wave rather than spent on another dispatch here.

The final review then found a second, more consequential instance of the
same class of bug: `packages/ui/src/layout/screen.ts`'s `matchScreenClass`
used `cx(screenClass, css({ padding: 0, gap: 0, ... }))` to override the base
screen's padding and gap — but **`cx()` only concatenates class names; it
does not resolve which conflicting atomic utility wins**, and the stylesheet
order left the *base* screen's non-zero padding and gap beating the
override. The match screen silently kept 16px of padding and inset the board
band to 358px instead of the spec's full-bleed 366px. Fixed in the final fix
wave by giving `matchScreenClass` its own complete `css({...})` rather than
composing with `cx()`; the same pattern was fixed at `match.tsx`'s round-log
heading. **Rule for any future Panda code in this repo: never compose
conflicting utilities with `cx()` — write one complete `css({...})`, or merge
raw style objects with `css(a, b)` where the later argument wins.**

---

### Task 14: Checkpoint the plan

**Files:**
- Modify: `docs/handoff.md`
- Modify: `docs/superpowers/plans/2026-09-17-chrome-and-layout-plan.md`
- Modify: `CLAUDE.md`

- [x] **Step 1: Tick every checkbox in this plan** and add a short note under any
      task where the implementation found something the plan did not anticipate.
      That note is the expensive part to rediscover.

- [x] **Step 2: Add Panda to CLAUDE.md's command block**

`nubx nx run game-web:panda` regenerates `styled-system`, and `build`,
`serve` and `typecheck` now depend on it. Note that `styled-system` is
gitignored, so a fresh clone must run a build before `tsc` will resolve it.

- [x] **Step 3: Update the handoff** with the gate numbers, what is verified,
      and the next task — plan 2, spec A's settings subsystem.

- [x] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: checkpoint the chrome and layout plan"
```

**Execution note:** a final whole-branch review (`f8ab630..2fbff6b`, opus)
ran after Task 13 and before this task, deliberately — Ruling: the checkpoint
records the verified end state, and one written before the final fixes would
be stale on arrival. It found 0 Critical, 7 Important and 10 Minor issues
beyond what each per-task review had already caught; most are folded into the
notes above (badges silent to AT under Task 7, the `cx()` override trap under
Task 13, the `searching`-state copy under Task 10). The rest, addressed in one
fix wave (commits `2c76cb4..8c8ecf8`, all re-reviewed clean): the live region
was truncated to two lines instead of holding the whole round (ADR 0020 rule
2 — fixed by clipping the preview *visually* while keeping every line in the
`aria-live` list); the `ui` and `render` packages had no `test` Nx target and
so never ran in CI; a multi-seat header with the seat-switcher inline broke
the band budget (the switcher moved to its own band under the header, per a
ruling that the 20px progress rows must not become the tap targets — that
would violate the 44px rule); the mine legend's "retires to the round-log
sheet" behaviour was half-built; and the gutter/header literals became real
Panda tokens. Three items were ruled note-only rather than code, and are
recorded in `docs/handoff.md` and CLAUDE.md rather than fixed here: no
`strictTokens` enforcement on spacing values (ADR 0021 debt), a few unbuilt
spec niceties (the join screen's "live indicator" is text only), and the
Panda traps themselves, now in CLAUDE.md's "Panda traps" paragraph.

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
