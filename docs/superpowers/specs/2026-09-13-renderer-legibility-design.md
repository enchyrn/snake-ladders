# Renderer legibility and motion — design

**Status:** approved in conversation, not implemented. No code exists yet.
**Date:** 2026-09-13

**Paths remapped at 1d36bde.** This spec was written against the flat `src/`
layout, which is why its date predates the paths it now cites. Its file
paths and line citations were remapped to the Nx `packages/` and `apps/`
workspace at commit 1d36bde; no design decision changed.

Make the board readable, then make it move. The materials and lighting are
already good; what fails is that you cannot read the game off the screen.

## The evidence this design starts from

Captured with `nub run build && nub run verify:ui`, which drives the built app
into a pass-and-play match and rolls. Screenshots land in `screenshots/`, which
is gitignored, so the measurements are recorded here instead.

At a phone viewport of 780×1540:

- **The board occupies roughly a third of the screen** — about 550px, with
  ~230px of dead space above it and ~340px below. Tile numbers render at
  roughly 8px.
- **Snakes cover the tiles they cross.** Tiles 57, 58, 63–67 and 44–47 were
  visibly swallowed. The arithmetic agrees: the face and every painted state
  sit at `y = 0`, snake tubes occupy `y ∈ [0.01, 0.41]`
  (`geometry.ts:34`, `:93`), ladder rails sit at `y + 0.2` (`:154`), and pawns
  run `0.01 → 0.63` (`:191`). Three information layers competing for the same
  0.4 of vertical space, with no layering discipline.
- **Five snakes share one green; two ladders share one wood.** You cannot trace
  which head belongs to which tail — and where a snake drops you is the entire
  decision.
- **The minefield is invisible** while every tile is unrevealed, yet a
  four-item legend below the board permanently explains symbols that are not on
  screen.

The conclusion that shaped everything below: this is not "the graphics could be
prettier". **It is illegible, and legibility is a gameplay problem.**

## Decisions settled before this design

1. **Legibility and motion together**, treating the camera as one system — the
   static fit and any follow-the-action move are the same code, so designing
   them apart would mean writing it twice.
2. **Chrome shrinks, and the camera may crop.** The board's extra space comes
   from the UI, and the fit rule is additionally allowed to let the far corners
   leave frame. This deliberately reopens the constraint that fixed the
   clipped-columns bug, so it is replaced with a narrower guarantee that is
   *tested* rather than eyeballed.
3. **Links raise above token height and gain endpoint badges.** Not flattened
   into the board texture, and not made translucent.
4. **Token variety is derived from the room seed now**, with real choice
   arriving later through the RPG layer's class.
5. **The mine decision window is deferred to the integration pass**, with the
   RPG layer. It is the one requested item that changes the engine.

## Scope

In scope: `packages/render/src/` and `packages/ui/src/`. The camera fit and its
invariant, follow-the-action motion, link layering and identity, token variety,
three diagnosed bugs, and the chrome budget.

Out of scope:

- **The mine decision window.** Today `defuse` is played during `committing`
  against a target tile, so a mine is disarmed speculatively *before* moving.
  A "you are about to land on that — react" moment needs a decision window
  inside resolution: a phase or pending-decision state, an action, a rule for
  who may decide, and a timeout that is wall-clock and therefore cannot live in
  the reducer. That is a determinism-contract change wearing a graphics hat.
  Deferred to the integration pass.
- **Declared token choice.** See "Token variety" — it belongs with the RPG
  layer's `Join` extension, not beside it.
- **A visual overhaul.** Palette, materials and lighting stay. They work.

## Boundaries

**No engine change, no new action, no new event.** Two things follow.

First, everything here is verifiable with `vitest` plus `verify:ui`. Second, by
ADR 0007 the renderer renders and never decides — every value it animates was
already computed by the engine on every device — so a mistake here produces an
ugly frame, not a diverged match.

That second point also makes this **the safest work in the repository to
delegate to another model**, which is not true of anything under
`packages/engine/src/`.

## The camera as one system

### A pure fit function

```ts
fitCamera(input: {
  boardSize: number
  viewport: { width: number; height: number }
  fov: number
  protected: Box            // min/max in board XZ
}): { distance: number; target: Vec3; tilt: number }
```

No THREE side effects, so the framing rule becomes a vitest assertion instead
of a property someone has to remember to eyeball in a screenshot — which is
exactly how it broke the first time.

### The protected region

**At rest**, the bounding box of:

- every occupied tile,
- the acting seat's token,
- tile 1 and the final tile,
- the start pad, where waiting tokens stand,
- **the dice tray**,

expanded by one tile of margin. `fitCamera` guarantees that box is wholly in
frame. Board outside it may leave.

The dice tray is in that list for a reason: it sits at
`(0, 0, size / 2 + 1.6)` (`scene.ts:232`), in front of the board's near edge,
so a tighter framing would otherwise crop the dice while zooming in to read the
board.

**During a followed action the box narrows** to the acting token, the tiles its
timeline moves it across, and the dice tray. This is not a detail — with the
resting box, the camera can never move toward the action at all, because
keeping every occupied tile in frame is precisely what stops it. Two regions,
one function: `fitCamera` does not care which box it is handed.

When the replay ends, the box widens back to the resting one and the camera
eases with it, so a round finishes by showing the whole board again.

### The crop budget

Only the row furthest from the camera may exit frame, and at most about 1.5
tiles of it. **The near edge is never croppable.** Without a cap, "may crop"
degenerates into a framing that simply looks broken.

### The invariant, and where it is checked

> For every board size 5–12, across viewports from 320×568 to 1280×800, all
> four corners of the protected box project inside the viewport, and the near
> edge is inside.

This is a stronger guarantee than the current one, because the current one is
unenforced. It is checked twice: as a pure unit test over `fitCamera`, and at
runtime in the real browser through a `scene.framing()` debug hook that
`drive-app.mjs` reads.

### Follow-the-action

During replay the target eases toward the acting token and the fit recomputes —
the *same* `fitCamera`, with a moved target. The motion is short (~400ms) and
eased, and **fires only when the action would otherwise leave frame.** A move
within the current framing does not move the camera: gratuitous camera motion
on a phone is nausea, not juice.

**If the player has orbited manually, follow-the-action switches off
entirely.** `viewIsDefault` and `noteViewChange` (`scene.ts:90`, `:594`)
already track this. Taking the camera back from someone who just took it is the
most annoying thing this feature could do, and `⟲ Reset view` is already the
way to hand control back.

## Links

### A layering contract

| band | contents |
|---|---|
| `y = 0` | board face — numbers, counts, flags, mines, revealed state |
| `0.01 – 0.63` | tokens |
| `0.66 +` | snakes and ladders |

Links lift to just clear the tallest pawn. The **minimum** lift, not more.

**The honest cost: this trades occlusion for parallax.** A snake mouth floating
at 0.66 no longer sits visually on tile 73 at the default 56° tilt. The
mitigations are structural rather than decorative:

- a faint contact decal on the face at each endpoint, re-anchoring the link to
  its tiles;
- an endpoint badge, below.

### One badge, at the entry end

A billboarded chip at the entry end, naming the tile it delivers you to: at a
snake's mouth, `↓31`; at a ladder's foot, `↑73`. **Only the entry end gets
one.** A badge at the exit is noise, because the decision-relevant fact is
"where does this take me".

Where two badges would overlap, or a badge would sit over a token, it offsets
along its own link rather than disappearing — a badge that vanishes under
crowding is missing exactly when the board is most confusing.

Badges are drawn into **a single canvas texture, redrawn when `linkSignature`
changes** — the same technique and the same justification as
`board-texture.ts`, where a hundred label meshes were rejected as costing more
than the rest of the scene.

### Tap-to-trace

`BoardCanvas` already has tap detection with slop and multi-pointer guards
(`TAP_SLOP_PX`, `Press.multi`); `pick` currently raycasts the board plane
alone. Raycast `linkGroup` first: a hit pulses that link and its destination
tile for about two seconds, a miss falls through to tile picking exactly as
today.

Ordering matters — tapping a snake must not also flag the tile beneath it. This
is pure view state and is never sent, unlike `Flag`, which is a real action.

### Identity without colour

Hue belongs to seats (`seatColour`), so per-link rainbow colouring would fight
the tokens. Instead vary **value and saturation within the green family**,
derived deterministically from `link.id`, so adjacent snakes stop reading as a
single mass. The badge is the part that actually answers the question; the tint
is what stops five snakes looking like one.

## Token variety

Today every token is the same mesh: `pawnGeometry()` is a single
`LatheGeometry` from one profile, shared by every player (`geometry.ts:191`),
and the only thing distinguishing six players is `seatColour`.

Two reasons that is worth fixing beyond novelty:

- **Colour-only differentiation fails colour-blind players outright** — six
  identical silhouettes in six hues. The same argument that reserves hue for
  seats says silhouette must also carry information.
- `spreadOverlaps` exists specifically to "nudge co-located tokens apart so a
  stack is still countable" (`scene.ts:364`). A stack of four distinguishable
  shapes is far more countable than four identical ones, so variety makes an
  existing function work better.

The cost is near zero: N profiles produce N shared `LatheGeometry` instances
created once. Draw calls are unchanged — still one mesh per token.

### Where the appearance comes from

Two options are ruled out before the choice:

- **Not from match RNG.** Drawing from the shared stream to pick a look would
  consume from the same PRNG the dice come from, shifting every subsequent
  roll. A diverged game, for a cosmetic.
- **Not device-local.** If each phone picked its own look, "pass it to the blue
  one" stops meaning anything in a room where the devices disagree. Everyone
  must see the same tokens.

**Chosen: a pure function of `(seed, seat)`**, hashed *beside* the PRNG rather
than drawn from it. Deterministic, every device agrees, no protocol change, no
engine change. Each match's tokens also differ from the last, which is the
randomisation half of the request.

**Deferred, deliberately: the class implies the token.** The RPG spec already
extends `Join` with `classId` and `level`. If token choice also travelled in
`Join`, it would be extended twice by two designs that never saw each other.
Letting a Charmer and a Sapper look different delivers genuine customisation
with no second declared field and no second trust surface, and makes picking a
class in the lobby a visible choice rather than a line of text.

## Three diagnosed bugs

### The token teleport is an ordering bug

`BoardCanvas.tsx:75` calls `scene.sync(state)` **before** `scene.play(timeline)`.
`syncTokens` snaps every token whenever `clips.length === 0` (`scene.ts:351`),
and at that moment the previous round's clips have drained, so the guard does
not hold. Every token snaps to its **final** tile; only then do the clips queue
and animate from `event.from`. You see the destination for a frame, then the
walk from the origin.

**Fix:** make the snap explicit — `sync(state, { snapTokens })`, computed by
`BoardCanvas`, which is the only caller that knows whether it is about to
replay, and false when the incoming state carries a timeline that has not
played. Board texture and link
rebuilds stay immediate; only the token snap is deferred.

Reordering `play()` before `sync()` would also work, because the existing
`clips.length === 0` guard would then hold — but it would work *by accident*,
and the next person to reorder those two lines would silently reintroduce this.

### Roll spam, whose cause is a feature

`RollButton` is `disabled={!canRoll}` where `canRoll = canCommit(match, me)`.
But `MatchClient.send` never applies optimistically — that is the determinism
rule — so `commitments[me]` stays unset until the commit round-trips. The
button stays live in that window and every extra tap submits another `Commit`,
which the host sequences and the reducer then refuses, producing notice spam on
top.

On the local transport that gap is one microtask. **Over a network it is a full
round trip**, so it is considerably worse in the mode that has never been
played on hardware.

**Fix:** a UI-only in-flight marker on `ClientState`, set in `send()` and
cleared when that action folds in `drain()`, when submit fails, or on
disconnect — so the button cannot wedge permanently. `canRollAtom` becomes
`canCommit(...) && !inFlight`.

**It must be per-seat, not a single boolean.** Once the session design lets a
device drive several seats, a global flag would block rolling for seat B while
seat A's commit is in flight. So it is a set of playerIds.

### The dice present rather than roll

`RESTING` precomputes the orientation that faces the rolled value at the camera
(`dice.ts:45`), and the 700ms clip interpolates to it. No tumble, no settle, no
anticipation.

**Fix:** tumble with anticipation, overshoot and a settle onto `RESTING`, over
about 900–1100ms with the value readable by ~700. The contract survives
untouched: tumble however you like, land on the precomputed orientation, so the
die stays a readout of a decided result rather than a source of one.

## Chrome

Target: the board goes from roughly a third of the viewport to around 60%.

- **The player strip collapses into the progress bar.** Each seat becomes a pip
  positioned on the progress track at its tile, rather than a list above a
  separate bar. Two rows become one, and position becomes spatial instead of a
  number to read.
- **The event log shows its last line only**, inline, tapping to expand the
  history. It currently spends ~250px to show one sentence, and `describe`
  (`EventLog.tsx:5`) emits a line for nearly every event type, so a busy round
  floods it.
- **The mine legend moves behind a `?`.** It permanently explains four symbols,
  none of which are on screen until tiles are revealed.
- **Banners overlay rather than occupy layout**, and notices auto-dismiss.
- **Indicators move to where the decision is.** `☣ » ⚓ 💤` currently sit in the
  roster row carrying `title` attributes — hover text, on a touch game, which
  is no affordance at all. Venom matters at the moment a card is chosen, so the
  venom count belongs beside the card rail; `title` becomes tap-to-explain.

## Files

- `packages/render/src/camera.ts` — new: `fitCamera`, the protected box, the
  crop budget.
- `packages/render/src/scene.ts` — consume `fitCamera`, follow-the-action, the
  layering bands, link tinting, `sync(state, { snapTokens })`, `framing()`
  debug hook.
- `packages/render/src/geometry.ts` — N token profiles; badge and contact-decal
  geometry.
- `packages/render/src/link-badges.ts` — new: the single badge canvas texture.
- `packages/render/src/dice.ts` — tumble and settle.
- `packages/ui/src/BoardCanvas.tsx` — snap ordering, link raycast ahead of tile
  pick.
- `packages/ui/src/HUD.tsx` — strip into progress, indicators beside the card
  rail, tap-to-explain.
- `packages/ui/src/EventLog.tsx` — last line, expandable.
- `packages/app-shell/src/routes/match.tsx` — chrome layout, roll gating.
- `packages/app-shell/src/store/atoms.ts` — in-flight set, `canRollAtom`.
- `packages/app-shell/src/store/match-client.ts` — set and clear the in-flight
  marker.
- `scripts/drive-app.mjs` — read `framing()`, capture mid-replay.

## Testing

- **`fitCamera` pure unit tests** — the protected-box invariant across board
  sizes 5–12 and viewports 320×568 to 1280×800, the near edge never cropped,
  and the crop budget capped.
- **The same invariant asserted in the real browser**, through `scene.framing()`
  read by `drive-app.mjs`. One invariant, verified pure *and* in situ.
- **Roll gating without WebGL** — two `send`s against a fake transport, assert
  one submit reaches it, and assert the marker clears on fold, on failure and
  on disconnect.
- **The snap decision as a pure predicate**, unit-tested directly. WebGL under
  vitest is not worth fighting; `verify:ui` covers the visual.
- **Token variety is deterministic** — same `(seed, seat)` yields the same
  profile on two independent instances.
- **`verify:ui` gains a mid-replay capture**, and keeps its existing
  console-error, page-error and horizontal-overflow gates.

## Build order

1. **`fitCamera` and its tests first**, before touching the scene. It is the
   piece everything else is framed by, literally.
2. Chrome shrink — the board cannot get bigger until the UI gives the space
   back.
3. Wire `fitCamera` in, with the crop budget and the browser-side assertion.
4. The three bugs: snap ordering, roll gating, dice. Independent of each other
   and of the above; each is small and each is separately verifiable.
5. Link layering, contact decals, badges, tinting.
6. Tap-to-trace.
7. Token variety.
8. Follow-the-action, last — it is the only piece that needs everything else
   settled to tune.

## ADRs

One ADR: **the board may crop outside a protected region.** It reverses a
previous decision, which is exactly what an ADR is for, and its cost is worth
recording — the guarantee that the whole board is always visible is gone, and
what replaces it is only as good as the protected region's definition. Get that
list wrong and something important goes off screen.

The renderer's existing boundary (ADR 0007 — it renders, it never decides) is
unchanged and needs no new record.
