# Snakes & Ladders: Mutation

A local-multiplayer board game for phones. The board fights back: ladders wear
out and turn into snakes, everyone rolls at once and can knock each other down,
tokens carry momentum off a climb, and a hidden minefield is buried under the
same hundred tiles.

No internet, no accounts, no servers. Up to six players on the phones in the
room.

- **[Rules](docs/rules.md)** — how the game is played and what each twist does
- **[Playing together](docs/playing-together.md)** — getting devices connected
- **[Decisions](docs/adr/)** — why it is built the way it is
- **[Tooling](docs/tooling.md)** — toolchain setup

## Try it

```bash
npm install
npm run dev -- --host    # open the LAN address it prints on any phone
```

Pick **Pass and play on this device** and untick the rule modules in the lobby
for classic Snakes & Ladders, or leave them on for the full thing.

For several devices at once, see [Playing together](docs/playing-together.md).

## How it works

Every device folds the same ordered log of actions through the same
deterministic engine, so they all compute the same match without exchanging any
game state. A room code *is* the match seed, so two devices build an identical
board from four characters.

Whoever hosts only assigns sequence numbers — it holds no game state and knows
no rules. That keeps the networking small enough to be obviously correct, and
means there is exactly one implementation of the rules to keep right.

Built with Tauri, React, Effect, TanStack and Three.js, with the networking in
Rust.
