# 0019. The native host speaks WebSocket on the port it already listens on

## Status

Accepted.

## Context

`crates/lan-sync` is a raw `TcpListener` that reads newline-delimited JSON with
`read_line`. That is fine between two installed apps, and it is unreachable from
a browser: a `WebSocket` sends an HTTP upgrade request, and the host's handshake
parser answers `{"t":"rejected","reason":"malformed handshake"}`. This was
established by feeding real browser handshake bytes to `Host::bind`, not
inferred.

So the two sequencers — Rust for native peers, `apps/relay/lan-relay.mjs` for
browsers — can each serve their own half of the room, but a phone running the
Android app cannot be the host for a player on a laptop browser. Every
browser-involving match needs a laptop running the Node relay, which is exactly
the machine the Android host was supposed to replace.

Three options:

1. **A second listener on a second port**, speaking WebSocket, sharing the same
   sequencer state.
2. **One listener, both protocols**, discriminated by the first four bytes.
3. **Bundle the Node relay into the Android app.** Rejected immediately: it
   means shipping a Node runtime inside a Tauri APK.

## Decision

Option 2. The per-client thread peeks the first four bytes without consuming
them. `GET ` means a browser, so it reads the request head, answers the RFC 6455
handshake, and sends and receives WebSocket text frames for the life of that
client. Anything else takes the existing `read_line` path untouched.

The framing is hand-written in `crates/lan-sync/src/ws.rs` against two new
dependencies, `sha1` and `base64`, which the handshake's `Sec-WebSocket-Accept`
needs. The JSON payloads are byte-identical either way: a peer still cannot tell
which sequencer it joined, which is the contract between the two
implementations.

## Consequences

**What it costs.**

- A crate that had only `serde` now has two more. Both are pure Rust with no
  build scripts, so the Android target is unaffected, but `lan-sync`'s "builds
  and tests anywhere with nothing exotic" property is now a claim about four
  dependencies rather than two.
- The codec is ours to maintain. It handles text, close, ping and pong, and the
  three payload-length forms. It **rejects fragmented messages** rather than
  mis-decoding them: nothing this protocol sends approaches a fragment boundary,
  and silently reassembling frames we never send would be untested code on a
  path no test can reach.
- Payloads over 1 MiB are refused before allocation. An unbounded length field
  is trivially a memory-exhaustion bug, and the largest real frame is a welcome
  carrying the whole log.
- One port means one failure domain: a bug in the peek logic breaks native peers
  too, not just browsers. This is why the branch is a peek rather than a
  consuming read — a misjudged first byte must not eat data the JSON path needs.

**What it does not buy.**

The deployed PWA on GitHub Pages still cannot join an Android host, and nothing
in this ADR changes that. An HTTPS page may not open a `ws://` socket; the
browser refuses before the connection leaves the tab, and a host on a LAN
address cannot present a certificate anyone trusts. This decision helps the case
where the page is *served over plain HTTP on the LAN* — `nub run dev -- --host`,
or a phone opening a laptop's dev server. Closing the deployed case needs a
relay reachable over `wss://`, which trades away the promise that the game never
touches the internet, and is open thread 1 with its own ADR still to write.

ADR 0004 is why the Rust relay exists at all; ADR 0012 is why the Node one does;
ADR 0013 is the WebRTC route that would remove both.
