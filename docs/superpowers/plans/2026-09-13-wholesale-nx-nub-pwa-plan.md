# Wholesale Nx, Nub, and PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved wholesale Nx/Nub workspace refactor, Pages-first PWA distribution, host-local Android debugging workflow, Effect/Rust quality audits, and shared-relay preparation for Android/PWA rooms.

**Architecture:** Nx owns the TypeScript project graph and inferred targets across physical `apps/` and `packages/` projects. Nub and Node 24 provide the JavaScript toolchain through Mise; Cargo and Tauri remain native authorities behind explicit orchestration targets. GitHub Pages provides static HTTPS PWA hosting, while a TLS WebSocket relay remains the shared transport for mixed Android/PWA rooms.

**Tech Stack:** Node 24 LTS, Mise, Nub, Nx official React/Vite/JS/workspace plugins, React, Vite, vite-plugin-pwa, Vitest, Effect, Three.js, Rust/Cargo, Tauri v2, GitHub Actions, Android Platform Tools, Chrome DevTools Protocol.

**Spec:** `docs/superpowers/specs/2026-09-13-wholesale-nx-nub-and-pwa-design.md`

## Global Constraints

- The migration is a clean break: npm is not a supported developer or CI interface after migration.
- The engine remains pure and deterministic; no wall-clock, ambient random input, or unordered iteration enters the engine.
- Dice are drawn from the shared PRNG during resolution and are never sent by clients.
- Node 24 LTS is the JavaScript runtime floor.
- Cargo remains authoritative for Rust and Tauri remains authoritative for native packaging.
- HTTPS PWA network transport uses `wss://`; GitHub Pages does not host the relay.
- No optimization changes rules, ordering, error semantics, or replay results without regression evidence.
- Codespace orchestration does not assume access to USB devices, ADB, LAN multicast, or WebView sockets.
- Physical-device capture is host-local, read-only, and produces evidence outside source control.

---

## Task 1: Establish Pages Deployment and Phase 1 Capture Contract

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `vite.config.ts`
- Modify: `src/pwa/register.ts`
- Modify: `src/routes/home.tsx` only if the deployed base path exposes a route defect
- Modify: `scripts/drive-app.mjs`
- Create: `docs/android-debugging.md`
- Modify: `docs/playing-together.md`
- Test: existing UI verification and built `dist/` inspection

**Interfaces:**
- Produces Pages URL shape `https://<owner>.github.io/<repository>/`.
- Produces a documented host-local capture command using the APK run ID and
  wireless ADB.
- Preserves existing hash routes and prompt-based service-worker updates.

- [x] Confirm the repository name and Pages Actions permissions, then add a workflow using `actions/upload-pages-artifact` and `actions/deploy-pages` with Node 24 and the currently supported package bootstrap until Task 3 replaces it.
- [x] Parameterize Vite `base` from the Pages deployment environment and make manifest, icon, service-worker, and precache URLs resolve below `/snake-ladders/` without changing native/Tauri paths.
- [x] Run `npm run build` and inspect `dist/manifest.webmanifest`, `dist/sw.js`, generated HTML, and icon URLs for root-absolute paths that would 404 on Pages.
- [x] Extend `scripts/drive-app.mjs` or its invocation so the built app is exercised under `/snake-ladders/` and hash routes survive refresh.
- [x] Document host-local capture: `adb pair`, `adb connect`, `adb install -r`, `adb logcat`, `chrome://inspect`, evidence directory contents, and the Codespace limitation.
- [x] Run `npm run build` and `node scripts/drive-app.mjs --base-path /snake-ladders/`; expected result is a successful build and no page errors, console errors, or horizontal overflow.
- [x] Commit: `feat: deploy pwa to github pages`.

> **Task 1 done, 2026-09-13.** Live at `https://enchyrn.github.io/snake-ladders/`
> from Actions run `34758473488`. Two things the plan did not anticipate, both
> recorded in `docs/handoff.md`: `workflow_dispatch` cannot fire a workflow that
> is not yet on the default branch, and the `github-pages` environment refuses a
> non-default branch until its deployment-branch policy is widened. Serving the
> deployed site over HTTPS also turned Task 8/9's shared TLS relay from an
> improvement into a hard blocker for network play in the browser — see the
> handoff's open threads.

## Task 2: Complete Phase 1 Device Verification

**Files:**
- Create locally outside the repository: timestamped evidence bundle
- Modify: `docs/handoff.md` with observed results only
- Test: latest successful `android.yml` artifact on host hardware

**Interfaces:**
- Consumes the APK artifact from the latest successful Android workflow.
- Produces a dated evidence report with APK SHA-256, device metadata, logs,
  screenshots, exact steps, and pass/fail results.

- [ ] On the host machine, install Android Platform Tools and confirm `adb devices` sees the Android device over wireless debugging.
- [ ] Download the latest successful `android-debug-apk` artifact and record workflow run, commit, artifact path, and SHA-256.
- [ ] Install the APK, launch package `dev.mutation.snakesladders`, and capture clean `logcat` from launch through the test session.
- [ ] Inspect the Tauri WebView through `chrome://inspect/#devices`; capture console errors and failed requests, using manual inspection if CDP forwarding is unavailable.
- [ ] Test offline pass-and-play, native host flow, room discovery/manual address fallback where a second endpoint exists, locking, and reconnect behavior.
- [ ] Test the PWA separately against the laptop relay for browser join, sequencing, refusal, reconnect, installation, and offline pass-and-play.
- [ ] Mark Android-native-host to PWA interoperability as unverified; do not infer it from separate transport tests.
- [ ] Update `docs/handoff.md` with observed results and remaining hardware blockers; do not claim checks that were not run.
- [ ] Commit only the handoff observation change: `docs: record phase one device verification`.

## Task 3: Verify Nub and Node 24 Bootstrap

**Files:**
- Modify: `mise.toml`
- Modify: `package.json` only as required by Nub/Nx migration
- Modify: lockfile generated by the selected Nub release
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/android.yml`
- Modify: `docs/tooling.md`
- Modify: `.github/copilot-instructions.md`

**Interfaces:**
- Produces a reproducible Node 24 + Nub environment launched by Mise.
- Produces the repository-approved installation command and lockfile format.

- [x] Verify the selected Nub release supports the repository's workspace install, lifecycle scripts, binaries, Node 24 selection, and Linux CI environment; record the exact version and command syntax.
- [x] Change Mise and GitHub Actions to Node 24 and add the exact Nub bootstrap without silently invoking npm.
- [x] Regenerate the JavaScript lockfile with Nub and verify a clean install from an empty dependency directory.
- [x] Update tooling docs and agent instructions so setup, test, build, and CI commands use Nub/Nx after their targets exist.
- [x] Run the clean bootstrap, current Vitest suite, typecheck, and production build before moving project files; expected result is behavior parity with the pre-migration baseline.
- [x] If Nub cannot satisfy a required operation, stop the migration at the failed boundary and record the exact incompatibility rather than adding an undocumented fallback.
- [x] Commit: `build: establish node24 and nub toolchain`.

> **Task 3 done, 2026-09-13**, at Nub `0.9.1` and Node `24.21.0`. ADR 0017
> records the decision. Three things the plan did not anticipate:
>
> - **Nub is not only a package manager**, so "the exact command syntax" is
>   `nub install` / `nub ci` / `nub run <script>` / `nubx <bin>`, plus
>   `nub node install|pin`, which is what provisions Node 24 from
>   `.node-version`. CI needs no `setup-node` at all: `nubjs/setup-nub@v0` is a
>   documented drop-in that reads that pin.
> - **The lockfile is `nub.lock`** (pnpm's format under another name), written
>   by `nub pm use nub`, which also deletes `package-lock.json` and writes
>   `devEngines.packageManager`. Nub will maintain a `package-lock.json`
>   instead; keeping both writers is what was rejected.
> - **The isolated layout found a phantom dependency on the first build.**
>   `workbox-window` reaches the client bundle through
>   `virtual:pwa-register` and was never declared — npm's hoisting had been
>   supplying it out of `vite-plugin-pwa`. Declared now. This is the failure
>   mode to expect when Task 4 moves files into `packages/`: a cross-project
>   import that resolves today only because everything is one flat tree.
>
> **The "stop at the failed boundary" step found one boundary**, and CI is what
> found it. Nub satisfies every operation the *web* pipeline needs, but the
> Tauri CLI cannot be launched through it: Tauri bakes the command Gradle uses
> to re-invoke it into the generated Android project, derives that command from
> `argv[1]` and `npm_execpath`, and has explicit cases for npm/npx/pnpm/yarn/bun
> and none for nub. Under `nubx` the Android build died in
> `:app:rustBuildArm64Debug` (`Cannot find module '…/src-tauri/tauri'`, run
> `34761512711`). So `android.yml` launches the CLI with `npx` and that is
> recorded in ADR 0017 rather than worked around — everything else, including
> `tauri.conf.json`'s before-commands, is nub. Green again on run
> `34762050952`, which produced the APK.
>
> Parity evidence: the production build is
> byte-identical to the npm baseline — 872 modules, the same asset hashes, 13
> precache entries — with 101 vitest tests, a clean `tsc --noEmit`, and both
> `verify:ui` runs green.
>
> Two deviations from the file list, both because leaving them would have
> broken something this task touched. `pages.yml` (listed under Task 5) had to
> move off `npm ci` the moment `package-lock.json` was deleted, and
> `src-tauri/tauri.conf.json`'s before-commands were still shelling out to npm,
> which the design forbids; the Android workflow is the feedback loop for that
> second one, and it runs on this branch.

## Task 4: Generate Nx Workspace and Physical Project Boundaries

**Files:**
- Create: `nx.json`
- Create: `apps/game-web/project.json` or plugin-generated equivalent
- Create: `apps/relay/project.json` or plugin-generated equivalent
- Create: `packages/engine/project.json` or plugin-generated equivalent
- Create: `packages/net/project.json` or plugin-generated equivalent
- Create: `packages/render/project.json` or plugin-generated equivalent
- Create: `packages/ui/project.json` or plugin-generated equivalent
- Create: `packages/app-shell/project.json` or plugin-generated equivalent
- Create: `packages/tooling/project.json` or plugin-generated equivalent
- Move: current `src/` files into the approved project directories
- Move: `scripts/lan-relay.mjs` into the relay project only if the generated target requires it
- Modify: TypeScript configs and Vite/Vitest configs for project references and aliases

**Interfaces:**
- Produces Nx projects named `game-web`, `relay`, `engine`, `net`, `render`,
  `ui`, `app-shell`, and `tooling`.
- Produces inferred `build`, `serve`, `test`, and typecheck targets where the
  installed Nx plugins support them; explicit targets are used only for relay,
  browser driving, icon generation, Cargo, Tauri, and deployment commands.

- [x] Install one compatible version set of `nx`, `@nx/workspace`, `@nx/react`, `@nx/vite`, and `@nx/js` through Nub.
- [x] Generate the workspace and projects with official Nx plugins; inspect inferred targets with `nx show project <name>` before adding handwritten configuration.
- [x] Move the engine first and repair imports until `engine` has no UI, renderer, transport, wall-clock, or random ambient dependency.
- [x] Move `net`, `render`, `ui`, and `app-shell` in dependency order; reject cycles instead of hiding them with aliases.
- [x] Move the Vite entrypoint into `apps/game-web` and preserve the Tauri `frontendDist` output contract.
- [x] Configure project tags and dependency constraints so engine cannot depend on higher-level projects and renderer cannot feed state back into engine.
- [x] Run `nx graph`, `nx show projects`, project-level typechecks, tests, and build; expected result is the same application and test behavior as baseline.
- [x] Run the determinism fuzz suite after every engine move and after the complete move.
- [x] Commit: `refactor: migrate typescript code to nx projects`.

> **Task 4 done** (commit `33089bf`). Also shipped, undetected at the time:
> the PWA lost all four icons — `root` moved to `apps/game-web` without a
> matching `publicDir`, orphaning the repo-root `public/`, dropping precache
> from 13 entries to 5, invisible to `verify:ui` because a manifest icon is
> only fetched at install time — fixed in `37ef141`. The dependency-order move
> was supposed to "reject cycles instead of hiding them with aliases", but
> `app-shell ⇄ ui` and `app-shell ⇄ net` went in hidden: aliases resolve in
> every direction and no boundary lint existed yet to reject either, so both
> cycles shipped as production code and a test import; broken by inverting the
> dependency (`ui` now exports pure views and a `RegisterServiceWorker` port,
> `app-shell` owns the subscriptions) in `6c971b3`. And this task's own
> verification step — project-level tests — was never actually run to a real
> result: three of four `*:test` targets shelled out `src/**/*.test.ts`
> through `nx:run-commands`, which runs with globstar off, so `**` collapsed
> to one directory level. `app-shell:test` matched zero of its 9 tests and
> still exited 0; `engine:test` and `net:test` only happened to sit at the one
> depth the collapsed glob still reached. Fixed in `50e8597` by giving all
> four targets a bare directory path instead of a glob. Every defect here was
> found and fixed on `docs/superpowers/plans/2026-09-14-nx-split-remediation-plan.md`.

## Task 5: Add Explicit Native and Deployment Orchestration Targets

**Files:**
- Modify: `nx.json`
- Create or modify: root/native project configuration for Cargo targets
- Create or modify: root/tauri project configuration for Tauri targets
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/android.yml`
- Modify: `.github/workflows/pages.yml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `docs/tooling.md`

**Interfaces:**
- Produces explicit targets for relay, browser verification, icons, Cargo fmt,
  clippy, lan-sync tests, Tauri Android initialization/build, and Pages deploy.
- Cargo and Tauri remain the implementation authorities behind those targets.

- [x] Add non-cached relay, icon, browser-drive, and external-deployment targets with declared inputs only where Nx can safely model them.
- [x] Add Cargo targets that invoke `cargo fmt --all -- --check`, `cargo clippy -p lan-sync --all-targets -- -D warnings`, and `cargo test -p lan-sync` without moving Cargo ownership into Nx.
- [x] Add Tauri targets that preserve Android manifest patching after `tauri android init --ci` and retain the pinned Java/NDK/Rust CI sequence.
- [x] Change Tauri frontend commands from npm scripts to the final Nx/Nub command only after the web target is green.
- [x] Run `nx run-many -t typecheck,test,build`, native targets, and the existing Android workflow; expected result is no loss of artifact or permission patching.
- [x] Commit: `build: orchestrate native and deployment targets with nx`.

> **Task 5 done** (commit `ad75af3`). Its own verification step ran on a CI
> job with no `nub` setup step for the Cargo targets it just added: routing
> `cargo fmt`/`clippy`/`test` through Nx means every Rust check now goes
> through `nubx`, and the runner that had never needed the JS toolchain for
> Rust before didn't have it — all three cargo checks would have failed
> command-not-found on the first push. Fixed alongside the `publicDir`
> regression in `37ef141`, on
> `docs/superpowers/plans/2026-09-14-nx-split-remediation-plan.md`. ADR 0018
> records the JS-toolchain-gates-Rust dependency this created as a standing
> cost, not a one-time bug.

## Task 6: Audit Effect Usage and Preserve Deterministic Boundaries

**Files:**
- Create: `docs/audits/2026-09-13-effect-audit.md`
- Modify: Effect-using application/session/transport files only when audit findings are approved
- Test: relevant `src/**/__tests__` successors under Nx projects

**Interfaces:**
- Produces an audit with findings classified as correctness, ownership,
  cancellation/concurrency, allocation, or no-change.
- Does not introduce Effect runtime state into the pure engine.

- [x] Inventory Effect schemas, error channels, runtime boundaries, resource scopes, cancellation, and concurrent transport/session operations.
- [x] Add or extend failing tests for any identified error, cancellation, duplicate-frame, gap, or late-commit behavior before implementation changes.
- [x] Apply only measured or test-backed improvements; leave stylistic rewrites documented as no-change decisions.
- [x] Run engine determinism tests, transport tests, full TypeScript tests, typecheck, and production build.
- [x] Write the audit conclusion and any rejected optimizations with reasons.
- [x] Commit: `audit: review effect runtime boundaries`.

> **Task 6 done** (commit `9e8de06`, `docs/audits/2026-09-13-effect-audit.md`).
> The audit's own accepted fix — resuming `join` on the relay's `welcome`
> frame rather than the socket's `open` event, to close a real ordering bug —
> left `connect` with no path out when a relay completes the WebSocket upgrade
> and then answers nothing: the `Effect.async` stayed pending forever and the
> player sat on a spinner with nothing to act on. This hang did not exist
> before the audit's fix and the audit did not list it. Bounded at ten seconds
> in `09d7f4c`, with a further fix in `8b5b477` for a timer that could
> otherwise close a live, superseded socket after an abandoned attempt. Both
> on `docs/superpowers/plans/2026-09-14-nx-split-remediation-plan.md`.

## Task 7: Audit Rust Integrity and Release Performance

**Files:**
- Create: `docs/audits/2026-09-13-rust-audit.md`
- Modify: `crates/lan-sync/**` only for approved findings
- Modify: `src-tauri/src/lib.rs` only for approved command/session findings
- Test: existing Rust integration tests and focused new tests/benches where justified

**Interfaces:**
- Preserves opaque action sequencing and `SessionSink` behavior.
- Produces release-profile evidence for every performance change.

- [x] Measure socket lifecycle, buffering, allocations, lock scope, shutdown, backpressure, frame parsing, and error propagation against existing tests.
- [x] Add a focused failing test before each correctness fix; add a benchmark only when it answers a concrete performance question.
- [x] Compare debug and release behavior with `cargo test -p lan-sync`, `cargo clippy -p lan-sync --all-targets -- -D warnings`, and `cargo fmt --all -- --check`.
- [x] Preserve the Tauri-independent `lan-sync` workspace and document hardware-only native validation.
- [x] Record findings, measurements, accepted fixes, and residual risks in the audit.
- [x] Commit: `audit: review rust transport integrity and performance`.

> **Task 7 done** (commit `1d36bde`, `docs/audits/2026-09-13-rust-audit.md`).
> The audit's own fix — tracking every accepted stream in a `pending` map
> before `shutdown` drains it — closed the wide race
> (`a_peer_notices_the_host_going_away`: 10 failures in 60 runs down to 0 in
> 310) but left a narrower one standing: the accept loop reads `running`, then
> takes the state lock to insert, and a connection accepted in that window is
> still missed by a concurrent `shutdown` — which now blocks on the very mutex
> the accept loop needs, so it tends to insert just after the drain. Measured
> at ~8000 sockets hammered at the shutdown instant: 777 left without a FIN
> before, 19 after — a ~40x reduction the audit's own residual-limits section
> does not mention, though "accepted sockets are now tracked before handshake"
> reads stronger than the code delivers. Closed by having `serve_client`
> observe `running` itself, in `6b7ccfd` and `9a1a519`, on
> `docs/superpowers/plans/2026-09-14-nx-split-remediation-plan.md`.

## Task 8: Implement Shared Relay Descriptor and QR Transport Phase

**Files:**
- Create: shared join-descriptor module in `packages/net` or the final approved transport project
- Modify: transport factory and WebSocket transport
- Modify: native transport selection so Android can be a relay client for mixed rooms
- Modify: lobby/join UI and route components
- Create: QR encode/decode UI module using a maintained QR library
- Test: descriptor, factory, WebSocket, relay, reconnect, and route tests

**Interfaces:**
- Produces a versioned descriptor containing transport kind, endpoint, room
  code/seed, and protocol version; it contains no game state or dice.
- Manual entry and QR entry call the same parser/validator.
- HTTPS uses `wss://`; local HTTP development may use `ws://`.

- [ ] Write failing tests for valid descriptors, malformed/versioned input, manual/QR equivalence, endpoint conversion, and transport selection.
- [ ] Implement the smallest typed descriptor parser/serializer and reject unsupported versions before connecting.
- [ ] Adapt the Android app’s network choice to connect through the shared relay when the descriptor identifies a mixed room, while preserving native LAN mode for native-only rooms.
- [ ] Add QR display, copyable text, scan/paste entry, connection status, refusal, reconnect, and late-join UI states without feeding UI state into the engine.
- [ ] Add live relay tests for two browser peers, an Android-compatible relay client path, late join, refusal, duplicate frames, and reconnect.
- [ ] Run determinism fuzzing and all transport tests; expected result is byte-identical state across every client path.
- [ ] Commit: `feat: add shared relay join descriptors and qr flow`.

## Task 9: Secure Relay, Pages, and Provider Verification

**Files:**
- Modify: `scripts/lan-relay.mjs` or create a TLS deployment adapter without weakening local development
- Modify: `.github/workflows/pages.yml`
- Create: `docs/deploying-relay.md`
- Create: `docs/audits/2026-09-13-opencode-zen.md`
- Modify: `docs/tooling.md` only for verified provider behavior

**Interfaces:**
- Produces a documented `wss://` relay deployment path with room lifecycle,
  capacity, and abuse boundaries.
- Produces a provider report without credentials, silent fallback, or secrets.

- [ ] Define TLS termination outside the relay process or add a narrowly scoped TLS adapter; retain `ws://` for local HTTP development.
- [ ] Verify Pages installability, offline startup, service-worker update prompts, and hash routes at `/snake-ladders/` after deployment.
- [ ] Run the exact OpenCode Zen model through both VS Code and standalone CLI where available; record provider/extension versions, authentication requirement, status/error category, rate limits, and incident date.
- [ ] Document only reproducible model-selection and fallback behavior; do not add credentials or automatic provider substitution.
- [ ] Commit: `docs: document secure relay and opencode provider behavior`.

## Task 10: Final Integration and Handoff

**Files:**
- Modify: `docs/handoff.md`
- Modify: `docs/playing-together.md`
- Modify: `docs/tooling.md`
- Modify: `CLAUDE.md` only if verified commands or boundaries changed

**Interfaces:**
- Produces a truthful verification ledger separating CI, browser, host-device,
  relay, Android, and unavailable iOS evidence.

- [ ] Run the complete Nx/Nub web suite, determinism fuzzing, Rust checks, Pages build, UI verification, and Android CI workflow.
- [ ] Run available host-local device acceptance and attach evidence paths without committing sensitive logs.
- [ ] Review the complete diff for dependency direction, generated-file churn, stale npm commands, root-absolute Pages URLs, and deterministic-engine violations.
- [ ] Update `docs/handoff.md` with completed tasks, exact commands and run IDs, remaining hardware/provider blockers, and the next checkpoint.
- [ ] Commit: `docs: record wholesale refactor verification handoff`.

## Execution Notes

Use an isolated worktree for the implementation plan. Dispatch one focused worker per task, review each task diff and test result before the next task, and keep the integration branch separate. Do not start Task 8 until Tasks 1-7 have produced green boundaries and the shared-relay contract is explicit.

The next session should begin with Task 1, inspect the existing uncommitted state, and run the narrow Pages build/verification before touching the Nx migration.
