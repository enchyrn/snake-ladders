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

/// The room code is the seed, and three implementations derive it: this crate,
/// `src/app/hooks.ts`, and `scripts/lan-relay.mjs`. If they ever disagree, two
/// devices in the same room build different boards and desync on the first
/// roll — so pin the encoding to literals rather than only round-tripping it.
#[test]
fn room_codes_match_the_javascript_implementations() {
    assert_eq!(room_code(0), "2222");
    assert_eq!(room_code(1234), "UA32");
    assert_eq!(room_code(923_520), "ZZZZ");
}
