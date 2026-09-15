#!/usr/bin/env bash
#
# SessionStart hook for Claude Code on the web. It delegates to
# scripts/provision.sh so a web session, a Codespace and a laptop all provision
# through one path — see ADR 0015.
set -uo pipefail

# Local sessions already have a working checkout and their own toolchain; this
# only exists to set up a fresh remote container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

bash scripts/provision.sh

# provision.sh installs mise, nub and OpenCode into npm's global prefix when it
# has to fall back to npm for them, and that prefix is on PATH for the shell
# that runs this hook but not necessarily for the session's. npm is only ever a
# bootstrap here — nub is the package manager once it exists (ADR 0017).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  NPM_BIN="$(npm prefix -g 2>/dev/null)/bin"
  [ -d "$NPM_BIN" ] && echo "export PATH=\"${NPM_BIN}:\$PATH\"" >> "$CLAUDE_ENV_FILE"

  # Every mise invocation otherwise spends about a second retrying a release
  # check against a host the remote network policy blocks.
  echo 'export MISE_VERSION_CHECK=0' >> "$CLAUDE_ENV_FILE"
fi
