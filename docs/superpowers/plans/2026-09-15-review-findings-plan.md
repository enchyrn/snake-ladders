# PR #2 Review Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the ten defects the whole-project review of PR #2 found and confirmed against the source, without widening any of them into a redesign.

**Architecture:** Three independent groups, in ascending order of blast radius. The engine group (Tasks 1–3) is pure and testable in isolation. The identity group (Tasks 4–7) fixes the same bug shape in four places: *a late event addressed to a name that has since been reused*. The protocol group (Tasks 8–10) adds the two frames the app has been missing and the one the CLI never awaited.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Effect, Vitest, Rust (`lan-sync`, no Tauri deps), Node (`apps/relay`), Nx, nub.

**Spec:** No separate spec. Each task below states the defect, quotes the confirming read, and states the fix. The findings came from `superpowers:requesting-code-review` run against `main...HEAD` on 2026-09-15 and every one was re-read against the source before this plan was written.

## STATUS — read this before doing anything

**Tasks 1-7 are DONE, committed and pushed.** Their steps are ticked and each
carries a `DONE — commit <sha>` note recording what the plan did not anticipate.
Do not redo them. Verify with `git log --oneline origin/main..HEAD`.

**Tasks 8-11 and Finishing remain.** Start at Task 8.

**One caveat that is not visible from the checkboxes:** Task 7 (`4dbf1ff`) was
pushed WITHOUT an independent task review — the model session limit hit mid-plan.
It is the only commit from this plan in that state. Review it before merging.

**Three deferred minors** are recorded in the notes under Tasks 3, 6 and 7.

This status block exists because the SDD ledger at `.superpowers/sdd/` is
gitignored and does not travel with the branch. The plan file and
`docs/handoff.md` are the only progress records another machine or another
agent will see.

---

## Global Constraints

- **The determinism contract governs every engine change.** `packages/engine/src/**` stays pure: no `Math.random`, no `Date.now`, no iteration over unordered collections, no floating point where an integer will do. Run `packages/engine/src/__tests__/determinism.test.ts` after any engine change.
- **Anything that enters the action log must be sequenced, never applied locally.** A fix that makes one device act on information another device lacks is a worse bug than the one it replaces.
- **Do not `cargo build` or `cargo check` `src-tauri/`.** This container has no webkit2gtk. `src-tauri/src/lib.rs` is verified by review and by `.github/workflows/android.yml` only. `crates/lan-sync` has no Tauri dependency and *is* buildable here.
- **nub, not npm.** `nubx` replaces `npx`. Every `nub`/`nubx`/`cargo` invocation needs `export PATH="$HOME/.local/share/mise/shims:$PATH"` in the same shell.
- **Branch:** `claude/snake-ladders-cross-device-3uu177`, with PR #2 open against `main`. Commit per task. Do not open a second PR.
- **Commit trailers**, on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
  ```
  No model identifier appears anywhere else — not in code, comments, docs or the PR body.
- **Comments explain why, never what.** Match the density of the surrounding file.

## File Structure

| File | Task | Responsibility after the change |
|---|---|---|
| `packages/engine/src/resolve.ts` | 1 | a blast's momentum reset survives to the end of the move |
| `packages/engine/src/rules/mutation.ts` | 2 | `breathe` cannot seat a link's mouth on another link's endpoint |
| `packages/engine/src/match.ts` | 3 | `playCard` extends the round's own timeline, not the previous round's |
| `packages/app-shell/src/app/hooks.ts` | 4 | `seedFromRoom` rejects anything that is not exactly four valid characters |
| `crates/lan-sync/src/host.rs` | 5 | a connection only mutates the client entry it still owns |
| `apps/relay/lan-relay.mjs` | 6 | same ownership rule as the Rust host |
| `packages/app-shell/src/store/match-client.ts` | 7 | the host turns a roster disconnect into a sequenced `Leave` |
| `packages/net/src/websocket.ts`, `apps/relay/lan-relay.mjs` | 8 | `lock` has an upstream frame instead of a stub |
| `packages/app-shell/src/routes/lobby.tsx` | 9 | starting a match actually locks the room |
| `apps/relay/lan-relay.mjs` (CLI) | 10 | a failed bind is reported, not announced as success |
| `src-tauri/src/lib.rs` | 11 | one pump flag per pump, so a replaced pump cannot revive |

---

## Task 1: A mine blast's momentum reset is overwritten

**Files:**
- Modify: `packages/engine/src/resolve.ts:89`, `packages/engine/src/resolve.ts:216-221`
- Test: `packages/engine/src/__tests__/rules.test.ts`

**Interfaces:**
- Consumes: `Momentum.decay(carried: number, gained: number): number` from `packages/engine/src/rules/momentum.ts` — unchanged by this task.
- Produces: nothing other tasks depend on.

**The defect.** `applyTile` ends a blast with `ctx.players[idx] = { ...player, position: to, stunned: Mines.blastStun, momentum: 0 }`. The tail of `moveOne` then unconditionally recomputes:

```ts
  ctx.players[idx] = {
    ...after,
    momentum: Momentum.enabled(config) ? Momentum.decay(carried, gained) : 0,
  }
```

`carried` was captured *before* the move. `decay(carried, 0)` is `Math.floor(carried / 2)`, not `0`. So the blast's `momentum: 0` is dead: a player thrown off a mine keeps half the speed they arrived with.

The neighbouring case is already handled deliberately — a mine at the far end of a link sets `gained = 0`, which the comment describes as cancelling *the gain*. That is the intended behaviour and must not change. Only the direct blast is wrong.

- [x] **Step 1: Write the failing test**

Add to `packages/engine/src/__tests__/rules.test.ts`:

```ts
it("a blast strips the momentum the player arrived with, not just the gain", () => {
  // momentum + mines together: the blast is the only thing that should be
  // able to zero speed outright, and it was being overwritten by the decay
  // the tail of moveOne applies to every move.
  const config = makeConfig({ modules: ["momentum", "mines"] })
  const state = withPlayers(config, [{ id: "a", position: 10, momentum: 6 }])
  const mined = plantMine(state, 14)

  const after = resolveWithRoll(mined, "a", 4)

  const a = after.players.find((p) => p.id === "a")!
  expect(a.stunned).toBe(Mines.blastStun)
  expect(a.momentum).toBe(0)
})
```

If `makeConfig`, `withPlayers`, `plantMine` or `resolveWithRoll` do not already exist in that file under those names, use whatever the file's existing tests use to build a state and resolve one round — read the top of the file first and follow it rather than inventing helpers.

- [x] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run -t "a blast strips the momentum"
```

Expected: FAIL, `expected 3 to be 0` (half of 6). If it passes, the test is not reaching the blast — fix the test before touching `resolve.ts`.

- [x] **Step 3: Make the blast authoritative**

In `moveOne`, capture whether the blast happened and honour it in the tail. `blasted` is already computed a few lines above:

```ts
  const after = ctx.players[idx]!
  ctx.players[idx] = {
    ...after,
    // Speed just spent bleeds off by half; a fresh link overrides it outright.
    // A blast is the exception: it throws the token off the board's line
    // entirely, so there is no speed left to carry.
    momentum: Momentum.enabled(config) && !blasted ? Momentum.decay(carried, gained) : 0,
  }
```

Leave `applyTile`'s `momentum: 0` in place — it is now load-bearing for the intermediate state the collision pass reads.

- [x] **Step 4: Run the test, then the whole engine**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run -t "a blast strips the momentum"
nubx vitest run packages/engine
```

Expected: the new test passes and every existing engine test still passes. A failure in `determinism.test.ts` means the change was not pure — stop and re-read it rather than adjusting the test.

- [x] **Step 5: Commit**

```bash
git add packages/engine/src/resolve.ts packages/engine/src/__tests__/rules.test.ts
git commit -F - <<'MSG'
fix: let a mine blast actually clear the momentum it throws away

applyTile set momentum to 0 on a blast and the tail of moveOne overwrote it
with decay(carried, 0) — half the speed the player arrived with. The blast's
write had been dead since momentum was added.

The mine-at-the-end-of-a-link case is untouched: that one cancels the *gain*,
which is what its comment says and what the tests pin.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**DONE — commit `5f8f949`.** Test scenario re-derived: the brief's numbers did not reach the defect through the real dispatch path. Needed a second, otherwise-unused player, because with one player a lone stunned active seat empties `pendingCommitters`, so `settle()` resolves a second round and ticks the stun back to 0 inside one `run()`.

---
## Task 2: `breathe` can seat a link's mouth on another link's endpoint

**Files:**
- Modify: `packages/engine/src/rules/mutation.ts:60-85`
- Test: `packages/engine/src/__tests__/mutation.test.ts` (or wherever `breathe` is currently tested — check first)

**Interfaces:**
- Consumes: `nextInt(rng: RngState, bound: number): readonly [number, RngState]`.
- Produces: `breathe` keeps its exact signature `(board, config, occupied, rng) => readonly [Board, string[], RngState]`.

**The defect.** The doc comment claims "Occupied tiles and existing endpoints are avoided so the no-chaining invariant that keeps resolution loop-free still holds afterwards." It does not hold. `free` is built once, excluding the endpoints that existed *then*. On a successful relocation the code does:

```ts
    endpoints.add(anchor)
    endpoints.add(partner)
    free.splice(slot, 1)
```

`anchor` leaves `free`; **`partner` does not**. And the anchor drawn on the next iteration is never checked against `endpoints` — only `partner` is. So the second relocation can draw the first relocation's `partner` as its own `anchor`, putting a link's mouth exactly on another link's landing tile. That is the chain the invariant exists to prevent.

- [x] **Step 1: Write the failing test**

```ts
it("never seats a relocated link's mouth on another link's endpoint", () => {
  // free excluded the endpoints that existed when it was built, but a
  // relocation adds two more and only removed one of them from free, so the
  // next draw could land on the partner tile of the previous relocation.
  const config = makeConfig({ modules: ["mutation"] })

  // Sweep seeds rather than guessing one: the collision needs two successful
  // relocations in the same call, which only some streams produce.
  for (let seed = 0; seed < 400; seed++) {
    const board = makeBoard(config, seed)
    const [next] = breathe(board, config, new Set<number>(), rngFrom(seed))

    const mouths = next.links.map((l) => l.from)
    const landings = next.links.map((l) => l.to)
    const all = [...mouths, ...landings]
    expect(new Set(all).size, `seed ${seed} produced a chained board`).toBe(all.length)
  }
})
```

Read the existing mutation tests first and reuse their board/rng constructors; the names above are indicative, the assertion is the point.

- [x] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run -t "never seats a relocated link's mouth"
```

Expected: FAIL naming a specific seed. Record that seed in the commit message — it is the proof the test reproduces.

- [x] **Step 3: Close both halves of the hole**

```ts
    const anchor = free[slot]!
    const span = Math.abs(link.to - link.from)
    const partner = link.kind === "ladder" ? anchor + span : anchor - span
    if (partner <= 1 || partner >= top || endpoints.has(partner) || occupied.has(partner)) continue
    // A previous relocation in this same call added its endpoints to
    // `endpoints` but only took its anchor out of `free`, so both of its
    // tiles could still be drawn here.
    if (endpoints.has(anchor)) continue

    endpoints.delete(link.from)
    endpoints.delete(link.to)
    endpoints.add(anchor)
    endpoints.add(partner)
    // Drop the higher index first so the lower one does not shift.
    const partnerSlot = free.indexOf(partner)
    for (const s of [slot, partnerSlot].filter((s) => s >= 0).sort((a, b) => b - a)) {
      free.splice(s, 1)
    }
```

`sort` on numbers with an explicit comparator is deterministic and stays inside the purity rule.

- [x] **Step 4: Run the test, then the whole engine**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run -t "never seats a relocated link's mouth"
nubx vitest run packages/engine
```

Expected: both green. `determinism.test.ts` must stay green — it plays every module combination.

- [x] **Step 5: Commit**

```bash
git add packages/engine/src/rules/mutation.ts packages/engine/src/__tests__/mutation.test.ts
git commit -F - <<'MSG'
fix: keep the board breathing without chaining two links together

free was built from the endpoints that existed when the call started. A
relocation added two new ones and removed only the anchor from free, so the
next draw could take the previous partner as its mouth — exactly the chain the
doc comment promises cannot happen.

Both tiles now leave free, and the anchor is checked against endpoints the way
the partner already was. Found by sweeping seeds; seed <N> reproduced it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

Replace `<N>` with the seed Step 2 actually printed. Do not commit the placeholder.

**DONE — commit `72b6ac0`.** Seed 17 reproduces the chaining. Reviewer confirmed independently in a disposable worktree: `S1: 17->5`, `L2: 5->15`.

---
## Task 3: `playCard` appends to the previous round's timeline

**Files:**
- Modify: `packages/engine/src/match.ts:109-112`
- Test: `packages/engine/src/__tests__/match.test.ts`

**Interfaces:**
- Consumes: `MatchState.timeline: ReadonlyArray<TimelineEvent>`.
- Produces: no signature change. `playCard` still returns `Effect.Effect<MatchState, RuleError>`.

**The defect.**

```ts
  const timeline = [
    ...state.timeline,
    { _tag: "CardPlayed" as const, playerId: player.id, card, cost },
  ]
```

`state.timeline` at that moment is the *previous* round's choreography — `resolveRound` writes it and nothing clears it before the next round's cards are played. `packages/ui/src/BoardCanvas.tsx:81` replays on array identity:

```tsx
    if (state.timeline.length > 0 && playedRef.current !== state.timeline) {
      playedRef.current = state.timeline
      scene.play(state.timeline, () => {
```

So tapping a card in round N re-animates the whole of round N−1. The card events are then thrown away by `resolveRound`, which builds its timeline fresh.

This is a renderer-visible bug only — it cannot change a result, because the renderer never feeds the engine. That is why it survived.

- [x] **Step 1: Write the failing test**

```ts
it("a card played in a new round does not carry the last round's timeline", () => {
  const config = makeConfig({ modules: ["mutation"] })
  const played = Effect.runSync(resolveARoundThenPlayACard(config))

  // The previous round's events must not reappear: BoardCanvas replays on
  // array identity, so carrying them forward re-animates a round that has
  // already been shown.
  expect(played.timeline.every((e) => e._tag === "CardPlayed")).toBe(true)
})
```

Build `resolveARoundThenPlayACard` from the helpers already in `match.test.ts`: resolve one round so `state.timeline` is non-empty, then `playCard` a card the player can afford.

- [x] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run -t "does not carry the last round's timeline"
```

Expected: FAIL — the timeline still holds `Moved`, `MineTripped` and friends from the resolved round.

- [x] **Step 3: Record which round the timeline describes**

The timeline needs to say which round it belongs to; nothing currently does, which is why `playCard` cannot tell. Add one field beside it.

In `packages/engine/src/types.ts`, on `MatchState`:

```ts
  /** The round `timeline` describes. A card played in a later round starts a
   *  new one rather than extending the round already shown. */
  readonly timelineRound: number
```

Set it in `resolveRound`'s tail wherever `timeline` is written — the round being resolved — and in the initial state (`0`). Then in `playCard`:

```ts
  const fresh = state.timelineRound !== state.round
  const timeline = fresh
    ? [{ _tag: "CardPlayed" as const, playerId: player.id, card, cost }]
    : [...state.timeline, { _tag: "CardPlayed" as const, playerId: player.id, card, cost }]
```

and include `timelineRound: state.round` in the state `playCard` returns.

`timelineRound` is a plain integer folded from the log like everything else, so it stays inside the determinism contract. If `MatchState` has an Effect schema in `primitives.ts` or `types.ts`, add the field there too or decoding will drop it.

- [x] **Step 4: Run the test, then the whole engine**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/engine
```

- [x] **Step 5: Commit**

```bash
git add packages/engine/src/match.ts packages/engine/src/__tests__/match.test.ts
git commit -F - <<'MSG'
fix: start a round's timeline fresh when a card opens it

playCard spread the previous round's timeline into the new one. BoardCanvas
replays on array identity, so tapping a card re-animated the round that had
just finished; resolveRound then discarded the card events anyway.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**DONE — commit `d01b730`.** Plan named `match.test.ts`, which does not exist — test went in `rules.test.ts`. Scope was wider than the plan's file list: also `types.ts` (the new field) and `resolve.ts`. The Effect schema in `types.ts` needed the field too, or it would be dropped on decode. DEFERRED MINOR: no test covers two *different* cards in one round both surviving; logic verified correct by inspection.

---
## Task 4: `seedFromRoom` accepts a code that is not a room code

**Files:**
- Modify: `packages/app-shell/src/app/hooks.ts:34-45`
- Test: `packages/app-shell/src/app/__tests__/hooks.test.ts`

**Interfaces:**
- Produces: `seedFromRoom(code: string): number | null` — signature unchanged, `null` simply reachable for more inputs.

**The defect.**

```ts
export const seedFromRoom = (code: string): number | null => {
  let seed = 0
  const upper = code.toUpperCase()
  for (let i = 0; i < Math.min(4, upper.length); i++) {
```

`Math.min(4, upper.length)` means a three-character code decodes to a perfectly valid seed built from three digits, and a five-character code silently ignores the fifth. The room code **is** the match seed, so a peer who mistypes one character short builds a different board from everyone else — and every frame still decodes, so nothing raises `desync`. The player sees a working game that disagrees with the room.

This is the highest-severity finding in the set for exactly that reason: it is silent, and it is reachable from a text input a human types into.

- [x] **Step 1: Write the failing tests**

```ts
describe("seedFromRoom", () => {
  it("round-trips every code roomCode can produce", () => {
    for (const seed of [0, 1, 30, 31, 12345, 31 ** 4 - 1]) {
      expect(seedFromRoom(roomCode(seed))).toBe(seed)
    }
  })

  it("refuses anything that is not exactly four valid characters", () => {
    // The room code IS the seed. A short code that decodes anyway builds a
    // different board with no desync banner, because every frame still parses.
    expect(seedFromRoom("ABC")).toBeNull()
    expect(seedFromRoom("ABCDE")).toBeNull()
    expect(seedFromRoom("")).toBeNull()
    expect(seedFromRoom("AB1D")).toBeNull() // 1 is not in the alphabet
    expect(seedFromRoom("AB D")).toBeNull()
  })

  it("still accepts the lower-case spelling a person types", () => {
    expect(seedFromRoom(roomCode(4242).toLowerCase())).toBe(4242)
  })
})
```

- [x] **Step 2: Run them and watch the middle one fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run -t "refuses anything that is not exactly four"
```

Expected: FAIL on `seedFromRoom("ABC")`, which currently returns a number.

- [x] **Step 3: Require the full width**

```ts
export const seedFromRoom = (code: string): number | null => {
  const upper = code.toUpperCase()
  // The code is the seed, so a short one is not a partial match — it is a
  // different board, built silently and with every frame still decoding.
  if (upper.length !== 4) return null
  let seed = 0
  for (let i = 0; i < 4; i++) {
    const digit = ALPHABET.indexOf(upper[i]!)
    if (digit < 0) return null
    seed += digit * Math.pow(ALPHABET.length, i)
  }
  return seed
}
```

- [x] **Step 4: Check every caller handles `null`**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
grep -rn "seedFromRoom" packages apps --include=*.ts --include=*.tsx
nubx vitest run packages/app-shell
nub run typecheck
```

Every call site must already branch on `null` — the return type has always admitted it, so `tsc` would have caught a caller that did not. Read each one anyway and confirm the message a player sees is intelligible ("that is not a room code", not a stack trace). Fix any that merely swallow it.

- [x] **Step 5: Commit**

```bash
git add packages/app-shell/src/app/hooks.ts packages/app-shell/src/app/__tests__/hooks.test.ts
git commit -F - <<'MSG'
fix: refuse a room code that is not four characters

seedFromRoom decoded whatever it was given, up to four characters. The room
code is the match seed, so a three-character code produced a valid-but-wrong
seed and the peer built a different board — silently, because every frame it
then received still decoded and nothing ever raised desync.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**DONE — commit `97d5a3a`.** Scope extended before dispatch: `crates/lan-sync/src/lib.rs`'s `seed_from_room` had the identical `.take(4)` defect and is fixed in the same commit — fixing one side alone would have made the browser and the native app disagree. A third site was found by the implementer: `src-tauri`'s `net_rooms()` called `seed_from_room(...).unwrap_or(0)`, fixed with `.filter_map()`. CONFIRMED: `apps/relay/lan-relay.mjs` has NO decoder — CLAUDE.md's "three places" are three *encoders*, only two ever decoded.

---
## Task 5: a dead connection disables the one that replaced it (Rust)

**Files:**
- Modify: `crates/lan-sync/src/host.rs:47-51` (the `Client` struct), `:302-345` (registration), `:386-395` (the exit path)
- Test: `crates/lan-sync/tests/session.rs`

**Interfaces:**
- Produces: `Client` gains a private `epoch: u64` field. Nothing outside `host.rs` reads it.

**The defect.** `player_id` comes from the client's own `Hello` frame and is deliberately reused across a reconnect — `let returning = state.clients.contains_key(&player_id);` exists precisely so a dropped player can take their seat back. Registration overwrites the map entry:

```rust
        state.clients.insert(
            player_id.clone(),
            Client { name: name.clone(), stream: stream_for_state, connected: true },
        );
```

But when the *old* connection's thread finally notices its socket is dead, it runs:

```rust
    if let Ok(mut state) = shared.state.lock() {
        if let Some(client) = state.clients.get_mut(&player_id) {
            client.connected = false;
        }
```

which reaches straight into the entry the reconnect just installed. `broadcast` skips `!connected` clients, so from then on the reconnected player's own rolls are sequenced and fanned out to everyone *except* them. They sit watching a frozen board while the match continues.

The fix is the one this codebase already reached for in `PendingClient`: give the registration an epoch and let the exit path only act on the entry it still owns.

- [x] **Step 1: Write the failing test**

Add to `crates/lan-sync/tests/session.rs`:

```rust
#[test]
fn a_reconnect_survives_the_old_connection_noticing_it_died() {
    let host = Host::bind(0, "ROOM".into(), 6).expect("bind");
    let addr = host.addr();

    let first = connect_and_hello(addr, "p1", "Ada");
    // Hold the socket open but stop reading, then reconnect under the same
    // player_id — the seat is meant to be reclaimable.
    let second = connect_and_hello(addr, "p1", "Ada");

    // Now let the first connection die. Its thread wakes, finds the socket
    // gone, and must not touch the entry `second` installed.
    drop(first);

    wait_for(|| host.connected_count() == 1, "the reconnect stays connected");

    // The decisive assertion: a commit still reaches the live socket.
    submit(&second, json!({ "_tag": "Roll", "playerId": "p1" }));
    let frame = read_frame(&second).expect("the reconnected client is still broadcast to");
    assert!(frame.contains("commit"));
}
```

Reuse the `wait_for` helper already in this file. Add `#[doc(hidden)] pub fn connected_count(&self) -> usize` to `Host` alongside the existing `pending_count`, counting `clients.values().filter(|c| c.connected)`.

- [x] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync --test session a_reconnect_survives
```

Expected: FAIL — either `connected_count()` is 0, or the read times out because `broadcast` skipped the live socket. If it passes first time the test is not actually racing; make the first connection's death land *after* the second registers.

- [x] **Step 3: Give each registration an epoch**

```rust
struct Client {
    name: String,
    stream: TcpStream,
    connected: bool,
    /// Bumped on every registration under this id. A connection that ends
    /// only owns the entry it installed; a reconnect has since replaced it.
    epoch: u64,
}
```

Carry a `next_epoch: u64` on `HostState` beside `next_pending_id`. At registration:

```rust
        let epoch = state.next_epoch;
        state.next_epoch += 1;
        state.clients.insert(
            player_id.clone(),
            Client { name: name.clone(), stream: stream_for_state, connected: true, epoch },
        );
```

Keep `epoch` in a local so the frame loop can close over it, and gate the exit path:

```rust
    if let Ok(mut state) = shared.state.lock() {
        if let Some(client) = state.clients.get_mut(&player_id) {
            // A reconnect under the same id has already replaced this entry;
            // marking it disconnected would cut the live socket out of every
            // broadcast while its owner is still playing.
            if client.epoch == epoch {
                client.connected = false;
            }
        }
        let roster = Downstream::Roster { peers: roster_of(&state) };
        broadcast(&mut state, &roster);
    }
```

The `state.clients.remove(&player_id)` on the failed-welcome path (`:349`) needs the same guard, for the same reason.

- [x] **Step 4: Run the whole crate**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all
```

Expected: 23 passing (22 existing plus the new one), clippy clean.

- [x] **Step 5: Commit**

```bash
git add crates/lan-sync/src/host.rs crates/lan-sync/tests/session.rs
git commit -F - <<'MSG'
fix: let a dead connection disable only the entry it still owns

player_id is supplied by the client and reused on purpose, so a reconnect
takes the same map key. The old connection's thread then set connected=false
on the entry the reconnect had installed, and broadcast skips a disconnected
client — the returning player's own rolls went to everyone but them.

Each registration now carries an epoch and the exit path compares it first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**DONE — commit `61fe618`.** WARNING FOR ANY SIMILAR TEST: the first draft — a `wait_for(|| connected_count() == 1)` poll, close to what this plan sketched — PASSED with the epoch guards stripped out, because the poll ran ahead of the dying thread's mutation. Replaced with a blocking read on the roster frame the exit path itself broadcasts, under the same lock as the mutation. Reviewer re-verified by stripping the guards in a worktree: 10/10 failures.

---
## Task 6: the same defect in the Node relay

**Files:**
- Modify: `apps/relay/lan-relay.mjs:95-125`
- Modify: `apps/relay/lan-relay.d.ts` only if a public signature changes (it should not)
- Test: `packages/net/src/__tests__/relay.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Sequencer.leave(playerId: string, token?: symbol): void` — the token is optional so existing callers keep working; `join` hands the token back to its own caller.

**The defect.** Identical in shape to Task 5, in the other implementation of the same sequencer:

```js
  leave(playerId) {
    const client = this.#clients.get(playerId)
    if (!client) return
    client.connected = false
```

and the socket handlers that call it:

```js
    socket.on("close", () => { if (playerId !== null) sequencer.leave(playerId) })
    socket.on("error", () => { if (playerId !== null) sequencer.leave(playerId) })
```

A reconnect calls `this.#clients.set(playerId, …)` with a fresh entry. When the old socket's `close` fires afterwards — and it does, that is what a dropped connection means — it disables the live client. Both implementations must behave the same or a peer can tell which one it joined, which the architecture explicitly forbids.

- [x] **Step 1: Write the failing test**

```ts
it("a reconnect is not disconnected by the old socket's close", () => {
  const seq = new Sequencer("ROOM", 6)
  const firstFrames: unknown[] = []
  const secondFrames: unknown[] = []

  const first = seq.join({ playerId: "p1", name: "Ada", send: (f) => firstFrames.push(f) })
  expect(first.ok).toBe(true)

  const second = seq.join({ playerId: "p1", name: "Ada", send: (f) => secondFrames.push(f) })
  expect(second.ok).toBe(true)

  // The old socket's close arrives after the reconnect has taken the seat.
  seq.leave("p1", first.token)

  secondFrames.length = 0
  seq.submit({ _tag: "Roll", playerId: "p1" })
  expect(secondFrames.some((f) => f.t === "commit")).toBe(true)
})
```

Match the real `join` signature — read it before writing the test rather than trusting this sketch.

- [x] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run -t "not disconnected by the old socket's close"
```

Expected: FAIL — `secondFrames` holds no `commit`, because `leave` disabled the live entry.

- [x] **Step 3: Hand out a token and check it**

```js
  join({ playerId, name, send }) {
    // …existing capacity and lock checks…
    const token = Symbol(playerId)
    this.#clients.set(playerId, { name, send, connected: true, token })
```

Return it with the success result (`return { ok: true, token }`) and on the welcome-failed path keep returning `{ ok: false, reason }` unchanged.

```js
  leave(playerId, token) {
    const client = this.#clients.get(playerId)
    if (!client) return
    // A reconnect has taken this seat; the socket closing now is the old one,
    // and disabling the live client would cut it out of every broadcast.
    if (token !== undefined && client.token !== token) return
    client.connected = false
    this.#broadcast({ t: "roster", peers: this.roster() })
  }
```

Then carry the token through the socket handlers:

```js
    let token = null
    // …on a successful join: token = result.token…
    socket.on("close", () => { if (playerId !== null) sequencer.leave(playerId, token ?? undefined) })
    socket.on("error", () => { if (playerId !== null) sequencer.leave(playerId, token ?? undefined) })
```

- [x] **Step 4: Update the declaration and run the suites**

`apps/relay/lan-relay.d.ts` declares `Sequencer`. Add `token` to the success shape of `JoinResult` and the optional parameter to `leave`, then:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run typecheck
nubx vitest run packages/net
```

`lan-relay.d.ts` is hand-written and only the root `nub run typecheck` checks it — `nub run lint` and the per-project targets will not catch a mismatch here.

- [x] **Step 5: Commit**

```bash
git add apps/relay/lan-relay.mjs apps/relay/lan-relay.d.ts packages/net/src/__tests__/relay.test.ts
git commit -F - <<'MSG'
fix: let a relay reconnect survive the old socket closing

The Node sequencer had the same defect as the Rust host: leave() looked the
player up by id and disabled whatever was there, so a dropped socket's close
event cut out the reconnect that had already taken the seat.

join now hands back a token and leave ignores a call that does not carry the
current one. Both implementations behave the same again, which is the point of
having two.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**DONE — commit `f559ae7`.** Used a `Symbol` token rather than an integer epoch: one Sequencer per room, no shared counter to thread. Test made fully synchronous (no sockets, timers or polling), which sidesteps the Task 5 trap entirely. DEFERRED MINOR: this plan specified `leave(playerId, token?)` as optional 'so existing callers keep working' — there are no other callers, so the optional form is dead code and a latent hole. Making it required is a two-line change.

---
## Task 7: a dropped player freezes the round forever

**Files:**
- Modify: `packages/app-shell/src/store/match-client.ts:51-55`
- Test: `packages/app-shell/src/store/__tests__/match-client.test.ts`

**Interfaces:**
- Consumes: `RosterEntry` from `packages/net/src/transport.ts`, `ClientState.role`, `TransportService.submit`.
- Produces: no new exports.

**The defect.** `Leave` exists as a schema member (`packages/engine/src/actions.ts:15`) and the reducer handles it (`packages/engine/src/match.ts:192`). **Nothing constructs one.** `grep -rn '_tag: *"Leave"'` across `packages` and `apps` returns only the schema and the reducer.

The roster is stored and never acted on:

```ts
      transport.onRoster((roster) => this.patch((s) => ({ ...s, roster }))),
```

With the `simultaneous` module — the default — resolution waits for every seated player to commit. A player whose phone dies is still seated, so `pendingCommitters` never empties and **the round never resolves for anybody**. The match is over for the whole room, with no error and no message.

**The design constraint that decides the fix:** `Leave` changes match state, so it must go through the log like every other action. If each device submitted its own `Leave` on seeing a disconnect, the log would carry N copies; the reducer rejects all but the first with "unknown player", which is a notice rather than a desync, so it would *work* — but it is noise, and it makes the log depend on how many devices happened to be watching. **Only the host submits.** The host is the device that sequences, it already knows the roster, and one `Leave` enters the log exactly once.

- [x] **Step 1: Write the failing test**

```ts
it("the host turns a roster disconnect into a sequenced Leave", () => {
  const transport = fakeTransport()
  const client = new MatchClient(transport, configWith(["simultaneous"]), "host", "me")
  seatPlayers(client, ["me", "them"])

  transport.emitRoster([
    { playerId: "me", name: "Me", connected: true },
    { playerId: "them", name: "Them", connected: false },
  ])

  expect(transport.submitted).toContainEqual({ _tag: "Leave", playerId: "them" })
})

it("a peer does not submit Leave — only the host does", () => {
  const transport = fakeTransport()
  const client = new MatchClient(transport, configWith(["simultaneous"]), "peer", "me")
  seatPlayers(client, ["me", "them"])

  transport.emitRoster([
    { playerId: "me", name: "Me", connected: true },
    { playerId: "them", name: "Them", connected: false },
  ])

  expect(transport.submitted).toEqual([])
})

it("does not submit Leave twice for the same disconnect", () => {
  const transport = fakeTransport()
  const client = new MatchClient(transport, configWith(["simultaneous"]), "host", "me")
  seatPlayers(client, ["me", "them"])

  const roster = [
    { playerId: "me", name: "Me", connected: true },
    { playerId: "them", name: "Them", connected: false },
  ]
  transport.emitRoster(roster)
  transport.emitRoster(roster)

  expect(transport.submitted.filter((a) => a._tag === "Leave")).toHaveLength(1)
})
```

Follow the existing fake transport in that test file; do not build a second one.

- [x] **Step 2: Run them and watch them fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell/src/store
```

Expected: the first and third fail (nothing is submitted); the second passes vacuously, which is fine — it is there to pin the rule once the others are green.

- [x] **Step 3: Submit one Leave per departure, from the host only**

```ts
      transport.onRoster((roster) => {
        this.patch((s) => ({ ...s, roster }))
        this.retireDeparted(roster)
      }),
```

```ts
  /**
   * A seated player who never commits stalls the whole round under the
   * `simultaneous` module, so a disconnect has to reach the reducer. It goes
   * through the log like any other action — a locally applied Leave would
   * diverge every device that had not seen the same roster frame.
   *
   * The host submits it alone: it is the device that sequences, and one
   * departure should appear in the log once however many peers are watching.
   */
  private retireDeparted(roster: ReadonlyArray<RosterEntry>): void {
    if (this.state.role !== "host") return
    for (const entry of roster) {
      if (entry.connected) continue
      const seated = this.state.match.players.some((p) => p.id === entry.playerId)
      if (!seated) continue
      this.send({ _tag: "Leave", playerId: entry.playerId })
    }
  }
```

`this.send` already checks the action against the local match first, so a `Leave` for a player the reducer has forgotten becomes a local notice and never reaches the wire — which is what makes the third test pass without a separate "already retired" set.

- [x] **Step 4: Run the suites**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell
nub run typecheck
```

If `send`'s notice-on-rejection makes the third test noisy (a visible "unknown player" banner every roster frame), suppress it for this path rather than weakening `send`: call `transport.submit` directly here and keep the pre-check.

- [x] **Step 5: Commit**

```bash
git add packages/app-shell/src/store/match-client.ts packages/app-shell/src/store/__tests__/match-client.test.ts
git commit -F - <<'MSG'
fix: retire a player who drops, instead of waiting for them forever

Leave was in the action schema and handled by the reducer, and nothing in the
app had ever constructed one. Under the simultaneous module a seated player
who never commits holds pendingCommitters non-empty, so one dead phone froze
the round for the whole room with no message anywhere.

The host submits it, once, through the log — a locally applied Leave would
diverge any device that had not seen the same roster frame.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**DONE — commit `4dbf1ff`.** **NOT INDEPENDENTLY REVIEWED** — the model session limit hit mid-plan and the retry ran on a smaller model. Controller-verified only: host-only guard, goes through the log, correct `RosterEntry.player_id` (snake_case), app-shell 29/29, typecheck and lint clean. NEEDS A TASK REVIEW. DEFERRED MINOR: `retired` clears only on `reset()`, so a player who drops, rejoins the same match and drops again is never retired the second time.

---
## Task 8: `lock` has no wire frame, so a browser room never locks

**Files:**
- Modify: `apps/relay/lan-relay.mjs:155-185` (upstream frame handling), `apps/relay/lan-relay.d.ts`
- Modify: `packages/net/src/websocket.ts:225`
- Test: `packages/net/src/__tests__/relay.test.ts`, `packages/net/src/__tests__/websocket.test.ts`

**Interfaces:**
- Consumes: `Sequencer.lock(): void`, which already exists and is already tested.
- Produces: upstream frame `{ t: "lock" }`. `websocket.ts` exports no new names; `lock` stops being `Effect.void`.

**The defect.** `TransportService` declares `lock` (`packages/net/src/transport.ts:81`). `lan.ts` implements it as the Tauri command `net_lock`. `websocket.ts` implements it as:

```ts
    lock: Effect.void,
```

and the relay's frame handler knows only `hello`, `submit` and `ping`. So `Sequencer.lock()` — which exists, and which `relay.test.ts:90` and `:183` exercise — can never be reached from a browser. There is no frame that calls it.

The consequence is the one the host check in `host.rs` describes: `Beacon.locked` stays false, the Join screen keeps offering a room whose match has started, and the newcomer's `Join` is rejected by the reducer *after* they have connected and been welcomed.

**Who may lock.** The relay is a bare sequencer with no notion of authority, and a `lock` frame honoured from anyone lets any peer freeze the room. The cheapest defensible rule, and the one that matches how a browser-hosted room actually works: the first successful join is the host, and only that player's `lock` is honoured. Record this in the commit message — it is a decision, not an obvious fact.

- [ ] **Step 1: Write the failing tests**

In `packages/net/src/__tests__/relay.test.ts`:

```ts
it("locks the room when the host sends a lock frame", async () => {
  const relay = startRelay({ port: 0, room: "ROOM", capacity: 6 })
  await relay.listening
  const host = await openClient(relay.port, "p1", "Ada")
  await openClient(relay.port, "p2", "Bo")

  host.send({ t: "lock" })
  await settle()

  const late = await openClient(relay.port, "p3", "Cy")
  expect(await nextFrame(late)).toMatchObject({ t: "rejected" })
})

it("ignores a lock frame from a player who is not the host", async () => {
  const relay = startRelay({ port: 0, room: "ROOM", capacity: 6 })
  await relay.listening
  await openClient(relay.port, "p1", "Ada")
  const peer = await openClient(relay.port, "p2", "Bo")

  peer.send({ t: "lock" })
  await settle()

  const late = await openClient(relay.port, "p3", "Cy")
  expect(await nextFrame(late)).toMatchObject({ t: "welcome" })
})
```

Use the helpers already in that file for opening clients and reading frames.

In `packages/net/src/__tests__/websocket.test.ts`:

```ts
it("sends a lock frame rather than doing nothing", async () => {
  const { transport, sent } = await connectedTransport()
  await Effect.runPromise(transport.lock)
  expect(sent).toContainEqual({ t: "lock" })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/net
```

Expected: all three fail — the relay ignores the unknown frame, and `transport.lock` sends nothing.

- [ ] **Step 3: Add the frame at both ends**

In `apps/relay/lan-relay.mjs`, record the host on the first successful join (a `#hostId` field on `Sequencer`, set in `join` when `#clients.size === 1` after the insert), then extend the handler:

```js
      if (frame.t === "submit") sequencer.submit(frame.action)
      else if (frame.t === "ping") send({ t: "pong" })
      // A bare sequencer has no notion of authority, so the rule is the
      // simplest one that still means something: whoever opened the room is
      // the only peer that can close it.
      else if (frame.t === "lock" && playerId === sequencer.hostId) sequencer.lock()
```

Expose `hostId` as a getter. In `packages/net/src/websocket.ts`, replace the stub with the same shape `submit` already uses:

```ts
    lock: Effect.try({
      try: () => {
        const current = socket()
        current.send(JSON.stringify({ t: "lock" }))
      },
      catch: (cause) => new TransportError({ reason: `could not lock the room: ${cause}` }),
    }),
```

Read `submit`'s exact error construction at `:226-236` and mirror it rather than copying this sketch — the error type's field names must match.

- [ ] **Step 4: Update the declaration and run the suites**

Add `hostId` to `Sequencer` in `apps/relay/lan-relay.d.ts`, and `{ readonly t: "lock" }` to the upstream frame union if one is declared there.

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run typecheck
nubx vitest run packages/net
```

- [ ] **Step 5: Commit**

```bash
git add apps/relay/lan-relay.mjs apps/relay/lan-relay.d.ts packages/net/src/websocket.ts packages/net/src/__tests__
git commit -F - <<'MSG'
fix: give lock a wire frame, so a browser room can actually close

Sequencer.lock() existed and was tested; nothing could reach it. The relay
knew hello, submit and ping, and the websocket transport implemented lock as
Effect.void — so a browser-hosted room stayed open, the Join screen kept
offering it, and the newcomer's Join was refused by the reducer only after
they had connected and been welcomed.

The relay has no notion of authority, so it honours lock from the first player
to join and from nobody else. That is a choice, not a law: a room opened by a
relay process with no players has no host under this rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

---

## Task 9: nothing calls `lock` when the match starts

**Files:**
- Modify: `packages/app-shell/src/store/match-client.ts` (add `lock()`)
- Modify: `packages/app-shell/src/routes/lobby.tsx:130-134`
- Test: `packages/app-shell/src/store/__tests__/match-client.test.ts`

**Interfaces:**
- Consumes: `TransportService.lock` — real on both transports after Task 8.
- Produces: `MatchClient.lock(): void`.

**Depends on Task 8.** Without it this task wires the host up to a no-op on the browser transport.

**The defect.** `grep` for callers of `transport.lock` across `packages` and `apps` returns `transport.ts` (the declaration), `lan.ts`, `websocket.ts`, `local.ts` (the implementations) and three *test* files. No production code calls it. The Start button submits the action and nothing else:

```tsx
          onClick={() => client.send({ _tag: "Start" })}
```

- [ ] **Step 1: Write the failing test**

```ts
it("locks the room when the host starts the match", () => {
  const transport = fakeTransport()
  const client = new MatchClient(transport, configWith([]), "host", "me")
  seatPlayers(client, ["me", "them"])

  client.send({ _tag: "Start" })
  client.lock()

  expect(transport.locked).toBe(true)
})
```

Add a `locked` flag to the existing fake transport, set by its `lock` implementation.

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell/src/store
```

Expected: FAIL — `client.lock is not a function`.

- [ ] **Step 3: Add the method and call it**

In `match-client.ts`:

```ts
  /**
   * Stop admitting newcomers. The reducer refuses a Join once the match has
   * started anyway; locking is what keeps the room off the Join screen so
   * nobody connects, is welcomed, and only then turned away.
   */
  lock(): void {
    Effect.runPromise(Effect.either(this.transport.lock)).then((done) => {
      if (Either.isLeft(done)) {
        this.patch((s) => ({ ...s, notice: `could not close the room: ${done.left.reason}` }))
      }
    })
  }
```

In `lobby.tsx`, on the host's Start button only:

```tsx
          onClick={() => {
            client.send({ _tag: "Start" })
            client.lock()
          }}
```

- [ ] **Step 4: Run the suites and drive the app**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell
nub run typecheck
nub run lint
nub run build && nub run verify:ui
```

`verify:ui` fails on console errors, page errors and horizontal overflow. The lobby is a screen it drives, so a thrown error in the new handler shows up here and nowhere else.

- [ ] **Step 5: Commit**

```bash
git add packages/app-shell/src/store/match-client.ts packages/app-shell/src/routes/lobby.tsx packages/app-shell/src/store/__tests__/match-client.test.ts
git commit -F - <<'MSG'
fix: close the room when the host starts the match

transport.lock had four implementations, three test callers and no production
caller at all. Beacon.locked therefore stayed false for the life of every
room: the Join screen went on offering a match in progress, and the newcomer
found out only when the reducer refused their Join, after connecting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

---

## Task 10: a failed bind prints the success banner and then crashes

**Files:**
- Modify: `apps/relay/lan-relay.mjs:213-236` (the `isMain` block)
- Test: `packages/net/src/__tests__/relay.test.ts`

**Interfaces:**
- Consumes: `RelayHandle.listening: Promise<void>`.
- Produces: nothing.

**The defect.** `startRelay` builds a promise whose rejection is wired to the server's error event:

```js
  const listening = new Promise((resolve, reject) => {
    if (wss.address()) resolve()
    else {
      wss.once("listening", resolve)
      wss.once("error", reject)
    }
  })
```

The CLI never awaits it:

```js
  startRelay({ port, room, capacity })
  const addresses = lanAddresses()
  console.log(`\nRoom ${room} — up to ${capacity} players, listening on port ${port}.\n`)
```

So on `EADDRINUSE` — the overwhelmingly common failure, because the default port is fixed at 4455 — the user is told the room is listening, reads a join string that will never work, and *then* the process dies on an unhandled rejection. Under Node 24 an unhandled rejection is fatal by default, so the banner and the crash arrive a tick apart with nothing connecting them.

- [ ] **Step 1: Write the failing test**

```ts
it("reports a bind failure instead of resolving", async () => {
  const first = startRelay({ port: 0, room: "ROOM", capacity: 6 })
  await first.listening

  const second = startRelay({ port: first.port, room: "TAKEN", capacity: 6 })
  await expect(second.listening).rejects.toMatchObject({ code: "EADDRINUSE" })

  first.wss.close()
})
```

This one pins the library half, which already behaves correctly — it is here so the CLI fix has something to lean on and so a later change cannot quietly drop the rejection.

- [ ] **Step 2: Run it**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run -t "reports a bind failure"
```

Expected: PASS. If it fails, the promise wiring is also broken and that is the first thing to fix.

- [ ] **Step 3: Await the bind before claiming success**

```js
  const relay = startRelay({ port, room, capacity })
  try {
    await relay.listening
  } catch (cause) {
    const clash = cause && cause.code === "EADDRINUSE"
    console.error(
      clash
        ? `Port ${port} is already in use. Another relay is probably still running; ` +
          `stop it, or pass --port with a free number.`
        : `Could not start the relay: ${cause}`,
    )
    process.exit(1)
  }

  const addresses = lanAddresses()
  console.log(`\nRoom ${room} — up to ${capacity} players, listening on port ${relay.port}.\n`)
```

Top-level `await` is available — the file is an ES module and Node 24 is the floor. Note the banner now reads `relay.port` rather than the requested `port`, so `--port 0` prints the number the OS actually assigned instead of `0`.

- [ ] **Step 4: Prove it by hand**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run relay -- --port 4455 &
sleep 1
nub run relay -- --port 4455 ; echo "exit: $?"
kill %1
```

Expected: the second invocation prints the "already in use" line, exits 1, and never prints a join string. Paste the output into the commit message.

- [ ] **Step 5: Commit**

```bash
git add apps/relay/lan-relay.mjs packages/net/src/__tests__/relay.test.ts
git commit -F - <<'MSG'
fix: say the port is taken instead of printing a join string and dying

The CLI called startRelay and never awaited `listening`, whose reject is wired
to the server's error event. On EADDRINUSE — the common case, the default port
being fixed — it printed "listening on port 4455" and a join string, then the
unhandled rejection killed the process a tick later.

The banner now also prints the bound port, so --port 0 no longer advertises 0.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

---

## Task 11: a replaced pump thread revives itself

**Files:**
- Modify: `src-tauri/src/lib.rs:34` (the `Net` struct), `:109-133` (`start_pump` and `teardown`)
- Test: none possible in this container — see Step 4.

**Interfaces:**
- Produces: `Net.pumping` changes type from `Arc<AtomicBool>` to `Mutex<Option<Arc<AtomicBool>>>` (or equivalent). Nothing outside `lib.rs` touches it.

**The defect.** One flag is shared by every pump that ever runs:

```rust
fn start_pump(app: AppHandle, net: Net, session: Arc<Session>) {
    net.pumping.store(true, Ordering::SeqCst);
    let running = Arc::clone(&net.pumping);
    thread::spawn(move || {
        let mut sink = WebviewSink(app);
        while running.load(Ordering::SeqCst) {
            session.poll(&mut sink);
            thread::sleep(PUMP_INTERVAL);
        }
    });
}

fn teardown(net: &Net, app: &AppHandle) {
    net.pumping.store(false, Ordering::SeqCst);
```

`net_host` and `net_join` both call `teardown` and then `start_pump`. The old thread spends almost all its life inside `thread::sleep(PUMP_INTERVAL)`. `teardown` stores `false`; `start_pump` stores `true` **on the same flag** before the old thread next wakes. The old thread then reads `true` and keeps going.

It holds its own `Arc<Session>`, so `slot.take()` does not drop that session: the old listener stays bound and its beacon keeps broadcasting a room nobody is in, while `session.poll` emits a second, unrelated `lan://commit` sequence space into the same `MatchClient`. Two sequence spaces folded by one client is precisely the condition the fold is not built to survive.

Re-hosting or re-joining is not an edge case — it is what a player does after a failed connection.

- [ ] **Step 1: Give each pump its own flag**

```rust
    /// One flag per pump. Sharing a single flag let a replaced pump observe
    /// the *next* pump's `true` during its sleep and carry on running, holding
    /// its session — listener, beacon and all — alive behind the slot.
    pumping: Mutex<Option<Arc<AtomicBool>>>,
```

- [ ] **Step 2: Retire the old flag before installing the new one**

```rust
fn start_pump(app: AppHandle, net: Net, session: Arc<Session>) {
    let running = Arc::new(AtomicBool::new(true));
    if let Ok(mut slot) = net.pumping.lock() {
        if let Some(previous) = slot.replace(Arc::clone(&running)) {
            previous.store(false, Ordering::SeqCst);
        }
    }
    thread::spawn(move || {
        let mut sink = WebviewSink(app);
        while running.load(Ordering::SeqCst) {
            session.poll(&mut sink);
            thread::sleep(PUMP_INTERVAL);
        }
    });
}

fn teardown(net: &Net, app: &AppHandle) {
    if let Ok(mut slot) = net.pumping.lock() {
        if let Some(previous) = slot.take() {
            previous.store(false, Ordering::SeqCst);
        }
    }
```

Update the `Net` constructor to build `Mutex::new(None)`.

- [ ] **Step 3: Check the lock order**

`start_pump` takes `net.pumping` while holding nothing else; `teardown` takes `net.pumping` and then `net.session`. Confirm no path takes them in the opposite order — read every `net.session.lock()` in the file and make sure none of them calls `start_pump` or `teardown` while holding the guard. If one does, drop the guard explicitly first, the way the `Rejected` paths in `host.rs` already do.

- [ ] **Step 4: Verify without building**

**Do not run `cargo build` or `cargo check` against `src-tauri`** — this container has no webkit2gtk and the failure will be the missing system library, not your code. Verification for this task is:

1. Re-read the diff against Step 3's lock-order question and satisfy yourself in writing.
2. Push and let `.github/workflows/android.yml` compile it. That job is the only compiler this change will meet before review.
3. Say plainly in the commit message that it has not been compiled locally and why.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -F - <<'MSG'
fix: stop a replaced pump thread reviving itself

start_pump and teardown shared one AtomicBool. A pump spends its life asleep,
so the sequence teardown-then-start_pump — which is every re-host and every
re-join — stored false and then true before the old thread next woke. It read
true, carried on, and kept its own Arc<Session> alive: a listener still bound,
a beacon still advertising a dead room, and a second lan://commit sequence
space arriving at a MatchClient built to fold exactly one.

Each pump now owns its flag and retires its predecessor's.

Not compiled locally: src-tauri needs webkit2gtk, which this container does
not have. The Android CI job is the first compiler this meets.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

---

## Finishing

- [ ] **Run every gate, on a clean `dist`**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
rm -rf dist apps/game-web/dist
nub run lint && nub run typecheck && nub run test && nub run build
cargo test -p lan-sync
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all -- --check
```

A stale `dist/` makes workbox double-count four icon entries and report 14 precache entries; 13 is the number on a clean rebuild. Read the output — do not infer it.

- [ ] **Update `docs/handoff.md`**

Move each finding from open to resolved, and record two things the review established that are worth more than the fixes:

1. **The same defect existed in both sequencer implementations** (Tasks 5 and 6). Two implementations of one protocol drift in exactly this way, and only a test written against both catches it.
2. **`transport.lock` had four implementations and no caller.** An interface method that nothing calls is not covered by the type system; nothing in this toolchain would have reported it.

- [ ] **Push**

```bash
git push -u origin claude/snake-ladders-cross-device-3uu177
```

PR #2 is already open against `main`. Do not open a second one.
