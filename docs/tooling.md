# Developer Tooling

This project uses **npm** as the guaranteed, supported package manager and build tool. Everything works with plain `npm` and nothing in CI requires anything else.

## Getting Started with Mise

If you prefer a unified task runner and toolchain manager, you can use **mise** (https://mise.jdx.dev) to manage your development environment:

```bash
# Install mise if you haven't already
curl https://mise.jdx.dev/install.sh | sh

# Activate mise for this project
mise install
```

This also installs the pinned OpenCode CLI. OpenCode loads the same Superpowers
release used by the project-scoped Claude skills through `opencode.json`.

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

### Headless OpenCode recipe

For scripted or CI-adjacent use, run OpenCode non-interactively via mise:

```bash
mise exec -- opencode run --format json "your prompt here"
```

- `mise exec` activates the pinned toolchain (Node, Rust, OpenCode 1.18.30)
  without polluting the shell.
- `--format json` returns structured output suitable for parsing.
- Example with an explicit free model: `opencode run --model opencode/mimo-v2.5-free --format json "run the test suite"`

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

## Summary

- **npm** is the guaranteed path—use it for everything and nothing breaks.
- **mise** is optional—nice for unified task running and toolchain pinning, but not required.
- **nub** is an opt-in accelerator for Node operations. It's pre-1.0, so use npm if it acts up.
