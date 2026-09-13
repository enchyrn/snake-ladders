# Session lifecycle and save files — design

**Status:** approved in conversation, not implemented. No code exists yet.
**Date:** 2026-09-13

**Paths remapped at 1d36bde.** This spec was written against the flat `src/`
layout, which is why its date predates the paths it now cites. Its file
paths and line citations were remapped to the Nx `packages/` and `apps/`
workspace at commit 1d36bde; no design decision changed.

Local-first saves, a real way in and out of a match, and the device-local
profiles that pass-and-play needs in order to seat more than one person.

## Decisions settled before this design

Five answers were given in conversation. All five are load-bearing and should
not be quietly revisited.

1. **Pass-and-play saves, and a host can resume.** Peers cannot. Resuming a
   hosted room seeds both sequencers from a stored log; every other device
   rejoins through the catch-up path that already exists.
2. **Autosave on every fold.** Not an explicit Save button, and not throttled
   to round boundaries. A crash, a closed tab or a dead battery must not cost
   the match, because that is exactly when someone wants it back.
3. **A capped list of saves, newest first** — five, evicting the oldest. Not
   one slot: starting a pass-and-play round must not silently destroy a Wi-Fi
   game someone meant to return to.
4. **Device-local profiles, split into owners and guests.** A device holds one
   or more owner profiles (the people it belongs to) and any number of guests
   (people who play here but belong elsewhere). A guest can later *graduate* to
   an owner profile on its own device, carrying its id and whatever progression
   has accumulated against it.
5. **Graduation travels offline now, over the transport later.** A QR code,
   with a copyable text string as the fallback, moves the record today. Handing
   it across a live match is a second carrier for the identical payload,
   deliberately deferred — not a redesign.

## Scope

In scope: the save format, the autosave path, the save shelf, profiles and
seat ownership, profile transfer, match exit and resume, and the sequencer
seeding that host resume needs.

Out of scope, and named here so the boundary is explicit:

- **Peer-side resume**, and any model where more than one device can claim to
  be the room. Rejected when the save scope was chosen.
- **Merging two progression histories.** Importing a profile whose id is
  already present offers *replace* or *cancel*, never a merge, so no
  reconciliation rules are needed.
- **The transport carrier for graduation.** Designed for, not built.
- **The RPG layer.** This design carries its progression blob opaquely and
  otherwise leaves `docs/superpowers/specs/2026-09-13-rpg-layer-design.md`
  alone.

## Boundaries

A new `packages/app-shell/src/session/` — inside `app-shell` rather than a
seventh Nx project, because `app-shell` already owns session composition and
its only consumers, `routes/` and `store/`, are its own siblings; engine
types reach it through the dependency direction app-shell already has.
**Nothing in it touches `packages/engine/src/**`** — it calls `Date.now()`,
`localStorage` and `crypto.randomUUID()`, all three of which the determinism
contract bans from the engine.

What follows from that is the main structural claim of this design: **the
engine does not change at all.**

- Saves need no new action, because the ordered action log *is* the save.
- Pass-and-play multi-seat needs none, because `Join` already carries an
  arbitrary `playerId` and `match.ts:185` already admits six players.
- Host resume touches `crates/lan-sync` and `apps/relay/lan-relay.mjs`, not the
  reducer.

So `packages/engine/src/__tests__/determinism.test.ts` and every rule test stay
exactly as meaningful as they are today, and this work cannot regress them.

## The save format

```ts
interface SavedMatch {
  readonly version: 1
  readonly id: string                    // not the seed: two matches can share one
  readonly config: MatchConfig
  readonly log: ReadonlyArray<unknown>   // encodeAction output, in seq order
  readonly kind: TransportKind
  readonly role: Role
  readonly seats: ReadonlyArray<string>  // playerIds this device drives
  readonly savedAt: number
}
```

**The save file and the wire frame are the same bytes.** The log holds
`encodeAction` output and restores through `decodeAction` — the exact pair
`packages/app-shell/src/store/match-client.ts` already uses on the network
path. A corrupt or foreign save then fails the same decode a mismatched
build fails, and the client already has a story for that
(`undecodable action at #n`). There is no second serialiser to keep in step
with the schema.

Sequence numbers are not stored. The log is ordered and dense, so seq *is* the
index — which is already how the relay derives it (`lan-relay.mjs:112`).

### Refused actions are part of the log

The saved log must contain every action the host **sequenced**, including ones
the reducer **refused**. Those actions are in the host's log, every device
rejects them identically, and a replay that skipped them would fold a different
sequence and diverge the PRNG stream.

So the write happens in `MatchClient.drain()` across everything it consumes
from the buffer — applied and refused alike — not across `applied` only.
`drain()` is the single funnel every action passes through in order, which
makes it the one honest write site.

This is the easiest thing in the whole design to get wrong, and it would fail
silently: a match would restore, look right, and diverge on the next roll.

### Shelf mechanics

- `sl:match:<id>` holds each save.
- `sl:matches` holds an index — id, room code, player names, round, timestamp —
  so the start menu renders the list without parsing five full logs.
- Cap five, evicting the oldest by `savedAt` — **excluding the match currently
  being played**, which is never a candidate however old its first write is.
- Writes are wrapped in try/catch exactly as `packages/net/src/identity.ts:41`
  already does. A quota or private-browsing failure surfaces **once** as a
  notice ("this match won't be saved"), not once per action.
- An unrecognised `version` lists the row as unreadable rather than crashing
  the menu.

## Profiles and seat ownership

`packages/net/src/identity.ts` grows from a single identity to a roster under
`sl:profiles`:

```ts
type ProfileKind = "owner" | "guest"

interface Profile {
  readonly id: string
  readonly name: string
  readonly kind: ProfileKind
  readonly createdAt: number
}
```

Owner profiles are plural on purpose: a family tablet has several. Guests are
created in the lobby.

**Migration keeps the existing id.** The current `sl:identity` becomes the
first owner profile *without regenerating `playerId`*. That id is what lets a
dropped player reclaim their seat (`identity.ts:19`), so minting a fresh one
would orphan anyone mid-match across the upgrade.

### Seats, not "me"

`ClientState.me: string` becomes `seats: ReadonlyArray<string>` — the
playerIds this device drives, in seat order. An array rather than a Set: it is
ordered, it spreads cleanly through the existing readonly state, and it
serialises straight into `SavedMatch.seats`.

Call sites, all thin:

- **`packages/app-shell/src/store/atoms.ts`** — `meAtom` becomes `seatsAtom`.
  `canRollAtom` is no longer sufficient alone, because the Roll button must
  know *which* seat it is rolling for. Add `actingSeatAtom`: the first owned
  seat that currently owes a roll. It drives both the button's label ("Roll for
  Sam") and the `playerId` it sends.
- **`packages/app-shell/src/routes/match.tsx`** — `mePlayer` feeding `CardRail`
  becomes the acting local player; `pickTile` sends that seat's id.
- **`packages/ui/src/HUD.tsx`** — `is-me` becomes "any seat I drive", with a
  distinct marker on the acting one.
- **`packages/app-shell/src/routes/lobby.tsx`** — sends one `Join` per selected
  local profile in roster order, instead of exactly one.

Two things this buys:

- **`actingSeatAtom` unifies both module regimes.** With `simultaneous` off,
  one seat is active. With it on, several owned seats owe a roll at once and
  the device chews through them in seat order. One rule, no branch.
- **Nothing here is pass-and-play-specific.** It is "seats this device drives",
  so a Wi-Fi host who is also passing their phone to a friend gets multi-seat
  with no special case. That is why it lives on `ClientState` rather than
  behind a mode flag.

`canCommit(state, playerId)` keeps its signature; it is simply called once per
owned seat.

## Graduation

```ts
interface ProfileTransfer {
  readonly version: 1
  readonly profile: { readonly id: string; readonly name: string }
  readonly progress?: unknown   // opaque here; the RPG layer owns its shape
}
```

`progress` is **opaque to the transfer layer**. The RPG spec owns that schema
and transfer only carries the blob, so the RPG layer can land later without
reopening this design.

The carrier-agnostic part is the *encoding*, not an interface: one
`encodeTransfer` / `decodeTransfer` pair, schema-validated the way
`packages/engine/src/actions.ts` validates the wire. Carriers only move the
resulting string.

- **Carrier 1, built now:** the holding device renders the string as a QR,
  with the raw string shown beneath it to copy; the receiving device scans or
  pastes. This needs no network at all, so it is not blocked behind the
  `wss://` relay gap (`docs/handoff.md`, open thread 1).

  **This is not a room code.** A room code is four characters because it
  encodes nothing but a seed. A transfer payload carries an id, a name and an
  opaque progression blob, so it is a long base64url string that nobody will
  read aloud. QR is the primary carrier and the text is the fallback for when
  a camera is unavailable — not the other way round.
- **Carrier 2, deferred:** a live match hands the identical string across the
  transport. Because the bytes are the same, it is an added call site rather
  than a redesign.

### Import semantics

- Import creates an **owner** profile on the receiving device, keeping the id.
- **Same id already present** → "you already have this profile", offering
  *replace* or *cancel*. Replace is a same-id refresh, not a merge, so no
  progression-reconciliation rules are required.
- **Same name, different id** → allowed. Names were never unique; offer a
  rename.
- **Transfer is a copy, not a move.** The source device keeps its guest record,
  and deleting it is a separate manual act. A half-scanned QR must never be
  able to destroy the only copy of someone's profile.

Nothing verifies any of it — a payload can be hand-crafted. That is the same
answer ADR 0009 already gave, for the same reason: the players are in the same
room, and the only technical fix is a trusted authority the whole project
exists to avoid.

## Lifecycle

**Only a device that can resume a match saves it.** `role: "local"` and
`role: "host"` write; peers do not. Peer-side resume was ruled out of scope, so
a peer save would put a Continue row on the shelf that cannot continue.

### The absent-player defect this design must fix

`connected` is **engine** state, flipped only by `Join` (`match.ts:182`) and
`Leave` (`match.ts:196`). The transport's roster is a separate channel:
`sequencer.leave()` (`lan-relay.mjs:118`) flips its own flag and broadcasts a
`roster` frame, and never submits an engine `Leave`. That separation is
correct — the contract forbids the transport feeding the engine.

But **nothing in the app ever sends `Leave`.** The action is in the schema, the
reducer handles it, and it has no caller. So today a peer whose socket drops
stays `connected: true` forever, `pendingCommitters` keeps waiting on them, and
**the round is stuck.**

That is a live defect, not one this design introduces. Host resume makes it
routine rather than rare, so it is fixed here:

> On resume, and on a socket drop mid-match, the host submits `Leave` on behalf
> of a player who has not reconnected within 20 seconds.

Twenty seconds is a host-local timer, not a protocol constant: no other device
needs to agree on it, because what the others fold is the resulting `Leave`
action, not the timeout that produced it. It is long enough to cover a Wi-Fi
handover and short enough that a round does not feel hung.

This is legal and deterministic. `Leave` is an ordinary action, it enters the
log, and every device folds it identically. The *decision* to send it is
host-local and clock-driven, but that is true of every action anyone submits:
non-determinism in **who acts** was never the contract; non-determinism in
**how an action resolves** is. No engine change, and the standing defect is
repaired as a side effect.

`Join` stays refused mid-match (`match.ts:177`), which is right: a returning
player is already `connected: true` and needs nothing. `host.rs:262` readmits
them because their seat and their actions are already in the log.

### Exit

The match screen gains a `‹ Leave` control in a `.bar` header, matching
`packages/app-shell/src/routes/lobby.tsx`. Behaviour by role:

- **local** — the save is already current; navigate home with no confirmation.
  Nothing is lost, so do not ask.
- **host** — confirm first, because it is destructive *for other people*, not
  for you: "Leave and end the match for everyone?" Then `session.close()`,
  which already calls `transport.leave`. The save persists, so the host can
  resume later.
- **peer** — send `Leave`, drop the socket, go home. No save.

### Pause

Pause is not a separate concept for pass-and-play: the save is always current,
so pausing and exiting are the same act. For a host, pausing *is* leaving with
the intent to return.

**`docs/handoff.md` open thread 2 is a prerequisite for that feeling honest.**
A peer can currently miss the host going away entirely, so a host who pauses
leaves peers hanging. It does not block pass-and-play saves; it does block host
resume being a good experience.

### Resume

The start menu gains a Continue section above the three existing buttons,
newest first, each row showing room code, players, round and when. An explicit
× deletes.

The flow reuses the existing fold rather than writing a second one:

1. Read the save and decode the log. A bad version or a failed decode marks
   that row unreadable; it does not crash the menu.
2. `session.open({ role, seed: config.seed, kind, config })` for a fresh
   client.
3. `MatchClient.restore(log)` feeds the entries through the **same**
   `receive`/`drain` path at seq `0..n-1`, leaving `nextSeq` at `n`. Identical
   code to a live match, so there is no second fold to keep in step.
4. The transport opens at seq `n` and new commits continue from there.

## Sequencer seeding

Step 4 above is a small change on each side. These are the "two
implementations of one sequencer" `CLAUDE.md` warns about, so they move
together and are tested together.

- **`packages/net/src/local.ts`** — `host()` currently resets `seq = 0`; it
  takes a starting seq instead.
- **`crates/lan-sync/src/host.rs`** — seed `log` and set
  `next_seq = log.len()`. The `welcome` catch-up path (`host.rs:300`) then
  serves it to joiners unchanged.
- **`apps/relay/lan-relay.mjs`** — `new Sequencer({ room, capacity, log })`.
  Seq already derives from `#log.length` (`:112`), so it resumes for free.

## Files

- `packages/app-shell/src/session/` — save format, shelf, autosave wiring,
  profile roster, transfer encode/decode. The only non-deterministic corner
  this design adds.
- `packages/net/src/identity.ts` — one identity becomes a profile roster,
  migrating the existing id.
- `packages/app-shell/src/store/atoms.ts` — `seatsAtom`, `actingSeatAtom`;
  `meAtom` retired.
- `packages/app-shell/src/store/match-client.ts` — `restore(log)`, and the
  autosave call in `drain()`.
- `packages/net/src/local.ts` — a starting seq.
- `packages/app-shell/src/routes/home.tsx` — the Continue section.
- `packages/app-shell/src/routes/lobby.tsx` — profile picker, one `Join` per
  local profile.
- `packages/app-shell/src/routes/match.tsx` — the Leave control, acting-seat
  wiring.
- `packages/ui/src/HUD.tsx` — owned versus acting seats.
- `crates/lan-sync/src/host.rs`, `apps/relay/lan-relay.mjs` — sequencer
  seeding.

## Testing

The headline claim is *restore is byte-identical*, and the cheapest strong
proof already exists in the repository.

- **Extend the determinism fuzz driver.** After each random match it already
  plays, save → restore → assert the restored `MatchState` deep-equals the live
  one, for every combination of rule modules. Same machinery, same move the RPG
  spec makes.
- **Refused actions replay identically.** Build a log containing a deliberately
  rejected action (two `Commit`s from one seat) and assert the replay matches.
- **Absent-player `Leave`.** A round with a non-reconnecting player reaches
  resolution instead of hanging. This is the regression test for the defect
  above.
- `packages/app-shell/src/session/__tests__/` — shelf cap and eviction, unknown
  `version` rejected, a throwing `localStorage` degrading to a single notice,
  profile migration preserving the existing `playerId`.
- **Transfer** — encode/decode round trip, bad version refused, same-id import
  offering replace.
- **Multi-seat** — `actingSeatAtom` with `simultaneous` on and off.
- **Rust and Node parity** — a seeded sequencer's first assigned seq equals the
  seeded log length, asserted on both sides and pinned to literals the way the
  room-code encoding already is.
- `nub run verify:ui` after the UI work, per the standing rule in `CLAUDE.md`.

## Build order

1. **Extend the fuzz driver with the save/restore assertion first**, before a
   save format exists to be smug about. It is what makes the rest cheap to
   trust.
2. Save format, shelf, and autosave in `drain()` — pass-and-play only.
3. The Leave control and match exit.
4. Profiles and the `me` → `seats` change; one `Join` per local profile. This
   is where pass-and-play becomes genuinely multi-player.
5. The absent-player `Leave`, with its regression test.
6. Sequencer seeding on all three transports, and host resume.
7. Transfer: encode/decode, then the code/QR carrier.

Steps 2 through 4 deliver the whole pass-and-play story and depend on nothing
that needs hardware. Steps 5 and 6 are the networked half.

## ADRs

One new ADR before implementation: **a match is a replayable log, and the save
file is that log.** The save format, the refused-actions rule and host resume
all hang off that single decision, and its cost is worth recording — a save is
only as portable as the reducer that folds it, so a rule change that alters
resolution invalidates every stored log.

The trust posture on profiles and graduation is **ADR 0009 extended by
reference** rather than a near-duplicate ADR: declared values, unverified,
because the players are in the same room.
