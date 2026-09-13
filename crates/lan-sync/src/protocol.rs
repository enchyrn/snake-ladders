use serde::{Deserialize, Serialize};

/// UDP beacon a host broadcasts so peers on the same Wi-Fi can find it without
/// any internet, DNS, or pairing step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Beacon {
    /// Protocol version. Peers ignore beacons they cannot speak.
    pub v: u32,
    /// Short human-facing room code, also the match seed.
    pub room: String,
    /// Host player's display name.
    pub host: String,
    /// TCP port the host is accepting joins on.
    pub port: u16,
    pub players: u8,
    pub capacity: u8,
    /// True once the match has started and no longer takes joins.
    pub locked: bool,
}

pub const PROTOCOL_VERSION: u32 = 1;

/// Frames sent peer -> host.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Upstream {
    /// First frame on every connection.
    Hello { player_id: String, name: String },
    /// A game action awaiting a sequence number.
    Submit { action: serde_json::Value },
    /// Liveness probe; the host answers with `Downstream::Pong`.
    Ping,
}

/// Frames sent host -> peer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Downstream {
    /// Accepted. Carries the whole log so a late joiner can catch up by
    /// folding it, exactly as the peers already in the room did.
    Welcome {
        player_id: String,
        room: String,
        log: Vec<Sequenced>,
    },
    /// One action, numbered. Order here *is* the shared truth: peers derive
    /// identical state by folding these in sequence.
    Commit(Sequenced),
    /// Current membership, for the lobby view.
    Roster {
        peers: Vec<PeerInfo>,
    },
    /// The join was refused; the connection closes straight after.
    Rejected {
        reason: String,
    },
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Sequenced {
    pub seq: u64,
    /// Opaque to Rust on purpose: the rules live in the TypeScript engine, so
    /// there is exactly one implementation of them to keep correct.
    pub action: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerInfo {
    pub player_id: String,
    pub name: String,
    pub connected: bool,
}

/// Decode one newline-delimited JSON frame.
pub fn decode<T: for<'de> Deserialize<'de>>(line: &str) -> Result<T, serde_json::Error> {
    serde_json::from_str(line)
}

/// Encode one frame, newline included. Frames never contain a raw newline
/// because `serde_json` escapes them inside strings.
pub fn encode<T: Serialize>(frame: &T) -> Result<String, serde_json::Error> {
    let mut s = serde_json::to_string(frame)?;
    s.push('\n');
    Ok(s)
}
