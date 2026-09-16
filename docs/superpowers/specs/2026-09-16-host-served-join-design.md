# The host serves the page: design

**Status:** Designed, not built. Phase 1 is ready for an implementation plan;
phase 2 is deliberately gated on hardware this project does not have.

**Closes:** open thread 1 ("a relay the deployed PWA can reach at all"), by
answering it differently than the thread assumed.

## The problem, stated correctly

The thread was written as "we need a `wss://` relay." That framing is wrong,
and acting on it would have bought a public server the project does not want.

The browser's mixed-content rule is about **the page's origin**, not about the
socket. A page served over HTTPS may not open a `ws://`, and GitHub Pages is
HTTPS. So there are exactly three ways out, and only one of them involves TLS:

1. Make the page insecure too — the guest loads the game *from the host*, over
   plain HTTP on the LAN. One origin, no certificate, no internet.
2. Use a transport the rule does not govern — WebRTC.
3. Make the socket secure — a real certificate, which means a public host.

ADR 0012 already recorded this trade and chose `ws://` knowingly: *"the
alternative is a certificate for a LAN address, which is worse than the risk on
a home network."* What changed is not the trade but the front door: deploying
to Pages made HTTPS the first thing a player touches, turning an accepted
limitation into a blocking one.

This design takes route 1 now and keeps route 2 as a gated follow-up. Route 3
is rejected: it buys convenience by spending the project's central claim that
the game never touches the internet.

## What the probe settled, and what it did not

Run 2026-09-16 in headless Chromium 1194, two `RTCPeerConnection`s in one page,
`iceServers: []` — the true offline case.

| Question | Answer |
|---|---|
| Does a secure origin block `RTCPeerConnection`? | **No.** From `https://`, `isSecureContext: true`, the data channel opened and reached `connectionState: "connected"`. |
| Are host candidates mDNS-obfuscated? | **Yes, always.** Every candidate came back as `<uuid>.local`; the interface address never appeared. |
| Does signalling fit in a QR code? | **Yes, comfortably.** Offer 458 bytes (358 gzipped), answer 457 (360). QR byte-mode ceiling is 2,953. |

Two caveats that matter more than the table:

- **The probe's "insecure origin" control was invalid.** It used
  `http://localhost`, which browsers treat as a trustworthy origin and which
  reported `isSecureContext: true`. The HTTPS arm stands on its own; the
  comparison proves nothing about genuinely insecure origins.
- **Both peers shared one browser and therefore one mDNS resolver**, so
  resolution succeeded trivially. This says nothing about two devices resolving
  each other's `.local` across a real network. That is exactly ADR 0013's open
  risk and the probe could not close it.

The useful correction for ADR 0013: WebRTC was never blocked by TLS. Its only
real blocker is mDNS, and that is unchanged.

## Phase 1: the host serves the page

### The flow

1. Someone opens the installed app and picks **Host on Wi-Fi**. This already
   binds a `TcpListener` on an ephemeral port and advertises a UDP beacon.
2. The lobby shows a QR encoding `http://<lan-ip>:<port>/`, alongside the
   room code it already displays.
3. A guest scans it with their phone's camera. Their browser opens and loads
   the game **from the host**, over plain HTTP.
4. The page's transport connects to `ws://<same-origin>` — the host's existing
   listener, which since ADR 0019 already speaks WebSocket on that port.
5. They play. No install, no relay machine, no certificate, no internet.

One scan, one direction. Compare WebRTC's offer-then-answer exchange, which
needs two scans per guest and so grows with the table: six scans for a
four-player game, ten for six.

### Why this is small

Almost all of it exists. The listener already discriminates `GET ` from a
native peer's JSON and already performs the RFC 6455 upgrade (ADR 0019). The
APK already embeds a `/`-based bundle — `frontendDist: "../dist"`, and vite's
`base` defaults to `/` unless `PUBLIC_BASE_PATH` is set, which only the Pages
build sets. The app is a **hash router**, so there is no history-API fallback
to implement: every route lives under `/#/...` and the server only ever needs
to serve real files plus `/`.

What is genuinely new is an asset path in the request handler, a way to learn
the host's own LAN address, and a QR in the lobby.

### Units and boundaries

**`crates/lan-sync` must stay Tauri-free.** It is outside the Tauri workspace
precisely so it builds and tests anywhere, and reaching into Tauri's asset
resolver from there would destroy that. Assets are therefore *injected*,
mirroring how `SessionSink` already keeps the session pump testable without a
webview:

```rust
/// Where the host gets the page it serves. Injected so `lan-sync` never
/// learns what a Tauri app is.
pub trait AssetSource: Send + Sync + 'static {
    /// Body and content type for a request path, or `None` for 404.
    fn get(&self, path: &str) -> Option<(Vec<u8>, String)>;
}
```

- `Host::bind` gains an `Option<Arc<dyn AssetSource>>`. **`None` preserves
  today's behaviour exactly** — a `GET` that is not a valid upgrade still gets
  `400 Bad Request`. Every existing test keeps passing unchanged, and the Node
  relay's equivalent is unaffected.
- `src-tauri` provides the implementation over Tauri v2's
  `app.asset_resolver()`, which is the only place that knows about embedded
  assets.
- A test double in `crates/lan-sync`'s own tests serves a fixed map, so the
  serving rules are tested without an APK.

**Request routing**, once the first byte is `G`:

| Request | Response |
|---|---|
| Valid RFC 6455 upgrade | WebSocket, as today |
| Any other `GET`, `AssetSource` present | The asset, or 404 |
| Any other `GET`, no `AssetSource` | `400 Bad Request`, as today |

**Finding the host's own address.** `discovery.rs` broadcasts to
`255.255.255.255` and never enumerates interfaces, so the Rust side does not
currently know its own LAN IP. The stdlib cannot enumerate interfaces either.
Rather than add a dependency, use the UDP-connect trick: open a `UdpSocket`,
`connect()` it to a non-routable address, and read `local_addr()`. No packet is
sent, it needs no network, and it yields the address of the interface that
would carry outbound traffic — which is the one a guest on that Wi-Fi can
reach. It returns one address; a host on two networks may report the wrong one,
so the lobby must still show the address as text the player can read out.

### Error handling

- **No usable LAN address** (loopback only, no Wi-Fi): the lobby says so and
  offers the room code for native peers, rather than showing a QR that leads
  nowhere.
- **Guest loads the page but the room is locked or full**: unchanged. The
  existing `rejected` frames already cover this, and the page renders the
  reason.
- **A guest reloads mid-match**: the page reloads from the host and rejoins on
  the same `playerId`, which is already a reconnect rather than a duplicate.
- **The host leaves the match**: the listener dies and the guest's page becomes
  unreachable on refresh. This is inherent to the host serving the page and is
  the cost to state plainly in `docs/playing-together.md`.

### Security

Serving files to anyone on the Wi-Fi is the part of this design that deserves
care, not the WebSocket.

- **Only embedded assets, never the filesystem.** The `AssetSource` boundary
  makes this structural: `lan-sync` has no filesystem path to leak. A path
  traversal test is still required — `scripts/drive-app.mjs` shipped exactly
  that bug once, where a prefix that did not end on a path boundary left a
  relative remainder that `join` walked back out of `dist`.
- **No new authority.** Anyone on the LAN could already attempt to join the
  room; capacity and the lock guard it. Serving the page does not widen that,
  but it does advertise the game's presence more loudly than a bare socket.
- **Existing bounds hold**: the 8 KiB request-head cap and the 1 MiB frame cap
  from ADR 0019 both apply before anything is allocated.
- **An asset request must not consume a room slot.** It never reaches the
  handshake, but this deserves a test rather than an assumption.
- **Thread-per-connection is unchanged**, and so is its exposure: a LAN peer
  can already open connections faster than they retire. Serving assets makes
  that cheaper to trigger. Accepted for a home network, consistent with ADR
  0012's reasoning, and recorded here so it is a decision rather than an
  oversight.

### Testing

Rust, in `crates/lan-sync`, against a test-double `AssetSource`:

- `/` serves the index; a known asset path serves that asset with its type.
- An unknown path is 404.
- A traversal attempt (`/../../etc/passwd`, and an encoded variant) is refused.
- A WebSocket upgrade on the same port still works with an `AssetSource`
  present — the two paths must not interfere.
- With no `AssetSource`, a plain `GET` still returns 400 — the existing
  contract is unchanged.
- An asset request does not occupy a room slot.

Web: the lobby's QR and address block, driven through `verify:ui` and looked at
in a screenshot. `verify:ui` runs in this container — the handoff previously
claimed otherwise and was wrong.

Not testable here: an actual phone scanning an actual QR and playing. That
needs two devices and must not be claimed until it happens.

## Phase 2: WebRTC, and the gate on it

**Not started, and not to be started until the gate clears.**

The probe established that WebRTC works from the deployed HTTPS site, which is
the one thing phase 1 cannot offer: with phase 1, the Pages URL is never the
page you play a multi-device match from. It stays a shop window and an install
vector.

**The gate:** two physical devices on one Wi-Fi, each resolving the other's
mDNS `.local` candidate, with a data channel reaching `connected`. Until that
is observed, WebRTC is not a viable transport and no code should be written for
it. Client isolation on guest and corporate Wi-Fi is the specific failure mode,
and it cannot be simulated in a container.

**If the gate clears**, the design is a star, not a mesh: one peer sequences and
the others connect to it, so signalling is N-1 exchanges rather than N(N-1)/2.
Each exchange is two QR scans — host shows offer, guest shows answer — because
from an HTTPS page there is no LAN channel to carry the answer back. That is
the friction phase 1 avoids entirely, and it is why phase 2 is the luxury that
removes the host device rather than the primary path.

## What this explicitly does not do

- **It does not make the deployed Pages site play across devices.** That is
  phase 2's job, and phase 2 is gated.
- **It does not add `wss://` or any public relay.** The game still never
  touches the internet.
- **It does not replace the Node relay.** A laptop-hosted room and
  browser-to-browser play are unchanged. The same `AssetSource` idea would let
  `lan-relay.mjs` serve the page too — `serveDist` already exists in
  `scripts/drive-app.mjs` and is unit-tested — but that is a separate, smaller
  change and is not in this scope.
- **It does not give the guest an offline shell.** A page served over plain
  HTTP on a LAN address is not a secure context, so no service worker
  registers. The guest does not need one; the host does, and it has the app.

## Open questions

1. **Which QR encoder.** The web app has no QR dependency today. It needs a
   small one, or a hand-rolled encoder. Decide during planning, weighing a new
   dependency against carrying encoder code.
2. **Whether the port should be fixed rather than ephemeral.** A QR makes the
   port invisible, so ephemeral is fine and avoids conflict handling. But a
   player reading the address aloud has to say five digits. Worth revisiting
   only if the QR turns out not to carry the flow.
