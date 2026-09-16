# Nx Split Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap the Tasks 4–7 review left open, so the Nx split's
gates actually gate and the two audits' unflagged defects are fixed.

**Architecture:** Three independent groups. Restore the type gates the split
silently dropped (build, CI); fix three real defects the audits introduced or
under-reported (an unbounded websocket handshake, a stale-closure dispose, a
residual accept-loop race); and make the record match the tree (an ADR for the
restructure, stale doc paths, unticked checkboxes, config hygiene).

**Tech Stack:** Nx 23, nub 0.9.1, Vite 8, vitest 5, TypeScript strict, Effect
TS, React 19, Rust (crates/lan-sync), ESLint 10 + @nx/eslint-plugin.

**Spec:** `docs/handoff.md` open thread 3 ("Defects left by the Nx split") and
open thread 2 (the residual host-shutdown race), plus
`docs/audits/2026-09-13-effect-audit.md` and
`docs/audits/2026-09-13-rust-audit.md`. Those threads are the requirements;
this plan is their remediation.

> **Checkboxes ticked retroactively on 2026-09-16.** The work landed in
> `1b498ec`..`4bfb495` but the boxes were never ticked, so this plan read as
> untouched for two days. Each of the eight tasks was verified against the tree
> before ticking — the type gate on `game-web:build`, CI's unscoped typecheck,
> the 10s handshake bound, `makeClientSlot` held in a ref, `serve_client`
> observing `running` first, ADR 0018 with 0014 superseded, no pre-split paths
> left in docs, and the `mise` tasks implemented. Nobody re-did the work; the
> record was corrected to match it.


## Global Constraints

- **nub, not npm** (ADR 0017). `nub.lock` is the lockfile. `nubx` replaces
  `npx` — except for the Tauri CLI in `src-tauri/project.json`, which must stay
  `npx` because Tauri bakes the command into the generated Android project.
- `packages/engine/**` must stay pure: no `Math.random`, no `Date.now`, no
  iteration over unordered collections. Run
  `nubx vitest run packages/engine/src/__tests__/determinism.test.ts` after any
  engine change.
- Do **not** `cargo build` or `cargo check` `src-tauri/` — the webview toolchain
  is absent in a container. `crates/lan-sync` is safe and has zero Tauri deps.
- `nub run verify:ui` after any UI change. Its `--base-path` prefix must match
  the base the bundle was built with.
- Commit message trailers, verbatim, on every commit:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy`.
  Never name a model in any pushed artifact.
- Branch is `claude/snake-ladders-cross-device-3uu177`. Push there and nowhere
  else. Do not open a pull request.
- Every `nub`/`nubx`/`cargo` invocation in this container needs
  `export PATH="$HOME/.local/share/mise/shims:$PATH"` first.

---

### Task 1: Restore the type gate on `build`

The split changed `build` from `tsc --noEmit && vite build` to a bare
`vite build`, so Pages deploys and Tauri's `beforeBuildCommand` now ship with
no type gate at all, while `CLAUDE.md` still documents it as "typecheck +
production bundle".

**Files:**
- Modify: `apps/game-web/project.json` (the `build` target)
- Modify: `packages/tooling/project.json` (the `pages-build` target)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `game-web:build` and `tooling:pages-build` both fail on a type
  error. Task 2 relies on `game-web:typecheck` continuing to exist unchanged.

- [x] **Step 1: Prove the gate is missing**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
printf 'const wrong: number = "not a number"\nexport default wrong\n' > apps/game-web/type-probe.ts
sed -i 's|"include": \["main.tsx", "vite.config.ts"\]|"include": ["main.tsx", "vite.config.ts", "type-probe.ts"]|' apps/game-web/tsconfig.json
nubx nx run game-web:build --skip-nx-cache; echo "build exit=$?"
```

Expected: `build exit=0` — a type error ships.

- [x] **Step 2: Add the gate**

In `apps/game-web/project.json`, change the `build` target's command to run
the typecheck first:

```json
"build": { "executor": "nx:run-commands", "options": { "command": "tsc --noEmit -p apps/game-web/tsconfig.json && vite build --config apps/game-web/vite.config.ts" } },
```

In `packages/tooling/project.json`, the same for `pages-build`:

```json
"pages-build": { "executor": "nx:run-commands", "options": { "command": "tsc --noEmit -p apps/game-web/tsconfig.json && PUBLIC_BASE_PATH=\"${PUBLIC_BASE_PATH:-${GITHUB_REPOSITORY#*/}}\" vite build --config apps/game-web/vite.config.ts" } }
```

- [x] **Step 3: Verify the gate now bites**

```bash
nubx nx run game-web:build --skip-nx-cache; echo "build exit=$?"
nubx nx run tooling:pages-build --skip-nx-cache; echo "pages exit=$?"
```

Expected: both non-zero, with `type-probe.ts` named in the tsc output.

- [x] **Step 4: Remove the probe and confirm green**

```bash
rm apps/game-web/type-probe.ts
git checkout apps/game-web/tsconfig.json
nubx nx run game-web:build --skip-nx-cache; echo "build exit=$?"
nub run build; echo "nub build exit=$?"
```

Expected: both 0, and the build log still reports `precache 13 entries`.

- [x] **Step 5: Commit**

```bash
git add apps/game-web/project.json packages/tooling/project.json
git commit -m "$(cat <<'EOF'
fix: typecheck before building again

The split reduced `build` to a bare `vite build`, so the Pages deploy
and Tauri's beforeBuildCommand shipped with no type gate while
CLAUDE.md went on describing it as "typecheck + production bundle".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
EOF
)"
```

---

### Task 2: Make CI typecheck the test files

`ci.yml` runs `nx run-many -t typecheck,test,build --projects=game-web`, and
`apps/game-web/tsconfig.json` includes only `["main.tsx", "vite.config.ts"]` —
39 production files, zero tests. Vitest transpiles without typechecking, so a
type error in any test file is currently invisible everywhere.

**Files:**
- Modify: `.github/workflows/ci.yml:29` (the web job's run-many step)

**Interfaces:**
- Consumes: Task 1's `build` target (now typechecking) — unchanged here.
- Produces: CI covers every project's typecheck, not just `game-web`'s.

- [x] **Step 1: Prove the hole**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cat > packages/engine/src/__tests__/type-probe.test.ts <<'EOF'
import { it, expect } from "vitest"
const wrong: number = "not a number"
it("probe", () => { expect(wrong).toBeDefined() })
EOF
nubx nx run-many -t typecheck,test,build --projects=game-web --skip-nx-cache; echo "ci command exit=$?"
```

Expected: exit 0 — CI would go green on a type error in a test.

- [x] **Step 2: Confirm the root typecheck does catch it**

```bash
nub run typecheck; echo "root typecheck exit=$?"
```

Expected: non-zero, naming `type-probe.test.ts`. This is why the fix is to
widen CI's scope rather than change any tsconfig.

- [x] **Step 3: Widen the CI step**

In `.github/workflows/ci.yml`, replace the single run-many line with:

```yaml
      # Not scoped to game-web: its tsconfig includes only main.tsx and
      # vite.config.ts, so a scoped typecheck covers no test file at all and a
      # type error in a test reaches nobody — vitest transpiles without
      # checking. Every project's typecheck runs, and the whole suite with it.
      - run: nubx nx run-many -t typecheck,test,build
```

- [x] **Step 4: Verify the widened command catches the probe**

```bash
nubx nx run-many -t typecheck,test,build --skip-nx-cache; echo "exit=$?"
```

Expected: non-zero, naming `type-probe.test.ts`.

- [x] **Step 5: Remove the probe and confirm green**

```bash
rm packages/engine/src/__tests__/type-probe.test.ts
nubx nx run-many -t lint,typecheck,test,build --skip-nx-cache; echo "exit=$?"
nub run typecheck; echo "typecheck exit=$?"
```

Expected: both 0; run-many reports 7 projects.

- [x] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
fix: let CI typecheck the test files

The web job ran run-many scoped to game-web, whose tsconfig includes
main.tsx and vite.config.ts and nothing else, so CI typechecked 39
production files and no test. Vitest transpiles without checking, so
a type error in a test was invisible everywhere. Unscope the step.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
EOF
)"
```

---

### Task 3: Bound the websocket handshake

The Effect audit moved `connect` to resume only on `welcome`, `rejected`,
`onerror` or `onclose`. A relay that accepts the socket and never answers the
hello now leaves the `Effect.async` pending forever. Before that change `join`
resolved on `onopen`, so the hang is new, and the audit did not list it. There
is no timeout at any call site.

**Files:**
- Modify: `packages/net/src/websocket.ts:97-190` (the `connect` body)
- Test: `packages/net/src/__tests__/websocket.test.ts`

**Interfaces:**
- Consumes: `makeRelayHarness` from `packages/net/src/__tests__/harness.ts`
  (`relay`, `joined`, `until`, `track`, `teardown`).
- Produces: `connect` fails with reason
  `"the relay accepted the connection but never answered"` after 10 seconds.
  No signature change — `join` stays `(address, identity) => Effect<void, TransportError>`.

- [x] **Step 1: Write the failing test**

Add to `packages/net/src/__tests__/websocket.test.ts`, inside the
`describe("WebSocket transport against a live relay", ...)` block:

```ts
  it("gives up on a relay that accepts the socket and never answers", async () => {
    // A bare WebSocket server that completes the upgrade and then says
    // nothing: the shape of a wedged or mismatched relay. Before `connect`
    // waited for `welcome` this resolved on open; now it must time out
    // rather than leave the player on a spinner forever.
    const { WebSocketServer } = await import("ws")
    const wss = new WebSocketServer({ port: 46_310 })
    wss.on("connection", () => {})
    try {
      const transport = track(makeWebSocketTransport())
      const started = Date.now()
      const result = await Effect.runPromise(
        Effect.either(transport.join("127.0.0.1:46310", { player_id: "x", name: "X" })),
      )

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) expect(result.left.reason).toMatch(/never answered/)
      expect(Date.now() - started).toBeLessThan(20_000)
    } finally {
      // `makeRelayHarness` keeps its `servers` array private and only tracks
      // relays it started itself, so this one closes its own listener.
      await new Promise<void>((r) => wss.close(() => r()))
    }
  }, 30_000)
```

- [x] **Step 2: Run it and watch it hang out**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/net -t "never answers"
```

Expected: FAIL on the 30s test timeout — the effect never settles.

- [x] **Step 3: Bound the handshake**

In `packages/net/src/websocket.ts`, immediately after the `fail` helper is
defined (just before `ws.onopen = ...`), add the timer, and clear it in both
`succeed` and `fail`:

```ts
      // `connect` settles on the relay's `welcome`, not on the socket
      // opening, so a relay that completes the upgrade and then says nothing
      // would leave this pending forever — a player stuck on a spinner with
      // nothing to act on. Ten seconds is far past a LAN handshake and well
      // inside a player's patience.
      handshakeTimer = setTimeout(() => {
        fail("the relay accepted the connection but never answered")
        close()
      }, 10_000)
```

Declare it *above* `succeed`/`fail` so neither closure reads a binding in its
temporal dead zone, replacing the existing `let settled = false` line with:

```ts
      let settled = false
      let handshakeTimer: ReturnType<typeof setTimeout> | undefined
```

and clear it in both settle helpers:

```ts
      const succeed = () => {
        if (settled) return
        settled = true
        clearTimeout(handshakeTimer)
        resume(Effect.void)
      }
      const fail = (reason: string) => {
        if (settled) return
        settled = true
        clearTimeout(handshakeTimer)
        resume(Effect.fail(new TransportError({ reason })))
      }
```

- [x] **Step 4: Run the test**

```bash
nubx vitest run packages/net -t "never answers"
```

Expected: PASS in a little over 10 seconds.

- [x] **Step 5: Run the whole suite, to prove the timer never fires on a good relay**

```bash
nub run test
nub run typecheck
nub run lint
```

Expected: all 0, test count 103 (102 + this one).

- [x] **Step 6: Commit**

```bash
git add packages/net/src/websocket.ts packages/net/src/__tests__/websocket.test.ts
git commit -m "$(cat <<'EOF'
fix: give up on a relay that never answers the hello

Waiting for the welcome frame rather than the open event fixed a real
ordering bug, but left connect with no path out when a relay completes
the upgrade and then says nothing: the Effect.async stayed pending
forever and the player sat on a spinner. Bound it at ten seconds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
EOF
)"
```

---

### Task 4: Dispose the client a failed join actually created

`SessionProvider.close` closes over the `client` **state value from the render
that created the handler**. `JoinScreen.enter` calls `session.open()` (which
only `setClient`s), awaits, then calls `session.close()` on that same captured
value — so `dispose()` runs against the *previous* client and the one just
created is never disposed. The Effect audit claimed this path disposes the
client; it does not. Every `MatchClient` writes into the one shared
`clientStateAtom`, so an undisposed one is a live writer.

**Files:**
- Create: `packages/app-shell/src/app/client-slot.ts`
- Test: `packages/app-shell/src/app/__tests__/client-slot.test.ts`
- Modify: `packages/app-shell/src/app/session.tsx:41-93`

**Interfaces:**
- Consumes: `MatchClient` from `../store/match-client` (type only).
- Produces: `makeClientSlot<T extends { dispose: () => void }>(): ClientSlot<T>`
  with `{ readonly current: T | null; put(next: T): T; clear(): void }`.
  `put` disposes whatever it replaces; `clear` disposes the current one.
  `SessionValue.open` and `close` keep their existing signatures.

The lifecycle moves into a module of its own so the test drives the real code.
A test that models the bug locally would pass before and after the fix and
guard nothing.

- [x] **Step 1: Write the failing test**

Create `packages/app-shell/src/app/__tests__/client-slot.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { makeClientSlot } from "../client-slot"

const spy = (id: string, log: string[]) => ({ id, dispose: () => log.push(id) })

describe("makeClientSlot", () => {
  it("disposes what it replaces", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    slot.put(spy("first", log))
    slot.put(spy("second", log))
    expect(log).toEqual(["first"])
  })

  // The defect this exists for: JoinScreen opens a session and, on a failed
  // join, closes it — both inside one render. A handler closed over the
  // render's state value disposes the client from *before* the open, leaving
  // the one just created alive and still writing into the shared atom.
  it("clears the client put since the handler was built", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    slot.put(spy("before", log))
    log.length = 0

    const close = () => slot.clear() // captured now, called after the next put
    slot.put(spy("after", log))
    close()

    expect(log).toEqual(["after"])
    expect(slot.current).toBeNull()
  })

  it("is safe to clear twice", () => {
    const log: string[] = []
    const slot = makeClientSlot<{ id: string; dispose: () => void }>()
    slot.put(spy("only", log))
    slot.clear()
    slot.clear()
    expect(log).toEqual(["only"])
  })
})
```

- [x] **Step 2: Run it to verify it fails**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell -t "makeClientSlot"
```

Expected: FAIL — `Cannot find module '../client-slot'`.

- [x] **Step 3: Write the minimal implementation**

Create `packages/app-shell/src/app/client-slot.ts`:

```ts
/**
 * Holds the one live client, so whoever disposes it reads the current value
 * rather than one captured earlier.
 *
 * A React handler rebuilt each render closes over that render's state, and a
 * caller that opens and then closes within a single render — JoinScreen, on a
 * failed join — would dispose the client from before the open and leave the
 * new one running. Every MatchClient writes into the one shared atom, so an
 * abandoned one is a live writer, not just garbage.
 */
export interface ClientSlot<T extends { dispose: () => void }> {
  readonly current: T | null
  put: (next: T) => T
  clear: () => void
}

export const makeClientSlot = <T extends { dispose: () => void }>(): ClientSlot<T> => {
  let held: T | null = null
  return {
    get current() {
      return held
    },
    put: (next) => {
      held?.dispose()
      held = next
      return next
    },
    clear: () => {
      held?.dispose()
      held = null
    },
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
nubx vitest run packages/app-shell -t "makeClientSlot"
```

Expected: PASS, 3 tests.

- [x] **Step 5: Use the slot in the provider**

In `packages/app-shell/src/app/session.tsx`, import it and hold one in a ref:

```tsx
import { makeClientSlot } from "./client-slot"
```

```tsx
  const [client, setClient] = useState<MatchClient | null>(null)
  // The slot is the live value; the state is only what the tree renders from.
  // `open` and `close` are rebuilt every render, so reading `client` in them
  // disposes whatever was current when that render ran, not what is current
  // when they are called.
  const slot = useRef(makeClientSlot<MatchClient>())
```

and change the two handlers to go through it:

```tsx
    open: ({ role, seed, kind, config }) => {
      const fresh = slot.current.put(
        new MatchClient(
          transport(kind),
          { ...defaultConfig(seed), ...config },
          role,
          identity.playerId,
          registry,
        ),
      )
      setClient(fresh)
      return fresh
    },
    close: () => {
      slot.current.clear()
      setClient(null)
      for (const active of transports.current.values()) {
        Effect.runPromise(active.leave).catch(() => undefined)
      }
      transports.current.clear()
    },
```

`useRef` is already imported in this file. Note `slot.current` is the
`ClientSlot` itself (the ref's value), and `slot.current.current` would be the
held client — the provider never needs the latter.

- [x] **Step 6: Verify**

```bash
nub run typecheck
nub run test
nub run lint
```

Expected: all 0. Test count rises by 3.

- [x] **Step 7: Drive the real join path**

```bash
nub run build && nub run verify:ui
```

Expected: `No console errors, no page errors, no horizontal overflow.`
CLAUDE.md requires this after any UI change, and the Effect audit skipped it.

- [x] **Step 8: Commit**

```bash
git add packages/app-shell/src/app/client-slot.ts packages/app-shell/src/app/__tests__/client-slot.test.ts packages/app-shell/src/app/session.tsx
git commit -m "$(cat <<'EOF'
fix: dispose the client a failed join actually created

close() read the `client` state value captured when the handler was
built, but JoinScreen opens a session and closes it on failure within
one render — so dispose() ran against the previous client and the one
just created was never disposed, left writing into the shared atom.
Move the lifecycle into a slot held by a ref, so whoever disposes
reads the current value rather than one captured earlier.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
EOF
)"
```

---

### Task 5: Close the residual accept-loop shutdown race

`1d36bde` fixed the main race by tracking accepted streams in `pending`. A
narrower one survives: the accept loop reads `running`, *then* takes the state
lock to insert. A connection accepted in that window is missed by a concurrent
`shutdown` drain, and because the accept loop now blocks on the very mutex
`shutdown` holds, it tends to insert just after the drain. Measured at ~8000
sockets: 777 left without a FIN before the fix, 19 after.

The handoff's second suggested approach closes it: have `serve_client` observe
`running` itself. The ordering is airtight — `shutdown` stores `running=false`
*before* draining, and `serve_client` is spawned *after* the insert, so a
connection that missed the drain is one whose `serve_client` necessarily starts
after the store.

**Files:**
- Modify: `crates/lan-sync/src/host.rs:218-232` (the head of `serve_client`)
- Test: `crates/lan-sync/tests/session.rs`

**Interfaces:**
- Consumes: `Shared.running: AtomicBool`, already present at `host.rs:26`.
- Produces: no API change. `serve_client` gains an early return.

- [x] **Step 1: Write the failing test**

Add to `crates/lan-sync/tests/session.rs`:

```rust
/// A connection accepted in the window between `shutdown` storing `running`
/// and draining `pending` is not in that map, so the drain cannot reach it.
/// Hammering the accept path at the shutdown instant makes the window
/// reachable; every peer must still see the socket close rather than block
/// until its own read timeout.
#[test]
fn host_shutdown_closes_a_socket_accepted_during_the_drain() {
    // `session.rs` already imports TcpStream, Duration and the `local(port)`
    // helper at file scope, and reaches Host as `lan_sync::Host` rather than
    // importing it — match that rather than adding a second import style.
    use std::io::Read;

    let mut host = lan_sync::Host::bind("RACE", 0, 6).expect("bind");
    let port = host.port();

    let mut peers = Vec::new();
    for _ in 0..64 {
        if let Ok(stream) = TcpStream::connect(local(port)) {
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("timeout");
            peers.push(stream);
        }
    }

    host.shutdown();

    let mut wedged = 0;
    for mut peer in peers {
        let mut buf = [0u8; 1];
        match peer.read(&mut buf) {
            Ok(0) => {}            // clean EOF: the host closed it
            Ok(_) => {}            // sent something, then closed
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => {}
            Err(_) => wedged += 1, // WouldBlock: never closed at all
        }
    }

    assert_eq!(wedged, 0, "{wedged} sockets were never closed by shutdown");
}
```

- [x] **Step 2: Run it in a loop — a single pass may pass by luck**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync --test session host_shutdown_closes_a_socket_accepted_during_the_drain
BIN=$(cargo test -p lan-sync --test session --no-run --message-format=json 2>/dev/null \
  | python3 -c "import sys,json;[print(json.loads(l).get('executable')) for l in sys.stdin if l.strip().startswith('{') and json.loads(l).get('executable')]" | tail -1)
fails=0; for i in $(seq 1 40); do "$BIN" host_shutdown_closes_a_socket_accepted_during_the_drain --exact >/dev/null 2>&1 || fails=$((fails+1)); done
echo "failures: $fails / 40"
```

Expected: a non-zero failure count. Record it — Step 5 compares against it.

- [x] **Step 3: Have `serve_client` observe `running`**

In `crates/lan-sync/src/host.rs`, at the very top of `serve_client` — before
the `PendingClient` guard is built:

```rust
fn serve_client(shared: Arc<Shared>, stream: TcpStream, peer_addr: Option<SocketAddr>) {
    // The accept loop inserts into `pending` and only then spawns this, so a
    // connection that `shutdown`'s drain missed is necessarily one whose
    // thread starts after `running` was cleared — `shutdown` stores it before
    // taking the lock. Checking here is what closes that window: otherwise
    // this thread parks in `read_line` on a socket nobody will ever shut down,
    // and the peer waits out its own timeout instead of being told the host
    // went away.
    if !shared.running.load(Ordering::SeqCst) {
        let _ = stream.shutdown(Shutdown::Both);
        return;
    }

    let mut pending = PendingClient {
```

- [x] **Step 4: Run the loop again**

```bash
fails=0; for i in $(seq 1 40); do "$BIN" host_shutdown_closes_a_socket_accepted_during_the_drain --exact >/dev/null 2>&1 || fails=$((fails+1)); done
echo "failures after fix: $fails / 40"
```

Rebuild first (`cargo test -p lan-sync --test session --no-run`) so `$BIN` is
the fixed binary. Expected: 0.

- [x] **Step 5: Confirm the original test is still honest**

```bash
cargo test -p lan-sync
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all -- --check
for i in $(seq 1 60); do "$BIN" a_peer_notices_the_host_going_away --exact >/dev/null 2>&1 || echo "FAIL $i"; done; echo "loop done"
```

Expected: all green, no `FAIL` lines. Do **not** touch the
`pump_until(&peer, &mut sink, 0)` no-ops at `session.rs:32` and `:109` — the
fix belongs in `host.rs` and the test keeps its race.

- [x] **Step 6: Commit**

```bash
git add crates/lan-sync/src/host.rs crates/lan-sync/tests/session.rs
git commit -m "$(cat <<'EOF'
fix: close the socket accepted while shutdown was draining

Tracking accepted streams in `pending` closed the wide window but not
the narrow one: the accept loop reads `running` and only then takes
the lock to insert, so a connection accepted during the drain is
missed, and the loop now blocks on the very mutex shutdown holds, so
it tends to insert just after. serve_client observes `running` itself,
which is airtight because shutdown clears it before taking the lock
and serve_client is spawned after the insert.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
EOF
)"
```

---

### Task 6: Record the restructure in an ADR

`docs/adr/0014-nx-monorepo-not-adopted-yet.md` still reads *"Proposed —
requested by the user, deliberately not done"* while this branch does exactly
that. CLAUDE.md: *"Add one before implementing anything architectural, not
after."* The largest architectural change in the repo has no ADR recording its
costs, and the boundary lint added on top of it has none either.

**Files:**
- Create: `docs/adr/0018-nx-monorepo-adopted.md`
- Modify: `docs/adr/0014-nx-monorepo-not-adopted-yet.md` (Status line only)

**Interfaces:**
- Consumes: nothing.
- Produces: ADR 0018, referenced by Task 7's doc refresh.

- [x] **Step 1: Check the next free number and the house format**

```bash
ls docs/adr/ | sort | tail -5
head -30 docs/adr/0017-*.md
```

Expected: 0017 is the highest, so 0018 is free. Match 0017's section headings
exactly — Status / Context / Decision / Consequences, with costs stated plainly.

- [x] **Step 2: Write ADR 0018**

Create `docs/adr/0018-nx-monorepo-adopted.md`. It must record, as costs and
not as achievements:

- The tree is now `apps/{game-web,relay}` + `packages/{engine,net,render,ui,app-shell,tooling}`, with Rust unmoved at `crates/lan-sync` and `src-tauri`.
- **Cost:** three hand-maintained alias tables (`tsconfig.json:20-26`, `vitest.config.ts:7-16`, `apps/game-web/vite.config.ts:90-94`) that must be edited in lockstep, because no project has its own `package.json` and there is no workspace protocol.
- **Cost:** no sub-`package.json` means nub's isolated no-hoisting layout is *not* exercised per project — every dependency resolves from the flat root, so the phantom-dependency trap ADR 0017 bought is not in force inside `packages/`.
- **Cost:** every cargo check now runs through Nx, so the Rust CI job needs the whole JS toolchain installed to run `cargo fmt`.
- **Cost:** `packages/tooling` and `native/` are projects whose `sourceRoot` points outside themselves, so their Nx inputs are fictional; they are safe only while those targets stay `cache: false`.
- The boundary lint (`eslint.config.js`) is what makes the `layer:*` tags real, with one declared exception, `allow: ["@mutation/relay"]`, because Nx forbids importing an application and `lan-relay.mjs` is both the runnable relay and the sequencer the tests run against.
- **What it bought:** per-project test/typecheck/lint targets, and a graph that mechanically rejects the cycles that were previously invisible.

- [x] **Step 3: Supersede 0014**

Change only the Status line of `docs/adr/0014-nx-monorepo-not-adopted-yet.md`:

```markdown
## Status

Superseded by [ADR 0018](0018-nx-monorepo-adopted.md). This records why the
split was deferred at the time; it was carried out later under that ADR.
```

Leave the rest of 0014 intact — its reasoning is the record of why the delay
was right when it was written.

- [x] **Step 4: Verify the links resolve**

```bash
grep -n "0018" docs/adr/0014-nx-monorepo-not-adopted-yet.md
ls docs/adr/0018-nx-monorepo-adopted.md
grep -c "Cost" docs/adr/0018-nx-monorepo-adopted.md
```

Expected: the reference, the file, and at least five costs.

- [x] **Step 5: Commit**

```bash
git add docs/adr/
git commit -m "$(cat <<'EOF'
docs: record the Nx adoption and its costs in an ADR

ADR 0014 still said the split was deliberately not done while the
tree had already been split, and the boundary lint went in on top of
it with nothing recording either decision. 0018 states the costs —
three lockstep alias tables, no per-project package.json so nub's
no-hoisting trap is not in force inside packages/, cargo behind the
JS toolchain, two projects whose Nx inputs are fictional.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
EOF
)"
```

---

### Task 7: Make the written record match the tree

Every doc that names a source path still names the pre-split one, so the
commands they document fail. `docs/tooling.md` documents four `mise` tasks that
`mise.toml` does not implement, and the typecheck row is materially wrong — the
two commands cover different file sets. Tasks 4 through 7 are committed with
every checkbox unticked.

**Files:**
- Modify: `CLAUDE.md` (paths at :60, :68, :108, :120, :126, :142, :166, :179)
- Modify: `.github/copilot-instructions.md:48`
- Modify: `docs/tooling.md:217` and the command table at :295-302
- Modify: `docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md` (Tasks 4–7 checkboxes and notes)

**Interfaces:**
- Consumes: ADR 0018 from Task 6, cited by the CLAUDE.md architecture section.
- Produces: nothing later tasks depend on.

- [x] **Step 1: Find every stale path**

```bash
grep -rn "src/engine\|src/net/\|src/render\|src/app/\|src/store\|src/ui\|src/__tests__\|scripts/lan-relay" \
  CLAUDE.md README.md docs/*.md .github/copilot-instructions.md opencode.json | grep -v "packages/\|apps/"
```

Expected: hits in `CLAUDE.md`, `.github/copilot-instructions.md`,
`docs/tooling.md`. Use the verified rename map:

```
src/engine/**   -> packages/engine/src/**      src/net/**     -> packages/net/src/**
src/render/**   -> packages/render/src/**      src/ui/**      -> packages/ui/src/**
src/routes/**   -> packages/app-shell/src/routes/**
src/store/**    -> packages/app-shell/src/store/**
src/app/**      -> packages/app-shell/src/app/**
src/__tests__/drive-app.test.ts -> apps/game-web/__tests__/drive-app.test.ts
scripts/lan-relay.mjs -> apps/relay/lan-relay.mjs
scripts/drive-app.mjs -> UNCHANGED        crates/lan-sync/** -> UNCHANGED
```

- [x] **Step 2: Rewrite the paths, and the one command that fails**

Apply the map. `CLAUDE.md:68` documents a command that currently exits 1:

```bash
nubx vitest run packages/engine/src/__tests__/rules.test.ts
```

Also fix the heading text: `### Engine (src/engine/)` →
`### Engine (packages/engine/src/)`, and the same for Transport and Renderer.
Add a pointer to ADR 0018 in the Architecture preamble.

- [x] **Step 3: Fix the tooling.md command table**

`docs/tooling.md:295-302` claims `mise run typecheck` is
`nubx nx run game-web:typecheck`. `mise.toml:45` actually runs
`nubx tsc --noEmit`, and after Task 2 those cover deliberately different file
sets. Make the table match `mise.toml`, and note that the mise `typecheck` task
is the whole-tree one.

- [x] **Step 4: Verify every documented command actually runs**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/engine/src/__tests__/rules.test.ts; echo "exit=$?"
nubx vitest run -t "collapses a ladder into a snake"; echo "exit=$?"
cargo test -p lan-sync --test session >/dev/null; echo "exit=$?"
grep -rn "src/engine\|scripts/lan-relay" CLAUDE.md .github/copilot-instructions.md || echo "no stale paths left"
```

Expected: three zeros and the "no stale paths" line.

- [x] **Step 5: Tick the plan's Tasks 4–7**

In `docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md`, change
every `- [ ]` to `- [x]` under Tasks 4, 5, 6 and 7, and add a
`> **Task N done**` note under each in the style Tasks 1 and 3 already use.
Each note must record what the task did *not* anticipate — for Task 4: the
`publicDir` regression, the two cycles it hid rather than rejected, and that
its own verification step was never run; for Task 5: the `nubx`-on-a-bare-runner
CI break; for Tasks 6 and 7: the defects each audit left unflagged, naming this
plan as where they were fixed.

- [x] **Step 6: Commit**

```bash
git add CLAUDE.md .github/copilot-instructions.md docs/tooling.md docs/superpowers/plans/
git commit -m "$(cat <<'EOF'
docs: point the documentation at the tree that exists

Every doc naming a source path still named the pre-split one, so the
per-file command CLAUDE.md documents exited 1 and the delegated
reviewer's brief pointed at nothing. tooling.md documented four mise
tasks mise.toml does not implement. Tasks 4 through 7 were committed
with every checkbox unticked; tick them and record what each did not
anticipate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
EOF
)"
```

---

### Task 8: Config hygiene, and close out the handoff

The leftovers, each small and each verified rather than assumed.

**Files:**
- Modify: `apps/relay/project.json:8-9` (duplicate targets)
- Modify: `package.json` (raw scripts that bypass Nx)
- Modify: `tsconfig.json` (the alias asymmetry)
- Modify: `.gitignore:43-48`
- Modify: `docs/handoff.md` (thread 3, and the resume pointer)

**Interfaces:**
- Consumes: every earlier task — this one records them.
- Produces: the handoff a fresh session reads first.

- [x] **Step 1: Collapse the duplicate relay targets**

`apps/relay/project.json` defines `serve` and `relay` as byte-identical
commands. `package.json:19` calls `nx run relay:serve`. Keep `serve`, drop
`relay`, and confirm nothing else referenced it:

```bash
grep -rn "relay:relay" . --include=*.json --include=*.yml --include=*.md --include=*.toml | grep -v node_modules || echo "nothing referenced relay:relay"
```

- [x] **Step 2: Close the tsconfig alias asymmetry**

`tsconfig.json` declares only the wildcard `@mutation/engine/*`, while Vite and
Vitest key on the bare `@mutation/engine` — so `import x from "@mutation/engine"`
resolves at runtime and in tests but has no tsconfig path, and typechecks only
because nobody has written it.

**Close it by adding the bare specifiers to `paths`, not by deleting the Vite
aliases.** A Vite alias key is a *prefix* match: `"@mutation/engine"` is exactly
what resolves `@mutation/engine/types`. Deleting those keys breaks every
cross-package import in the repo. Add to `tsconfig.json`:

```json
      "@mutation/engine": ["./packages/engine/src/index.ts"],
```

only for packages that actually have a bare entry point. Check first:

```bash
for p in engine net render ui app-shell; do
  printf "%-10s " "$p"; ls packages/$p/src/index.ts 2>/dev/null || echo "(no index.ts — leave the wildcard alone)"
done
```

If no package has an `index.ts`, there is nothing to add and the asymmetry is
inert — record that in the handoff and move on rather than inventing entry
points. Keep `@mutation/relay` as it is: deliberately a bare specifier for one
file.

- [x] **Step 3: Define each command once**

`package.json` already delegates `icons` to `tooling:icons` and `relay` to
`relay:serve`, but `verify:ui` and `verify:ui:pages` still spell the raw
`node scripts/drive-app.mjs ...` out, while `packages/tooling/project.json`
defines `verify-ui` and `verify-ui-pages` targets that nothing invokes — the
same command written twice, free to drift. Point the scripts at the targets,
keeping the documented `nub run verify:ui` interface intact:

```json
    "verify:ui": "nx run tooling:verify-ui",
    "verify:ui:pages": "nx run tooling:verify-ui-pages",
```

Leave `preview` alone: it has no Nx target and adding one buys nothing.

- [x] **Step 4: Tidy .gitignore**

`.gitignore:43-45` gained three blank lines and `:48` lost its trailing
newline. Collapse to one blank line and restore the newline.

- [x] **Step 5: Verify everything still runs**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run lint && nub run typecheck && nub run test
nub run build && nub run verify:ui
rm -rf dist && PUBLIC_BASE_PATH=/snake-ladders nub run build && nub run verify:ui:pages
rm -rf dist && nub run build
cargo test -p lan-sync && cargo clippy -p lan-sync --all-targets -- -D warnings && cargo fmt --all -- --check
nubx nx run-many -t lint,typecheck,test,build --skip-nx-cache
nub run relay & sleep 2; kill %1
```

Expected: every one 0. The `verify:ui:pages` base must match the bundle's — a
root-base `dist` served at `/snake-ladders` fails for that reason alone.

- [x] **Step 6: Rewrite handoff thread 3 and the resume pointer**

Move every item this plan fixed out of "still open", leaving only what genuinely
remains. Update the "Resuming From This Checkpoint" section: with threads 2 and
3 closed, the next task is **Task 8** of the Nx/Nub/PWA plan (the shared relay
descriptor and QR transport phase), and open thread 1 — a relay the deployed PWA
can reach over `wss://` — is its blocking prerequisite.

- [x] **Step 7: Commit and push**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: tidy the leftover config and close out the split's threads

Byte-identical duplicate relay targets, three alias tables that
disagreed about bare specifiers, and stray .gitignore whitespace.
Handoff threads 2 and 3 are closed; the resume pointer names Task 8.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
EOF
)"
git push -u origin claude/snake-ladders-cross-device-3uu177
```

---

## Notes for the executor

- **Task 5 is the one to be careful with.** A single `cargo test` pass proves
  nothing about a race; loop the test binary directly, which is the whole
  lesson of the original defect. Record the before-count and the after-count.
- **Task 3 and Task 4 touch code the Effect audit already changed.** Read
  `docs/audits/2026-09-13-effect-audit.md` first so you are fixing what it
  missed rather than reverting what it got right — the `welcome`-frame ordering
  fix is correct and must stay.
- **Tasks 1, 2, 6, 7 and 8 are independent of each other** and of 3–5. Tasks 3,
  4 and 5 are independent too. Only Task 8 depends on the rest, because it
  records them.
- `nub run verify:ui:pages` needs a bundle built with `PUBLIC_BASE_PATH`. Running
  it against a root-base `dist` fails with `home: []` and a click timeout, and
  that is operator error, not a regression.
- `verify:ui` has a known cold-start flake — `home: []` then a 30s timeout on
  the "Pass and play" button. Re-run once before investigating; two clean runs
  is the bar.
