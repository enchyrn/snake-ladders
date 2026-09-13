# GitHub Copilot Instructions

This file tells GitHub Copilot how to behave in this repository.

## Skill bootstrap

Load the repository-vendored Superpowers bootstrap at
`.claude/skills/using-superpowers/SKILL.md` before doing anything. It
establishes the rule that relevant skills must be invoked before any response
or action, including clarifying questions.

## Pre-work reading

Before writing or editing code, read:

1. `CLAUDE.md` — architecture, invariants, and the determinism contract.
2. `docs/handoff.md` — what has been verified, what has not, and the open
   threads in priority order.

These files are the single source of truth. Do not guess at conventions; look
them up.

## Workflow

1. **Design approval first.** Propose the change before writing code. Wait for
   explicit approval.
2. **Follow conventions.** Match existing code style, use the libraries already
   in `package.json` / `Cargo.toml`, and respect the determinism contract in
   `CLAUDE.md`.
3. **Verify before claiming completion.** Run the relevant test commands and
   read the output. Do not claim "done" without a green build.

## Commands

```bash
nub install              # nub, not npm — see ADR 0017
nub run test             # vitest, all suites
nub run typecheck        # tsc --noEmit
nub run build            # typecheck + production bundle
cargo test -p lan-sync   # Rust networking crate
```

`nub.lock` is the lockfile and there is no `package-lock.json`, so `npm ci`
fails. `nubx` replaces `npx`. Node 24 is the floor, pinned in `.node-version`.

## Determinism

The engine (`src/engine/`) is pure: no `Math.random`, no `Date.now`, no
iteration over unordered collections. Dice are drawn from the shared PRNG
stream during resolution, never sent by a client. Break this and two phones
silently play different games.
