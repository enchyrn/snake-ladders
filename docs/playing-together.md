# Playing together

The game never touches the internet. Everything below works on a home network,
a phone hotspot, or an access point with no uplink at all.

## One device

Open the app, pick **Pass and play on this device**, hand it round. Up to six
players. Works everywhere — browser, installed app, anything.

The lobby shows a room code even in pass-and-play, because the code is the
board: type the same code another day and you get the same snakes, ladders and
minefield.

**Adding and removing players.** Type a name in the lobby and press **Add
player**. Everyone but you gets a **×** to remove them again; you cannot remove
yourself, because the device has to have a seat. Players you add are remembered
on this device, so the same group is already seated next time — remove anyone
who is not playing today, or they join again.

**Whose turn it is.** Once more than one player shares the device, the match
screen names whoever should be holding it. With **Simultaneous** on everyone
rolls in the same round, so the names appear as buttons: tap one to play as that
player, and the highlighted name is the one your roll and cards will apply to.

## Several devices

Pick the row that matches what you have.

| You have | Use |
|---|---|
| Android phones only | **Install the app** on each — native Wi-Fi, nothing else running |
| An iPhone in the mix | **Run the relay** on a computer |
| A computer and any phones | **Run the relay** — simplest, no installs |
| An Android host and a browser | **Install the app** on the Android, and open the game over `http://` on the other device — no relay needed |

### A browser joining an installed host

The installed app's host accepts browsers directly, so an Android phone can be
the host for someone on a laptop with nothing else running. On the host, read
the `address:port@CODE` line off the lobby screen; on the laptop, pick **Join a
game** and type it in.

One hard limit, and no setting changes it: **the page has to have been opened
over `http://`.** A page served over HTTPS — which is what the deployed site is
— is forbidden by the browser from opening an insecure connection to a device on
your Wi-Fi, and it refuses before anything reaches the network. Use a dev server
on the LAN (`nub run dev -- --host`), or the installed app. See ADR 0019.

### Native Wi-Fi (installed app)

One device picks **Host on Wi-Fi** and reads out the room code. Everyone else
picks **Join a game** and taps the room when it appears — usually within a
second.

The host announces itself with a UDP beacon, so no pairing step and nothing to
type. If the room does not appear, the network is blocking broadcast traffic
(common on guest and corporate Wi-Fi, and on iOS without the local-network
permission). Use **Join by address** instead: the host screen shows the exact
string to type.

Requires the installed app on every device, because a web page cannot open the
socket other devices connect to.

### The relay (any browser, including iPhone)

On a computer on the same network:

```bash
node apps/relay/lan-relay.mjs
```

It prints something like:

```
Room KNWX — up to 6 players, listening on port 4455.
On each other device, open the game and paste this into "Join by address":

  192.168.1.5:4455@KNWX
```

On each phone, open the game, choose **Join a game**, expand **Join by
address**, and paste that line. That includes iPhones — no App Store, no Apple
account, no install.

The computer must stay awake for the length of the match; it is the host.

Options: `--port`, `--room`, `--capacity`.

## Getting the game onto a device

**Any phone, no install** — serve the built app from a computer:

```bash
nub run dev -- --host
```

and open the LAN address it prints.

**Install to the home screen** — open

```
https://enchyrn.github.io/snake-ladders/
```

and use Add to Home Screen. A home-screen install needs an HTTPS origin, which
is the whole reason this deployment exists; `nub run dev -- --host` serves over
plain HTTP and cannot be installed. Once installed it runs fully offline —
board, 3D view, rules and all — because the service worker precaches the entire
app shell rather than a subset.

The `Pages` workflow publishes that URL from `main`. The site is the app only:
a static host cannot run the relay, which is a socket.

**Joining another device from the deployed site does not work yet.** The page
is served over HTTPS — which is exactly what makes it installable — and a
browser refuses to open the plain `ws://` connection the relay
(`apps/relay/lan-relay.mjs`) speaks. It is refused before it reaches the
network, so it fails the same way whether or not a relay is running. Closing
that needs a relay reachable over `wss://`; until then, serve the game over
plain HTTP from a computer on the same network with `nub run dev -- --host`,
where `ws://` is allowed. Pass-and-play works on the deployed site regardless:
it never opens a socket.

### A browser and an installed app cannot join each other

This is a property of the architecture, not a bug or a missing flag, and no
amount of `wss://` changes it.

The two sequencers speak different wire protocols at the transport layer:

| | speaks | can a browser open it? |
|---|---|---|
| `crates/lan-sync` (native host) | newline-delimited JSON over a raw `TcpListener` | **no** — a browser has no raw TCP |
| `apps/relay/lan-relay.mjs` | WebSocket | yes |

Point a browser at a natively hosted room and the host answers
`{"t":"rejected","reason":"malformed handshake"}` — it reads the browser's
`GET / HTTP/1.1 … Upgrade: websocket` request as a `Hello` frame, fails to
parse it as JSON, and refuses. Verified directly against `Host::bind`, not
inferred. The reverse fails too: the installed app joins through `net_join`,
a Tauri command into the Rust TCP client, which has no WebSocket in it either
(`crates/lan-sync` depends only on `serde` and `serde_json`).

So a match is **either all-native or all-browser**:

- every device on the installed app → native LAN, no relay, nothing to run;
- every device in a browser → one relay on a computer, everyone joins that.

Mixing them needs a bridge that does not exist yet: either the Rust host also
answering a WebSocket upgrade, or the native app being able to join a relay as
a WebSocket client. Both are real work and neither is what the `wss://`
decision is about — that one only makes an HTTPS *page* able to reach a relay.

It updates by asking rather than reloading underneath you: a new version
precaches in the background and the app offers it between matches, because
swapping the bundle mid-match would leave one device folding the log by
different rules than the rest.

**Android, native** — download the `android-debug-apk` artifact from the latest
successful Android run in GitHub Actions, unzip, and install. Enable "install
from unknown sources". This is the only build with native Wi-Fi play.

**iPhone, native** — needs a Mac with Xcode. A free Apple ID can sideload to
your own device for 7 days at a time; a paid Apple Developer account removes
that limit. For most purposes the relay is easier and has no expiry.

## When it does not work

**The room never appears.** The network is blocking broadcast. Use join-by-address.

**"Could not reach …"** — the relay is not running, the address is wrong, or
the devices are on different networks. Phones often sit on a guest SSID while a
laptop is on the main one.

**A device says it lost the host.** The host left, slept, or dropped off Wi-Fi.
Rejoining readmits you to your existing seat: your actions are already in the
log and the match resumes where you left it.

**One device is showing a different board.** Check the room codes match. The
code is the seed, so a different code is a different board.
