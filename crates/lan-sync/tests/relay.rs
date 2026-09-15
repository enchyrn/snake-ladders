use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

use lan_sync::protocol::PROTOCOL_VERSION;
use lan_sync::{room_code, seed_from_room, Advertiser, Beacon, Browser, Host, Peer, PeerEvent};
use serde_json::json;

const TIMEOUT: Duration = Duration::from_secs(5);

fn local(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}

fn join(host: &Host, id: &str) -> Peer {
    Peer::connect(local(host.port()), id, id, TIMEOUT).expect("peer should connect")
}

/// Collect events until `want` commits have arrived, or give up.
fn collect_commits(peer: &Peer, want: usize) -> Vec<(u64, serde_json::Value)> {
    let mut out = Vec::new();
    let deadline = Instant::now() + TIMEOUT;
    while out.len() < want && Instant::now() < deadline {
        match peer.next_event(Duration::from_millis(200)) {
            Some(PeerEvent::Committed(entry)) => out.push((entry.seq, entry.action)),
            Some(PeerEvent::Disconnected) => break,
            _ => continue,
        }
    }
    out
}

fn wait_for_join(peer: &Peer) -> Vec<(u64, serde_json::Value)> {
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline {
        match peer.next_event(Duration::from_millis(200)) {
            Some(PeerEvent::Joined { log, .. }) => {
                return log.into_iter().map(|e| (e.seq, e.action)).collect()
            }
            Some(PeerEvent::Rejected(reason)) => panic!("join rejected: {reason}"),
            Some(PeerEvent::Disconnected) => panic!("disconnected during handshake"),
            _ => continue,
        }
    }
    panic!("never received a welcome")
}

#[test]
fn every_peer_sees_the_same_ordered_log() {
    let host = Host::bind("TEST", 0, 4).expect("host should bind");
    let alice = join(&host, "alice");
    let bob = join(&host, "bob");
    wait_for_join(&alice);
    wait_for_join(&bob);

    alice
        .submit(json!({"_tag": "Commit", "playerId": "alice"}))
        .unwrap();
    bob.submit(json!({"_tag": "Commit", "playerId": "bob"}))
        .unwrap();
    host.submit(json!({"_tag": "Start"})).unwrap();

    let from_alice = collect_commits(&alice, 3);
    let from_bob = collect_commits(&bob, 3);

    assert_eq!(from_alice.len(), 3, "alice should see three commits");
    // The whole design rests on this: identical order, identical content.
    assert_eq!(from_alice, from_bob);
    assert_eq!(
        from_alice.iter().map(|(seq, _)| *seq).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
}

#[test]
fn sequence_numbers_are_dense_and_gapless_under_load() {
    let host = Host::bind("LOAD", 0, 4).expect("host should bind");
    let alice = join(&host, "alice");
    let bob = join(&host, "bob");
    wait_for_join(&alice);
    wait_for_join(&bob);

    for i in 0..25 {
        alice.submit(json!({"n": i, "from": "alice"})).unwrap();
        bob.submit(json!({"n": i, "from": "bob"})).unwrap();
    }

    let seen = collect_commits(&alice, 50);
    assert_eq!(seen.len(), 50);
    let seqs: Vec<u64> = seen.iter().map(|(seq, _)| *seq).collect();
    assert_eq!(seqs, (0..50).collect::<Vec<u64>>());
    assert_eq!(collect_commits(&bob, 50), seen);
}

#[test]
fn a_late_joiner_catches_up_from_the_log() {
    let host = Host::bind("LATE", 0, 4).expect("host should bind");
    let alice = join(&host, "alice");
    wait_for_join(&alice);

    for i in 0..5 {
        alice.submit(json!({"n": i})).unwrap();
    }
    collect_commits(&alice, 5);

    // Bob arrives mid-match and must receive everything he missed.
    let bob = join(&host, "bob");
    let catch_up = wait_for_join(&bob);
    assert_eq!(catch_up.len(), 5);
    assert_eq!(
        catch_up.iter().map(|(seq, _)| *seq).collect::<Vec<_>>(),
        vec![0, 1, 2, 3, 4]
    );

    // And keeps receiving from where the log left off.
    alice.submit(json!({"n": 99})).unwrap();
    let next = collect_commits(&bob, 1);
    assert_eq!(next[0].0, 5);
}

#[test]
fn a_locked_room_refuses_newcomers_but_readmits_a_dropout() {
    let host = Host::bind("LOCK", 0, 4).expect("host should bind");
    let mut alice = join(&host, "alice");
    wait_for_join(&alice);
    host.lock();

    let stranger = join(&host, "stranger");
    assert!(
        matches!(
            stranger.next_event(TIMEOUT),
            Some(PeerEvent::Rejected(_)) | Some(PeerEvent::Disconnected)
        ),
        "a locked room should turn away someone who was never in it"
    );

    // Alice's phone drops off Wi-Fi and comes back; her seat is still hers.
    alice.disconnect();
    drop(alice);
    let alice_again = join(&host, "alice");
    wait_for_join(&alice_again);
}

#[test]
fn a_full_room_turns_away_the_next_player() {
    let host = Host::bind("FULL", 0, 2).expect("host should bind");
    let a = join(&host, "a");
    let b = join(&host, "b");
    wait_for_join(&a);
    wait_for_join(&b);

    let c = join(&host, "c");
    assert!(matches!(
        c.next_event(TIMEOUT),
        Some(PeerEvent::Rejected(_)) | Some(PeerEvent::Disconnected)
    ));
}

#[test]
fn a_dropped_peer_does_not_stall_the_others() {
    let host = Host::bind("DROP", 0, 4).expect("host should bind");
    let alice = join(&host, "alice");
    let mut bob = join(&host, "bob");
    wait_for_join(&alice);
    wait_for_join(&bob);

    bob.disconnect();
    drop(bob);

    // The room keeps running for whoever is still connected.
    for i in 0..5 {
        alice.submit(json!({"n": i})).unwrap();
    }
    assert_eq!(collect_commits(&alice, 5).len(), 5);
}

#[test]
fn the_host_sees_its_own_actions_in_the_same_order() {
    let host = Host::bind("SELF", 0, 4).expect("host should bind");
    let alice = join(&host, "alice");
    wait_for_join(&alice);

    host.submit(json!({"who": "host", "n": 0})).unwrap();
    alice.submit(json!({"who": "alice", "n": 1})).unwrap();
    let from_alice = collect_commits(&alice, 2);

    let from_host = host.drain();
    assert_eq!(from_host.len(), 2);
    let host_view: Vec<(u64, serde_json::Value)> =
        from_host.into_iter().map(|e| (e.seq, e.action)).collect();
    assert_eq!(host_view, from_alice);
}

#[test]
fn junk_frames_are_ignored_rather_than_dropping_the_player() {
    use std::io::Write;
    use std::net::TcpStream;

    let host = Host::bind("JUNK", 0, 4).expect("host should bind");
    let alice = join(&host, "alice");
    wait_for_join(&alice);

    // Something on the network writes nonsense at the host.
    let mut raw = TcpStream::connect(local(host.port())).unwrap();
    raw.write_all(b"this is not json\n").unwrap();

    // Alice is unaffected.
    alice.submit(json!({"n": 1})).unwrap();
    assert_eq!(collect_commits(&alice, 1).len(), 1);
}

#[test]
fn a_room_appears_to_a_browser_within_a_second() {
    // Loopback rather than the subnet broadcast address, so the test does not
    // depend on the sandbox permitting broadcast traffic.
    let port = 47_700;
    let browser = Browser::start_on(port).expect("browser should bind");
    let beacon = Beacon {
        v: PROTOCOL_VERSION,
        room: "WXYZ".into(),
        host: "Ana".into(),
        port: 1234,
        players: 2,
        capacity: 4,
        locked: false,
    };
    let _advertiser = Advertiser::start_to(beacon.clone(), local(port)).expect("advertiser");

    let deadline = Instant::now() + TIMEOUT;
    let mut found = Vec::new();
    while Instant::now() < deadline && found.is_empty() {
        std::thread::sleep(Duration::from_millis(100));
        found = browser.rooms();
    }
    assert_eq!(found.len(), 1, "the room should turn up in the browser");
    assert_eq!(found[0].beacon, beacon);
    // The connect address comes from the sender, not from the beacon body.
    assert_eq!(found[0].addr.port(), 1234);
}

#[test]
fn beacons_from_another_protocol_version_are_ignored() {
    let port = 47_701;
    let browser = Browser::start_on(port).expect("browser should bind");
    let beacon = Beacon {
        v: PROTOCOL_VERSION + 99,
        room: "OLD1".into(),
        host: "Ancient".into(),
        port: 1234,
        players: 1,
        capacity: 4,
        locked: false,
    };
    let _advertiser = Advertiser::start_to(beacon, local(port)).expect("advertiser");
    std::thread::sleep(Duration::from_millis(1200));
    assert!(browser.rooms().is_empty());
}

#[test]
fn room_codes_round_trip_to_their_seed() {
    for seed in [0u32, 1, 42, 9_999, 923_520] {
        let code = room_code(seed);
        assert_eq!(code.len(), 4);
        assert_eq!(seed_from_room(&code), Some(seed));
    }
    // Typed in lower case, a code still resolves.
    assert_eq!(seed_from_room(&room_code(1234).to_lowercase()), Some(1234));
    assert_eq!(seed_from_room("!!!!"), None);
}

#[test]
fn seed_from_room_refuses_anything_that_is_not_exactly_four_valid_characters() {
    // The room code IS the seed, so `.take(4)` over a short code silently
    // built a valid-but-wrong seed instead of refusing it, and a long one had
    // its extra characters ignored rather than rejected.
    assert_eq!(seed_from_room("ABC"), None);
    assert_eq!(seed_from_room("ABCDE"), None);
    assert_eq!(seed_from_room(""), None);
    assert_eq!(seed_from_room("AB1D"), None); // 1 is not in the alphabet
}

/// The room code is the seed, and three implementations derive it: this crate,
/// `packages/app-shell/src/app/hooks.ts`, and `apps/relay/lan-relay.mjs`. If
/// they ever disagree, two devices in the same room build different boards and
/// desync on the first roll — so pin the encoding to literals rather than only
/// round-tripping it.
#[test]
fn room_codes_match_the_javascript_implementations() {
    assert_eq!(room_code(0), "2222");
    assert_eq!(room_code(1234), "UA32");
    assert_eq!(room_code(923_520), "ZZZZ");
}

// --- a browser joining a natively hosted room -------------------------------

/// Frame a text payload the way a browser does: FIN + text, always masked.
fn client_frame(text: &str) -> Vec<u8> {
    let mask = [0x21u8, 0x09, 0x7f, 0x3c];
    let payload = text.as_bytes();
    let mut frame = vec![0x81];
    if payload.len() < 126 {
        frame.push(0x80 | payload.len() as u8);
    } else {
        frame.push(0x80 | 126);
        frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    }
    frame.extend_from_slice(&mask);
    for (i, byte) in payload.iter().enumerate() {
        frame.push(byte ^ mask[i % 4]);
    }
    frame
}

/// Read one unmasked server text frame. Only the forms the host actually
/// writes: the test is checking the host, not re-testing the codec.
fn server_frame(stream: &mut std::net::TcpStream) -> String {
    use std::io::Read;
    let mut head = [0u8; 2];
    stream.read_exact(&mut head).expect("frame header");
    assert_eq!(head[0], 0x81, "expected a final text frame");
    let length = match head[1] & 0x7f {
        126 => {
            let mut ext = [0u8; 2];
            stream.read_exact(&mut ext).expect("extended length");
            u16::from_be_bytes(ext) as usize
        }
        127 => panic!("unexpectedly large frame"),
        short => short as usize,
    };
    let mut payload = vec![0u8; length];
    stream.read_exact(&mut payload).expect("payload");
    String::from_utf8(payload).expect("utf-8")
}

#[test]
fn a_browser_handshake_is_upgraded_and_welcomed() {
    use std::io::{Read, Write};

    let host = Host::bind("WSROOM", 0, 4).expect("host should bind");
    let mut stream = std::net::TcpStream::connect(local(host.port())).expect("connect");
    stream.set_read_timeout(Some(TIMEOUT)).unwrap();

    let request = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nUpgrade: websocket\r\n\
         Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n",
        host.port()
    );
    stream.write_all(request.as_bytes()).expect("write request");

    // The response head ends at the blank line; read exactly that far so the
    // first WebSocket frame is left in the socket for `server_frame`.
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).expect("response head");
        head.push(byte[0]);
    }
    let head = String::from_utf8(head).expect("utf-8 head");
    assert!(head.starts_with("HTTP/1.1 101 "), "got: {head}");
    assert!(
        head.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="),
        "got: {head}"
    );

    stream
        .write_all(&client_frame(
            r#"{"t":"hello","player_id":"web","name":"Web"}"#,
        ))
        .expect("write hello");

    let welcome = server_frame(&mut stream);
    assert!(welcome.contains(r#""t":"welcome""#), "got: {welcome}");
    assert!(welcome.contains(r#""room":"WSROOM""#), "got: {welcome}");
}

#[test]
fn a_browser_and_a_native_peer_share_one_ordered_log() {
    use std::io::{Read, Write};

    let host = Host::bind("MIXED", 0, 4).expect("host should bind");
    let native = join(&host, "native");
    wait_for_join(&native);

    let mut stream = std::net::TcpStream::connect(local(host.port())).expect("connect");
    stream.set_read_timeout(Some(TIMEOUT)).unwrap();
    let request = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nUpgrade: websocket\r\n\
         Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n",
        host.port()
    );
    stream.write_all(request.as_bytes()).expect("write request");
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).expect("response head");
        head.push(byte[0]);
    }
    stream
        .write_all(&client_frame(
            r#"{"t":"hello","player_id":"web","name":"Web"}"#,
        ))
        .expect("write hello");
    let welcome = server_frame(&mut stream);
    assert!(welcome.contains(r#""t":"welcome""#), "got: {welcome}");

    // The browser submits; the native peer must see it, numbered, like any
    // other action. Neither can tell the other is on a different transport.
    stream
        .write_all(&client_frame(
            r#"{"t":"submit","action":{"_tag":"Commit","playerId":"web"}}"#,
        ))
        .expect("write submit");

    let commits = collect_commits(&native, 1);
    assert_eq!(
        commits.len(),
        1,
        "native peer never saw the browser's action"
    );
    assert_eq!(commits[0].0, 0);
    assert_eq!(commits[0].1, json!({"_tag": "Commit", "playerId": "web"}));
}
