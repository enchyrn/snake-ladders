# Playing together

The game never touches the internet. Everything below works on a home network,
a phone hotspot, or an access point with no uplink at all.

## One device

Open the app, pick **Pass and play on this device**, hand it round. Up to six
players. Works everywhere — browser, installed app, anything.

The lobby shows a room code even in pass-and-play, because the code is the
board: type the same code another day and you get the same snakes, ladders and
minefield.

## Several devices

Pick the row that matches what you have.

| You have | Use |
|---|---|
| Android phones only | **Install the app** on each — native Wi-Fi, nothing else running |
| An iPhone in the mix | **Run the relay** on a computer |
| A computer and any phones | **Run the relay** — simplest, no installs |

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
node scripts/lan-relay.mjs
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
npm run dev -- --host
```

and open the LAN address it prints.

**Install to the home screen** — needs an HTTPS origin, so build and host the
`dist/` folder somewhere with a certificate, then use Add to Home Screen. It
then runs fully offline, including the board, the 3D view and the rules.

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
