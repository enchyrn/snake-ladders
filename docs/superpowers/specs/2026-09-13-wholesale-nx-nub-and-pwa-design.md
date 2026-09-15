# Wholesale Nx, Nub, and PWA Architecture

Date: 2026-09-13
Status: Proposed

## Intent

Refactor the repository into a genuine Nx monorepo with physical TypeScript
project boundaries, make Nub the supported Node package/runtime/task workflow,
and prepare the second PWA phase around QR room joining and a secure browser
transport. The refactor also includes explicit Effect TS and Rust quality gates
and a provider investigation for OpenCode Zen model failures.

The migration is a clean break. npm is not a supported developer or CI
interface after the migration. Cargo remains authoritative for Rust, and the
Tauri toolchain remains authoritative for native packaging; Nx orchestrates
those commands but does not replace them.

## Constraints

- Node 24 LTS is the supported JavaScript runtime.
- The engine remains pure and deterministic. No wall-clock or ambient random
  input may enter `src/engine` or its successor project.
- Every device must fold the same ordered action log to byte-identical state.
- Dice remain drawn from the shared engine PRNG during resolution.
- Public browser hosting must not require an insecure `ws://` connection from
  an HTTPS PWA.
- The existing native LAN transport and browser relay behavior must remain
  available while the new transport contract is introduced.
- No optimization may change rules, ordering, error semantics, or replay
  results without an explicit design decision and regression evidence.
- Work is performed in isolated worktrees and integrated only after review.

## Target Workspace

The repository becomes an Nx workspace with physical project boundaries:

```text
apps/
  game-web/       React + Vite PWA and browser application
  relay/          WebSocket relay executable

packages/
  engine/         deterministic reducer, rules, RNG, schemas, tests
  net/            transport interfaces and implementations
  render/         Three.js scene, geometry, textures, timelines
  ui/             reusable gameplay UI components
  app-shell/      routing, session composition, atoms, app hooks
  tooling/        shared TypeScript, Vitest, and browser test support

crates/
  lan-sync/       Cargo-owned networking crate

src-tauri/        Tauri-owned native shell and Android project boundary
native/           Nx project wrapper for the Cargo targets above
```

The Rust tree is the one part of this design that was not carried out: the
implementation left `crates/lan-sync` and `src-tauri` where Cargo and Tauri
already expected them, and `native/` holds only an Nx `project.json` pointing
at both. Moving them would have meant teaching Tauri a new path for a gain
that is presentational, so the diagram above records where they actually are.

The physical move is intentional: Nx project boundaries should describe real
ownership and dependency direction rather than merely label folders in the
existing `src/` tree. The engine has no UI or transport dependency. Transport
may depend on engine vocabulary but not rendering. UI and app-shell may depend
on engine, transport, and rendering adapters without feeding renderer state
back into the engine.

The first design pass must verify the dependency graph before moving files. A
cycle or an import that crosses a boundary without a declared dependency is a
migration blocker, not something to hide with path aliases.

## Nx and Nub

Nx is the workspace graph and task orchestration layer. Use official plugins
and inferred targets wherever the installed versions support the repository's
Vite and React setup:

- `@nx/workspace` for workspace configuration and generators.
- `@nx/react` for the React application and React libraries.
- `@nx/vite` for Vite build, serve, and related project targets.
- `@nx/js` for non-UI TypeScript libraries and package outputs.
- The current supported lint/test integrations where they match the installed
  toolchain; do not add plugins only to manufacture targets.

The exact plugin versions must be resolved as one compatible Nx release set.
Inferred targets are preferred over handwritten `project.json` duplication.
Handwritten targets are reserved for commands Nx cannot infer cleanly:

- relay process execution and relay-specific tests;
- PWA icon generation and browser driving;
- Cargo format, clippy, and lan-sync tests;
- Tauri Android initialization, manifest patching, and APK/AAB builds;
- release or deployment commands with external credentials.

Nx targets should expose the complete developer surface, including affected
checks and project graph inspection. Targets that start servers or depend on
mutable external state must not be cached. Typecheck, deterministic tests, and
production builds may be cached only after their inputs and outputs are
explicitly declared and verified.

Nub becomes the required package manager, runtime launcher, and command
interface. The implementation must verify the current Nub release supports:

- workspace dependency installation and lockfile generation;
- lifecycle and binary execution needed by Nx plugins;
- Node 24 selection and CI installation;
- the repository's native module and Vite/Three.js toolchain;
- reproducible installs on Linux CI and the contributor environments named in
  the documentation.

Nub must not be treated as an implicit fallback. Unsupported behavior gets a
small explicit adapter target or blocks the migration until the integration is
understood. The resulting repository must not silently invoke npm through
Nub-compatible aliases. The lockfile, setup instructions, CI commands, Tauri
frontend command, agent instructions, and docs all use the selected Nub
workflow.

Cargo stays outside the JavaScript dependency graph as a build authority. Nx
may invoke Cargo through explicit targets so one command can verify the whole
workspace, but it must not pretend to understand Cargo workspace membership,
Rust feature resolution, Android NDK state, or Tauri-generated files.

## Effect TS Review

Before or during the move, audit Effect usage rather than mechanically
rewriting it. The review covers:

- schema construction and module initialization, including the primitive
  vocabulary that prevents cycles;
- whether domain failures use typed error channels consistently;
- whether effects are composed at the application boundary instead of leaking
  runtime concerns into the pure engine;
- resource, cancellation, and concurrency semantics in transport/session code;
- unnecessary runtime wrappers, repeated parsing, and avoidable allocations;
- tests for error branches, cancellation, duplicate frames, gaps, and late
  commits;
- whether the engine's deterministic reducer remains free of Effect runtime
  state, wall-clock access, and unordered iteration.

The output is an audit report with measured or test-backed recommendations.
Refactors are accepted only when they improve ownership, failure semantics, or
measured performance without changing the public behavior. Effect should not
be introduced into pure reducer code merely for stylistic consistency.

## Rust Review

Audit `crates/lan-sync` and the Tauri command/session boundary for integrity and
performance. Review socket lifecycle, buffering, allocations, task shutdown,
backpressure, lock scope, frame parsing, and error propagation. Add focused
benchmarks or diagnostics only where they answer a concrete question.

Use release-profile measurements for any optimization claim. Preserve the
opaque-action relay contract: Rust assigns sequence numbers and distributes
frames; it does not interpret game rules or derive game state. Keep the crate
independent of Tauri so it remains testable in ordinary Linux CI.

The audit must cover:

- `cargo test -p lan-sync` and real TCP/UDP integration behavior;
- `cargo clippy -p lan-sync --all-targets -- -D warnings`;
- `cargo fmt --all -- --check`;
- a documented release build/profile comparison when code changes are
  performance motivated;
- shutdown, reconnect, full-room, junk-frame, and late-join behavior.

Native packaging remains constrained by available Android SDK/NDK, WebKit,
Xcode, signing keys, and physical devices. The design must distinguish what
CI proves from what requires hardware.

## PWA Phase Two: QR and Transport

Design QR as a representation of a versioned join descriptor, not as a second
protocol. The descriptor should contain only the information required to join:
transport kind, relay or host endpoint, room code/seed, and a version marker.
It must not contain game state or client-supplied dice. Parsing and validation
must be shared by manual entry and QR entry so they cannot diverge.

The browser flow should be:

1. Host chooses local or network play.
2. The app creates or receives a room descriptor.
3. The UI displays a shareable QR and copyable text representation.
4. A joining device scans or pastes the descriptor.
5. The transport factory validates the descriptor, chooses the transport from
   player intent, and connects.
6. The numbered action log, late-join catch-up, refusal, reconnect, and
   desync semantics remain unchanged.

For an HTTPS PWA, network transport must use a TLS-capable `wss://` relay. The
URL parser must preserve `ws://` for local HTTP development and select `wss://`
for hosted HTTPS deployments. GitHub Pages hosts only static files; it cannot
run the relay. Relay hosting, lifecycle, TLS termination, capacity limits,
room expiration, and abuse controls are a separate deployment boundary.

The PWA deployment must support repository subpaths through Vite base-aware
assets, manifest values, service-worker registration, and hash routing. The
service worker must retain prompt-based updates so it cannot replace the engine
bundle during an active match. QR and transport work requires tests for:

- descriptor versioning and malformed input;
- local versus network transport selection;
- HTTP/HTTPS endpoint conversion;
- QR/manual-entry equivalence;
- late join, reconnect, refusal, and duplicate frames;
- service-worker scope and deployed subpath behavior;
- two browser peers against a TLS relay.

## OpenCode Zen Investigation

Treat OpenCode Zen failures as a tooling/provider spike before changing
repository code. Reproduce with the exact configured model identifier and
record:

- provider and extension versions;
- authentication state and whether a key is required;
- HTTP status/error category and retry behavior;
- model availability and rate-limit behavior;
- whether failures occur in the VS Code agent launcher, the standalone
  OpenCode CLI, or both;
- the date and relevant upstream status/incidents.

Document a deterministic model-selection policy with a free-provider fallback
only when the provider contract supports it. Do not add credentials, retry
loops, or silent model substitutions. If repository configuration is needed,
keep provider settings separate from application build configuration and never
commit secrets.

## Codespace, Host, and Device Debugging

The development workspace currently runs in a Codespace, while physical
Android debugging happens on the user's host machine. The workflow must not
assume that a Codespace can see USB devices, Android wireless debugging, LAN
multicast, or Chrome DevTools sockets.

The Codespace coordinates source revisions, GitHub Actions, Pages builds, APK
metadata, checklists, and evidence review. A host-local OpenCode session owns
`adb`, device installation, WebView/CDP attachment, `logcat`, screenshots, and
physical-device reproduction. Host capture is read-only and produces a local
evidence bundle containing the APK run/commit/SHA-256, device metadata, logs,
screenshots, and exact reproduction steps. `chrome://inspect` remains the
fallback when automated CDP attachment is unavailable.

Do not route ADB through Codespaces port forwarding by default. It adds network
exposure and unreliable routing. Mise is the outer toolchain provisioner on
both environments: `mise x -- ...` runs pinned Node 24, Rust, Java, OpenCode,
and other tools without requiring shell activation. Nub remains the
JavaScript package/runtime workflow inside that environment, and Nx remains
the project graph/task layer. Physical capture still requires host-installed
Android Platform Tools and Chrome.

## GitHub Pages Before PWA Phase Two

GitHub Pages deployment is promoted ahead of QR and transport implementation
so test devices can install the current PWA over HTTPS. The workflow must use
the `/snake-ladders/` repository base path, make Vite/manifest/icon/service
worker URLs base-aware, preserve hash routing and prompt updates, and verify
installation plus offline pass-and-play on Android and iPhone.

Pages is static hosting and does not run the WebSocket relay. Browser
multiplayer continues to use a separately hosted or laptop-local relay until
a TLS-capable `wss://` deployment exists.

## CI and Verification

The CI migration is staged by authority:

- Node 24 and Nub setup first, with a clean install check.
- Nx graph and inferred-target validation.
- Web typecheck, deterministic tests, production build, and browser UI drive.
- Cargo formatting, clippy, and lan-sync tests.
- Android debug build using the existing pinned Java/NDK/Rust setup.
- Pages build and subpath inspection.
- Release and physical-device checks only where signing keys, hardware, or
  external relay infrastructure exist.

The minimum final verification set is:

```text
nub install
nx graph
nx show projects
nx affected -t typecheck,test,build
nx run-many -t typecheck,test,build
nx run game-web:verify-ui --base-path /repository-name
cargo fmt --all -- --check
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo test -p lan-sync
```

The exact Nub command spelling and Nx target names are fixed in the
implementation plan after the compatibility spike. The plan must not claim
that Android, iOS, QR scanning, TLS relay operation, or multi-device play are
verified unless the required environment exists and the check has actually
run.

## Delivery Order

1. Verify Nub/Nx/Node 24 compatibility and generate the workspace skeleton.
2. Move TypeScript projects and make inferred targets green.
3. Add explicit orchestration targets for relay, Cargo, Tauri, PWA, and
   deployment surfaces.
4. Run the Effect TS and Rust audits; implement only approved, measured fixes.
5. Design and implement the QR descriptor and transport phase against the
   stabilized project boundaries.
6. Add GitHub Pages and TLS-relay verification paths.
7. Investigate and document OpenCode Zen provider behavior.
8. Run integration review, determinism fuzzing, UI verification, Android CI,
   and available physical-device acceptance checks.

Each stage is reviewable and reversible at the branch level, even though the
end state intentionally removes the old npm workflow.

## One-Android-Device Acceptance Strategy

With only one Android device available, Phase 1 verifies the transports
separately. The Android APK exercises native hosting, discovery, manual
address fallback, locking, and reconnect behavior as far as the available
hardware permits. A PWA browser peer uses the laptop-hosted relay to exercise
browser joining, sequencing, late join, refusal, reconnect, installation, and
offline behavior.

This does not prove Android-native-host to PWA interoperability. Native
Android network mode currently uses raw LAN/TCP while the PWA uses the
WebSocket relay, and a browser cannot open the Android listener directly.

The Phase 2 transport design must therefore use one shared relay for mixed
participants:

```text
Android app ─┐
             ├── TLS WebSocket relay
PWA ─────────┘
```

The Android player may remain the game/lobby host at the product level, but
technically becomes a relay client for mixed Android/PWA rooms. Running a
WebSocket server directly on Android is deferred because an installed HTTPS
PWA would require TLS certificates, mixed-content handling, local-network
permissions, and mobile lifecycle management on the device itself.

## Sources and Evidence Baseline

The design should be checked against current primary documentation before
implementation, with access dates recorded in the plan or implementation
notes:

- Nx project configuration and inferred-target/plugin documentation:
  https://nx.dev/reference/project-configuration
- Nx installation and workspace guidance:
  https://nx.dev/docs/getting-started/installation
- Node release schedule:
  https://github.com/nodejs/Release/blob/main/schedule.json
- Nub canonical project:
  https://github.com/nubjs/nub
- Vite static deployment:
  https://vite.dev/guide/static-deploy.html
- GitHub Pages custom workflows:
  https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- vite-plugin-pwa deployment guidance:
  https://vite-pwa-org.netlify.app/deployment/
- Tauri Android signing:
  https://v2.tauri.app/distribute/sign/android/
- Google Play target API requirements:
  https://developer.android.com/google/play/requirements/target-sdk
- Effect documentation:
  https://effect.website/docs/
- Rust performance and profiling guidance:
  https://nnethercote.github.io/perf-book/
  https://doc.rust-lang.org/cargo/reference/profiles.html

External claims must be rechecked at implementation time because Node, Nx,
Nub, provider availability, and deployment-action versions change.
