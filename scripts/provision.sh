#!/usr/bin/env bash
#
# One provisioning path for every environment: a GitHub Codespace, a Claude
# Code on the web session, and a laptop. Each of those calls this script rather
# than carrying its own setup, so the toolchain cannot drift between them.
#
# It is deliberately tolerant. Provisioning runs where the network policy is
# not ours to choose — a Claude Cloud container reaches the npm registry but
# not mise.jdx.dev, the GitHub releases API, or opencode.ai — so a tool that
# cannot be fetched is reported and skipped, never fatal. The two things that
# must work everywhere are nub and `nub install`, because that is what the test
# suite needs; if either fails the script fails.
#
# Nub is the package manager (ADR 0017), so unlike mise and OpenCode it is not
# optional: there is no npm path left to fall back to.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# mise pings its own release channel on every invocation. That host is blocked
# in restricted environments, and the retries cost about a second each time.
export MISE_VERSION_CHECK=0

note() { printf '  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# Recorded for the summary at the end rather than printed as we go, so the
# report reads as one block instead of being interleaved with tool output.
MISE_STATE="not installed"
TOOLS_STATE="skipped"
OPENCODE_STATE="not installed"
NUB_STATE="not installed"

echo "==> Provisioning snake-ladders"

# ---------------------------------------------------------------------------
# mise
# ---------------------------------------------------------------------------
# The documented install is `curl https://mise.jdx.dev/install.sh | sh`, which
# is the right thing on a laptop and unreachable in a locked-down container.
# The npm build is the same release and the npm registry is reachable from
# every environment we target, so it is tried first and the installer is the
# fallback rather than the other way round.
if have mise; then
  MISE_STATE="already present ($(mise --version 2>/dev/null | head -1))"
elif have npm && npm install -g mise >/dev/null 2>&1 && have mise; then
  MISE_STATE="installed from npm ($(mise --version 2>/dev/null | head -1))"
elif have curl && curl -fsSL https://mise.jdx.dev/install.sh 2>/dev/null | sh >/dev/null 2>&1; then
  export PATH="$HOME/.local/bin:$PATH"
  have mise && MISE_STATE="installed from mise.jdx.dev ($(mise --version 2>/dev/null | head -1))"
fi

# ---------------------------------------------------------------------------
# Pinned toolchain
# ---------------------------------------------------------------------------
# `mise install` is all-or-nothing in its exit code but not in its effect: it
# installs what it can reach and fails on the rest. Node, Rust and Java are
# present in most of these images already, so a partial result is normal and
# not worth failing over.
if have mise; then
  if mise install 2>&1 | tail -3; then
    TOOLS_STATE="all pinned tools resolved"
  else
    TOOLS_STATE="partial — some tools were unreachable (see above)"
  fi
fi

# ---------------------------------------------------------------------------
# Nub
# ---------------------------------------------------------------------------
# The package manager (ADR 0017), so this is the one tool besides the
# dependencies themselves that is not allowed to degrade. mise resolves it
# through its registry entry `npm:@nubjs/nub`, so `mise install` above has
# usually already done this; the npm and install-script paths exist for an
# environment with no mise.
#
# The pin is read from mise.toml rather than repeated, so there is one place to
# change it. NUB is the command the rest of this script runs.
#
# Where mise owns the install that is the resolved *path*, not `mise exec --`:
# `mise exec` installs every pinned tool before running anything, so one
# unreachable tool — java, reliably, in a cloud container — would abort an
# install that has nothing to do with it.
NUB_PIN="$(sed -n 's/^nub *= *"\(.*\)".*/\1/p' mise.toml | head -1)"
NUB_PIN="${NUB_PIN:-0.9.1}"
NUB=(nub)

if have mise && MISE_NUB="$(mise which nub 2>/dev/null)" && [ -x "$MISE_NUB" ]; then
  NUB=("$MISE_NUB")
  NUB_STATE="via mise ($("${NUB[@]}" --version 2>/dev/null | tail -1))"
elif have nub; then
  NUB_STATE="already present ($(nub --version 2>/dev/null | tail -1))"
elif have npm && npm install -g "@nubjs/nub@${NUB_PIN}" >/dev/null 2>&1 && have nub; then
  NUB_STATE="installed from npm ($(nub --version 2>/dev/null | tail -1))"
elif have curl && curl -fsSL https://nubjs.com/install.sh 2>/dev/null | bash >/dev/null 2>&1; then
  export PATH="$HOME/.nub/bin:$PATH"
  have nub && NUB_STATE="installed from nubjs.com ($(nub --version 2>/dev/null | tail -1))"
fi

if [ "$NUB_STATE" = "not installed" ]; then
  echo "!!  nub could not be installed — it is the package manager, so nothing" >&2
  echo "    below this point can run. See docs/adr/0017-*.md." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# OpenCode
# ---------------------------------------------------------------------------
# mise resolves OpenCode through aqua, which reads the GitHub releases API. In
# a Claude Cloud session that API is scoped to this repository and answers 403
# for anomalyco/opencode, so mise cannot fetch it there. The npm package is the
# same release. It must be installed *with* its lifecycle scripts, because the
# postinstall is what downloads the platform binary — this is also why mise's
# own npm backend does not work for it, as mise installs with --ignore-scripts.
OPENCODE_PIN="$(sed -n 's/^opencode *= *"\(.*\)".*/\1/p' mise.toml | head -1)"
OPENCODE_PIN="${OPENCODE_PIN:-1.18.30}"

if have mise && mise which opencode >/dev/null 2>&1; then
  OPENCODE_STATE="via mise ($(mise exec -- opencode --version 2>/dev/null | tail -1))"
elif have opencode; then
  OPENCODE_STATE="already present ($(opencode --version 2>/dev/null | tail -1))"
elif have npm && npm install -g "opencode-ai@${OPENCODE_PIN}" >/dev/null 2>&1 && have opencode; then
  OPENCODE_STATE="installed from npm ($(opencode --version 2>/dev/null | tail -1))"
else
  OPENCODE_STATE="unavailable — delegation will be disabled"
fi

# ---------------------------------------------------------------------------
# Project dependencies
# ---------------------------------------------------------------------------
# `install` rather than `ci`: these containers cache their filesystem after
# provisioning, and install reuses an existing node_modules where ci would
# delete and refetch it every time.
echo "==> nub install"
if ! "${NUB[@]}" install; then
  echo "!!  nub install failed — the test suite will not run" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
echo
echo "==> Ready"
note "mise:      ${MISE_STATE}"
note "toolchain: ${TOOLS_STATE}"
note "nub:       ${NUB_STATE}"
note "opencode:  ${OPENCODE_STATE}"
note "deps:      installed with nub"
echo
note "Tests:     nub run test      Types: nub run typecheck"
note "Delegate:  nub run delegate -- \"<prompt>\""
