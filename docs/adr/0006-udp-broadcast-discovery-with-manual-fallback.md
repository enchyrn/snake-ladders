# 0006. UDP broadcast discovery, with join-by-address as the guaranteed fallback

## Status

Accepted, with the iOS limitation documented in `src-tauri/mobile/README.md`.

## Context

Devices need to find each other on a local network with no internet, no DNS, and no matchmaking service to introduce them. Candidates considered were mDNS/Bonjour-style service discovery, BLE or Wi-Fi Direct, QR-code pairing, and plain UDP broadcast.

## Decision

A UDP beacon on a fixed port (47654) broadcasts a four-character room code, and that code doubles as the match seed — two devices that see the same code generate the identical board without any further exchange. Manual join-by-address is always available as a way in, independent of whether broadcast discovery works.

BLE and Wi-Fi Direct were rejected: they would require separate native Kotlin and Swift plugins, roughly triple the implementation and maintenance work versus a single cross-platform UDP path, and are effectively untestable without physical devices in hand, which doesn't fit a project that wants CI coverage.

## Consequences

On a shared Wi-Fi network, or even a phone acting as a hotspot, a room becomes visible to another device in about a second, with no pairing step, no companion app permission dance, and no external dependency.

The costs here are significant enough to call out explicitly rather than bury. Broadcast discovery only works when a Wi-Fi network already exists to carry it — it is not a radio-free solution, unlike BLE — so two devices with Wi-Fi off entirely cannot find each other this way. Some corporate and guest Wi-Fi networks block broadcast traffic between clients outright (client isolation), which silently defeats discovery with no error surfaced to the user. Most importantly, **iOS restricts raw UDP broadcast**: without Apple's `com.apple.developer.networking.multicast` entitlement — which is granted only on request and not guaranteed — broadcast packets may be silently dropped on iOS with no indication to the app or the user that discovery failed. The manual join-by-address fallback exists specifically to cover this case, and it is a real fallback rather than a rarely-used escape hatch: on iOS devices without the entitlement, it may be the only way to join a match at all.
