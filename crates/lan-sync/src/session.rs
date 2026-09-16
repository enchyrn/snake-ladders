use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::discovery::Advertiser;
use crate::host::Host;
use crate::peer::{Peer, PeerEvent};
use crate::protocol::{Beacon, PeerInfo, Sequenced, PROTOCOL_VERSION};

/// What a session tells its owner about the connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStatus {
    Connected,
    Rejected(String),
    Disconnected,
}

/// Where a session's output goes. The Tauri layer implements this by emitting
/// webview events; tests implement it by pushing onto a vector. Keeping the
/// pump behind a trait is what lets the interesting half of the shell be
/// tested on a machine with no webview toolchain at all.
pub trait SessionSink {
    /// One numbered action. Fold these in order.
    fn commit(&mut self, entry: Sequenced);
    /// Membership changed.
    fn roster(&mut self, peers: Vec<PeerInfo>);
    fn status(&mut self, status: SessionStatus);
}

impl<F> SessionSink for F
where
    F: FnMut(SessionEvent),
{
    fn commit(&mut self, entry: Sequenced) {
        self(SessionEvent::Commit(entry))
    }
    fn roster(&mut self, peers: Vec<PeerInfo>) {
        self(SessionEvent::Roster(peers))
    }
    fn status(&mut self, status: SessionStatus) {
        self(SessionEvent::Status(status))
    }
}

/// The closure-friendly flattening of [`SessionSink`].
#[derive(Debug, Clone, PartialEq)]
pub enum SessionEvent {
    Commit(Sequenced),
    Roster(Vec<PeerInfo>),
    Status(SessionStatus),
}

enum Role {
    Host {
        host: Host,
        advertiser: Option<Advertiser>,
    },
    Peer(Peer),
}

/// One membership of one room, from either side.
pub struct Session {
    role: Role,
    /// Last roster handed to the sink, so an idle room does not emit an
    /// identical list many times a second.
    last_roster: Mutex<Option<Vec<PeerInfo>>>,
}

impl Session {
    /// Open a room and start advertising it. `advertise` is false when the
    /// caller wants a room reachable only by a typed-in address.
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
        let advertiser = if advertise {
            Some(Advertiser::start(Beacon {
                v: PROTOCOL_VERSION,
                room,
                host: display_name.into(),
                port: host.port(),
                players: 1,
                capacity,
                locked: false,
            })?)
        } else {
            None
        };
        Ok(Self {
            role: Role::Host { host, advertiser },
            last_roster: Mutex::new(None),
        })
    }

    pub fn join(
        addr: SocketAddr,
        player_id: impl Into<String>,
        display_name: impl Into<String>,
        timeout: Duration,
    ) -> std::io::Result<Self> {
        Ok(Self {
            role: Role::Peer(Peer::connect(addr, player_id, display_name, timeout)?),
            last_roster: Mutex::new(None),
        })
    }

    pub fn is_host(&self) -> bool {
        matches!(self.role, Role::Host { .. })
    }

    /// The TCP port a hosted room accepts joins on.
    pub fn port(&self) -> Option<u16> {
        match &self.role {
            Role::Host { host, .. } => Some(host.port()),
            Role::Peer(_) => None,
        }
    }

    pub fn room(&self) -> Option<&str> {
        match &self.role {
            Role::Host { host, .. } => Some(host.room()),
            Role::Peer(_) => None,
        }
    }

    /// Stop taking joins. Harmless on a peer.
    pub fn lock(&self) {
        if let Role::Host { host, advertiser } = &self.role {
            host.lock();
            if let Some(advertiser) = advertiser {
                advertiser.update(|b| b.locked = true);
            }
        }
    }

    /// Hand an action over for sequencing. Whether this device is the host or
    /// a peer, the action is only applied once it comes back numbered.
    pub fn submit(&self, action: serde_json::Value) -> std::io::Result<()> {
        match &self.role {
            Role::Host { host, .. } => host
                .submit(action)
                .map(|_| ())
                .ok_or_else(|| std::io::Error::other("host is not accepting actions")),
            Role::Peer(peer) => peer.submit(action),
        }
    }

    /// Drain whatever has arrived and push it at the sink. Call on a timer;
    /// it never blocks.
    pub fn poll(&self, sink: &mut impl SessionSink) {
        match &self.role {
            Role::Host { host, advertiser } => {
                for entry in host.drain() {
                    sink.commit(entry);
                }
                let roster = host.roster();
                if let Some(advertiser) = advertiser {
                    // +1 for the host's own player, who holds no socket.
                    let players = (host.peer_count() + 1).min(u8::MAX as usize) as u8;
                    advertiser.update(|b| b.players = players);
                }
                self.emit_roster(sink, roster);
            }
            Role::Peer(peer) => {
                for event in peer.drain() {
                    match event {
                        PeerEvent::Joined { log, .. } => {
                            // Catch-up first, then report connected, so the UI
                            // never shows a joined-but-empty match.
                            for entry in log {
                                sink.commit(entry);
                            }
                            sink.status(SessionStatus::Connected);
                        }
                        PeerEvent::Committed(entry) => sink.commit(entry),
                        PeerEvent::Roster(peers) => self.emit_roster(sink, peers),
                        PeerEvent::Rejected(reason) => sink.status(SessionStatus::Rejected(reason)),
                        PeerEvent::Disconnected => sink.status(SessionStatus::Disconnected),
                    }
                }
            }
        }
    }

    fn emit_roster(&self, sink: &mut impl SessionSink, peers: Vec<PeerInfo>) {
        let Ok(mut last) = self.last_roster.lock() else {
            return;
        };
        if last.as_ref() == Some(&peers) {
            return;
        }
        *last = Some(peers.clone());
        sink.roster(peers);
    }

    pub fn close(&mut self) {
        match &mut self.role {
            Role::Host { host, advertiser } => {
                if let Some(advertiser) = advertiser {
                    advertiser.stop();
                }
                host.shutdown();
            }
            Role::Peer(peer) => peer.disconnect(),
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

/// Collects session output into a vector. Handy in tests and for a headless
/// replay tool.
#[derive(Default)]
pub struct RecordingSink {
    pub events: Vec<SessionEvent>,
}

impl RecordingSink {
    pub fn commits(&self) -> Vec<Sequenced> {
        self.events
            .iter()
            .filter_map(|e| match e {
                SessionEvent::Commit(entry) => Some(entry.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn statuses(&self) -> Vec<SessionStatus> {
        self.events
            .iter()
            .filter_map(|e| match e {
                SessionEvent::Status(status) => Some(status.clone()),
                _ => None,
            })
            .collect()
    }
}

impl SessionSink for RecordingSink {
    fn commit(&mut self, entry: Sequenced) {
        self.events.push(SessionEvent::Commit(entry));
    }
    fn roster(&mut self, peers: Vec<PeerInfo>) {
        self.events.push(SessionEvent::Roster(peers));
    }
    fn status(&mut self, status: SessionStatus) {
        self.events.push(SessionEvent::Status(status));
    }
}
