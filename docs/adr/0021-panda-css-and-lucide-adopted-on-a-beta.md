# 0021. Panda CSS and Lucide, adopted on a beta

## Status

Accepted.

## Context

A screenshot survey on 2026-09-17, driven against a freshly built `dist/` at
390×844, established what the chrome actually is rather than what it was
believed to be:

- **784 lines of CSS in one stylesheet**, ~55 ad-hoc selectors, and exactly one
  media query (`max-width: 380px`).
- **Eight independently styled button classes** — `.primary`, `.roll`,
  `.module-toggle`, `.card`, `.add-player`, `.remove-player`, `.view-reset`,
  `.seat-switch` — with no shared component. The join screen's button is small
  and left-aligned while the home screen's are full-width slabs, because
  nothing makes them agree.
- **Colour tokens exist; no spacing scale and no type scale do.**
- **No assets at all.** No `public/`, no icons, no fonts. Every glyph in the
  game — `☣ » ⚓ 💤 ⚑ ✸ ⟲ ‹` — is an emoji in a text node, which means it
  renders in the *platform emoji font*: a different picture on Android, iOS and
  desktop, un-recolourable, and unalignable to any grid.
- `styles.css` opens by claiming it "mirrors `src/render/palette.ts` so the DOM
  overlay and the WebGL board never drift into two different dark themes."
  Nothing enforces that. It is a comment, and comments do not hold.

ADR 0020 raises the bar rather than lowering it. Making the board the primary
channel means the chrome must shrink *and* stay legible, and
`renderer-legibility` has already measured the board at roughly a third of the
screen with three information layers competing for 0.4 of vertical space. A
hand-rolled stylesheet with no scales is not a foundation that work can stand
on.

## Decision

**Adopt Panda CSS at `2.0.0-beta.17`, and `lucide-react` at `1.46.0`.**

- **Recipes** replace the eight button classes with one component and variants.
  This is the survey's central finding and the feature that selected Panda over
  StyleX, whose variant ergonomics are thinner.
- **Tokens** supply the missing spacing and type scales, and semantic tokens
  make a light theme possible later without a second stylesheet.
- **Static extraction** means the styling layer costs nothing at runtime, which
  matters in an app whose main thread is already driving WebGL.
- **`packages/render/src/palette.ts` stays the single source of colour**, and
  Panda's colour tokens are *derived from it* during codegen rather than
  transcribed beside it. The mirror becomes a build fact instead of a hope, and
  no new dependency edge is created into `layer:render`, which may depend only
  on `engine`.
- **Lucide covers the general vocabulary** (back, close, settings, check).
  The game's own nouns — venom, mine, ladder, snake, flag, momentum, anchor,
  stun — do not exist in any general-purpose set and are hand-drawn as inline
  SVG to Lucide's stroke weight.

**The version is the notable part of this decision.** Panda's `latest` is
`1.12.1`; `2.0.0-beta.17` is published only under the `beta` tag. Stable 1.12.1
would have covered every finding above. The beta was chosen deliberately, with
the cost below stated in advance rather than discovered.

## Consequences

The immediate gain is that the survey's findings stop being individually
fixable and become structurally impossible. A button cannot drift from the
other buttons when there is one recipe. A spacing value cannot be invented when
the scale is the only way to express one. An icon cannot render as somebody
else's emoji font when it is an SVG inheriting `currentColor` — which also
means icons can finally be tinted per seat, something the emoji could never do.
Deriving tokens from `palette.ts` closes the DOM/WebGL drift that the
stylesheet's opening comment has only ever asked for politely.

The costs, in the order they are likely to hurt.

**The beta is the main one, and it is not hedged.** Every component in
`packages/ui` and `packages/app-shell` will be written against an API that may
change before 2.0.0 is released, and a breaking change lands on the whole app
at once rather than on one screen. Two things bound it: the styled surface is
confined to a theme file plus a set of recipes, and the migration path in is
one stylesheet rather than hundreds of scattered files — so the migration path
*out*, if the beta goes somewhere unacceptable, is the same size. It remains
true that this is a repository whose CI pins stable toolchains and whose
CLAUDE.md is largely a list of things that bit it once, and a beta foundation
sits against that grain.

**Panda 2.0.0-beta.17 has not been verified against this stack.** React 19.3,
Vite 8.3, TypeScript 6.0.3, Nx, and nub's non-hoisting linker. The first task
of any plan implementing this must be to install it and build, before anything
is written against it — not to write screens and discover it at the end.

**The Nx codegen target is a known trap in a new place.** Panda generates a
`styled-system` directory, and that target needs its `inputs` and `outputs`
declared correctly. ADR 0018 already records that this repo has two projects
whose Nx inputs are fictional, and `verify-ui` driving an eight-hour-stale
`dist/` is the same defect one layer down. Declared wrong, a cache hit serves
stale tokens and the screenshots look fine — the failure mode that this project
has now met three times.

**nub does not hoist.** Any peer dependency Panda or Lucide expects to find
ambiently must be declared. CLAUDE.md's standing rule applies: when a build
dies on a missing module, declare the dependency rather than change the linker.

**Reading the visual system in one file ends.** Styles move from
`apps/game-web/styles.css` into the components they belong to, which is better
locality and worse overview — and the overview is precisely how the survey that
produced this ADR was carried out. Whoever next asks "what does this app look
like" will have to drive it rather than read it, which ADR 0020 already
requires for other reasons.

**Half the icon set is permanent maintenance.** Lucide will never ship a venom
symbol. The hand-drawn glyphs must match its stroke weight and optical sizing
or the two halves read as two sets, and that matching is re-done every time
Lucide's own style shifts under an upgrade.
