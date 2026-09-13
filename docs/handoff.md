# Handoff

State of the branch `claude/snake-ladders-cross-device-3uu177` as of
2026-09-13, written so another session — or the same person on a different
machine — can pick it up without re-deriving anything.

Tasks 1 and 3 of the Nx/Nub/PWA plan are complete. Task 1 deployed the PWA and
it was opened on a real device; that deployment also settled a question the
plan had left open, and not in the direction anyone hoped — see open thread 1.
Task 3 moved the toolchain to Nub and Node 24, which is the base Task 4's Nx
migration sits on. Task 2 remains untouched and hardware-blocked.

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
- **Engine** — pure deterministic reducer, four rule modules. 101 TypeScript
  tests including a fuzz driver that plays whole random matches and asserts two
  independent peers fold to byte-identical state, for every combination of
  modules.
- **Rust relay** — 19 tests over real TCP and UDP sockets: ordering agreement,
  gapless sequencing under load, mid-match catch-up, readmitting a device that
  dropped off Wi-Fi, locked and full rooms, junk frames. **18 of them pass.**
  `a_peer_notices_the_host_going_away` fails about 3 in 7 CI runs and 3 in 25
  locally, and open thread 2 shows it is a defect in `host.rs`, not a flaky
  test. Do not read this bullet as saying the Rust suite is green.
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
  reporting three tools failed: `tsc --noEmit`, `vitest` (101), `vite build`,
  `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test -p lan-sync`
  (19, of which one fails intermittently — thread 2) all run. Sessions ship `node`, `npm`, `cargo`, `rustc` and a JDK
  already, so mise failing to *download* them costs nothing — and nub, which
  mise resolves through `npm:@nubjs/nub`, is one of the tools it *can* fetch
  here.
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

1. **A relay the deployed PWA can reach at all.** This was thread 6 and is now
  the top of the list, because deploying the site is what made it blocking
  rather than desirable. A page served over HTTPS — which is precisely what
  makes it installable — may not open a `ws://` socket, and the browser refuses
  it before the connection leaves the tab, so it fails identically whether or
  not a relay is running. `scripts/lan-relay.mjs` serves plain `ws` with no TLS,
  and the native host is a raw TCP listener no browser can dial under any
  scheme. So on the deployed site pass-and-play works and joining another device
  cannot, and no amount of fixing the client changes that. Closing it needs a
  relay reachable over `wss://`, which is an architecture decision before it is
  code: a certificate means a public host, which cuts against the promise that
  the game never touches the internet. ADR 0012 and 0013 are the prior art and
  this deserves its own ADR. Plan Tasks 8 and 9 cover the work.
2. **A peer can miss the host going away. This is a defect in `host.rs`, not a
  flaky test.** `a_peer_notices_the_host_going_away`
  (`crates/lan-sync/tests/session.rs:117`) fails in roughly 3 of 7 CI runs, and
  **reproduces locally at 3 in 25** — run the test binary directly in a loop
  rather than through `cargo test`, which is why single runs kept passing and
  it was nearly written off as CI noise. It predates the Nub migration and this
  branch changes no Rust.

  It always fails after the *full* 5s timeout, which is 250 polls at 20ms. That
  is not a timing margin, and chasing it with a longer timeout would bury it.

  The mechanism, read out of the code and consistent with every observation:

  - `serve_client` runs on its own thread, reads the peer's hello, and only
    *then* does `state.clients.insert(…)` (`host.rs:273`). Until that insert, an
    accepted connection exists only inside that thread.
  - `Host::shutdown` (`host.rs:136`) iterates `state.clients` and calls
    `stream.shutdown(Shutdown::Both)` on each. A peer that is connected but not
    yet inserted **is not in that map**, so its socket is never shut down.
  - Clearing `running` and joining `listener_thread` does not touch
    `serve_client` threads, so that peer's stream stays open, no FIN arrives,
    and the peer polls for five seconds seeing nothing.

  The test makes the race reachable because its settle step is a no-op:
  `pump_until(&peer, &mut sink, 0)` loops `while … commits().len() < want`, and
  with `want` of `0` that is false immediately, so it polls **zero** times and
  returns. The same no-op is at line 32. So `host.close()` can fire while the
  peer's registration is still in flight — which is exactly the window above.

  **This is a real gameplay failure**, not a test artefact: a player joining at
  the moment the host quits hangs instead of being told the host went away.

  Proposed, deliberately not applied here — it is Rust work outside Task 3's
  scope, in a crate this branch does not touch, and it belongs to the Rust
  audit (Task 7). `shutdown` needs to reach connections that exist before
  registration: either track every accepted stream (a registry the accept loop
  populates immediately and `serve_client` promotes on hello), or have
  `serve_client` observe `running` and close its own stream when it clears.
  Fix `host.rs` first and keep the test's race, then fix the `pump_until` no-op
  separately — fixing only the test would hide the defect it just found.
3. **Run host-local Android capture.** The Codespace cannot see the device.
  Use wireless ADB and a host-local OpenCode session to install the latest
  debug APK, inspect the WebView, capture `logcat`, and record evidence.
4. **Complete the available Phase 1 device checks.** With one Android device,
  test native behavior separately and use the laptop relay for the PWA. Do
  not claim Android-native-host to PWA interoperability yet.
5. **Perform the wholesale Nx refactor.** The Nub and Node 24 half is done
  (plan Task 3, ADR 0017); what remains is the project split, plan Task 4
  onward. Follow the approved implementation plan and preserve Cargo/Tauri as
  native authorities.
6. **Audit Effect TS and Rust.** Measure correctness, ownership, concurrency,
  allocation, and release performance before changing implementations.
7. **Add Rust-side logging.** A failure in `net_host`/`net_submit` is still
  difficult to diagnose. The TypeScript half of this thread is done: no banner
  renders a raw stack trace any more. Four call sites took `String(cause)` on a
  rejected `Effect.runPromise`, which renders Effect's FiberFailure dump — a
  minified bundle offset in a production build, and a player saw exactly that.
  They now take the `TransportError`'s own `reason` through `Effect.either`.
8. **The RPG layer.** Designed and approved, not built. See
  `docs/superpowers/specs/2026-09-13-rpg-layer-design.md`. Extend the fuzz
  driver before writing any class.
9. **iOS and pinch-zoom validation.** Both require hardware or interaction
  tooling unavailable in this Codespace.

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
  broke the app on a real phone. `src/net/__tests__/factory.test.ts` pins it.
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

## Agent Workflow Checkpoint

Each agent framework reads its own configuration to follow the same rules:

| Agent | Config source | Notes |
|-------|--------------|-------|
| Claude Code | `.claude/skills/` | Superpowers skills vendored; bootstrap in `using-superpowers/SKILL.md` |
| GitHub Copilot | `.github/copilot-instructions.md` | Points to the vendored Superpowers bootstrap, CLAUDE.md, and handoff |
| OpenCode | `opencode.json` | Plugin pinned to Superpowers `v6.3.0`; mise pins OpenCode `1.18.30`. Two read-only agents, `explore` and `review`, on free Zen models — see ADR 0016 |

All three share one contract: read the repo docs before editing, get design
approval before writing code, and verify before claiming completion.

**Next checkpoint:** Tasks 1 and 3 are complete and their steps are ticked in
`docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md`. Task 4 is
next.

Task 2 is next in the plan's order but is **hardware-blocked for a container
session**: it is host-local Android capture and needs a device, wireless ADB and
Chrome on the operator's own machine. `docs/android-debugging.md` is the written
procedure and has not yet been executed against hardware — whoever runs it first
should correct whatever turns out to be wrong.

Task 3 (Nub and Node 24 bootstrap) is **done** — see the note under it in the
plan, and ADR 0017. Nub `0.9.1` is the package manager, `nub.lock` is the
lockfile, `package-lock.json` is gone, and every workflow bootstraps through
`nubjs/setup-nub@v0`.

Two things from it that Task 4 should expect. First, the isolated
`node_modules` layout turns a phantom dependency into a build failure rather
than a silent success — it caught `workbox-window`, which reaches the client
bundle through `virtual:pwa-register` and had never been declared — so a
cross-project import that only resolves today because everything is one flat
tree will fail loudly the moment files move into `packages/`. That is the
desired behaviour; the fix is always to declare the dependency, never to switch
the linker back to hoisted. Second, `nx@23.2.1` is already a dependency and
installs cleanly under nub, so Task 4 starts from a working `nx` binary.

**Task 4 (the Nx workspace split) is the next task a container can do.**

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

The approved design is committed as `f773bf5` in
`docs/superpowers/specs/2026-09-13-wholesale-nx-nub-and-pwa-design.md`.
The implementation plan is
`docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md`.
Tasks 1 and 3 of that plan are done. Task 2 is hardware-blocked and Tasks 4
through 10 have not started.

### The order to pick this up in

1. Invoke `superpowers:using-superpowers` first — it is the bootstrap and it
   sets the rule that skills come before any other action.
2. Then `superpowers:executing-plans` (or `subagent-driven-development`, which
   the plan's own header prefers where subagents are available). The plan file
   carries that requirement in its first line; do not start from the task list
   alone.
3. Read this file and the design before touching code. The design is committed
   as `f773bf5`.
4. **Start at Task 4.** Tasks 1 and 3 are done and ticked; Task 2 is
   hardware-blocked and cannot be done from a container, and Task 4 does not
   depend on it.
5. Review each task's diff and test output before moving to the next. Keep
   `--auto` restricted to trusted, explicitly scoped prompts.

### Running OpenCode, and the one command that does not work

**`mise exec -- opencode` fails here, and so does `mise exec -- <anything>`.**
`mise exec` installs every tool in `mise.toml` before it runs anything, so the
java pin — unreachable in a cloud container — aborts a command that has nothing
to do with java:

```text
mise ERROR Failed to install tools: aqua:anomalyco/opencode@1.18.30, core:java@21
```

This trap has now cost two debugging sessions: once in `scripts/provision.sh`
and once in `scripts/delegate.mjs`. Both now resolve the *path* from
`mise which <tool>` and run that directly, which mise answers without
installing anything. Use the same shape yourself:

```bash
opencode --version            # provision.sh installs it globally from npm
"$(mise which nub)" run test  # when mise owns the tool
```

Verified on 2026-09-13:

- `opencode --version` resolves `1.18.30`, installed globally from npm by
  `scripts/provision.sh`.
- `mise which opencode` exits non-zero in a cloud session, because mise cannot
  fetch it there (the GitHub releases API is scoped to this repository), so
  `scripts/delegate.mjs` falls through to that global binary. The mise-owned
  branch of that fallback is therefore **unexercised here** — it is the one
  `mise which` path no cloud session can reach.
- `opencode.ai` answers 200 through the proxy in this environment.
- The OpenCode project plugin loads the vendored Superpowers bootstrap and
  exposes the native `skill` tool.
- OpenCode logs duplicate skill names because Claude's project-scoped vendor
  and the OpenCode plugin both register Superpowers skills. This is currently
  non-blocking, but should be resolved before treating the integration as
  warning-free.
- **Delegation works, and it is slow.**
  `nub run delegate -- "Reply with exactly DELEGATE_OK…"` answered
  `DELEGATE_OK` from `explore` on `mimo-v2.5-free`, exit 0 — after more than
  three minutes. A 180s timeout killed it mid-flight and looked exactly like a
  blocked host or a broken binary. Give a free Zen model **five minutes** before
  concluding anything is wrong; it is a free tier and it queues.
- Free Zen models still need an account (`opencode auth login`). This container
  already had one, which is why the run above succeeded; a fresh container that
  has never authenticated will not delegate however reachable the host is.

## Continuing locally

```bash
git clone <repo> && cd snake-ladders
git checkout claude/snake-ladders-cross-device-3uu177
bash scripts/provision.sh           # mise, the toolchain, nub, OpenCode, deps
nubx playwright install chromium    # only needed for nub run verify:ui
nub run test && nub run typecheck   # 101 tests, clean types
```

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
