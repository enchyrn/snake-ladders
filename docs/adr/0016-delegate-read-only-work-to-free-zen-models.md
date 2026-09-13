# 0016. Delegation to OpenCode runs free Zen models, and is read-only

## Status

Accepted.

## Context

OpenCode is pinned in `mise.toml` and configured in `opencode.json`, and
OpenCode Zen offers several models that cost nothing. That makes delegating
work to a second agent cheap enough to be worth wiring up properly rather than
leaving as a CLI someone might remember to run.

The question is what to delegate. The engine's correctness rests on every
device folding the same log to byte-identical state, and the ways to break that
are quiet: a `Math.random` in a rule module, iteration over a `Set`, a
comparison that falls back to insertion order. None of those fail loudly, and a
free model is no more likely to respect an invariant it has to infer than to
introduce one of them.

## Decision

Delegation is read-only. The `explore` and `review` agents in `opencode.json`
have `write`, `edit`, `patch` and `bash` switched off, and `scripts/delegate.mjs`
defaults to `explore`.

The free Zen models are the default: `opencode/mimo-v2.5-free` for the agents
and `opencode/nemotron-3.5-lightning-free` as the small model.

`scripts/delegate.mjs` preflights rather than passing the call straight
through, because `opencode run` fails three ways that look identical from a
script — the binary is missing, Zen is unreachable, or the account has no Zen
access — and each has a different fix.

## Consequences

Delegation is genuinely useful for the read-heavy half of the work: locating
code, answering how a module is wired, reviewing a diff against the determinism
contract. It cannot be used to parallelise implementation, which is the thing
people usually want from a second agent.

Free Zen models are promotional, and some of them may train on what is sent.
This repository is private, so anything delegated should be treated as
disclosed. That is a reason to keep delegation pointed at questions about code
rather than at code containing anything sensitive — there is nothing secret in
this repository today, and that could change.

The model IDs are the fragile part. They are promotional, so they will be
retired; when one is, `opencode models` lists what replaced it and the two IDs
in `opencode.json` are the only places to change. A missing model fails at the
model layer, which is exactly the case the wrapper's exit message points at.

Delegation cannot run from a Claude Code on the web session at all, because
`opencode.ai` is outside the Trusted allowlist (ADR 0015). It works from a
Codespace and a laptop. The wrapper detects this and says so rather than
timing out.
