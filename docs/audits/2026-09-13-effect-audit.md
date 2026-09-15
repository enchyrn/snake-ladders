# Effect Runtime Boundary Audit

Date: 2026-09-13
Scope: `packages/net` and `packages/app-shell`, including their moved tests.

## Boundary Inventory

- The engine remains a pure reducer. Effect is used by `MatchClient` only to
  run the engine's synchronous `Either` result; no Effect runtime state was
  added to `packages/engine`.
- `TransportService` exposes typed `Effect.Effect<..., TransportError>` values.
  `LanTransport` wraps Tauri invokes with `Effect.tryPromise`, while local and
  WebSocket transports use synchronous effects or `Effect.async` at the
  platform boundary.
- There are no Effect schemas in the audited packages. Action validation stays
  in the engine's action codec, and the transport encodes actions before they
  cross a platform boundary.
- Layers are construction-only (`Layer.sync`). No long-lived Effect runtime,
  fiber, scope, or service state was introduced into the deterministic path.
- WebSocket cleanup is returned from `Effect.async`; `leave` clears handlers
  before closing the socket. Tauri event listeners are detached by `leave`.

## Findings

### Correctness

**Fixed: WebSocket join completed before catch-up history was delivered.**

`makeWebSocketTransport` previously resumed `join` from `onopen`, although the
relay sends the `welcome` frame, including the historical log, only after the
hello frame. `JoinScreen` then created `MatchClient` after `join` completed.
That allowed a late joiner's commits, and its connected status, to be emitted
before the client subscribed. The new regression test reproduces this with a
pre-existing commit and failed before the fix.

`join` now resolves after the welcome log is emitted and fails on a rejected or
pre-welcome socket. `JoinScreen` opens the client before joining and closes the
provisional session on failure. The focused transport and client suites pass.

**No change: ordered commit folding is correct.** `MatchClient` buffers gaps,
drains only contiguous sequence numbers, ignores duplicates below `nextSeq`,
and distinguishes undecodable frames from reducer rejection. Existing tests
cover gap, duplicate, late-commit, and refusal behavior.

### Ownership

**Fixed: handshake data now has an owner before it can be emitted.** The
`MatchClient` owns subscriptions before `join` starts, and the transport owns
the socket until its Effect scope is interrupted or `leave` runs.

**Accepted risk: LAN event listeners are installed by transport construction,
not by an Effect resource scope.** This matches the Tauri `listen` API and the
session cache guarantees a normal `SessionProvider.close` calls `leave`.
Changing this to a scoped resource would require changing the public transport
interface and native lifecycle without a testable webview boundary. It remains
a release risk if a caller constructs a LAN transport and abandons it without
calling `leave`.

### Cancellation and Concurrency

**Fixed: WebSocket handshake failures are no longer represented by a successful
`join` followed by an asynchronous status event.** A refusal, connection error,
or close before welcome settles the join's typed error channel. A `settled` guard
prevents multiple WebSocket callbacks from resuming the same Effect.

**No change: deliberate close does not report a false network loss.** Cleanup
removes handlers before `close`, and a superseded socket ignores its close
event. The existing live-relay tests cover this behavior indirectly through
repeated transport cleanup.

**Residual risk: `SessionProvider.close` starts `leave` with
`Effect.runPromise` without awaiting it.** The public close callback is
synchronous and callers navigate immediately. A rapid close/open could race a
native `net_leave` with the next native operation. No production change was
made because the native command boundary has no app-shell test double and the
correct fix likely requires an async session transition API. This should be
covered before native cross-device release testing.

### Allocation

**No change: allocations are proportionate to the contracts.** The event bus
copies its listener set before notification so unsubscribe-during-notification
is safe. The commit gap buffer is a `Map` keyed by sequence number and deletes
entries as they fold. Replacing either with clever shared mutable state would
increase lifecycle risk and could compromise deterministic folding.

**Residual risk: an indefinitely missing sequence number can retain later
commits.** The transport protocol is expected to provide a reliable ordered
log, and no timeout policy exists in the current product contract. Adding one
would need a user-visible recovery state and protocol-level evidence, so it was
rejected as out of scope for this audit.

### No-Change Decisions

- `Effect.runSync` around pure engine effects is retained. It does not add
  runtime state to the engine and makes reducer rejection synchronous at the
  client boundary.
- `Effect.either` at UI and client call sites is retained so typed transport
  reasons are shown instead of Effect's `FiberFailure` representation.
- The local transport remains asynchronous via `queueMicrotask`; this keeps
  pass-and-play subject to the same commit timing contract as network play.
- No Effect runtime or service dependency was moved into `packages/engine`.
- No stylistic conversion to generators, scopes, or managed resources was
  made without a behavior or ownership benefit.

## Accepted Changes

1. Wait for WebSocket `welcome` before successful `join` completion; fail the
   typed Effect on handshake refusal or pre-welcome failure.
2. Construct the app-shell match client before starting the join handshake and
   dispose it when joining fails.
3. Add regression coverage for late-join history and update refusal coverage
   to assert the typed failure channel.

## Rejected Optimizations

- Do not introduce a global Effect runtime or fiber supervision into the
  engine. It would violate the pure deterministic reducer boundary.
- Do not replace the event bus with a replaying or globally retained stream.
  The lifecycle ordering fix gives the client ownership at the right time and
  avoids retaining match history in every transport instance.
- Do not make `SessionProvider.close` fire-and-forget behavior appear awaited
  by adding arbitrary delays. The remaining race needs an explicit async API or
  a native command contract, not timing padding.

## Verification

Checks completed during the audit:

- WebSocket transport suite: 14 passed.
- WebSocket transport plus app-shell MatchClient suites: 23 passed.
- Engine determinism suite: 9 passed.
- All moved transport tests: 28 passed.
- Full TypeScript suite: 102 passed across 9 files.
- Strict TypeScript typecheck: passed.
- Production build: passed; 872 modules transformed.

The Rust relay remains outside this Task 6 scope; its intermittent
host-shutdown defect is already tracked for the Rust audit.

## Residual Risks

- Unawaited native `leave` can race a new native session.
- A LAN transport abandoned without `leave` can retain Tauri listeners.
- A permanent protocol gap can retain buffered commits indefinitely.
- Native webview command behavior is not covered by app-shell tests in this
  container.