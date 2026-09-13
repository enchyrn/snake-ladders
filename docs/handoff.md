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

## Open threads, roughly in priority order

1. **Play a real cross-device match.** Run `npm run relay` on the Mac, join
   from the iPhone and the Android. This is the first end-to-end exercise of
   the whole stack and is likely to surface things no test has.
2. **Rust-side logging.** There is none. A failure in `net_host`/`net_submit`
   is invisible unless it happens to surface as a command error.
   `tauri-plugin-log` would route it to logcat and the WebView console.
3. **The error banner prints raw stack traces.** A transport failure shows the
   user a minified `index-*.js:46655:20`. It should show a sentence.
4. **Lobby copy contradicts itself in a hosted room** — it says "Pass this
   device to the next player" underneath a room code that other devices are
   meant to join. The code *is* meaningful in pass-and-play (it is the seed),
   but the sentence is wrong for a Wi-Fi room.
5. **On-device debugging doc.** Wireless ADB pairing, `chrome://inspect`
   against the running WebView (the debug APK already permits this — no rebuild
   needed), `adb logcat`, and the Safari equivalent for iOS.
6. **The RPG layer.** Designed and approved, not built. See
   `docs/superpowers/specs/2026-09-13-rpg-layer-design.md`. Extend the fuzz
   driver before writing any class.
7. **WebRTC/QR** (ADR 0013) and **NX** (ADR 0014), both deliberately deferred
   with the reasoning recorded.

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

## Continuing locally

```bash
git clone <repo> && cd snake-ladders
git checkout claude/snake-ladders-cross-device-3uu177
npm install
npx playwright install chromium   # only needed for npm run verify:ui
npm test && npm run typecheck
npm run dev -- --host             # open the printed address on any phone
```

`CLAUDE.md` holds the architecture and the invariants worth knowing before
changing anything. `docs/adr/` holds the decisions and what each one cost.
