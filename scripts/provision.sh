#!/usr/bin/env bash
#
# One provisioning path for every environment: a GitHub Codespace, a Claude
# Code on the web session, and a laptop. Each of those calls this script rather
# than carrying its own setup, so the toolchain cannot drift between them.
#
# It is deliberately tolerant. Provisioning runs where the network policy is
# not ours to choose — a Claude Cloud container reaches the npm registry but
# not mise.jdx.dev, the GitHub releases API, or opencode.ai — so a tool that
# cannot be fetched is reported and skipped, never fatal. The one thing that
# must work everywhere is `npm install`, because that is what the test suite
# needs; if that fails the script fails.
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
echo "==> npm install"
if ! npm install --no-audit --no-fund; then
  echo "!!  npm install failed — the test suite will not run" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
echo
echo "==> Ready"
note "mise:      ${MISE_STATE}"
note "toolchain: ${TOOLS_STATE}"
note "opencode:  ${OPENCODE_STATE}"
note "npm:       dependencies installed"
echo
note "Tests:     npm test          Types: npm run typecheck"
note "Delegate:  npm run delegate -- \"<prompt>\""
