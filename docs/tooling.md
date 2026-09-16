# Developer Tooling

This project uses **nub** as the package manager, script runner and Node
provisioner. npm is not a supported interface: there is no `package-lock.json`,
so `npm ci` fails, and the lockfile is `nub.lock`. Node 24 is the runtime
floor. [ADR 0017](adr/0017-nub-is-the-package-manager-node-24-is-the-floor.md)
records why, and what it cost.

```bash
nub install              # from package.json + nub.lock, reusing node_modules
nub ci                   # clean, lockfile-strict — what CI runs
nub run <script>         # a package.json script
nubx <bin>               # a node_modules/.bin binary; replaces npx
```

The version is pinned exactly, at `0.9.1`, in `mise.toml`, in `package.json`'s
`devEngines`, and in the CI workflows. Nub is pre-1.0; the pin is the whole
mitigation, so upgrading is a deliberate commit that re-runs the clean
bootstrap.

## The one thing that bites

Nub links `node_modules` in an **isolated layout with no hoisting**, where npm
flattens everything to the root. A package this project imports but never
declared in `package.json` was only ever reachable through that flattening, and
under nub it fails to resolve.

That is not hypothetical: the first production build under nub died on

```text
Error: [vite]: Rolldown failed to resolve import "workbox-window"
from "/@vite-plugin-pwa/virtual:pwa-register".
```

`workbox-window` ships in the client bundle and belonged in `dependencies` all
along — npm's hoisting had been satisfying it out of `vite-plugin-pwa`'s own
tree. **The fix for this class of failure is to declare the dependency**, not to
add `node-linker=hoisted` to `.npmrc`, which would restore the flat layout and
hide the next one.

## The one command that is still npm

`.github/workflows/android.yml` launches the Tauri CLI with **`npx tauri`**,
not `nubx tauri`. This is deliberate and is the only npm left in the build.

The Tauri CLI bakes the command Gradle will use to re-invoke it into the
generated Android project, deriving it from `argv[1]` and `npm_execpath`. It
has explicit cases for npm, npx, pnpm, yarn and bun, and none for nub — so
under `nubx` it records a path-relative `node <path>` that Gradle then runs
from `src-tauri`, where it does not resolve, and the APK build dies in
`:app:rustBuildArm64Debug`. ADR 0017 has the detail and the failing run.

Everything around it is nub, including `tauri.conf.json`'s
`beforeDevCommand` / `beforeBuildCommand`, which call `nubx nx`.

## Nx target reference

Nx owns the JavaScript project graph and invokes the native tools without
replacing them. Live servers, browser drives, icon generation, Cargo checks,
and the Pages build are non-cached targets because they depend on external
processes or deployment state.

```bash
nubx nx run relay:serve
nubx nx run tooling:icons
nubx nx run tooling:verify-ui
nubx nx run tooling:verify-ui-pages
nubx nx run native:cargo-fmt
nubx nx run native:cargo-clippy
nubx nx run native:cargo-test
nubx nx run tauri:android-init  # npx is retained inside this target by design
nubx nx run tauri:android-build
nubx nx run tooling:pages-build
```

The Android target runs `tauri android init --ci` and immediately patches the
generated manifest before the build. CI still owns Java 17, the pinned Android
NDK, Rust targets, caching, and APK artifact upload; Nx only orchestrates those
commands. GitHub Actions remains the authority for the Pages deployment after
the Nx Pages build produces `dist/`.

## Provisioning

One script sets up every environment:

```bash
bash scripts/provision.sh      # or: nub run provision
```

It installs mise, the pinned toolchain, nub, OpenCode and the project
dependencies, and prints what resolved. It is idempotent — a second run costs a
second — and it is wired in everywhere, so you rarely run it by hand:

| Environment | Runs it via |
|---|---|
| GitHub Codespaces | `postCreateCommand` in `.devcontainer/devcontainer.json` |
| Claude Code on the web | the `SessionStart` hook in `.claude/settings.json` |
| A laptop | by hand, once |

It degrades instead of failing. Where the network blocks a tool, it says so and
carries on; only nub itself and `nub install` are fatal, because the test suite
needs them. See ADR 0015 for why the fallbacks exist.

Nub is the exception to that tolerance, because it is the package manager and
there is no npm path left behind it. It is resolved in four steps — mise's own
install, then a `nub` already on `PATH`, then `npm install -g @nubjs/nub@<pin>`,
then `https://nubjs.com/install.sh` — and the script exits non-zero if all four
fail. npm appears there as a *bootstrap* for the tool, which is a different
thing from using npm to manage the project's dependencies.

Where mise owns the install, provisioning runs nub through the path
`mise which nub` prints rather than `mise exec -- nub`. `mise exec` installs
every pinned tool before it runs anything, so one unreachable tool — java,
reliably, in a cloud container — would otherwise abort an install that has
nothing to do with it.

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
nub and Node with `nubjs/setup-nub`, and Rust and JDK 17 with
`dtolnay/rust-toolchain` and `setup-java`.

`nubjs/setup-nub@v0` is a drop-in for `actions/setup-node@v4`. It installs the
pinned nub, provisions the Node version from `.node-version` — so CI cannot
build on a different runtime from the one the tests ran on — and caches nub's
store against `nub.lock`. That is why no workflow names a Node version any
more.

`mise.toml` pins JDK **21** to match what these environments actually put on
`PATH`. mise still fetches its own copy where it can, so the pin does not save
a download — it means that when the download is blocked and the system JDK is
used instead, it is the same major version the file claims.

CI is the remaining divergence: `android.yml` pins its own **17** and never
reads `mise.toml`. That only affects Android Gradle builds, which cannot run in
a container anyway (ADR 0011). If you align them, change both and re-run the
Android build.

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
nub run delegate -- "where is the dice stream threaded through resolve?"
nub run delegate -- --agent review --file packages/engine/src/resolve.ts "review this"
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

**Important:** Mise is optional — it pins versions and wraps the common tasks,
and CI does not use it. Nub is not optional: it is the package manager, and
`nub` and `cargo` are the supported path.

## Installing Nub by hand

`scripts/provision.sh` installs it, so you usually have it already. The
documented alternatives, in the order provisioning tries them:

```bash
mise use -g nub@0.9.1                 # what provisioning prefers
npm i -g @nubjs/nub@0.9.1             # npm as a bootstrap for the tool only
curl -fsSL https://nubjs.com/install.sh | bash
brew install nub
```

Nub provisions Node itself, from `.node-version`:

```bash
nub node which        # which Node a script will run on, and why
nub node install      # fetch the project's pinned Node
```

## Command Reference

This table maps mise tasks to what `mise.toml` literally runs, not to the
per-project Nx targets of the same name — `mise run test` and `mise run
typecheck` predate the Nx split and were never rewired to route through it:

| Task       | Mise Command       | Raw Commands                              |
|------------|--------------------|-------------------------------------------|
| Install    | —                  | `nub install` (or `nub ci`, as CI does)   |
| Test       | `mise run test`    | `nub run test && cargo test -p lan-sync`  |
| Type Check | `mise run typecheck` | `nubx tsc --noEmit`                     |
| Lint       | `mise run lint`    | `cargo clippy -p lan-sync --all-targets`  |
| Format     | `mise run fmt`     | `cargo fmt --all`                         |
| Build      | `mise run build`   | `nub run build` (→ `nubx nx run game-web:build`) |
| Provision  | `mise run provision` | `bash scripts/provision.sh`             |
| Delegate   | `mise run delegate` | `node scripts/delegate.mjs`              |

The Type Check row is the one worth reading twice: `mise run typecheck` runs
`tsc --noEmit` against the **root** `tsconfig.json`, which includes every
project (`apps`, `packages`) in one pass. The Nx target of the same name,
`nubx nx run game-web:typecheck`, checks only `apps/game-web/tsconfig.json` —
the app project's own file set, not the libraries it depends on. The two are
not interchangeable: a type error inside `packages/engine` fails the mise
task and passes the Nx one.

## Summary

- **nub** is the package manager and script runner. `nub.lock` is the lockfile,
  `npm ci` no longer works, and a missing-module error means a dependency needs
  declaring (ADR 0017).
- **mise** is optional—nice for unified task running and toolchain pinning, but not required.
- **OpenCode** is a read-only second agent on free Zen models. Useful for questions and review, not for writing code.
