# RPG layer — design

**Status:** approved in conversation, not implemented. No code exists yet.
**Date:** 2026-09-13

Two questions were settled with the user before this design; both answers are
load-bearing and should not be quietly revisited.

1. **Progression is declared at join, and trust is social.** Class and level
   enter the `Join` action and every device folds the declared values. Nothing
   verifies them. A player can edit their own save and declare what they like;
   that is accepted because the game is played by people in the same room, and
   the only technical fix is a trusted authority, which the whole design exists
   to avoid. Recorded as ADR 0009.
2. **The RPG reshapes the existing venom economy rather than adding a parallel
   one.** The alternative — abilities on their own cooldowns, an inventory with
   its own slots, XP-gated tiers — was rejected as putting two currencies and an
   inventory on a 360px screen.

## Scope

`rpg` becomes a fifth rule module alongside `mutation`, `simultaneous`,
`momentum` and `minesweeper`. Off, the game is exactly what it is today, so the
existing rule tests stay meaningful and the RPG layer cannot regress a classic
match.

## Classes

Six, each bending one rule that already exists rather than adding a system:

| Class | Gains | Pays |
|---|---|---|
| Charmer | Snake bites pay double venom | Takes the full drop regardless |
| Sapper | `defuse` costs 1; landing reveals one ring further | — |
| Climber | Your climbs do not wear ladders out | — |
| Gambler | Rolls d8 instead of d6 | Mine blasts stun 2 rounds, not 1 |
| Warden | Knockbacks return you to where you began the round | — |
| Trickster | All cards cost 1 less (min 1) | Cannot bank more than 3 venom |

Every one is a parameter on a rule with tests already behind it.

## Progression

`Join` gains `classId` and `level` (1–10). That is the entire untrusted
surface: two values, both visible to everyone in the lobby. Level scales only
the class's signature lever on a fixed table, so there is no separate talent
tree to declare, verify or render.

XP is computed from the final match state — which every device already agrees
on — and each device then stores only its own, in `localStorage`, per class.
`src/progress/` is the only non-deterministic corner and is deliberately
isolated from the engine.

## Loot

**Relics are seeded onto the board like mines and found during the match.**
They never persist between matches, so they never need declaring and cannot be
forged. This is the point: it keeps the trust surface at exactly the two
declared numbers above while still delivering the loot the user asked for.

Carry two; a third pickup forces a choice, which is an `EquipRelic` action so
it enters the log. Starting set: *Ivory Charm* (one re-roll), *Lantern* (reveal
3×3 on every landing), *Rope* (a free anchor), *Fang* (next bite pays triple).

## Files

- `src/engine/rules/rpg.ts` — new module, same shape as the other four
- `src/engine/primitives.ts` — `ClassId`, `RelicKind`
- `src/engine/actions.ts` — `Join` extended, `EquipRelic` added
- `src/engine/events.ts` — `RelicFound`, `RelicUsed`, `ClassTriggered`
- `src/progress/` — localStorage, isolated
- Lobby class picker; HUD relic slots beside venom

## Build order

**Extend the determinism fuzz driver first**, before any class exists. Six
classes times ten levels times four existing modules is a large combination
space, and the fuzz driver in `src/engine/__tests__/determinism.test.ts` is
what makes it tractable rather than terrifying: have it declare random classes
and levels in `Join` and assert peers still agree. Then add classes one at a
time, a test per class lever, then relics, then progression, then UI.
