# 0015. One provisioning path for every environment

## Status

Accepted.

## Context

The project is now developed from four places: a laptop, a GitHub Codespace, a
Claude Code on the web session, and CI. Until now only CI had a written setup —
the others were provisioned by whoever happened to be sitting there, and
`mise.toml` pinned a toolchain that nothing actually installed. A Codespace had
no `devcontainer.json` at all, so it got whatever the default image shipped,
and a web session started with no mise and no OpenCode despite both being
pinned.

Each environment also has a different, non-negotiable network policy. A Claude
Code on the web session runs at the **Trusted** access level, which reaches
package registries and GitHub but answers `403` to `mise.jdx.dev` and
`opencode.ai`. Separately — and independently of the access level — its GitHub
proxy scopes API and release-asset requests to repositories attached to the
session, so anything fetched from another repository's releases fails there
permanently.

## Decision

One script, `scripts/provision.sh`, is the only provisioning path. The
devcontainer's `postCreateCommand`, the `SessionStart` hook in
`.claude/hooks/`, and a developer on a laptop all call it.

It degrades rather than fails. Tools it cannot fetch are reported and skipped;
only `npm install` is fatal, because that is what the test suite needs.

Two fallbacks exist because of the policies above, and both are load-bearing:

- **mise is installed from npm first**, and from `mise.jdx.dev` only as a
  fallback. The npm registry is reachable from every environment we target; the
  installer's own host is not.
- **OpenCode is installed from npm when mise cannot fetch it.** mise resolves
  OpenCode through aqua, which reads the GitHub releases API for
  `anomalyco/opencode` — an unattached repository, so the proxy returns 403.
  mise's own npm backend is not a substitute: it installs with
  `--ignore-scripts`, and OpenCode's postinstall is what downloads the platform
  binary, so the tool installs but will not run.

## Consequences

A fresh environment of any kind reaches a working checkout with one command,
and the toolchain cannot drift between them, because there is only one
definition of it to drift from.

The cost is a script that knows about specific network policies. Those are not
ours and can change; when they do, the failure is visible — provisioning
reports which tools resolved — but the workaround may become dead code that
nobody notices is dead.

Tolerating partial provisioning is the other real cost. A session can start
with Rust or Java missing and only discover it when a Cargo command fails.
That is still better than the alternative: failing the whole session over a
toolchain that most tasks in this repository never touch, given the Tauri shell
cannot be built in a container anyway (ADR 0011).

The environment-level fix is a user's to make, not the repository's: raising a
cloud environment to **Custom** network access and allowing `opencode.ai` and
`mise.jdx.dev` removes the first fallback's reason to exist. Allowing
`opencode.ai` was done and verified — delegation runs from a web session now.

It does **not** remove the second. The GitHub repository scope applies at every
access level, so the npm path for OpenCode is permanent for cloud sessions, and
a `mise install` there will keep reporting a partial toolchain.
