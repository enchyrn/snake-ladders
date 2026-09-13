use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use lan_sync::{room_code, RecordingSink, Sequenced, Session, SessionStatus};
use serde_json::json;

const TIMEOUT: Duration = Duration::from_secs(5);

fn local(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}

/// Poll a session until it has produced `want` commits, or time out.
fn pump_until(session: &Session, sink: &mut RecordingSink, want: usize) -> Vec<Sequenced> {
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline && sink.commits().len() < want {
        session.poll(sink);
        std::thread::sleep(Duration::from_millis(20));
    }
    sink.commits()
}

#[test]
fn a_host_and_a_peer_fold_the_same_numbered_log() {
    // `false`: skip the broadcast beacon so the test does not depend on the
    // sandbox allowing subnet broadcast.
    let host = Session::host(1234, "Ana", 4, false).expect("host should open");
    let port = host.port().expect("a host has a port");

    let peer = Session::join(local(port), "bo", "Bo", TIMEOUT).expect("peer should join");
    let mut peer_sink = RecordingSink::default();
    pump_until(&peer, &mut peer_sink, 0);

    host.submit(json!({"_tag": "Join", "playerId": "ana"}))
        .unwrap();
    peer.submit(json!({"_tag": "Join", "playerId": "bo"}))
        .unwrap();
    host.submit(json!({"_tag": "Start"})).unwrap();

    let mut host_sink = RecordingSink::default();
    let host_log = pump_until(&host, &mut host_sink, 3);
    let peer_log = pump_until(&peer, &mut peer_sink, 3);

    assert_eq!(host_log.len(), 3);
    assert_eq!(host_log, peer_log, "both sides must fold the same log");
    assert_eq!(
        host_log.iter().map(|e| e.seq).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
}

#[test]
fn a_peer_reports_connected_only_after_its_catch_up_arrives() {
    let host = Session::host(7, "Ana", 4, false).expect("host should open");
    let port = host.port().unwrap();

    host.submit(json!({"n": 0})).unwrap();
    host.submit(json!({"n": 1})).unwrap();

    let peer = Session::join(local(port), "bo", "Bo", TIMEOUT).expect("peer should join");
    let mut sink = RecordingSink::default();
    pump_until(&peer, &mut sink, 2);

    assert_eq!(sink.commits().len(), 2, "the history should arrive first");
    assert_eq!(sink.statuses(), vec![SessionStatus::Connected]);

    // Ordering matters: a UI that sees Connected before the log would render
    // an empty board for a match already in progress.
    let first_status = sink
        .events
        .iter()
        .position(|e| matches!(e, lan_sync::SessionEvent::Status(_)))
        .unwrap();
    assert_eq!(first_status, 2);
}

#[test]
fn a_locked_room_reports_a_rejection_to_the_peer() {
    let host = Session::host(8, "Ana", 4, false).expect("host should open");
    let port = host.port().unwrap();
    host.lock();

    let peer = Session::join(local(port), "late", "Late", TIMEOUT).expect("connect succeeds");
    let mut sink = RecordingSink::default();
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline && sink.statuses().is_empty() {
        peer.poll(&mut sink);
        std::thread::sleep(Duration::from_millis(20));
    }

    assert!(
        matches!(
            sink.statuses().first(),
            Some(SessionStatus::Rejected(_)) | Some(SessionStatus::Disconnected)
        ),
        "expected a refusal, got {:?}",
        sink.statuses()
    );
}

#[test]
fn a_peer_notices_the_host_going_away() {
    let mut host = Session::host(9, "Ana", 4, false).expect("host should open");
    let port = host.port().unwrap();
    let peer = Session::join(local(port), "bo", "Bo", TIMEOUT).expect("peer should join");
    let mut sink = RecordingSink::default();
    pump_until(&peer, &mut sink, 0);

    host.close();
    drop(host);

    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline && !sink.statuses().contains(&SessionStatus::Disconnected) {
        peer.poll(&mut sink);
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(sink.statuses().contains(&SessionStatus::Disconnected));
}

#[test]
fn host_shutdown_closes_a_peer_still_in_handshake() {
    let mut host = lan_sync::Host::bind("room", 0, 4).expect("host should open");
    let mut peer = TcpStream::connect(local(host.port())).expect("peer should connect");
    peer.write_all(b"{").expect("partial hello should be sent");

    std::thread::sleep(Duration::from_millis(100));
    host.shutdown();

    peer.set_read_timeout(Some(Duration::from_millis(250)))
        .expect("read timeout should be set");
    let mut byte = [0; 1];
    let read = peer.read(&mut byte).expect("shutdown should unblock peer");
    assert_eq!(read, 0, "shutdown must close an unregistered socket");
}

#[test]
fn an_idle_room_does_not_repeat_the_same_roster() {
    let host = Session::host(10, "Ana", 4, false).expect("host should open");
    let port = host.port().unwrap();
    let _peer = Session::join(local(port), "bo", "Bo", TIMEOUT).expect("peer should join");

    let mut sink = RecordingSink::default();
    for _ in 0..40 {
        host.poll(&mut sink);
        std::thread::sleep(Duration::from_millis(10));
    }

    let rosters = sink
        .events
        .iter()
        .filter(|e| matches!(e, lan_sync::SessionEvent::Roster(_)))
        .count();
    // Bo joining is one change; forty polls must not be forty events.
    assert!(rosters <= 2, "roster emitted {rosters} times while idle");
}

#[test]
fn a_hosted_room_reports_the_code_its_seed_encodes() {
    let host = Session::host(4242, "Ana", 4, false).expect("host should open");
    assert_eq!(host.room(), Some(room_code(4242).as_str()));
    assert!(host.is_host());
    assert!(host.port().is_some());
}

/// Tauri stores a session in managed state, and `State<T>` requires
/// `T: Send + Sync + 'static`. Nothing in this crate needs that on its own, so
/// without this assertion the constraint is only discovered by an Android
/// cross-compile in CI — which is a slow and confusing place to learn it.
/// These are compile-time checks; that they build at all is the test.
#[test]
fn session_types_satisfy_tauri_managed_state_bounds() {
    fn assert_send_sync<T: Send + Sync + 'static>() {}

    assert_send_sync::<Session>();
    assert_send_sync::<lan_sync::Host>();
    assert_send_sync::<lan_sync::Peer>();
    assert_send_sync::<lan_sync::Browser>();
    assert_send_sync::<lan_sync::Advertiser>();
    assert_send_sync::<std::sync::Arc<Session>>();
}
