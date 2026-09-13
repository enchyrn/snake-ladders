# Rust Integrity and Release Performance Audit

Date: 2026-09-13
Scope: `crates/lan-sync` and the Tauri session boundary in `src-tauri/src/lib.rs`.

## Findings

### Accepted: host shutdown missed sockets in handshake

`serve_client` previously registered a socket in `HostState.clients` only after reading a complete hello. `Host::shutdown` closed only that map, and joining the listener thread did not join or interrupt client threads. An accepted peer blocked in `read_line` could therefore remain connected after the host closed; the peer saw no FIN and eventually timed out.

The regression is covered by `host_shutdown_closes_a_peer_still_in_handshake`. It connects a raw TCP peer, sends only a partial handshake, shuts down the host, and requires EOF. Before the fix it failed with `WouldBlock` after the read timeout.

The fix registers every accepted stream immediately in `HostState.pending`. Shutdown closes pending and established streams. A small RAII guard removes the pending entry after successful registration or when handshake processing exits early. The established registration path is unchanged, and shutdown still interrupts the listener with the existing loopback connection.

### Preserved transport contracts

- Actions remain opaque `serde_json::Value` payloads. Rust still assigns only dense sequence numbers and broadcasts the original action.
- `Session`, `SessionSink`, event ordering, catch-up behavior, rejection behavior, and Tauri event names were unchanged.
- `src-tauri/src/lib.rs` remains a thin command/session pump boundary. No native command change was necessary.
- The Tauri managed-state `Send + Sync` assertion remains covered by the existing integration test.

## Integrity review

- Socket lifecycle: accepted sockets are now tracked before handshake; all handshake exits remove their pending registry entry, and shutdown closes both pending and established clones.
- Buffering and frame parsing: newline-delimited JSON remains buffered by `BufReader`; malformed frames are rejected during handshake and ignored during the established frame loop as specified by existing tests.
- Lock scope: sequencing, client registration, catch-up, roster broadcast, and writes retain the existing state mutex boundary. Pending cleanup is deliberately outside the registration lock to avoid reacquisition deadlock.
- Backpressure: writes remain synchronous and a failed client write marks that client disconnected without aborting the room. No behavior change was introduced.
- Allocation: the new path adds one `TcpStream::try_clone` and one `HashMap` entry per accepted socket, removed after handshake. No action payload cloning or sequencing allocation strategy changed. No allocator profiler is installed, so this is an ownership/code-path measurement rather than a heap profile.
- Error propagation: existing `io::Result` and `SessionStatus` paths are unchanged; shutdown errors remain best-effort as before.

## Measurements

Commands were run through `mise exec -- cargo` because `cargo` is not directly on this shell's PATH.

- `mise exec -- cargo fmt --all -- --check`: passed.
- `mise exec -- cargo clippy -p lan-sync --all-targets -- -D warnings`: passed.
- `mise exec -- cargo test -p lan-sync`: passed, 12 relay tests and 8 session tests; debug test execution was 5.06 seconds including compilation.
- `mise exec -- cargo test -p lan-sync --release`: passed, 12 relay tests and 8 session tests; release execution was 21.92 seconds including a clean optimized compilation.
- `mise exec -- cargo test -p lan-sync --release --test session host_shutdown_closes_a_peer_still_in_handshake -- --exact --nocapture`: passed.
- The same formerly flaky `a_peer_notices_the_host_going_away` test passed 20 consecutive release invocations. Cached individual invocations completed in approximately 0.02-0.06 seconds, with the test body using its existing 20 ms polling interval.

The release suite includes the existing 50-action two-peer load test (`sequence_numbers_are_dense_and_gapless_under_load`) and verifies dense, gapless ordering. No benchmark was added: this audit introduces no throughput-sensitive implementation change, and test timing alone would not answer a separate performance question. The release timings above are evidence for the tested path, not a cross-machine throughput claim.

## Residual limits

- `src-tauri/src/lib.rs` was reviewed but cannot be built in this container because the Tauri webview/mobile toolchains are unavailable. The `lan-sync` crate remains Tauri-independent and was checked independently.
- Android, iOS, and real multi-device shutdown behavior require hardware and were not claimed here. Android APK validation remains the CI feedback loop documented in `CLAUDE.md`.
- No production allocator, packet-loss, or long-duration backpressure profile was available in this environment. Existing socket/load tests cover protocol ordering and basic peer failure behavior.
