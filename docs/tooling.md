# Developer Tooling

This project uses **npm** as the guaranteed, supported package manager and build tool. Everything works with plain `npm` and nothing in CI requires anything else.

## Provisioning

One script sets up every environment:

```bash
bash scripts/provision.sh      # or: npm run provision
```

It installs mise, the pinned toolchain, OpenCode and the project dependencies,
and prints what resolved. It is idempotent — a second run costs a second — and
it is wired in everywhere, so you rarely run it by hand:

| Environment | Runs it via |
|---|---|
| GitHub Codespaces | `postCreateCommand` in `.devcontainer/devcontainer.json` |
| Claude Code on the web | the `SessionStart` hook in `.claude/settings.json` |
| A laptop | by hand, once |

It degrades instead of failing. Where the network blocks a tool, it says so and
carries on; only `npm install` is fatal, because the test suite needs it. See
ADR 0015 for why the fallbacks exist.

### Network policy

Restricted environments allow the npm registry but block other hosts, which is
why mise and OpenCode are installed from npm when their own hosts are
unreachable. In a Claude Code cloud environment you can lift this yourself: set
**Network access** to **Custom**, tick *Also include default list of common
package managers*, and add

```text
opencode.ai
mise.jdx.dev
```

`opencode.ai` is the one that matters — delegation needs it, and it takes
effect in a running session with no restart.

The rest of mise's downloads cannot be fixed this way, and are not worth
chasing:

- **Rust and OpenCode** read the GitHub releases API for repositories not
  attached to the session. The GitHub proxy refuses those at *every* access
  level, so no allowlist entry helps.
- **Java** needs `mise-versions.jdx.dev` and `download.java.net` on top of
  `mise-java.jdx.dev`; allowing only the last gets past the version lookup and
  still fails on the download.

None of this blocks anything, because a cloud session already ships `node`,
`npm`, `cargo`, `rustc` and a JDK. mise's value here is pinning and its task
runner, not fetching. Everything CI runs — `tsc`, `vitest`, `vite build`,
`cargo fmt`, `cargo clippy`, `cargo test` — passes in a session where
`mise install` reports three tools failed. CI itself never uses mise: it pins
Node, Rust and JDK 17 with `setup-node`, `dtolnay/rust-toolchain` and
`setup-java`.

The one real gap is the JDK version: sessions carry 21, `mise.toml` pins 17.
That matters only for Android Gradle builds, which cannot run in a container
anyway (ADR 0011) and get their own JDK 17 in `android.yml`.

## Getting Started with Mise

**mise** (https://mise.jdx.dev) pins the toolchain and runs the common tasks.
`scripts/provision.sh` installs it, so you usually have it already — install it
by hand only if you are not using the provisioning script:

```bash
curl https://mise.jdx.dev/install.sh | sh   # or: npm install -g mise
mise install
```

OpenCode loads the same Superpowers release as the project-scoped Claude skills
through `opencode.json`.

To activate mise in a new shell, run:

```bash
eval "$(mise activate bash)"
```

Then launch OpenCode with:

```bash
mise exec -- opencode
```

Then run common tasks with:

```bash
mise run test       # Run all tests
mise run typecheck  # TypeScript type checking
mise run lint       # Rust linting
mise run fmt        # Format Rust code
mise run build      # Build the project
```

OpenCode users can load the native Superpowers skills with its `skill` tool.
The project plugin is pinned to `v6.3.0` so it stays aligned with the vendored
skills under `.claude/skills`.

## Delegating to OpenCode

OpenCode runs as a second agent on free OpenCode Zen models. Delegation is
**read-only** by design — the agents have their write, edit, patch and bash
tools switched off. A free model is a good way to answer "where is X" or "does
this diff break the determinism contract", and a poor way to edit an engine
whose correctness rests on byte-identical state across devices (ADR 0016).

```bash
npm run delegate -- "where is the dice stream threaded through resolve?"
npm run delegate -- --agent review --file src/engine/resolve.ts "review this"
```

Two agents are defined in `opencode.json`:

| Agent | Model | For |
|---|---|---|
| `explore` *(default)* | `opencode/mimo-v2.5-free` | where something lives, how it is wired |
| `review` | `opencode/nemotron-3-ultra-free` | reviewing a change against `CLAUDE.md`'s invariants |

`scripts/delegate.mjs` checks the binary, the network and the exit code
separately, because `opencode run` fails all three ways with the same shape.
Its network probe goes through `HTTPS_PROXY` when one is set — Node's `fetch`
otherwise ignores the proxy and reports a blocked host for one that is allowed.

Both agents are `"mode": "all"` rather than `"subagent"` on purpose. Running
`--agent` against a subagent-only agent makes OpenCode fall back to its default
`build` agent, which **can write files and run commands** — the read-only
guarantee rests on that one field, so leave it alone.

Attaching files with `--file` sends source to a third party, which Claude
Code's auto-mode classifier blocks from inside a session. Run those yourself.

### First run

Free Zen models still need an account — they just do not bill for tokens:

```bash
opencode auth login      # choose "OpenCode Zen"
```

List what is currently free with `opencode models | grep free`. The IDs are
promotional and get retired; when one does, update the two in `opencode.json`.

**Free models may train on what you send them.** Nothing in this repository is
sensitive today, so delegation is fine — but treat anything delegated as
disclosed.

### Running OpenCode directly

```bash
mise exec -- opencode                                   # interactive
mise exec -- opencode run --format json "your prompt"   # scripted
```

**`--auto` bypasses all permission prompts.** It lets the agent write files,
run commands, and make network requests without asking. Use it deliberately —
only when you trust the prompt and have reviewed the agent's previous output.
Never run `--auto` on untrusted input.

**Important:** Mise is optional. Every command works with plain `npm` and `cargo`, and it is not required or used in CI. Use it if you like, or skip it entirely—both approaches are fully supported.

## Optional: Nub for Faster Node Operations

**nub** (https://github.com/nubjs/nub) is an optional, pre-1.0 Rust-written Node toolkit that can accelerate `npm install` and `npm run` commands. It is **not required** and **not in CI**.

To try nub:

```bash
# Install globally
npm i -g @nubjs/nub

# Or use the install script
curl -fsSL https://nub.sh | sh
```

Then use `nub` in place of `npm` and `nubx` instead of `npx`:

```bash
nub install
nub run dev
nubx tsc --noEmit
```

**If nub causes issues:** Simply fall back to npm. Nub is pre-1.0 and not a prerequisite for contributing. It is opt-in speed, and npm is always the safe path.

## Command Reference

This table maps mise tasks to their underlying commands if you're not using mise:

| Task       | Mise Command       | Raw Commands                          |
|------------|--------------------|---------------------------------------|
| Test       | `mise run test`    | `npm test && cargo test -p lan-sync`  |
| Type Check | `mise run typecheck` | `npx tsc --noEmit`                  |
| Lint       | `mise run lint`    | `cargo clippy -p lan-sync --all-targets` |
| Format     | `mise run fmt`     | `cargo fmt --all`                     |
| Build      | `mise run build`   | `npm run build`                       |
| Provision  | `mise run provision` | `bash scripts/provision.sh`         |
| Delegate   | `mise run delegate` | `npm run delegate -- "<prompt>"`     |

## Summary

- **npm** is the guaranteed path—use it for everything and nothing breaks.
- **mise** is optional—nice for unified task running and toolchain pinning, but not required.
- **nub** is an opt-in accelerator for Node operations. It's pre-1.0, so use npm if it acts up.
- **OpenCode** is a read-only second agent on free Zen models. Useful for questions and review, not for writing code.
