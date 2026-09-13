# 0011. CI builds the Android APK; iOS stays manual

## Status

Accepted

## Context

Two problems pushed this decision. First, `src-tauri` is the one part of the
codebase nothing verifies: it needs a platform webview toolchain to compile at
all, so it was written but never built, while `crates/lan-sync` underneath it
is covered by tests that run anywhere (ADR 0005). Second, getting a playable
build onto a phone otherwise requires a developer workstation with the Android
SDK, the NDK, a JDK and the Rust Android targets installed.

Building on the phone itself was investigated and rejected. An on-device Linux
userspace supplies Node and shell tooling but no Android SDK, NDK or Rust, and
Google publishes the NDK for `linux-x86_64` only — there is no official
`linux-aarch64` build. Cross-compiling Rust to Android needs the NDK's
bionic-targeting clang, which a glibc ARM64 userspace cannot provide without
unofficial toolchain builds or emulation.

iOS is a separate matter. macOS cannot be containerised: Apple's licence
permits macOS virtualisation only on Apple hardware, so every macOS CI offering
is a VM on a real Mac, which is why GitHub bills those runners at ten times the
Linux rate. This repository is private, so its included minutes buy roughly a
tenth as many macOS minutes as Linux ones. Past that sits signing: an IPA
installable on a device requires an Apple Developer Program membership, and the
free-Apple-ID path works only through Xcode on a physical Mac, not headless CI.

## Decision

CI builds a debug Android APK on `ubuntu-latest` and uploads it as an artifact,
and runs the fast checks — typecheck, frontend tests, `cargo fmt`, `clippy` and
the `lan-sync` tests — on every push and pull request. Because `src-tauri/gen/`
is generated rather than committed, the Android job runs `tauri android init`
and then patches the generated manifest with the networking permissions the
game needs, via a script that is idempotent and fails loudly.

iOS gets no CI job. It is built by hand on a Mac by whoever has a developer
account.

## Consequences

The Tauri command layer is compiled on every push, so mistakes in it surface as
a red build rather than as a broken app on someone's phone. Anyone can install
the current build by downloading an artifact and sideloading it, with no local
toolchain. The manifest patch runs in the same place the APK is produced, which
matters because forgetting it yields an APK that installs and runs but whose
multiplayer fails for a non-obvious reason.

The costs are real. A debug APK is unsigned, so installing it means enabling
"install from unknown sources", and it is unfit for distribution. Android CI
runs are slow — a cold Rust cross-compile across four ABIs dominates the job —
and the first few runs of any new mobile pipeline usually fail before they pass.
`tauri android init` on every run means the build depends on generated output
that no one reviews.

Most significantly, iOS remains unverified by automation, so an iOS-specific
regression can only be found by a person with a Mac. Changing that means either
making the repository public, which makes GitHub-hosted macOS runners free, or
paying for macOS minutes; neither removes the signing requirement for an
installable build.
