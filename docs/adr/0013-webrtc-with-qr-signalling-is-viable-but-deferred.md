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
