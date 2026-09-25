# 0020. A boardgame, not a number game

## Status

Accepted.

## Context

The game already computes everything a boardgame needs. `TimelineEvent`
(`packages/engine/src/events.ts`) is a semantic stream — `TookLink` knows the
link's kind and both ends, `Knocked` knows who knocked whom, `MineTripped`
knows whether the blast was absorbed — and ADR 0007 hands that stream to a
renderer that replays it. The material for showing a round is there, derived
identically on every device.

What happens to it is that it gets converted back into sentences and digits.
`EventLog.tsx` narrates the round in prose: "Python rolled 4 + 2 (+1
momentum)", "gained 2 venom", "the board shifted (3 moved)". The HUD renders
player state as a row of numerals and sigils — `{player.position}`,
`☣{player.venom}`, `»{player.momentum}` — so a player reads their situation
off a scoreboard rather than off the board. Minesweeper adjacency is a digit
drawn into the board texture (`board-texture.ts:172`). The one place the board
genuinely speaks for itself, `Revealed`, is also the one event `describe`
deliberately returns `null` for, with the comment "the board itself shows
this" — the exception that shows the rule.

The result reads as a spreadsheet that happens to be rendered in 3D. The
renderer-legibility design reached the same conclusion from the other
direction and stated it plainly: *you cannot read the game off the screen*,
and that is a gameplay problem, not a polish problem.

This surfaced as a governing thesis during the 2026-09-16 brainstorm, and it
is recorded as an ADR rather than a section in any one spec because three
separate bodies of unbuilt work each need the answer and would each otherwise
re-derive it: the settings and input design, `renderer-legibility`, and the
mode designs (minesweeper integration, mutation cards, momentum transfer,
ladder expiry, a skip mechanic). It also reaches the rules, not only their
presentation, which is beyond what a presentation spec may decide.

## Decision

**The board is the primary channel. Text and digits are the fallback, the
record, and the accessible path — never the first way a player learns what
happened.**

Concretely, four rules:

1. **Every timeline event owes a board-visible depiction.** Adding a
   `TimelineEvent` variant without one is an incomplete change, in the same
   way that adding one without a reducer case would be. "The log will say it"
   is not a depiction.

2. **Text narrates what the board cannot show**, and it stays: an `aria-live`
   log is how a screen-reader player receives a round at all, and a scrollable
   record is how anyone reconstructs a round they looked away from. It is
   demoted, not deleted.

3. **Digits stay where a digit is the honest unit.** A player choosing a card
   needs to compare a cost against a balance; a player planning a move needs a
   tile number. The failure mode this ADR names is a quantity whose *only*
   representation is a numeral — not the presence of numerals.

4. **Showing never implies agency the engine does not grant.** Dice are drawn
   from the shared PRNG during resolution and `Commit` carries no value
   (ADR 0001), so the dice may be an object the player touches, and may not be
   an object the player throws. A gesture whose apparent physics appears to
   determine an outcome is a lie about the architecture, and the lie is worse
   than the scoreboard.

This decision constrains presentation and rule design. It does not touch the
engine's arithmetic: momentum remains integer (ADR 0003), the reducer remains
pure, and the renderer still never decides (ADR 0007). What changes is that
"the engine computed it correctly" stops being a complete answer to "can a
player see it".

## Consequences

The immediate win is that the existing timeline is enough. Because every
device folds the same log into the same events (ADR 0001), a depiction built
from a timeline event is automatically consistent across devices and costs
nothing on the wire — the same property that let the renderer exist at all now
extends to everything this ADR asks for.

It also gives the three blocked designs a shared premise instead of three
private ones, and it decides several open questions by construction rather
than by taste: flick-to-throw is out under rule 4; an always-tappable dice
tray is in; animation speed becomes a legitimate setting because ADR 0007
already guarantees that an animation which stutters or is skipped cannot
change a result.

The costs are real and some of them are permanent.

**It trades pace for weight.** A round that is shown takes longer than a round
that is printed, and pass-and-play on a phone is a format where that is felt.
Mitigating it with a speed control is not free either: the control needs a
floor, because a fast enough animation is a teleport, and the causal beats —
you rolled, you moved, the snake bit — must remain separable at every speed or
the depiction stops being a depiction. That floor is a number somebody has to
defend, and it will be wrong for someone.

**Some things genuinely read better as digits**, and rule 3 exists because the
thesis pushed to its conclusion produces worse UI. There is no test for where
that line falls; it is a judgement call, made per quantity, that will be
re-litigated.

**It raises the price of every rule module.** ADR 0002 makes twists optional
and cheap to add — a small module under `rules/` and a flag in `MatchConfig`.
Under this ADR each one additionally owes a visual vocabulary that reads
against the others without collapsing into noise, on a board where the
renderer-legibility design has already measured three information layers
fighting for 0.4 of vertical space. That is a standing tax on the mechanism
this project uses to explore the game, and it is the consequence most likely
to be resented later.

**A missing depiction fails silently and in the worst direction.** Today, an
unhandled event means a missing line in a log nobody was reading. Once the
board is the primary channel, it means a player is not told something the
engine decided — a correctness-grade defect that no engine test can catch,
because the engine is right. The determinism suite will stay green through it.
Verification has to be visual, which this repo has already learned four times
over: the clipped board, the invisible event log, the disabled-looking-enabled
button and the QR's CSS quiet zone were each invisible in the source and
obvious in a screenshot.

**It reaches the rules, and the first thing it finds is broken.** `venom` is
core player state — initialised, priced and spent in `match.ts` — but earned in
exactly one place, `venomForBite` in `rules/mutation.ts`. With `mutation` off
it is permanently zero, so it is a number on the HUD that can never move: the
number-game failure mode in the rules layer rather than the presentation one.
Under this ADR that is a defect to fix rather than a quirk to document, and it
is why a second currency ("gold") was declined until venom's two defects —
stranded without `mutation`, and nothing worth buying — are closed.
