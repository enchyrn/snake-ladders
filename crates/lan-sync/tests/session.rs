use std::io::{BufRead, BufReader, Read, Write};
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

/// Poll a predicate until it holds, or time out. Accept runs on the listener
/// thread, so a count settles shortly after `connect` returns rather than with
/// it; sleeping a fixed amount instead would be either flaky or slow.
fn wait_for(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline && !predicate() {
        std::thread::sleep(Duration::from_millis(5));
    }
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

/// A connection accepted in the window between `shutdown` storing `running`
/// and draining `pending` is not in that map, so the drain cannot reach it.
/// Hammering the accept path at the shutdown instant makes the window
/// reachable; every peer must still see the socket close rather than block
/// until its own read timeout.
///
/// Read a pass here as weak evidence, and a green `cargo test` as almost none.
/// Each shutdown gets exactly one chance at the window — the single
/// accept-loop iteration straddling the store — so sockets per round are not a
/// lever and rounds are. Measured against the unfixed host, the forty rounds
/// below fail 98 runs in 500, about one in five; at one round it was 5 in
/// 2000, which is why the round count is deliberately high. What detects a
/// regression is looping the built binary, where forty runs at this power miss
/// it about once in six thousand:
///
/// ```text
/// BIN=$(cargo test -p lan-sync --test session --no-run --message-format=json \
///   | sed -n 's/.*"executable":"\([^"]*\)".*/\1/p' | tail -1)
/// fails=0; for _ in $(seq 1 40); do "$BIN" \
///   host_shutdown_closes_a_socket_accepted_during_the_drain --exact \
///   >/dev/null 2>&1 || fails=$((fails+1)); done; echo "$fails / 40"
/// ```
#[test]
fn host_shutdown_closes_a_socket_accepted_during_the_drain() {
    let mut wedged = 0;
    // Rounds, not sockets, are what press on the window; each is a few
    // milliseconds, so the whole test still costs well under a second.
    for _ in 0..40 {
        let mut host = lan_sync::Host::bind("RACE", 0, 6).expect("bind");
        let port = host.port();

        let mut peers = Vec::new();
        for _ in 0..64 {
            if let Ok(stream) = TcpStream::connect(local(port)) {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .expect("timeout");
                peers.push(stream);
            }
        }

        host.shutdown();

        for mut peer in peers {
            let mut buf = [0u8; 1];
            match peer.read(&mut buf) {
                Ok(0) => {} // clean EOF: the host closed it
                Ok(_) => {} // sent something, then closed
                Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => {}
                Err(_) => wedged += 1, // WouldBlock: never closed at all
            }
        }
    }

    assert_eq!(wedged, 0, "{wedged} sockets were never closed by shutdown");
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

/// `shutdown` can only close what `pending` holds, so every accepted socket has
/// to be in there before its thread is spawned, and has to leave once its
/// handshake completes.
///
/// This is a guard, not a reproduction. The hole it protects against was
/// structural: registration used to be conditional on `peer_addr()` and
/// `try_clone()`, and a failure of either served the connection with nothing in
/// the map. Neither can be forced to fail from a test without a new dependency
/// or an rlimit stunt on the whole process, so this passes against the unfixed
/// host too. What it catches is the conditional shape being reintroduced.
#[test]
fn every_accepted_socket_is_tracked_until_its_handshake_completes() {
    let host = lan_sync::Host::bind("TRACK", 0, 4).expect("host should open");
    let port = host.port();

    // Connect and say nothing: accepted, spawned, and parked in `read_line`.
    let silent: Vec<TcpStream> = (0..3)
        .map(|_| TcpStream::connect(local(port)).expect("peer should connect"))
        .collect();
    wait_for(|| host.pending_count() == 3);
    assert_eq!(
        host.pending_count(),
        3,
        "every accepted socket must be tracked before its thread is spawned"
    );

    // Now one that does handshake. Wait for it to be tracked *before* sending
    // hello: connect-then-immediately-hello would race registration against
    // retirement, and a count that read 3 throughout would prove nothing —
    // it cannot tell "not accepted yet" from "accepted and retired".
    let mut joiner = TcpStream::connect(local(port)).expect("peer should connect");
    wait_for(|| host.pending_count() == 4);
    assert_eq!(
        host.pending_count(),
        4,
        "a connection must be tracked before its handshake, not after"
    );

    // A completed handshake retires its own entry. Without that the map grows
    // for the life of the room and `shutdown` works through sockets long gone.
    let hello = json!({"t": "hello", "player_id": "bo", "name": "Bo"});
    writeln!(joiner, "{hello}").expect("hello should be sent");
    wait_for(|| host.pending_count() == 3);
    assert_eq!(
        host.pending_count(),
        3,
        "a peer through its handshake must not stay pending"
    );

    drop(silent);
}

/// Connect, complete the handshake, and drain the two frames a freshly
/// registered client always gets (`welcome` then `roster`). The host only
/// sends `welcome` once the map entry is installed, so a caller that has read
/// it back knows registration already happened — ordering established
/// through the socket rather than through a sleep.
fn connect_and_register(
    port: u16,
    player_id: &str,
    name: &str,
) -> (TcpStream, BufReader<TcpStream>) {
    let mut stream = TcpStream::connect(local(port)).expect("peer should connect");
    stream
        .set_read_timeout(Some(TIMEOUT))
        .expect("read timeout should be set");
    let hello = json!({"t": "hello", "player_id": player_id, "name": name});
    writeln!(stream, "{hello}").expect("hello should be sent");

    let mut reader = BufReader::new(stream.try_clone().expect("stream should clone"));
    let mut welcome = String::new();
    reader.read_line(&mut welcome).expect("welcome frame");
    assert!(
        welcome.contains("welcome"),
        "expected a welcome frame, got {welcome:?}"
    );
    let mut roster = String::new();
    reader.read_line(&mut roster).expect("roster frame");
    assert!(
        roster.contains("roster"),
        "expected a roster frame, got {roster:?}"
    );
    (stream, reader)
}

/// Reproduces the hazard fixed by `Client::epoch`: `player_id` is supplied by
/// the client and reused on purpose so a dropped player can reclaim their
/// seat, but the map is keyed on it too — so the old connection's own thread,
/// noticing its socket died only after the reconnect has already replaced its
/// entry, must not touch what it no longer owns.
///
/// The ordering is made explicit rather than raced: `connect_and_register`
/// only returns once it has read the `welcome` frame back, and the host does
/// not send `welcome` until the registration lock is held and the insert has
/// already happened. So by the time `second` is registered, `first`'s entry
/// is already gone from the map. What is left to `drop(first)`'s death being
/// noticed asynchronously is handled by blocking on the next frame `second`
/// receives, rather than by polling a count that would read the same either
/// way before that notice lands — see the comment at that read.
#[test]
fn a_reconnect_survives_the_old_connection_noticing_it_died() {
    let host = lan_sync::Host::bind("ROOM", 0, 6).expect("bind");
    let port = host.port();

    let first = connect_and_register(port, "p1", "Ada");
    let (mut second, mut second_reader) = connect_and_register(port, "p1", "Ada");

    // Let the first connection die. Its thread wakes, finds the socket gone,
    // and must not touch the entry `second` installed under the same id.
    // Both halves of the pair have to go: `connect_and_register` hands back a
    // clone of the socket for reading, and that clone alone keeps the file
    // description open, so the host-side read would never see the close.
    drop(first);

    // Don't poll `connected_count()` here: right after `drop(first)` it still
    // reads 1 whether or not the bug exists, because the old connection's
    // thread has not yet noticed the socket died — polling would just catch
    // the *pre*-mutation state and pass either way. Block on the roster frame
    // that exit path unconditionally broadcasts once it has finished (inside
    // the same lock as the `connected` mutation) instead: that read only
    // returns after the mutation has happened, and — this is the bug — a
    // broken guard makes it flip `second`'s own entry to disconnected, so
    // `broadcast` skips it and this read never completes.
    let mut roster_after_death = String::new();
    second_reader
        .read_line(&mut roster_after_death)
        .expect("the reconnect should still receive the roster broadcast the exit path sends");
    assert!(
        roster_after_death.contains("roster"),
        "expected a roster frame, got {roster_after_death:?}"
    );
    assert_eq!(
        host.connected_count(),
        1,
        "the reconnect must stay connected once the stale connection notices it died"
    );

    // The decisive assertion: a commit still reaches the live socket.
    let submit = json!({"t": "submit", "action": {"_tag": "Roll", "playerId": "p1"}});
    writeln!(second, "{submit}").expect("submit should be sent");
    let mut frame = String::new();
    second_reader
        .read_line(&mut frame)
        .expect("the reconnected client should still be broadcast to");
    assert!(
        frame.contains("commit"),
        "expected a commit frame, got {frame:?}"
    );
}
