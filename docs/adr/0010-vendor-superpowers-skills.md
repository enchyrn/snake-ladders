# 0010. Superpowers skills vendored rather than installed as a plugin

## Status

Accepted

## Context

The Superpowers skill library (github.com/obra/superpowers, MIT licensed) provides workflow skills the team wants to use day to day — subagent dispatch, test-driven development, systematic debugging, and plan writing. It's distributable either through Claude Code's plugin marketplace mechanism or by copying its contents directly into the repository.

## Decision

We vendor the library's `skills/` directory into `.claude/skills/` in this repository, recording the upstream licence and the exact upstream commit it was copied from, rather than installing it as a plugin via the marketplace.

## Consequences

The skills work at project scope for anyone who clones the repository, with no per-machine installation or marketplace setup step required, and — importantly for this project's workflow — they work in remote Claude Code sessions where `/plugin marketplace add` is not available at all. This makes the skills a reliable, repository-level property rather than something that depends on each contributor's local Claude Code configuration.

The cost is that updates are now a manual re-copy operation rather than a version bump: pulling in an upstream fix or new skill means someone has to notice it upstream, copy the relevant files over again, and re-record the commit reference, rather than the tooling handling it automatically. This also means the vendored copy can silently drift from upstream over time — a bug fixed upstream, or a skill improved there, will not reach this repository until someone does that manual sync, and there's no automated check that flags when the vendored copy has fallen behind.
