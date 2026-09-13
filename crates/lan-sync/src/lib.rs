//! Offline local-network multiplayer for a lockstep game.
//!
//! The design in one paragraph: one device hosts and does nothing but *order*
//! actions. Peers submit actions, the host numbers them and fans them back
//! out, and every device — host included — folds that identical numbered log
//! through the same deterministic game engine. No game rules live in this
//! crate, no state is ever serialised over the wire, and no internet, account,
//! or matchmaking server is involved at any point.
//!
//! Discovery is a UDP broadcast beacon on a fixed port, so a room appears on
//! another phone within a second of being opened, over any shared Wi-Fi or a
//! phone hotspot.

pub mod discovery;
pub mod host;
pub mod peer;
pub mod protocol;

pub use discovery::{Advertiser, Browser, FoundRoom, DISCOVERY_PORT};
pub use host::Host;
pub use peer::{Peer, PeerEvent};
pub use protocol::{Beacon, Downstream, PeerInfo, Sequenced, Upstream, PROTOCOL_VERSION};

/// Room codes avoid characters people mistype when reading them off a screen
/// (no 0/O, no 1/I/L).
const ROOM_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/// Derive a short room code from a seed. The code *is* the seed, so two
/// devices in the same room generate the same board without exchanging one.
pub fn room_code(seed: u32) -> String {
    let mut n = seed;
    let mut out = Vec::with_capacity(4);
    for _ in 0..4 {
        out.push(ROOM_ALPHABET[(n % ROOM_ALPHABET.len() as u32) as usize]);
        n /= ROOM_ALPHABET.len() as u32;
    }
    String::from_utf8(out).expect("alphabet is ascii")
}

/// Recover the seed a room code was built from.
pub fn seed_from_room(code: &str) -> Option<u32> {
    let radix = ROOM_ALPHABET.len() as u32;
    let mut seed: u32 = 0;
    for (i, ch) in code.bytes().enumerate().take(4) {
        let digit = ROOM_ALPHABET
            .iter()
            .position(|c| *c == ch.to_ascii_uppercase())? as u32;
        seed = seed.checked_add(digit.checked_mul(radix.pow(i as u32))?)?;
    }
    Some(seed)
}
