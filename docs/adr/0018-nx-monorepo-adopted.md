# 0018. Nx monorepo, adopted

## Status

Accepted. Supersedes [ADR 0014](0014-nx-monorepo-not-adopted-yet.md).

## Context

ADR 0014 deferred the Nx split until there was a second consumer of the
engine, and recorded that the boundaries that would become projects were
already clean. That deferral ended: the split happened, on the layout ADR
0014 already anticipated —
`apps/{game-web,relay}` and `packages/{engine,net,render,ui,app-shell,tooling}`
— with Rust unmoved at `crates/lan-sync` and `src-tauri`, exactly as ADR 0005
kept it out of the Tauri workspace.

A boundary lint (`eslint.config.js`) went in on top of the split, running
`@nx/enforce-module-boundaries` against each project's `layer:*` tag. Neither
change had an ADR recording what it cost, which is the gap this closes.

## Decision

Adopt the Nx project graph as the structure, and the boundary lint as the
thing that makes it real. A tag on a directory is a label; the lint is the
rule that reads it and rejects an import that violates it, which is what
turns "the engine may import nothing internal" from a comment into something
`nub run lint` fails on.

## Consequences

**Cost:** there are three hand-maintained alias tables —
`tsconfig.json:20-26`, `vitest.config.ts:7-16`, and
`apps/game-web/vite.config.ts:90-94` — that must be edited in lockstep
whenever a project moves or a new one is added. No project has its own
`package.json` and there is no workspace protocol, so nothing catches the
three drifting apart except a build failing at whichever one was missed.

**Cost:** because there is no sub-`package.json` per project, nub's isolated,
no-hoisting layout is not exercised inside `packages/` — every dependency
still resolves from the single flat root `node_modules`. The phantom-dependency
trap ADR 0017 paid for (a package used but never declared fails to resolve) is
in force for the repository as a whole, but not per package the way a real
Nx-plus-workspaces setup would enforce it.

**Cost:** every `cargo` check for `lan-sync` now runs through an Nx target
rather than being invoked directly, so the Rust CI job needs the whole JS
toolchain installed just to run `cargo fmt`. The two-language boundary ADR
0014 called out as the one thing Nx does not manage is still true; Nx just
now sits in front of it.

**Cost:** `packages/tooling` and `native/` are Nx projects whose `sourceRoot`
points outside the project directory — at `scripts/` and `src-tauri/`
respectively — so the file sets Nx computes for their inputs are fictional.
That is safe only as long as their targets stay `cache: false`; the day
either target is cached, Nx will skip a rebuild it should have run because it
watched the wrong directory.

**Cost:** the boundary lint carries one declared exception,
`allow: ["@mutation/relay"]`, because Nx refuses to let a library import an
application, full stop, and `apps/relay/lan-relay.mjs` is both the runnable
relay and the sequencer the websocket tests run against. The exception is one
visible line rather than a relative import that would have reached past the
rule unseen, but it is still a hole in the rule that a future refactor
(splitting the sequencer out of the executable) would let close.

**What it bought:** per-project test, typecheck and lint targets instead of
one undifferentiated tree, and a graph that mechanically rejects the cycles
that were previously invisible. Two such cycles — `app-shell ⇄ ui` and
`app-shell ⇄ net` — existed before the lint could see them and were only
found once it was added; they had to be broken by inverting the dependency
direction (pure view components in `packages/ui`, subscriptions moved up into
`packages/app-shell`) rather than by the lint alone, because the lint rejects
a cycle, it does not fix one.
