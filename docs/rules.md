# Rules

The authoritative description of what the engine actually does. Where this
document and `packages/engine/src/` disagree, the engine is right and this is a bug.

## The board

A 10×10 grid, tiles numbered 1 to 100, snaking back and forth: tile 1 is
bottom-left, 10 is bottom-right, 11 sits directly above 10, and so on. Tile 0
is the start tray, off the board.

Snakes and ladders are generated from the **room code**, which is the match
seed. Every device in a room derives the same board from that code, so no board
is ever sent between devices.

One rule holds on every board: **a snake or ladder never deposits you onto the
mouth of another**. A single roll can therefore trigger at most one of them.

## A turn

Roll, move that many tiles, and resolve whatever you land on. Reaching tile 100
wins and ends the match.

**You need an exact roll to finish.** Overshooting bounces you back off the
top: from 98, a roll of 5 leaves you on 97.

Ladders carry you up. Snakes carry you down.

The match ends the moment the first player reaches 100.

Between one and six players. One player is a legitimate match — a solo run
against the board.

---

# The twists

Four rule modules, each switched on or off in the lobby. With all four off this
is ordinary Snakes & Ladders. They can be combined freely.

## Mutation

**Ladders wear out.** After two climbs a ladder collapses and inverts into a
snake along the same span — the shortcut you memorised now drops you.

**Snake bites pay venom.** A bite is worth `1 + ⌊drop ÷ 10⌋`, so a snake that
takes you down 44 tiles pays 5 and a short one pays 1. Venom is the game's
currency and the only way to earn it is to be bitten.

**The board breathes.** Every 5 rounds up to two snakes or ladders pick
themselves up and move somewhere else. It happens identically on every device,
because it is drawn from the shared seed.

### Cards

Spend venom before you roll. One of each per round.

| Card | Cost | Effect |
|---|---|---|
| **Anchor** | 1 | Shrug off the next snake bite or mine blast. Keeps until used. |
| **Reverse** | 2 | The next snake or ladder you enter runs the other way — a snake becomes a climb of the same length. |
| **Defuse** | 2 | Disarm a tile within 2 of your token. A correct read refunds 1. |
| **Double** | 3 | Roll two dice this round and sum them. |
| **Swap** | 4 | Trade places with whoever is furthest ahead. Refused if you already lead. |

In turn-based play you may only play cards on your own turn. With simultaneous
rolls you may play any time before you roll — but not after.

## Simultaneous

Everyone rolls in the same round instead of taking turns.

Resolution runs **lowest roll first**, so the biggest roll lands last. Ties
break on seat order, which never changes.

**Landing on an occupied tile throws that token down the nearest snake** —
specifically to the mouth of the highest snake below where they stood, or back
to the start if there is none. Being shoved on a snake-dense stretch of board
hurts far more than on open ground.

Since the biggest roll resolves last, rolling well is also what lets you do the
knocking.

## Momentum

Snakes and ladders impart speed. Travelling a link grants `⌊length ÷ 10⌋`
momentum, added to your **next** roll.

Momentum bleeds rather than compounds: each round it halves, unless a fresh
link grants more. A 60-tile ladder gives 6, then 3, then 1.

Momentum makes overshooting the top far easier, and you still need an exact
landing — so a big climb late in the game can bounce you backwards repeatedly.

The whole system is integer arithmetic. The 3D view shows an overshooting arc,
but the landing tile was decided before the animation started.

## Minefield

Hidden mines are buried in the board — 12 by default — never under a snake or
ladder endpoint, and never on tile 1 or 100.

**Tiles reveal as tokens land on them**, showing the number of mines among
their eight grid neighbours. A tile with no mines nearby opens its whole blank
region at once, exactly as in Minesweeper. The deduction puzzle therefore
unfolds from where players have actually been, which makes a snake that drops
you into unexplored board genuinely frightening.

**Stepping on a live mine** throws you back 10 tiles and costs you the next
round. The mine is spent and cannot catch anyone again. An anchor absorbs it
entirely.

**Tap any unrevealed tile to flag it.** Flags are shared across every device
and have no mechanical effect — they are for arguing about.

`Defuse` disarms permanently, for everyone. It only reaches tiles within 2 of
your token, so the adjacency numbers you have uncovered are what tell you
whether it is worth spending.

---

# How the modules interact

Worth knowing, because the combinations are where the game gets interesting:

- **Mutation + Minefield** — venom is the only way to buy `defuse`, so clearing
  the minefield means getting bitten first.
- **Momentum + exact finish** — momentum you cannot shed makes the last few
  tiles genuinely difficult.
- **Simultaneous + Minefield** — being knocked back can land you on a live
  mine, so another player's good roll can detonate one under you.
- **Mutation + Momentum** — a ladder collapsing into a snake turns a
  momentum-granting climb into a momentum-granting fall.
- A mine at the far end of a snake or ladder cancels the momentum that link
  granted. The blast, not the travel, decides where you end up.
