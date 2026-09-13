# Share, join and the start menu — design

**Status:** approved in conversation, not implemented. No code exists yet.
**Date:** 2026-09-13

How a match is started, how a room is handed to someone else, and how each
device tells the truth about what it can actually do.

## Decisions settled before this design

1. **The shared thing is an HTTPS link to the PWA**, with the descriptor in the
   hash fragment. Not a custom scheme, and not QR alone.
2. **The start menu's primary action adapts to the device.** A disabled primary
   action is never rendered.
3. **The host knows and can show its own LAN addresses**, but the share path is
   primary and the address is a collapsed fallback.

## Scope, and the seam with plan Task 8

Plan Task 8 owns the **descriptor's wire format** — version, transport kind,
endpoint, room code/seed — and the QR library choice. This design does not
re-specify any of it.

This design owns the start menu, the share surface, arrival routing, the
capability model, and host address exposure. It consumes the descriptor through
a single contract:

> Parsing yields either a usable descriptor, **or a typed refusal carrying a
> reason.**

Task 8 fills in the fields; this spec defines what the UI does with either
outcome. That seam is what lets the two be built in either order.

Out of scope: the `wss://` relay itself (Task 9), and anything that can only be
verified on hardware this container does not have.

## A capability model, because the caveats are already wrong

`src/app/session.tsx` exposes `canHost: native` and **`canJoin: true`**. The
second is false on the deployed site: an HTTPS page may not open a `ws://`
socket, and the browser refuses before the connection leaves the tab
(`docs/handoff.md`, open thread 1).

So `src/routes/home.tsx` currently tells players:

> "You can still join a match from here: run the relay on a computer and paste
> the address it prints."

On `enchyrn.github.io` that cannot work. **The copy is wrong in production
today**, and it is wrong because capability is guessed per screen instead of
computed once.

```ts
interface Capabilities {
  host: "lan" | "relay" | false
  join: { lan: boolean; relay: "ws" | "wss" | false }
  share: boolean      // navigator.share
  install: boolean    // PWA installable
}
```

Derived once from `isTauri()`, `location.protocol` and feature detection. Every
screen reads it rather than inventing its own hint, and **one** place renders
the explanation for each `false`.

`host: "relay"` and `join.relay: "wss"` are in the type deliberately but are
**not reachable today** — they become attainable when Task 9 lands a `wss://`
relay. Writing them into the model now means the menu and the refusals do not
need reshaping then; it does not mean they can be selected.

This is the piece that stops the caveats drifting out of date, which is exactly
what happened to the sentence above.

## The start menu

Top to bottom:

1. Compact brand — it currently spends roughly 250px before anything actionable.
2. **Continue**, from the session design. Returning to a game beats starting
   one, so it goes above the modes when saves exist.
3. **The primary action, adapted to the device** — "Host on Wi-Fi" in the
   installed app, "Pass and play" in a browser.
4. The remaining modes, demoted.
5. A compact profile row (`Playing as Viper ▾`), replacing the name field that
   currently sits above the actions and makes identity the first thing a player
   deals with.
6. One tappable line of device capability.
7. *How to play* — where the three-paragraph "twists" wall goes.

**This menu assumes the session design has landed**, in two places: Continue
reads its save shelf, and the profile row is its profile roster. Built first,
both degrade cleanly — Continue is absent when there are no saves, and the
profile row falls back to today's single identity — but the ordering is worth
knowing rather than discovering.

Two rules:

- **Never render a disabled primary action.** An unavailable action is demoted
  with its reason behind a tap, or absent. The browser build currently leads
  with a disabled "Host on Wi-Fi" styled as the primary, so the eye lands on the
  one thing that cannot be done, and a five-line paragraph explains why —
  costing as much vertical space as all three buttons.

  This is a recurrence, not a new bug: `docs/handoff.md` records "a disabled
  button styled as the primary action" among the three bugs `verify:ui`
  originally caught. Same family, different button. The rule exists so it stops
  coming back.

- **A capability caveat is never standing text on the start screen.** One line,
  or behind a tap.

The PWA toast currently overlaps the twists text. It gets a reserved lane rather
than floating over content.

## Sharing a room

Sharing stays in the lobby, where the room already exists. The hierarchy:

1. **The room code** — the room's *identity*, not an action. It stays visible:
   it is how two people confirm they are in the same room, and it is the seed.
2. **QR, and Share / Copy link** — the primary action, and the only path anyone
   normally touches. `navigator.share` where available opens the native share
   sheet; feature-detected, falling back to copy.
3. **"Join by address"** — a collapsed disclosure revealing `IP:port@CODE`.

That third item buys **symmetry with a pattern already in the codebase**.
`src/routes/join.tsx` hides manual entry behind exactly this —
`<details><summary>Join by address</summary>` — for exactly this reason ("use
this when the network blocks discovery broadcasts, or on an iPhone that has not
been granted the local-network permission"). The host side currently has no
matching disclosure and puts its fallback in standing text instead. Making both
ends the same shape gives one mental model: **the easy path is the surface, the
manual path is one tap down, on both ends.**

### Who this link will actually work for

Attached to the share action, where someone is deciding whether to send it.

A native LAN host's endpoint is a raw TCP address no browser can dial; a relay
host's is a `ws`/`wss` URL. The link's usefulness genuinely varies by who is
hosting and who is receiving, and saying so beats handing someone a link that
silently cannot work.

### On the address in the link

Collapsing the address by default helps against **screenshots** — someone
capturing the lobby to send a friend no longer carries their IP in the image.
It does **not** close the leak in the link: the QR and the URL must embed the
endpoint or they cannot function, so the address travels either way.

The exposure is small — an RFC1918 address is close to useless to anyone not
already on that LAN — so this belongs in `docs/playing-together.md` as a
sentence, not as a warning dialog. The ergonomic argument is the one that
actually decides it: **if the share path works, nobody ever needs to read the
address, so it should not occupy the screen.**

## The link, and what happens on arrival

```
https://<origin>/<base>/#/join/<descriptor>
```

The base path comes from Vite's `BASE_URL`, never hardcoded —
`verify:ui:pages` exists precisely to catch that class of mistake.

**The descriptor rides in the hash fragment**, which is never sent to the
server. The room's endpoint therefore stays client-side, so the
never-touches-the-internet promise holds even for the share link.

On arrival:

1. **Parse.** On refusal — unknown version, malformed, or *this device cannot
   use this transport* — say so at parse time with what to do instead. That last
   case is the native-LAN-host-to-PWA-peer pairing from open thread 1, and it
   should be a sentence rather than a failed connection. `join.tsx` already
   follows this principle: "the reason, not the failure".
2. **Confirm before joining.** Show room code and host first. Arriving from a
   link straight into a live match is disorienting, and the session design's
   profile picker may need to run first.
3. **"Open in app"** attempts `snakeladders://join/<descriptor>`. A failed
   scheme launch is silent, so the page remains the fallback and never navigates
   away first.

**Steps 1 and 3 are the same story, and must be built as one.** When a browser
is handed a LAN descriptor it cannot use, "Open in app" is not a convenience
sitting elsewhere on the page — it is *the remedy*, and the only path by which
that link ever completes. So the transport-unusable refusal renders the
"Open in app" attempt as its suggested action, with the plain explanation
underneath for someone who does not have the app installed.

Read separately, these two look like a dead end and an unrelated nicety.
Together they are the one route by which a native LAN host can successfully
invite someone who opened the link in a browser.

### Why not Android App Links

Digital Asset Links must be served from the **origin root** —
`https://enchyrn.github.io/.well-known/assetlinks.json` — which belongs to a
repository named `enchyrn.github.io`, not to `snake-ladders`. A project Pages
site cannot publish it.

Verifying that origin would additionally claim *every* project site on
`enchyrn.github.io` for the app. Both facts are worth recording so nobody
reaches for App Links and discovers this halfway through.

Native-side scheme registration is `src-tauri` work: designed here, verifiable
only through the Android CI build and the host-local capture in open thread 3.

## The host knows its own address

`HostedRoom` is `{ room, port, seed }` (`src/net/transport.ts:20`) — **no
address**. `Host::bind` binds `0.0.0.0:port` and keeps only `local_port`
(`crates/lan-sync/src/host.rs:49`, `:79`); it never enumerates interfaces.

Meanwhile `scripts/lan-relay.mjs:138` already does exactly this — *"Every
non-loopback IPv4 address, so the host can be told what to type in"* — and
prints `address:port@room` ready to paste.

So the Node relay solved this and the native app did not. The lobby instead
tells the player to "enter this device's own Wi-Fi address": go find your own
IP, in Settings, on a phone, mid-game.

**Change:** `HostedRoom` gains `addresses: ReadonlyArray<string>`. Additive; the
local transport returns `[]`, since pass-and-play has no address.

Three things worth recording:

- **Binding `0.0.0.0` makes enumeration exactly right rather than a guess.** The
  listener is reachable on every interface, so every non-loopback IPv4 genuinely
  works — which is why the relay's approach is correct and can be mirrored.
- **This is what makes the share link work at all.** Today a LAN host cannot
  produce a complete join string without leaving the app. With addresses in
  hand, the QR and the link are self-contained — the difference between the
  share surface being useful and being a half-filled template.
- **It needs `lan-sync`'s third dependency.** The crate has exactly two, `serde`
  and `serde_json`, and std has no interface enumeration. A pure-Rust, no-Tauri
  utility keeps ADR 0005's independence intact, but this is not a free change
  and should be a deliberate one.

**The Rust and Node enumerations do not need to agree.** Unlike the sequencer
and the room-code encoding — where divergence desyncs a match — these are
informational. No parity test should pin them to each other.

When several candidates exist (Wi-Fi plus VPN plus cellular), show the most
likely one prominently with the rest behind a tap. Three addresses on screen
scares people; hiding the right one is worse.

A browser can never enumerate its own local addresses, and does not need to: it
cannot host. A relay-hosted room's address comes from the relay's own printout.

## Files

- `src/app/capabilities.ts` — new: the `Capabilities` record and its
  explanations.
- `src/app/session.tsx` — expose capabilities; retire `canHost` / `canJoin`.
- `src/net/transport.ts` — `HostedRoom.addresses`.
- `src/net/lan.ts`, `src/net/local.ts`, `src/net/websocket.ts` — carry or stub
  `addresses`.
- `crates/lan-sync/src/host.rs` — enumerate non-loopback IPv4.
- `src-tauri/src/lib.rs` — surface addresses; register the custom scheme.
- `src/routes/home.tsx` — the menu, the adaptive primary, the profile row.
- `src/routes/lobby.tsx` — the share hierarchy and the collapsed address.
- `src/routes/join.tsx` — arrival route, confirmation, typed refusals.
- `src/ui/PwaPrompt.tsx` — a reserved lane instead of overlapping content.
- `docs/playing-together.md` — the share flow, and the address sentence.

## Testing

- **The descriptor consumer contract** — one test per refusal kind: unknown
  version, malformed, and transport-unusable-on-this-device.
- **The capability model as a pure function** of `(isTauri, protocol,
  features)`, so every combination is testable without a native build.
- **Which action is primary, as a pure selector over capabilities.** This is how
  the adaptive menu gets tested without building for Android, and it is the
  regression test for "never render a disabled primary".
- **Link build → parse round trip**, including the base path.
- **`verify:ui:pages` covering `#/join/<descriptor>` under the subpath** — the
  not-found-router bug was found in exactly this way, and an arrival route is
  the most likely place for it to recur.
- **`addresses` plumbing** — `cargo test -p lan-sync` for enumeration returning
  non-loopback entries; a transport test that the local transport returns `[]`.
- The existing `verify:ui` console-error, page-error and horizontal-overflow
  gates.

## Build order

1. **The capability model first.** It is small, it fixes copy that is wrong in
   production today, and the menu is written against it.
2. The start menu and the adaptive primary.
3. `HostedRoom.addresses`, through Rust, the transports, and the lobby
   disclosure.
4. The share hierarchy: QR, copy, `navigator.share`, and the who-can-join line.
5. The arrival route, confirmation, and typed refusals.
6. The custom scheme and "Open in app", last — it is the only part that cannot
   be verified from a container.

Steps 1 and 2 are worth doing regardless of what happens to the relay. Steps 3
through 5 assume Task 8's descriptor; step 6 assumes hardware.

## ADRs

One ADR: **the share link is an HTTPS URL to the PWA, and the native app is
offered rather than routed to.** Its cost is the honest part — a link cannot
guarantee it opens the installed app, Android App Links are unavailable from a
project Pages origin, and a link from a LAN host to a browser peer cannot be
completed at all until a `wss://` relay exists. The alternative, a custom scheme
as the primary carrier, fails silently for everyone without the app.

ADR 0012 and 0013 are the prior art on relay and signalling and are unchanged.
