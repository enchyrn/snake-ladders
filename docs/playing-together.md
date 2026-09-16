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
| An Android host and a browser | **Install the app** on the Android, then **scan the QR** on its lobby — the page comes from the host, so nothing else is needed |

### A browser joining an installed host

The installed app's host serves the game itself, so an Android phone can be the
host for someone on a laptop with nothing installed and nothing else running.

**Scan the QR on the host's lobby.** That is the whole flow: the code points at
the host's own address, the browser loads the game from it, and the room is
joined. If the camera is awkward, the same address is printed under the code —
type it into a browser's address bar on the same Wi-Fi.

The `address:port@CODE` line is still there and still works, for a device that
already has the game open and would rather type than scan.

The old limit — **the page has to have been opened over `http://`** — is
unchanged and is now satisfied for you. A page served over HTTPS, which is what
the deployed site is, is forbidden by the browser from opening an insecure
connection to a device on your Wi-Fi, and refuses before anything reaches the
network. Because the host serves the page itself over plain HTTP, the page and
the room share one origin and the rule never bites. See ADR 0019.

**One consequence worth knowing.** The guest's copy of the game came from the
host. If the host leaves the match or closes the app, a guest who reloads the
page has nothing to reload from — the tab goes dead, and it will look like a
crash. It is inherent to serving the page off the host rather than a bug: nobody
else is holding a copy. Finish the match before the host closes the app, or have
the guest use the deployed site with the relay instead.

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
where `ws://` is allowed — or, if one device has the app installed, host on
that and scan its QR, which puts every guest on a plain-HTTP origin without a
computer or a relay at all. Pass-and-play works on the deployed site
regardless: it never opens a socket.

### A browser joining an installed app: what still does not work

A browser **can** join a natively hosted room — the host answers a WebSocket
upgrade on its own port (ADR 0019) and serves the page itself, which is the
QR flow above. This section used to say the opposite; it was written before
that and was wrong from ADR 0019 onwards.

What is still true is narrower, and it is about the *page*, not the socket:

| The guest's page was opened from | Can it join a native host? |
|---|---|
| The host's QR, or any `http://` address | **yes** |
| `https://enchyrn.github.io/snake-ladders/` | **no** — an HTTPS page may not open a `ws://` socket |

The deployed site is the one case that fails, and serving the page from the
host is precisely what sidesteps it: the guest is then on a plain-HTTP origin,
so the mixed-content rule never applies. A LAN host cannot present a
certificate anyone trusts, so making the deployed page work instead would mean
a relay reachable over `wss://` — a public machine, and the end of "the game
never touches the internet".

The other direction is still genuinely missing: the installed app joins through
`net_join`, a Tauri command into the Rust TCP client, which has no WebSocket
client in it. **An installed app cannot join a browser's relay.** So a relay
match is all-browser, while a native host now takes both.

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
