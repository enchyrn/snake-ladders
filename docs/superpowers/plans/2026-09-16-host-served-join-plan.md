# Host-Served Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest scan a QR on the host's lobby, load the game from the host
over plain HTTP, and join the room — no install, no relay machine, no certificate.

**Architecture:** The host's existing `TcpListener` already tells a browser's
`GET` from a native peer's JSON and performs the RFC 6455 upgrade (ADR 0019).
This adds a third branch: a `GET` that is *not* an upgrade serves a page asset.
Assets arrive through an injected `AssetSource` trait so `crates/lan-sync` never
learns what Tauri is, exactly as `SessionSink` keeps the session pump testable
without a webview. Page and socket then share one insecure origin, which is the
whole point — the browser's mixed-content rule is about the page's origin, not
the socket.

**Tech Stack:** Rust (std only, plus the existing `sha1`/`base64`), Tauri v2's
`AssetResolver`, TypeScript/React, `qrcode-generator@2.0.4`.

**Spec:** `docs/superpowers/specs/2026-09-16-host-served-join-design.md`

## Global Constraints

- **nub, not npm.** `nubx` replaces `npx`. Every `nub`/`nubx`/`cargo` call needs
  `export PATH="$HOME/.local/share/mise/shims:$PATH"` in the same shell invocation.
- **Do not `cargo build` or `cargo check` `src-tauri/`** — webkit2gtk is absent.
  `cargo test -p lan-sync` is the Rust feedback loop. `src-tauri` changes are
  verified by CI's Android build, not locally.
- **`cargo clippy` is only as strict as the toolchain running it.** CI uses
  whatever `stable` is that day. Run `rustup update stable` before trusting a
  clean clippy — this branch already went red on exactly this.
- **`cargo fmt --all` from the root covers `crates/` only.** `src-tauri` needs
  `(cd src-tauri && cargo fmt)`.
- **`packages/engine/src/**` must stay pure.** Nothing in this plan touches it.
- Branch: `claude/snake-ladders-cross-device-3uu177`, currently at `main`
  (`4a1eefc`) plus the spec commit. Push with
  `git push -u origin claude/snake-ladders-cross-device-3uu177`.
- Commits end with the two trailers already used on this branch. **Never put a
  model identifier in a commit message, PR body, or code comment.**
- Gates: `nub run test`, `nub run typecheck`, `nub run lint`; Rust tasks add
  `cargo test -p lan-sync` and `cargo clippy -p lan-sync --all-targets -- -D warnings`.

## File Structure

| File | Responsibility |
|---|---|
| `crates/lan-sync/src/assets.rs` (new) | The `AssetSource` trait and the request-path → response rules. No I/O, no sockets — pure enough to unit-test. |
| `crates/lan-sync/src/host.rs` (modify) | Carry an optional `AssetSource`; add the serve branch beside the upgrade branch. |
| `crates/lan-sync/src/lib.rs` (modify) | `pub mod assets;` and a `local_address()` helper. |
| `crates/lan-sync/src/session.rs` (modify) | Pass assets through `Session::host`. |
| `src-tauri/src/lib.rs` (modify) | Implement `AssetSource` over Tauri's `AssetResolver`; add `address` to `HostedRoom`. |
| `packages/net/src/transport.ts` (modify) | `HostedRoom.address`. |
| `packages/app-shell/src/routes/lobby.tsx` (modify) | Render the QR and the readable address. |
| `packages/ui/src/QrCode.tsx` (new) | A QR as an SVG. One responsibility, no app knowledge. |

---

### Task 1: The serving rules, as pure functions

The rules that decide what a request path maps to are the part most likely to
carry a security bug, and they need no socket to test. `scripts/drive-app.mjs`
shipped a path-traversal bug once — a prefix that did not end on a path boundary
left a *relative* remainder, which `join` then walked back out of `dist`. Pin
the rules before wiring them to anything.

**Files:**
- Create: `crates/lan-sync/src/assets.rs`
- Modify: `crates/lan-sync/src/lib.rs`

**Interfaces:**
- Produces, used by Tasks 2 and 4:
  - `pub trait AssetSource: Send + Sync + 'static { fn get(&self, path: &str) -> Option<Asset>; }`
  - `pub struct Asset { pub bytes: Vec<u8>, pub content_type: String }`
  - `pub fn request_path(request_line: &str) -> Option<String>` — the path from
    a `GET /x HTTP/1.1` line, query and fragment stripped, `/` normalised to
    `index.html`, or `None` when the path escapes the root.
  - `pub fn http_response(asset: &Asset) -> Vec<u8>` and
    `pub fn not_found() -> Vec<u8>`.

- [x] **Step 1: Write the failing tests**

Create `crates/lan-sync/src/assets.rs` containing only this test module, so it
compiles to a named failure rather than a parse error:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_root_to_the_index() {
        assert_eq!(request_path("GET / HTTP/1.1").as_deref(), Some("index.html"));
    }

    #[test]
    fn keeps_a_normal_asset_path() {
        assert_eq!(
            request_path("GET /assets/main.js HTTP/1.1").as_deref(),
            Some("assets/main.js")
        );
    }

    #[test]
    fn strips_the_query_and_fragment() {
        assert_eq!(
            request_path("GET /assets/a.js?v=2 HTTP/1.1").as_deref(),
            Some("assets/a.js")
        );
        // The hash router means a real request can carry one.
        assert_eq!(request_path("GET /#/lobby HTTP/1.1").as_deref(), Some("index.html"));
    }

    #[test]
    fn refuses_a_path_that_climbs_out() {
        assert_eq!(request_path("GET /../etc/passwd HTTP/1.1"), None);
        assert_eq!(request_path("GET /assets/../../etc/passwd HTTP/1.1"), None);
    }

    #[test]
    fn refuses_a_percent_encoded_climb() {
        // %2e%2e is "..", and decoding before checking is the classic bug.
        assert_eq!(request_path("GET /%2e%2e/etc/passwd HTTP/1.1"), None);
        assert_eq!(request_path("GET /%2E%2E%2Fetc/passwd HTTP/1.1"), None);
    }

    #[test]
    fn refuses_a_backslash_climb() {
        assert_eq!(request_path("GET /..\\etc\\passwd HTTP/1.1"), None);
    }

    #[test]
    fn refuses_anything_that_is_not_a_get() {
        assert_eq!(request_path("POST / HTTP/1.1"), None);
        assert_eq!(request_path("garbage"), None);
    }

    #[test]
    fn writes_a_response_with_the_length_and_type() {
        let asset = Asset { bytes: b"hi".to_vec(), content_type: "text/html".into() };
        let out = String::from_utf8_lossy(&http_response(&asset)).to_string();
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "got: {out}");
        assert!(out.contains("Content-Type: text/html\r\n"), "got: {out}");
        assert!(out.contains("Content-Length: 2\r\n"), "got: {out}");
        assert!(out.ends_with("\r\n\r\nhi"), "got: {out}");
    }

    #[test]
    fn not_found_is_a_404() {
        let out = String::from_utf8_lossy(&not_found()).to_string();
        assert!(out.starts_with("HTTP/1.1 404 "), "got: {out}");
        assert!(out.contains("Content-Length: 0\r\n"), "got: {out}");
    }
}
```

Add `pub mod assets;` to `crates/lan-sync/src/lib.rs`, beside `pub mod ws;`.

- [x] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync assets::
```

Expected: FAIL to compile — `request_path`, `Asset`, `http_response` and
`not_found` are not defined.

- [x] **Step 3: Implement**

Write above the test module in `crates/lan-sync/src/assets.rs`:

```rust
//! What the host serves to a browser, and the rules for deciding it.
//!
//! Separated from `host.rs` because these are the decisions a mistake in which
//! would serve a file nobody meant to publish, and they need no socket to test.

/// One servable file. Deliberately owned rather than borrowed: the Tauri asset
/// resolver hands back owned bytes, and a lifetime here would infect the trait.
pub struct Asset {
    pub bytes: Vec<u8>,
    pub content_type: String,
}

/// Where the host gets the page it serves. Injected so `lan-sync` never learns
/// what a Tauri app is — the same reason `SessionSink` exists.
pub trait AssetSource: Send + Sync + 'static {
    fn get(&self, path: &str) -> Option<Asset>;
}

/// The path a request line asks for, or `None` if it is not a `GET` we will
/// answer. The returned path is always relative with no `..` segment, so a
/// caller cannot be talked into climbing out of wherever it resolves paths.
pub fn request_path(request_line: &str) -> Option<String> {
    let mut parts = request_line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    // Strip the fragment first: a hash-routed URL carries the route after `#`,
    // and browsers do not send it, but a hand-written request might.
    let target = target.split('#').next()?;
    let target = target.split('?').next()?;

    // Reject before decoding, and reject the decoded form too. Deciding on the
    // decoded string alone is the classic traversal bug; deciding on the raw
    // one alone misses `%2e%2e`.
    let decoded = percent_decode(target);
    for candidate in [target, decoded.as_str()] {
        if candidate.contains("..") || candidate.contains('\\') || candidate.contains('\0') {
            return None;
        }
    }

    let trimmed = decoded.trim_start_matches('/');
    if trimmed.is_empty() {
        return Some("index.html".to_string());
    }
    Some(trimmed.to_string())
}

/// Minimal percent-decoding. Only needs to be good enough to spot an escape
/// attempt; a byte it cannot decode is left alone, which keeps the check
/// conservative rather than clever.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn http_response(asset: &Asset) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n",
        asset.content_type,
        asset.bytes.len()
    )
    .into_bytes();
    out.extend_from_slice(&asset.bytes);
    out
}

pub fn not_found() -> Vec<u8> {
    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync assets::
```

Expected: PASS, 9 tests.

- [x] **Step 5: Lint and format**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
rustup update stable
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all
```

Expected: clean. Fix anything clippy raises before committing — CI runs a
newer toolchain than a container usually has.

- [x] **Step 6: Commit**

```bash
git add crates/lan-sync/src/assets.rs crates/lan-sync/src/lib.rs
git commit -m "feat: add the host's asset-serving rules"
```

---

### Task 2: The host serves assets on its existing port

**Files:**
- Modify: `crates/lan-sync/src/host.rs` — `Host::bind` (~line 67), `Shared`
  (~line 23), and the plain-`GET` branch (~lines 359-363)
- Test: `crates/lan-sync/tests/relay.rs`

**Interfaces:**
- Consumes: `AssetSource`, `Asset`, `request_path`, `http_response`,
  `not_found` from Task 1.
- Produces, used by Task 3:
  - `Host::bind_with_assets(room: impl Into<String>, port: u16, capacity: u8, assets: Option<Arc<dyn AssetSource>>) -> std::io::Result<Host>`
  - `Host::bind` keeps its exact current signature and delegates with `None`,
    so every existing call site and test is untouched.

- [x] **Step 1: Write the failing tests**

Append to `crates/lan-sync/tests/relay.rs`:

```rust
// --- serving the page ------------------------------------------------------

struct FakeAssets;

impl lan_sync::assets::AssetSource for FakeAssets {
    fn get(&self, path: &str) -> Option<lan_sync::assets::Asset> {
        match path {
            "index.html" => Some(lan_sync::assets::Asset {
                bytes: b"<!doctype html><title>game</title>".to_vec(),
                content_type: "text/html".into(),
            }),
            _ => None,
        }
    }
}

/// Send one raw request and read everything the host writes back.
fn raw_request(port: u16, request: &str) -> String {
    use std::io::{Read, Write};
    let mut stream = std::net::TcpStream::connect(local(port)).expect("connect");
    stream.set_read_timeout(Some(TIMEOUT)).unwrap();
    stream.write_all(request.as_bytes()).expect("write");
    let mut out = Vec::new();
    let _ = stream.read_to_end(&mut out);
    String::from_utf8_lossy(&out).to_string()
}

#[test]
fn serves_the_index_at_the_root() {
    let host = Host::bind_with_assets("PAGE", 0, 4, Some(std::sync::Arc::new(FakeAssets)))
        .expect("host should bind");
    let response = raw_request(host.port(), "GET / HTTP/1.1\r\nHost: x\r\n\r\n");

    assert!(response.starts_with("HTTP/1.1 200 OK"), "got: {response}");
    assert!(response.contains("<title>game</title>"), "got: {response}");
}

#[test]
fn answers_404_for_an_asset_it_does_not_have() {
    let host = Host::bind_with_assets("PAGE", 0, 4, Some(std::sync::Arc::new(FakeAssets)))
        .expect("host should bind");
    let response = raw_request(host.port(), "GET /nope.js HTTP/1.1\r\nHost: x\r\n\r\n");

    assert!(response.starts_with("HTTP/1.1 404"), "got: {response}");
}

#[test]
fn refuses_a_traversal_without_consulting_the_source() {
    let host = Host::bind_with_assets("PAGE", 0, 4, Some(std::sync::Arc::new(FakeAssets)))
        .expect("host should bind");
    let response = raw_request(
        host.port(),
        "GET /../../etc/passwd HTTP/1.1\r\nHost: x\r\n\r\n",
    );

    assert!(response.starts_with("HTTP/1.1 404"), "got: {response}");
    assert!(!response.contains("root:"), "got: {response}");
}

#[test]
fn a_plain_get_is_still_400_when_there_are_no_assets() {
    // The pre-ADR-0019 contract: a host with nothing to serve does not
    // suddenly start answering 404s as if it were a web server.
    let host = Host::bind("PAGE", 0, 4).expect("host should bind");
    let response = raw_request(host.port(), "GET / HTTP/1.1\r\nHost: x\r\n\r\n");

    assert!(response.starts_with("HTTP/1.1 400"), "got: {response}");
}

#[test]
fn a_websocket_upgrade_still_works_alongside_assets() {
    use std::io::{Read, Write};

    let host = Host::bind_with_assets("PAGE", 0, 4, Some(std::sync::Arc::new(FakeAssets)))
        .expect("host should bind");
    let mut stream = std::net::TcpStream::connect(local(host.port())).expect("connect");
    stream.set_read_timeout(Some(TIMEOUT)).unwrap();
    let request = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nUpgrade: websocket\r\n\
         Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n",
        host.port()
    );
    stream.write_all(request.as_bytes()).expect("write");

    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).expect("response head");
        head.push(byte[0]);
    }
    let head = String::from_utf8(head).expect("utf-8");
    assert!(head.starts_with("HTTP/1.1 101 "), "got: {head}");
}

#[test]
fn an_asset_request_does_not_occupy_a_room_slot() {
    let host = Host::bind_with_assets("PAGE", 0, 1, Some(std::sync::Arc::new(FakeAssets)))
        .expect("host should bind");
    // Capacity one: if fetching the page consumed the only seat, this join
    // would be refused.
    for _ in 0..3 {
        let _ = raw_request(host.port(), "GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    }
    let peer = join(&host, "alice");
    wait_for_join(&peer);
}
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync --test relay serves_ 2>&1 | tail -20
```

Expected: FAIL to compile — `Host::bind_with_assets` does not exist.

- [x] **Step 3: Carry the assets on `Shared`**

In `crates/lan-sync/src/host.rs`, add to `struct Shared`:

```rust
    /// `None` when nothing is being served, which keeps a bare host answering
    /// a plain GET with 400 exactly as it did before.
    assets: Option<Arc<dyn crate::assets::AssetSource>>,
```

Replace `Host::bind`'s signature and body head with:

```rust
    /// Bind a listener. Port 0 asks the OS for a free port, which is then
    /// published in the discovery beacon.
    pub fn bind(room: impl Into<String>, port: u16, capacity: u8) -> std::io::Result<Self> {
        Self::bind_with_assets(room, port, capacity, None)
    }

    /// As `bind`, but also serve the game's own page to browsers on this port.
    /// One origin for the page and the socket is the entire point: a browser
    /// will not open a `ws://` from an `https://` page, but will from `http://`.
    pub fn bind_with_assets(
        room: impl Into<String>,
        port: u16,
        capacity: u8,
        assets: Option<Arc<dyn crate::assets::AssetSource>>,
    ) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("0.0.0.0", port))?;
        let inner = Arc::new(Shared {
            room: room.into(),
            capacity,
            running: AtomicBool::new(true),
            locked: AtomicBool::new(false),
            state: Mutex::new(HostState::default()),
            assets,
        });
```

The rest of the original `bind` body follows unchanged.

- [x] **Step 4: Add the serve branch**

In `serve_client`, replace the 400 branch (currently at ~line 359):

```rust
        let Some(response) = crate::ws::handshake_response(&request) else {
            // Not an upgrade. If this host has a page, this is a browser asking
            // for it; otherwise keep the old contract and refuse.
            let reply = match (&shared.assets, request.lines().next()) {
                (Some(source), Some(line)) => match crate::assets::request_path(line) {
                    Some(path) => match source.get(&path) {
                        Some(asset) => crate::assets::http_response(&asset),
                        None => crate::assets::not_found(),
                    },
                    None => crate::assets::not_found(),
                },
                _ => b"HTTP/1.1 400 Bad Request\r\n\r\n".to_vec(),
            };
            let _ = write_half.write_all(&reply);
            return;
        };
```

Note the `return`: an asset request closes the connection and never reaches the
handshake, which is why it cannot occupy a room slot.

- [x] **Step 5: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync
```

Expected: PASS, including every pre-existing test. The newline-JSON path and
the WebSocket path must both be untouched.

- [x] **Step 6: Lint, format, commit**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all
git add crates/lan-sync/src/host.rs crates/lan-sync/tests/relay.rs
git commit -m "feat: serve the game's page from the host's own port"
```

---

### Task 3: The host learns its own LAN address

`discovery.rs` broadcasts to `255.255.255.255` and never enumerates interfaces,
so nothing in the Rust half knows the host's own address — and the stdlib cannot
enumerate interfaces either. Rather than add a dependency, open a `UdpSocket`
and `connect()` it to a non-routable address: no packet is sent, no network is
needed, and `local_addr()` then reports the interface that would carry outbound
traffic, which is the one a guest on that Wi-Fi can reach.

**Files:**
- Modify: `crates/lan-sync/src/lib.rs`
- Modify: `crates/lan-sync/src/session.rs` — `Session::host` (~line 72)
- Test: `crates/lan-sync/src/lib.rs` (inline `#[cfg(test)]`)

**Interfaces:**
- Consumes: `AssetSource` from Task 1, `Host::bind_with_assets` from Task 2.
- Produces, used by Task 4:
  - `pub fn local_address() -> Option<std::net::IpAddr>`
  - `Session::host_with_assets(seed: u32, display_name: impl Into<String>, capacity: u8, advertise: bool, assets: Option<Arc<dyn AssetSource>>) -> std::io::Result<Session>`;
    `Session::host` keeps its signature and delegates with `None`.

- [x] **Step 1: Write the failing test**

Append to `crates/lan-sync/src/lib.rs`:

```rust
#[cfg(test)]
mod local_address_tests {
    use super::*;

    #[test]
    fn reports_a_usable_non_loopback_address() {
        // A container with only loopback legitimately has none, so this asserts
        // the shape of an answer rather than that one exists.
        match local_address() {
            Some(addr) => {
                assert!(!addr.is_unspecified(), "0.0.0.0 is not an address to hand out");
                assert!(!addr.is_loopback(), "loopback is unreachable from another device");
            }
            None => {}
        }
    }

    #[test]
    fn is_cheap_enough_to_call_repeatedly() {
        // It must not block or hit the network: the lobby may re-render often.
        let start = std::time::Instant::now();
        for _ in 0..50 {
            let _ = local_address();
        }
        assert!(start.elapsed() < std::time::Duration::from_secs(1));
    }
}
```

- [x] **Step 2: Run it to verify it fails**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync local_address
```

Expected: FAIL to compile — `local_address` is not defined.

- [x] **Step 3: Implement `local_address`**

Add to `crates/lan-sync/src/lib.rs`:

```rust
/// The address a guest on this Wi-Fi could reach this host on.
///
/// There is no interface enumeration in the standard library, and the discovery
/// beacon broadcasts rather than enumerating, so nothing here knew its own
/// address. Connecting a UDP socket sends no packet — it only fixes a route —
/// so this works with no network and answers with the interface that outbound
/// traffic would leave by.
///
/// It reports one address. A host on two networks may be reachable on the other
/// one, which is why the lobby also shows the address as text to read out.
pub fn local_address() -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, UdpSocket};
    let socket = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    // TEST-NET-1: guaranteed not to be routed anywhere, and never contacted.
    socket.connect(("192.0.2.1", 9)).ok()?;
    let addr = socket.local_addr().ok()?.ip();
    match addr {
        IpAddr::V4(v4) if v4.is_loopback() || v4.is_unspecified() => None,
        _ => Some(addr),
    }
}
```

- [x] **Step 4: Thread assets through `Session::host`**

In `crates/lan-sync/src/session.rs`:

```rust
    pub fn host(
        seed: u32,
        display_name: impl Into<String>,
        capacity: u8,
        advertise: bool,
    ) -> std::io::Result<Self> {
        Self::host_with_assets(seed, display_name, capacity, advertise, None)
    }

    /// As `host`, but the room also serves the page to browsers.
    pub fn host_with_assets(
        seed: u32,
        display_name: impl Into<String>,
        capacity: u8,
        advertise: bool,
        assets: Option<Arc<dyn crate::assets::AssetSource>>,
    ) -> std::io::Result<Self> {
        let room = crate::room_code(seed);
        let host = Host::bind_with_assets(room.clone(), 0, capacity, assets)?;
```

The rest of the original `host` body follows unchanged. Add `use std::sync::Arc;`
to the file's imports if it is not already there.

- [x] **Step 5: Run the tests**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo test -p lan-sync
cargo clippy -p lan-sync --all-targets -- -D warnings
cargo fmt --all
```

Expected: PASS and clean.

- [x] **Step 6: Commit**

```bash
git add crates/lan-sync/src/lib.rs crates/lan-sync/src/session.rs
git commit -m "feat: let the host report the address a guest can reach it on"
```

---


**Note (execution):** clippy's `single_match` rejected Step 1's test as written
(`match local_address() { Some(..) => .., None => {} }`). Rewritten as `if let`;
the intent — a loopback-only container legitimately has no address — is
unchanged and still commented. `local_address()` answers `Some(192.0.2.2)` in
this container: its `eth0` sits on `192.0.2.0/24` with `192.0.2.1` as the
gateway, so the TEST-NET-1 probe target the plan called "guaranteed not to be
routed anywhere" is in fact this container's own subnet. The answer is still
correct — a connected UDP socket sends nothing and reports the egress
interface — but the code comment was corrected to stop claiming otherwise.
The real failure mode is a machine with *no* default route, where `connect`
fails and the lobby shows the no-address branch.

### Task 4: Wire Tauri's embedded assets to the host

**This task cannot be compiled in a dev container** — `src-tauri` needs
webkit2gtk. CI's Android build is the feedback loop. Read the change twice
before pushing, and expect the APK job to be the thing that confirms it.

**Files:**
- Modify: `src-tauri/src/lib.rs` — `HostedRoom` (~line 54), `net_host` (~line 150)

**Interfaces:**
- Consumes: `AssetSource`, `Asset` (Task 1); `Session::host_with_assets`,
  `local_address` (Task 3).
- Produces, used by Task 5: `HostedRoom` gains
  `address: Option<String>` — the host's LAN IP as a string, `None` when it has
  none (loopback only, no Wi-Fi).

- [x] **Step 1: Confirm the Tauri asset API before writing against it**

Tauri is not vendored in this container, so the exact shape of `AssetResolver`
must be read, not assumed. Check the installed crate:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cargo fetch --manifest-path src-tauri/Cargo.toml
find ~/.cargo/registry/src -path '*tauri-2*' -name '*.rs' | xargs grep -l 'AssetResolver' | head -3
```

Expected shape, to be confirmed rather than trusted: `app.asset_resolver()`
returns an `AssetResolver`, whose `get(&self, path: String)` returns an
`Option<Asset>` carrying `bytes: Vec<u8>` and `mime_type: String`. If the real
names differ, adapt Step 2 and say so in the task note — do not force the code
to match this plan.

- [x] **Step 2: Implement the adapter**

In `src-tauri/src/lib.rs`:

```rust
/// Serves the app's own embedded bundle to browsers on the LAN.
///
/// This is the only place that knows both Tauri and `lan-sync`; the crate
/// itself stays Tauri-free so it keeps building and testing anywhere.
struct EmbeddedAssets {
    app: AppHandle,
}

impl lan_sync::assets::AssetSource for EmbeddedAssets {
    fn get(&self, path: &str) -> Option<lan_sync::assets::Asset> {
        // `request_path` has already refused anything with a `..` segment, so
        // the resolver is never asked to look outside the bundle.
        let asset = self.app.asset_resolver().get(format!("/{path}"))?;
        Some(lan_sync::assets::Asset {
            bytes: asset.bytes,
            content_type: asset.mime_type,
        })
    }
}
```

Add `address` to `HostedRoom`:

```rust
struct HostedRoom {
    room: String,
    port: u16,
    seed: u32,
    /// The LAN address a browser can load the page from, when there is one.
    address: Option<String>,
}
```

And in `net_host`, replace the `Session::host` call and the `hosted` value:

```rust
    let assets: Arc<dyn lan_sync::assets::AssetSource> =
        Arc::new(EmbeddedAssets { app: app.clone() });
    let session = Arc::new(
        Session::host_with_assets(seed, name, capacity, true, Some(assets)).map_err(err)?,
    );
    let hosted = HostedRoom {
        room: session.room().unwrap_or_default().to_string(),
        port: session.port().unwrap_or(0),
        seed,
        address: lan_sync::local_address().map(|ip| ip.to_string()),
    };
```

- [x] **Step 3: Format**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
(cd src-tauri && cargo fmt)
```

`cargo fmt --all` from the root does **not** reach `src-tauri` — it is its own
workspace, and the root command is silent because it does not look.

- [x] **Step 4: Commit and let CI compile it**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: serve the app's embedded bundle to browsers on the LAN"
git push -u origin claude/snake-ladders-cross-device-3uu177
```

Watch `.github/workflows/android.yml`. A compile error here surfaces only
there; do not move on until the APK job is green.

---


**Note (execution):** the Tauri API matched the plan's assumed shape exactly
(tauri 2.11.5): `asset_resolver()` is on `AppHandle` via `shared_app_impl!`,
`get(path: String) -> Option<Asset>`, `Asset { bytes: Vec<u8>, mime_type:
String }`, and `get_asset` strips the leading `/`, so `format!("/{path}")`
is right. `AppHandle: Send + Sync + 'static` holds, which `AssetSource`
requires.

The plan's claim that `request_path` leaves the resolver unable to look
outside the bundle was **false as written**, and reading the resolver is
what caught it: `get_asset` percent-decodes again, and `request_path`
returned an already-decoded path, so `%252e%252e` survived as the literal
`%2e%2e` for Tauri to decode into `..`. Production is saved only because
the embedded bundle is a lookup table, but Tauri's `#[cfg(dev)]` branch
does a real `fs::read`. `request_path` now decodes to a fixpoint. Fixed in
`7487e22`, with two regressions.

### Task 5: The lobby shows a QR and a readable address

**Files:**
- Create: `packages/ui/src/QrCode.tsx`
- Modify: `packages/net/src/transport.ts:20-24`
- Modify: `packages/app-shell/src/routes/lobby.tsx:79-92`
- Modify: `apps/game-web/styles.css`
- Modify: root `package.json`
- Test: `packages/ui/src/__tests__/QrCode.test.tsx`

**Interfaces:**
- Consumes: `HostedRoom.address` from Task 4.
- Produces: `QrCode({ value, size }: { value: string; size?: number })` — an
  SVG element. No app knowledge; it encodes whatever string it is given.

- [x] **Step 1: Add the dependency**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub add qrcode-generator@2.0.4
```

Chosen over `qrcode`, which pulls in `pngjs`, `yargs` and `dijkstrajs` — the
wrong trade for a bundle that ships to phones. `qrcode-generator` has no
dependencies and ships its own types at `dist/qrcode.d.ts`.

- [x] **Step 2: Write the failing test**

Create `packages/ui/src/__tests__/QrCode.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { QrCode } from "../QrCode"

describe("QrCode", () => {
  it("renders an svg that scales to its box", () => {
    const html = renderToStaticMarkup(<QrCode value="http://192.168.1.5:41595/" />)

    expect(html).toContain("<svg")
    expect(html).toContain("viewBox")
  })

  it("encodes more modules for a longer value", () => {
    const short = renderToStaticMarkup(<QrCode value="http://a/" />)
    const long = renderToStaticMarkup(
      <QrCode value={`http://192.168.1.5:41595/#/join?room=W3SZ&x=${"y".repeat(200)}`} />,
    )
    const modules = (s: string) => Number(/viewBox="0 0 (\d+)/.exec(s)?.[1] ?? 0)

    expect(modules(long)).toBeGreaterThan(modules(short))
  })

  it("renders nothing for an empty value rather than throwing", () => {
    expect(renderToStaticMarkup(<QrCode value="" />)).toBe("")
  })
})
```

- [x] **Step 3: Run it to verify it fails**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nubx vitest run packages/ui/src/__tests__/QrCode.test.tsx
```

Expected: FAIL — `../QrCode` does not resolve.

- [x] **Step 4: Implement**

Create `packages/ui/src/QrCode.tsx`:

```tsx
import qrcode from "qrcode-generator"

/**
 * A QR as one SVG path rather than a canvas: it scales to any size without
 * blurring, needs no ref or effect, and renders identically server-side, which
 * is what makes it testable without a browser.
 */
export const QrCode = ({ value, size = 180 }: { readonly value: string; readonly size?: number }) => {
  if (!value) return null

  // Type 0 lets the library pick the smallest version that fits. "M" corrects
  // ~15% damage, which is the usual trade for a code read off a screen.
  const qr = qrcode(0, "M")
  qr.addData(value)
  qr.make()

  const count = qr.getModuleCount()
  const path: string[] = []
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path.push(`M${col},${row}h1v1h-1z`)
    }
  }

  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Scan to join this room"
    >
      <rect width={count} height={count} fill="#fff" />
      <path d={path.join("")} fill="#000" />
    </svg>
  )
}
```

If `packages/ui/package.json` exists, declare `qrcode-generator` there too —
nub's isolated layout fails an undeclared import rather than resolving it.

- [x] **Step 5: Add `address` to the transport type**

In `packages/net/src/transport.ts`:

```ts
export interface HostedRoom {
  readonly room: string
  readonly port: number
  readonly seed: number
  /** The LAN address a browser can load the page from, if the host has one. */
  readonly address: string | null
}
```

- [x] **Step 6: Render it in the lobby**

In `packages/app-shell/src/routes/lobby.tsx`, replace the `role === "host"`
hint block with:

```tsx
        {role === "host" && room && (
          <div className="join-invite">
            {room.address ? (
              <>
                <QrCode value={`http://${room.address}:${room.port}/`} />
                <p className="hint">
                  Scan this to join from a phone or laptop — no install needed.
                  Or open <code>{room.address}:{room.port}</code> in a browser on
                  this Wi-Fi.
                </p>
              </>
            ) : (
              <p className="hint">
                This device has no Wi-Fi address, so browsers cannot reach it.
                Nearby installed apps can still join with the room code.
              </p>
            )}
            <p className="hint">
              Port {room.port}. Nearby devices find this automatically on the
              Join screen; if one doesn't see it, it can enter this device's own
              Wi-Fi address as{" "}
              <code>address:{room.port}@{roomCode(match.config.seed)}</code>.
            </p>
          </div>
        )}
```

Import `QrCode` from `@mutation/ui/QrCode`, matching how `BoardCanvas` and
`HUD` are already imported in this package.

- [x] **Step 7: Style it**

Append to `apps/game-web/styles.css`:

```css
.join-invite {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}

/* White quiet zone around the code: a scanner needs the border, and the dark
   page background would otherwise run right up to the modules. */
.qr {
  padding: 0.5rem;
  background: #fff;
  border-radius: 0.5rem;
  max-width: 60vw;
  height: auto;
}
```

- [x] **Step 8: Run every gate**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
nub run build && nub run verify:ui
```

Expected: all pass, including no console errors and no horizontal overflow.

- [x] **Step 9: Look at it**

`verify:ui` screenshots the home, lobby, and match screens. The lobby shot is
pass-and-play, which renders no QR, so drive the host path yourself and look at
the result before claiming it works — a QR that renders as a black square, or
overflows a phone, is invisible in the source and obvious in a screenshot.

- [x] **Step 10: Commit**

```bash
git add packages/ui/src/QrCode.tsx packages/ui/src/__tests__/QrCode.test.tsx \
        packages/net/src/transport.ts packages/app-shell/src/routes/lobby.tsx \
        apps/game-web/styles.css package.json nub.lock
git commit -m "feat: show a scannable join code in the host lobby"
```

---


**Note (execution):** three things the plan did not anticipate.

1. `vitest.config.ts` included only `*.test.ts`, so `QrCode.test.tsx` would
   have been collected by nothing and "passed" by never running. The include
   is now `*.test.{ts,tsx}`.
2. `packages/ui/package.json` does not exist, so the plan's conditional
   step to declare the dependency there does not apply; the root
   `package.json` carries it.
3. `packages/net/src/local.ts` constructs a `HostedRoom` and had to gain
   `address: null` — pass-and-play is one device, so there is nothing for a
   guest to reach. The plan listed only `transport.ts`.

**On Step 9 (look at it):** a browser can never host — `websocket.ts`'s
`host` is `unsupported` — so the host lobby is unreachable by driving the
web build, and `verify:ui`'s lobby shot is pass-and-play as the plan said.
The lobby's host block was instead rendered with the real stylesheet at
390x844 and inspected. That caught a real defect: the quiet zone was CSS
`padding: 0.5rem`, a fixed 8px against a module size that shrinks as the
URL grows, giving ~1 module of margin where the format asks for 4. It is
now drawn inside the SVG and pinned by a test.

### Task 6: Documentation, and what is still unproven

**Files:**
- Modify: `docs/playing-together.md`
- Modify: `docs/handoff.md`
- Modify: `docs/adr/0019-the-native-host-speaks-websocket-on-its-own-port.md`

- [x] **Step 1: Rewrite the player-facing instructions**

In `docs/playing-together.md`, the "A browser joining an installed host" section
currently tells the player to read an `address:port@CODE` line and type it. That
is no longer the shortest path. Rewrite it around scanning, keep typing as the
fallback, and keep the `http://` caveat — it is still true, and it is now
satisfied automatically because the host serves the page.

Also update the device matrix row for "An Android host and a browser".

- [x] **Step 2: Note the consequence nobody will expect**

Add, in the same section: the guest's page comes from the host, so if the host
leaves the match or closes the app, a guest who reloads has nothing to reload
from. That is inherent to this design, not a bug, and a player who hits it
without warning will report it as one.

- [x] **Step 3: Extend ADR 0019's consequences**

ADR 0019 said one listener, two protocols. It is now three — newline JSON,
WebSocket, and HTTP. Add a short paragraph recording that the failure domain
widened accordingly: a bug in the request branch now breaks native peers too,
which is why detection is a `fill_buf` peek that consumes nothing.

- [x] **Step 4: Update the handoff**

Replace open thread 1 with what actually happened: it asked for a `wss://`
relay, and the answer was that the blocker is the page's origin rather than the
socket. Record that phase 2 (WebRTC) remains gated on a two-device mDNS test,
and that **nothing here has been played on real hardware** — the Rust tests
prove the host answers a browser's framing on loopback; they do not prove an
Android build serves it over real Wi-Fi to a real phone.

- [x] **Step 5: Run every gate and record real numbers**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
nub run test && nub run typecheck && nub run lint
cargo test -p lan-sync
```

Copy the actual counts into the handoff. Do not carry forward a number from
this plan.

- [x] **Step 6: Commit and push**

```bash
git add docs/
git commit -m "docs: record the host-served join and what it leaves unproven"
git push -u origin claude/snake-ladders-cross-device-3uu177
```

---


**Note (execution):** `docs/playing-together.md` carried a whole section —
"A browser and an installed app cannot join each other" — asserting that a
browser can never join a native host. ADR 0019 had already made that false,
and the rewrite this task asked for would have left the file contradicting
itself two screens apart. It is rewritten around what is *still* true: the
deployed HTTPS page is the one origin that cannot join, and the missing
direction is the installed app joining a browser's relay, which really does
have no WebSocket client.

Gate numbers in the handoff are the real ones from this run, not the plan's.

## Out of scope

- **WebRTC (phase 2 of the spec).** Gated on two physical devices resolving
  each other's mDNS candidates. No code until that is observed.
- **Teaching `apps/relay/lan-relay.mjs` to serve the page.** The same idea
  applies and `serveDist` already exists in `scripts/drive-app.mjs`, but a
  laptop host is a separate, smaller change.
- **A fixed port.** A QR makes the port invisible, so ephemeral stays. Revisit
  only if the QR turns out not to carry the flow.
- **An offline shell for the guest.** A plain-HTTP LAN origin is not a secure
  context, so no service worker registers. The guest does not need one.
