use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::protocol::{decode, encode, Downstream, PeerInfo, Sequenced, Upstream};

/// What a joined peer learns from the host.
#[derive(Debug, Clone, PartialEq)]
pub enum PeerEvent {
    /// Handshake accepted. `log` is the catch-up history to fold first.
    Joined {
        room: String,
        log: Vec<Sequenced>,
    },
    /// One numbered action. Fold these in `seq` order.
    Committed(Sequenced),
    Roster(Vec<PeerInfo>),
    Rejected(String),
    Disconnected,
}

/// A peer's connection to the host. Reading happens on a background thread and
/// surfaces as `PeerEvent`s; nothing here interprets game rules.
pub struct Peer {
    stream: Mutex<TcpStream>,
    running: Arc<AtomicBool>,
    events: Receiver<PeerEvent>,
    reader_thread: Option<JoinHandle<()>>,
}

impl Peer {
    pub fn connect(
        addr: SocketAddr,
        player_id: impl Into<String>,
        name: impl Into<String>,
        timeout: Duration,
    ) -> std::io::Result<Self> {
        let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
        // Dice results matter more than batching; a half-second stall in a
        // turn-based game reads as a dropped connection.
        stream.set_nodelay(true)?;

        let hello = Upstream::Hello {
            player_id: player_id.into(),
            name: name.into(),
        };
        stream.write_all(encode(&hello).map_err(std::io::Error::other)?.as_bytes())?;

        let (tx, events) = mpsc::channel();
        let running = Arc::new(AtomicBool::new(true));
        let read_half = stream.try_clone()?;
        let reader_running = Arc::clone(&running);

        let reader_thread = thread::spawn(move || {
            pump(read_half, tx, reader_running);
        });

        Ok(Self {
            stream: Mutex::new(stream),
            running,
            events,
            reader_thread: Some(reader_thread),
        })
    }

    /// Hand an action to the host for sequencing. It comes back through
    /// `PeerEvent::Committed` like everyone else's — a peer never applies its
    /// own action early, which is what keeps the fold order identical.
    pub fn submit(&self, action: serde_json::Value) -> std::io::Result<()> {
        let frame = encode(&Upstream::Submit { action }).map_err(std::io::Error::other)?;
        let mut stream = self
            .stream
            .lock()
            .map_err(|_| std::io::Error::other("peer stream poisoned"))?;
        stream.write_all(frame.as_bytes())
    }

    pub fn ping(&self) -> std::io::Result<()> {
        let frame = encode(&Upstream::Ping).map_err(std::io::Error::other)?;
        let mut stream = self
            .stream
            .lock()
            .map_err(|_| std::io::Error::other("peer stream poisoned"))?;
        stream.write_all(frame.as_bytes())
    }

    /// Non-blocking: everything received since the last call.
    pub fn drain(&self) -> Vec<PeerEvent> {
        self.events.try_iter().collect()
    }

    /// Blocks until the next event or the timeout elapses.
    pub fn next_event(&self, timeout: Duration) -> Option<PeerEvent> {
        self.events.recv_timeout(timeout).ok()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn disconnect(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Ok(stream) = self.stream.lock() {
            let _ = stream.shutdown(Shutdown::Both);
        }
        if let Some(handle) = self.reader_thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.disconnect();
    }
}

fn pump(stream: TcpStream, tx: Sender<PeerEvent>, running: Arc<AtomicBool>) {
    let mut reader = BufReader::new(stream);
    loop {
        if !running.load(Ordering::SeqCst) {
            break;
        }
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let event = match decode::<Downstream>(trimmed) {
            Ok(Downstream::Welcome { room, log, .. }) => PeerEvent::Joined { room, log },
            Ok(Downstream::Commit(entry)) => PeerEvent::Committed(entry),
            Ok(Downstream::Roster { peers }) => PeerEvent::Roster(peers),
            Ok(Downstream::Rejected { reason }) => PeerEvent::Rejected(reason),
            Ok(Downstream::Pong) => continue,
            Err(_) => continue,
        };
        let rejected = matches!(event, PeerEvent::Rejected(_));
        if tx.send(event).is_err() || rejected {
            break;
        }
    }
    running.store(false, Ordering::SeqCst);
    let _ = tx.send(PeerEvent::Disconnected);
}
