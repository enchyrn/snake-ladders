# Architecture Decision Records

An ADR is a short document that records one significant architectural decision: the context that forced it, the decision made, and the consequences — including the costs — that followed. Add a new ADR whenever the project makes a decision that would be expensive to reverse, that trades away one desirable property for another, or that a future contributor would otherwise have to reverse-engineer from the code alone.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-deterministic-lockstep-engine-with-shared-dice-state.md) | Deterministic lockstep engine with dice drawn from shared state | Accepted |
| [0002](0002-twists-as-toggleable-rule-modules.md) | Each twist is a toggleable rule module over one engine | Accepted |
| [0003](0003-momentum-integer-arithmetic-not-physics.md) | Momentum stays integer arithmetic, not physics | Accepted |
| [0004](0004-rust-relay-orders-actions-only.md) | Rust relay orders actions and nothing else | Accepted |
| [0005](0005-networking-crate-outside-tauri-workspace.md) | Networking lives in a crate outside the Tauri workspace | Accepted |
| [0006](0006-udp-broadcast-discovery-with-manual-fallback.md) | UDP broadcast discovery, with join-by-address as the guaranteed fallback | Accepted |
| [0007](0007-threejs-renders-never-decides.md) | Three.js renders; it never decides | Accepted |
| [0008](0008-effect-atom-for-ui-state.md) | Effect Atom for UI state, alongside TanStack | Accepted |
| [0009](0009-progression-declared-at-join-trust-is-social.md) | Progression is declared at join time, and trust is social | Accepted |
| [0010](0010-vendor-superpowers-skills.md) | Superpowers skills vendored rather than installed as a plugin | Accepted |
| [0011](0011-ci-builds-the-android-apk-ios-stays-manual.md) | CI builds the Android APK; iOS stays manual | Accepted |
