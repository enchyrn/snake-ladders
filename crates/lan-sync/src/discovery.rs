use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::protocol::{Beacon, PROTOCOL_VERSION};

/// Discovery port. Fixed so a peer knows where to listen with nothing
/// configured and no internet involved.
pub const DISCOVERY_PORT: u16 = 47654;

const BEACON_INTERVAL: Duration = Duration::from_millis(500);
/// A room that stops beaconing disappears from the list after this long.
const STALE_AFTER: Duration = Duration::from_millis(4000);

/// A host advertising itself on the local network.
pub struct Advertiser {
    running: Arc<AtomicBool>,
    beacon: Arc<Mutex<Beacon>>,
    thread: Option<JoinHandle<()>>,
}

impl Advertiser {
    /// Broadcast to the whole subnet on the standard discovery port.
    pub fn start(beacon: Beacon) -> std::io::Result<Self> {
        Self::start_to(
            beacon,
            SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), DISCOVERY_PORT),
        )
    }

    /// Beacon to a specific address. Useful for tests, and for the case where
    /// a peer types the host's address in by hand because the network blocks
    /// broadcast traffic.
    pub fn start_to(beacon: Beacon, target: SocketAddr) -> std::io::Result<Self> {
        // Bind to an ephemeral port: we only ever send from here.
        let socket = UdpSocket::bind(("0.0.0.0", 0))?;
        socket.set_broadcast(true)?;

        let running = Arc::new(AtomicBool::new(true));
        let shared = Arc::new(Mutex::new(beacon));

        let thread_running = Arc::clone(&running);
        let thread_beacon = Arc::clone(&shared);
        let thread = thread::spawn(move || {
            while thread_running.load(Ordering::SeqCst) {
                let payload = thread_beacon
                    .lock()
                    .ok()
                    .and_then(|b| serde_json::to_vec(&*b).ok());
                if let Some(bytes) = payload {
                    // A failed broadcast is normal while Wi-Fi is switching
                    // networks; keep beaconing rather than giving up.
                    let _ = socket.send_to(&bytes, target);
                }
                thread::sleep(BEACON_INTERVAL);
            }
        });

        Ok(Self {
            running,
            beacon: shared,
            thread: Some(thread),
        })
    }

    /// Update the advertised player count or locked flag in place.
    pub fn update(&self, f: impl FnOnce(&mut Beacon)) {
        if let Ok(mut beacon) = self.beacon.lock() {
            f(&mut beacon);
        }
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for Advertiser {
    fn drop(&mut self) {
        self.stop();
    }
}

/// A room a peer can see right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundRoom {
    pub beacon: Beacon,
    /// Where to connect: the beacon's sender address with the advertised port.
    pub addr: SocketAddr,
}

/// Listens for host beacons and keeps a de-duplicated, self-expiring list.
pub struct Browser {
    running: Arc<AtomicBool>,
    rooms: Arc<Mutex<HashMap<String, (FoundRoom, Instant)>>>,
    thread: Option<JoinHandle<()>>,
}

impl Browser {
    pub fn start() -> std::io::Result<Self> {
        Self::start_on(DISCOVERY_PORT)
    }

    /// Listen on a specific port. Tests use this to avoid colliding with a
    /// real game running on the same machine.
    pub fn start_on(port: u16) -> std::io::Result<Self> {
        let socket = UdpSocket::bind(("0.0.0.0", port))?;
        socket.set_broadcast(true)?;
        // A read timeout is what lets the loop notice `running` going false.
        socket.set_read_timeout(Some(Duration::from_millis(250)))?;

        let running = Arc::new(AtomicBool::new(true));
        let rooms: Arc<Mutex<HashMap<String, (FoundRoom, Instant)>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let thread_running = Arc::clone(&running);
        let thread_rooms = Arc::clone(&rooms);
        let thread = thread::spawn(move || {
            let mut buf = [0u8; 2048];
            while thread_running.load(Ordering::SeqCst) {
                let Ok((len, from)) = socket.recv_from(&mut buf) else {
                    continue;
                };
                let Ok(beacon) = serde_json::from_slice::<Beacon>(&buf[..len]) else {
                    continue;
                };
                if beacon.v != PROTOCOL_VERSION {
                    continue;
                }
                let addr = SocketAddr::new(from.ip(), beacon.port);
                if let Ok(mut rooms) = thread_rooms.lock() {
                    rooms.insert(
                        beacon.room.clone(),
                        (FoundRoom { beacon, addr }, Instant::now()),
                    );
                }
            }
        });

        Ok(Self {
            running,
            rooms,
            thread: Some(thread),
        })
    }

    /// Rooms heard from recently, newest beacon wins, stale entries dropped.
    pub fn rooms(&self) -> Vec<FoundRoom> {
        let Ok(mut rooms) = self.rooms.lock() else {
            return Vec::new();
        };
        rooms.retain(|_, (_, seen)| seen.elapsed() < STALE_AFTER);
        let mut out: Vec<FoundRoom> = rooms.values().map(|(room, _)| room.clone()).collect();
        out.sort_by(|a, b| a.beacon.room.cmp(&b.beacon.room));
        out
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for Browser {
    fn drop(&mut self) {
        self.stop();
    }
}
