# 0014. NX monorepo, requested but not adopted

## Status

Proposed — requested by the user, deliberately not done. Recorded so the
decision is not silently dropped.

## Context

The repository now holds several buildable units: the TypeScript app, a Rust
networking crate, the Tauri shell in its own cargo workspace, and a growing set
of scripts. The user asked for a refactor to "a valid NX monorepo".

## Decision

Not yet. The work was queued behind getting the game playable across devices
and has not been done.

The reasoning for the ordering, which is the part worth recording: NX solves
task orchestration and caching across many packages, and the current pain is
not there. There is one `package.json`, one npm install, and CI runs in about
forty seconds. The genuine cross-language boundary — TypeScript engine, Rust
relay — is one NX does not manage, because the Rust side is already split into
its own workspace precisely so it builds without the Tauri toolchain (ADR 0005).

## Consequences

Adopting NX later is straightforward: the boundaries that would become projects
(`src/engine`, `src/net`, `src/render`, the app shell) are already clean, with
the engine depending on nothing and the transport depending only on the engine's
types. Nothing done since has made it harder.

Deferring means the repository keeps a flat structure that will not scale if
more apps are added — a second frontend, or a headless replay tool — and that
each such addition raises the cost of the eventual migration.

If it is picked up, the honest reason to do it would be a second consumer of the
engine, not the current layout. A monorepo tool with one app in it is
configuration without a payoff.
