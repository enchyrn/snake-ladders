# Debugging the Android build on a real device

Everything here runs on **your own machine**, not in a Codespace or a Claude
Code web session. Those containers have no USB bus, cannot see a phone on your
LAN, and cannot reach a WebView's debugging socket — so ADB, `chrome://inspect`
and screen capture are host-local by necessity, not by preference. The
container stays useful for the parts that are not device-bound: source, the
Actions run that produces the APK, the Pages deployment, and reading whatever
evidence you bring back.

> Not yet executed end to end. The commands below are the documented
> procedure; the first person to run them against hardware should correct
> anything that turns out to be wrong and record the result in
> `docs/handoff.md`.

## What you need

- Android Platform Tools (`adb`) — `mise install` provides them, or install
  them from the Android SDK.
- Chrome, for inspecting the WebView.
- A phone with **Developer options** and **Wireless debugging** switched on.
- The debug APK from the latest successful `Android` workflow run.

## Get the APK

Download the `android-debug-apk` artifact from the most recent successful run
of `.github/workflows/android.yml` and unzip it. Note the run ID — it is the
only thing that ties an evidence bundle to a specific build, and a debug APK
carries no version string that would tell you later.

## Connect over wireless ADB

Pairing and connecting are two different ports, shown on two different screens,
and the pairing port changes every time the dialog opens.

```bash
mise x -- adb pair 192.168.1.23:37419     # port + code from "Pair device with pairing code"
mise x -- adb connect 192.168.1.23:5555   # port from the Wireless debugging screen itself
mise x -- adb devices                     # expect: <ip>:5555   device
```

## Install and watch

```bash
mise x -- adb install -r app-debug.apk
mise x -- adb logcat -c                                   # clear first, or you read yesterday's run
mise x -- adb logcat | tee logcat.txt
```

`-r` reinstalls over the existing app and keeps its data. Going the other way —
uninstalling first — also clears the stored identity, which changes the player
ID the device joins with, so reach for it only when that is what you want.

The interesting tags are the WebView's console (`chromium`), Tauri's own
output, and anything from `lan_sync`. A crash on launch is usually the Rust
side: the Java stack trace names the `.so` rather than the cause, so the
`logcat` lines immediately before it matter more than the trace itself.

## Inspect the WebView

With the device connected, open `chrome://inspect/#devices` in Chrome on the
host. The app appears as a WebView target; **inspect** gives a normal DevTools
window against the running game — console, network, and the ability to evaluate
against the live match state.

This is the only way to see a transport error's real cause on-device. The
in-app banner deliberately shows a short message rather than a raw stack trace,
and on a release build that trace is minified anyway.

## What to keep

One timestamped directory per session, **outside the repository** — it contains
device identifiers and local network addresses, and none of it is source:

```
2026-09-13-android-capture/
  run-id.txt         the Actions run the APK came from
  device.txt         model, Android version, `adb devices` output
  logcat.txt         cleared before the run, so it covers only this session
  console.txt        the DevTools console, copied out
  screen/            screenshots or `adb exec-out screencap -p > screen/1.png`
  notes.md           what you did, what you expected, what happened
```

Fold only the conclusions back into `docs/handoff.md`, as observed results
rather than inferences — the bundle itself stays local.
