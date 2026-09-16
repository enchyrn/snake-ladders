//! Tauri shell.
//!
//! Deliberately thin: it owns sockets and forwards frames to the webview.
//! Every game rule lives in the TypeScript engine, so there is one
//! implementation of the rules to keep correct rather than two that must
//! agree, and the interesting half of this file — the session pump — is
//! tested in the `lan-sync` crate where no webview toolchain is needed.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use lan_sync::{seed_from_room, Browser, PeerInfo, Sequenced, Session, SessionSink, SessionStatus};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// How often the pump drains sockets: fast enough that a roll lands on the
/// other phone without a perceptible pause, slow enough to stay off the battery.
const PUMP_INTERVAL: Duration = Duration::from_millis(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

const EVENT_COMMIT: &str = "lan://commit";
const EVENT_ROSTER: &str = "lan://roster";
const EVENT_STATUS: &str = "lan://status";

#[derive(Default)]
struct NetState {
    session: Mutex<Option<Arc<Session>>>,
    browser: Mutex<Option<Browser>>,
    /// One flag per pump. Sharing a single flag let a replaced pump observe
    /// the *next* pump's `true` during its sleep and carry on running, holding
    /// its session — listener, beacon and all — alive behind the slot.
    pumping: Mutex<Option<Arc<AtomicBool>>>,
}

type Net = Arc<NetState>;

#[derive(Debug, Serialize)]
struct RoomView {
    room: String,
    host: String,
    addr: String,
    players: u8,
    capacity: u8,
    locked: bool,
    /// The seed the room code encodes, so a joining device builds the same
    /// board without anyone sending it one.
    seed: u32,
}

#[derive(Debug, Serialize)]
struct HostedRoom {
    room: String,
    port: u16,
    seed: u32,
}

#[derive(Debug, Serialize, Clone)]
struct StatusPayload {
    connected: bool,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Identity {
    player_id: String,
    name: String,
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Bridges session output onto the webview's event bus.
struct WebviewSink(AppHandle);

impl SessionSink for WebviewSink {
    fn commit(&mut self, entry: Sequenced) {
        let _ = self.0.emit(EVENT_COMMIT, entry);
    }

    fn roster(&mut self, peers: Vec<PeerInfo>) {
        let _ = self.0.emit(EVENT_ROSTER, peers);
    }

    fn status(&mut self, status: SessionStatus) {
        let payload = match status {
            SessionStatus::Connected => StatusPayload {
                connected: true,
                reason: None,
            },
            SessionStatus::Rejected(reason) => StatusPayload {
                connected: false,
                reason: Some(reason),
            },
            SessionStatus::Disconnected => StatusPayload {
                connected: false,
                reason: Some("lost the host".into()),
            },
        };
        let _ = self.0.emit(EVENT_STATUS, payload);
    }
}

/// Run one pump thread per session, ending when the session is replaced.
fn start_pump(app: AppHandle, net: Net, session: Arc<Session>) {
    let running = Arc::new(AtomicBool::new(true));
    if let Ok(mut slot) = net.pumping.lock() {
        if let Some(previous) = slot.replace(Arc::clone(&running)) {
            previous.store(false, Ordering::SeqCst);
        }
    }
    thread::spawn(move || {
        let mut sink = WebviewSink(app);
        while running.load(Ordering::SeqCst) {
            session.poll(&mut sink);
            thread::sleep(PUMP_INTERVAL);
        }
    });
}

fn teardown(net: &Net, app: &AppHandle) {
    if let Ok(mut slot) = net.pumping.lock() {
        if let Some(previous) = slot.take() {
            previous.store(false, Ordering::SeqCst);
        }
    }
    if let Ok(mut slot) = net.session.lock() {
        slot.take();
    }
    let _ = app.emit(
        EVENT_STATUS,
        StatusPayload {
            connected: false,
            reason: None,
        },
    );
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

/// Open a room on this device. The returned code is also the match seed.
#[tauri::command]
fn net_host(
    app: AppHandle,
    net: State<'_, Net>,
    seed: u32,
    name: String,
    capacity: u8,
) -> CmdResult<HostedRoom> {
    let net = Arc::clone(net.inner());
    teardown(&net, &app);

    let session = Arc::new(Session::host(seed, name, capacity, true).map_err(err)?);
    let hosted = HostedRoom {
        room: session.room().unwrap_or_default().to_string(),
        port: session.port().unwrap_or(0),
        seed,
    };

    *net.session.lock().map_err(err)? = Some(Arc::clone(&session));
    start_pump(app, net, session);
    Ok(hosted)
}

/// Stop accepting joins once the match is under way.
#[tauri::command]
fn net_lock(net: State<'_, Net>) -> CmdResult<()> {
    if let Some(session) = net.session.lock().map_err(err)?.as_ref() {
        session.lock();
    }
    Ok(())
}

/// Begin listening for rooms on the local network.
#[tauri::command]
fn net_browse(net: State<'_, Net>) -> CmdResult<()> {
    let mut slot = net.browser.lock().map_err(err)?;
    if slot.is_none() {
        *slot = Some(Browser::start().map_err(err)?);
    }
    Ok(())
}

/// Rooms visible right now. Polled by the lobby.
#[tauri::command]
fn net_rooms(net: State<'_, Net>) -> CmdResult<Vec<RoomView>> {
    let slot = net.browser.lock().map_err(err)?;
    let Some(browser) = slot.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(browser
        .rooms()
        .into_iter()
        // A beacon's room code is always one this crate encoded, so this
        // never actually fails — but `unwrap_or(0)` would silently offer a
        // real, joinable room for the wrong board instead. Drop it instead:
        // an omitted room is a lobby that looks a little sparse, not a
        // desync with no banner to explain it.
        .filter_map(|found| {
            Some(RoomView {
                seed: seed_from_room(&found.beacon.room)?,
                room: found.beacon.room,
                host: found.beacon.host,
                addr: found.addr.to_string(),
                players: found.beacon.players,
                capacity: found.beacon.capacity,
                locked: found.beacon.locked,
            })
        })
        .collect())
}

/// Join a room found by discovery, or one whose address was typed in by hand
/// because the network blocks broadcast traffic.
#[tauri::command]
fn net_join(
    app: AppHandle,
    net: State<'_, Net>,
    addr: String,
    identity: Identity,
) -> CmdResult<()> {
    let socket: SocketAddr = addr
        .parse()
        .map_err(|_| format!("`{addr}` is not a host address"))?;
    let net = Arc::clone(net.inner());
    teardown(&net, &app);

    let session = Arc::new(
        Session::join(socket, identity.player_id, identity.name, CONNECT_TIMEOUT).map_err(err)?,
    );
    *net.session.lock().map_err(err)? = Some(Arc::clone(&session));
    start_pump(app, net, session);
    Ok(())
}

/// Send an action for sequencing. It comes back through `lan://commit` like
/// everyone else's — a device never applies its own action early, which is
/// what keeps the fold order identical on every phone in the room.
#[tauri::command]
fn net_submit(net: State<'_, Net>, action: serde_json::Value) -> CmdResult<()> {
    let slot = net.session.lock().map_err(err)?;
    let session = slot.as_ref().ok_or("not connected to a room")?;
    session.submit(action).map_err(err)
}

/// Leave the room and release every socket.
#[tauri::command]
fn net_leave(app: AppHandle, net: State<'_, Net>) -> CmdResult<()> {
    teardown(&Arc::clone(net.inner()), &app);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(Net::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            net_host, net_lock, net_browse, net_rooms, net_join, net_submit, net_leave,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
