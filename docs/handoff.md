# Handoff

**The live work is on the branch `claude/chrome-and-layout`, not on `main`.**
It is pushed to `origin` at `1a0f5a2`, seven commits ahead of `main` at
`ac1f114`, and `main` itself has not moved. Check that branch out before
anything else; everything below describing "state of `main`" is the history
that led to it, not the current tip.

Written so another session — or the same person on a different machine — can
pick it up without re-deriving anything. Start at **"Resuming From This
Checkpoint"** near the end.

`claude/snake-ladders-cross-device-3uu177`, which earlier revisions of this
file described, is abandoned and fully absorbed into `main`. Its four commits
are all upstream as equivalent patches. It still exists on `origin` only
because deleting a remote ref is refused from the cloud session — delete it
from a developer machine or the web UI.

## Current checkpoint (2026-09-15)

Pass-and-play is complete and playable, and the two Criticals the multi-seat
review raised are closed with regressions. The branch is ready to merge.

The multi-seat work arrived from another session as `25a09ac`. Its own handoff
note cited commit `ada4ab8`, which does not exist in this history — that was a
pre-rebase sha from that session's local clone, and `5f6f661` reconciled it.
Do not go looking for it.

**What `docs/superpowers/plans/2026-09-15-playable-cross-device-plan.md` closed
(Milestone A, Tasks 1–5):**

| Task | Commit | What it fixed |
|---|---|---|
| 1 | `94e03b4` | `loadProfiles` repaired the roster but never wrote it back, so the same junk was re-validated on every load; and it could return a roster with no owner, leaving the person holding the device with no seat at all. |
| 2 | `53c7b08` | `Leave` in the **lobby** now frees the seat and closes the gap. Mid-match it still keeps it — seats are the deterministic tiebreaker. |
| 3 | `33b5b5c` | Guests could be added but never removed, so every future local match auto-joined every guest ever created. |
| 4 | `c0a9f61` | The device now says whose turn it is, and can switch between the seats it owns — under `simultaneous` only the first was reachable. |
| 5 | `b9cb446` | Regressions for both inherited Criticals, plus the dead code the first fix left behind. |

**Gates, run on `b9cb446`:**

- `nub run test`: 166 passed, 16 files (was 152 at `5f6f661`).
- `nub run typecheck`: passed.
- `nub run lint`: passed.
- `cargo test -p lan-sync`: 24 passed.
- `nub run verify:ui`: **passed** — no console errors, no page errors, no
  horizontal overflow.

### Two corrections to what the previous checkpoint recorded

**`verify:ui` is not blocked in this container.** The previous note said
Playwright failed on a missing `libnspr4.so`. It does not: `drive-app.mjs`
already falls back to any Chromium under `PLAYWRIGHT_BROWSERS_PATH`, and build
1194 is installed at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and
launches fine. Playwright asks for build 1243 and refuses it by default, which
is what the fallback exists to absorb. **Run the UI gate; do not assume it is
unavailable.**

**Both Criticals were already fixed in `5f6f661`**, not left open. What was
missing was the evidence. All three regressions written for Task 5 passed on
first write, so each was checked against the defect it guards by reverting the
fix and confirming the test goes red. That is worth repeating for any test
written after the fix it covers.

### What driving the app found that reading it did not

The lobby roster shares its `.players` class with the match HUD, which wants a
wrapping horizontal strip. Once each row carried a remove button, six players
ran off the side of a phone — and `.add-player` had no styling at all. Neither
was visible in the source; both were obvious in a screenshot. This is the third
time on this branch that driving the built app found something review did not.

### Known, unfixed, and not this branch's

`dist/` has no `favicon.ico` and `index.html` links no icon of that name, so a
browser's default favicon request 404s. Harmless, pre-existing, and invisible to
`verify:ui` because the browser issues that request outside the page context.

### Milestone B: a browser can now join a natively hosted room

Done, and tested end to end in Rust. `crates/lan-sync/src/ws.rs` is a partial
RFC 6455 codec (`7d67d3c`) and `host.rs` now decides which protocol a client
speaks before reading its handshake (`4627d01`). One listener, two protocols.

| | |
|---|---|
| Codec | 13 tests, including the RFC's own worked accept-key example |
| Host | `a_browser_handshake_is_upgraded_and_welcomed`, and — the one that matters — `a_browser_and_a_native_peer_share_one_ordered_log` |
| Gates | `cargo test -p lan-sync` 39 passed, clippy clean under `-D warnings` |

Detection is on the **first byte**, not four. `fill_buf` blocks until one byte
is available and never waits to accumulate more, so a four-byte comparison can
read a short buffer and mistake a browser for a native peer. `G` and `{` cannot
collide.

The browser side needed no transport change: `relayUrl` already dials any
`host:port`, and `refuseInsecure` already explains the HTTPS refusal properly.
Only the copy changed, because "nearby devices" now includes browsers.

**What this does not do.** The deployed PWA on GitHub Pages still cannot join an
Android host, and nothing here changes that — an HTTPS page may not open a
`ws://` socket. The achievable pairing is a page served over plain HTTP on the
LAN. Open thread 1 is still open and still needs its own ADR.

**Still unverified, and only hardware can close it.** Two devices have not
played each other. CI builds the APK; it does not run it. The Rust tests prove
the host accepts a browser's framing on loopback — they do not prove an Android
build serves it over real Wi-Fi. Do not describe Android-to-browser cross-play
as proven.

**Next:** open thread 1 (the `wss://` decision), then the remaining threads.

Tasks 1, 3, 4, 5, 6 and 7 of the Nx/Nub/PWA plan are complete. Task 1 deployed
the PWA and it was opened on a real device; that deployment also settled a
question the plan had left open, and not in the direction anyone hoped — see
open thread 1. Task 3 moved the toolchain to Nub and Node 24, which is the base
Task 4's Nx migration sits on. Tasks 4 and 5 split the tree into `apps/` and
`packages/` and wrapped the native and deployment commands in Nx targets. Tasks
6 and 7 audited the Effect and Rust layers. Task 2 remains untouched and
hardware-blocked.

The Nx split (Tasks 4 and 5) shipped with real defects; a separate remediation
plan (`docs/superpowers/plans/2026-09-14-nx-split-remediation-plan.md`, commits
`1b498ec`..`4bfb495`) fixed all of them across eight tasks plus a final fix
wave, each independently committed and reviewed:

- **Restored the type gate.** `build` and `pages-build` had been reduced to a
  bare `vite build` by the split; `tsc --noEmit &&` is back in front of both,
  so Pages deploys and Tauri's `beforeBuildCommand` no longer ship with no
  typecheck (`1b498ec`).
- **CI typechecks the whole tree again.** `nx run-many` was scoped to
  `--projects=game-web`, which typechecked 39 production files and zero
  tests; that scope is gone (`1dbf238`).
- **The websocket handshake no longer hangs forever.** `connect` settles on
  the relay's `welcome` frame, and a relay that accepts the socket then says
  nothing left the Effect pending with no timeout. Bounded at 10s (`09d7f4c`),
  then hardened with a socket-identity guard after review found that an
  abandoned attempt's timer could otherwise silently close its *replacement*
  and kill a live match's transport with nothing emitted on `statuses`
  (`8b5b477`).
- **A failed join no longer disposes the wrong client.** `SessionProvider.close`
  read the `client` state value captured by the render that built the
  handler, so a failed join tore down the *previous* client while the new one
  kept writing into the shared atom. Lifecycle moved into a `ClientSlot` held
  in a ref (`5b0181d`).
- **A narrower version of the host-shutdown race is closed.** `serve_client`
  now observes `running` before it does anything else, and shuts its own
  socket down if the host is already stopping. Measured by looping the test
  binary directly (`cargo test` alone proves nothing about a race): 5 failures
  in 2000 runs before, 0 after; the strengthened regression test now detects a
  reintroduced regression about 20% of the time per run, up from roughly 0.8%
  (`6b7ccfd`, fixed in `9a1a519`). What this did *not* close was a further,
  structural gap in the same accept loop — see below for what closed it.
- **ADR 0018** records the Nx adoption and its costs; ADR 0014, which still
  called the migration "Proposed — deliberately not done" while this branch
  had already done it, is superseded (`982a9f2`).
- **Stale doc paths fixed and Tasks 4–7 ticked** with honest completion notes
  in `docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md`
  (`6753a55`).
- **Config hygiene** (this task, `HEAD`): the byte-identical duplicate
  `relay`/`serve` targets in `apps/relay/project.json` collapsed to one;
  `verify:ui`/`verify:ui:pages` now delegate to the `tooling:verify-ui{,-pages}`
  Nx targets instead of duplicating the `drive-app.mjs` invocation;
  `.gitignore`'s stray blank lines and missing trailing newline are fixed;
  and three stale paths left over from the split
  (`scripts/lan-relay.mjs` → `apps/relay/lan-relay.mjs` in
  `docs/playing-together.md`, `src/engine/` → `packages/engine/src/` in
  `docs/rules.md`) are corrected. The tsconfig alias asymmetry
  (`@mutation/engine/*` wildcard with no bare `@mutation/engine` path) turned
  out to be inert: none of `engine`, `net`, `render`, `ui` or `app-shell` has
  an `src/index.ts`, so there is no bare-specifier import for a missing path
  to break and nothing to add — inventing an entry point just to close the
  asymmetry would have been backwards.

A second plan (`docs/superpowers/plans/2026-09-15-outstanding-followups-plan.md`,
commits `0d85c8e`..`bdc0de7`) then closed four of the five items the
remediation plan's own follow-up list had left open, each independently
committed and reviewed, with a final whole-branch review and one fix wave
(`bdc0de7`) on top:

- **The structural hole in `host.rs`'s accept loop is closed** — this was
  open thread 2, distinct from the timing race the remediation plan's Task 5
  closed above, because it was never a race at all. When `stream.peer_addr()`
  or the subsequent `stream.try_clone()` failed, the accept loop still spawned
  the connection into `serve_client` — it just never inserted it into the
  `pending` map first. `shutdown`'s drain only walks `pending`, so a
  connection that took this path was unreachable to it regardless of timing:
  there was no race to lose, because it was never in the set being raced
  over. Registration is now unconditional, and `pending` is keyed by a
  host-issued `u64` rather than a `SocketAddr` — the address key was the
  second half of the bug, since once the OS recycles a source port a
  retiring connection's `Drop` could evict a live one's entry. A stream that
  cannot be registered at all is refused rather than served untracked. The
  new test, `every_accepted_socket_is_tracked_until_its_handshake_completes`,
  asserts the pending count goes 3 → 4 → 3 as three silent peers connect, a
  fourth handshakes, and it retires. It is a guard, not a reproduction, and
  says so in its own doc comment: neither `peer_addr()` nor `try_clone()` can
  be forced to fail from a test without a new dependency or an rlimit stunt
  on the whole process, so it passes against the unfixed host too. What it
  catches is the conditional shape coming back. The neighbouring race test,
  `host_shutdown_closes_a_socket_accepted_during_the_drain`, was re-run at
  power afterward — 40 loops of the compiled binary, 0 failures — to confirm
  the rewrite underneath it did not weaken it (`0d85c8e`).
- **CI typechecks the whole tree again, and for the right reason this time.**
  `nx run-many -t typecheck` runs each project's own `tsconfig.json`, so a
  file outside every project's include list has no typechecker at all. The
  root `tsconfig.json` is the whole-tree one, and its own `include` had gone
  stale: it named a root `vite.config.ts` the Nx split had already moved into
  `apps/game-web`, and it omitted `vitest.config.ts` — the file that defines
  every path alias the suite resolves through, and so the last file that
  should go unchecked. `include` is now `["apps", "packages",
  "vitest.config.ts"]`, and CI runs `nub run typecheck` beside the existing
  `run-many` step. Verified by appending a type error to `vitest.config.ts`:
  exit 0 before the fix, `TS2322` after (`ac57ebc`).
- **The two hand-cast `.mjs` modules are declared instead.** Three test files
  imported `lan-relay.mjs` or `drive-app.mjs` through a `@ts-expect-error` and
  then hand-wrote the shape they expected; `startRelay`'s shape had already
  drifted once this session, gaining the `port` getter and `listening` when
  fixed test ports were replaced with port 0, and a cast cannot notice that
  kind of drift. New `apps/relay/lan-relay.d.ts` and `scripts/drive-app.d.ts`
  replace the casts. Two mechanics cost real time finding and are worth
  keeping written down: a `paths` entry naming a `.mjs` resolves that exact
  file and reads it as untyped regardless of what `.d.ts` sits beside it
  (both a `.d.ts` and a `.d.mts` sibling were tried), so the entry has to
  point straight at the `.d.ts` itself; and the `@mutation/tooling/*`
  wildcard only picks up `scripts/drive-app.d.ts` for an import written
  without the `.mjs` extension. vitest's own aliases still point at the
  runtime `.mjs` files (`68664ed`).
- **`JoinScreen` can only run one join at a time.** The room and manual-join
  buttons started a join per tap with nothing stopping a second; the
  correctness half of that was already closed by `closeIf` above, so what was
  left was ergonomic rather than dangerous. The guard flag lives in a closure
  inside new `packages/app-shell/src/app/once-at-a-time.ts`, not in
  `useState` alone, because `enter` is `async` and reads the flag again after
  an `await` — the same stale-closure trap `client-slot.ts` exists to avoid
  for the session handle — and `useState` only mirrors it for rendering. This
  changed join semantics from "last tap wins" to "second tap dropped": a
  player who taps the wrong room now has to wait for that join to settle
  before a retry is accepted, with only a dimmed button and no "Joining…"
  text explaining the wait. The wait is bounded — a 10s handshake timer on
  the browser path (`packages/net/src/websocket.ts:147`), an OS-level TCP
  connect timeout on the LAN path — and is exactly what was asked for, so
  it's a consequence rather than a defect. A "Joining…" affordance is the
  obvious follow-up. There is no jsdom or `@testing-library` in this repo, so
  the guard is tested through the pure `onceAtATime` module rather than by
  rendering `JoinScreen`, and the rendering itself was checked by driving the
  built app (`ff07c79`).

## What works, and how it was verified

- **Toolchain** — Nub `0.9.1` is the package manager and Node `24.21.0` the
  runtime (ADR 0017). Verified by deleting `node_modules`, running `nub ci`
  strictly from `nub.lock`, and then the whole suite: 101 vitest tests, a clean
  `tsc --noEmit`, `verify:ui` and `verify:ui:pages` both green, and a
  production build **byte-identical to the npm baseline** — 872 modules, the
  same asset hashes, 13 precache entries. A cold install with an isolated
  `HOME` — an empty store as well as an empty `node_modules` — pulled 442 MB
  and linked in 8.9s, so `nub.lock` is self-sufficient and CI's first run has
  nothing else to resolve. `scripts/provision.sh` ran end to end in this
  container and exited 0.
- **Engine** — pure deterministic reducer, four rule modules. 62 TypeScript
  tests in `packages/engine`, including a fuzz driver that plays whole random
  matches and asserts two independent peers fold to byte-identical state, for
  every combination of modules.
- **Rust relay** — 22 tests over real TCP and UDP sockets: ordering agreement,
  gapless sequencing under load, mid-match catch-up, readmitting a device that
  dropped off Wi-Fi, locked and full rooms, junk frames. **All of them pass**
  (`cargo test -p lan-sync`: 12 in `relay.rs`, 10 in `session.rs`), and so do
  `cargo clippy -p lan-sync --all-targets -- -D warnings` and
  `cargo fmt --all -- --check`. `a_peer_notices_the_host_going_away` was
  failing about 3 in 25 locally; the Rust audit (Task 7 of the Nx/Nub/PWA
  plan) found the `host.rs` defect behind it and fixed it, adding a regression
  test. The remediation plan's Task 5 then closed a second, narrower
  accept-loop race the same way —
  `serve_client` now observes `running` before doing anything else — verified
  by looping the test binary directly rather than trusting a single
  `cargo test` pass: 5 failures in 2000 runs before the fix, 0 after. A
  further residual gap in `host.rs` — the accept loop spawning a connection
  into `serve_client` without ever registering it in `pending` — was left open
  on purpose at the time; the follow-ups plan's Task 1 has since closed it
  (see the intro section above).
- **WebSocket relay + browser transport** — tested against a live relay: two
  clients fold identically, a late joiner catches up, a refusal surfaces
  instead of hanging, and a deliberate two-socket race still leaves both
  devices agreeing.
- **Android APK** — CI green, artifact produced and installed on a real phone.
  Still green after the toolchain migration: run `34762050952` on the nub
  branch produced `android-debug-apk`, 129 MB,
  `sha256:840244f4ca6250722f775c45b93f014ae9d8aec9d96e17914b80fd8e6e8cc776`.
  That run is the evidence for the `npx` exception below — it took two attempts
  to get there, and the first one is what found the incompatibility.
- **PWA** — deployed to GitHub Pages at
  `https://enchyrn.github.io/snake-ladders/` by `.github/workflows/pages.yml`,
  from Actions run `34758473488`. Opened on a real device: the app renders, the
  hashed asset bundle loads, hash routes work. Everything below `/snake-ladders/`
  — manifest, icons, service worker, all nine precache entries — resolves under
  the subpath, and the production build emits no root-absolute URL that would
  404 there. The service worker was watched registering at
  `https://localhost:8910/snake-ladders/sw.js` under
  `node scripts/drive-app.mjs --https --base-path /snake-ladders`, which is the
  first evidence the offline shell actually installs under the subpath rather
  than merely looking right in `dist/`.
- **Provisioning** — `scripts/provision.sh` was run end to end in a Claude Code
  web container, which is the hostile case: it fell back to npm for both mise
  and OpenCode, reported the toolchain as partial, and exited 0. The
  `SessionStart` hook was run the same way and is idempotent.
- **The whole CI command set runs in a cloud session**, despite `mise install`
  reporting three tools failed: `tsc --noEmit`, `vitest` (107, after the
  remediation plan), `vite build`, `cargo fmt --check`, `cargo clippy -D
  warnings` and `cargo test -p lan-sync` (21, all passing) all run. Sessions
  ship `node`, `npm`, `cargo`, `rustc` and a JDK already, so mise failing to
  *download* them costs nothing — and nub, which mise resolves through
  `npm:@nubjs/nub`, is one of the tools it *can* fetch here.
- **The full verification set, after the config hygiene pass** — every command
  in the remediation plan's Task 8 exits 0: `nub run lint`, `nub run
  typecheck`, `nub run test` (107 tests), `nub run build`, `nub run verify:ui`
  (clean on the first run), a `PUBLIC_BASE_PATH=/snake-ladders` build followed
  by `nub run verify:ui:pages` (needed one retry — see the known flakes below),
  a root-base rebuild to leave a normal `dist`, the three Rust checks, and
  `nubx nx run-many -t lint,typecheck,test,build --skip-nx-cache` (needed one
  retry — see the known flakes below). `nub run relay &` printed a join string
  and shut down cleanly on `kill`.
- **OpenCode delegation** — verified end to end from a web session once
  `opencode.ai` was added to the environment's Custom allowlist. Both agents
  answer on their own models (`explore` on `mimo-v2.5-free`, `review` on
  `nemotron-3-ultra-free`), and the read-only restriction was tested rather
  than assumed: asked to write a file, `explore` described the change instead
  and the working tree was unchanged.

## What has not been verified

- **`src-tauri/src/lib.rs` has no automated tests.** It compiles in CI via the
  Android build and that is all. Its session pump logic lives in
  `crates/lan-sync` behind `SessionSink` precisely so it *can* be tested; the
  thin command layer above it cannot be, without a webview.
- **iOS has never been built or run.** Everything said about it is inference
  from Apple's constraints, not observation.
- **Cross-device play has not actually been played.** The transports are
  tested; three phones in a room have not been. One real attempt has now been
  made — the deployed PWA, joining an Android native host — and it established
  that this particular pairing cannot work at all rather than that it is
  untested (open thread 1). A relay-based browser-to-browser match, and a
  native-to-native match, remain genuinely untried and still need hardware this
  container does not have.
- **Pinch-zoom on the board** is code-reviewed, not driven — Playwright's mouse
  harness cannot simulate a second pointer.
- **`.devcontainer/devcontainer.json` has never been built.** It is the same
  script the web hook runs, but no Codespace has been created from it.
- **`--file` delegation is untested.** Claude Code's auto-mode classifier
  blocks attaching repository source to a third-party model from inside a
  session, so that flag has only ever been passed through, never exercised.

## Open threads, roughly in priority order

These are numbered by position, so closing one renumbers the rest. Prose
elsewhere in this file names a thread rather than citing its number, because a
number that was right when it was written silently points at something else
after the next closure.

A closed thread is struck through in place rather than deleted, so that prose
citing it still resolves and nobody re-opens a question that was answered.


1. ~~**A relay the deployed PWA can reach at all.**~~ **Closed 2026-09-16**,
  implemented and merged as `03e1cd1`. It was framed as needing a `wss://`
  relay; that framing was wrong. The browser's mixed-content rule is about the
  *page's* origin, not the socket, so the host serves the guest its page over
  plain HTTP on the port it already listens on, and the rule never applies. No
  certificate, no public machine. ADR 0019 carries the amendment (one listener,
  three protocols) and ADR 0013 the correction to why WebRTC was deferred —
  mDNS obfuscation, not TLS.

  **What genuinely remains** is narrower than this thread claimed: the
  *deployed* HTTPS page still cannot join a room, and only a `wss://` relay
  would change that — a public machine, against "never touches the internet",
  a trade still un-taken. It blocks nothing: the host-served path covers the
  cases this thread existed for, iOS included.
2. **Run host-local Android capture.** The Codespace cannot see the device.
  Use wireless ADB and a host-local OpenCode session to install the latest
  debug APK, inspect the WebView, capture `logcat`, and record evidence.
3. **Complete the available Phase 1 device checks.** With one Android device,
  test native behavior separately and use the laptop relay for the PWA. Do
  not claim Android-native-host to PWA interoperability yet.
4. **Add Rust-side logging.** A failure in `net_host`/`net_submit` is still
  difficult to diagnose. The TypeScript half of this thread is done: no banner
  renders a raw stack trace any more. Four call sites took `String(cause)` on a
  rejected `Effect.runPromise`, which renders Effect's FiberFailure dump — a
  minified bundle offset in a production build, and a player saw exactly that.
  They now take the `TransportError`'s own `reason` through `Effect.either`.
5. **The RPG layer.** Designed and approved, not built. See
  `docs/superpowers/specs/2026-09-13-rpg-layer-design.md`. Extend the fuzz
  driver before writing any class.
6. **iOS and pinch-zoom validation.** Both require hardware or interaction
  tooling unavailable in this Codespace.

The Nx split's own defects (Tasks 4 and 5) are now closed —
every item is fixed and recorded in the intro section above rather than
re-described here. The structural hole in `host.rs`'s accept loop that used
to be thread 2 here is closed as well, by the follow-ups plan's Task 1 — see
the intro section for the mechanism and what closed it.

## Decisions taken during the remediation, and what they cost

These were made without a human in the loop while the remediation plan ran.
Each is recorded with what it costs if it turns out wrong, so any of them can
be reversed on purpose rather than rediscovered by accident. (The bullets do
not map one-to-one onto decisions — the last bundles four.)

- **Bare Vite aliases kept, not deleted.** The plan said to delete them,
  reasoning nothing imports the bare form. Wrong: a Vite alias key is a *prefix*
  match, so `"@mutation/engine"` is what resolves `@mutation/engine/types`.
  Deleting them breaks every cross-package import. Cost if wrong: a few unused
  `paths` entries.
- **The websocket timeout guards on socket identity.** The plan's literal
  timeout body was `fail(...); close()`, but `close()` acts on whichever socket
  is current, so an abandoned attempt could silently close its replacement.
  Cost if wrong: a timed-out socket occasionally left to GC rather than closed.
- **`peer_addr()` hole left open.** Closing it means restructuring the accept
  loop, well beyond bounding one window. Cost: a rare wedged socket until
  someone takes it. *Resolved 2026-09-15* by the follow-ups plan's Task 1 —
  see the intro section for the fix.
- **Thread 2 stays open** even though the remediation plan's own brief said to
  close it — the brief was written before the hole above was found. Cost: a
  follow-up stays visible one cycle longer, which is the safe direction. *This
  thread is now closed too* — see the same Task 1.
- **The final whole-branch review was scoped** to the remediation's ten commits
  rather than the branch's thirty-seven, which run to 1 MB because the branch
  also carries the Nx split. Cost: this is what let two cross-task findings
  through the package — the reviewer caught them anyway by reading the tree
  directly rather than only the diff.
- **The race test's power was raised** from ~0.8% to ~20% per run by increasing
  rounds, after measurement showed sockets-per-round is not a lever: one
  shutdown gets one chance at the window.
- **Three plan defects were corrected before execution** (a test referencing a
  private array, a Rust test using the wrong `Host` idiom, and the alias
  deletion above), and a fourth during it — a prescribed assertion that was
  unreachable. Written-down tests are not verified tests until someone runs
  them against the implementation they specify.

## Decisions taken during the follow-ups plan, and what they cost

Same rule as the section above: six calls made without a human in the loop
while the follow-ups plan ran, each with what it costs if it turns out wrong.
Two of them corrected the plan against itself, which is the pattern worth
noticing — a plan's *rules* are worth more than its literal text, because the
text is where the mistakes are.

- **The `wss://` decision was left out of the plan.** It is the one follow-up
  that is not codeable, and writing an ADR for it is the project owner's call.
  Cost if wrong: this work lands without the thing that would make joining
  work on the deployed PWA — which is already true today, and is the single
  open item above.
- **A test that would have passed against its own bug was rewritten before it
  shipped.** Task 1's draft asserted the same pending-count at both joiner
  checkpoints, so it could not tell "joiner not accepted yet" from "joiner
  accepted and retired". The committed sequence is 3 → 4 → 3. Cost if wrong:
  none — it is strictly stronger than what it replaced.
- **`relay.test.ts`'s local helper was retyped**, beyond what the follow-up
  asked for. Declaring a module means all five of its call sites must
  typecheck, and that helper spread `Record<string, unknown>` into
  `startRelay`, which only compiled while the import was `any`. Cost if wrong:
  a typecheck failure, caught immediately.
- **`Sequencer.join`'s `send` is typed to a frame union, against the plan's own
  literal text.** The plan specified `send: (frame: unknown) => void`, which
  does not compile under `strictFunctionTypes`; the first fix switched to a
  bivariant method signature, which compiles but checks *nothing* — a handler
  typed `(n: number) => void` was accepted. The plan's *rule* — fix the
  declaration to match the `.mjs`, never bend a test — outranked its text, and
  the `.mjs` sends exactly three shapes. Cost if wrong: a union too narrow for
  a future frame, caught by typecheck.
- **Commit trailers read the same attribution across the branch**, whichever
  agent authored a commit. One arrived with a different one, on the reasoning
  that a standing session instruction overrides a plan constraint. That is a
  real conflict; it was settled for branch consistency and because the rule
  against model identifiers in pushed artifacts sanctions one exact string
  rather than "whichever is accurate". Cost if wrong: the trailers under-credit
  which agent wrote which commit — recoverable, and visible in `git log`.
- **The plan file keeps the trailer strings inside its own commit-step
  blocks.** They are the sanctioned string quoted as a template, not a claim
  about who wrote the document, and a plan forbidden from printing its own
  required trailer cannot state its own requirement. Prose that *named* which
  model did which work was removed. Cost if wrong: a grep for model names hits
  the plan file and finds templates.

## Decisions taken during the review-findings plan, and what they cost

Seven rulings made on the user's behalf while executing
`docs/superpowers/plans/2026-09-15-review-findings-plan.md`. They lived only in a
gitignored SDD ledger, which does not survive a reclaimed container — so they are
here. Reverse any of them on purpose rather than rediscovering them by accident.

**1. Task 4 fixes the Rust decoder as well as the TypeScript one.**
`crates/lan-sync/src/lib.rs`'s `seed_from_room` had the identical `.take(4)`
defect as `seedFromRoom`. Fixing one alone would have made the browser reject
`ABC` while the native app accepted it — manufacturing the exact divergence the
fix exists to prevent. *Cost if wrong:* a slightly larger commit spanning two
languages. Confirmed correct: the Rust test returned `Some(9897)` pre-fix.

**2. Task 3's file list and test target were corrected before dispatch.**
The plan named `packages/engine/src/__tests__/match.test.ts`, which does not
exist; `playCard` is covered in `rules.test.ts`. The plan also omitted `types.ts`
and `resolve.ts`. *Cost if wrong:* none — a factual correction, verified by `ls`.

**3. Test-helper names in the plan are sketches; the assertions are binding.**
Tasks 1, 3, 5 and 7 named helpers that do not exist. Implementers were told to
use what each file already has. *Cost if wrong:* a duplicate helper, caught by review.

**4. Execution follows the plan's own order**, which is already the dependency
order for the three tasks sharing `lan-relay.mjs` (6 → 8 → 10) and the two sharing
`match-client.ts` (7 → 9). *Cost if wrong:* none identified.

**5. The Android CI failure was not this PR's, and I fixed it anyway.**
`android-actions/setup-android@v3` installs `tools platform-tools` by default;
`tools` has been retired from the SDK repository, so `sdkmanager` exits 1 inside
the action before any repo code runs. It failed identically on two consecutive
commits, one documentation-only. I did not merely stand down, because this job is
the only compiler `src-tauri/src/lib.rs` ever meets and plan Task 11 depends on it
for its entire verification story. Fixed in `b3b3e89` by requesting
`platform-tools` alone. *Cost if wrong:* a later, louder failure; the `with:`
block is trivially revertible. Confirmed: Android green on `b3b3e89`, `d01b730`
and `97d5a3a`, ~6.5 min each — real builds, not early bails.

**6. The "flake" a reviewer reported was my own concurrency, not a test defect.**
It flagged `a card played in a new round does not carry the last round's timeline`
as pre-existing. `git log -S` shows `d01b730` added it three minutes earlier. I had
dispatched an implementer and a suite-running reviewer against the same package at
once, so the reviewer ran vitest while `rules.test.ts` was half-written. Ten
consecutive clean runs with a settled tree, 65 tests each. **Process rule for the
rest of this work: a reviewer that runs the suite must not overlap an implementer
in the same package.** Reviewers are read-only for *writes*, but they execute
tests against the live worktree, which is not isolation. *Cost if wrong:* a real
intermittent failure could hide behind 10 clean runs; the final whole-branch
review re-runs everything.

**7. Task 4's third fix — `src-tauri`'s `net_rooms()` — is in scope, not creep.**
It called `seed_from_room(...).unwrap_or(0)`. Tightening the decoder is what makes
`None` reachable there, so shipping the decoder fix alone would have converted a
silent-wrong-board bug into a silent-phantom-room bug. Changed `.map()` to
`.filter_map()`. *Cost if wrong:* an undecodable beacon vanishes from the lobby
rather than appearing unjoinable. Confirmed: it compiles (Android run 69).

### Corrections to things this document and CLAUDE.md previously implied

- CLAUDE.md says the room-code derivation lives in three places. Those are three
  **encoders**. Only two of them ever decoded — `apps/relay/lan-relay.mjs` has no
  decoder at all. Do not go hunting for a third decode site.
- **A browser and the installed app cannot join each other, and `wss://` does
  not change that.** Asked to confirm the built artifact enables Android-host +
  PWA same-network cross-play, I probed it directly: handing `Host::bind` the
  exact bytes a browser sends for `new WebSocket(...)` returns
  `{"t":"rejected","reason":"malformed handshake"}`. `crates/lan-sync` is a raw
  `TcpListener` trading newline-delimited JSON, with `serde` and `serde_json`
  as its only dependencies — no WebSocket anywhere. The reverse direction fails
  too: the installed app joins via `net_join`, a Tauri command into that same
  Rust TCP client. So a match is all-native or all-browser. The `wss://`
  decision (task #14) only lets an HTTPS *page* reach the relay; it does not
  create interop. `docs/playing-together.md` previously implied otherwise and
  is corrected in `f1a55ca`. Mixing needs a bridge that does not exist: either
  the Rust host answering a WebSocket upgrade, or the native app joining a
  relay as a WebSocket client.
- A test sketched in a plan is not a test that reproduces a bug. Two of this
  plan's sketched tests passed against their own defects: Task 1's mine-blast
  scenario did not reach the defect through the real dispatch path, and Task 5's
  `wait_for` poll passed with the epoch guards stripped out, because the poll ran
  ahead of the dying thread's mutation. Both were caught by the implementers.
  Concurrency tests here must be **causally ordered** — block on a frame the code
  under test actually broadcasts, under the same lock as the mutation.

## The review-findings plan: what it closed, and the one thing it did not

`docs/superpowers/plans/2026-09-15-review-findings-plan.md`, all eleven tasks
done and reviewed. A whole-project review found eleven defects; ten pre-dated
this branch and one (`c3ce936`, a path traversal in `drive-app.mjs`) it had
introduced via the `--base-path` work.

| Commit | What was actually wrong |
|---|---|
| `5f8f949` | a mine blast's `momentum: 0` was overwritten by the move's tail — a dead write since momentum was added |
| `72b6ac0` | `breathe` left `partner` in `free`, so a relocated link's mouth could land on another link's endpoint |
| `d01b730` | `playCard` spread the previous round's timeline forward; `BoardCanvas` replays on array identity, so a card re-animated the round just shown |
| `97d5a3a` | **both** room-code decoders accepted a short code and returned a valid-but-wrong seed — a silently different board |
| `61fe618` | a dying connection disabled the reconnect that replaced it; `broadcast` skips disconnected clients |
| `f559ae7` | the Node sequencer had that identical defect |
| `4dbf1ff` + `cf7bc5b` | `Leave` existed in the schema and the reducer and nothing had ever constructed one; one dead phone froze the round for the whole room (native LAN only — same host-only gate as `lock`, see "The thing the plan got wrong" below) |
| `2efdd8d` | `Sequencer.lock()` existed and was tested and no frame could reach it |
| `8dcded4` | `transport.lock` had four implementations and no production caller |
| `97b5426` | the relay CLI printed a join string and then died on an unhandled `EADDRINUSE` |
| `f913769` | a replaced pump thread revived itself and kept its old session alive |

### The thing the plan got wrong

Task 8 gave the relay a `lock` wire frame gated on "the first successful join is
the host". **No browser client can ever hold that identity**, so the frame has no
reachable production caller:

- `packages/net/src/websocket.ts:220` — `host: () => unsupported("host a match")`
- `packages/net/src/factory.ts` — browsers always get the websocket transport
- `packages/app-shell/src/routes/home.tsx:39` — `role: "host"` only after a successful `host()`
- `packages/app-shell/src/routes/join.tsx:39` — every join opens as `role: "peer"`

So `MatchClient.lock()`'s host guard never passes on the relay path. Task 9 does
close a **native-LAN** room (Rust `net_lock`, on the device that opened the
socket). Read `2efdd8d`'s "so a browser room can actually close" as intent, not
achievement.

The irony is exact: Task 8 existed to fix *an interface method with four
implementations and no caller*, and recreated that one layer up. The cause was
the plan inventing an authority rule without checking whether anything could
satisfy it. **Deciding who may lock a relay-hosted room is a design question**
and belongs with the relay-architecture decision, not a fix-up task.

### The final review found two things eleven per-task reviews could not

Both were defects in the plan, not in any implementation, and both came from the
same root cause — two tasks sharing a gate that neither review could see whole.

**`Leave` was a one-way door** (`59aeae1`). Task 7 set `connected: false` on a
roster disconnect, but `case "Join"` checked `phase !== "lobby"` *above* its
reconnect branch, so once a match started nothing could set `connected: true`
again. Before this branch `connected` was never false, so it had never mattered.
A three-second blip permanently ejected a player into spectating. It also
defeated the mid-match readmission **both** sequencers deliberately implement and
comment on — the transport readmitted a client the reducer then refused. Fixed by
moving the reconnect branch above the phase guard.

**The same host-only gate blocks `Leave` as blocks `lock`.** `retireDeparted`
opens with `role !== "host"`, identical to `lock()`. The caveat was documented for
one and not the other, so this file claimed the dead-phone freeze was fixed when
on the browser path it is not. Corrected in the table above.

An edge case recorded rather than fixed: `Commit(A) → Leave(B) → Join(B)` resolves
the round without B, while `Leave(B) → Join(B) → Commit(A)` leaves it open waiting
for B. Every device agrees — one ordered log, one pure reducer — so the
determinism contract holds. It is a fairness question: a disconnect racing a
co-player's commit can cost the disconnecting player their roll.

**`determinism.test.ts` cannot catch any of this.** Its random-match generator
emits Join/Start/PlayCard/Flag/Commit and never `Leave` or a mid-match `Join` —
so the guard protecting this codebase's most important invariant has a blind spot
over exactly the paths this work introduced. Adding a `Leave` branch to
`playRandomMatch` is cheap and worth doing before the next change here.

### Two tooling facts that cost real time to establish

- **`cargo fmt --all` from the root has never covered `src-tauri`.** The root
  workspace is `members = ["crates/*"]` and `src-tauri/Cargo.toml` declares its
  own `[workspace]`, so the root command is silent because it does not look, not
  because the files are clean. Two spots had drifted. Fixed, and CLAUDE.md now
  names both commands (`420908f`).
- **Four of this plan's sketched tests asserted nothing.** Tasks 1, 5, 7 and 8
  each produced a first draft that passed against the very bug it was written
  for — one polled a counter before the buggy write landed, one never reached the
  defect through the real dispatch path, one passed because *every* lock was
  ignored in the unfixed relay. Every implementer caught its own. **Treat a test
  sketched in a plan as a hypothesis: run it against the unfixed code first.**
  For concurrency, block on something the code under test actually broadcasts,
  under the same lock as the mutation — never poll.

## Deferred, and why

Small, real, and none of them blocking. Recorded here because the scratch
workspace that held them is deleted — a note in a gitignored directory is not
a record.

- **No component test environment.** There is no jsdom and no
  `@testing-library` in the repo, and the suite runs `environment: "node"`.
  `JoinScreen`'s join-guard is therefore tested through the pure
  `onceAtATime` module it was extracted into, and the rendering was checked
  by driving the built app instead. A real component test needs that
  environment added first, which is a decision worth taking on its own
  rather than as a side effect of an ergonomic fix.
- **`JoinScreen`'s guard wrapper is held in a `useMemo`.** React documents
  `useMemo` as a performance hint it may discard, so `useRef` or a lazy
  `useState` initializer is the guaranteed-stable spelling. Left as is because
  the failure mode is bounded: a discarded memo reverts to the old behaviour
  (one extra session), which `session.closeIf` and `websocket.ts`'s socket
  identity guard already handle safely.
- **`RelayHandle.wss` is narrower than the real value.** It is declared
  `{ close: (cb?: () => void) => void }`; the runtime value is a `ws`
  `WebSocketServer`, and `@types/ws` is already a root devDependency, so
  `import("ws").WebSocketServer` would resolve. A narrowing rather than a lie,
  and `.close()` is all the two test files use — but it is the one field in
  those declarations still hand-shaped, which is mildly against the point of
  having written them.
- **`scripts/*.mjs` is still untypechecked.** The whole-tree `tsc --noEmit`
  now covers `apps`, `packages` and `vitest.config.ts`. The scripts are plain
  JavaScript and `allowJs` is off, so they are checked only where a `.d.ts`
  declares them — `drive-app.d.ts` does, for the one export the suite
  imports. Turning on `allowJs`/`checkJs` for `scripts/` would cover the rest
  and is untried.

## Follow-ups, in the order worth doing them

This used to list five items; the follow-ups plan
(`docs/superpowers/plans/2026-09-15-outstanding-followups-plan.md`) closed the
four that were codeable — see the intro section for what each one did. One
thing is left, and it is not codeable at all: a decision only the project
owner can make.

1. ~~**Decide the `wss://` relay architecture.**~~ **Closed 2026-09-16** by the
   host-served join, which dissolved the question rather than answering it: the
   guest's page now comes from the host over plain HTTP, so there is no HTTPS
   origin to satisfy and no certificate to obtain. A `wss://` relay would still
   be the only way to make *the deployed PWA* join a room, and that trade — a
   public machine, against "never touches the internet" — is unchanged and
   still un-taken. It is no longer blocking: Task 8 of
   `docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md` can proceed
   on the host-served path.

2. **Play it on two real devices.** The one thing nothing here proves — see
   "What is unproven" below. This is now the highest-value next action and it
   needs hardware, not a container.

## Known flakes

Both reproduce standalone, both pass on a second run, and neither has ever
been traced to a change in the diff that hit it. Re-run once before treating
either as a real failure.

- **`verify:ui` and `verify:ui:pages` can miss the narration on a cold start** —
  `log: []` and then a 30s timeout on "nothing was narrated after rolling". It
  is the narration timing, not the roll: the retry shows the entry present.
(The `EADDRINUSE` flake that used to live here is fixed: the relay and every
test that starts one now bind port 0 and read back what the OS assigns, so
`startRelay` reports the real port through a getter. Verified by running two
`nub run test` invocations concurrently — both exit 0 with 111 tests and no
collision, where the fixed-port version failed every time.)

## Things that would otherwise have to be rediscovered

- **A secure origin is not cosmetic, and `--https` is how you get one.**
  `node scripts/drive-app.mjs --https` serves over TLS with a certificate minted
  for the run (needs `openssl`). A service worker will not register without a
  secure origin and a page will not refuse an insecure `ws://` without one, so
  neither the offline shell installing nor the LAN-join refusal can be
  reproduced on plain http, however carefully the page is driven. Three things
  only appeared once it ran, and all three fail quietly:
  - **A context's `ignoreHTTPSErrors` does not cover the service worker.**
    Chrome fetches that script outside the context and refuses a certificate it
    cannot verify, so registration fails with an SSL error while every other
    request on the page succeeds. The browser needs `--ignore-certificate-errors`
    as well.
  - **`navigator.serviceWorker.ready` never settles when nothing registers.** It
    does not reject, so a `.catch()` cannot rescue it and the obvious check hangs
    instead of reporting the failure it exists to catch. Ask the context, not the
    page — a page being claimed by a newly activated worker can also lose its
    execution context mid-`evaluate`.
  - **A throw used to leave the harness's server listening**, and an open handle
    keeps node alive, so a failing run hung rather than printing what it had just
    found. `run()` now closes both in a `finally`.

- **Two GitHub settings gate a first Pages deployment, and neither is in the
  workflow file.** `workflow_dispatch` cannot fire a workflow that is not yet on
  the default branch — GitHub has not registered it, and the dispatch API 404s —
  so a Pages workflow cannot be exercised from the branch that adds it without
  either merging it unverified or temporarily adding that branch to the `push`
  trigger. Then the `github-pages` environment refuses a deployment from a
  non-default branch until its deployment-branch policy is widened; the job
  fails in about two seconds having run **zero** steps, and its log download
  404s, which is the signature of an environment gate rather than a build fault.
  Neither is readable or fixable through the GitHub tools available in a session.

- **This container cannot reach `github.io`.** The egress proxy answers 403 to
  `CONNECT` for it, so the deployed site cannot be verified from a session at
  all — only the Actions logs can be read. Confirming a deployment actually
  serves needs someone with a browser.

- **`nub run verify:ui` drives the built app in a real browser and
  screenshots it.** Three bugs were found this way and none were visible in the
  source: the board clipping its left and right columns, a router rendering
  "Not Found" when served from a subdirectory, and a disabled button styled as
  the primary action. Use `--base-path /some/nested/path` to reproduce the
  subdirectory case. Run it after any UI change.
- **The board's camera must fit both fields of view.** On an upright phone the
  horizontal one is narrower and binds first. Sizing from the vertical alone
  silently clips two columns.
- **The base path must match at build time and at serve time.** `--base-path`
  now 404s anything outside the prefix, exactly as a static host does; falling
  back to `dist/` let a root-absolute URL pass locally and fail only once
  deployed, which is the one failure the flag exists to catch. Both spellings of
  the flag and of the request resolve, because the plan's own step said
  `--base-path /snake-ladders/` while the npm script says `/snake-ladders`, and
  the trailing slash used to decide whether the page was found.

- **Transport is chosen by what the player picked, then by platform.** The
  reverse order handed pass-and-play the LAN transport with no room open, and
  broke the app on a real phone.
  `packages/net/src/__tests__/factory.test.ts` pins it.
- **An action the host sequenced but a device refuses is not a desync.** Every
  device rejects it identically. It happens legitimately when two players act
  at once, because the relay orders by arrival and their sockets race.
- **Mobile Harness cannot build this app on-device.** Investigated: its Linux
  userspace ships Node but no Android SDK, NDK or Rust, and Google publishes no
  `linux-aarch64` NDK, so a Rust cross-compile has no bionic-targeting clang.
- **macOS CI is expensive here.** macOS cannot be containerised under Apple's
  licence, so those runners bill at 10× and this repository is private. An
  installable IPA additionally needs a paid signing identity. Making the repo
  public would make GitHub-hosted macOS runners free; it would not remove the
  signing requirement.

- **`packages/tooling` declares `sourceRoot: scripts`, but Nx attributes a
  file to a project by its root, not its `sourceRoot`, and the project's root
  is `packages/tooling/`.** `scripts/` therefore belongs to no Nx project
  at all, and three things follow from that, all of them silent. `nx graph`
  shows no `game-web -> tooling` edge, so `@nx/enforce-module-boundaries`
  cannot attribute `scripts/*` to any layer — the `layer:app -> layer:tooling`
  constraint in `eslint.config.js` and the "declared project edge the boundary
  rule can check" comment in `vitest.config.ts` are both describing an edge
  that the graph does not have. Nx's cache also never invalidates a target
  when a file under `scripts/**` changes, since nothing declares it as an
  input. And `scripts/drive-app.d.ts` ends up checked only by the root
  `nub run typecheck`, which is a plain script rather than a cached Nx target.
  Fixing the `sourceRoot` mis-scoping itself is untried and would change what
  the boundary rule enforces, so it is not the trivial edit it looks like.

## Agent Workflow Checkpoint

Each agent framework reads its own configuration to follow the same rules:

| Agent | Config source | Notes |
|-------|--------------|-------|
| Claude Code | `.claude/skills/` | Superpowers skills vendored; bootstrap in `using-superpowers/SKILL.md` |
| GitHub Copilot | `.github/copilot-instructions.md` | Points to the vendored Superpowers bootstrap, CLAUDE.md, and handoff |
| OpenCode | `opencode.json` | Plugin pinned to Superpowers `v6.3.0`; mise pins OpenCode `1.18.30`. Two read-only agents, `explore` and `review`, on free Zen models — see ADR 0016 |

All three share one contract: read the repo docs before editing, get design
approval before writing code, and verify before claiming completion.

**Next checkpoint:** Tasks 1, 3, 4, 5, 6 and 7 of
`docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md` are done. The
Task 4/5 Nx split shipped with defects, and a separate remediation plan
(`docs/superpowers/plans/2026-09-14-nx-split-remediation-plan.md`, eight tasks
plus a final fix wave, all committed and reviewed) fixed every one of them
except the Rust gap it left open on purpose; a third plan
(`docs/superpowers/plans/2026-09-15-outstanding-followups-plan.md`) then
closed that gap along with the three other codeable follow-ups it left
behind — see the intro section above for both lists.

**Open thread 1 is closed, and not in the way it was framed.** It asked for a
`wss://` relay so the deployed PWA could reach a room. The framing was wrong:
the browser's mixed-content rule is about the *page's origin*, not the socket,
so the fix was to stop handing the guest an HTTPS page at all. The host serves
the page itself over plain HTTP on its existing port, page and socket share one
origin, and the rule never applies. No certificate, no public machine, and the
promise that the game never touches the internet survives intact. That is the
host-served join, implemented 2026-09-16 — see below.

Task 2 is next in the plan's order but is **hardware-blocked for a container
session**: it is host-local Android capture and needs a device, wireless ADB and
Chrome on the operator's own machine. `docs/android-debugging.md` is the written
procedure and has not yet been executed against hardware — whoever runs it first
should correct whatever turns out to be wrong.

Task 3 (Nub and Node 24 bootstrap) is **done** — see the note under it in the
plan, and ADR 0017. Nub `0.9.1` is the package manager, `nub.lock` is the
lockfile, `package-lock.json` is gone, and every workflow bootstraps through
`nubjs/setup-nub@v0`.

Two things from it that mattered for the Nx split (Tasks 4 and 5). First, the
isolated `node_modules` layout turns a phantom dependency into a build failure
rather than a silent success — it caught `workbox-window`, which reaches the
client bundle through `virtual:pwa-register` and had never been declared — so a
cross-project import that only resolved because everything was one flat tree
failed loudly the moment files moved into `packages/`. That is the desired
behaviour; the fix is always to declare the dependency, never to switch the
linker back to hoisted. Second, `nx@23.2.1` was already a dependency and
installed cleanly under nub, so the split started from a working `nx` binary.

**The Tauri CLI is launched with `npx`, not `nubx`, and that is the one npm
command left in the repository.** It is not an oversight — Actions run
`34761512711` is the failure that established it. Tauri bakes the command
Gradle uses to re-invoke it into the generated Android project, derives it from
`argv[1]` and `npm_execpath`, and knows npm/npx/pnpm/yarn/bun but not nub;
under `nubx` it recorded a path-relative `node <path>` that Gradle ran from
`src-tauri`, where it does not resolve, and the APK build died in
`:app:rustBuildArm64Debug`. ADR 0017 has the mechanism. Do not "tidy" that line
back to `nubx` without a Tauri release that knows about nub — the web suite
will stay green and only the Android job will tell you.

`tauri.conf.json`'s before-commands do call `nub run`, and that half is fine —
run `34762050952` built the APK with them in place.

## Resuming From This Checkpoint

**Checkpoint written 2026-09-16, updated after the two quick wins and again
after ADR 0020 — the feel ADR — was written.**
Everything below is committed and on `main`; nothing lives only in a
conversation.

### Where the work stands

**The host-served join is implemented and merged.** PR #3 went into `main` as
the merge commit `03e1cd1`; all six tasks of
`docs/superpowers/plans/2026-09-16-host-served-join-plan.md` are done and
ticked. A guest scans a QR on the host's lobby, the host serves them the game
over plain HTTP on the port it was already listening on, and they join the room.
No install, no relay machine, no certificate.

**Work happens directly on `main` now, at the owner's instruction
(2026-09-16).** No feature branch, no PR: the two quick wins below were
committed straight to it.

`claude/snake-ladders-cross-device-3uu177` is **abandoned**. Everything it
carried is on `main` — the merge `03e1cd1` plus its three documentation
commits, cherry-picked across as `8c98595`, `801a59e` and `e4ae3ef` so that
abandoning the branch loses no recorded state. Do not add to it and do not
read it for history; `main` is complete.

The gates below were re-run **on the merged `main`**, not only on the branch:
a green feature branch does not prove a green merge.

| Commit | What |
|---|---|
| `a976cd7` | Task 1 — the serving rules as pure functions (`crates/lan-sync/src/assets.rs`) |
| `fb02bf4` | Task 2 — the host's third request branch, and six socket tests |
| `d7fdbdc` | Task 3 — `local_address()`, and assets threaded through `Session::host` |
| `c03f82a` | A correction to what the address probe's target range guarantees |
| `7487e22` | A traversal fix the plan's own security claim did not survive — see below |
| `9b6f3be` | Task 4 — the Tauri adapter. **CI's Android APK job is green on this sha** |
| `3c1f0fc` | Task 5 — the lobby QR, its quiet zone, and the `.tsx` test gap |

### Two defects found while implementing, both worth remembering

**1. The plan's security claim was false, and only reading the consumer caught
it.** Task 4's comment said `request_path` had already refused any `..`, so
Tauri's resolver could never look outside the bundle. But `get_asset`
percent-decodes *again*, and `request_path` returned an already-decoded path —
so `%252e%252e` passed the check as the literal `%2e%2e` and the resolver
turned it back into `..`. Production was saved only because the embedded bundle
is a lookup table rather than a filesystem; Tauri's `#[cfg(dev)]` branch does a
real `fs::read`. `request_path` now decodes to a **fixpoint**, so the
consumer's own decode is a no-op. Two regressions pin it.

The general lesson: a sanitiser is only safe against the decoding its consumer
actually does. Check the consumer.

**2. The QR's quiet zone was CSS padding, which is the wrong unit.** `padding:
0.5rem` is a fixed 8px; module size shrinks as the encoded URL grows. At 180px
that rendered ~1 module of margin where the format asks for 4 — on a code that
has to be read off a screen by a phone camera. It is now drawn **inside the
SVG** (`QUIET_ZONE = 4`), where no stylesheet can remove it, and pinned by a
test. Invisible in the source; obvious in a screenshot. That is the fourth time
on this branch that looking at the rendered page found what reading it did not.

### What is unproven, and it is the important part

**Nothing here has been played on real hardware.** Be precise about what the
green gates do and do not mean:

| Proven | Not proven |
|---|---|
| The host answers a browser's HTTP framing on loopback | That an Android build serves it over real Wi-Fi |
| The serving rules refuse every traversal we could think of | That a real phone camera scans the rendered QR |
| `src-tauri` compiles for Android (CI, run 91) | That the APK *runs*; CI builds it and never starts it |
| The lobby's host block renders correctly at 390x844 | That it renders on a real device, at a real DPI |
| A scanned `#/join?room=…&at=…` fills the join field in and opens it, driven in Chromium at 390x844 | That a phone camera resolves the now-longer URL — more characters means more modules and a smaller module at the same 180px |
| `showRound` holds the tokens still while a round is pending (unit) | That the avatar no longer visibly teleports — a timing defect no screenshot can show |

`local_address()` is the piece most likely to disappoint on contact. It reports
**one** address, from whichever interface an outbound route would leave by. A
host on two networks may be reachable on the other one, and a host with **no
default route** gets `None` and shows the "no Wi-Fi address" branch even though
it has one. The lobby prints the address as text beside the QR for exactly this
reason.

A container quirk worth knowing before you debug it: this environment's `eth0`
is `192.0.2.2/24` — inside TEST-NET-1, the range the probe targets as
"unrouted". It does not break the answer (a connected UDP socket sends no
packet), but it means the loopback-only branch of that test is never exercised
here.

**WebRTC stays phase 2 and stays gated** on two physical devices resolving each
other's mDNS candidates. A probe on 2026-09-16 corrected ADR 0013: WebRTC was
never blocked by TLS — mixed content does not govern `RTCPeerConnection` — its
real blocker is mDNS obfuscation, every candidate returning `<uuid>.local`. Do
not write code for it before that is observed on hardware.

### Design decisions taken 2026-09-16 (brainstorm), none of them implemented

These came out of a brainstorming session and are recorded here because they
existed only in a conversation. Nothing below is code yet.

**The governing decision: "boardgame, not number game."** The owner's stated
thesis, and it reaches the *rules*, not only presentation. Today the game tells
you what happened in text and digits — the log narrates "Python rolled 6",
momentum is integer arithmetic (ADR 0003), minesweeper is counts. A boardgame
shows you instead. **This is to be written as an ADR, not a spec section**,
because it governs three specs (settings, renderer-legibility, and the mode
designs) and each would otherwise re-derive it. Its honest cost: showing takes
longer than telling, so it trades speed for weight, and some things genuinely
read better as digits.

> **Written 2026-09-16 as [ADR 0020](adr/0020-a-boardgame-not-a-number-game.md),
> Accepted.** It states the thesis as four rules — every `TimelineEvent` owes a
> board-visible depiction; text is demoted rather than deleted (the `aria-live`
> log is how a screen-reader player receives a round at all); digits stay where
> a digit is the honest unit; and *showing never implies agency the engine does
> not grant*, which is the rule that decides flick-to-throw rather than leaving
> it to taste. Two things the brainstorm had not separated came out while
> writing it. First, the depiction is free on the wire and automatically
> consistent across devices, because `TimelineEvent` is already a semantic
> stream folded identically everywhere (ADR 0001) — the ask is a presentation
> cost, not a protocol one. Second, the worst cost is not the pace trade: it is
> that **a missing depiction fails silently in the direction of withholding
> information from a player while every engine test stays green**, since the
> engine is right. That moves verification onto screenshots permanently. The
> ADR also records the standing tax on ADR 0002 — each new rule module now owes
> a visual vocabulary as well as a reducer — and closes the venom question by
> classifying it as a defect rather than a quirk.
>
> `renderer-legibility` predates the ADR and now carries a pointer to it in its
> own §ADRs, since it was arguing towards the same premise independently.

| Question | Decision |
|---|---|
| Snake/ladder/mine visibility toggles | **Deferred.** Fix `renderer-legibility` first — its layering contract, entry-end badges, tap-to-trace and per-link tint may dissolve the overlap problem. Revisit toggles after, not before. |
| Avatar customization | **Honour the existing deferral.** `renderer-legibility` §Token variety already routes player-visible customization through class choice, so `Join` is extended once by the RPG layer rather than twice by two designs. Token shape as a pure function of `(seed, seat)` ships with legibility. |
| Seat colour | **Decouple from seat.** A `colour` field travels in `Join`; seat assignment stays join-order and untouched, because seat is the deterministic tiebreaker and the dice draw order. Conflicts resolve by log order. |
| Dice as trigger | The dice tray is **always tappable**; whether the Roll button is shown, and on which side, becomes the setting (hidden / left / right). |
| Flick-to-throw | **Rejected.** Dice are drawn from the shared PRNG during resolution and `Commit` carries no value, so a throw gesture would imply agency the architecture forbids. |
| Animation speed control | **Yes**, with a floor, and never skipping the causal beats. Safe by construction: an animation that stutters or is skipped cannot change a result. |
| Haptics | `navigator.vibrate` — **Android only**. iOS Safari has never shipped the Vibration API. Verify on device. |
| Camera pan | **Belongs to `renderer-legibility`, not settings.** `fitCamera` owns the target, and the spec already concedes control when the player orbits manually; pan follows the identical rule, with `⟲ Reset view` handing it back. Bounded so the board cannot be lost. |
| Gold as a second currency | **Not yet.** See the venom finding below. |

**A constraint that falls out of the colour decision.** `renderer-legibility`
reserves the green family for link tinting and gives hue to seats. If players
pick their own hue, someone picks green and fights the snakes. The selectable
palette must exclude the link band.

### The venom coupling defect, confirmed in the tree

`venom` is core player state — `match.ts:39` initialises it, `:105` checks the
cost, `:163` spends it — but it is **earned in exactly one place**,
`venomForBite` in `rules/mutation.ts`. So venom is core state fed exclusively
by one optional module: with `mutation` off it is permanently 0 and anything
priced in it is dead for that match.

This is not hypothetical and it is not a style issue. It is the reason a second
currency ("gold") was declined for now, and it is the same shape as the worry
that tying minesweeper scoring to venom would trap sessions without `mutation`.
`reactive-decisions` independently diagnoses the other half — the economy funds
reactions the game never gives anyone a chance to make. **Fix venom's two
defects (stranded without `mutation`, nothing worth buying) before adding any
second currency.**

### Where the outstanding requests were placed

The owner's wish list decomposed into four clusters, not one:

1. **Quick wins** (bounded, approved, not yet done) — the QR arrival prefill and
   the avatar teleport, both detailed below.
2. **Settings, input and feel** (architectural) — the table above. Blocked on
   the feel ADR being written first.
3. **Lobby and seating UX** — "Add People" is cramped; overlaps
   `share-and-start-menu` §"The start menu", designed and unbuilt. Now also
   carries a real requirement: colour picking needs lobby UI.
4. **Mode design** (architectural, largest) — minesweeper integration, more
   mutation cards, ladder-expiry and rearrange animations, momentum transfer,
   the simultaneous tiebreak, a skip mechanic with snake attraction, gold.
   Several of these are currency questions that the venom fix answers first,
   and the feel ADR governs all of them.

**A skip mechanic would need a new action.** The vocabulary is
`Join | Leave | Configure | Start | PlayCard | Commit | Flag` — there is no
`Skip`. And ADR 0002 says a match with no modules is classic Snakes & Ladders,
so snakes hunting idle players must live in a module rather than the core.

### The two approved quick wins — both landed 2026-09-16

Both are defects rather than features, and both would have been hit the moment
anyone tested on hardware. **Both are now fixed and on `main`** — `5c393ea`
and `56e9e5e`. The specifications below are kept as written so the commits can
be read against what was asked for; the notes under each record what the
implementation found that the specification did not.

**1. The QR lands nowhere useful.** `lobby.tsx:85` encodes a bare
`http://${address}:${port}/`, which opens the app at the home screen. The join
screen (`join.tsx`) reads no URL parameter at all and hides its address field
behind `<summary>Join by address</summary>`. So scanning gets you the page and
then abandons you. Encode room and address — `…/#/join?room=W3SZ&at=IP:PORT` —
and have the join route read it and pre-fill. The room code is the seed, but
that is already true of the code read aloud, so this exposes nothing new.
`share-and-start-menu` §"The link, and what happens on arrival" is the design.

> **Landed as `5c393ea`.** `joinLink` and `joinArrival`
> (`packages/app-shell/src/app/join-link.ts`) are one pure module so the
> encoder and decoder are pinned against each other by a round-trip test —
> the room code is the seed, so a code that decodes anyway builds a different
> board in silence. The link is rooted at the origin rather than at Vite's
> `BASE_URL`: it addresses the *host's* server, and `request_path` answers
> `/` with index.html. Arrival fills the field **and opens the `<details>`**,
> because a pre-filled field inside a collapsed disclosure is the same dead
> end as no field at all. It does not auto-join — the spec's step 2 wants the
> room confirmed first. The `<details>` is controlled (`open` + `onToggle`)
> rather than set open declaratively: the room list refetches every second,
> and an uncontrolled `open={true}` springs back open every time the player
> closes it.

**2. The avatar teleports before it moves.** `BoardCanvas.tsx:78` calls
`scene.sync(state)` unconditionally *before* `scene.play(...)`, and
`syncTokens` (`scene.ts:351`) snaps a token whenever `clips.length === 0` —
which is exactly true at that moment, because the previous timeline has ended.
So the token snaps to its destination, then animates from its origin. Fix: do
not snap token positions while a timeline is pending; `play`'s existing
`onDone` already re-syncs. This is also the clearest instance of the number
game leaking through the presentation, which is why the feel ADR promotes it
above polish.

> **Landed as `56e9e5e`.** The fix is not the obvious one. *Swapping* `sync`
> and `play` looks smaller and is wrong: `play` resolves each token from
> `this.tokens` and `break`s silently when one is missing, so a player whose
> token `sync` had not yet created would lose their animation with no error
> anywhere. `clips` cannot answer the question either — it is empty right up
> until `play` fills it, which is the whole defect. So the caller, the only
> thing that knows a round is about to replay, now says so: `Scene.sync`
> takes `{ snapTokens }`, and the ordering rule moved out of the React effect
> into `packages/ui/src/round-playback.ts` (`showRound`), where a fake stage
> tests it without a WebGL context — `Scene`'s constructor needs a real
> canvas and `WebGLRenderer`, so it cannot be built in the node test
> environment at all.
>
> **What this does not prove.** The ordering contract is unit-pinned and the
> match screen still renders and animates without console errors. Nobody has
> *watched* the animation: a teleport is a timing defect and a screenshot
> cannot show one. Confirm it by eye on the next hardware run.

### The task to start on

**The two quick wins are done** (`5c393ea`, `56e9e5e`, both on `main`). What
is left, in order:

> **Start at Task 3** of `plans/2026-09-17-chrome-and-layout-plan.md`:
> "Derive colour tokens from palette.ts, and fix the seat colour that is already
> wrong". Its seat-colour predicate is written to fail on a real defect —
> `seatColours[4]` is `#4ee39b`, inside the green band `renderer-legibility`
> reserves for link tinting — so a red test there is the task working, not a
> mistake to route around.

1. ~~**Write the feel ADR**~~ — **done 2026-09-16**, as ADR 0020
   "A boardgame, not a number game", Accepted. See the brainstorm table above
   for what writing it turned up that the brainstorm had not. Docs only; no
   code changed, so no gate moved.
2. ~~**Write the settings spec**~~ — **done 2026-09-16**, as
   `docs/superpowers/specs/2026-09-16-settings-and-input-design.md`. It became
   **spec A of two**: the owner asked mid-brainstorm to revisit every menu and
   HUD and to consider new assets, which is a second subsystem, so it was
   decomposed rather than absorbed. **Spec B — the chrome and layout pass — is
   the task to start on**, and it needs a screenshot survey of the current
   screens before anything else. It must absorb `renderer-legibility` §Chrome
   and `share-and-start-menu` §"The start menu" rather than compete with them,
   and it inherits the asset question: the game has **no assets at all** today
   — no `public/`, no icons, no fonts, 784 lines of CSS in one stylesheet with
   a single media query, and every glyph an emoji in a text node.

   **Spec B is written too** — `2026-09-17-chrome-and-layout-design.md`, plus
   **ADR 0021** (Panda CSS `1.12.1` and Lucide — adopted on `2.0.0-beta.17`
   with the beta cost stated, then amended to stable on 2026-09-17 when the
   beta failed its own gate; see the ADR's "Why the version reversed"). The match layout is drawn rather than described, at
   <https://claude.ai/artifact/MXucAxxrRbVbr1uo8ZYAAR>, artboard
   "A — CHOSEN: edges + progress rows".

   **Both implementation plans are written, and plan 1 is under way.**

   | Plan | Tasks | Covers |
   |---|---|---|
   | `plans/2026-09-17-chrome-and-layout-plan.md` | 14 | Spec B. **In progress: Tasks 1–2 done, start at Task 3.** |
   | `plans/2026-09-17-settings-and-input-plan.md` | 9 | Spec A. Runs second. |

   **Plan 1 is being executed on the branch `claude/chrome-and-layout`**, cut
   fresh from `main` at `ac1f114`, not on `main` itself. Tasks 1 and 2 are
   committed and their checkboxes ticked, each with an execution note recording
   what the plan did not anticipate — read those notes before trusting the plan
   text, because Task 1's version and Task 2's JSON both changed under
   execution.

   | Commit | What |
   |---|---|
   | `6126783` | The Panda beta's supply-chain verification, recorded in ADR 0021 |
   | `66b1f1a` | ADR 0021 amended to stable `1.12.1`; file renamed, index/spec/plan updated |
   | `722a033` | Task 1 — Panda `1.12.1` and Lucide installed, configured and proven to build |
   | `c532c04` | Task 2 — `panda` codegen as a cached Nx target with declared outputs |

   **The order is deliberate and reverses what this file used to say.** Earlier
   revisions named the settings spec as next; that was written before spec B
   existed. ADR 0021 requires the Panda beta to be proven before anything is
   written against it, and the dice tray that spec A's `rollButton: hidden`
   depends on is built in plan 1's Task 8. Building settings UI first would
   mean building it twice.

   **Plan 1, Task 1 is a gate, and it has already earned its keep.** It was
   written to prove Panda against React 19.3, Vite 8.3, TS 6.0.3 and nub's
   non-hoisting linker before anything was written against it. On 2026-09-17 it
   failed on none of those: `nub` refused `@pandacss/dev@2.0.0-beta.17` because
   its transitive `@pandacss/cli` **lost its provenance attestation** at
   `beta.11`, which `trustPolicy=no-downgrade` treats as a supply-chain
   downgrade. The tarball was verified clean against both the last attested
   release and its own source tag (ADR 0021, "Supply-chain verification"), but
   keeping the beta would have meant a standing `trustPolicyExclude` bypass —
   so the owner reversed the version to stable `1.12.1`, which has no
   `@pandacss/cli` dependency and installs cleanly.

   The rule still stands for the rest of the task: if the build fails, stop and
   report rather than working around it. Failure is cheap here and expensive
   eight tasks later — which is exactly what just happened, in the one failure
   mode nobody had imagined.

   Two things in plan 1 fail on real defects the moment they are written, which
   is intentional: Task 3's seat-colour predicate (`#4ee39b` is inside the
   reserved link band) and Task 10's join-state test (the screen has one state
   and needs three).

   Five things the settings brainstorm established that spec B or its plan
   will need:

   - **The layer rule decides the architecture, not taste.** `layer:ui` may
     depend only on `engine` and `render`, so `BoardCanvas`, `EventLog` and
     `HUD` cannot import a settings store. Settings live in `app-shell` and
     every lower layer takes its slice as an explicit parameter. The dangling
     `quality` prop on `BoardCanvas` was that pattern, half-built.
   - **Settings is an overlay, not a route.** A `/settings` route replaces the
     match screen, unmounting `BoardCanvas` and discarding the clip queue of a
     round mid-replay.
   - **There is no tappable dice tray.** `Scene.pick` raycasts the board plane
     only; the dice are WebGL objects nothing picks. The tray has to be built,
     and as a DOM control — `RollButton` is currently the only
     keyboard-reachable path to `Commit`, so hiding it behind a raycast would
     be an accessibility regression.
   - **iOS haptics are feasible but unreachable.** WebKit has never shipped the
     Vibration API, so no web path reaches them; a Tauri v2 plugin would, but
     only in the installed iOS app, which ADR 0011 keeps manual and which is
     not the path iOS actually takes here (guest in Safari). Hence a capability
     probe rather than a platform check — which also covers `wakeLock`, absent
     on exactly the guest phones that scanned in, because the host-served join
     is plain HTTP and `wakeLock` is `[SecureContext]`.
   - **ADR 0020 rule 1 already fails in eight places.** `Scene.play` clips six
     of the fifteen `TimelineEvent` variants. `LinkCollapsed`, `Revealed`,
     `MineDefused`, `CardPlayed`, `VenomGained`, `BoardBreathed`, `Stunned` and
     `Finished` have no board depiction at all.

   And five from spec B's screenshot survey, which is the part that could
   only be learned by looking:

   - **The board is square and the phone is 1:2.2.** At 390 wide the board
     maxes out at 366×366 — 43% of the height, flat. Tilting it for
     perspective makes it *shorter*: today's tilt costs ~90px. "Fill the
     screen" was never on the table; the design question is what the other
     ~430px does.
   - **The band budget closes by arithmetic**, because `match.ts:195` caps a
     match at six players. Even at six the board keeps its full 366 and ~119px
     remains. That is a table, not a hope.
   - **`seatColours[4]` is `#4ee39b`** — mint, inside the green band
     `renderer-legibility` reserves for link tinting. The fifth player's token
     already fights the snakes, today, before anyone is allowed to pick a
     colour.
   - **The join screen's empty room list renders nothing at all** — no
     spinner, no empty state. A guest whose discovery fails cannot tell the app
     from a dead page. It has one state and needs three.
   - **The card rail is not broken, only undiscoverable.** `.cards` is
     `overflow-x: auto`, so the two off-screen cards are reachable; this was
     checked before it was written down. Flexing five cards across 366px
     removes the problem by construction.

   The floor ADR 0020 demanded is settled and derived rather than chosen:
   speed scales each clip's duration and every clip clamps to
   `max(150ms, duration / speed)`. 150ms because `step` already clamps `delta`
   to 64ms, so a 150ms clip renders at least three frames on a phone dropping
   them. Presets are 1× / 1.5× / 2.5×; the clamp, not the multiplier, is what
   keeps a beat visible, which is why `quick` can be 2.5×.

3. **Fix `verify-ui` so it builds first** — see the trap below. It is a
   deliberate non-fix in this pass and it is small, but it is an Nx graph
   edit, and this repo has already been bitten once by an Nx attribution
   change that looked trivial.

`venom`'s two defects (stranded without `mutation`, nothing worth buying)
still gate any second currency, unchanged by this pass.

**Then: play a match on two real devices.** That remains the highest-value
action nothing in a container can do, and the quick wins are worth landing
first precisely because they change what that test will show. `docs/android-debugging.md` is the written
procedure and has never been executed against hardware — whoever runs it first
should correct whatever turns out to be wrong. Install the APK on an Android
phone, host a match, scan the QR from a laptop or second phone, and play a
round. Then come back and make the "Not proven" column above shorter.

**iOS is in scope for that test as a guest, and the docs understate this.**
`refuseInsecure` (`packages/net/src/websocket.ts:63`) only refuses when the
page's own protocol is `https:`, so a host-served page — plain HTTP — lets an
iPhone open `ws://` and join. That fell out of the host-served join as a side
effect nobody wrote down. What iOS still cannot do is host (no browser can) and
install to the home screen from that origin (installation needs HTTPS). Those
two needs pull in opposite directions on origin, and the honest resolution is
two entry points: install the Pages build for pass-and-play, scan the QR for
multiplayer.

Task 8 of `docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md` (the
shared relay descriptor and QR transport phase) is **no longer blocked** — open
thread 1 is closed. Task 2 of that plan remains hardware-blocked for the same
reason as above.

### State of the gates, as of this checkpoint

**Superseded for plan-1 work: re-run on `claude/chrome-and-layout` at
`858c07e` (2026-09-17), working tree clean — `nub run test` 185 passed in 19
files, `nub run typecheck` clean, `nub run lint` clean, `nub run build` clean
from a deleted `styled-system/` and `dist/`, and `nub run verify:ui` clean on
that fresh build. Panda's arrival moved no test count. `nub audit` reports one
advisory, down from six, and the survivor is pre-existing on `main` — see the
audit note below. The Rust gates were not re-run, because nothing outside the
web toolchain was touched.**

**The branch is pushed.** `claude/chrome-and-layout` is on `origin` at
`858c07e`. That needed the owner to widen the egress list mid-session; before
it, pushing answered 403 and the session's traffic to GitHub was anonymous and
read-only. **Deleting a ref is still refused** — a delete push answers 403 even
now, and the GitHub MCP server exposes no delete-branch tool, so
`origin/claude/snake-ladders-cross-device-3uu177` survives and has to be removed
from a developer machine or the web UI. It is safe to delete: every one of its
four commits is already upstream in `main` as an equivalent patch, checked with
the porcelain that detects exactly that.

**`nub audit` had never run in this environment, and it mattered.** The advisory
check needs `api.osv.dev`, which was not on the egress allowlist, so every
`nub add` printed `WARN OSV advisory check failed` and installed anyway — a
warning easy to lose in the scroll. With the host allowed, the audit reported
six advisories and **five of them arrived with Panda**: it exact-pins
`postcss@8.5.14`, `browserslist@4.28.1` and `postcss-selector-parser@7.1.1`,
all inside advisory ranges, with no caret anywhere. Safe versions of the first
two were already in the tree and unreachable, which is why `nub dedupe` changed
nothing — an exact pin is not a range, so there is nothing to collapse. An
`overrides` block in `package.json` (`858c07e`) takes six down to one, and the
survivor, `smol-toml`, predates this work and is **also present on `main`**.

Two things to carry forward. The trust-policy check is independent of the
advisory check and ran throughout — it is what caught the Panda beta — so a
clean install proves less than it looks when OSV is unreachable. And any future
Panda upgrade must be re-audited with the overrides re-checked, because they pin
around that library's own pins and a new Panda may move them.

The pre-Panda baseline below stands for `main` itself:

**Re-run in full on `main` at `1f58541` (2026-09-17), working tree clean.**
This session changed documentation only — no code moved — so the numbers below
are unchanged from `56e9e5e` and were re-measured rather than copied forward:

| Gate | Result |
|---|---|
| `nub run test` | **185 passed**, 19 files |
| `nub run typecheck` | clean |
| `nub run lint` | clean |
| `nub run build` | clean |
| `nub run verify:ui` | clean, on a freshly built `dist/` |
| `cargo test -p lan-sync` | **58 passed** (26 + 21 + 11) |

Two notes for whoever runs these next. `nub` is not on `PATH` in a fresh cloud
session: `export PATH="$HOME/.local/share/mise/shims:$PATH"` first, because
`mise x --` fails on the `java` and `rust` tool resolution before it gets to
running anything. And the survey screenshots this session's specs are built on
live in `screenshots/`, which is gitignored — regenerate them with
`nub run build && nub run verify:ui` rather than looking for them in the repo.

The historical table below is from `56e9e5e` and is kept for the commentary
under it, which is still accurate:

| Gate | Result |
|---|---|
| `nub run test` | **185 passed**, 19 files (was 170 in 17) |
| `nub run typecheck` | clean |
| `nub run lint` | clean |
| `nub run build` | clean |
| `nub run verify:ui` | clean — **on a freshly built `dist/`; see the trap below** |
| `cargo test -p lan-sync` | **58 passed** (26 unit + 21 relay + 11 session) |
| `cargo clippy -p lan-sync --all-targets -- -D warnings` | clean (rustc 1.98.1) |
| CI Android APK | **green** on `9b6f3be` (run 91) and `7e9ec94` (run 92) — not re-run since; neither quick win touches `src-tauri` |

The 15 new tests are `join-link` (8) and `round-playback` (7).

Three traps, and the first is the one that matters:

- **`nub run verify:ui` does NOT build first, and CLAUDE.md says it does.**
  `tooling:verify-ui` is `node scripts/drive-app.mjs` with **no `dependsOn`**,
  so it drives whatever happens to be sitting in `dist/`. This session ran it
  after changing the join screen, watched it pass, and the `dist/` it had
  driven was **eight hours stale** — the change was not in the bundle at all.
  A real defect would have passed the gate silently. **Run `nub run build`
  yourself, immediately before `nub run verify:ui`,** until the target
  declares the dependency. Check `ls -la dist/` if in any doubt.

  Not fixed in this pass on purpose: `verify-ui-pages` needs
  `tooling:pages-build` (a different base) rather than `game-web:build`, so
  the two targets want different dependencies, and this repo has already been
  bitten by an Nx attribution change that looked like a one-liner (see
  `packages/tooling`'s `sourceRoot` below). It is worth doing, deliberately.

  **Analysed 2026-09-16, not yet implemented or approved.** The caution above
  is right, and there are two concrete reasons rather than a general unease.
  Anyone doing this should read both before editing, because the obvious fix
  is wrong in a way that looks right:

  1. **The pages build has no base path outside CI.** `tooling:pages-build`
     resolves it as `${PUBLIC_BASE_PATH:-${GITHUB_REPOSITORY#*/}}`. In Actions
     `GITHUB_REPOSITORY` supplies `snake-ladders`; on a laptop both are unset,
     so it builds with an **empty** base while `drive-app.mjs` serves it under
     `--base-path /snake-ladders`. A bare `dependsOn` therefore turns the pages
     gate red locally and green in CI, which reads as a real failure. The pages
     dependency has to pin `PUBLIC_BASE_PATH=/snake-ladders`.

  2. **Neither build declares `outputs`, and both write to the same `dist/`.**
     Nx caches the *target* but, with no `outputs`, restores no files — so a
     cache hit skips `vite build` and leaves whatever is already in `dist/`.
     Because `game-web:build` and `tooling:pages-build` share one output
     directory, that can be the *other* variant's bundle. So adding `dependsOn`
     **alone** produces a gate that looks fixed and can still drive the wrong
     bundle: the same defect, one layer down. Both builds need
     `outputs: ["{workspaceRoot}/dist"]` for a cache hit to restore correctly.

  This is the "two projects whose Nx inputs are fictional" cost that ADR 0018
  already records, surfacing in the place it does the most damage.

  The shape of the fix, then: `verify-ui` dependsOn `game-web:build`;
  `verify-ui-pages` dependsOn `tooling:pages-build` with the base path pinned;
  `outputs` declared on both builds; CLAUDE.md's command block updated, since
  it documents the current behaviour as though it were permanent. Verify it
  behaviourally rather than with a unit test — change a visible string, run
  `nub run verify:ui` **without** building, and confirm the screenshot shows
  the change; then run it twice to confirm the cached second run restores
  `dist/` rather than skipping it.

  Worth knowing either way: **CI never runs this gate.** `ci.yml` runs
  `typecheck,test,build` only, which is why nothing but a human catches a
  stale bundle today.


- **`vitest.config.ts` included only `*.test.ts`.** A `.tsx` test file was
  collected by nothing and would have "passed" by never running. Now
  `*.test.{ts,tsx}`. If you add a component test, confirm it actually ran.
- **clippy rejected the plan's own test code** (`single_match`). The container's
  stable was current this time (1.98.1, 2026-09-01), so the usual
  stale-toolchain trap did not apply — but run `rustup update stable` before
  trusting a clean clippy anyway.

### The order to pick this up in

1. Invoke `superpowers:using-superpowers` first — it is the bootstrap and sets
   the rule that skills come before any other action.
2. **A plan IS in flight**, which reverses what this list used to say. Plan 1
   (`plans/2026-09-17-chrome-and-layout-plan.md`) is being executed on the
   branch `claude/chrome-and-layout`, Tasks 1–2 done, Task 3 next; use
   `superpowers:executing-plans`. Work is on that branch rather than straight
   onto `main` at the owner's instruction (2026-09-17), which supersedes the
   2026-09-16 "work on main" note above. There is still no open PR, and nothing
   has been pushed to `origin/claude/chrome-and-layout`, and there is still no open
   PR. The host-served join plan is fully ticked, with an execution note
   under each task recording what it did not anticipate. Read those notes
   before assuming the plan text is what shipped.
3. **Build before you drive.** `nub run verify:ui` does not build; see the
   gates section. This is the trap most likely to make the next session
   believe a broken change is fine.
4. For hardware work, `docs/android-debugging.md`. For the design behind what
   just shipped, `docs/superpowers/specs/2026-09-16-host-served-join-design.md`
   and ADR 0019, whose consequences section now records that the listener
   speaks three protocols rather than two.

## Continuing locally

```bash
git clone <repo> && cd snake-ladders
git checkout claude/chrome-and-layout   # NOT main — the live work is here
bash scripts/provision.sh           # mise, the toolchain, nub, OpenCode, deps
nubx playwright install chromium    # only needed for nub run verify:ui
nub run test && nub run typecheck   # 185 tests in 19 files, clean types
```

`nub run typecheck` now runs Panda's codegen first, so a clean clone does not
need a separate `nubx panda codegen` to resolve `styled-system/*`. `nub run
test` does **not**, which does not matter yet and will the moment a component
test imports from there.

A Codespace and a Claude Code web session run `scripts/provision.sh`
themselves, through `.devcontainer/devcontainer.json` and the `SessionStart`
hook in `.claude/settings.json` respectively. ADR 0015 covers why it tolerates
partial failure and why mise and OpenCode have npm fallbacks. Nub has the same
fallbacks and is the one tool provisioning refuses to degrade on, because
nothing after it can run — ADR 0017.

For physical-device capture, switch to the host machine rather than trying to
route ADB through the Codespace:

```bash
mise install
mise x -- adb devices
mise x -- opencode
```

Pair/connect with wireless ADB, install the latest Android artifact, and save
the evidence bundle locally. The host must have Android Platform Tools and
Chrome; the Codespace remains the coordinator for source, Actions, Pages, and
report review.

`CLAUDE.md` holds the architecture and the invariants worth knowing before
changing anything. `docs/adr/` holds the decisions and what each one cost.

## Two traps in the delegation setup

Both were found by running it, and both fail quietly:

- **`opencode.json` agents must be `"mode": "all"`.** As `"subagent"` they
  cannot be selected by `opencode run --agent`, which warns once and falls back
  to the default `build` agent — an agent that can write files and run
  commands. The read-only guarantee is that one field.
- **Node's `fetch` ignores `HTTPS_PROXY`.** A reachability probe written with
  it bypasses the environment's proxy and reports the sandbox's own refusal, so
  a host the policy allows still looks blocked. `scripts/delegate.mjs` issues a
  proxy `CONNECT` instead when a proxy is configured.

## What `mise install` cannot fetch in a cloud session, and why it is fine

`mise install` reports `opencode`, `rust` and `java` as failed there. None of
it blocks work, and only one is fixable:

| Tool | Fails on | Fixable by allowlist? |
|---|---|---|
| Rust, OpenCode | GitHub releases API for an unattached repository | No — the GitHub proxy refuses at every access level |
| Java | `mise-versions.jdx.dev`, then `download.java.net` | Yes, but only if all three hosts are allowed |

The session already has `cargo`, `rustc`, `node`, `npm` and a JDK on `PATH`,
and OpenCode is installed from npm by `scripts/provision.sh`. So mise is doing
version pinning and task running here, not provisioning, and a partial install
is the expected steady state rather than a fault.

CI never uses mise at all — it pins Node, Rust and JDK 17 with `setup-node`,
`dtolnay/rust-toolchain` and `setup-java` — which is why none of this has ever
shown up there.

The JDK pin is now 21, matching what these environments ship, so a blocked
download falls back to the same major version the file declares rather than a
different one. mise still tries to fetch its own JDK 21 and still fails on
`download.java.net`; that is expected and costs nothing.

CI remains on 17 via `android.yml`, which does not read `mise.toml`. That gap
only reaches Android Gradle builds, which cannot run in a container regardless
(ADR 0011).
