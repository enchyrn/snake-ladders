# Settings and input — design

**Status:** approved in conversation, not implemented. No code exists yet.
**Date:** 2026-09-16
**Governed by:** [ADR 0020](../../adr/0020-a-boardgame-not-a-number-game.md).

This is **spec A of two**. It covers the settings subsystem: what is stored,
where it lives, what each setting means, and how each is read. It deliberately
does **not** cover how any of it looks. A chrome-and-layout pass over every
screen — including this one's — is spec B, and it also has to absorb
`renderer-legibility` §Chrome and `share-and-start-menu` §"The start menu"
rather than compete with them.

The split exists because the two halves have different blockers. The contents
below were settled in the 2026-09-16 brainstorm and are writable today; the
layout work needs a screenshot survey of the current screens first.

## What forced the architecture

`nub run lint` enforces one rule, `@nx/enforce-module-boundaries`, and it
decides this design before any preference about it can:

```
layer:ui    → engine, render
layer:render→ engine
layer:app-shell → engine, net, render, ui
```

`layer:ui` cannot see `layer:app-shell`. So `BoardCanvas`, `EventLog` and `HUD`
**cannot import a settings store**, and `render` can see less still. Every
consumer of a setting except the match and lobby routes sits below the layer
the store has to live in.

Two ways out, and the rejected one first.

**Rejected: a `packages/settings` at the bottom of the graph.** It would need a
new `layer:settings` tag added to three allow-lists — an Nx graph edit, in a
repo ADR 0018 already records as having two projects whose Nx inputs are
fictional. Worse, it would let `render` read ambient global state, which is a
quiet erosion of ADR 0007: the scene is a pure function of match state plus a
replayed timeline, and a module-level settings import makes it a function of
something else as well.

**Chosen: settings live in app-shell; every lower layer takes the slice it
needs as an explicit parameter.** `BoardCanvas` already accepts a `quality`
prop that nothing passes (`BoardCanvas.tsx:18`) — the dangling prop turns out
to be this pattern, half-built. This spec finishes it rather than replacing it.

**No shared `Settings` type crosses a layer boundary.** `render` declares its
own options type, `ui` declares what it passes through, `app-shell` owns the
whole object and maps it down. A setting therefore only ripples into the layers
that actually consume it, and the type does not have to find a home in
`engine` — which is the only package `render` can import, and the last place a
presentation type belongs.

## Storage

One key, `sl:settings`, in `localStorage`, following `packages/net/src/identity.ts`
exactly:

- Every read and write wrapped in `try`/`catch`. Private browsing and disabled
  storage must degrade to defaults, never throw.
- **Validate and repair on read, and write the repair back.** This is the fix
  `loadProfiles` already carries: without the write-back, the same junk is
  re-validated on every load and a caller reading the key directly still sees
  it.
- Unknown keys are dropped. Out-of-range values are clamped, not rejected.
  Missing values come from defaults.

**No version field.** Each field is validated and falls back independently,
which for a flat object is strictly more robust than a version number — there
is no migration to forget to write, and a corrupt field costs only that field.

Its cost, stated plainly: **renaming a setting silently resets it**, with no
migration path and no error anywhere. A rename is a data-loss event for every
existing player, and whoever does one owes the affected key a deliberate
read-old-write-new pass in the same change.

The store is `packages/app-shell/src/store/settings.ts`, beside `atoms.ts`.
Not `packages/net`, where `identity.ts` lives: that package is transport, and
settings are not. Reading is through an atom in the `atoms.ts` style, one
derived atom per slice, so a component re-renders on the setting it reads
rather than on every settings change.

## Two surfaces, and the rule that separates them

The brainstorm's answer to "what is a setting" is two-tiered, and the tiers are
told apart by one rule:

> **Device settings are remembered. Match settings are not.**

**Tier 1 — device settings.** Everything in the table below. Persisted to
`sl:settings`, never sent anywhere, never in an action, never in `MatchState`.
By construction they cannot desync anything: ADR 0001's determinism is
untouched because nothing here reaches the reducer.

**The tier 1 surface is an overlay, not a route.** Routes are registered in
`apps/game-web/main.tsx:53-58` against a hash history, so a `/settings` route
would *replace* the match screen — unmounting `BoardCanvas`, whose effect
constructs `BoardScene` and tears it down on cleanup (`BoardCanvas.tsx:55-74`).
Mid-round that discards the clip queue a round is currently replaying, so
opening settings during an animation would silently eat the rest of it. An
overlay above the current screen keeps the canvas mounted and behaves
identically from home and from a match, so there is one implementation rather
than two.

Its costs: the screen is not URL-addressable, and `verify:ui` has to reach it
by driving the control that opens it rather than by visiting a path.

**Tier 2 — match settings.** `MatchConfig`: `size`, `modules`,
`mutationInterval`, `mineCount`, `exactFinish`. These stay in the **lobby**,
where `Configure` already is, and **never appear in the settings menu** —
putting them there would imply they persist, and they do not. Today the lobby
edits only `modules` (`lobby.tsx:54`); `size`, `mineCount`, `mutationInterval`
and `exactFinish` are editable nowhere and sit at whatever `defaultConfig`
gave them. Exposing the rest is tier 2's work.

**The bridge between them** is a device setting *about* match setup: the host's
last-used `MatchConfig` is remembered locally and pre-applied when they open a
room. That is remembered, so it is tier 1, and it belongs in storage rather
than in the menu.

**What tier 2 must not claim.** `canHost` at `lobby.tsx:27` is `role !== "peer"`
and it is a UI gate only — `Configure` has no authorship check in the engine, so
a peer that sent one would have it sequenced and applied on every device. Under
ADR 0009 that is consistent: progression is declared at join time and trust is
social. Tier 2 must therefore be written as *the host's screen*, not as an
enforced permission, and nothing in it may depend on the host being the only
author.

## The settings

Four groups. **The grouping is semantic and belongs to this spec; its layout
belongs to spec B.**

### You

| Setting | Values | Default |
|---|---|---|
| `name` | free text | `suggestName()` |
| `colour` | one of a fixed palette | by seat |

`name` already exists in `sl:identity` and moves nowhere; the settings screen
is a second place to edit it, not a second place to store it.

`colour` **costs more than any other setting here**, and the spec is explicit
about the price because the brainstorm settled the decision without it:

- It is a **wire change**. `Join` gains a `colour`, so `Player` in
  `engine/types.ts` carries a presentation field into the determinism-critical
  package.
- It must be `Schema.optional`. A required field makes an older build's `Join`
  frame undecodable, and CLAUDE.md classifies an undecodable frame as `desync`,
  meaning mismatched builds — so a required field turns a cosmetic feature into
  a version wall.
- Seat assignment does **not** change. Seats stay join-order, because seat is
  the deterministic tiebreaker and the dice draw order. Colour is decoupled
  from seat; conflicts resolve by log order.
- The palette **excludes the green band** `renderer-legibility` reserves for
  link tinting. A player who picks green fights the snakes.
- **Nothing may ever price a rule on it.** That is exactly how `venom` went
  wrong — core state fed by one optional module — and an inert field in
  `Player` is an invitation.

### Controls

| Setting | Values | Default |
|---|---|---|
| `rollButton` | `hidden` \| `left` \| `right` | `right` |
| `confirmRoll` | on \| off | off |
| `haptics` | on \| off, hidden when unavailable | on |

**`rollButton` has a prerequisite that does not exist yet.** The brainstorm's
formulation — "the dice tray is always tappable; whether the Roll button shows
is the setting" — assumes a tappable tray. There is none. `Scene.pick`
raycasts the **board plane only** and returns a tile index; the dice are WebGL
objects driven by `Dice.show`, and nothing picks them.

So this spec builds the tray, and builds it as a **DOM control overlaying the
canvas**, not as renderer picking. Two reasons, and the second is the binding
one:

1. A `<button>` is focusable and keyboard-operable for free; a canvas hit-test
   is neither.
2. `RollButton` (`match.tsx:16`) is currently the **only** keyboard-reachable
   path to `Commit`. Allowing `hidden` while the only alternative is a
   raycast would make a presentation setting into an accessibility
   regression — a player who cannot use a pointer would lose the ability to
   take their turn.

The tray is an *input affordance*; `Dice.show` renders the *outcome*. They are
different objects and the spec keeps them apart, because putting an input
control inside the renderer is what ADR 0007 exists to prevent.

**`confirmRoll` is bounded deliberately.** A local are-you-sure before sending
`Commit` is fine. Anything shaped like undo is forbidden and the spec says so
in the same breath, for the same reason ADR 0020 rejects flick-to-throw: the
log is append-only, the host has sequenced the action, and the shared PRNG has
already advanced. There is nothing to undo.

**`haptics` is capability-gated, not platform-gated.** The control asks whether
*any* haptics backend answers, not whether this is Android:

- Backend one: `navigator.vibrate`. Present on Android browsers.
- Backend two, not built: a Tauri plugin. Tauri v2 is what this repo pins
  (`tauri = "2"`, `@tauri-apps/api ^2.11.1`), and it has a haptics plugin
  wrapping the platform APIs — **verify it against the pinned version before
  relying on this.**
- No backend answers → the control is not shown. It never claims a capability
  it does not have.

This matters because of what "iOS" means here. WebKit has never shipped the
Vibration API, in Safari or in an installed PWA, so no web path reaches
haptics on an iPhone. A Swift route via backend two is real but only reaches
the **installed Tauri iOS app** — and per the handoff, iOS's role in this
project is *guest in mobile Safari* through the host-served join, where there
is no native layer at all, while ADR 0011 keeps iOS builds manual with no CI.
The capability probe means adding backend two later touches the backend and
nothing else.

### Motion

| Setting | Values | Default |
|---|---|---|
| `speed` | `calm` (1×) \| `brisk` (1.5×) \| `quick` (2.5×) | `calm` |
| `reducedMotion` | follow OS \| on \| off | follow OS |
| `quality` | `high` \| `low` | `high` |

**The floor, derived from the clip table rather than chosen.**
`Scene.play` (`scene.ts:399`) builds a serial queue of clips with these
durations:

| Event | Duration |
|---|---|
| `Rolled` | 700 |
| `Moved` | `min(1100, 130 + 95 × steps)` |
| `TookLink` | 620 |
| `Knocked` | 520 |
| `MineTripped` | 320 absorbed, 640 otherwise |
| `Swapped` | 520 |

Speed scales a clip's duration, and **every clip is then clamped to a floor**:

```
effectiveDuration(duration, speed) = max(FLOOR_MS, duration / speed)
```

A per-clip clamp beats capping the multiplier, because long clips speed up
fully while short ones cannot vanish. Without it the shortest clip decides the
cap for all of them: a one-step `Moved` is 225ms, and at 2× that is 112ms.

**`FLOOR_MS = 150`, and the justification is in the code.** `step`
(`scene.ts:544`) already clamps `delta` to 64ms, so a 150ms clip renders at
least three frames even on a phone dropping them. Below that a causal beat can
become a single frame, which is a teleport — and ADR 0020 rule 1 says the beats
must stay separable at every speed.

**Why those three multipliers.** `quick` is 2.5× rather than the 2× the
arithmetic above uses as its example, because the clamp — not the multiplier —
is what keeps a beat visible, so the preset is free to be genuinely quick. At
2.5×: `Rolled` 280ms, `TookLink` 248ms, `Knocked` and `Swapped` 208ms, a
three-step `Moved` 166ms, and the two that would fall through — an absorbed
`MineTripped` at 128ms and a one-step `Moved` at 90ms — clamp to 150ms. A whole
four-player round drops from roughly 7s to under 3s while every beat still
renders at least three frames. Anything past 2.5× buys less and less, because
more of the table is sitting on the floor rather than scaling.

`effectiveDuration` is a pure function and is unit-tested as one. That is the
only honest way to test a floor: the alternative is watching an animation and
forming an opinion.

**`reducedMotion` sets the first-run default, never an override.** When the OS
reports `prefers-reduced-motion: reduce` and the player has expressed no
choice, motion starts reduced. Once they choose, their choice wins. An
accessibility preference nobody can escape is its own kind of hostility.

**Reduced motion removes flourish, never beats.** The momentum overshoot arc,
the board's breathing, the mine shudder's oscillation — decorative, and they
go. `Rolled → Moved → TookLink` stays, at the floor if necessary, because
ADR 0020 rule 1 outranks the preference: a player must still be able to see
what happened. Nothing in the tree honours `prefers-reduced-motion` today, in
CSS or in JS, so this is new behaviour rather than a correction.

**`quality` is already a prop and already dead.** It is in the dependency array
of the effect that constructs `BoardScene` (`BoardCanvas.tsx:75`), so changing
it tears the scene down and rebuilds it. That is acceptable in a menu and
unacceptable mid-round, so the spec forbids exposing it anywhere but the
settings overlay.

### Screen

| Setting | Values | Default |
|---|---|---|
| `tileNumbers` | on \| off | on |
| `roundLog` | on \| off | on |
| `keepAwake` | on \| off, hidden when unavailable | on |

**`tileNumbers` must invalidate the board texture explicitly.** ADR 0007
records the trap: board text is drawn into one 2D canvas and uploaded as a
single texture, with no dirty-tracking, redrawn only when the board state that
produced it changes. A setting is not board state. A toggle that does not
invalidate leaves stale numbers on screen until something unrelated redraws
them.

**`roundLog` hides the list visually and leaves the live region in the tree.**
`EventLog`'s `<ul>` carries `aria-live="polite"` (`EventLog.tsx:56`) and is how
a screen-reader player receives a round at all — ADR 0020 rule 2 keeps text for
exactly this reason. The naive implementation, returning `null` when off, turns
a cosmetic toggle into an accessibility switch. Off means visually hidden, not
absent.

**`keepAwake` has a hole that cannot be closed, only disclosed.**
`navigator.wakeLock` is `[SecureContext]`. The host-served join serves the game
over **plain HTTP** on the host's LAN address, so on a guest phone that scanned
the QR the API is simply not there. The host and the Pages build get it;
guests silently do not. This is the same origin tension the handoff already
records for install-versus-multiplayer, surfacing again: the capability probe
is what keeps the control from lying about it.

## What is out, and where it went

| Not here | Where |
|---|---|
| Camera pan | `renderer-legibility` — `fitCamera` owns the target |
| Snake/ladder/mine visibility toggles | Deferred behind `renderer-legibility`; its layering contract and per-link tint may dissolve the problem |
| Sound and mute | No audio subsystem exists. Adding one is a subsystem, not a setting |
| Any layout, spacing, iconography or asset decision | Spec B |
| Editing `MatchConfig` visually | Spec B lays out the lobby; tier 2 here defines what is editable |

## A finding this spec does not fix

ADR 0020 rule 1 says every `TimelineEvent` owes a board-visible depiction.
`Scene.play` handles **six** of the fifteen. `LinkCollapsed`, `Revealed`,
`MineDefused`, `CardPlayed`, `VenomGained`, `BoardBreathed`, `Stunned` and
`Finished` produce no clip at all — the code notes that `sync` picks up the
board-level ones, which is true for the board and not for the player, who is
told by a log line or by nothing.

That is eight instances of the rule failing on the day the rule was written. It
belongs to spec B and `renderer-legibility`, not here. It is recorded so the
next session finds it written down rather than rediscovering it.

## Files

| Path | Change |
|---|---|
| `packages/app-shell/src/store/settings.ts` | New. Storage, validation, repair, defaults, atoms |
| `packages/app-shell/src/app/settings-panel.tsx` | New. The overlay; unstyled beyond what exists, per the split |
| `packages/app-shell/src/routes/lobby.tsx` | Tier 2: the rest of `MatchConfig`; remember last setup |
| `packages/app-shell/src/routes/match.tsx` | Roll button placement; the dice tray; `confirmRoll`; haptics |
| `packages/ui/src/BoardCanvas.tsx` | Pass `quality` through at last; pass motion options |
| `packages/ui/src/EventLog.tsx` | Visually-hidden mode that keeps the live region |
| `packages/render/src/scene.ts` | `effectiveDuration`; a settable speed; reduced-motion flourish gating |
| `packages/render/src/board-texture.ts` | Tile numbers on/off, with explicit invalidation |
| `packages/engine/src/types.ts`, `actions.ts` | `colour`, optional, on `Player` and `Join` |

`apps/game-web/main.tsx` is deliberately **not** in this list: the overlay adds
no route, which is the point of the paragraph above.

## Testing

Unit, in vitest:

- `effectiveDuration` against the real clip table: every event at all three
  presets stays ≥ `FLOOR_MS`; long clips scale fully (`Rolled` at 2.5× is
  280ms, not clamped); a one-step `Moved` and an absorbed `MineTripped` clamp
  at `quick`. Table-driven, so adding a clip to `play` without adding a row
  fails.
- Settings load/validate/repair: junk, missing fields, out-of-range values,
  unknown keys, a throwing `localStorage`. Mirrors `identity.test.ts`.
- The repair is **written back** — the `loadProfiles` defect, in a new place.
- `Join` with no `colour` decodes (the cross-build case), and with one.
- Reduced-motion precedence: OS on + no choice → reduced; OS on + explicit off
  → not reduced.

Behavioural, via `nub run build && nub run verify:ui` — **in that order**, since
`verify:ui` does not build:

- The settings overlay renders at 390×844 with no horizontal overflow, opened
  by driving its control — there is no path to visit.
- Opening the overlay mid-round does not interrupt the replay: the board is
  still animating behind it. This is the one the route-versus-overlay decision
  exists for.
- `rollButton: hidden` still leaves a focusable control that can send `Commit`.
  This is the one that catches the accessibility regression.
- `roundLog: off` leaves the `aria-live` node in the DOM.
- `tileNumbers` toggling actually changes the screenshot — the stale-texture
  trap is invisible in the source.

Not testable here, and the spec says so rather than pretending: haptics
(no device), wake lock (needs a real secure/insecure origin pair), and whether
any of the speeds *feel* right. All three need the hardware run
`docs/android-debugging.md` describes and nobody has yet performed.

## Build order

1. The store: storage, validation, repair, defaults, atoms. Nothing consumes it.
2. `effectiveDuration` and the speed path in `render`, behind a passed option.
3. The dice tray as a DOM control, and `rollButton` — tray first, because the
   setting cannot honestly offer `hidden` before it exists.
4. The remaining tier 1 settings, each to its consumer.
5. The settings overlay, wiring the store to the controls.
6. Tier 2: the rest of `MatchConfig` in the lobby, and last-setup memory.
7. `colour` last. It is the only wire change, and it is the easiest to defer if
   the spec runs long.

## ADRs

**None.** Everything here is governed by ADR 0020, which was written for this
purpose, and constrained by 0001, 0002, 0007, 0009, 0011 and 0018 without
altering any of them. The one decision that felt ADR-shaped — settings as
parameters rather than a bottom-of-graph package — is a consequence of the
existing layer rule rather than a new decision, so it is recorded here instead.
