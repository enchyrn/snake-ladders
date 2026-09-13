# 0009. Progression is declared at join time, and trust is social

## Status

Proposed — the alternatives (cosmetic-only progression, or host ratification
in the lobby) are still open, and this ADR is not Accepted until that choice
is made. See `docs/superpowers/specs/` for the RPG design this belongs to.

## Context

The RPG layer adds character classes, persistent levels, and loot that grant in-match bonuses. Because a bonus tied to, say, a level-7 character actually changes how a match plays out, every device folding the action log (ADR 0001) must know that character's progression to compute the same result. But progression itself is per-device, local save data — there is no server and no shared store to verify one device's claim about its own character against another device's records.

## Decision

A player's class and progression values are declared as part of their `Join` action, and that action enters the synced log exactly like any other action. Every device folds the same declared values through the engine, so the match stays fully deterministic. Nothing in the system verifies that a declared value matches what's actually stored on that player's device.

## Consequences

Progression bonuses affect play correctly and consistently for everyone at the table, and the engine's determinism guarantee (ADR 0001) is fully preserved — every device computes the same outcome from the same declared inputs, regardless of whether those inputs are honest.

The explicit, accepted cost is that a player who edits their own local save data can declare an inflated level or better loot than they actually have, and nothing in the architecture can catch or stop this — there is no authority anywhere in the system positioned to verify a claim about another device's local state. This is judged acceptable specifically because the game's target setting is people playing together in the same physical room, where the social cost of visibly cheating a friend sitting next to you does real work that a technical control would otherwise have to do. Closing this gap technically would mean introducing some trusted, always-available authority to verify progression claims — which is precisely the server-dependent architecture this whole design (ADR 0001, 0004) exists to avoid. This trade-off is a deliberate, permanent property of the design, not a gap slated to be closed later.
