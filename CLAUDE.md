# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev              # Vite dev server on :1420
npm run dev -- --host    # also serve on the LAN, so phones can open it
npm test                 # vitest, all suites
npm run typecheck        # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run build            # typecheck + production bundle

cargo test -p lan-sync   # Rust networking crate (real TCP/UDP sockets)
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all

npm run relay            # WebSocket relay; prints the join string to paste
npm run verify:ui        # build first, then drive the app in a real browser
npm run verify:ui:pages  # the same, but served from the /snake-ladders/ subpath

PUBLIC_BASE_PATH=/snake-ladders npm run build   # what the Pages workflow builds
```

`verify:ui` screenshots the app at phone size and fails on console errors,
page errors or horizontal overflow. `--base-path /nested/path` reproduces
being served from a subdirectory, and nothing outside that prefix resolves —
a root-absolute URL that would 404 on GitHub Pages fails here instead. The
prefix must match the base the bundle was built with, hence the pair of
`verify:ui:pages` commands above. It needs `npx playwright install chromium`
once. Run it after any UI change: the clipped board, the not-found router and
the mis-styled disabled button were all found this way and none of them were
visible in the source.

One file, or one test by name:

```bash
npx vitest run src/engine/__tests__/rules.test.ts
npx vitest run -t "collapses a ladder into a snake"
cargo test -p lan-sync --test session
cargo test -p lan-sync a_late_joiner_catches_up
```

`mise.toml` wraps the common ones (`mise run test`), but npm and cargo are the
supported path and CI uses them directly.

`scripts/provision.sh` sets up a fresh environment — mise, the pinned
toolchain, OpenCode, npm dependencies. A Codespace runs it from
`.devcontainer/devcontainer.json` and a Claude Code web session from the
`SessionStart` hook in `.claude/settings.json`, so all three environments
provision identically (ADR 0015). It tolerates tools it cannot fetch and fails
only on `npm install`.

`npm run delegate -- "<prompt>"` hands a **read-only** task to OpenCode on a
free Zen model. The `explore` and `review` agents have write, edit, patch and
bash switched off deliberately: a free model is a reasonable reviewer of the
determinism contract and a poor author of code that has to honour it
(ADR 0016). The agents must stay `"mode": "all"`: as `"subagent"` they cannot be
selected by `--agent`, and OpenCode silently falls back to an agent that *can*
write. Delegation needs `opencode.ai` allowed, which is the default everywhere
except a cloud environment below **Custom** access.

The Tauri app cannot be built in most dev containers: it needs webkit2gtk on
Linux, an Android SDK+NDK for Android, and macOS with Xcode for iOS. **Do not
try to `cargo build` or `cargo check` `src-tauri/`** unless those are present.
CI builds the Android APK; `.github/workflows/android.yml` is the feedback loop
for anything in `src-tauri/src/lib.rs`.

## The determinism contract

This is the single most important thing about the codebase. Every device
in a match folds the same ordered action log through the same reducer and must
arrive at byte-identical state. Break this and two phones silently play
different games.

Consequences that constrain ordinary-looking changes:

- `src/engine/**` must be **pure**. No `Math.random`, no `Date.now`, no
  iteration over unordered collections, no floating point where an integer
  will do. The PRNG (`rng.ts`, xoshiro128\*\*) is carried *inside* match state
  and threaded through explicitly.
- **Dice are drawn from that shared stream during resolution**, never sent by
  a client. A `Commit` action carries no value.
- Resolution order must not depend on the order actions arrived over the
  network. Dice are drawn in seat order for exactly this reason.
- Ties break on `seat`, which is why seats are never renumbered, even when a
  player leaves.
- The renderer and the UI never feed anything back into the engine.

`src/engine/__tests__/determinism.test.ts` is the guard: it plays whole random
matches, folds the log on two independent instances, and asserts identical
results for every combination of rule modules. Run it after any engine change.

## Architecture

### Engine (`src/engine/`)

A pure reducer. `applyAction(state, action): Effect<MatchState, RuleError>` is
the only way state changes. `resolve.ts` folds one round; the four twists are
small modules under `rules/` that it composes, each gated by a flag in
`MatchConfig.modules`. A match with no modules is classic Snakes & Ladders, so
the modules are genuinely optional rather than load-bearing.

Module interaction is the usual source of bugs — e.g. a mine at the far end of
a ladder has to explicitly cancel the momentum that ladder granted. When adding
rules, add a test per combination rather than per module.

`primitives.ts` exists to break a cycle: `types.ts` and `events.ts` both need
the leaf vocabulary, and Effect schemas are built at module-init time, so a
cycle leaves one side holding `undefined`.

### Transport (`src/net/`)

One interface, `TransportService`, with three implementations chosen by
`factory.ts`:

| kind | in the installed app | in a browser |
|---|---|---|
| `local` | `local.ts` — pass-and-play | same |
| `network` | `lan.ts` — Tauri → Rust | `websocket.ts` → relay |

**Pick by what the player chose first, platform second.** Choosing by platform
alone once handed pass-and-play the LAN transport with no room open, and every
action failed. `factory.test.ts` pins that.

`store/match-client.ts` folds the numbered log: strict sequence order, early
commits buffered, duplicates ignored. It **never applies a local action
optimistically** — a player's own roll takes the same round trip as everyone
else's, because applying out of order diverges the PRNG stream.

An action the host sequenced but this device refuses is a **notice, not a
desync**: every device rejects it identically and stays consistent (it happens
when two players act at once). `desync` is reserved for a frame that cannot be
decoded, which means mismatched builds.

### Networking (`crates/lan-sync/` and `scripts/lan-relay.mjs`)

Two implementations of one sequencer: Rust for the native app, Node for
browsers. Both only assign sequence numbers and fan the log out — **no game
state, no rules**, actions are opaque JSON. They speak identical frames so a
peer cannot tell which it joined.

`crates/lan-sync` is deliberately outside the Tauri workspace and has zero
Tauri dependencies, so it builds and tests anywhere. `src-tauri` is a thin
command layer over it; the interesting part (the session pump) is behind the
`SessionSink` trait so it is testable without a webview.

**The room code is the match seed** — same code, same board, nothing sent. It
is derived in three places (`crates/lan-sync/src/lib.rs`, `src/app/hooks.ts`,
`scripts/lan-relay.mjs`) and a test pins the encoding to literals. If they ever
diverge, two devices build different boards and desync on the first roll.

### Renderer (`src/render/`)

A pure function of match state plus a replayed timeline the engine already
produced. An animation that stutters or is skipped cannot change a result.

Board text (tile numbers, minesweeper counts) is drawn into a 2D canvas and
uploaded as one texture, because a hundred label meshes would cost more than
the rest of the scene; it redraws only when the board changes.

`resize()` fits the board against **both** fields of view. On an upright phone
the horizontal one is narrower and binds first — sizing from the vertical alone
clipped the board's left and right columns off screen.

`BoardCanvas` gates tap-to-flag on movement under 8px and no second pointer, or
every drag to orbit would flag a tile.

## Conventions

- Comments explain **why**, never what. Match the density of the surrounding
  file; a comment restating the line below it is noise.
- ADRs in `docs/adr/` record decisions and their **costs**. Add one before
  implementing anything architectural, not after.
- Verify before claiming: run the command and read the output. For UI, drive
  the built app headlessly and look at a screenshot — the clipped board, the
  invisible event log, and the disabled-looking-enabled button were all found
  that way and none were visible in the source.
- `.claude/skills/` vendors the Superpowers skills (MIT, upstream commit
  recorded in its README). Refresh by re-copying, not by patching in place.

## Gameplay

`docs/rules.md` is the authoritative rules reference and is kept in step with
the engine. `docs/playing-together.md` covers getting devices connected.

## Picking up the work

`docs/handoff.md` is the current state: what is verified, what is not, and the
open threads in priority order. Read it before starting anything — it records
what has already been investigated and rejected, which is the expensive part to
rediscover.

Designed but unbuilt work lives in `docs/superpowers/specs/`.
