# 0013. WebRTC with QR signalling is viable but deferred

## Status

Proposed — spiked with measurements, not built. Superseded in priority by ADR
0012, which solved the same problem more cheaply.

## Context

The Rust relay (ADR 0004) reaches only devices running the native shell, which
excludes iOS. The question was whether two browsers could play directly with no
server and no internet, by exchanging WebRTC session descriptions out of band
as QR codes.

Two things had to be true: the session description had to fit in a QR code a
phone camera can read, and a connection had to form on a LAN with no STUN
server.

## Decision

Defer it. The WebSocket relay (ADR 0012) delivers install-free cross-device
play including iOS for far less work, and does not depend on the unresolved
risk below. Keep this as the route that later removes the laptop from the room.

## Consequences

The spike's measurements are worth keeping, because they settle the questions
that would otherwise be re-asked. Run in headless Chromium with
`iceServers: []` — the true offline case:

- **Size is not a problem.** A data-channel offer was 587 bytes raw, 444
  gzipped, 592 as gzip+base64, against a QR byte-mode ceiling of 2,953. That is
  roughly a 5× margin: one QR code per side, no multi-frame animation, no
  compression strictly required.
- **The handshake completes with no STUN server at all**, confirming the
  offline shape works.
- **Every host candidate was mDNS-obfuscated.** 2 of 2 came back as `.local`
  names, so a LAN connection depends on both devices resolving each other's
  mDNS. That works on ordinary home Wi-Fi and fails on networks with client
  isolation.

**The spike does not prove cross-device mDNS resolution.** Both peers ran in
one browser instance and therefore shared a single mDNS identity, so resolution
was trivial. Two physical phones — and iOS Safari specifically — were not
tested and cannot be from a container. That is the one open risk, and it should
be measured on real devices before any transport is written.

If built, the failure path comes first: when ICE fails, say the devices could
not reach each other on this network and suggest a hotspot, rather than hanging.

The reproduction lives in the session history rather than the repository; it is
about forty lines of Playwright and is cheaper to rewrite than to maintain.

## Addendum, 2026-09-16: it was never TLS

A later probe corrected the reason this sat deferred while the PWA went to
GitHub Pages. It is worth stating because the wrong reason led to the wrong
remedy — an open thread asking for a `wss://` relay, which would have bought a
public server this project does not want.

**Mixed content does not govern `RTCPeerConnection`.** It blocks WebSocket. So
a page served over HTTPS, which may never open a `ws://`, *can* open a data
channel to a peer on the local network. Measured in headless Chromium with
`iceServers: []` from a genuine `https://` origin (`isSecureContext: true`):
the channel opened and reached `connectionState: "connected"`.

Re-measured signalling sizes, smaller than the original spike recorded:

| | Raw | Gzipped |
|---|---|---|
| Offer | 458 bytes | 358 |
| Answer | 457 bytes | 360 |

Both sit far inside the 2,953-byte QR byte-mode ceiling, and the answer is the
same size as the offer — so a two-way exchange is size-feasible. The friction
is the number of scans, not the payload.

**The mDNS risk is unchanged, and now observed rather than suspected.** Every
host candidate came back as `<uuid>.local`; the interface address never
appeared. Both peers in that probe shared one browser and therefore one
resolver, so resolution succeeded trivially and proved nothing about two
devices. That remains the gate, and it needs hardware.

See `docs/superpowers/specs/2026-09-16-host-served-join-design.md`, which takes
a different route for now and records what would unblock this one.
