# Handoff

State of the branch `claude/snake-ladders-cross-device-3uu177` as of
2026-09-13, written so another session — or the same person on a different
machine — can pick it up without re-deriving anything.

## What works, and how it was verified

- **Engine** — pure deterministic reducer, four rule modules. 94 TypeScript
  tests including a fuzz driver that plays whole random matches and asserts two
  independent peers fold to byte-identical state, for every combination of
  modules.
- **Rust relay** — 18 tests over real TCP and UDP sockets: ordering agreement,
  gapless sequencing under load, mid-match catch-up, readmitting a device that
  dropped off Wi-Fi, locked and full rooms, junk frames.
- **WebSocket relay + browser transport** — tested against a live relay: two
  clients fold identically, a late joiner catches up, a refusal surfaces
  instead of hanging, and a deliberate two-socket race still leaves both
  devices agreeing.
- **Android APK** — CI green, artifact produced and installed on a real phone.
- **PWA** — builds, precaches, installs from an HTTPS origin.
- **Provisioning** — `scripts/provision.sh` was run end to end in a Claude Code
  web container, which is the hostile case: it fell back to npm for both mise
  and OpenCode, reported the toolchain as partial, and exited 0. The
  `SessionStart` hook was run the same way and is idempotent.

## What has not been verified

- **`src-tauri/src/lib.rs` has no automated tests.** It compiles in CI via the
  Android build and that is all. Its session pump logic lives in
  `crates/lan-sync` behind `SessionSink` precisely so it *can* be tested; the
  thin command layer above it cannot be, without a webview.
- **iOS has never been built or run.** Everything said about it is inference
  from Apple's constraints, not observation.
- **Cross-device play has not actually been played.** The transports are
  tested; three phones in a room have not been. This is the single most
  valuable next thing to do, and it needs hardware this container does not have.
- **Pinch-zoom on the board** is code-reviewed, not driven — Playwright's mouse
  harness cannot simulate a second pointer.
- **No OpenCode delegation has actually completed a task.** `opencode.json`
  parses and both agents register (`opencode agent list` shows `explore` and
  `review`), and the wrapper's failure paths were exercised. The success path
  was not: `opencode.ai` is outside a web session's Trusted allowlist, so the
  first real delegation has to happen from a Codespace or a laptop.
- **`.devcontainer/devcontainer.json` has never been built.** It is the same
  script the web hook runs, but no Codespace has been created from it.

## Open threads, roughly in priority order

1. **Deploy the PWA to GitHub Pages.** Make the `/snake-ladders/` base path,
  manifest, service worker, hash routes, installation, and offline pass-and-
  play work before QR/transport changes.
2. **Run host-local Android capture.** The Codespace cannot see the device.
  Use wireless ADB and a host-local OpenCode session to install the latest
  debug APK, inspect the WebView, capture `logcat`, and record evidence.
3. **Complete the available Phase 1 device checks.** With one Android device,
  test native behavior separately and use the laptop relay for the PWA. Do
  not claim Android-native-host to PWA interoperability yet.
4. **Perform the wholesale Nx/Nub/Node 24 refactor.** Follow the approved
  implementation plan and preserve Cargo/Tauri as native authorities.
5. **Audit Effect TS and Rust.** Measure correctness, ownership, concurrency,
  allocation, and release performance before changing implementations.
6. **Implement QR and shared relay transport.** Mixed Android/PWA rooms use a
  shared TLS WebSocket relay; direct browser-to-Android raw TCP is not the
  target architecture.
7. **Add Rust-side logging and improve error messages.** A failure in
  `net_host`/`net_submit` is currently difficult to diagnose, and transport
  banners can expose raw minified stack traces.
8. **The RPG layer.** Designed and approved, not built. See
  `docs/superpowers/specs/2026-09-13-rpg-layer-design.md`. Extend the fuzz
  driver before writing any class.
9. **iOS and pinch-zoom validation.** Both require hardware or interaction
  tooling unavailable in this Codespace.

## Things that would otherwise have to be rediscovered

- **`npm run verify:ui` drives the built app in a real browser and
  screenshots it.** Three bugs were found this way and none were visible in the
  source: the board clipping its left and right columns, a router rendering
  "Not Found" when served from a subdirectory, and a disabled button styled as
  the primary action. Use `--base-path /some/nested/path` to reproduce the
  subdirectory case. Run it after any UI change.
- **The board's camera must fit both fields of view.** On an upright phone the
  horizontal one is narrower and binds first. Sizing from the vertical alone
  silently clips two columns.
- **Transport is chosen by what the player picked, then by platform.** The
  reverse order handed pass-and-play the LAN transport with no room open, and
  broke the app on a real phone. `src/net/__tests__/factory.test.ts` pins it.
- **An action the host sequenced but a device refuses is not a desync.** Every
  device rejects it identically. It happens legitimately when two players act
  at once, because the relay orders by arrival and their sockets race.
- **Mobile Harness cannot build this app on-device.** Investigated: its Linux
  userspace ships Node but no Android SDK, NDK or Rust, and Google publishes no
  `linux-aarch64` NDK, so a Rust cross-compile has no bionic-targeting clang.
- **macOS CI is expensive here.** macOS cannot be containerised under Apple's
  licence, so those runners bill at 10× and this repository is private. An
  installable IPA additionally needs a paid signing identity. Making the repo
  public would make GitHub-hosted macOS runners free; it would not remove the
  signing requirement.

## Agent Workflow Checkpoint

Each agent framework reads its own configuration to follow the same rules:

| Agent | Config source | Notes |
|-------|--------------|-------|
| Claude Code | `.claude/skills/` | Superpowers skills vendored; bootstrap in `using-superpowers/SKILL.md` |
| GitHub Copilot | `.github/copilot-instructions.md` | Points to the vendored Superpowers bootstrap, CLAUDE.md, and handoff |
| OpenCode | `opencode.json` | Plugin pinned to Superpowers `v6.3.0`; mise pins OpenCode `1.18.30`. Two read-only agents, `explore` and `review`, on free Zen models — see ADR 0016 |

All three share one contract: read the repo docs before editing, get design
approval before writing code, and verify before claiming completion.

**Next checkpoint:** execute Task 1 in
`docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md` from an isolated
worktree. Review the Pages build and subpath verification before starting the
Nx/Nub migration.

## Resuming From This Checkpoint

The approved design is committed as `f773bf5` in
`docs/superpowers/specs/2026-09-13-wholesale-nx-nub-and-pwa-design.md`.
The implementation plan is
`docs/superpowers/plans/2026-09-13-wholesale-nx-nub-pwa-plan.md`.
No implementation task from that plan has started.

Verified on 2026-09-13:

- `mise exec -- opencode --version` resolves OpenCode `1.18.30`.
- `mise exec -- opencode run --model opencode/mimo-v2.5-free --format json
  "Reply exactly HEADLESS_OK. Do not use tools or edit files."` succeeds.
  (Verified from the Codespace. It cannot be reproduced from a Claude Code web
  session, where `opencode.ai` is blocked — `npm run delegate` detects that and
  says so rather than hanging.)
- The OpenCode project plugin loads the vendored Superpowers bootstrap and
  exposes the native `skill` tool.
- OpenCode logs duplicate skill names because Claude's project-scoped vendor
  and the OpenCode plugin both register Superpowers skills. This is currently
  non-blocking, but should be resolved before treating the integration as
  warning-free.

To resume safely, inspect the worktree and read the design plus plan first.
Create or enter an isolated worktree, begin with Task 1, and review each task
before proceeding. Keep `--auto` restricted to trusted, explicitly scoped
prompts.

## Continuing locally

```bash
git clone <repo> && cd snake-ladders
git checkout claude/snake-ladders-cross-device-3uu177
bash scripts/provision.sh           # mise, the toolchain, OpenCode, npm deps
npx playwright install chromium     # only needed for npm run verify:ui
npm test && npm run typecheck       # 94 tests, clean types
```

A Codespace and a Claude Code web session run `scripts/provision.sh`
themselves, through `.devcontainer/devcontainer.json` and the `SessionStart`
hook in `.claude/settings.json` respectively. ADR 0015 covers why it tolerates
partial failure and why mise and OpenCode have npm fallbacks.

For physical-device capture, switch to the host machine rather than trying to
route ADB through the Codespace:

```bash
mise install
mise x -- adb devices
mise x -- opencode
```

Pair/connect with wireless ADB, install the latest Android artifact, and save
the evidence bundle locally. The host must have Android Platform Tools and
Chrome; the Codespace remains the coordinator for source, Actions, Pages, and
report review.

`CLAUDE.md` holds the architecture and the invariants worth knowing before
changing anything. `docs/adr/` holds the decisions and what each one cost.
