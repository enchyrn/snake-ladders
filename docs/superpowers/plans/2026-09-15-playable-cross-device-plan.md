# Playable Pass-and-Play and Android↔PWA Cross-Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish device-local multi-seat pass-and-play so it is genuinely playable, then make a LAN-served PWA able to join an Android-hosted room.

**Architecture:** Milestone A closes the gaps left by the multi-seat checkpoint
(`25a09ac`): profile repair that is never written back, a device that can end up
owning no seat, guests that accumulate forever with no way to remove one, and no
visible "pass the device" prompt. Milestone B teaches the Rust host to speak
RFC 6455 on the port it already listens on, so the same listener serves both the
newline-JSON native peer and a browser `WebSocket`. The room code stays the seed,
both sequencers keep speaking identical frames, and nothing in `packages/engine`
changes except the lobby `Leave` rule.

**Tech Stack:** TypeScript (Effect, `@effect-atom/atom`, React, vitest), Rust
(std-only plus `sha1` and `base64`), nub/Nx.

**Spec:** `docs/handoff.md` — "Current checkpoint (2026-09-15)" for the review
findings this plan inherits, and "Open threads" 1 and 3 for the cross-play half.

## Global Constraints

- **nub, not npm.** `nubx` replaces `npx`. Every `nub`/`nubx`/`cargo` call needs
  `export PATH="$HOME/.local/share/mise/shims:$PATH"` in the same shell invocation.
- **Do not `cargo build` or `cargo check` `src-tauri/`** — webkit2gtk is absent.
  `cargo test -p lan-sync` is the Rust feedback loop and it builds anywhere.
- **`packages/engine/src/**` must stay pure.** No `Math.random`, no `Date.now`,
  no iteration over unordered collections. Determinism is the contract: the same
  ordered log must fold to byte-identical state on every device.
- **`cargo fmt --all` from the root covers `crates/` only.** `src-tauri` needs its
  own `cd src-tauri && cargo fmt`.
- Commits end with the two trailers already used on this branch. **Never put a
  model identifier in a commit message, PR body, or code comment.**
- Branch: `claude/snake-ladders-cross-device-3uu177`. Push with
  `git push -u origin claude/snake-ladders-cross-device-3uu177`.
- Gates before every commit: `nub run test`, `nub run typecheck`, `nub run lint`.
  Rust tasks add `cargo test -p lan-sync` and
  `cargo clippy -p lan-sync --all-targets -- -D warnings`.

---

# Milestone A — Pass-and-play

### Task 1: Profile repair is persisted, and the device always owns a seat

Two defects in `loadProfiles`. It filters malformed and duplicate entries but
never writes the repaired list back, so the repair re-runs on every load and any
other reader still sees the junk. And if the stored list validates but contains
no `owner`, the person holding the device is never seated: `session.tsx` maps
profiles to seats, so `identity.playerId` drops out of the match entirely.

**Files:**
- Modify: `packages/net/src/identity.ts:72-110`
- Test: `packages/net/src/__tests__/identity.test.ts`

**Interfaces:**
- Consumes: `loadIdentity()`, `saveProfiles()`, `Profile` — all already exported.
- Produces: `loadProfiles(): ReadonlyArray<Profile>` — unchanged signature, but
  now guaranteed to contain at least one `kind: "owner"` profile, and to have
  persisted whatever repair it performed. Task 2 and Task 3 rely on both.

- [x] **Step 1: Write the failing tests**

Append to `packages/net/src/__tests__/identity.test.ts`, inside the
`describe("local profiles", ...)` block:

```ts
  it("writes the repaired roster back so the junk is not re-parsed every load", () => {
    storage.set(
      "sl:profiles",
      JSON.stringify([
        { id: "p1", name: "Sam", kind: "owner", createdAt: 1 },
        { id: "p1", name: "Duplicate", kind: "guest", createdAt: 2 },
      ]),
    )

    loadProfiles()

    expect(JSON.parse(storage.get("sl:profiles")!)).toEqual([
      { id: "p1", name: "Sam", kind: "owner", createdAt: 1 },
    ])
  })

  it("leaves an already-clean roster untouched in storage", () => {
    const clean: Profile[] = [{ id: "p1", name: "Sam", kind: "owner", createdAt: 1 }]
    storage.set("sl:profiles", JSON.stringify(clean))

    loadProfiles()

    expect(JSON.parse(storage.get("sl:profiles")!)).toEqual(clean)
  })

  it("seats this device even when the stored roster is all guests", () => {
    storage.set("sl:identity", JSON.stringify({ playerId: "owner-1", name: "Sam" }))
    storage.set(
      "sl:profiles",
      JSON.stringify([{ id: "g1", name: "Guest", kind: "guest", createdAt: 1 }]),
    )

    const profiles = loadProfiles()

    expect(profiles[0]).toEqual(
      expect.objectContaining({ id: "owner-1", name: "Sam", kind: "owner" }),
    )
    expect(profiles.map((p) => p.id)).toEqual(["owner-1", "g1"])
  })
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/net/src/__tests__/identity.test.ts
```

Expected: the three new tests FAIL — the first two because `sl:profiles` still
holds the unrepaired array, the third because the owner is missing.

- [x] **Step 3: Implement**

Replace the body of `loadProfiles` in `packages/net/src/identity.ts` with:

```ts
const validate = (parsed: unknown): Profile[] => {
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  return (parsed as unknown[]).filter((candidate): candidate is Profile => {
    if (!candidate || typeof candidate !== "object") return false
    const profile = candidate as Partial<Profile>
    if (
      typeof profile.id !== "string" ||
      typeof profile.name !== "string" ||
      (profile.kind !== "owner" && profile.kind !== "guest") ||
      typeof profile.createdAt !== "number" ||
      !profile.id ||
      !profile.name ||
      !Number.isFinite(profile.createdAt) ||
      seen.has(profile.id)
    ) {
      return false
    }
    seen.add(profile.id)
    return true
  })
}

const ownerFromIdentity = (): Profile => {
  const identity = loadIdentity()
  return { id: identity.playerId, name: identity.name, kind: "owner", createdAt: Date.now() }
}

/**
 * The roster is repaired on read and the repair is written back, because a
 * caller that reads `sl:profiles` directly would otherwise still see the junk
 * this dropped — and the same entries would be re-validated on every load.
 *
 * A roster with no owner is repaired too: seats are derived from this list, so
 * an owner-less roster leaves the person holding the device with no player.
 */
export const loadProfiles = (): ReadonlyArray<Profile> => {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    const stored = raw === null ? [] : validate(JSON.parse(raw) as unknown)
    const repaired = stored.some((profile) => profile.kind === "owner")
      ? stored
      : [ownerFromIdentity(), ...stored]
    if (repaired.length === 0) repaired.push(ownerFromIdentity())
    // Only rewrite when the parse actually changed something; an untouched
    // roster should not churn storage on every load.
    if (raw === null || JSON.stringify(repaired) !== raw) saveProfiles(repaired)
    return repaired
  } catch {
    // Private browsing, disabled storage, or unparseable JSON.
    return [ownerFromIdentity()]
  }
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/net/src/__tests__/identity.test.ts
```

Expected: PASS, including the three pre-existing profile tests.

- [x] **Step 5: Run the full gates**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add packages/net/src/identity.ts packages/net/src/__tests__/identity.test.ts
git commit -m "fix: persist the repaired profile roster and always seat the owner"
```

---


**DONE.** `nub run test` 155 passed (was 152), typecheck and lint clean.
The "already-clean roster" case passed before the change too — it is a guard
against the new write-back churning storage on every load, so it was kept.

### Task 2: Leaving the lobby frees the seat

`Leave` marks a player `connected: false` and keeps their seat, which is right
mid-match — seats are the deterministic tiebreaker and must never be renumbered
once dice have been drawn. In the **lobby** nothing has been drawn yet, so a
player who leaves before `Start` should vacate the seat entirely, and the
remaining players should close the gap. Without this, Task 3's remove control
leaves a permanent greyed-out ghost that still counts against the six-player cap.

Renumbering here is deterministic: it is a pure function of the ordered log, so
every device folding the same log produces the same seats.

**Files:**
- Modify: `packages/engine/src/match.ts:202-214`
- Test: `packages/engine/src/__tests__/rules.test.ts`

**Interfaces:**
- Consumes: `findPlayer`, `pendingCommitters`, `settle` — already in `match.ts`.
- Produces: no new exports. `applyAction(state, { _tag: "Leave", playerId })`
  now removes the player and renumbers `seat` by index when
  `state.phase === "lobby"`. Task 3's UI depends on this.

- [x] **Step 1: Write the failing test**

Append to `packages/engine/src/__tests__/rules.test.ts`:

```ts
describe("leaving the lobby", () => {
  const join = (state: MatchState, id: string) =>
    Effect.runSync(applyAction(state, { _tag: "Join", playerId: id, name: id }))

  it("frees the seat and closes the gap before the match starts", () => {
    let state = initialMatch(defaultConfig)
    for (const id of ["a", "b", "c"]) state = join(state, id)

    state = Effect.runSync(applyAction(state, { _tag: "Leave", playerId: "b" }))

    expect(state.players.map((p) => p.id)).toEqual(["a", "c"])
    expect(state.players.map((p) => p.seat)).toEqual([0, 1])
  })

  it("keeps the seat once the match has started", () => {
    let state = initialMatch(defaultConfig)
    for (const id of ["a", "b"]) state = join(state, id)
    state = Effect.runSync(applyAction(state, { _tag: "Start" }))

    state = Effect.runSync(applyAction(state, { _tag: "Leave", playerId: "a" }))

    expect(state.players.map((p) => p.id)).toEqual(["a", "b"])
    expect(state.players[0]!.connected).toBe(false)
    expect(state.players.map((p) => p.seat)).toEqual([0, 1])
  })

  it("readmits a player who left the lobby, at the end of the order", () => {
    let state = initialMatch(defaultConfig)
    for (const id of ["a", "b"]) state = join(state, id)
    state = Effect.runSync(applyAction(state, { _tag: "Leave", playerId: "a" }))
    state = join(state, "a")

    expect(state.players.map((p) => p.id)).toEqual(["b", "a"])
    expect(state.players.map((p) => p.seat)).toEqual([0, 1])
  })
})
```

If `MatchState`, `initialMatch`, `defaultConfig`, `applyAction`, `Effect` or
`describe`/`it`/`expect` are not already imported at the top of that file, add
them — check the existing imports first rather than assuming.

- [x] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/engine/src/__tests__/rules.test.ts -t "leaving the lobby"
```

Expected: the first and third FAIL (the player is still present, seats unchanged);
the second PASSES already.

- [x] **Step 3: Implement**

Replace the `case "Leave"` block in `packages/engine/src/match.ts`:

```ts
    case "Leave": {
      const found = findPlayer(state, action.playerId)
      if (!found) return fail("unknown player", "Leave")
      // In the lobby no dice have been drawn and no seat has broken a tie, so
      // the seat can be genuinely vacated and the rest closed up. Renumbering
      // is a pure function of the ordered log, so every device agrees.
      if (state.phase === "lobby") {
        const players = state.players
          .filter((p) => p.id !== action.playerId)
          .map((p, seat) => ({ ...p, seat }))
        return Effect.succeed({ ...state, players })
      }
      const players = state.players.slice()
      players[found.index] = { ...found.player, connected: false }
      // Never renumber seats once the match is running: seat order is the
      // deterministic tiebreaker.
      const next: MatchState = { ...state, players }
      return Effect.succeed(
        state.phase === "committing" && pendingCommitters(next).length === 0 && next.round > 0
          ? settle(next)
          : next,
      )
    }
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/engine/src/__tests__/rules.test.ts
nubx vitest run packages/engine/src/__tests__/determinism.test.ts
```

Expected: PASS. The determinism guard must stay green — it is the contract.

- [x] **Step 5: Run the full gates**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
```

Expected: all pass. `packages/app-shell/src/store/__tests__/match-client.test.ts`
exercises `Leave`; if a case there assumed the seat survived a lobby leave, read
it and decide whether the test or this rule is wrong before changing either.

- [x] **Step 6: Commit**

```bash
git add packages/engine/src/match.ts packages/engine/src/__tests__/rules.test.ts
git commit -m "feat: leaving the lobby frees the seat instead of holding it"
```

---


**DONE.** `nub run test` 158 passed, typecheck and lint clean; the determinism
guard stays green.

The plan's test sketch called `initialMatch(defaultConfig)`, but `defaultConfig`
is a function taking a seed — `defaultConfig(seed)`. Corrected in the test. No
existing `match-client` test assumed a lobby leave kept the seat.

### Task 3: Remove a local player

Guests are created in the lobby and persisted forever. Nothing removes one, so
every future local match auto-joins every guest ever added, and the roster only
ever grows until it hits the six-player cap.

**Files:**
- Modify: `packages/app-shell/src/app/session.tsx:91-99` (add `removeGuest`)
- Modify: `packages/app-shell/src/routes/lobby.tsx:104-131` (a remove control)
- Test: `packages/app-shell/src/store/__tests__/match-client.test.ts`

**Interfaces:**
- Consumes: `saveProfiles`, `Profile` from `@mutation/net/identity`;
  `client.setSeats(seats: ReadonlyArray<string>)` and `client.send(action)` from
  `MatchClient`; the lobby-`Leave` rule from Task 2.
- Produces: `SessionValue.removeGuest(id: string): void` — drops the guest from
  React state and from `localStorage`. Owner profiles are never removable.

- [x] **Step 1: Write the failing test**

Append to `packages/app-shell/src/store/__tests__/match-client.test.ts`:

```ts
  it("frees the seat when a local guest is removed in the lobby", async () => {
    const { client, transport } = makeLocalClient({ me: "owner", seats: ["owner", "g1"] })

    client.send({ _tag: "Join", playerId: "owner", name: "Sam" })
    client.send({ _tag: "Join", playerId: "g1", name: "Guest" })
    await transport.settle()

    client.send({ _tag: "Leave", playerId: "g1" })
    client.setSeats(["owner"])
    await transport.settle()

    expect(client.state.match.players.map((p) => p.id)).toEqual(["owner"])
    expect(client.state.seats).toEqual(["owner"])
    expect(client.state.actingSeat).toBe("owner")
  })
```

Read the existing helpers in that file first. If there is no `makeLocalClient`
or `transport.settle()`, use whatever construction and flush the neighbouring
tests already use and keep the three assertions — do not invent a helper.

- [x] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell/src/store/__tests__/match-client.test.ts -t "local guest"
```

Expected: FAIL.

- [x] **Step 3: Add `removeGuest` to the session**

In `packages/app-shell/src/app/session.tsx`, add to the `SessionValue` interface
beside `addGuest`:

```ts
  readonly removeGuest: (id: string) => void
```

and to the `value` object beside `addGuest`:

```ts
    removeGuest: (id) => {
      // Owners are the device itself; removing one would leave the person
      // holding the phone with no seat, and `loadProfiles` would just put it
      // back on the next load.
      const next = profiles.filter((profile) => !(profile.kind === "guest" && profile.id === id))
      if (next.length === profiles.length) return
      setProfiles(next)
      saveProfiles(next)
    },
```

- [x] **Step 4: Add the remove control to the lobby**

In `packages/app-shell/src/routes/lobby.tsx`, inside the roster `<ul>`, render a
remove button for local guest seats. Replace the existing player `<li>` map with
one that adds the control — read the current markup and keep its classes:

```tsx
          {match.players.map((player) => (
            <li key={player.id} className="player">
              <span className="player-name">{player.name}</span>
              {role === "local" && session.profiles.some((p) => p.id === player.id && p.kind === "guest") && (
                <button
                  type="button"
                  className="remove"
                  aria-label={`Remove ${player.name}`}
                  onClick={() => {
                    session.removeGuest(player.id)
                    client.setSeats(client.state.seats.filter((seat) => seat !== player.id))
                    client.send({ _tag: "Leave", playerId: player.id })
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
```

- [x] **Step 5: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
```

Expected: all pass.

- [x] **Step 6: Drive the UI**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run build && nub run verify:ui
```

Expected: no console errors, no horizontal overflow. If Playwright cannot launch
(the container has been missing `libnspr4.so`), record that as blocked rather
than reporting a pass — do not claim a UI result you did not see.

- [x] **Step 7: Commit**

```bash
git add packages/app-shell/src/app/session.tsx packages/app-shell/src/routes/lobby.tsx packages/app-shell/src/store/__tests__/match-client.test.ts
git commit -m "feat: remove a local guest from the lobby"
```

---


**DONE.** `nub run test` 161 passed, typecheck and lint clean, `verify:ui` clean.

Three corrections to the plan:

- The removal rule went into `identity.ts` as a pure `removeProfile(profiles, id)`
  rather than living inline in `session.tsx`. The React context is not unit-testable
  here, and the plan's `match-client` test would have passed without the feature.
  `removeProfile` returns the original array when nothing matched, so the caller
  skips the write and the re-render.
- `verify:ui` is **not** blocked in this container, contrary to what the handoff
  recorded. `drive-app.mjs` already falls back to any Chromium under
  `PLAYWRIGHT_BROWSERS_PATH`, and build 1194 is installed and launches.
- Driving the flow found a real layout defect. `.players` is shared with the match
  HUD, which wants a wrapping horizontal strip; the lobby roster needs one player
  per row, or six names each with a remove button run off the side of a phone.
  `.roster .players` is now a column, and `.add-player`/`.remove-player` had no
  styling at all. Screenshots confirmed before and after.

### Task 4: Say whose turn it is, and let the device switch seats

With several seats on one device the only cue is a CSS class on the player strip.
Pass-and-play needs to say, in words, who should take the device. And under the
`simultaneous` module more than one owned seat can act at once, so `actingSeat`
— which picks the *first* seat that can commit — needs a manual override.

**Files:**
- Modify: `packages/app-shell/src/store/atoms.ts:26-30` (add `ownedActableAtom`)
- Modify: `packages/app-shell/src/store/match-client.ts:101-103` (add `setActingSeat`)
- Modify: `packages/app-shell/src/routes/match.tsx:35-60` (the prompt and switcher)
- Test: `packages/app-shell/src/store/__tests__/match-client.test.ts`

**Interfaces:**
- Consumes: `actingSeatFor(match, seats)`, `canCommit(match, seat)`,
  `clientStateAtom`, `ClientState.seats`, `ClientState.actingSeat`.
- Produces: `MatchClient.setActingSeat(seat: string): void` — a no-op unless the
  seat is in `state.seats`; and `ownedActableAtom`, a
  `ReadonlyArray<string>` of owned seats that can commit right now.

- [x] **Step 1: Write the failing test**

Append to `packages/app-shell/src/store/__tests__/match-client.test.ts`:

```ts
  it("holds a manually chosen seat instead of snapping back to the first", async () => {
    const { client, transport } = makeLocalClient({ me: "owner", seats: ["owner", "g1"] })

    client.send({ _tag: "Join", playerId: "owner", name: "Sam" })
    client.send({ _tag: "Join", playerId: "g1", name: "Guest" })
    client.send({ _tag: "Start" })
    await transport.settle()

    client.setActingSeat("g1")

    expect(client.state.actingSeat).toBe("g1")
  })

  it("refuses a seat this device does not own", async () => {
    const { client, transport } = makeLocalClient({ me: "owner", seats: ["owner"] })

    client.send({ _tag: "Join", playerId: "owner", name: "Sam" })
    await transport.settle()

    client.setActingSeat("someone-else")

    expect(client.state.actingSeat).toBe("owner")
  })
```

Use the same construction helper the neighbouring tests use.

- [x] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell/src/store/__tests__/match-client.test.ts -t "seat"
```

Expected: FAIL with `setActingSeat is not a function`.

- [x] **Step 3: Implement the client method**

In `packages/app-shell/src/store/match-client.ts`, beside `setSeats`:

```ts
  /**
   * Under `simultaneous` several owned seats can act at once and `actingSeatFor`
   * only ever picks the first, so the device needs a way to say which of its
   * own players is holding it. Seats it does not own are refused rather than
   * silently accepted — acting as someone else's player would be rejected by
   * every other device anyway.
   */
  setActingSeat(seat: string): void {
    if (!this.state.seats.includes(seat)) return
    this.patch((s) => ({ ...s, actingSeat: seat }))
  }
```

- [x] **Step 4: Add the atom**

In `packages/app-shell/src/store/atoms.ts`, beside `canRollAtom`:

```ts
/** The owned seats that could commit right now. More than one only under the
 *  `simultaneous` module, which is exactly when the switcher is worth showing. */
export const ownedActableAtom = select((s) => s.seats.filter((seat) => canCommit(s.match, seat)))
```

- [x] **Step 5: Render the prompt and switcher**

In `packages/app-shell/src/routes/match.tsx`, add `ownedActableAtom` to the
`../store/atoms` import, read it beside `actingSeat`:

```tsx
  const ownedActable = useAtomValue(ownedActableAtom)
```

and render this directly above the existing `<div className="control-bar">`:

```tsx
      {client.state.seats.length > 1 && actingPlayer && (
        <div className="seat-turn">
          <p className="hint">
            {canRollNow ? `${actingPlayer.name}'s turn — pass the device` : `Playing as ${actingPlayer.name}`}
          </p>
          {ownedActable.length > 1 && (
            <div className="seat-switch">
              {ownedActable.map((seat) => (
                <button
                  key={seat}
                  type="button"
                  className={seat === actingSeat ? "is-acting" : ""}
                  onClick={() => client.setActingSeat(seat)}
                >
                  {nameOf(seat)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
```

`canRollNow` comes from `useAtomValue(canRollAtom)` — add that read next to
`ownedActable` rather than reaching into the `RollButton` component.

- [x] **Step 6: Run the gates**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add packages/app-shell/src/store/atoms.ts packages/app-shell/src/store/match-client.ts packages/app-shell/src/routes/match.tsx packages/app-shell/src/store/__tests__/match-client.test.ts
git commit -m "feat: name the acting local seat and let the device switch between its own"
```

---


**DONE.** `nub run test` 163 passed, typecheck, lint and `verify:ui` clean.

Driven in a real browser with two local seats: the prompt reads
"Krait's turn — pass the device", both seats offer a switch button because
`simultaneous` is on by default, and clicking Jo moved the acting seat from
Krait to Jo. `.seat-turn` and `.seat-switch` needed styles of their own.

### Task 5: Close the two inherited review findings, and prove they are closed

The checkpoint's review raised two Criticals. Both look addressed in `5f6f661`,
but the regressions the review asked for are not both present, and a fix without
its regression is not closed. There is also dead code left behind by the first.

**Files:**
- Modify: `apps/relay/lan-relay.mjs:163-167` (remove the dead host claim)
- Modify: `apps/relay/lan-relay.d.ts:45-48` (remove the duplicate `hostId`)
- Test: `packages/net/src/__tests__/relay.test.ts`
- Test: `packages/app-shell/src/store/__tests__/match-client.test.ts`

**Interfaces:**
- Consumes: `Sequencer#join/leave/canLock`, `MatchClient` and a transport whose
  `submit` can be made to fail.
- Produces: no new exports.

- [x] **Step 1: Write the failing tests**

Append to the `describe("Sequencer", ...)` block in
`packages/net/src/__tests__/relay.test.ts`:

```ts
  it("does not hand host authority to a stranger after the host drops", () => {
    const seq = new Sequencer({ room: "ROOM" })
    const host = seq.join({ playerId: "host", name: "Host", send: () => {} })
    expect(host.ok).toBe(true)

    seq.leave("host", host.token)
    const stranger = seq.join({ playerId: "stranger", name: "Stranger", send: () => {} })

    expect(seq.hostId).toBe("host")
    expect(seq.canLock("stranger", stranger.token)).toBe(false)
    expect(seq.locked).toBe(false)
  })

  it("gives lock authority back to the original host on reconnect", () => {
    const seq = new Sequencer({ room: "ROOM" })
    const first = seq.join({ playerId: "host", name: "Host", send: () => {} })
    seq.leave("host", first.token)

    const again = seq.join({ playerId: "host", name: "Host", send: () => {} })

    expect(seq.canLock("host", again.token)).toBe(true)
  })
```

Append to `packages/app-shell/src/store/__tests__/match-client.test.ts`:

```ts
  it("re-arms a departure whose Leave could not be submitted", async () => {
    const { client, transport } = makeHostClient({ me: "host" })

    client.send({ _tag: "Join", playerId: "host", name: "Host" })
    client.send({ _tag: "Join", playerId: "peer", name: "Peer" })
    client.send({ _tag: "Start" })
    await transport.settle()

    transport.failNextSubmit("offline")
    transport.emitRoster([
      { player_id: "host", name: "Host", connected: true },
      { player_id: "peer", name: "Peer", connected: false },
    ])
    await transport.settle()

    expect(client.state.match.players.find((p) => p.id === "peer")!.connected).toBe(true)

    transport.emitRoster([
      { player_id: "host", name: "Host", connected: true },
      { player_id: "peer", name: "Peer", connected: false },
    ])
    await transport.settle()

    expect(client.state.match.players.find((p) => p.id === "peer")!.connected).toBe(false)
  })
```

Read the file's existing fake transport before writing this. If it has no
`failNextSubmit` or `emitRoster`, add the smallest hooks to the existing fake
that let a submit fail once and a roster be pushed — do not build a second fake.

- [x] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/net/src/__tests__/relay.test.ts packages/app-shell/src/store/__tests__/match-client.test.ts
```

Expected: the three new tests FAIL. If a relay one passes, the fix is already
complete — say so and keep the test.

- [x] **Step 3: Remove the dead host claim**

In `apps/relay/lan-relay.mjs`, `join()` now claims `#hostId` before the welcome
send, so the line after the `try/catch` can never fire. Delete these three lines:

```js
    // First to actually make it into the room, not merely to attempt it —
    // a join that failed above never reaches here to claim it.
    if (this.#hostId === null) this.#hostId = playerId
```

- [x] **Step 4: Remove the duplicate declaration**

In `apps/relay/lan-relay.d.ts`, `get hostId(): string | null` appears twice in
the `Sequencer` class. Delete the second one.

- [x] **Step 5: Make the departure retry**

If the `match-client` test still fails, the re-arm is not reachable: a stalled
round produces no commits, so `drain()` never runs and nothing re-fires
`retireDeparted`. In `packages/app-shell/src/store/match-client.ts`, the roster
handler already calls `retireDeparted(roster)` on every roster frame, which is
the retry — confirm the re-armed id is still in `pendingDepartures` and not
short-circuited by `this.retired`. Fix whichever of the two sets is wrong; do
not add a timer.

- [x] **Step 6: Run the gates**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add apps/relay/lan-relay.mjs apps/relay/lan-relay.d.ts packages/net/src/__tests__/relay.test.ts packages/app-shell/src/store/__tests__/match-client.test.ts
git commit -m "test: pin host authority across a drop, and a retried departure"
```

---


**DONE.** `nub run test` 166 passed, typecheck and lint clean.

Both Criticals were already fixed in `5f6f661`; all three regressions passed on
first write. A test that passes on broken code proves nothing, so each was
mutation-checked by reverting the fix it guards — the host-authority one fails
when `leave` clears `#hostId`, and the departure one fails when the re-arm is
removed from the failed-submit branch. Step 5 needed no change: the roster
handler already re-runs `retireDeparted`, which is the retry.

Typecheck caught that `JoinResult` is a union, so `.token` needs narrowing —
hence the `admit` helper rather than reaching into the result directly.

### Task 6: Update the handoff and reconcile the pull request

Milestone A ends at a playable state: pass-and-play is complete, the inherited
Criticals are closed with regressions, and the browser-to-browser relay path is
unchanged and green. This is the point to reconcile PR #2 and merge.

**Files:**
- Modify: `docs/handoff.md:7-52` (replace the stale checkpoint block)
- Modify: `docs/playing-together.md` (document removing a player and seat switching)

- [ ] **Step 1: Rewrite the checkpoint block**

Replace "## Current checkpoint (2026-09-15)" in `docs/handoff.md`. It currently
says the branch must not be merged because of two Criticals and cites commit
`ada4ab8`, which does not exist in this history — it was a pre-rebase sha from
the other session and is now `25a09ac`. State: both Criticals closed and which
test pins each; what Milestone A added; the exact gate output; and that
`verify:ui` is blocked by the container's missing `libnspr4.so` if it still is.

- [ ] **Step 2: Document the new controls**

In `docs/playing-together.md`, under pass-and-play: adding a player, removing
one, and that the device names whose turn it is. Keep it to what a player does.

- [ ] **Step 3: Run every gate and record the real numbers**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
cargo test -p lan-sync
```

Copy the actual counts into the handoff. Do not carry forward "152 tests".

- [ ] **Step 4: Commit and push**

```bash
git add docs/handoff.md docs/playing-together.md
git commit -m "docs: record the playable pass-and-play checkpoint"
git push -u origin claude/snake-ladders-cross-device-3uu177
```

- [ ] **Step 5: Reconcile the pull request**

Re-read PR #2's body against the branch as it now stands: commit count, file
count, test counts, and every claim about what works. The body has drifted
materially wrong once already on this branch. Rewrite it to match, then merge.

---

# Milestone B — A LAN-served PWA joining an Android host

**Read this before starting Milestone B.** The deployed PWA on GitHub Pages
**cannot** join an Android host, and no task here changes that. An HTTPS page may
not open a `ws://` socket; the browser refuses before the connection leaves the
tab. That is open thread 1 and it needs a `wss://` relay, which is an
architecture decision with its own ADR.

What *is* reachable: the PWA served over plain HTTP on the LAN
(`nub run dev -- --host`) may open `ws://`. So the achievable cross-play is
**LAN-served PWA ↔ Android host**, once the Rust host speaks WebSocket. Today it
is a raw `TcpListener` reading newline-delimited JSON with `read_line`, and a
browser handshake gets `{"t":"rejected","reason":"malformed handshake"}` — this
was probed directly, not inferred.

### Task 7: A WebSocket codec in `crates/lan-sync`

**Files:**
- Create: `crates/lan-sync/src/ws.rs`
- Modify: `crates/lan-sync/src/lib.rs` (add `mod ws;`)
- Modify: `crates/lan-sync/Cargo.toml` and the root `Cargo.toml` workspace deps

**Interfaces:**
- Produces, all used by Task 8:
  - `pub fn accept_key(client_key: &str) -> String` — the
    `Sec-WebSocket-Accept` value.
  - `pub fn handshake_response(request: &str) -> Option<String>` — the full HTTP
    101 response, or `None` when the request is not a valid upgrade.
  - `pub fn read_text(reader: &mut impl BufRead) -> std::io::Result<Option<String>>`
    — one text message, `None` on close.
  - `pub fn write_text(w: &mut impl Write, text: &str) -> std::io::Result<()>`
    — one unmasked server text frame.

- [x] **Step 1: Add the dependencies**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo add sha1@0.10 base64@0.22 -p lan-sync
```

- [x] **Step 2: Write the failing tests**

Create `crates/lan-sync/src/ws.rs` containing only the test module, so it
compiles to a failure rather than a parse error:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // The example key and expected accept value are from RFC 6455 section 1.3.
    #[test]
    fn computes_the_rfc_example_accept_key() {
        assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    #[test]
    fn refuses_a_request_that_is_not_an_upgrade() {
        assert!(handshake_response("GET / HTTP/1.1\r\nHost: x\r\n\r\n").is_none());
    }

    #[test]
    fn answers_a_real_upgrade_request() {
        let request = "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
        let response = handshake_response(request).expect("upgrade");
        assert!(response.starts_with("HTTP/1.1 101 "));
        assert!(response.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
    }

    #[test]
    fn round_trips_a_masked_client_frame() {
        // A client frame is always masked; the server's is never.
        let mut framed = vec![0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d];
        for (i, byte) in b"Hello".iter().enumerate() {
            framed.push(byte ^ [0x37, 0xfa, 0x21, 0x3d][i % 4]);
        }
        let mut reader = std::io::BufReader::new(&framed[..]);
        assert_eq!(read_text(&mut reader).unwrap(), Some("Hello".to_string()));
    }

    #[test]
    fn writes_an_unmasked_server_frame() {
        let mut out = Vec::new();
        write_text(&mut out, "Hi").unwrap();
        assert_eq!(out, vec![0x81, 0x02, b'H', b'i']);
    }

    #[test]
    fn reports_a_close_frame_as_end_of_stream() {
        let framed = vec![0x88, 0x80, 0x00, 0x00, 0x00, 0x00];
        let mut reader = std::io::BufReader::new(&framed[..]);
        assert_eq!(read_text(&mut reader).unwrap(), None);
    }
}
```

Add `mod ws;` to `crates/lan-sync/src/lib.rs`.

- [x] **Step 3: Run the tests to verify they fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync ws::
```

Expected: FAIL to compile — `accept_key` and the rest are not defined.

- [x] **Step 4: Implement**

Write the four functions above the test module in `crates/lan-sync/src/ws.rs`.
Requirements, all of which the tests or the RFC pin:

- `accept_key` appends the RFC 6455 GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
  to the client key, SHA-1s it, and base64-encodes the digest.
- `handshake_response` parses headers case-insensitively, requires
  `Upgrade: websocket`, a `Connection` value containing `upgrade`,
  `Sec-WebSocket-Version: 13`, and a `Sec-WebSocket-Key`.
- `read_text` handles opcodes `0x1` (text), `0x8` (close → `Ok(None)`),
  `0x9` (ping → reply is Task 8's concern; skip the frame here) and `0xA` (pong,
  skip). It reads the 7-bit length plus the 16- and 64-bit extended forms, and
  unmasks with the 4-byte key. **Reject a payload over 1 MiB** with
  `ErrorKind::InvalidData` rather than allocating what a peer claims — an
  unbounded length here is a trivial memory exhaustion.
- `write_text` writes FIN + opcode `0x1`, no mask, with the same three length
  forms.
- Fragmented messages (opcode `0x0`) are out of scope: no frame this protocol
  sends approaches a fragment boundary. Return `ErrorKind::InvalidData`, do not
  silently mis-decode.

- [x] **Step 5: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync ws::
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all
```

Expected: PASS, clippy clean.

- [x] **Step 6: Commit**

```bash
git add crates/lan-sync/src/ws.rs crates/lan-sync/src/lib.rs crates/lan-sync/Cargo.toml Cargo.toml Cargo.lock
git commit -m "feat: add an RFC 6455 codec to lan-sync"
```

---


**DONE.** `cargo test -p lan-sync` 37 passed (13 new codec tests), clippy clean
under `-D warnings`, `cargo fmt --all` applied.

ADR 0019 was written **before** this task rather than at Task 9, because CLAUDE.md
requires the ADR ahead of an architectural change and this is where the change
actually happens. The ADR index was also missing 0018 entirely; both rows added.

Clippy caught three things the tests could not: `Read` is reached through the
`BufRead` supertrait bound so importing it is redundant, and three test fixtures
allocated a `Vec` where an array would do.

### Task 8: Serve both protocols on the host's one port

**Files:**
- Modify: `crates/lan-sync/src/host.rs:280-400` (the per-client thread)
- Test: `crates/lan-sync/tests/` — add a browser-handshake case

**Interfaces:**
- Consumes: `ws::handshake_response`, `ws::read_text`, `ws::write_text`.
- Produces: no new public API. A client whose first bytes are `GET ` is served
  over WebSocket; anything else keeps the newline-JSON path byte for byte.

- [x] **Step 1: Write the failing test**

Add to the integration tests, mirroring how the existing ones start a host:

```rust
#[test]
fn a_browser_handshake_is_upgraded_and_welcomed() {
    let host = Host::bind("ROOM", 0, 6).expect("bind");
    let port = host.port();

    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
    let request = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
    );
    use std::io::{Read, Write};
    stream.write_all(request.as_bytes()).expect("write");

    let mut buf = [0u8; 256];
    let n = stream.read(&mut buf).expect("read");
    let response = String::from_utf8_lossy(&buf[..n]);
    assert!(response.starts_with("HTTP/1.1 101 "), "got: {response}");
}
```

Use the actual `Host::bind` signature and port accessor from `host.rs` — read
them rather than trusting this sketch.

- [x] **Step 2: Run it to verify it fails**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync a_browser_handshake
```

Expected: FAIL — today the host answers `{"t":"rejected","reason":"malformed handshake"}`.

- [x] **Step 3: Implement**

In the per-client thread in `host.rs`, before the existing handshake read, peek
the first four bytes. `BufReader::fill_buf` does this without consuming. If they
are `GET `, read the request head up to `\r\n\r\n`, call
`ws::handshake_response`, write it, and set a flag so every later read goes
through `ws::read_text` and every write through `ws::write_text`. Otherwise fall
through to `read_line` exactly as now.

Keep the frame payloads identical: the same JSON that goes out today as a line
goes out as a WebSocket text frame. A peer must not be able to tell which
sequencer it joined — that is the contract between the two implementations.

The writer half is shared with the broadcast path in `Host`, so the branch has to
live wherever the client's `send` closure is built, not only in the read loop.
Read `host.rs:240-270` before changing it.

- [x] **Step 4: Run the tests**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all
```

Expected: PASS, including every pre-existing newline-JSON test — the native peer
path must be untouched.

- [x] **Step 5: Commit**

```bash
git add crates/lan-sync/src/host.rs crates/lan-sync/tests
git commit -m "feat: accept a browser WebSocket on the host's existing port"
```

---


**DONE.** `cargo test -p lan-sync` 39 passed (was 37), clippy clean, fmt applied.
Every pre-existing native test still passes — the newline-JSON path is untouched.

Two departures from the plan:

- The plan said peek four bytes. It discriminates on **one**: `fill_buf` blocks
  for the first byte but never waits to accumulate more, so a four-byte check can
  see a short buffer and misclassify a browser as a native peer. `G` versus `{`
  separates them unambiguously, and `handshake_response` validates the rest.
- A second test was added beyond the plan's: a browser and a native peer sharing
  one ordered log. The handshake test alone would pass even if the two transports
  ended up in separate rooms, which is the failure that actually matters.

A `GET` that is not a version 13 upgrade gets `400 Bad Request` in plain HTTP,
since whatever sent it cannot decode a WebSocket frame.

### Task 9: Point the browser at a native host, and write the ADR

**Files:**
- Modify: `packages/net/src/websocket.ts` (accept a host address, not only the relay)
- Modify: `packages/app-shell/src/routes/` join screen — read it to find the entry point
- Create: `docs/adr/0019-native-host-speaks-websocket.md`
- Modify: `docs/playing-together.md`, `docs/handoff.md`

- [x] **Step 1: Write the ADR first**

CLAUDE.md requires the ADR *before* the change, and this is architectural. Record:
the decision (one listener, two protocols, chosen over a second port); the cost
(hand-rolled framing in a crate that had only serde, two new dependencies, no
fragmentation support); and what it does **not** buy — the deployed HTTPS PWA
still cannot join, because mixed content is a browser rule and not ours to fix.
ADR 0012 and 0013 are the prior art.

- [x] **Step 2: Let the join screen take a host address**

Read `packages/net/src/websocket.ts` and the join route. The browser transport
already builds a `ws://` URL for the relay; it needs to accept a `host:port` from
the join screen so it can dial an Android host directly. Keep the room code as the
seed — nothing about seeding changes.

- [x] **Step 3: Run every gate**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
cargo test -p lan-sync
```

- [x] **Step 4: Commit and push**

```bash
git add -A
git commit -m "feat: let a LAN-served browser join a native host directly"
git push -u origin claude/snake-ladders-cross-device-3uu177
```

- [x] **Step 5: Record honestly what is still unverified**

Two phones have still not played each other. CI builds the APK; it does not run
it. Say so in `docs/handoff.md` rather than implying the pairing is proven.

---


**DONE.** All JS gates green at 166 tests, `verify:ui` clean.

Step 2 turned out to need no code. `relayUrl` already accepts any `host:port`
and defaults the port only when one is omitted, and `refuseInsecure` already
produces the right message for the HTTPS case. The native host binds an
**ephemeral** port, advertised over UDP, so a browser could never have guessed
it anyway — the player types the `address:port@CODE` line the host lobby already
displays. What was wrong was the copy, which said "nearby devices" and meant
only installed apps.

The ADR was written ahead of Task 7, not here, per CLAUDE.md.

## Deferred

- **The `wss://` relay architecture** (open thread 1, task #14). Milestone B does
  not close it and is not a substitute for it. The deployed PWA still cannot join
  anything until a relay is reachable over TLS, and that trades away the promise
  that the game never touches the internet. It needs its own ADR and its own plan.
- **`playRandomMatch` has no `Leave` branch**, so the determinism guard has never
  folded a mid-match departure. Task 2 changes `Leave`; extending the fuzz driver
  to emit it would have caught the one-way-door defect that the final review found
  by reading.
- **Rust-side logging** (open thread 4) and **the RPG layer** (open thread 5).
