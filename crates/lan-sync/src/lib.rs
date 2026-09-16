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

pub mod assets;
pub mod discovery;
pub mod host;
pub mod peer;
pub mod protocol;
pub mod session;
pub mod ws;

pub use discovery::{Advertiser, Browser, FoundRoom, DISCOVERY_PORT};
pub use host::Host;
pub use peer::{Peer, PeerEvent};
pub use protocol::{Beacon, Downstream, PeerInfo, Sequenced, Upstream, PROTOCOL_VERSION};
pub use session::{RecordingSink, Session, SessionEvent, SessionSink, SessionStatus};

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
    // The code is the seed, so a short one is not a partial match — it is a
    // different board, built silently and with every frame still decoding.
    if code.len() != 4 {
        return None;
    }
    let radix = ROOM_ALPHABET.len() as u32;
    let mut seed: u32 = 0;
    for (i, ch) in code.bytes().enumerate() {
        let digit = ROOM_ALPHABET
            .iter()
            .position(|c| *c == ch.to_ascii_uppercase())? as u32;
        seed = seed.checked_add(digit.checked_mul(radix.pow(i as u32))?)?;
    }
    Some(seed)
}

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
    // TEST-NET-1, a documentation range no real service answers on. No packet
    // is sent either way — connecting a UDP socket only fixes a route — which
    // is what makes this safe even where the range *is* routed: this very
    // container sits on 192.0.2.0/24, and the answer was still its own address.
    socket.connect(("192.0.2.1", 9)).ok()?;
    let addr = socket.local_addr().ok()?.ip();
    match addr {
        IpAddr::V4(v4) if v4.is_loopback() || v4.is_unspecified() => None,
        _ => Some(addr),
    }
}

#[cfg(test)]
mod local_address_tests {
    use super::*;

    #[test]
    fn reports_a_usable_non_loopback_address() {
        // A container with only loopback legitimately has none, so this asserts
        // the shape of an answer rather than that one exists.
        if let Some(addr) = local_address() {
            assert!(
                !addr.is_unspecified(),
                "0.0.0.0 is not an address to hand out"
            );
            assert!(
                !addr.is_loopback(),
                "loopback is unreachable from another device"
            );
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
