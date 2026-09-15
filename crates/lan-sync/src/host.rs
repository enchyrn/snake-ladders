use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crate::protocol::{decode, encode, Downstream, PeerInfo, Sequenced, Upstream};

/// The authoritative sequencer.
///
/// The host decides the *order* of actions and nothing else — it never
/// computes game state. Every peer, host included, folds the same numbered log
/// through the same TypeScript reducer and arrives at the same match. That
/// keeps the Rust side small enough to be obviously correct, and means a
/// desync can only come from the engine, never from the network.
pub struct Host {
    inner: Arc<Shared>,
    local_port: u16,
    listener_thread: Option<JoinHandle<()>>,
}

struct Shared {
    room: String,
    capacity: u8,
    running: AtomicBool,
    locked: AtomicBool,
    state: Mutex<HostState>,
}

#[derive(Default)]
struct HostState {
    next_seq: u64,
    log: Vec<Sequenced>,
    clients: HashMap<String, Client>,
    /// Accepted sockets that have not finished a handshake, keyed by a number
    /// this host hands out rather than by peer address. Two connections can
    /// share an address once the OS recycles a source port, and then a
    /// retiring connection's `Drop` evicts the live one's entry — leaving it
    /// invisible to `shutdown`'s drain.
    pending: HashMap<u64, TcpStream>,
    next_pending_id: u64,
    /// Bumped on every registration under a player_id, so a connection whose
    /// thread outlives its own registration can tell whether the entry it
    /// finds is still the one it installed.
    next_epoch: u64,
    /// Actions committed locally, drained by the host's own UI thread.
    outbox: Vec<Sequenced>,
}

struct Client {
    name: String,
    stream: TcpStream,
    connected: bool,
    /// Whether this peer is a browser, and so wants WebSocket frames rather
    /// than newline-delimited JSON. The payload is identical either way.
    ws: bool,
    /// Set at registration from `HostState::next_epoch`. A connection that
    /// reaches the exit path only acts on the entry if this still matches —
    /// player_id is reused across a reconnect, so by then the map entry may
    /// belong to the connection that replaced this one.
    epoch: u64,
}

impl Host {
    /// Bind a listener. Port 0 asks the OS for a free port, which is then
    /// published in the discovery beacon.
    pub fn bind(room: impl Into<String>, port: u16, capacity: u8) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("0.0.0.0", port))?;
        let inner = Arc::new(Shared {
            room: room.into(),
            capacity,
            running: AtomicBool::new(true),
            locked: AtomicBool::new(false),
            state: Mutex::new(HostState::default()),
        });

        let listener_inner = Arc::clone(&inner);
        let local_addr = listener.local_addr()?;
        let listener_thread = thread::spawn(move || {
            for incoming in listener.incoming() {
                if !listener_inner.running.load(Ordering::SeqCst) {
                    break;
                }
                match incoming {
                    Ok(stream) => {
                        // Registration must not be conditional on anything that
                        // can fail independently of the connection being live.
                        // `peer_addr()` and `try_clone()` both can, and either
                        // one failing used to drop the stream into
                        // `serve_client` with no entry in `pending` — so
                        // `shutdown`'s drain could never reach it, race or no
                        // race, and the peer waited out its own read timeout
                        // instead of being told the host had gone. A stream
                        // that cannot be registered is refused here rather than
                        // served untracked.
                        let registered = stream.try_clone().ok().and_then(|registry| {
                            let mut state = listener_inner.state.lock().ok()?;
                            let id = state.next_pending_id;
                            state.next_pending_id += 1;
                            state.pending.insert(id, registry);
                            Some(id)
                        });
                        let Some(id) = registered else {
                            let _ = stream.shutdown(Shutdown::Both);
                            continue;
                        };
                        let per_client = Arc::clone(&listener_inner);
                        thread::spawn(move || serve_client(per_client, stream, id));
                    }
                    // A single refused connection must not take the room down.
                    Err(_) => continue,
                }
            }
        });

        Ok(Self {
            inner,
            local_port: local_addr.port(),
            listener_thread: Some(listener_thread),
        })
    }

    pub fn port(&self) -> u16 {
        self.local_port
    }

    pub fn room(&self) -> &str {
        &self.inner.room
    }

    /// Stop accepting joins once the match is under way.
    pub fn lock(&self) {
        self.inner.locked.store(true, Ordering::SeqCst);
    }

    pub fn is_locked(&self) -> bool {
        self.inner.locked.load(Ordering::SeqCst)
    }

    pub fn peer_count(&self) -> usize {
        self.inner
            .state
            .lock()
            .map(|s| s.clients.values().filter(|c| c.connected).count())
            .unwrap_or(0)
    }

    pub fn roster(&self) -> Vec<PeerInfo> {
        self.inner
            .state
            .lock()
            .map(|s| roster_of(&s))
            .unwrap_or_default()
    }

    /// Commit an action raised by the host's own player.
    pub fn submit(&self, action: serde_json::Value) -> Option<Sequenced> {
        let mut state = self.inner.state.lock().ok()?;
        Some(commit(&mut state, action))
    }

    /// Take everything committed since the last call, in order.
    pub fn drain(&self) -> Vec<Sequenced> {
        self.inner
            .state
            .lock()
            .map(|mut s| std::mem::take(&mut s.outbox))
            .unwrap_or_default()
    }

    pub fn log_len(&self) -> usize {
        self.inner.state.lock().map(|s| s.log.len()).unwrap_or(0)
    }

    /// Sockets accepted but not yet through a handshake. Exposed so a test can
    /// pin that every accepted connection is tracked, which is the property
    /// `shutdown`'s drain rests on.
    #[doc(hidden)]
    pub fn pending_count(&self) -> usize {
        self.inner
            .state
            .lock()
            .map(|s| s.pending.len())
            .unwrap_or(0)
    }

    /// Clients currently marked connected. Exposed so a test can observe the
    /// reconnect-vs-stale-disconnect race on `player_id` without reaching into
    /// the roster's display fields.
    #[doc(hidden)]
    pub fn connected_count(&self) -> usize {
        self.inner
            .state
            .lock()
            .map(|s| s.clients.values().filter(|c| c.connected).count())
            .unwrap_or(0)
    }

    pub fn shutdown(&mut self) {
        self.inner.running.store(false, Ordering::SeqCst);
        if let Ok(mut state) = self.inner.state.lock() {
            for stream in state.pending.values_mut() {
                let _ = stream.shutdown(Shutdown::Both);
            }
            for client in state.clients.values_mut() {
                let _ = client.stream.shutdown(Shutdown::Both);
            }
        }
        // Unblock `incoming()`, which is parked in accept().
        let _ = TcpStream::connect(("127.0.0.1", self.local_port));
        if let Some(handle) = self.listener_thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn roster_of(state: &HostState) -> Vec<PeerInfo> {
    let mut peers: Vec<PeerInfo> = state
        .clients
        .iter()
        .map(|(id, c)| PeerInfo {
            player_id: id.clone(),
            name: c.name.clone(),
            connected: c.connected,
        })
        .collect();
    // Stable order so the lobby list does not jitter between updates.
    peers.sort_by(|a, b| a.player_id.cmp(&b.player_id));
    peers
}

/// Number an action, append it to the log, and fan it out to every peer.
fn commit(state: &mut HostState, action: serde_json::Value) -> Sequenced {
    let entry = Sequenced {
        seq: state.next_seq,
        action,
    };
    state.next_seq += 1;
    state.log.push(entry.clone());
    state.outbox.push(entry.clone());
    broadcast(state, &Downstream::Commit(entry.clone()));
    entry
}

fn broadcast(state: &mut HostState, frame: &Downstream) {
    let Ok(payload) = encode(frame) else { return };
    let mut dropped = Vec::new();
    for (id, client) in state.clients.iter_mut() {
        if !client.connected {
            continue;
        }
        let written = if client.ws {
            crate::ws::write_text(&mut client.stream, payload.trim_end())
        } else {
            client.stream.write_all(payload.as_bytes())
        };
        if written.is_err() {
            client.connected = false;
            dropped.push(id.clone());
        }
    }
    // A peer that walked out of Wi-Fi range must not stall the others.
    let _ = dropped;
}

fn send(stream: &mut TcpStream, ws: bool, frame: &Downstream) -> std::io::Result<()> {
    let payload = encode(frame).map_err(std::io::Error::other)?;
    if ws {
        // `encode` appends the newline the JSON transport delimits on; a
        // WebSocket frame carries its own length, so it must not be there.
        crate::ws::write_text(stream, payload.trim_end())
    } else {
        stream.write_all(payload.as_bytes())
    }
}

/// Read the HTTP request head, up to and including the blank line that ends
/// it. Bounded: a real handshake is a few hundred bytes, and an unbounded read
/// here would let one socket grow the host's memory without ever finishing.
fn read_http_head(reader: &mut BufReader<TcpStream>) -> Option<String> {
    let mut head = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let blank = line == "\r\n" || line == "\n";
        head.push_str(&line);
        if blank {
            return Some(head);
        }
        if head.len() > 8192 {
            return None;
        }
    }
}

/// One frame from a peer, whichever protocol it speaks. `None` is end of
/// stream, cleanly or otherwise.
fn read_frame(reader: &mut BufReader<TcpStream>, ws: bool) -> Option<String> {
    if ws {
        return crate::ws::read_text(reader).ok().flatten();
    }
    let mut buf = String::new();
    match reader.read_line(&mut buf) {
        Ok(0) | Err(_) => None,
        Ok(_) => Some(buf),
    }
}

fn serve_client(shared: Arc<Shared>, stream: TcpStream, pending_id: u64) {
    let mut pending = PendingClient {
        shared: Arc::clone(&shared),
        id: Some(pending_id),
    };

    // The accept loop inserts into `pending` and only then spawns this, so a
    // connection that `shutdown`'s drain missed is necessarily one whose
    // thread starts after `running` was cleared — `shutdown` stores it before
    // taking the lock. Checking here is what closes that window: otherwise
    // this thread parks in `read_line` on a socket nobody will ever shut down,
    // and the peer waits out its own timeout instead of being told the host
    // went away. The check sits after the guard so that returning still
    // retires this connection's `pending` entry, which a `Host` kept alive
    // past `shutdown` would otherwise hold forever.
    if !shared.running.load(Ordering::SeqCst) {
        let _ = stream.shutdown(Shutdown::Both);
        return;
    }

    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut write_half = stream;
    let mut reader = BufReader::new(read_half);

    // --- protocol detection ----------------------------------------------
    // Both protocols open with the client speaking, and they cannot be
    // confused on their first byte: a browser sends `GET /...`, a native peer
    // sends a JSON object. Discriminating on one byte rather than four matters
    // because `fill_buf` only guarantees that much — it blocks for the first
    // byte but never waits to accumulate more. The full request line is
    // validated below anyway, by `handshake_response`.
    let ws = match reader.fill_buf() {
        Ok(buffered) => buffered.first() == Some(&b'G'),
        Err(_) => return,
    };
    if ws {
        let Some(request) = read_http_head(&mut reader) else {
            return;
        };
        let Some(response) = crate::ws::handshake_response(&request) else {
            // A `GET` that is not a version 13 upgrade: answer in HTTP, since
            // whatever sent it cannot decode a WebSocket frame.
            let _ = write_half.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
            return;
        };
        if write_half.write_all(response.as_bytes()).is_err() {
            return;
        }
    }

    // --- handshake -------------------------------------------------------
    let Some(line) = read_frame(&mut reader, ws) else {
        return;
    };
    let hello: Upstream = match decode(line.trim()) {
        Ok(frame) => frame,
        Err(_) => {
            let _ = send(
                &mut write_half,
                ws,
                &Downstream::Rejected {
                    reason: "malformed handshake".into(),
                },
            );
            return;
        }
    };
    let Upstream::Hello { player_id, name } = hello else {
        let _ = send(
            &mut write_half,
            ws,
            &Downstream::Rejected {
                reason: "expected hello".into(),
            },
        );
        return;
    };

    let epoch;
    {
        let Ok(mut state) = shared.state.lock() else {
            return;
        };
        let returning = state.clients.contains_key(&player_id);
        // A locked room still readmits someone who dropped mid-match; their
        // seat and their actions are already in the log.
        if !returning && shared.locked.load(Ordering::SeqCst) {
            drop(state);
            let _ = send(
                &mut write_half,
                ws,
                &Downstream::Rejected {
                    reason: "match already started".into(),
                },
            );
            return;
        }
        if !returning && state.clients.len() >= shared.capacity as usize {
            drop(state);
            let _ = send(
                &mut write_half,
                ws,
                &Downstream::Rejected {
                    reason: "room is full".into(),
                },
            );
            return;
        }

        let Ok(stream_for_state) = write_half.try_clone() else {
            return;
        };
        epoch = state.next_epoch;
        state.next_epoch += 1;
        state.clients.insert(
            player_id.clone(),
            Client {
                name: name.clone(),
                stream: stream_for_state,
                connected: true,
                ws,
                epoch,
            },
        );

        // Catch-up: the full ordered log, which folds to the live match.
        let welcome = Downstream::Welcome {
            player_id: player_id.clone(),
            room: shared.room.clone(),
            log: state.log.clone(),
        };
        if send(&mut write_half, ws, &welcome).is_err() {
            // A reconnect racing this same failure could already have
            // replaced the entry; only remove the one this call installed.
            if matches!(state.clients.get(&player_id), Some(c) if c.epoch == epoch) {
                state.clients.remove(&player_id);
            }
            return;
        }
        let roster = Downstream::Roster {
            peers: roster_of(&state),
        };
        broadcast(&mut state, &roster);
    }
    pending.complete();

    // --- frame loop ------------------------------------------------------
    loop {
        let Some(buf) = read_frame(&mut reader, ws) else {
            break;
        };
        let trimmed = buf.trim();
        if trimmed.is_empty() {
            continue;
        }
        match decode::<Upstream>(trimmed) {
            Ok(Upstream::Submit { action }) => {
                let Ok(mut state) = shared.state.lock() else {
                    break;
                };
                commit(&mut state, action);
            }
            Ok(Upstream::Ping) => {
                if send(&mut write_half, ws, &Downstream::Pong).is_err() {
                    break;
                }
            }
            Ok(Upstream::Hello { .. }) => continue,
            // Ignore junk rather than dropping a player for one bad frame.
            Err(_) => continue,
        }
    }

    if let Ok(mut state) = shared.state.lock() {
        if let Some(client) = state.clients.get_mut(&player_id) {
            // A reconnect under the same id has already replaced this entry;
            // marking it disconnected would cut the live socket out of every
            // broadcast while its owner is still playing.
            if client.epoch == epoch {
                client.connected = false;
            }
        }
        let roster = Downstream::Roster {
            peers: roster_of(&state),
        };
        broadcast(&mut state, &roster);
    }
}

struct PendingClient {
    shared: Arc<Shared>,
    id: Option<u64>,
}

impl PendingClient {
    fn complete(&mut self) {
        if let Some(id) = self.id.take() {
            if let Ok(mut state) = self.shared.state.lock() {
                state.pending.remove(&id);
            }
        }
    }
}

impl Drop for PendingClient {
    fn drop(&mut self) {
        self.complete();
    }
}
