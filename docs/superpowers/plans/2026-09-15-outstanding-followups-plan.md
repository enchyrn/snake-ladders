# Outstanding Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four codeable follow-ups left by the Nx split remediation — the
`peer_addr()` hole in the Rust accept loop, CI's missing whole-tree typecheck, the
hand-written `.mjs` type casts, and `JoinScreen`'s unguarded join buttons.

**Architecture:** Four independent tasks, no shared interfaces. Task 1 is Rust and
touches nothing else; Tasks 2 and 3 both edit `tsconfig.json` and so must run in
order; Task 4 is React plus one new pure module. Each lands its own commit.

**Tech Stack:** Rust (std only, no new crates), TypeScript 5 strict, vitest (node
environment), React 19, Nx targets driven through nub.

**Spec:** No separate design doc. This plan implements the five-item list under
"Follow-ups, in the order worth doing them" in `docs/handoff.md`, which is the
record of what the remediation left open and why. Follow-up 1 (the `wss://` relay
architecture) is **deliberately not in this plan** — it is an architecture decision
for the project owner, needs its own ADR, and blocks Task 8 of the Nx/Nub/PWA plan
rather than anything here.

## Global Constraints

- **Branch:** `claude/snake-ladders-cross-device-3uu177`. Never push elsewhere.
- **Package manager is nub, never npm.** `nubx` replaces `npx`. Every `nub`,
  `nubx` or `cargo` call needs `export PATH="$HOME/.local/share/mise/shims:$PATH"`
  first, in the same shell invocation.
- **Do not `cargo build` or `cargo check` `src-tauri/`.** It needs a webview
  toolchain this container does not have. `crates/lan-sync` is a separate
  workspace and builds fine.
- **The determinism contract** (see CLAUDE.md) is untouched by every task here.
  Nothing in this plan may add `Math.random`, `Date.now`, or unordered iteration
  to `packages/engine/src/**`.
- **Comments explain why, never what.** Match the density of the surrounding file.
  A comment restating the line below it is noise and will be rejected in review.
- **Commit trailers**, on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
  ```
- **No model identifier** in any code comment, doc, or other pushed artifact.
- Gates that must stay green at the end of every task: `nub run lint`,
  `nub run typecheck`, `nub run test`, and for Task 1 also
  `cargo test -p lan-sync`, `cargo clippy -p lan-sync --all-targets -- -D warnings`
  and `cargo fmt --all --check`.

---

### Task 1: Track every accepted socket, unconditionally

**Why this exists:** `Host::shutdown` closes what is in `state.pending`. The accept
loop only inserted into `pending` when *both* `stream.peer_addr()` and
`stream.try_clone()` succeeded, and then spawned `serve_client` regardless. A
connection that failed either one was served with no entry in the map, so
`shutdown`'s drain could never reach it — race or no race — and its peer sat in
`read_line` until its own timeout expired instead of being told the host had gone.
The key is the second half of the bug: `pending` is keyed by `SocketAddr`, and a
retiring connection's `Drop` removes by that key, so once the OS recycles a source
port a dead connection can evict a live one's entry.

**Read before starting:** open thread 2 in `docs/handoff.md`, and the doc comment
on `host_shutdown_closes_a_socket_accepted_during_the_drain` in
`crates/lan-sync/tests/session.rs:137-159`, which records how the neighbouring race
was measured.

**On TDD here — read this, it is not the usual shape.** There is no reachable red
step. `peer_addr()` and `try_clone()` fail on fd exhaustion and on sockets already
torn down; neither can be forced from an integration test without either a new
`socket2`/`libc` dependency or lowering `RLIMIT_NOFILE` on the whole test process,
and the source-port recycling that triggers the eviction half needs the ephemeral
range (~28k ports) to wrap inside the microseconds of a thread's teardown. **Do not
invent a red step, and do not report one.** The test below is a *guard* — it pins
the invariant so the conditional shape cannot come back — and it passes both before
and after the fix. Say exactly that in the commit message. The correctness argument
is by construction: registration becomes unconditional, and a stream that cannot be
registered is refused rather than served untracked.

**Files:**
- Modify: `crates/lan-sync/src/host.rs` — `HostState`, the accept loop in
  `Host::bind`, `serve_client`'s signature, `PendingClient`, plus a new
  `Host::pending_count`
- Test: `crates/lan-sync/tests/session.rs` — one new test and one helper

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Host::pending_count(&self) -> usize`, `#[doc(hidden)]`. No other task
  uses it; it exists for the test.

- [x] **Step 1: Write the guard test**

Add this helper just below `pump_until` in `crates/lan-sync/tests/session.rs`:

```rust
/// Poll a predicate until it holds, or time out. Accept runs on the listener
/// thread, so a count settles shortly after `connect` returns rather than with
/// it; sleeping a fixed amount instead would be either flaky or slow.
fn wait_for(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline && !predicate() {
        std::thread::sleep(Duration::from_millis(5));
    }
}
```

and this test at the end of the file:

```rust
/// `shutdown` can only close what `pending` holds, so every accepted socket has
/// to be in there before its thread is spawned, and has to leave once its
/// handshake completes.
///
/// This is a guard, not a reproduction. The hole it protects against was
/// structural: registration used to be conditional on `peer_addr()` and
/// `try_clone()`, and a failure of either served the connection with nothing in
/// the map. Neither can be forced to fail from a test without a new dependency
/// or an rlimit stunt on the whole process, so this passes against the unfixed
/// host too. What it catches is the conditional shape being reintroduced.
#[test]
fn every_accepted_socket_is_tracked_until_its_handshake_completes() {
    let host = lan_sync::Host::bind("TRACK", 0, 4).expect("host should open");
    let port = host.port();

    // Connect and say nothing: accepted, spawned, and parked in `read_line`.
    let silent: Vec<TcpStream> = (0..3)
        .map(|_| TcpStream::connect(local(port)).expect("peer should connect"))
        .collect();
    wait_for(|| host.pending_count() == 3);
    assert_eq!(
        host.pending_count(),
        3,
        "every accepted socket must be tracked before its thread is spawned"
    );

    // Now one that does handshake. Wait for it to be tracked *before* sending
    // hello: connect-then-immediately-hello would race registration against
    // retirement, and a count that read 3 throughout would prove nothing —
    // it cannot tell "not accepted yet" from "accepted and retired".
    let mut joiner = TcpStream::connect(local(port)).expect("peer should connect");
    wait_for(|| host.pending_count() == 4);
    assert_eq!(
        host.pending_count(),
        4,
        "a connection must be tracked before its handshake, not after"
    );

    // A completed handshake retires its own entry. Without that the map grows
    // for the life of the room and `shutdown` works through sockets long gone.
    let hello = json!({"t": "hello", "player_id": "bo", "name": "Bo"});
    writeln!(joiner, "{hello}").expect("hello should be sent");
    wait_for(|| host.pending_count() == 3);
    assert_eq!(
        host.pending_count(),
        3,
        "a peer through its handshake must not stay pending"
    );

    drop(silent);
}
```

The counts go 3 → 4 → 3, and every step of that sequence matters. If it never
reaches 4, registration is conditional again. If it never comes back to 3,
`complete()` is not firing and `pending` grows for the life of the room.

- [x] **Step 2: Run it and watch it fail to compile**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync --test session every_accepted_socket
```

Expected: a compile error, `no method named 'pending_count' found for struct 'Host'`.
This is a compile failure, not a behavioural red — see the TDD note above.

- [x] **Step 3: Key `pending` by a number the host hands out**

In `crates/lan-sync/src/host.rs`, replace the `pending` field in `HostState` and
add a counter beside it:

```rust
    /// Accepted sockets that have not finished a handshake, keyed by a number
    /// this host hands out rather than by peer address. Two connections can
    /// share an address once the OS recycles a source port, and then a
    /// retiring connection's `Drop` evicts the live one's entry — leaving it
    /// invisible to `shutdown`'s drain.
    pending: HashMap<u64, TcpStream>,
    next_pending_id: u64,
```

- [x] **Step 4: Make registration unconditional in the accept loop**

Replace the whole `Ok(stream) => { ... }` arm in `Host::bind` with:

```rust
                    Ok(stream) => {
                        // Registration must not be conditional on anything that
                        // can fail independently of the connection being live.
                        // `peer_addr()` and `try_clone()` both can, and either
                        // one failing used to drop the stream into
                        // `serve_client` with no entry in `pending` — so
                        // `shutdown`'s drain could never reach it, race or no
                        // race, and the peer waited out its own read timeout
                        // instead of being told the host had gone. A stream
                        // that cannot be registered is refused here rather than
                        // served untracked.
                        let registered = stream.try_clone().ok().and_then(|registry| {
                            let mut state = listener_inner.state.lock().ok()?;
                            let id = state.next_pending_id;
                            state.next_pending_id += 1;
                            state.pending.insert(id, registry);
                            Some(id)
                        });
                        let Some(id) = registered else {
                            let _ = stream.shutdown(Shutdown::Both);
                            continue;
                        };
                        let per_client = Arc::clone(&listener_inner);
                        thread::spawn(move || serve_client(per_client, stream, id));
                    }
```

- [x] **Step 5: Carry the id through `serve_client` and `PendingClient`**

Change `serve_client`'s signature and its guard construction:

```rust
fn serve_client(shared: Arc<Shared>, stream: TcpStream, pending_id: u64) {
    let mut pending = PendingClient {
        shared: Arc::clone(&shared),
        id: Some(pending_id),
    };
```

Leave the long comment about the `running` check and the guard ordering exactly as
it is — it documents a different fix and is still accurate.

Then replace the `PendingClient` struct and its `complete`:

```rust
struct PendingClient {
    shared: Arc<Shared>,
    id: Option<u64>,
}

impl PendingClient {
    fn complete(&mut self) {
        if let Some(id) = self.id.take() {
            if let Ok(mut state) = self.shared.state.lock() {
                state.pending.remove(&id);
            }
        }
    }
}
```

`impl Drop for PendingClient` is unchanged.

- [x] **Step 6: Add the observability seam**

In `impl Host`, directly below `pub fn log_len`:

```rust
    /// Sockets accepted but not yet through a handshake. Exposed so a test can
    /// pin that every accepted connection is tracked, which is the property
    /// `shutdown`'s drain rests on.
    #[doc(hidden)]
    pub fn pending_count(&self) -> usize {
        self.inner.state.lock().map(|s| s.pending.len()).unwrap_or(0)
    }
```

- [x] **Step 7: Drop the now-unused import**

`SocketAddr` was only used for the `pending` key and `serve_client`'s parameter.
Change the import at the top of `host.rs` to:

```rust
use std::net::{Shutdown, TcpListener, TcpStream};
```

If clippy reports it still in use, leave it — check the error rather than assuming.

- [x] **Step 8: Run the new test, then the whole crate**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync --test session every_accepted_socket
cargo test -p lan-sync
```

Expected: the new test passes, and so do all the existing ones — in particular
`host_shutdown_closes_a_peer_still_in_handshake` and
`host_shutdown_closes_a_socket_accepted_during_the_drain`, which are the two that
would notice this change going wrong. Paste the real output; do not summarise it.

- [x] **Step 9: Clippy and fmt**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all
```

Expected: clippy clean. If `fmt` changes anything, include it in the commit.

- [x] **Step 10: Run the drain race test at power**

The neighbouring race test is probabilistic and this change rewrites the code
underneath it, so confirm it did not get weaker:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
BIN=$(cargo test -p lan-sync --test session --no-run --message-format=json \
  | sed -n 's/.*"executable":"\([^"]*\)".*/\1/p' | tail -1)
fails=0; for _ in $(seq 1 40); do "$BIN" \
  host_shutdown_closes_a_socket_accepted_during_the_drain --exact \
  >/dev/null 2>&1 || fails=$((fails+1)); done; echo "$fails / 40"
```

Expected: `0 / 40`. Anything else is a regression — stop and report the number
rather than re-running until it reads zero.

- [x] **Step 11: Commit**

```bash
git add crates/lan-sync/src/host.rs crates/lan-sync/tests/session.rs
git commit -F- <<'MSG'
fix: track every accepted socket, whatever peer_addr says

`shutdown` closes what `pending` holds, and the accept loop only inserted
there when both `peer_addr()` and `try_clone()` succeeded — while spawning
`serve_client` either way. A connection that failed either one was served
with no entry in the map, so the drain could never reach it and its peer
waited out its own read timeout rather than being told the host had gone.

Registration is now unconditional and keyed by a number the host hands out.
The address key was the second half of the bug: once the OS recycles a
source port, a retiring connection's `Drop` evicts a live one's entry. A
stream that cannot be registered at all is refused rather than served
untracked.

The new test is a guard, not a reproduction — it passes against the unfixed
host too. Neither `peer_addr()` nor `try_clone()` can be made to fail from a
test without a new dependency or an rlimit stunt on the whole process, so
what it catches is the conditional shape coming back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**Completion note:** landed as `0d85c8e`. Everything went as the brief
predicted — Step 2's compile error named `peer_addr()` verbatim, and Step 10's
race-test loop came back `0 / 40` on the first run, no re-runs needed. One
thing the brief didn't anticipate: the commit first carried the implementing
agent's own attribution rather than the one the Global Constraints name, on
the reasoning that a standing session reminder overrides a brief's literal
text. A review round corrected it by amend: the constraint's exact trailer
string is the one that has to match across every commit on this branch,
whichever agent authors the work. The code itself was approved unchanged —
the amend touched only the trailer.

---

### Task 2: Give CI a whole-tree typecheck

**Why this exists:** CI runs `nx run-many -t typecheck`, which runs each project's
own `tsconfig.json`. Files outside every project's include list therefore have no
typechecker at all. The root `tsconfig.json` is the whole-tree one, and its
`include` is **stale**: it lists `"vite.config.ts"`, which the Nx split moved to
`apps/game-web/vite.config.ts`, and it does not list `vitest.config.ts`, which is
at the root and defines every path alias the suite resolves through. So the one
file that decides how tests resolve imports is currently unchecked.

**Files:**
- Modify: `tsconfig.json` — the `include` array
- Modify: `.github/workflows/ci.yml` — one step in the `web` job

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks reference. Task 3 also edits `tsconfig.json`, so run
  this task first.

- [x] **Step 1: Prove the gap with a deliberate error**

```bash
cd /home/user/snake-ladders
cp vitest.config.ts /tmp/vitest.config.ts.bak
printf '\nexport const broken: string = 42\n' >> vitest.config.ts
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run typecheck
```

Expected: **exit 0**. The whole-tree typecheck does not see the file. That is the
gap, and it is the red step.

- [x] **Step 2: Fix the include list**

In `tsconfig.json`, replace the `include` line with exactly this:

```json
  "include": ["apps", "packages", "vitest.config.ts"]
```

`"vite.config.ts"` is dropped because no such file exists at the root any more.
Do not add `"scripts"`: it holds `.mjs` only and `allowJs` is off, so the entry
would match nothing while implying the scripts are checked.

`apps/game-web/vite.config.ts` is already covered by `"apps"`.

- [x] **Step 3: Re-run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run typecheck
```

Expected: FAIL, `vitest.config.ts(...): error TS2322: Type 'number' is not
assignable to type 'string'.`

- [x] **Step 4: Restore the file and confirm green**

```bash
cp /tmp/vitest.config.ts.bak vitest.config.ts
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run typecheck
```

Expected: exit 0, no output beyond the `$ tsc --noEmit` echo. Confirm
`git diff --stat vitest.config.ts` is empty before moving on.

- [x] **Step 5: Add the step to CI**

In `.github/workflows/ci.yml`, in the `web` job, insert this **after** the
`nub run lint` step and **before** the `run-many` step:

```yaml
      # `run-many -t typecheck` runs each project's own tsconfig, so anything
      # outside every project's include list has no typechecker at all. This is
      # the root config, which covers the tree as one program — including
      # vitest.config.ts, where every alias the suite resolves through lives.
      - run: nub run typecheck
```

- [x] **Step 6: Check the workflow parses**

```bash
cd /home/user/snake-ladders
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"
```

Expected: `ok`. If PyYAML is missing, use
`node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8')"` and read
the file back instead — do not skip the check silently, say which one you ran.

- [x] **Step 7: Run the full gates**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run lint && nub run typecheck && nub run test
```

Expected: lint clean, typecheck clean, 111 tests passing, exit 0.

- [x] **Step 8: Commit**

```bash
git add tsconfig.json .github/workflows/ci.yml
git commit -F- <<'MSG'
ci: typecheck the whole tree, not just each project

`run-many -t typecheck` runs each project's own tsconfig, so a file outside
every project's include list has no typechecker at all. The root config is
the whole-tree one and its include was stale: it named a root vite.config.ts
the Nx split had already moved into apps/game-web, and it left out
vitest.config.ts — the file that defines every alias the suite resolves
through, and so the last one that should go unchecked.

Verified by appending a type error to vitest.config.ts: exit 0 before the
include was fixed, TS2322 after.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**Completion note:** landed as `ac57ebc`. Went exactly to plan — the red step
(Step 1) reproduced the gap as an exit-0 with no diagnostic, precisely
because the whole-tree config never saw the deliberately-broken file, and the
fix flipped it to `TS2322` on the next run. 111 tests passing at this point,
as the brief's own reviewer note predicted for the state before Task 4.

---

### Task 3: Declare the two `.mjs` modules instead of casting them

**Why this exists:** Three test files import plain `.mjs` modules through a
`@ts-expect-error` and then hand-write the shape they expect. `harness.ts` casts
`startRelay`'s return to a four-field literal — and that shape has *already* drifted
once this session, gaining the `port` getter and `listening` during the port-0 fix.
A cast cannot notice that; a declaration can.

**Verified mechanics — do not re-derive these, they were established experimentally:**
- A `paths` entry pointing at `apps/relay/lan-relay.mjs` resolves that exact file,
  and with `allowJs` off TypeScript treats it as untyped. Adding a sibling
  `lan-relay.d.ts` **or** `lan-relay.d.mts` does **not** help — both were tried and
  both still gave TS7016.
- Pointing the `paths` entry **straight at the `.d.ts`** does work, and enforces the
  declared types.
- The wildcard `"@mutation/tooling/*": ["./scripts/*"]` **does** pick up
  `scripts/drive-app.d.ts` with no tsconfig change, but only for an import written
  *without* the extension. `drive-app.test.ts` currently imports
  `@mutation/tooling/drive-app.mjs`, so the extension has to come off.
- Dropping that extension is safe at runtime: vitest resolves
  `@mutation/tooling/drive-app` through the alias and `.mjs` is first in Vite's
  default `resolve.extensions`. Confirmed by running the suite — 3 tests passed.

**Files:**
- Create: `apps/relay/lan-relay.d.ts`
- Create: `scripts/drive-app.d.ts`
- Modify: `tsconfig.json` — the `@mutation/relay` paths entry only
- Modify: `packages/net/src/__tests__/harness.ts` — drop the directive and the cast
- Modify: `packages/net/src/__tests__/relay.test.ts` — drop the directive
- Modify: `apps/game-web/__tests__/drive-app.test.ts` — drop the directive and the
  `.mjs` from the specifier

**Interfaces:**
- Consumes: Task 2's corrected `include`. Run after Task 2.
- Produces: `RelayHandle`, `Sequencer`, `startRelay`, `serveDist` as named below.
  Nothing outside the three test files uses them.

- [x] **Step 1: Write the relay declaration**

Create `apps/relay/lan-relay.d.ts`:

```ts
/**
 * Types for `lan-relay.mjs`, which is plain JavaScript and stays that way: it
 * is the one file a player may be asked to run with bare `node`, so it has no
 * build step.
 *
 * `tsconfig.json` points `@mutation/relay` at this file rather than at the
 * `.mjs`, because a `paths` entry naming a concrete `.mjs` resolves that file
 * and, with `allowJs` off, reads it as untyped however the declaration beside
 * it is named. The vitest alias still points at the `.mjs` — that one resolves
 * the code that actually runs.
 */

export declare const PROTOCOL_VERSION: number

export declare const roomCode: (seed: number) => string

export declare const randomRoom: () => string

export interface RosterEntry {
  readonly player_id: string
  readonly name: string
  readonly connected: boolean
}

export interface SequencedEntry {
  readonly seq: number
  readonly action: unknown
}

export type JoinResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export declare class Sequencer {
  constructor(options?: { room?: string; capacity?: number })
  get room(): string
  get log(): SequencedEntry[]
  get locked(): boolean
  lock(): void
  roster(): RosterEntry[]
  join(client: {
    playerId: string
    name: string
    send: (frame: unknown) => void
  }): JoinResult
  submit(action: unknown): SequencedEntry
  leave(playerId: string): void
}

export declare const lanAddresses: () => string[]

export interface RelayHandle {
  readonly wss: { close: (cb?: () => void) => void }
  readonly sequencer: Sequencer
  /** Resolves once the socket has bound, which is when `port` is real. */
  readonly listening: Promise<void>
  /** The bound port — the OS's choice, when `port: 0` was asked for. */
  readonly port: number
}

export declare const startRelay: (options?: {
  port?: number
  room?: string
  capacity?: number
}) => RelayHandle
```

- [x] **Step 2: Write the drive-app declaration**

Create `scripts/drive-app.d.ts`:

```ts
/**
 * Types for the `serveDist` half of `drive-app.mjs`. The script is plain
 * JavaScript because it runs under bare `node` in CI and locally; only the
 * part the suite imports is declared here.
 */

export interface ServedDist {
  readonly server: import("node:http").Server
  readonly port: number
  readonly origin: string
}

export declare const serveDist: (options: {
  dist: string
  base?: string
  port?: number
  https?: boolean
}) => Promise<ServedDist>
```

- [x] **Step 3: Point `@mutation/relay` at the declaration**

In `tsconfig.json`, change only that one line:

```json
      "@mutation/relay": ["./apps/relay/lan-relay.d.ts"],
```

Leave `@mutation/tooling/*` alone — the wildcard already finds `scripts/drive-app.d.ts`.
Leave `vitest.config.ts` alone entirely; its aliases point at the runtime files and
must keep doing so.

- [x] **Step 4: Drop the directive and the cast from `harness.ts`**

In `packages/net/src/__tests__/harness.ts`, replace the import:

```ts
import { startRelay, type RelayHandle } from "@mutation/relay"
```

replace the `servers` declaration:

```ts
  const servers: RelayHandle[] = []
```

and replace the body of `relay` with:

```ts
  const relay = async (opts: { port?: number; room?: string; capacity?: number } = {}) => {
    const started = startRelay({ port: 0, room: "TEST", ...opts })
    await started.listening
    servers.push(started)
    return started
  }
```

Keep the `port: 0` comment above it as it is. The `@ts-expect-error` line and its
two comment lines go.

- [x] **Step 5: Drop the directive from `relay.test.ts`**

In `packages/net/src/__tests__/relay.test.ts`, replace the three lines

```ts
// @ts-expect-error -- a plain .mjs script with no type declarations; the
// shapes it produces are asserted below rather than typed.
import { Sequencer, startRelay } from "@mutation/relay"
```

with

```ts
import { Sequencer, startRelay, type RelayHandle } from "@mutation/relay"
```

change the `servers` declaration on line 15 to:

```ts
const servers: RelayHandle[] = []
```

and retype that file's own `relay` helper. It currently takes
`opts: Record<string, unknown>` and spreads it into the `startRelay` call, which
typechecked only while `startRelay` was `any`: spreading `unknown` values over
`port: 0` makes `port` itself `unknown`, and that is not assignable to the now-declared
`number | undefined`. No call site passes options — all five call `relay()` bare — so
this is a type-level break, not a behavioural one. Change the signature to match the
harness:

```ts
const relay = async (opts: { port?: number; room?: string; capacity?: number } = {}) => {
```

- [x] **Step 6: Drop the directive and the extension from `drive-app.test.ts`**

In `apps/game-web/__tests__/drive-app.test.ts`, replace

```ts
// @ts-expect-error -- plain .mjs with no type declarations
import { serveDist } from "@mutation/tooling/drive-app.mjs"
```

with

```ts
import { serveDist } from "@mutation/tooling/drive-app"
```

- [x] **Step 7: Typecheck**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run typecheck
```

Expected: exit 0. Two failure modes to read carefully rather than paper over:
- `Unused '@ts-expect-error' directive` means a directive was left behind — remove it.
- A mismatch between a declaration and how a test uses the value means the
  declaration is wrong. **Fix the declaration to match the `.mjs`**, never the test
  to match a wrong declaration. Re-read the `.mjs` and check.

- [x] **Step 8: Run the suite**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test
```

Expected: 111 passed, exit 0. A resolution failure here means the extensionless
specifier did not resolve at runtime; report it rather than putting `.mjs` back,
because that would need the separate tsconfig entry this step was chosen to avoid.

- [x] **Step 9: Lint**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run lint
```

Expected: clean. The boundary rule reads the project graph, and this task adds no
new project edges — both aliases already existed.

- [x] **Step 10: Commit**

```bash
git add apps/relay/lan-relay.d.ts scripts/drive-app.d.ts tsconfig.json \
  packages/net/src/__tests__/harness.ts packages/net/src/__tests__/relay.test.ts \
  apps/game-web/__tests__/drive-app.test.ts
git commit -F- <<'MSG'
types: declare the two .mjs modules instead of casting them

Three test files imported plain .mjs through a @ts-expect-error and then
hand-wrote the shape they expected. startRelay's shape has already drifted
once — it gained the `port` getter and `listening` when the fixed test ports
were replaced with port 0 — and a cast cannot notice that.

tsconfig points @mutation/relay straight at the .d.ts, because a paths entry
naming the .mjs resolves that file and reads it as untyped however the
declaration beside it is named; both .d.ts and .d.mts siblings were tried.
The tooling wildcard needs no change, but the specifier loses its .mjs so it
can match. vitest's aliases still point at the runtime files.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**Completion note:** landed as `68664ed`. The brief's `lan-relay.d.ts` text
for `join`'s `send` field (`send: (frame: unknown) => void`) did not typecheck
as written — an arrow-typed property is checked contravariantly under
`strictFunctionTypes`, so `unknown` as the declared parameter rejected every
caller's narrower handler type, which the brief's own literal text did not
anticipate. Fixed by re-deriving the real frame shapes `Sequencer.join` and
`#broadcast` actually pass to `send` from the `.mjs` source (a `SequencerFrame`
union) rather than falling back to method-shorthand bivariance over
`unknown`, since a real union is strictly more useful than either variance
trick applied to a type that asserts nothing. A related dead cast on
`seq.roster()` in `relay.test.ts`, left over from before `RosterEntry` existed,
was removed as trivial cleanup. 111 tests still passing.

---

### Task 4: Let only one join run at a time

**Why this exists:** `JoinScreen`'s room buttons start a join per tap with nothing
stopping a second. The correctness half of this was already fixed — `session.closeIf`
means a losing join can no longer tear down the winner's client or write its error
into a screen the player has left — so what is left is that a second tap opens a
second session for no reason. This is ergonomics, and the fix should be
correspondingly small.

**Design note, and the reason for a separate module:** the guard flag must not live
in `useState` alone. `enter` is `async` and reads the flag after an `await`, so a
state value would be the one captured when that closure was created — the same
stale-closure trap that `client-slot.ts` exists to avoid for the session handle.
The flag therefore lives in a closure and `useState` only mirrors it for rendering.
That split is what makes the logic testable in the node environment the suite runs
in: there is no jsdom and no `@testing-library` in this repo, and adding a browser
test environment for one ergonomic guard is out of scope for this task.

**Files:**
- Create: `packages/app-shell/src/app/once-at-a-time.ts`
- Create: `packages/app-shell/src/app/__tests__/once-at-a-time.test.ts`
- Modify: `packages/app-shell/src/routes/join.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `onceAtATime<A extends unknown[]>(run: (...args: A) => Promise<void>, report: (busy: boolean) => void): (...args: A) => Promise<void>`

- [x] **Step 1: Write the failing test**

Create `packages/app-shell/src/app/__tests__/once-at-a-time.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { onceAtATime } from "../once-at-a-time"

/** A promise plus the handles to settle it, so a test controls the timing. */
const deferred = () => {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("onceAtATime", () => {
  it("drops a call made while the first is still in flight", async () => {
    const gate = deferred()
    let calls = 0
    const guarded = onceAtATime(async () => {
      calls += 1
      await gate.promise
    }, () => {})

    const first = guarded()
    await guarded()
    expect(calls).toBe(1)

    gate.resolve()
    await first
    expect(calls).toBe(1)
  })

  it("runs again once the first has settled", async () => {
    let calls = 0
    const guarded = onceAtATime(async () => {
      calls += 1
    }, () => {})

    await guarded()
    await guarded()
    expect(calls).toBe(2)
  })

  it("reports busy around the call, in order", async () => {
    const gate = deferred()
    const reported: boolean[] = []
    const guarded = onceAtATime(async () => {
      await gate.promise
    }, (busy) => reported.push(busy))

    const running = guarded()
    expect(reported).toEqual([true])
    gate.resolve()
    await running
    expect(reported).toEqual([true, false])
  })

  // The screen would otherwise be wedged by the one outcome that most needs a
  // retry: a join that threw rather than returning a reason.
  it("clears after a rejection, and lets the caller see it", async () => {
    const reported: boolean[] = []
    let calls = 0
    const guarded = onceAtATime(async () => {
      calls += 1
      throw new Error("no")
    }, (busy) => reported.push(busy))

    await expect(guarded()).rejects.toThrow("no")
    expect(reported).toEqual([true, false])

    await expect(guarded()).rejects.toThrow("no")
    expect(calls).toBe(2)
  })

  it("passes its arguments through", async () => {
    const seen: Array<[string, number]> = []
    const guarded = onceAtATime(async (addr: string, seed: number) => {
      seen.push([addr, seed])
    }, () => {})

    await guarded("192.168.1.24:5000", 7)
    expect(seen).toEqual([["192.168.1.24:5000", 7]])
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell/src/app/__tests__/once-at-a-time.test.ts
```

Expected: FAIL — `Failed to resolve import "../once-at-a-time"`.

- [x] **Step 3: Write the module**

Create `packages/app-shell/src/app/once-at-a-time.ts`:

```ts
/**
 * Wrap an async action so a call made while one is still running is dropped
 * rather than started, and report the busy state so a caller can disable
 * whatever triggers it.
 *
 * The flag is a closure variable, not React state: the wrapped action is
 * `async` and reads the flag again after an `await`, where a state value would
 * be the one captured when the closure was created. `report` exists precisely
 * so rendering can still follow along — the same split as `client-slot.ts`,
 * for the same reason.
 */
export const onceAtATime = <A extends unknown[]>(
  run: (...args: A) => Promise<void>,
  report: (busy: boolean) => void,
): ((...args: A) => Promise<void>) => {
  let busy = false
  return async (...args: A) => {
    if (busy) return
    busy = true
    report(true)
    try {
      await run(...args)
    } finally {
      // `finally`, so a throw clears it too: the one outcome that most needs a
      // retry must not be the one that wedges the screen.
      busy = false
      report(false)
    }
  }
}
```

- [x] **Step 4: Run the test again**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/app-shell/src/app/__tests__/once-at-a-time.test.ts
```

Expected: PASS, 5 tests.

- [x] **Step 5: Wire it into `JoinScreen`**

In `packages/app-shell/src/routes/join.tsx`:

Add `useMemo` and `useRef` to the React import:

```ts
import { useEffect, useMemo, useRef, useState } from "react"
```

Add `onceAtATime` to the local imports, beside the `hooks` import:

```ts
import { onceAtATime } from "../app/once-at-a-time"
```

Add the state beside `error`:

```ts
  const [joining, setJoining] = useState(false)
```

Rename the existing `enter` to `runEnter` — its body is unchanged, every line of
it, including both `session.closeIf` branches and the `navigate` call:

```ts
  const runEnter = async (addr: string, seed: number) => {
```

Then below it, add the guarded wrapper. It is held in a ref so it survives
re-renders — the roster query refetches once a second, and a wrapper rebuilt on
each render would carry a fresh `busy: false` every time and guard nothing:

```ts
  // Held across renders on purpose: the room list refetches about once a
  // second, and a wrapper rebuilt each render would start every tap with a
  // fresh `busy` flag and so guard nothing at all.
  const latest = useRef(runEnter)
  latest.current = runEnter
  const enter = useMemo(
    () => onceAtATime((addr: string, seed: number) => latest.current(addr, seed), setJoining),
    [],
  )
```

- [x] **Step 6: Disable both buttons while a join is in flight**

The room button's `disabled` gains the new term:

```tsx
              disabled={joining || room.locked || room.players >= room.capacity}
```

and the manual Join button gets one:

```tsx
        <button type="button" disabled={joining} onClick={enterManually}>
          Join
        </button>
```

`enterManually` needs no change — it calls `enter`, which is now the guarded one.

- [x] **Step 7: Typecheck and lint**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run typecheck && nub run lint
```

Expected: both clean. `noUnusedLocals` is on, so an import left dangling fails here.

- [x] **Step 8: Run the whole suite**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test
```

Expected: 116 passed (111 plus the 5 new), exit 0.

- [x] **Step 9: Drive the built app**

A disabled button that looks enabled is one of the three bugs this harness has
already caught in this repo, so check the rendering rather than assuming it.

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run verify:ui
```

Expected: clean — no console errors, no page errors, no horizontal overflow. If it
reports `log: []` and then times out on "nothing was narrated after rolling", that
is the known cold-start flake recorded in `docs/handoff.md`; re-run once before
treating it as real, and say in your report that you did.

- [x] **Step 10: Commit**

```bash
git add packages/app-shell/src/app/once-at-a-time.ts \
  packages/app-shell/src/app/__tests__/once-at-a-time.test.ts \
  packages/app-shell/src/routes/join.tsx
git commit -F- <<'MSG'
feat: let only one join run at a time

The room buttons started a join per tap with nothing stopping a second. The
correctness half was already closed — `closeIf` means a losing join cannot
tear down the winner's client or report into a screen the player has left —
so what was left was a second tap opening a second session for no reason.

The guard flag lives in a closure rather than in state: `enter` is async and
reads the flag after an await, where a state value would be the one captured
when the closure was built. State only mirrors it for rendering, and the
wrapper is held in a ref because the room list refetches about once a second
and a wrapper rebuilt each render would guard nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**Completion note:** landed as `ff07c79`. Went exactly to plan — RED failed
on the missing module as expected, GREEN passed 5/5 once `once-at-a-time.ts`
existed, and the wiring into `JoinScreen` needed no deviation from the
brief's code. Final suite: 116 tests (111 plus the 5 new
`once-at-a-time.test.ts` cases). `verify:ui` passed clean on the first run —
the known cold-start narration flake did not occur, so no re-run was needed.
Not anticipated by the brief: this task changes join semantics from "last tap
wins" to "second tap dropped" as an unavoidable consequence of the guard,
which review flagged as worth recording explicitly rather than leaving
implicit in the diff — see Task 5's handoff edit.

---

### Task 5: Retire the follow-ups in the record

**Why this exists:** `docs/handoff.md` is what a fresh session reads first, and it
currently lists all five follow-ups as outstanding. Four are now done. A handoff
that describes work already finished costs the next session the same rediscovery
the file exists to prevent.

**Files:**
- Modify: `docs/handoff.md` — the follow-ups list, open thread 2, and the
  "Deferred, and why" section
- Modify: `docs/superpowers/plans/2026-09-15-outstanding-followups-plan.md` — tick
  every checkbox and add completion notes

**Interfaces:** consumes the outcomes of Tasks 1–4. Run last.

- [x] **Step 1: Rewrite the follow-ups list**

Cut items 2 through 5. Item 1 — the `wss://` relay architecture — stays exactly as
it is, and becomes the only entry. Rewrite the section's opening paragraph so it
does not promise five items; it should say that one thing is outstanding, that it is
a decision rather than code, and that it blocks Task 8.

- [x] **Step 2: Close open thread 2**

Open thread 2 is the `peer_addr()` hole. Move it out of the open threads and into
the resolved record, keeping the mechanism description — it is the expensive part to
rediscover — and adding what closed it: unconditional registration keyed by a
host-issued number, and that no test can force `peer_addr()` or `try_clone()` to
fail, so the test that guards it is a guard rather than a reproduction.

- [x] **Step 3: Record what stayed deferred**

Add to "Deferred, and why", in the file's existing voice:
- **No component test environment.** There is no jsdom and no `@testing-library` in
  the repo, and the suite runs `environment: "node"`. `JoinScreen`'s guard is
  therefore tested through the pure `onceAtATime` module it was extracted into,
  and the rendering was checked by driving the built app. A real component test
  needs that environment added first, which is a decision worth taking on its own
  rather than as a side effect of an ergonomic fix.
- **`scripts/*.mjs` is still untypechecked.** The whole-tree `tsc --noEmit` now
  covers `apps`, `packages` and `vitest.config.ts`. The scripts are plain
  JavaScript and `allowJs` is off, so they are checked only where a `.d.ts` declares
  them — `drive-app.d.ts` does, for the one export the suite imports. Turning on
  `allowJs`/`checkJs` for `scripts/` would cover the rest and is untried.

- [x] **Step 4: Tick the plan**

In this plan file, change every `- [ ]` to `- [x]` and add a short note under each
task recording anything it did not anticipate. Be specific: a note saying "went
fine" is worth nothing to the next reader. In particular record the measured
`n / 40` from Task 1 Step 10 and the final test count.

- [x] **Step 5: Run every gate, and read the output**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run lint && nub run typecheck && nub run test && nub run build
cargo test -p lan-sync
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all --check
```

Expected: all clean; the build reports 13 precached entries. Paste the real numbers
into your report — the test count, the precache count, the clippy result. A claim
without the output behind it is the one thing this repo's conventions call out by
name.

- [x] **Step 6: Commit**

```bash
git add docs/handoff.md docs/superpowers/plans/2026-09-15-outstanding-followups-plan.md
git commit -F- <<'MSG'
docs: retire the four follow-ups this plan closed

Four of the five follow-ups are done, so the handoff should say so: a file
that lists finished work costs the next session exactly the rediscovery it
exists to prevent. The wss:// relay decision stays, because it is still a
decision and it still blocks Task 8.

Open thread 2 moves to the resolved record with its mechanism intact, and
two things that stayed deferred are written down: there is still no
component test environment, and scripts/*.mjs is typechecked only where a
.d.ts declares it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ab5eq33UdVVMWEjmMEgVUy
MSG
```

**Completion note:** `nub run lint`, `nub run typecheck` and
`cargo fmt --all -- --check` were all clean with no output; `nub run test`
reported 116 tests passing; `cargo test -p lan-sync` reported 22 (12 in
`relay.rs`, 10 in `session.rs`), all passing; `cargo clippy -p lan-sync
--all-targets -- -D warnings` finished with no warnings. `nub run build`'s
first run reported **14** precached entries, not 13 — but `dist/` still held
hashed chunk files from an earlier build in this session, and workbox's glob
picked those up alongside the fresh ones, doubling four icon entries. Deleting
`dist/` and rebuilding from clean gave 13 entries (1215.61 KiB) on two
consecutive runs, matching what the brief expected; the 14 was a stale-output
artifact of this run, not a regression, and is recorded here rather than
rounded away.

---

## Notes for the reviewer between tasks

- **Task 1 has no red step and that is correct.** If an implementer reports a
  failing-then-passing test for the `peer_addr()` hole, they have written something
  that does not test what they think. Read the test.
- **Tasks 2 and 3 both edit `tsconfig.json`.** Run them in order; do not dispatch
  them concurrently.
- **Test counts:** 111 before this plan, 116 after Task 4 (5 new in
  `once-at-a-time.test.ts`), plus one new Rust test in Task 1.
- **The `npx` in `src-tauri/project.json` is not a mistake.** Nothing in this plan
  touches it. If a subagent offers to "tidy" it to `nubx`, refuse — ADR 0017 and
  Actions run `34761512711` are why.
