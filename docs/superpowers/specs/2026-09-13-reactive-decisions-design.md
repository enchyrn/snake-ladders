# Reactive decisions and gameplay integration — design

**Status:** approved in conversation, not implemented. No code exists yet.
**Date:** 2026-09-13

The integration pass. It started as "make the existing elements fit together"
and the audit found why they do not: **the venom economy funds reactions the
game never gives anyone a chance to make.**

## Decisions settled before this design

1. **Resolution may pause.** A round can stop mid-resolution and ask a player to
   respond. This is the real fix for the mine moment rather than a feature
   bolted beside it.
2. **Pausing re-runs rather than resumes.** No continuation state; an
   accumulating list of responses and a pure re-run from the round's start.
3. **A paused round previews.** The pending decision carries the events computed
   so far, for presentation only, so the token walks to the mine and stops.
4. **A match plays on for places.** It no longer ends the moment the leader
   crosses.

## What the audit found

Six findings, all read out of the code. The first five are defects; the sixth is
why this design exists.

### 1. Playing a card re-animates the entire previous round

Nothing clears `timeline` at the start of a round — the only writes are the
initial `[]` (`match.ts:28`), `Start`'s `[]` (`:220`), `playCard` appending
(`:109`), and `resolveRound` replacing (`resolve.ts:297`). `Commit` does not
touch it.

So during `committing`, `state.timeline` still holds the previous round's
resolution events. `playCard` does `[...state.timeline, CardPlayed]`, producing
a new array identity, and `BoardCanvas` replays the whole thing — every
`Moved`, `TookLink` and `MineTripped` from the round before, then the card.
Spend a venom, watch last round happen again.

### 2. Card events are then destroyed

`resolveRound` **replaces** `timeline: ctx.events`, so `CardPlayed`, `Swapped`
and `MineDefused` never survive into the settled log — even though
`EventLog.describe` has cases written for all three. They flash, then vanish.

### 3. A snake absorbed by `anchor` is completely silent

`applyTile` narrates mine absorption as `MineTripped { absorbed: true }`, but
`applyLink` just returns `0` with no event at all (`resolve.ts:110`). The player
spends venom, the snake does nothing, and nothing says why.

### 4. The engine is first-past-the-post; the UI is a podium

`finished = winners.length > 0 || stillRunning.length === 0` ends the match the
moment anyone crosses. Yet `applyFinish` computes
`place: state.winners.length + placed.length` as though placing continues, and
`match.tsx` renders an `<ol className="standings">` that will essentially always
hold one name. Two components disagree about what winning means.

### 5. Card timing is inconsistent

`swap` and `defuse` act immediately inside `playCard`; `anchor`, `reverse` and
`double` defer to resolution. One rail, two different moments.

### 6. Every card is a blind pre-commitment

All cards are played during `committing`, before the roll. `reverse` bets on a
link you have not reached. `anchor` is insurance bought before you know the
risk. `defuse` targets from where you are standing, not where you will land.

**There is no point in the game where information arrives and a player may
respond to it.** The mine complaint that prompted this pass is not a gap in the
minefield — it is this, surfacing at the most painful spot.

## Scope

In scope: the decision window, the timeline split, card timing, the silent
anchor, playing on for places, and the class-implies-token thread carried from
the renderer design.

Out of scope: the RPG layer itself, which keeps its own spec. This design
changes the ground it will be built on and says where they meet.

## The decision window

### Re-run, do not resume

The obvious implementation is a resumable fold: record where resolution stopped
and continue from there. That means representing "position inside `moveOne`" as
schema'd data — both bloat and a new way to desync.

Instead, keep a list of responses for the in-flight round and **re-run
`resolveRound` from the round's start each time.** It is pure and the
round-start RNG is unchanged, so a re-run is byte-identical up to the point it
previously stopped. When it reaches a decision whose response is not yet in the
list, it stops; when the response arrives, the re-run gets past it and may hit
another. A round is a few dozen operations, so recomputing costs nothing.

This is the same trick the codebase already runs on: **do not store position,
store inputs and recompute.** The save file is the log; the round is its
responses.

### All-or-nothing resolution

An attempt either completes and returns the new state, or returns the state
**unchanged** except for `phase`, the pending descriptor and the responses so
far. Board, players and RNG stay at round-start values until the round finishes
completely.

No partial application ever lands, so no device can be caught holding half a
round — which is what makes the re-run safe rather than merely cheap.

### Why the event list is prefix-stable, and why that matters

A response can only affect behaviour **at or after its own decision point**, and
everything before it is the same pure computation over the same round-start
state. So across every re-run of a round, the events produced before decision
*N* are identical.

That guarantee is what the whole presentation model rests on. The preview shown
at decision *N* holds exactly the events the completed round's `timeline` will
begin with, so a renderer that has played *N* events can resume at index *N* of
the settled timeline and will neither repeat nor skip one.

Without prefix-stability the cursor would be guesswork; with it, the cursor is
simply correct. Any future change that lets a later response alter an earlier
event breaks this, and the fuzz driver should be the thing that notices.

### Shape

```ts
type DecisionKind = "mine" | "snake"

interface PendingDecision {
  readonly playerId: string
  readonly kind: DecisionKind
  /** The mine underfoot, or the snake's mouth. */
  readonly tile: number
  /** Affordable and relevant cards. Never empty — see below. */
  readonly options: ReadonlyArray<CardKind>
  /** Presentation only. Never folded into state. */
  readonly preview: ReadonlyArray<TimelineEvent>
}

interface Response {
  readonly playerId: string
  /** Which decision of this round. Guards against stale and duplicate replies. */
  readonly index: number
  /** `null` is a decline. */
  readonly card: CardKind | null
}

type Attempt =
  | { readonly _tag: "Resolved"; readonly state: MatchState }
  | { readonly _tag: "Awaiting"; readonly decision: PendingDecision }

const attemptRound: (
  state: MatchState,
  responses: ReadonlyArray<Response>,
) => Attempt
```

`MatchState` gains `pending: PendingDecision | null` and
`responses: ReadonlyArray<Response>`, both cleared when a round completes.
`Phase` gains `"deciding"`.

A new action, `Respond { playerId, index, card }`, is **refused unless
`index === responses.length`**, so a duplicate or stale reply cannot be folded
twice.

### Which moments pause

Two, not every link:

- **A live mine underfoot.** Options: `anchor`.
- **A snake mouth about to take you.** Options: `anchor` to shrug the bite off,
  `reverse` to turn it into a climb of the same span.

The snake case is the one that earns the machinery. It is a real choice between
cheap negation at 1 venom and expensive reversal at 2, made with full knowledge
of which snake and how far it drops — which is exactly what `reverse` never had
before.

### Never pause for a decision nobody can act on

`options` holds only cards the player can both afford and use. **If it is empty,
there is no pause** and resolution continues straight through. Otherwise the
game stops to offer choices nobody can take, and a broke player is interrupted
every round for nothing.

This is computed purely from `player.venom` and the config, so every device
agrees on whether a pause happens at all.

**The affordability rule matters most under `simultaneous`**, where a round
moves every player and can therefore hit several decision points, each stopping
everyone else while one person chooses. That is the mode where an unnecessary
pause is most expensive, and the rule is what keeps the count down to decisions
that are genuinely live.

### Timeouts

The engine never reads a clock. When a local timer expires, a device submits
`Respond { card: null }`, which enters the log and folds identically everywhere.

**Two devices run that timer:** the deciding player's own, and the host as a
backstop in case that player has dropped. Both produce the same action and the
`index` guard makes the second one a no-op. This is the pattern the session
design already set for the absent-player `Leave`, and it is here for the same
reason: without a backstop, one disconnected player stalls the match forever.

## The timeline split

Findings 1 and 2 are one bug wearing two faces: `timeline` serves both as "the
settled narration of the last round" and as "things that have just happened",
and resolution destroys the second.

**A separate accumulator.** `MatchState` gains
`cardEvents: ReadonlyArray<TimelineEvent>`:

- `playCard` appends there, never touching `timeline` — so a card play no longer
  creates a new `timeline` identity, and finding 1 disappears at its root.
- `resolveRound` returns `timeline: [...state.cardEvents, ...ctx.events]` and
  clears `cardEvents` — so card plays survive into the settled narration, and
  finding 2 goes with it.

**The renderer plays from a cursor, not from array identity.** Three sources
feed it across a round — `cardEvents` as cards are played, then `preview` at
each pause, then the settled `timeline` — but it treats them as **one logical
stream per round**: card events first, then round events, which the
prefix-stability above guarantees only ever grow at the end. It plays
`[playedCount, length)` and advances, resetting on round change. That is the
structural fix: replaying "the whole array whenever its identity changes" is
what turned an append into a re-animation, and a cursor also serves the preview,
where a re-run must not replay events already shown.

## Proactive and reactive cards

With a decision window, the timing inconsistency in finding 5 resolves into a
rule rather than a patch:

| card | when | why |
|---|---|---|
| `double` | proactive | a bet on the roll; correctly placed before it |
| `swap` | proactive | board manipulation, not a response |
| `defuse` | proactive | a deduction play, priced by information |
| `anchor` | **reactive** | insurance is worthless bought blind |
| `reverse` | **reactive** | "the next link" is meaningless until you know which |

`anchor` and `reverse` leave the pre-roll rail entirely. **Proactive cards shape
your turn; reactive cards answer a threat.** Same five cards, two clearly
different moments, and a player who understands one understands the other.

### `Player.anchored` disappears

Anchor is spent at the moment it is needed, so the persisted `anchored` flag —
and the subtlety that it survives across rounds — is deleted rather than
maintained. That removes a field from the schema, a branch from `applyTile` and
a branch from `applyLink`.

The RPG spec's *Rope* relic ("a free anchor") re-reads cleanly as **your next
reactive anchor costs nothing**, so nothing in that design is lost.

## The silent anchor

Finding 3 matters more once anchor is reactive, because the player will have
actively chosen to spend at that exact moment and must see it work. `applyLink`
gains a `LinkAbsorbed { playerId, linkId, kind, tile }` event, narrated by
`EventLog` and rendered as a shrug-in-place, mirroring how
`MineTripped { absorbed: true }` is already handled.

## Playing on for places

`finished` becomes `stillRunning.length === 0` — the `winners.length > 0` clause
goes. `applyFinish`'s place arithmetic is already written for this and needs no
change; `isPlaying` already excludes finished players, so they simply stop
taking turns.

The match now ends when nobody can still move. `settle`'s existing loop guard
already covers the degenerate case where every remaining player is stunned.

`match.tsx`'s standings list stops being a lie, and the result overlay becomes a
podium with the winner called out rather than a one-item ordered list.

**This is also what gives the decision window somewhere to matter.** A trailing
player has the most venom banked precisely when the leader crosses, and under
the old rule that banked venom was simply deleted.

## Class implies token

Carried from the renderer design, which settled seed-derived token variety now
and choice later.

When the `rpg` module is on, the token profile derives from `classId` rather
than from `(seed, seat)`. A Charmer and a Sapper look different because of what
they are, so customisation arrives with **no second declared field and no second
trust surface** — `Join` is extended once, by the RPG spec, not twice by two
designs that never saw each other. With `rpg` off, seed-derived variety remains,
unchanged.

## Relationship to the RPG spec

`docs/superpowers/specs/2026-09-13-rpg-layer-design.md` is unchanged and still
accurate, with three notes for whoever builds it:

- **Build this first.** The RPG layer's classes bend rules that this design
  moves. Six classes against a resolution that has just learned to pause is a
  much larger combination space than six classes against one that has not.
- *Rope* re-reads as a free reactive anchor, per above.
- *Ivory Charm* ("one re-roll") is a natural **third decision kind** once the
  window exists, rather than a mechanism of its own.

## Files

- `src/engine/primitives.ts` — `DecisionKind`, reactive/proactive card split.
- `src/engine/types.ts` — `PendingDecision`, `Response`, `pending`, `responses`,
  `cardEvents`, `"deciding"` phase; `Player.anchored` removed.
- `src/engine/actions.ts` — `Respond`.
- `src/engine/resolve.ts` — `attemptRound`, the decision points, `LinkAbsorbed`,
  `finished` without the winners clause.
- `src/engine/match.ts` — `Respond` handling and the index guard; `playCard`
  writing to `cardEvents`; reactive cards leaving the pre-roll path.
- `src/engine/events.ts` — `LinkAbsorbed`.
- `src/ui/BoardCanvas.tsx`, `src/render/scene.ts` — the play cursor and preview.
- `src/routes/match.tsx` — the decision prompt, the timer, the podium.
- `src/store/atoms.ts`, `src/store/match-client.ts` — pending decision selectors,
  the local and backstop timers.

## Testing

- **Extend the determinism fuzz driver with random responses**, and assert two
  peers still fold identically across every module combination. This is the
  guard that makes the rest safe; it comes first.
- **All-or-nothing as a property**: an `Awaiting` attempt leaves `board`,
  `players` and `rng` byte-identical to its input.
- **Re-run determinism**: `attemptRound(state, responses)` called twice returns
  identical results.
- **The index guard**: a stale or duplicate `Respond` is refused, and the
  backstop timeout after the player's own decline is a no-op.
- **No pause when unaffordable**: a player with no venom resolves straight
  through a mine and a snake mouth.
- **Timeline**: a card play does not change `timeline`'s identity, and card
  events are present in the settled timeline after resolution.
- **Places**: a four-player match yields four places in finishing order.
- `nub run verify:ui` for the prompt, the preview and the podium.

## Build order

1. **The timeline split.** Small, independent, and it fixes two visible bugs
   before anything larger touches the renderer.
2. **Playing on for places.** Also small, also independent.
3. **Refactor `resolveRound` into `attemptRound` with zero decision points.**
   A pure no-op refactor whose correctness the existing fuzz driver already
   proves. Do not add a pause in the same step as the reshape.
4. The mine decision.
5. The snake decision; `anchor` and `reverse` become reactive; `Player.anchored`
   is removed.
6. Preview rendering and the play cursor.
7. `LinkAbsorbed` narration.
8. Class-implies-token, after the RPG layer lands.

Step 3 is the one to be disciplined about: reshaping resolution and changing its
behaviour in one commit would leave the fuzz driver unable to tell you which of
the two broke it.

## ADRs

One ADR: **resolution may pause, and it re-runs rather than resumes.**

Its costs, which are the part worth recording:

- `MatchState` grows a pending/response surface that every device must agree on.
- Every decision point is a place a match can stall, which is why the host
  backstop timer is part of the design rather than a refinement of it.
- Re-running trades CPU for state simplicity. That is the right trade at six
  players and a few dozen operations per round, and it would stop being the
  right trade if rounds ever became expensive.

ADR 0001 (deterministic lockstep with shared dice state) and ADR 0002 (twists as
toggleable rule modules) are unchanged; this extends the first rather than
amending it.
