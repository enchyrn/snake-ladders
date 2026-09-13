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

Both agents are declared `"mode": "all"`, not `"subagent"`. This is what makes
the restriction real: `opencode run --agent explore` on a subagent-only agent
prints a warning and **falls back to the default `build` agent**, which can
write files and run commands. The read-only guarantee lives entirely in that
one field.

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

Delegation needs `opencode.ai`, which the Trusted access level does not allow
(ADR 0015). Adding it to a **Custom** allowlist is sufficient and was verified
from a web session; a Codespace and a laptop need nothing. The wrapper detects
an unreachable Zen and says so rather than timing out.

That probe has to go through the environment's proxy to mean anything. Node's
`fetch` ignores `HTTPS_PROXY` unless `EnvHttpProxyAgent` is enabled, so probing
with it reported the sandbox's own refusal of a host the policy had already
allowed — a false negative that blocked delegation after the allowlist was
fixed. The wrapper now issues a proxy `CONNECT` when a proxy is configured and
falls back to `fetch` only when one is not.

One limitation is not ours: attaching repository files with `--file` sends
source to a third party, and Claude Code's auto-mode classifier blocks that
from inside a session. Delegating a review of a specific file therefore has to
be run by a person, not by Claude.
