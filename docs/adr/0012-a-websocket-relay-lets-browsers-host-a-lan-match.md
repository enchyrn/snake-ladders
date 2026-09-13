# 0012. A WebSocket relay lets browsers play a LAN match

## Status

Accepted

## Context

The Rust relay (ADR 0004) gives cross-device play only to devices running the
native shell. That excludes iOS, which cannot take a sideloaded APK and whose
native build needs a Mac (ADR 0011), and it excludes the PWA entirely, because
a browser cannot open a listening socket or broadcast on UDP.

A group with an iPhone, an Android phone and a laptop therefore had no way to
play together at all, despite every device being able to run the game on its
own.

WebRTC with QR-code signalling was spiked as the install-free answer. It works
— a data-channel offer compresses to under 600 bytes, comfortably inside a
single QR code, and the handshake completes with no STUN server. But browsers
replace local-IP ICE candidates with mDNS `.local` names, so a connection
depends on both devices resolving each other's mDNS, which fails on networks
with client isolation and could not be verified without two physical devices.

## Decision

Add a WebSocket relay that runs on any machine with Node, and a third
implementation of the existing `TransportService` interface that speaks to it.
The relay does exactly what the Rust host does and no more: accept a
handshake, reply with the catch-up log, assign sequence numbers to submitted
actions, and fan the numbered log out. It holds no game state and knows no
rules.

It deliberately speaks the same wire frames as the Rust host, so the two are
interchangeable and a peer cannot tell which kind of host it joined.

## Consequences

Any device with a browser can now join a match over the local network,
including an iPhone, with no install, no Apple ID and no App Store. The game
still never touches the internet. Because the transport interface already had
two implementations, nothing above it changed: the UI, the fold, and the
engine are untouched, which is the payoff for having defined that boundary.

Plain `ws://` is used rather than `wss://`. A browser permits an insecure
WebSocket from an insecure page, and the alternative is a certificate for a
LAN address, which is worse than the risk on a home network. The consequence
is that the relay cannot be used from a page served over HTTPS, so the
service worker and the hosted-PWA path do not combine with it.

The real cost is a new dependency in the room: some machine must run the relay
and stay awake for the length of the match. That is the same single point of
failure as the Rust host, moved to a laptop, and it is why this does not
replace the native LAN transport — it sits beside it. A phone-only group still
wants the APK, and WebRTC still removes the laptop later.

Maintaining two implementations of the sequencer is a genuine duplication. It
is accepted because each is small, neither contains game rules, and the shared
frame format means a divergence between them shows up immediately as a peer
that cannot join rather than as a silent desync.
