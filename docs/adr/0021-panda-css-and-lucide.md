# 0021. Panda CSS and Lucide

## Status

Accepted. **Amended 2026-09-17:** the adopted version is stable
`1.12.1`, not `2.0.0-beta.17`. The original decision is kept below with its
reasoning intact; see *Why the version reversed* for what changed and why.

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

**Adopt Panda CSS at `1.12.1`, and `lucide-react` at `1.46.0`.**

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

**The version was the notable part of this decision, and it reversed.** This
ADR originally adopted `2.0.0-beta.17`, published only under the `beta` tag,
while conceding in this same paragraph that stable `1.12.1` "would have covered
every finding above". It named no benefit the beta bought. The gate the ADR
itself mandated then refused the beta outright on a supply-chain trust failure,
and the owner reversed the version on 2026-09-17. The reasoning is under
*Why the version reversed*; the evidence is under *Supply-chain verification*.

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

**The largest cost is the one the amendment removed.** As written, this ADR
put every component in `packages/ui` and `packages/app-shell` on an API that
could change before 2.0.0 released, with a breaking change landing on the whole
app at once — in a repository whose CI pins stable toolchains and whose
CLAUDE.md is largely a list of things that bit it once. Stable `1.12.1` does not
carry that, and it costs nothing the decision above actually asked for: recipes,
tokens, static extraction and the `palette.ts`-derived colours are all Panda 1.x
features. What is given up is 2.x's forward compatibility, so a 2.0 migration
becomes a later, deliberate piece of work rather than something already absorbed.
The bound on that is the one this ADR already named in the other direction: the
styled surface is a theme file plus a set of recipes, so the migration path out
is the same size as the path in.

**Panda 1.12.1 is verified against this stack** — React 19.3, Vite 8.3,
TypeScript 6.0.3, Nx, and nub's non-hoisting linker — to the extent that it
installs cleanly and exposes `defineConfig`, `defineRecipe`, `defineTokens`,
`defineSemanticTokens` and the `@pandacss/dev/postcss` entrypoint the plan's
config needs. The first task of any plan implementing this still installs it and
builds before anything is written against it. That gate is what caught the beta,
and it earned its place.

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

## Supply-chain verification, 2026-09-17

Implementing Task 1 of the chrome-and-layout plan hit a wall the ADR did not
anticipate. `nub add -D -E @pandacss/dev@2.0.0-beta.17` **fails outright**, and
not on a compatibility problem:

```
trust downgrade for @pandacss/cli@2.0.0-beta.17 (trustPolicy=no-downgrade):
earlier published version 2.0.0-beta.0 had provenance attestation but this
version has no trust evidence
```

`nub`'s default `trustPolicy=no-downgrade` refuses a package that *used* to
carry SLSA provenance and no longer does. The gate is real: it cannot be
satisfied by pinning, and it is the transitive `@pandacss/cli`, not
`@pandacss/dev` itself, that trips it.

### What the registry says

Queried against `registry.npmjs.org` directly, so this is not a mirror
stripping metadata:

| | `@pandacss/dev` | `@pandacss/cli` |
|---|---|---|
| `2.0.0-beta.0` … `beta.10` | attested | **attested** |
| `2.0.0-beta.11` … `beta.17` | attested, published by `GitHub Actions` | **no attestation**, published by `segunadebayo` |

The two packages diverge at exactly `beta.11` (2026-07-24). `dev` moved *onto*
a trusted CI workflow at that boundary; `cli` stayed on manual publishing and
lost its provenance there. Seven consecutive releases over seven weeks, from
the project's sole maintainer — the same account that published the attested
ones. That is the shape of a split release process, not of a hijack.

### What the tarball says

The owner asked for evidence rather than inference, so
`@pandacss/cli@2.0.0-beta.17` was compared against `2.0.0-beta.10` — the last
release whose attestation is cryptographic — and against its own source tag.

- Both tarballs match their registry `integrity` hashes.
- **Identical file lists.** No file added, and no install hook in either
  (`preinstall`/`install`/`postinstall`/`prepare` are all absent; the `scripts`
  block holds build-time entries npm never runs for a consumer).
- **Published `package.json` matches `packages/cli/package.json` at the tag**
  `@pandacss/cli@2.0.0-beta.17` (commit `2991686`), modulo key ordering and the
  `workspace:*` → `2.0.0-beta.17` rewrite that a pnpm/changesets publish always
  performs. No added dependency, no added script.
- **Dangerous-pattern counts are identical to the attested beta.10** —
  `eval`, `new Function`, `atob`, base64 `Buffer.from`, `XMLHttpRequest`,
  `fetch`, `https.request`, `os.homedir`, `.ssh`, `.npmrc`, `AWS_`, `TOKEN`:
  **zero in both**.
- `process.env` is read for `FORCE_COLOR`, `TERM` and `NO_COLOR`. Nothing else.
- The only `child_process` use is `execSync(installCommand(pm, missing))` in
  `src/commands/init.ts`, a four-way switch over pnpm/yarn/bun/npm, identical
  in source and in the attested beta.10. It is reachable only through
  `panda init`, which this repo never runs — the plan writes `panda.config.ts`
  by hand and invokes `panda codegen` only.
- **Every external import is a Node builtin or a declared dependency.** No
  `net`, `http`, `https`, `dns` or `tls` anywhere in the bundle: the CLI has no
  network capability at all.
- The tarball is 51 KB against beta.10's 81 KB. That is fully explained: the
  `build:report` step and the `report-ui/` analyze-report bundle were removed
  upstream, and `report-ui/` is genuinely absent from the source tree at the
  tag. A shrinking bundle is the opposite of an injection.

**Conclusion: benign release-process drift, not a compromised release.** Two
limits on that, stated rather than buried. A clean diff is not an attestation —
it proves this tarball's contents, not the pipeline that made them. And the
finding does not transfer: the next beta bump carries no automated guarantee
either, so each one needs this check again until upstream restores provenance.

### Why the version reversed

Keeping `beta.17` would have required a `trustPolicyExclude` entry in
`nub.jsonc`, pinned to the exact version (`@pandacss/cli@2.0.0-beta.17` — a bare
`@pandacss/cli` would exempt every future version, including one published after
a real compromise). That is a standing exception in a repository whose CI pins
stable toolchains, and because the verification above does not transfer to the
next release, it would need re-reviewing on every bump.

Set against that, the beta bought nothing this ADR had asked for. The Decision
conceded in its own text that stable `1.12.1` "would have covered every finding
above", and named no benefit in exchange. Stable `1.12.1` was probed and
**installs cleanly**: the 1.x line has no `@pandacss/cli` dependency at all, so
the trust failure does not arise, and `defineConfig`, `defineRecipe`,
`defineTokens`, `defineSemanticTokens` and the `@pandacss/dev/postcss`
entrypoint all cover what the plan's Task 1 config uses.

**The owner reversed the version to stable `1.12.1` on 2026-09-17.** One ADR
amendment removed both the standing exception and the unhedged beta-breakage
risk, and cost only 2.x's forward compatibility — which was never among the
reasons Panda was chosen.

The durable lesson is about the gate, not the library. ADR 0021 required the
install to be proven before anything was written against it, and justified that
on API compatibility. The install failed on provenance instead — a failure mode
the ADR had not imagined — and the gate caught it anyway, eight tasks before it
would have hurt. A first task that simply installs the dependency and builds is
worth keeping in any plan that adopts one.
