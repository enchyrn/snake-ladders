# 0005. Networking lives in a crate outside the Tauri workspace

## Status

Accepted

## Context

Tauri needs a full platform webview toolchain to build at all — webkit2gtk on Linux, Xcode and its SDKs on macOS, equivalent toolchains on Windows and mobile targets. That requirement makes anything built as part of the `src-tauri` crate untestable on a plain CI runner or a minimal container that doesn't carry that toolchain.

## Decision

All networking code lives in `crates/lan-sync`, a crate with zero dependencies on Tauri and its own membership in the Cargo workspace, separate from `src-tauri`. `src-tauri` is kept deliberately thin: it is a command layer that calls into `lan-sync` and nothing more. Inside `lan-sync`, the session pump that drives the network loop is written behind a `SessionSink` trait, so it can be driven in tests by a recording sink instead of real sockets when that's useful, while still being exercised over real TCP and UDP sockets for integration coverage.

## Consequences

Seventeen integration tests exercise real TCP and UDP socket behavior on any machine with a Rust toolchain and no webview present at all, which means networking logic gets tested on ordinary CI runners instead of requiring a full mobile-capable build environment for every change.

The cost is an extra crate boundary to maintain: types that cross between `lan-sync` and `src-tauri` have to be deliberately shared or converted, and the boundary has to be kept honest — anything that leaks a Tauri dependency into `lan-sync` defeats the purpose. More importantly, the thin `src-tauri` command layer itself is exactly the part these tests don't reach — it remains unverified by automated tests, so bugs in how commands marshal calls into `lan-sync` or expose its results to the frontend can still slip through and would only be caught by manual or platform-specific testing.
