# 0017. Nub is the package manager, and Node 24 is the floor

## Status

Accepted.

## Context

`docs/superpowers/specs/2026-09-13-wholesale-nx-nub-and-pwa-design.md` chose
Nub as the JavaScript package manager, runtime launcher and command interface,
and Node 24 as the runtime floor, ahead of the Nx project split. The design
also said the choice had to be *verified* rather than assumed: Nub is pre-1.0,
and the plan's own instruction was to stop at the failed boundary and record
the incompatibility rather than paper over it with a fallback.

Until now `docs/tooling.md` described Nub as an optional accelerator — "use npm
if it acts up" — and npm was the guaranteed path. That is the sentence this
ADR reverses, so it is worth saying what the verification actually found.

Nub 0.9.1 was installed from the npm registry and run against this checkout.
It covers every operation the repository needs: `nub install` and `nub ci` for
dependencies, `nub run` for the `package.json` scripts, `nubx` for
`node_modules/.bin`, and `nub node install/pin` for provisioning Node itself.
`nub node install 24` fetched Node 24.21.0 from nodejs.org in four seconds
inside a cloud container, and mise's registry already resolves `nub` through
`npm:@nubjs/nub`, so the existing provisioning path installs it with no new
network host to allow. CI has an official `nubjs/setup-nub@v0` action that is a
drop-in for `actions/setup-node@v4`.

One thing did break, and it is the interesting part. **Nub links
`node_modules` in an isolated, pnpm-style layout with no hoisting**, and the
production build failed under it:

```text
Error: [vite]: Rolldown failed to resolve import "workbox-window"
from "/@vite-plugin-pwa/virtual:pwa-register".
```

`virtual:pwa-register` — imported by `src/pwa/register.ts` — imports
`workbox-window` into the *application bundle*, but `workbox-window` is a
dependency of `vite-plugin-pwa`, not of this project. npm's flat layout hoisted
it to the root of `node_modules`, where Vite happened to find it. The app has
been bundling a package it never declared. That is a phantom dependency, and
npm was concealing it rather than satisfying it.

## Decision

Nub is the package manager, the script runner and the Node provisioner for
this repository. npm is no longer a supported interface.

- `nub.lock` is the lockfile. `package-lock.json` is deleted, so there is
  exactly one writer and no format to ping-pong between two tools. (Nub will
  happily maintain a `package-lock.json` instead; keeping both writers is what
  we rejected, not npm's format.)
- `package.json` declares `devEngines.packageManager = nub@^0.9.1` with
  `onFail: "ignore"`, which is what `nub pm use nub` writes.
- Node 24 is pinned in three places that must agree: `.node-version` (what Nub
  reads), `mise.toml` (what provisioning installs), and the CI workflows.
- `workbox-window` is declared as a runtime dependency at the version
  `vite-plugin-pwa` already resolved — runtime, not dev, because it ships in
  the client bundle alongside React and Three. The dependency was always real;
  only its declaration is new.

Cargo and Tauri remain the native authorities. `tauri.conf.json`'s
`beforeDevCommand` / `beforeBuildCommand` now call `nub run`, which is an
ordinary shell command and works.

**The Tauri CLI itself is launched with `npx`, and that is the one place npm
survives this migration.** It is a real incompatibility, not a preference, so
it is written down rather than worked around.

`@tauri-apps/cli`'s Node wrapper computes a name for the binary and hands it to
the Rust CLI, which bakes it into the generated Android project as

```kotlin
val executable = """{{tauri-binary}}"""
val args = listOf({{quote-and-join tauri-binary-args}})
project.exec { workingDir(File(project.projectDir, rootDirRel)) … }
```

Gradle runs that command later, from `src-tauri`, to re-enter the CLI for
`android-studio-script`. The wrapper picks between two forms: if
`npm_execpath` is set it emits a package-manager form, otherwise a path form,
`node <path relative to the CLI's cwd>`. The Rust side has explicit cases for
npm, npx, dlx and pnpm; it has none for nub.

Under `nubx`, `npm_execpath` is unset, so the path form is chosen — and the
path it records is relative to the repository root while Gradle runs it from
`src-tauri`. The Android build got as far as linking the arm64 `.so` and then
died in `:app:rustBuildArm64Debug` with

```text
Error: Cannot find module '…/snake-ladders/src-tauri/tauri'
```

(Actions run `34761512711`.) `nub run tauri` would take the other branch, since
`nub run` does set `npm_execpath` — measured — but the manager it names would
still be one the Rust side does not recognise, so that is a guess and an
eight-minute CI cycle per guess. Direct `./node_modules/.bin/tauri` fails the
same way `nubx` does, for the same reason.

So the CLI stays on `npx` until Tauri knows about nub. Everything around it —
installing dependencies, the frontend build, the whole web pipeline — is nub.

## Consequences

The isolated layout is the point, not a side effect. It found a phantom
dependency the first time it ran, on a package that ships in the production
bundle and reaches real devices. Every future one will surface the same way —
as a resolution failure at build time rather than a silent success that
depends on another package's dependency tree. The cost is that the failure
looks like a Nub bug until you read it closely; this ADR exists partly so the
next person reads it closely.

The Tauri exception above is the migration's one loose end, and it is loose in
a specific way: `npx` resolves through whatever Node is on `PATH`, which
`setup-nub` and `.node-version` do pin, so it is not unpinned — but it does
mean the Android job runs one command through npm's resolver rather than
nub's. If Tauri ever grows a nub case, or exposes the re-invocation command
directly, that line becomes `nubx` again and nothing else changes.

`npm ci` no longer works, because there is no `package-lock.json` to read.
Anything that assumed it does has to change with this commit or break: CI,
`scripts/provision.sh`, and the documented setup. A contributor who types
`npm install` gets a working `node_modules` and an untracked lockfile that
nothing else reads, which is a worse failure than an error — the defence is
that `devEngines` records the expectation and the docs no longer offer npm as
a path.

Hosted update bots cannot regenerate `nub.lock`. This repository configures
neither Dependabot nor Renovate, so nothing is lost today; the day one is
wanted, it will want a lockfile format it understands, and `nub pm use pnpm`
reverses this decision completely, which is the escape hatch.

Nub is pre-1.0 and pinned exactly, at `0.9.1`, in `mise.toml`, in
`devEngines`, and in the CI workflows. A pre-1.0 tool in the critical path is
a real risk and the pin is the whole mitigation: an upgrade is a deliberate
commit that re-runs the clean bootstrap, not something a fresh checkout picks
up on its own.

The one thing this does *not* buy is CI speed for its own sake. The install is
faster — around five seconds against npm's cold path — but the reason to adopt
Nub here is that the design chose it as the workspace command surface Nx will
sit on, and a second package manager alongside npm would have meant two
lockfiles and two layouts for the Nx migration to disagree about.
